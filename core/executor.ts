import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvals,
  connections,
  runs,
  stepRuns,
  workflows,
  type Agent,
  type Run,
} from "@/db/schema";
import { IntegrationError } from "@/integrations/http";
import { findAction } from "@/integrations/registry";
import { decryptSecret } from "@/lib/crypto";
import { claimDailyRun, DailyLimitError, dailyLimitFor } from "@/lib/quota";
import { evaluate } from "./conditions";
import { editTarget, resolveParams, resolveString, setPath } from "./resolve";
import { WorkflowSpec, type RunStatus, type Step } from "./spec";
import { requestApproval } from "./approvals";
import { runStep } from "./steps";
import type { AgentContext, RunContext, TriggerPayload } from "./types";

// Walks a stored spec in order. Resuming after approval re-enters the same loop at a later index.

interface WalkParams {
  run: Run;
  spec: WorkflowSpec;
  agent: AgentContext;
  trigger: TriggerPayload;
  startIndex: number;
  /** Outputs of steps that already ran, keyed by step id. */
  seedSteps: Record<string, unknown>;
  dryRun: boolean;
}

// Catches what walkSteps doesn't (e.g. a DB error while recording a step) so a run never stays stuck as "running".
async function walk(params: WalkParams): Promise<Run> {
  try {
    return await walkSteps(params);
  } catch (error) {
    await db
      .update(runs)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: formatError(error) })
      .where(and(eq(runs.id, params.run.id), inArray(runs.status, ["queued", "running"])))
      .catch(() => {});
    throw error;
  }
}

async function walkSteps(params: WalkParams): Promise<Run> {
  const { run, spec, agent, trigger, startIndex, seedSteps, dryRun } = params;

  const [{ secrets, settings }] = await Promise.all([
    loadConnections(agent.userId, spec),
    db.update(runs).set({ status: "running" }).where(eq(runs.id, run.id)),
  ]);
  const ctx: RunContext = {
    runId: run.id,
    workflowId: run.workflowId,
    agent,
    trigger,
    steps: { ...seedSteps },
    dryRun,
    secrets,
    settings,
    usage: { tokensIn: run.tokensIn, tokensOut: run.tokensOut, costMicros: run.costMicros },
  };

  for (let position = startIndex; position < spec.steps.length; position++) {
    const step = spec.steps[position];
    const startedAt = Date.now();
    const input = describeInput(step, ctx);

    try {
      const result = await runStep(step, ctx);
      const durationMs = Date.now() - startedAt;

      if (result.kind === "halt") {
        await recordStep({ run, step, position, status: "halted", input, durationMs, output: { halted: true, reason: result.reason } });
        // Usage is saved on every exit path so tokens already spent aren't lost.
        return finish(run, "skipped", { haltReason: result.reason, usage: ctx.usage });
      }

      if (result.kind === "pause") {
        await recordStep({ run, step, position, status: "waiting", input, durationMs, output: { awaitingApproval: true, message: result.message } });
        await requestApproval({
          runId: run.id,
          stepId: step.id,
          token: result.approvalToken,
          message: result.message,
          shows: result.shows,
          secrets: ctx.secrets,
          dryRun,
        });
        // Resume reloads the run row, so usage has to be saved before pausing.
        return finish(run, "waiting", { usage: ctx.usage });
      }

      ctx.steps[step.id] = result.output;
      ctx.usage.tokensIn += result.meta?.tokensIn ?? 0;
      ctx.usage.tokensOut += result.meta?.tokensOut ?? 0;
      ctx.usage.costMicros += result.meta?.costMicros ?? 0;

      await recordStep({
        run,
        step,
        position,
        status: result.meta?.suppressed ? "skipped" : "succeeded",
        input,
        durationMs,
        output: result.output,
        promptText: result.meta?.promptText,
        tokensIn: result.meta?.tokensIn,
        tokensOut: result.meta?.tokensOut,
        costMicros: result.meta?.costMicros,
      });
    } catch (error) {
      // Includes the integration hint, since this is the message the run panel shows.
      const message = formatError(error);
      await recordStep({
        run,
        step,
        position,
        status: "failed",
        input,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return finish(run, "failed", { errorMessage: message, usage: ctx.usage });
    }
  }

  return finish(run, "succeeded", { usage: ctx.usage });
}

export interface StartOptions {
  dryRun?: boolean;
}

export async function runWorkflow(
  workflowId: string,
  triggerType: TriggerPayload["type"],
  options: StartOptions = {},
  body?: unknown,
): Promise<Run> {
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
    with: { agent: { with: { user: true } } },
  });
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  // Validate on read in case the stored spec came from an older build.
  const spec = WorkflowSpec.parse(workflow.spec);

  // Quota check lives here because every trigger type goes through runWorkflow.
  const owner = workflow.agent.user;
  if (!(await claimDailyRun(owner.id, owner.timeZone, dailyLimitFor(owner)))) {
    throw new DailyLimitError();
  }

  const trigger: TriggerPayload = {
    type: triggerType,
    lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
    firedAt: new Date().toISOString(),
    body,
  };

  const [run] = await db
    .insert(runs)
    .values({
      workflowId,
      status: "queued",
      trigger,
      dryRun: options.dryRun ? 1 : 0,
    })
    .returning();

  return walk({
    run,
    spec,
    agent: toAgentContext(workflow.agent),
    trigger,
    startIndex: 0,
    seedSteps: {},
    dryRun: Boolean(options.dryRun),
  });
}

/** Continues a waiting run from the step after the approved one, seeding earlier outputs from step rows. */
export async function resumeRun(runId: string): Promise<Run> {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: { workflow: { with: { agent: true } } },
  });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "waiting") {
    throw new Error(`Run is ${run.status}, so there is nothing to resume`);
  }

  // Oldest first, so the last entry is the decision just made (runs can have several approval steps).
  const approved = await db.query.approvals.findMany({
    where: and(eq(approvals.runId, runId), eq(approvals.status, "approved")),
    orderBy: asc(approvals.decidedAt),
  });
  const latest = approved.at(-1);
  if (!latest) throw new Error("This run has no approved decision to resume from");

  const spec = WorkflowSpec.parse(run.workflow.spec);
  const pausedIndex = spec.steps.findIndex((step) => step.id === latest.stepId);
  if (pausedIndex === -1) {
    throw new Error(`Step ${latest.stepId} is no longer part of this workflow`);
  }

  // Conditional update, so only one of two concurrent resumes continues.
  const [claimed] = await db
    .update(runs)
    .set({ status: "running" })
    .where(and(eq(runs.id, runId), eq(runs.status, "waiting")))
    .returning({ id: runs.id });
  if (!claimed) throw new Error("This run has already been resumed");

  const completed = await db.query.stepRuns.findMany({
    where: eq(stepRuns.runId, runId),
    orderBy: asc(stepRuns.position),
  });

  const seedSteps: Record<string, unknown> = {};
  for (const record of completed) {
    if (record.status === "succeeded") seedSteps[record.stepId] = record.output;
  }

  // Approver edits are written to the field they were shown (e.g. brief.summary) since later steps read that.
  // Replay all of them in order; step rows only hold the original output.
  for (const approval of approved) {
    seedSteps[approval.stepId] = { approved: true };
    const edit = approval.editedOutput as { value?: unknown } | null;
    const step = spec.steps.find((candidate) => candidate.id === approval.stepId);
    const target = step?.type === "human" ? editTarget(step) : null;
    if (edit?.value !== undefined && target) setPath(seedSteps, target, edit.value);
  }

  return walk({
    run,
    spec,
    agent: toAgentContext(run.workflow.agent),
    trigger: run.trigger as TriggerPayload,
    startIndex: pausedIndex + 1,
    seedSteps,
    dryRun: run.dryRun === 1,
  });
}

interface FinishExtras {
  haltReason?: string;
  errorMessage?: string;
  usage?: { tokensIn: number; tokensOut: number; costMicros: number };
}

async function finish(run: Run, status: RunStatus, extras: FinishExtras = {}): Promise<Run> {
  const [updated] = await db
    .update(runs)
    .set({
      status,
      finishedAt: status === "waiting" ? null : new Date(),
      haltReason: extras.haltReason,
      errorMessage: extras.errorMessage,
      tokensIn: extras.usage?.tokensIn ?? run.tokensIn,
      tokensOut: extras.usage?.tokensOut ?? run.tokensOut,
      costMicros: extras.usage?.costMicros ?? run.costMicros,
    })
    .where(eq(runs.id, run.id))
    .returning();

  // lastRunAt moves to when this run fired (so nothing published mid-run is missed), never backwards.
  // Paused runs count so the next pass doesn't refetch the same items; failed and test runs don't.
  const completedPass = status === "succeeded" || status === "skipped" || status === "waiting";
  if (completedPass && run.dryRun !== 1) {
    const firedAt = (run.trigger as Partial<TriggerPayload>).firedAt ?? new Date().toISOString();
    await db
      .update(workflows)
      .set({
        lastRunAt: sql`GREATEST(COALESCE(${workflows.lastRunAt}, ${firedAt}::timestamptz), ${firedAt}::timestamptz)`,
      })
      .where(eq(workflows.id, run.workflowId));
  }

  return updated;
}

interface RecordStepParams {
  run: Run;
  step: Step;
  position: number;
  status: "succeeded" | "failed" | "halted" | "waiting" | "skipped";
  input: unknown;
  durationMs: number;
  output?: unknown;
  error?: string;
  promptText?: string;
  tokensIn?: number;
  tokensOut?: number;
  costMicros?: number;
}

async function recordStep(params: RecordStepParams): Promise<void> {
  await db.insert(stepRuns).values({
    runId: params.run.id,
    stepId: params.step.id,
    type: params.step.type,
    status: params.status,
    position: params.position,
    input: params.input ?? null,
    output: params.output ?? null,
    error: params.error,
    promptText: params.promptText,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    costMicros: params.costMicros,
    durationMs: params.durationMs,
  });
}

// Pure, so it can be recorded on failure too, where the resolved params are most useful.
function describeInput(step: Step, ctx: RunContext): unknown {
  switch (step.type) {
    case "action":
    case "notify":
      return { call: `${step.app}.${step.action}`, params: resolveParams(step.params, ctx) };
    case "ai":
      return { model: "summary", outputSchema: step.outputSchema };
    case "filter":
      return evaluate(step.condition, ctx).detail;
    case "human":
      return {
        message: resolveString(step.message, ctx),
        when: step.when ? evaluate(step.when, ctx).detail : null,
      };
  }
}

function toAgentContext(agent: Agent): AgentContext {
  return {
    id: agent.id,
    userId: agent.userId,
    name: agent.name,
    role: agent.role,
    vars: agent.vars,
  };
}

function formatError(error: unknown): string {
  if (error instanceof IntegrationError) {
    return error.hint ? `${error.message}\n\n${error.hint}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

// Secrets are decrypted against the owner's id, so another user's ciphertext wouldn't open here.
async function loadConnections(
  userId: string,
  spec: WorkflowSpec,
): Promise<{ secrets: Record<string, string>; settings: Record<string, Record<string, string>> }> {
  const needed = new Set<string>();
  for (const step of spec.steps) {
    if (step.type !== "action" && step.type !== "notify") continue;
    const definition = findAction(step.app, step.action);
    if (definition?.needs) needed.add(definition.needs);
  }
  // Approval notifications go out over Slack.
  needed.add("slack");

  const rows = await db.query.connections.findMany({ where: eq(connections.userId, userId) });
  const secrets: Record<string, string> = {};
  const settings: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    if (!needed.has(row.app)) continue;
    settings[row.app] = row.settings;
    try {
      secrets[row.app] = decryptSecret({ userId, app: row.app }, row.secret);
    } catch {
      // Can't decrypt (rotated key etc.): treat as not connected and let the action report it.
    }
  }
  return { secrets, settings };
}

