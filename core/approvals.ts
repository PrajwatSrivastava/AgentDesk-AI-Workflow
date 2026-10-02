import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvals, runs, stepRuns } from "@/db/schema";
import { findAction } from "@/integrations/registry";
import { env } from "@/lib/env";

interface RequestApprovalParams {
  runId: string;
  stepId: string;
  token: string;
  message: string;
  shows: string[];
  secrets: Record<string, string>;
  /** Test runs still pause but don't post to Slack. */
  dryRun: boolean;
}

export async function requestApproval(params: RequestApprovalParams): Promise<void> {
  await db.insert(approvals).values({
    runId: params.runId,
    stepId: params.stepId,
    token: params.token,
    message: params.message,
    context: params.shows,
  });

  const webhook = params.secrets.slack;
  if (!webhook || params.dryRun) return;

  const link = `${env.appUrl}/approvals/${params.token}`;
  const context = params.shows.filter(Boolean).join("\n\n");

  // Escape fetched text so things like "<!channel>" or "<url|label>" can't ping people or add links.
  const text = [
    `*Needs your approval*`,
    escapeSlack(params.message),
    context ? `\n${escapeSlack(truncate(context, 1500))}` : "",
    `\n<${link}|Review and decide>`,
  ]
    .filter(Boolean)
    .join("\n");

  const postMessage = findAction("slack", "post_message");
  try {
    await postMessage?.run({ text }, webhook);
  } catch {
    // Not fatal: the approval row exists and the page works without the Slack message.
  }
}

export type Decision = "approved" | "rejected";

/** Message is safe to show to the user. */
export class DecisionError extends Error {}

// Returns the run id for the caller to resume. Check and write are one statement so concurrent decisions can't both land.
export async function decide(
  token: string,
  decision: Decision,
  editedOutput?: unknown,
): Promise<{ runId: string }> {
  const [approval] = await db
    .update(approvals)
    .set({ status: decision, decidedAt: new Date(), editedOutput: editedOutput ?? null })
    .where(and(eq(approvals.token, token), eq(approvals.status, "pending")))
    .returning();

  if (!approval) {
    const existing = await db.query.approvals.findFirst({
      where: eq(approvals.token, token),
      columns: { status: true },
    });
    throw new DecisionError(
      existing ? `This was already ${existing.status}` : "That approval link is not valid",
    );
  }

  const approved = decision === "approved";
  await db
    .update(stepRuns)
    .set(
      approved
        ? { status: "succeeded", output: { approved: true, message: approval.message } }
        : {
            status: "halted",
            output: { approved: false, message: approval.message, reason: "Rejected by the operator" },
          },
    )
    .where(
      and(
        eq(stepRuns.runId, approval.runId),
        eq(stepRuns.stepId, approval.stepId),
        eq(stepRuns.status, "waiting"),
      ),
    );

  if (!approved) {
    await db
      .update(runs)
      .set({ status: "skipped", finishedAt: new Date(), haltReason: "Rejected by the operator" })
      .where(and(eq(runs.id, approval.runId), eq(runs.status, "waiting")));
  }

  return { runId: approval.runId };
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

// Slack only treats &, < and > specially
function escapeSlack(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
