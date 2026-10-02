"use client";

import Link from "next/link";
import type { RunSummary } from "@/lib/run-views";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/cn";
import { formatClockTime } from "@/lib/format";

export function RecentRuns({
  runs,
  selectedWorkflowId,
  timeZone,
}: {
  runs: RunSummary[];
  selectedWorkflowId: string | null;
  timeZone: string;
}) {
  if (runs.length === 0) return null;

  return (
    <div className="bg-surface shrink-0 rounded-xl border border-rule">
      <h3 className="text-muted border-b border-rule px-4 py-2 text-[11px] font-medium">
        Recent runs
      </h3>
      <ul className="max-h-44 overflow-y-auto">
        {runs.map((run) => (
          <li key={run.id} className="border-b border-rule last:border-b-0">
            <Link
              href={`/runs/${run.id}`}
              className={cn(
                "flex items-center gap-3 px-4 py-2 text-xs transition-colors hover:bg-ink/[0.02]",
                run.workflowId === selectedWorkflowId ? "text-ink" : "text-muted",
              )}
            >
              <span className="text-muted w-16 shrink-0 font-mono tabular-nums">
                {formatClockTime(run.startedAt, timeZone)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {run.workflowName}
                {run.dryRun && <span className="text-muted"> · test</span>}
              </span>
              <StatusPill status={run.status} className="shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
