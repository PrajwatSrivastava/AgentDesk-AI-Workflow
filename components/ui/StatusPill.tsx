import type { RunStatus } from "@/core/spec";
import { cn } from "@/lib/cn";

// Amber is reserved for "waiting on a person". Don't reuse it elsewhere.
const STYLES: Record<RunStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-ink/5 text-muted" },
  running: { label: "Running", className: "bg-accent-soft text-accent" },
  waiting: { label: "Needs you", className: "bg-waiting-soft text-waiting" },
  succeeded: { label: "Succeeded", className: "bg-done-soft text-done" },
  skipped: { label: "Nothing to do", className: "bg-ink/5 text-muted" },
  failed: { label: "Failed", className: "bg-failed-soft text-failed" },
};

export function StatusPill({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const style = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
