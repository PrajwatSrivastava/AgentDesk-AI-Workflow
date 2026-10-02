// Not in a "use client" file: the server-rendered run inspector calls these too,
// and client module exports can't be called on the server.

import type { StepVisualState } from "@/components/workspace/StepRow";

/** null when there's no record. Dry runs store a suppressed send as "skipped". */
export function recordedStepState(status: string | undefined): StepVisualState | null {
  switch (status) {
    case "succeeded":
    case "failed":
    case "halted":
    case "waiting":
      return status;
    case "skipped":
      return "suppressed";
    default:
      return null;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Explicit zone and format so server and browser output match (hydration).
export function formatClockTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}
