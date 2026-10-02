import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { RunStatus, StepType } from "@/core/spec";
import { db } from "@/db";
import { agents, runs, workflows } from "@/db/schema";
import { isUuid } from "./access";

// One query per view, ownership check included, since DB round trips can be slow.
// Dates are ISO strings for the client. Token counts and costs stay on the server.

export interface StepRunView {
  id: string;
  stepId: string;
  type: StepType;
  status: string;
  position: number;
  input: unknown;
  output: unknown;
  error: string | null;
  promptText: string | null;
  durationMs: number;
}

export interface RunView {
  id: string;
  workflowId: string;
  agentId: string;
  workflowName: string;
  status: RunStatus;
  dryRun: boolean;
  errorMessage: string | null;
  haltReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps: StepRunView[];
  /** Set while a human step is waiting */
  pendingApprovalToken: string | null;
}

export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  dryRun: boolean;
  startedAt: string;
}

function findRun(where: SQL, orderBy?: SQL) {
  return db.query.runs.findFirst({
    where,
    orderBy,
    with: {
      workflow: { with: { agent: { columns: { userId: true } } } },
      steps: { orderBy: (step, { asc }) => [asc(step.position)] },
      approvals: {
        where: (approval, { eq: equals }) => equals(approval.status, "pending"),
        columns: { token: true },
        limit: 1,
      },
    },
  });
}

type LoadedRun = NonNullable<Awaited<ReturnType<typeof findRun>>>;

/** null unless this user owns the run */
function toRunView(userId: string, run: LoadedRun | undefined): RunView | null {
  if (!run || run.workflow.agent.userId !== userId) return null;
  return {
    id: run.id,
    workflowId: run.workflowId,
    agentId: run.workflow.agentId,
    workflowName: run.workflow.name,
    status: run.status,
    dryRun: run.dryRun === 1,
    errorMessage: run.errorMessage,
    haltReason: run.haltReason,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    pendingApprovalToken: run.approvals[0]?.token ?? null,
    steps: run.steps.map((step) => ({
      id: step.id,
      stepId: step.stepId,
      type: step.type,
      status: step.status,
      position: step.position,
      input: step.input,
      output: step.output,
      error: step.error,
      promptText: step.promptText,
      durationMs: step.durationMs,
    })),
  };
}

export async function loadRunWithSpec(
  userId: string,
  runId: string,
): Promise<{ run: RunView; spec: unknown } | null> {
  if (!isUuid(runId)) return null;
  const loaded = await findRun(eq(runs.id, runId));
  const run = toRunView(userId, loaded);
  return run && loaded ? { run, spec: loaded.workflow.spec } : null;
}

export async function loadLatestRun(userId: string, workflowId: string): Promise<RunView | null> {
  if (!isUuid(workflowId)) return null;
  return toRunView(userId, await findRun(eq(runs.workflowId, workflowId), desc(runs.startedAt)));
}

/** Subquery finds the first workflow, so this can load in parallel with the agent. */
export async function loadLatestRunOfFirstWorkflow(
  userId: string,
  agentId: string,
): Promise<RunView | null> {
  if (!isUuid(agentId)) return null;
  // Raw SQL with its own alias. Drizzle re-qualifies interpolated columns with the
  // outer alias in relational queries (workflows.agent_id became "runs"."agent_id").
  const first = sql`(select w.id from workflows w where w.agent_id = ${agentId} order by w.created_at asc limit 1)`;
  return toRunView(userId, await findRun(sql`${runs.workflowId} = ${first}`, desc(runs.startedAt)));
}

export async function loadAgentRuns(
  userId: string,
  agentId: string,
  limit = 12,
): Promise<RunSummary[]> {
  if (!isUuid(agentId)) return [];
  const rows = await db
    .select({
      id: runs.id,
      workflowId: runs.workflowId,
      workflowName: workflows.name,
      status: runs.status,
      dryRun: runs.dryRun,
      startedAt: runs.startedAt,
    })
    .from(runs)
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .innerJoin(agents, eq(workflows.agentId, agents.id))
    .where(and(eq(workflows.agentId, agentId), eq(agents.userId, userId)))
    .orderBy(desc(runs.startedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    status: row.status,
    dryRun: row.dryRun === 1,
    startedAt: row.startedAt.toISOString(),
  }));
}
