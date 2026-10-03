import { and, eq } from "drizzle-orm";
import { referencesIn } from "@/core/resolve";
import type { WorkflowSpec } from "@/core/spec";
import { db } from "@/db";
import { connections } from "@/db/schema";
import type { AppSetting } from "@/integrations/define";
import { findAction, findApp } from "@/integrations/registry";
import { isIntegrationValue, isUnsetValue, valueField } from "./agent-types";
import { decryptSecret } from "./crypto";
import { blockingItems, type SetupItem } from "./setup-rules";

/** Always in the {{agent.*}} scope */
const BUILT_IN_VALUES = new Set(["name", "role"]);

export interface ConnectionState {
  settings: Record<string, string>;
  /** Set when the service refused the credential during a run (401/403), cleared when it is saved again */
  lastError: string | null;
}

/** By app key. Apps not in the map aren't connected. */
export type ConnectionStates = ReadonlyMap<string, ConnectionState>;

export { blockingItems, type SetupItem, type SetupResult } from "./setup-rules";

/** A run was started before its skill was set up. The message is safe to show. */
export class SetupIncompleteError extends Error {
  constructor(readonly items: SetupItem[]) {
    super(`Finish setup first: ${items.map((item) => item.label).join(", ")}`);
    this.name = "SetupIncompleteError";
  }
}

/** Throws SetupIncompleteError if anything required is missing, read fresh from the database. */
export async function assertSetUp(userId: string, spec: WorkflowSpec, agentVars: Record<string, string>): Promise<void> {
  const missing = blockingItems(setupNeeds(spec, agentVars, await connectionStates(userId)));
  if (missing.length > 0) throw new SetupIncompleteError(missing);
}

export function missingSettings(
  settings: AppSetting[] | undefined,
  saved: Record<string, string> | undefined,
): AppSetting[] {
  return (settings ?? []).filter((setting) => !saved?.[setting.key]?.trim());
}

// Integration setup lives on the Connections page, so each app becomes one item here.
// Reads (e.g. GitHub) are optional; a setting counts only when a step relies on its default.
export function setupNeeds(
  spec: WorkflowSpec,
  agentVars: Record<string, string>,
  states: ConnectionStates,
): SetupItem[] {
  const connectionsNeeded = new Map<string, Extract<SetupItem, { kind: "connection" }>>();
  const valuesNeeded: SetupItem[] = [];
  const seen = new Set<string>();

  for (const step of spec.steps) {
    if (step.type !== "action" && step.type !== "notify") continue;
    const definition = findAction(step.app, step.action);
    const needs = definition?.needs;
    if (!definition || !needs) continue;

    const app = findApp(needs);
    const saved = states.get(needs);
    const relied = Object.entries(definition.settingDefaults ?? {})
      .filter(([param]) => step.params[param] === undefined)
      .map(([, key]) => key);
    const missing = missingSettings(app?.settings, saved?.settings)
      .filter((setting) => relied.includes(setting.key))
      .map((setting) => setting.label);
    const rejected = saved?.lastError ?? undefined;

    if (saved !== undefined && missing.length === 0 && !rejected) continue;

    // Reads that can't run without a key (Tavily) are required like sends
    const neededForReads = !definition.sideEffect && definition.secretRequired;
    const optional = !definition.sideEffect && !definition.secretRequired;
    const existing = connectionsNeeded.get(needs);
    if (existing) {
      // Required if any step sends through it
      if (!optional) existing.optional = false;
      if (neededForReads) existing.neededForReads = true;
      existing.missing = [...new Set([...existing.missing, ...missing])];
      continue;
    }

    connectionsNeeded.set(needs, {
      kind: "connection",
      app: needs,
      label: app?.label ?? needs,
      connected: saved !== undefined,
      missing,
      optional,
      neededForReads,
      rejected,
    });
  }

  for (const reference of referencesIn(spec.steps)) {
    const [root, key] = reference.split(/[.[]/);
    if (root !== "agent" || !key || BUILT_IN_VALUES.has(key) || isIntegrationValue(key)) continue;
    if (seen.has(`agent.${key}`) || !isUnsetValue(agentVars[key])) continue;
    seen.add(`agent.${key}`);

    const field = valueField(key);
    valuesNeeded.push({
      kind: "value",
      key,
      label: field.label,
      hint: field.hint,
      placeholder: field.placeholder,
    });
  }

  const all = [...connectionsNeeded.values()];
  return [
    ...all.filter((item) => !item.optional),
    ...valuesNeeded,
    ...all.filter((item) => item.optional),
  ];
}

/** Settings and last error only, no secrets. */
export async function connectionStates(userId: string): Promise<Map<string, ConnectionState>> {
  const rows = await db.query.connections.findMany({
    where: eq(connections.userId, userId),
    columns: { app: true, settings: true, lastError: true },
  });
  return new Map(rows.map((row) => [row.app, { settings: row.settings, lastError: row.lastError }]));
}

export async function connectionSecret(userId: string, app: string): Promise<string | null> {
  const row = await db.query.connections.findFirst({
    where: and(eq(connections.userId, userId), eq(connections.app, app)),
  });
  if (!row) return null;
  try {
    return decryptSecret({ userId, app }, row.secret);
  } catch {
    // Rotated key or tampered row, treat as missing
    return null;
  }
}
