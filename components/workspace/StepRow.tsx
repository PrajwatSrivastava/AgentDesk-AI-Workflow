"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export type StepVisualState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "halted"
  | "waiting"
  | "suppressed";

const GLYPH: Record<StepVisualState, { mark: string; className: string }> = {
  pending: { mark: "○", className: "text-muted/50" },
  running: { mark: "◐", className: "text-accent" },
  succeeded: { mark: "✓", className: "text-done" },
  failed: { mark: "✕", className: "text-failed" },
  halted: { mark: "–", className: "text-muted" },
  waiting: { mark: "◐", className: "text-waiting" },
  suppressed: { mark: "✓", className: "text-muted" },
};

export interface StepRowDetail {
  label: string;
  value: unknown;
  /** Show the raw string, not JSON. */
  asText?: boolean;
}

export function StepRow({
  index,
  state,
  label,
  kind,
  meta,
  details,
  staggered,
}: {
  index: number;
  state: StepVisualState;
  label: string;
  kind: string;
  /** Right-aligned facts, such as how long the step took. */
  meta?: string[];
  details?: StepRowDetail[];
  staggered?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const glyph = GLYPH[state];
  const expandable = Boolean(details?.some((detail) => detail.value != null));

  return (
    <li
      className={cn("border-b border-rule last:border-b-0", staggered && "step-in")}
      style={staggered ? ({ "--i": index } as React.CSSProperties) : undefined}
    >
      <div
        className={cn(
          "flex items-start gap-3 px-4 py-3",
          expandable && "cursor-pointer hover:bg-ink/[0.02]",
        )}
        onClick={expandable ? () => setOpen((value) => !value) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onKeyDown={
          expandable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpen((value) => !value);
                }
              }
            : undefined
        }
      >
        <span className="text-muted w-4 shrink-0 pt-px font-mono text-xs tabular-nums">
          {index + 1}
        </span>
        <span className={cn("w-4 shrink-0 text-center text-sm", glyph.className)}>
          {glyph.mark}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug">{label}</span>
          <span className="text-muted mt-0.5 block text-[11px]">
            {kind}
            {state === "suppressed" && " · suppressed in test run"}
          </span>
        </span>

        {meta && meta.length > 0 && (
          <span className="text-muted shrink-0 pt-px font-mono text-[11px] tabular-nums">
            {meta.join(" · ")}
          </span>
        )}
      </div>

      {open && details && (
        <div className="border-t border-rule bg-paper px-4 py-3">
          {details
            .filter((detail) => detail.value != null)
            .map((detail) => (
              <div key={detail.label} className="mb-3 last:mb-0">
                <p className="text-muted mb-1 text-[11px] font-medium">
                  {detail.label}
                </p>
                <pre className="bg-surface text-ink max-h-64 overflow-auto rounded-md border border-rule p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {detail.asText
                    ? String(detail.value)
                    : JSON.stringify(detail.value, null, 2)}
                </pre>
              </div>
            ))}
        </div>
      )}
    </li>
  );
}

