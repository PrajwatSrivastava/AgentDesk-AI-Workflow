import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { IntegrationError } from "@/integrations/http";
import { findAction } from "@/integrations/registry";
import { resolveParams } from "../resolve";
import type { RunContext, StepHandler, StepResult } from "../types";

interface ActionLike {
  id: string;
  app: string;
  action: string;
  params: Record<string, string | number | boolean>;
}

async function perform(step: ActionLike, ctx: RunContext): Promise<StepResult> {
  const definition = findAction(step.app, step.action);
  if (!definition) {
    // Only reachable for specs saved before an integration was removed.
    throw new Error(`No such action: ${step.app}.${step.action}`);
  }

  const params = resolveParams(step.params, ctx);

  // Missing params fall back to the connection's settings (Notion page, recipient address).
  // Done before the dry-run return so a test run shows the real target.
  for (const [param, key] of Object.entries(definition.settingDefaults ?? {})) {
    const fallback = definition.needs ? ctx.settings[definition.needs]?.[key] : undefined;
    if (params[param] === undefined && fallback) params[param] = fallback;
  }

  // Dry runs still do reads, only side effects are skipped.
  if (ctx.dryRun && definition.sideEffect) {
    return {
      kind: "ok",
      output: {
        dryRun: true,
        wouldCall: `${step.app}.${step.action}`,
        withParams: params,
      },
      meta: { suppressed: true },
    };
  }

  const secret = definition.needs ? ctx.secrets[definition.needs] : undefined;
  try {
    return { kind: "ok", output: await definition.run(params, secret) };
  } catch (error) {
    // Flag here since notify swallows its errors and a revoked credential would go unnoticed.
    if (definition.needs) await flagIfCredentialRejected(ctx.agent.userId, definition.needs, error);
    throw error;
  }
}

// A 401/403 shows up on the owner's Connections page.
async function flagIfCredentialRejected(userId: string, app: string, error: unknown): Promise<void> {
  if (!(error instanceof IntegrationError)) return;
  if (error.status !== 401 && error.status !== 403) return;
  await db
    .update(connections)
    .set({ lastErrorAt: new Date(), lastError: error.message })
    .where(and(eq(connections.userId, userId), eq(connections.app, app)))
    .catch(() => {});
}

export const runAction: StepHandler<"action"> = (step, ctx) => perform(step, ctx);

// A failed notification doesn't fail the run.
export const runNotify: StepHandler<"notify"> = async (step, ctx) => {
  try {
    return await perform(step, ctx);
  } catch (error) {
    return {
      kind: "ok",
      output: {
        notified: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
