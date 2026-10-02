"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { compile } from "@/compiler/compile";
import { validateSpec } from "@/compiler/validate";
import { runWorkflow } from "@/core/executor";
import { WorkflowSpec } from "@/core/spec";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { findOwnedAgent, findOwnedWorkflow } from "@/lib/access";
import { DailyLimitError } from "@/lib/quota";
import { nextRunFrom } from "@/lib/schedule";
import { requireUser } from "@/lib/session";
import { blockingItems, connectionStates, setupNeeds } from "@/lib/setup";
import { toSpecView, type SpecView } from "@/lib/spec-view";

export interface CompileOutcome {
  ok: boolean;
  spec?: WorkflowSpec;
  /** Labels computed server-side so the preview panel stays a plain client component */
  view?: SpecView;
  message?: string;
  problems?: string[];
}

// Caps the cost of a single compile
const MAX_REQUEST_LENGTH = 2000;

export async function compileRequest(
  agentId: string,
  request: string,
): Promise<CompileOutcome> {
  const user = await requireUser();
  if (typeof request !== "string" || !request.trim()) {
    return { ok: false, message: "Describe the job first." };
  }
  if (request.length > MAX_REQUEST_LENGTH) {
    return { ok: false, message: `Keep the description under ${MAX_REQUEST_LENGTH} characters.` };
  }
  const agent = await findOwnedAgent(user.id, agentId);
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  const result = await compile({
    request,
    agentName: agent.name,
    agentRole: agent.role,
    agentVars: agent.vars,
  });

  if (!result.ok) {
    return { ok: false, message: result.message, problems: result.problems };
  }
  return { ok: true, spec: result.spec, view: toSpecView(result.spec) };
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** The spec comes back from the browser, so it is re-validated with the compiler's rules. */
export async function saveWorkflow(
  agentId: string,
  spec: WorkflowSpec,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const agent = await findOwnedAgent(user.id, agentId);
  if (!agent) return { ok: false, error: "That agent no longer exists." };

  const parsed = WorkflowSpec.safeParse(spec);
  const problems = parsed.success ? validateSpec(parsed.data) : ["the skill is not in a shape this app can run"];
  if (!parsed.success || problems.length > 0) {
    return { ok: false, error: `This skill can't be saved: ${problems.join("; ")}. Describe it again.` };
  }

  const [created] = await db
    .insert(workflows)
    .values({ agentId: agent.id, name: parsed.data.name, spec: parsed.data, enabled: 0 })
    .returning({ id: workflows.id });

  revalidatePath(`/agents/${agent.id}`);
  revalidatePath("/");
  return { ok: true, id: created.id };
}

// null if the workflow isn't the user's. Connection states load in the same round trip.
async function ownWorkflow(workflowId: string) {
  const user = await requireUser();
  const [workflow, states] = await Promise.all([
    findOwnedWorkflow(user.id, workflowId),
    connectionStates(user.id),
  ]);
  if (!workflow) return null;
  return { user, workflow, states, spec: WorkflowSpec.parse(workflow.spec) };
}

type OwnedWorkflow = NonNullable<Awaited<ReturnType<typeof ownWorkflow>>>;

// Server-side version of the check that disables the UI buttons. Otherwise a run could fail
// at its last step (missing Slack webhook, etc.) after already paying for the AI calls.
function setupProblem(owned: OwnedWorkflow, dryRun: boolean): string | null {
  const missing = blockingItems(
    setupNeeds(owned.spec, owned.workflow.agent.vars, owned.states),
    dryRun,
  );
  return missing.length > 0
    ? `Finish setup first: ${missing.map((item) => item.label).join(", ")}`
    : null;
}

export async function setEnabled(workflowId: string, enabled: boolean): Promise<ActionResult> {
  const owned = await ownWorkflow(workflowId);
  if (!owned) return { ok: false, error: "That skill no longer exists." };
  // Disabling is always allowed, even if a connection was removed since.
  const problem = enabled ? setupProblem(owned, false) : null;
  if (problem) return { ok: false, error: problem };

  // Make it due now so the first run doesn't wait a full interval.
  const nextRunAt =
    enabled && owned.spec.trigger.type === "schedule" ? nextRunFrom(new Date(), 0) : null;

  await db
    .update(workflows)
    .set({ enabled: enabled ? 1 : 0, nextRunAt })
    .where(eq(workflows.id, owned.workflow.id));

  revalidatePath(`/agents/${owned.workflow.agentId}`);
  return { ok: true };
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const user = await requireUser();
  const workflow = await findOwnedWorkflow(user.id, workflowId);
  if (!workflow) return;

  await db.delete(workflows).where(eq(workflows.id, workflow.id));
  revalidatePath(`/agents/${workflow.agentId}`);
  revalidatePath("/");
}

export type RunNowResult = { ok: true; runId: string; status: string } | { ok: false; error: string };

export async function runNow(
  workflowId: string,
  options: { dryRun?: boolean } = {},
): Promise<RunNowResult> {
  const owned = await ownWorkflow(workflowId);
  if (!owned) return { ok: false, error: "That skill no longer exists." };
  const problem = setupProblem(owned, Boolean(options.dryRun));
  if (problem) return { ok: false, error: problem };

  try {
    const run = await runWorkflow(owned.workflow.id, "manual", { dryRun: options.dryRun });
    revalidatePath(`/runs/${run.id}`);
    return { ok: true, runId: run.id, status: run.status };
  } catch (error) {
    // Return it: Next hides thrown error messages in production.
    if (error instanceof DailyLimitError) return { ok: false, error: error.message };
    throw error;
  }
}
