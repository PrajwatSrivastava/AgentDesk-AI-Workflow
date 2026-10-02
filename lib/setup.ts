import { and, eq } from "drizzle-orm";
import { referencesIn } from "@/core/resolve";
import type { WorkflowSpec } from "@/core/spec";
import { db } from "@/db";
import { connections } from "@/db/schema";
import type { AppSetting } from "@/integrations/define";
import { findAction, findApp } from "@/integrations/registry";
import { isIntegrationValue, isUnsetValue, valueField } from "./agent-types";
import { decryptSecret } from "./crypto";
import type { SetupItem } from "./setup-rules";

/** Always in the {{agent.*}} scope */
const BUILT_IN_VALUES = new Set(["name", "role"]);

/** App key to settings. Apps not in the map aren't connected. */
export type ConnectionStates = ReadonlyMap<string, Record<string, string>>;

export { blockingItems, type SetupItem, type SetupResult } from "./setup-rules";

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
    const missing = missingSettings(app?.settings, saved)
      .filter((setting) => relied.includes(setting.key))
      .map((setting) => setting.label);

    if (saved !== undefined && missing.length === 0) continue;

    const optional = !definition.sideEffect;
    const existing = connectionsNeeded.get(needs);
    if (existing) {
      // Required if any step sends through it
      if (!optional) existing.optional = false;
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

/** Settings only, no secrets. */
export async function connectionStates(userId: string): Promise<Map<string, Record<string, string>>> {
  const rows = await db.query.connections.findMany({
    where: eq(connections.userId, userId),
    columns: { app: true, settings: true },
  });
  return new Map(rows.map((row) => [row.app, row.settings]));
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
