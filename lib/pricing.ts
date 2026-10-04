// Integer micro-dollars, since cents round most steps to zero.
// tokens × (USD per million tokens) = micro-dollars.

/** The compiler uses reasoning models; summaries use cheaper instruct ones. */
export type ModelTier = "compiler" | "summary";

/** USD per million tokens */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICING: Record<string, Price> = {
  // Nebius Token Factory, from GET /v1/models?verbose=true (2026-10-04). No cache rate is listed,
  // so cached tokens bill as input. Reasoning tokens bill as output.
  "deepseek-ai/DeepSeek-V4-Pro": { input: 1.75, output: 3.5, cacheRead: 1.75 },
  "deepseek-ai/DeepSeek-V4-Flash-0731": { input: 0.14, output: 0.28, cacheRead: 0.14 },
  "Qwen/Qwen3-235B-A22B-Instruct-2507": { input: 0.2, output: 0.6, cacheRead: 0.2 },
  "Qwen/Qwen3-30B-A3B-Instruct-2507": { input: 0.1, output: 0.3, cacheRead: 0.1 },
};

export function costMicros(
  model: string,
  usage: { tokensIn: number; tokensOut: number; cacheReadTokens: number },
): number {
  const price = PRICING[model];
  if (!price) return 0;
  return Math.round(
    usage.tokensIn * price.input +
      usage.cacheReadTokens * price.cacheRead +
      usage.tokensOut * price.output,
  );
}

/** e.g. "$0.0035" */
export function formatMicros(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
