"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decide, DecisionError } from "@/core/approvals";
import { resumeRun } from "@/core/executor";
import { editTarget } from "@/core/resolve";
import { WorkflowSpec } from "@/core/spec";
import { db } from "@/db";
import { approvals } from "@/db/schema";

const Decision = z.enum(["approved", "rejected"]);

export type DecisionResult = { ok: true; runId: string; status: string } | { ok: false; error: string };

// No login required: the token is the credential. Edits are only accepted
// where the approval page actually offers an edit field.
export async function decideApproval(
  token: string,
  decision: string,
  editedOutput?: { value: string },
): Promise<DecisionResult> {
  const parsed = Decision.safeParse(decision);
  if (!parsed.success) return { ok: false, error: "Choose approve or reject." };

  let edit: { value: string } | undefined;
  if (parsed.data === "approved" && typeof editedOutput?.value === "string") {
    edit = (await editable(token)) ? { value: editedOutput.value } : undefined;
  }

  let runId: string;
  try {
    ({ runId } = await decide(token, parsed.data, edit));
  } catch (error) {
    // Returned, not thrown: Next hides thrown messages in production.
    if (error instanceof DecisionError) return { ok: false, error: error.message };
    throw error;
  }

  revalidatePath(`/approvals/${token}`);
  revalidatePath(`/runs/${runId}`);
  if (parsed.data === "rejected") return { ok: true, runId, status: "skipped" };

  const run = await resumeRun(runId);
  return { ok: true, runId, status: run.status };
}

async function editable(token: string): Promise<boolean> {
  const approval = await db.query.approvals.findFirst({
    where: eq(approvals.token, token),
    columns: { stepId: true },
    with: { run: { columns: {}, with: { workflow: { columns: { spec: true } } } } },
  });
  const spec = approval ? WorkflowSpec.safeParse(approval.run.workflow.spec) : null;
  const step = spec?.success ? spec.data.steps.find((s) => s.id === approval?.stepId) : undefined;
  return step?.type === "human" && editTarget(step) !== null;
}
