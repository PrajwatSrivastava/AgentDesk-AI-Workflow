import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { StepRow, type StepVisualState } from "@/components/workspace/StepRow";
import { WorkflowSpec } from "@/core/spec";
import { formatClockTime, formatDuration, recordedStepState } from "@/lib/format";
import { loadRunWithSpec } from "@/lib/run-views";
import { requireUser } from "@/lib/session";
import { toSpecView } from "@/lib/spec-view";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  // null for runs that are missing or belong to another user
  const loaded = await loadRunWithSpec(user.id, id);
  if (!loaded) notFound();
  const { run, spec } = loaded;

  const parsed = WorkflowSpec.safeParse(spec);
  const view = parsed.success ? toSpecView(parsed.data) : null;

  const byStepId = new Map(run.steps.map((step) => [step.stepId, step]));
  const elapsed = run.finishedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : null;

  return (
    <>
      <AppHeader title={run.workflowName} subtitle="Run detail" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <StatusPill status={run.status} />
          {run.dryRun && (
            <span className="text-muted bg-ink/5 rounded-full px-2.5 py-0.5 text-xs">
              Test run
            </span>
          )}
          <Link
            href={`/agents/${run.agentId}`}
            className="text-muted hover:text-ink ml-auto text-xs underline"
          >
            Back to agent
          </Link>
        </div>

        <dl className="bg-surface mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule">
          <Fact label="Started" value={formatClockTime(run.startedAt, user.timeZone)} />
          <Fact label="Duration" value={elapsed === null ? "—" : formatDuration(elapsed)} />
        </dl>

        {(run.errorMessage || run.haltReason) && (
          <p
            className={
              run.errorMessage
                ? "bg-failed-soft text-failed mb-6 rounded-lg px-4 py-3 text-sm whitespace-pre-line"
                : "bg-ink/5 text-muted mb-6 rounded-lg px-4 py-3 text-sm"
            }
          >
            {run.errorMessage ?? run.haltReason}
          </p>
        )}

        {run.pendingApprovalToken && (
          <Link
            href={`/approvals/${run.pendingApprovalToken}`}
            className="bg-waiting-soft text-waiting mb-6 block rounded-lg px-4 py-3 text-sm font-medium hover:underline"
          >
            This run is waiting on you — review and decide →
          </Link>
        )}

        <ol className="bg-surface overflow-hidden rounded-xl border border-rule">
          {(view?.steps ?? run.steps.map(toFallbackView)).map((step, index) => {
            const record = byStepId.get(step.id);
            return (
              <StepRow
                key={step.id}
                index={index}
                state={recordState(record?.status)}
                label={step.label}
                kind={step.kind}
                meta={record ? [formatDuration(record.durationMs)] : undefined}
                details={
                  record
                    ? [
                        { label: "Prompt sent", value: record.promptText, asText: true },
                        { label: "Input", value: record.input },
                        { label: "Output", value: record.output },
                        { label: "Error", value: record.error, asText: true },
                      ]
                    : undefined
                }
              />
            );
          })}
        </ol>

        <p className="text-muted mt-4 text-xs">
          Steps with data are expandable. AI steps show the exact prompt that was
          sent.
        </p>
      </main>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-muted text-[11px]">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function recordState(status?: string): StepVisualState {
  return recordedStepState(status) ?? "pending";
}

/** For runs whose workflow spec no longer parses */
function toFallbackView(step: { stepId: string; type: string }) {
  return { id: step.stepId, type: step.type, label: step.stepId, kind: step.type };
}
