import { config } from "dotenv";

config({ path: ".env.local" });

const { compile } = await import("@/compiler/compile");
const { FIXTURES: ALL_FIXTURES, checkFixture } = await import("@/compiler/fixtures");
const { formatMicros } = await import("@/lib/pricing");

// Optional name filters (compiles cost money):
//   npm run fixtures -- "top stories"
//   npm run fixtures -- weather lobsters bluesky     any of several
const filters = process.argv.slice(2).map((arg) => arg.toLowerCase());
const FIXTURES =
  filters.length > 0
    ? ALL_FIXTURES.filter((fixture) =>
        filters.some((filter) => fixture.name.toLowerCase().includes(filter)),
      )
    : ALL_FIXTURES;

if (FIXTURES.length === 0) {
  console.error(`No fixture matching ${filters.map((f) => `"${f}"`).join(" or ")}.`);
  process.exit(1);
}
if (filters.length > 0) {
  console.log(`running ${FIXTURES.length} of ${ALL_FIXTURES.length} fixtures\n`);
}

const AGENT = {
  agentName: "Market Researcher",
  agentRole: "Research competitors, trending topics and sentiment",
  agentVars: { watchTerm: "Acme" },
};

interface Outcome {
  name: string;
  failures: string[];
  error?: string;
  costMicros: number;
  cacheReadTokens: number;
  attempts: number;
  model?: string;
}

async function runOne(fixture: (typeof FIXTURES)[number]): Promise<Outcome> {
  try {
    const result = await compile({
      request: fixture.request,
      clarifications: fixture.clarifications,
      ...AGENT,
    });
    const shared = {
      name: fixture.name,
      costMicros: result.usage.costMicros,
      cacheReadTokens: result.usage.cacheReadTokens,
      attempts: result.usage.attempts,
      model: result.usage.model,
    };

    return result.ok
      ? { ...shared, failures: checkFixture(fixture, result.spec) }
      : {
          ...shared,
          failures: result.problems.length ? result.problems : [result.message],
        };
  } catch (error) {
    return {
      name: fixture.name,
      failures: [],
      error: error instanceof Error ? error.message : String(error),
      costMicros: 0,
      cacheReadTokens: 0,
      attempts: 0,
    };
  }
}

// Kept low for the Gemini free tier's requests-per-minute cap.
const CONCURRENCY = 2;

const outcomes: Outcome[] = new Array(FIXTURES.length);

// Run the first one alone to warm the prompt cache
outcomes[0] = await runOne(FIXTURES[0]);

let cursor = 1;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= FIXTURES.length) return;
      outcomes[index] = await runOne(FIXTURES[index]);
    }
  }),
);

let passed = 0;
for (const outcome of outcomes) {
  const ok = !outcome.error && outcome.failures.length === 0;
  if (ok) passed++;

  const mark = ok ? "PASS" : "FAIL";
  const retried = outcome.attempts > 1 ? " (repaired)" : "";
  const servedBy = outcome.model ? `  [${outcome.model}]` : "";
  console.log(`${mark}  ${outcome.name}${retried}${servedBy}`);

  if (outcome.error) console.log(`      error: ${outcome.error}`);
  for (const failure of outcome.failures) console.log(`      - ${failure}`);
}

const totalCost = outcomes.reduce((sum, outcome) => sum + outcome.costMicros, 0);
const totalCacheReads = outcomes.reduce((sum, outcome) => sum + outcome.cacheReadTokens, 0);
const repaired = outcomes.filter((outcome) => outcome.attempts > 1).length;

console.log(`\n${passed}/${FIXTURES.length} passed`);
console.log(`needed a repair attempt: ${repaired}/${FIXTURES.length}`);
console.log(
  `cost: ${formatMicros(totalCost)} total, ${formatMicros(Math.round(totalCost / FIXTURES.length))} per compile`,
);
// Gemini caches implicitly and best-effort, so zero here isn't necessarily a fault.
console.log(`cached prompt tokens read: ${totalCacheReads.toLocaleString()}`);

// Not process.exit(): crashes libuv on Windows after this much network I/O
process.exitCode = passed === FIXTURES.length ? 0 : 1;
