"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { clarify, formatClarifications } from "@/compiler/clarify";
import { compile } from "@/compiler/compile";
import { validateSpec } from "@/compiler/validate";
import { runWorkflow } from "@/core/executor";
import { WorkflowSpec } from "@/core/spec";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { findOwnedAgent, findOwnedWorkflow } from "@/lib/access";
import type { ClarifyAnswer, ClarifyCard } from "@/lib/clarify-types";
import { DailyLimitError } from "@/lib/quota";
import { nextRunFrom } from "@/lib/schedule";
import { requireUser } from "@/lib/session";
import { assertSetUp, connectionStates, SetupIncompleteError } from "@/lib/setup";
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

function requestProblem(request: unknown): string | null {
  if (typeof request !== "string" || !request.trim()) return "Describe the job first.";
  if (request.length > MAX_REQUEST_LENGTH) return `Keep the description under ${MAX_REQUEST_LENGTH} characters.`;
  return null;
}

/** First step for every request: the details to confirm before anything is built. */
export async function clarifyRequest(
  agentId: string,
  request: string,
): Promise<{ ok: true; card: ClarifyCard } | { ok: false; message: string }> {
  const user = await requireUser();
  const problem = requestProblem(request);
  if (problem) return { ok: false, message: problem };
  const [agent, states] = await Promise.all([findOwnedAgent(user.id, agentId), connectionStates(user.id)]);
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  const card = await clarify({
    request,
    agentName: agent.name,
    agentRole: agent.role,
    agentVars: agent.vars,
    connected: [...states.keys()],
  });
  return { ok: true, card };
}

export async function compileRequest(
  agentId: string,
  request: string,
  answers: ClarifyAnswer[] = [],
): Promise<CompileOutcome> {
  const user = await requireUser();
  const problem = requestProblem(request);
  if (problem) return { ok: false, message: problem };
  const agent = await findOwnedAgent(user.id, agentId);
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  let result: Awaited<ReturnType<typeof compile>>;
  try {
    result = await compile({
      request,
      agentName: agent.name,
      agentRole: agent.role,
      agentVars: agent.vars,
      clarifications: formatClarifications(answers),
    });
  } catch (error) {
    // Returned, not thrown: Next hides thrown messages in production, and this one (e.g. Gemini's
    // daily limit) is the only explanation the user gets.
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

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

export async function setEnabled(workflowId: string, enabled: boolean): Promise<ActionResult> {
  const user = await requireUser();
  const workflow = await findOwnedWorkflow(user.id, workflowId);
  if (!workflow) return { ok: false, error: "That skill no longer exists." };
  const spec = WorkflowSpec.parse(workflow.spec);

  // Disabling is always allowed, even if a connection was removed since.
  if (enabled) {
    try {
      await assertSetUp(user.id, spec, workflow.agent.vars);
    } catch (error) {
      if (error instanceof SetupIncompleteError) return { ok: false, error: error.message };
      throw error;
    }
  }

  // Make it due now so the first run doesn't wait a full interval.
  const nextRunAt = enabled && spec.trigger.type === "schedule" ? nextRunFrom(new Date(), 0) : null;

  await db
    .update(workflows)
    .set({ enabled: enabled ? 1 : 0, nextRunAt })
    .where(eq(workflows.id, workflow.id));

  revalidatePath(`/agents/${workflow.agentId}`);
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

// runWorkflow checks setup and the daily limit before any step runs (and before any AI call is paid for).
export async function runNow(
  workflowId: string,
  options: { dryRun?: boolean } = {},
): Promise<RunNowResult> {
  const user = await requireUser();
  const workflow = await findOwnedWorkflow(user.id, workflowId);
  if (!workflow) return { ok: false, error: "That skill no longer exists." };

  try {
    const run = await runWorkflow(workflow.id, "manual", { dryRun: options.dryRun });
    revalidatePath(`/runs/${run.id}`);
    return { ok: true, runId: run.id, status: run.status };
  } catch (error) {
    // Return it: Next hides thrown error messages in production.
    if (error instanceof DailyLimitError || error instanceof SetupIncompleteError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
