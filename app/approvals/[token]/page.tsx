import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ApprovalForm } from "@/components/ApprovalForm";
import { StatusPill } from "@/components/ui/StatusPill";
import { editTarget } from "@/core/resolve";
import { WorkflowSpec } from "@/core/spec";
import { db } from "@/db";
import { approvals } from "@/db/schema";
import { formatClockTime } from "@/lib/format";

// No session needed: the token (32 random bytes) is the credential.
export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const approval = await db.query.approvals.findFirst({
    where: eq(approvals.token, token),
    with: {
      run: {
        with: {
          workflow: {
            // Owner's time zone for "Decided at", since the viewer may not be signed in
            with: { agent: { columns: {}, with: { user: { columns: { timeZone: true } } } } },
          },
        },
      },
    },
  });
  if (!approval) notFound();

  const decided = approval.status !== "pending";
  // Same rule decideApproval applies on the server
  const spec = WorkflowSpec.safeParse(approval.run.workflow.spec);
  const step = spec.success ? spec.data.steps.find((s) => s.id === approval.stepId) : undefined;
  const editable = step?.type === "human" && editTarget(step) !== null;

  return (
    <>
      <AppHeader title={approval.run.workflow.name} subtitle="Approval" />

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
        <div className="mb-5 flex items-center gap-3">
          <StatusPill status={approval.run.status} />
          <Link
            href={`/runs/${approval.runId}`}
            className="text-muted hover:text-ink ml-auto text-xs underline"
          >
            See the full run
          </Link>
        </div>

        <h1 className="text-xl font-semibold text-balance">{approval.message}</h1>

        <div className="mt-6">
          {decided ? (
            <div className="bg-paper rounded-lg border border-rule p-5">
              <p className="text-sm font-medium">
                Already {approval.status === "approved" ? "approved" : "rejected"}
              </p>
              <p className="text-muted mt-1 text-xs">
                {approval.decidedAt
                  ? `Decided at ${formatClockTime(approval.decidedAt.toISOString(), approval.run.workflow.agent.user.timeZone)}.`
                  : ""}{" "}
                {approval.status === "approved"
                  ? "The run continued from the next step."
                  : "The run was stopped and recorded as skipped."}
              </p>
              <Link
                href={`/runs/${approval.runId}`}
                className="text-accent mt-4 inline-block text-sm hover:underline"
              >
                View what happened →
              </Link>
            </div>
          ) : (
            <ApprovalForm
              token={token}
              context={approval.context}
              editable={editable}
            />
          )}
        </div>
      </main>
    </>
  );
}
