import { config } from "dotenv";

config({ path: ".env.local" });

const { clarify } = await import("@/compiler/clarify");
const { answersFor } = await import("@/lib/clarify-types");

// Checks the clarify step's guesses. Each case costs one summary-tier call.
//   npm run clarify

interface Case {
  request: string;
  /** Expected pre-selected answers, by question id. Matched on the start of the label. */
  picks: Partial<Record<"deliver" | "cadence" | "approval", string>>;
  /** Range for the number of generated (non-fixed) questions */
  questions: [min: number, max: number];
  /** Some generated question or its options must match */
  asks?: RegExp;
  /** ...and that question's pre-selected option must match */
  suggests?: RegExp;
}

const CASES: Case[] = [
  {
    request: "Give me 5 fellowship deadlines related to AI safety.",
    picks: { cadence: "Only when I run it" },
    // Open or closed, which kind, which region: worth asking
    questions: [1, 3],
  },
  {
    request:
      "Every hour, check Hacker News for mentions of Linear and send me anything important on Slack. Ask me before posting if it's urgent.",
    picks: { deliver: "Slack", cadence: "Every hour", approval: "Only when something looks important" },
    questions: [0, 1],
  },
  {
    request: "Each morning, read https://vercel.com/atom and email me a summary at me@example.com.",
    picks: { deliver: "Email", cadence: "Every day", approval: "No" },
    questions: [0, 1],
  },
  {
    // Two topics: each one, or only where they meet?
    request: "AI security news on AI failures and climate disasters",
    picks: {},
    questions: [1, 3],
    asks: /overlap|both|each|separate|together/i,
    suggests: /each|separate/i,
  },
  {
    request: "Every week, post the top Lobsters stories tagged rust to Slack. Always ask me first.",
    picks: { deliver: "Slack", cadence: "Every week", approval: "Yes" },
    questions: [0, 1],
  },
];

const AGENT = {
  agentName: "Market Researcher",
  agentRole: "Research competitors, trending topics and sentiment",
  agentVars: { watchTerm: "Acme" },
  connected: ["slack"],
};

let passed = 0;
for (const testCase of CASES) {
  const card = await clarify({ request: testCase.request, ...AGENT });
  const failures: string[] = [];

  for (const [id, expected] of Object.entries(testCase.picks)) {
    const question = card.questions.find((entry) => entry.id === id);
    const pick = card.picks[id];
    const label = question && typeof pick === "number" ? question.options[pick] : String(pick);
    if (!label.startsWith(expected)) failures.push(`${id}: picked "${label}", expected "${expected}…"`);
  }

  const generated = card.questions.filter((question) => !["deliver", "cadence", "approval"].includes(question.id));
  const [min, max] = testCase.questions;
  if (generated.length < min || generated.length > max) {
    failures.push(`${generated.length} generated questions, expected ${min} to ${max}`);
  }
  const asked = testCase.asks ? generated.find((q) => testCase.asks!.test([q.question, ...q.options].join(" "))) : undefined;
  if (testCase.asks && !asked) failures.push(`no question matching ${testCase.asks}`);
  if (asked && testCase.suggests) {
    const pick = card.picks[asked.id];
    const label = typeof pick === "number" ? asked.options[pick] : String(pick);
    if (!testCase.suggests.test(label)) failures.push(`pre-selected "${label}", expected ${testCase.suggests}`);
  }

  if (failures.length === 0) passed++;
  console.log(`${failures.length === 0 ? "PASS" : "FAIL"}  ${testCase.request.slice(0, 70)}`);
  console.log(`      understood: ${card.understood}`);
  for (const question of generated) {
    console.log(`      ? ${question.question}  [${question.options.join(" | ")}]`);
  }
  for (const answer of answersFor(card)) console.log(`      = ${answer.question} ${answer.answer}`);
  for (const failure of failures) console.log(`      - ${failure}`);
}

console.log(`\n${passed}/${CASES.length} passed`);
process.exitCode = passed === CASES.length ? 0 : 1;
