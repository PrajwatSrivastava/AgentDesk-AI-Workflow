"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { RunView } from "@/lib/run-views";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { useArmed } from "@/components/ui/useArmed";
import { cn } from "@/lib/cn";
import { formatDuration, recordedStepState } from "@/lib/format";
import type { RunAllowance } from "@/lib/quota";
import type { SpecView } from "@/lib/spec-view";
import { StepRow, type StepVisualState } from "./StepRow";

export interface PanelActions {
  onSave?: () => void;
  onTestRun?: () => void;
  onRunNow?: () => void;
  onToggleEnabled?: (next: boolean) => void;
  onDiscard?: () => void;
  onDelete?: () => void;
}

export function WorkflowPanel({
  view,
  run,
  enabled = false,
  isDraft = false,
  staggered = false,
  busy,
  setup,
  blocked = { test: false, run: false },
  allowance,
  notice,
  actions,
}: {
  view: SpecView;
  run?: RunView | null;
  enabled?: boolean;
  isDraft?: boolean;
  staggered?: boolean;
  busy?: string | null;
  /** Setup checklist, rendered under the header. */
  setup?: ReactNode;
  /** Run types disabled until setup is done. */
  blocked?: { test: boolean; run: boolean };
  /** Today's runs, counted across all the user's agents. */
  allowance?: RunAllowance;
  /** Why the last press didn't start a run (e.g. daily limit). */
  notice?: string | null;
  actions?: PanelActions;
}) {
  const byStepId = new Map(run?.steps.map((step) => [step.stepId, step]) ?? []);
  const reached = run?.steps.length ?? 0;
  const outOfRuns =
    allowance !== undefined && allowance.limit !== null && allowance.used >= allowance.limit;

  return (
    <div className="bg-surface flex min-h-0 flex-1 flex-col rounded-xl border border-rule">
      <header className="border-b border-rule px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold">{view.name}</h2>
            <p className="text-muted mt-0.5 text-xs">
              Runs {view.triggerLabel}
              {isDraft && " · not saved yet"}
            </p>
          </div>

          {/* Keep the switch next to the pill, otherwise a skill that has run can't be turned on */}
          <div className="flex shrink-0 items-center gap-3">
            {run && <StatusPill status={run.status} />}
            {!isDraft && actions?.onToggleEnabled && (
              <EnabledSwitch
                enabled={enabled}
                busy={busy === "enable"}
                // can still be turned off with setup incomplete
                locked={!enabled && blocked.run}
                onChange={actions.onToggleEnabled}
              />
            )}
          </div>
        </div>

        {run?.dryRun && (
          <p className="text-muted mt-2 text-xs">
            Test run — data was fetched for real, nothing was sent.
          </p>
        )}
      </header>

      {/* Shared scroll area so a tall setup card can't squash the steps or push the footer off */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {setup}

        <ol>
          {view.steps.map((step, index) => {
            const record = byStepId.get(step.id);
            const state = visualState({
              record,
              index,
              reached,
              runStatus: run?.status,
              hasRun: Boolean(run),
            });

            return (
              <StepRow
                key={step.id}
                index={index}
                state={state}
                label={step.label}
                kind={step.kind}
                meta={record ? [formatDuration(record.durationMs)] : undefined}
                staggered={staggered}
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
      </div>

      <footer className="border-t border-rule px-4 py-3">
        {run && (run.errorMessage || run.haltReason) && (
          <p
            className={cn(
              "mb-3 rounded-md px-3 py-2 text-xs leading-relaxed whitespace-pre-line",
              run.errorMessage ? "bg-failed-soft text-failed" : "bg-ink/5 text-muted",
            )}
          >
            {run.errorMessage ?? run.haltReason}
          </p>
        )}

        {!isDraft && blocked.run && (
          <p className="text-muted mb-3 text-xs leading-relaxed">
            {blocked.test
              ? "Finish the setup above to test or run this skill."
              : "Finish the setup above to run this for real. Test run works now: it fetches real data and sends nothing."}
          </p>
        )}

        {!isDraft && (notice || outOfRuns) && (
          <p className="bg-ink/5 text-muted mb-3 rounded-md px-3 py-2 text-xs leading-relaxed">
            {notice ??
              `You've used all ${allowance?.limit} workflow runs for today. Runs start again at midnight.`}
          </p>
        )}

        {run?.pendingApprovalToken && (
          <Link
            href={`/approvals/${run.pendingApprovalToken}`}
            className="bg-waiting-soft text-waiting mb-3 block rounded-md px-3 py-2 text-xs font-medium hover:underline"
          >
            This run is waiting on you — review and decide →
          </Link>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {isDraft ? (
            <>
              <Button variant="primary" onClick={actions?.onSave} disabled={Boolean(busy)}>
                {busy === "save" ? "Saving…" : "Save this skill"}
              </Button>
              <Button variant="ghost" onClick={actions?.onDiscard} disabled={Boolean(busy)}>
                Discard
              </Button>
            </>
          ) : (
            <>
              {actions?.onTestRun && (
                <Button
                  onClick={actions.onTestRun}
                  disabled={Boolean(busy) || blocked.test || outOfRuns}
                >
                  {busy === "test" ? "Testing…" : "Test run"}
                </Button>
              )}
              {actions?.onRunNow && (
                <Button
                  variant="ghost"
                  onClick={actions.onRunNow}
                  disabled={Boolean(busy) || blocked.run || outOfRuns}
                >
                  {busy === "run" ? "Running…" : "Run now"}
                </Button>
              )}
              {actions?.onDelete && (
                <DeleteButton onConfirm={actions.onDelete} busy={busy === "delete"} />
              )}
            </>
          )}

          <span className="text-muted ml-auto flex items-center gap-2 text-[11px] tabular-nums">
            {!isDraft && allowance && (
              <span title="Every workflow run counts, including test runs. Resets at midnight.">
                {allowance.limit === null
                  ? `${allowance.used} runs today · no daily limit`
                  : `${allowance.used} of ${allowance.limit} runs today`}
              </span>
            )}
            {run && (
              <Link href={`/runs/${run.id}`} className="hover:text-ink underline">
                inspect
              </Link>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}

function visualState(params: {
  record?: { status: string };
  index: number;
  reached: number;
  runStatus?: RunView["status"];
  hasRun: boolean;
}): StepVisualState {
  const { record, index, reached, runStatus, hasRun } = params;

  const recorded = recordedStepState(record?.status);
  if (recorded) return recorded;

  // The step after the last recorded one is in flight
  if (hasRun && runStatus === "running" && index === reached) return "running";
  return "pending";
}

function DeleteButton({
  onConfirm,
  busy,
}: {
  onConfirm: () => void;
  busy: boolean;
}) {
  const { armed, arm } = useArmed();

  return (
    <Button
      variant={armed ? "danger" : "ghost"}
      disabled={busy}
      onClick={() => (armed ? onConfirm() : arm())}
    >
      {busy ? "Deleting…" : armed ? "Really delete?" : "Delete"}
    </Button>
  );
}

function EnabledSwitch({
  enabled,
  busy,
  locked,
  onChange,
}: {
  enabled: boolean;
  busy: boolean;
  locked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      // Static label. Screen readers already announce the on/off state.
      aria-label="Run this skill automatically"
      title={locked ? "Finish setup to switch this on" : undefined}
      disabled={busy || locked}
      onClick={() => onChange(!enabled)}
      className="flex shrink-0 items-center gap-2 text-xs font-medium disabled:opacity-50"
    >
      <span className={enabled ? "text-done" : "text-muted"}>
        {enabled ? "On" : "Off"}
      </span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          enabled ? "bg-done" : "bg-ink/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white transition-all",
            enabled ? "left-4.5" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
