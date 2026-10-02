import type { z } from "zod";
import type { ModelTier } from "@/lib/pricing";

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  costMicros: number;
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ObjectRequest {
  tier: ModelTier;
  schema: z.ZodType;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
}

export interface ObjectResult {
  /** null when the reply was missing or not JSON */
  object: unknown;
  /** Model that answered. Can differ from the first choice when falling back. */
  model?: string;
  usage: LlmUsage;
  /** Kept as history for a repair turn */
  raw: string;
}

export const EMPTY_USAGE: LlmUsage = {
  tokensIn: 0,
  tokensOut: 0,
  cacheReadTokens: 0,
  costMicros: 0,
};

export function addUsage(into: LlmUsage, add: LlmUsage): void {
  into.tokensIn += add.tokensIn;
  into.tokensOut += add.tokensOut;
  into.cacheReadTokens += add.cacheReadTokens;
  into.costMicros += add.costMicros;
}
