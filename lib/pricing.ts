// Integer micro-dollars, since cents round most steps to zero.
// tokens × (USD per million tokens) = micro-dollars.

/** The compiler uses thinking models; summaries use cheaper lite ones. */
export type ModelTier = "compiler" | "summary";

/** USD per million tokens */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICING: Record<string, Price> = {
  // Paid-tier rates from ai.google.dev/gemini-api/docs/pricing (2026-10-01).
  // Free-tier keys aren't billed. Thinking tokens bill as output.
  // 3.6-flash promo ends 2026-12-31, then $1.50 / $7.50 / $0.15.
  "gemini-3.6-flash": { input: 0.75, output: 3.75, cacheRead: 0.075 },
  "gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15 },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cacheRead: 0.05 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.025 },
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
