import type { Step, StepType } from "./spec";

export interface AgentContext {
  id: string;
  /** Owner. Decides whose credentials a run loads; not exposed to templates. */
  userId: string;
  name: string;
  role: string;
  /** Available in templates as {{agent.*}}. */
  vars: Record<string, string>;
}

export interface TriggerPayload {
  type: "schedule" | "webhook" | "manual";
  /** Fire time of the last non-failed, non-test run; null before the first. See finish() in executor.ts. */
  lastRunAt: string | null;
  firedAt: string;
  body?: unknown;
}

export interface StepMeta {
  promptText?: string;
  tokensIn?: number;
  tokensOut?: number;
  costMicros?: number;
  /** Set when a dry run suppressed a side effect. */
  suppressed?: boolean;
}

export type StepResult =
  | { kind: "ok"; output: unknown; meta?: StepMeta }
  /** Filter was false; run ends as skipped. */
  | { kind: "halt"; reason: string }
  /** Waiting on approval, resumed later. */
  | { kind: "pause"; approvalToken: string; message: string; shows: string[] };

export interface RunContext {
  runId: string;
  workflowId: string;
  agent: AgentContext;
  trigger: TriggerPayload;
  /** step id -> output */
  steps: Record<string, unknown>;
  dryRun: boolean;
  /** Decrypted secrets by app key. */
  secrets: Record<string, string>;
  /** Non-secret settings by app key, e.g. notion.pageId. */
  settings: Record<string, Record<string, string>>;
  /** Running totals for the per-run token ceiling. */
  usage: { tokensIn: number; tokensOut: number; costMicros: number };
}

export type StepHandler<T extends StepType> = (
  step: Extract<Step, { type: T }>,
  ctx: RunContext,
) => Promise<StepResult>;
