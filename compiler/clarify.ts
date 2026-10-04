import { z } from "zod";
import { capabilitiesForPrompt } from "@/integrations/registry";
import type { ClarifyAnswer, ClarifyCard, ClarifyQuestion } from "@/lib/clarify-types";
import { generateObject } from "@/lib/llm";

// Flat on purpose: it is also the JSON schema the model decodes against.
const Reply = z.object({
  understood: z.string().describe("one sentence restating the job in plain words"),
  delivery: z.enum(["slack", "email", "notion", "app", "unsure"]),
  cadence: z.enum(["manual", "hourly", "twice_daily", "daily", "weekly", "unsure"]),
  approval: z.enum(["never", "always", "when_flagged"]),
  questions: z
    .array(
      z.object({
        id: z.string().describe("short snake_case id"),
        question: z.string(),
        options: z.array(z.string()).describe("2 to 4 short answers the user can pick"),
        suggested: z.number().int().describe("index of the most likely option"),
      }),
    )
    .describe("0 to 3 questions"),
});
type Reply = z.infer<typeof Reply>;

let systemPrompt: string | undefined;
function system(): string {
  systemPrompt ??= `You prepare a plain-English automation request for a workflow builder. Before anything is built, the user confirms a few details, so the builder gets a precise request.

What the builder can do:
${capabilitiesForPrompt()}

Reply with:
- understood: one sentence restating the job in plain words, starting with a verb ("Find...", "Watch...").
- delivery: where the results go if the request says so (slack, email, notion, or app for "just show me"), otherwise your best guess, or unsure.
- cadence: manual for a one-off ("give me", "find me", "what are"), otherwise hourly, twice_daily, daily or weekly as stated or implied, or unsure.
- approval: when_flagged if asking first depends on a condition ("ask me if it's urgent", "check with me when it's negative"), always if the user wants to approve every time, otherwise never.
- questions: 0 to 3 questions about details that change WHAT the user receives, for example the exact topic or scope, open versus closed or upcoming versus past, region or field, how many results to send, or which websites to use. When the request names two or more topics ("X and Y"), ask whether they want news on each topic or only where they overlap; list "Each topic separately" first and make it the suggested one, since overlaps are rare. Each has 2 to 4 short options written as answers the user would pick ("Only ones still accepting applications"), and suggested is the most likely one.

Rules for questions:
- Never ask about delivery, schedule or approval; those are asked separately.
- Never ask about something the request already states.
- Never ask about technical settings such as how many items to fetch or check, formats or models.
- Never offer an option the builder cannot do.
- A clear, specific request needs no questions. Ask only when the answer would change the result.`;
  return systemPrompt;
}

const DELIVERY: Record<Exclude<Reply["delivery"], "unsure">, { label: string; app?: string }> = {
  slack: { label: "Slack", app: "slack" },
  email: { label: "Email", app: "resend" },
  notion: { label: "Notion", app: "notion" },
  app: { label: "Just show me in the app" },
};
const CADENCE: Record<Exclude<Reply["cadence"], "unsure">, string> = {
  manual: "Only when I run it",
  hourly: "Every hour",
  twice_daily: "Twice a day",
  daily: "Every day",
  weekly: "Every week",
};
const APPROVAL: Record<Reply["approval"], string> = {
  never: "No, send it automatically",
  always: "Yes, always ask me first",
  when_flagged: "Only when something looks important",
};

export const FIXED_QUESTIONS = { deliver: "Where should the results go?", cadence: "How often should it run?", approval: "Should it ask you before sending?" };

/**
 * The questions to confirm before compiling: up to 3 about the content, generated from the request,
 * then delivery, schedule and approval, pre-selected with the best guess. Never throws: if the
 * model fails, the fixed questions alone are returned.
 */
export async function clarify(input: {
  request: string;
  agentName: string;
  agentRole: string;
  agentVars: Record<string, string>;
  connected: string[];
}): Promise<ClarifyCard> {
  let reply: Reply | null = null;
  try {
    const vars = Object.entries(input.agentVars).filter(([, value]) => value.trim());
    const result = await generateObject({
      tier: "summary",
      schema: Reply,
      system: system(),
      messages: [
        {
          role: "user",
          content: `Agent: ${input.agentName} — ${input.agentRole}
Agent values: ${vars.length ? vars.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("; ") : "none"}
Connected apps: ${input.connected.length ? input.connected.join(", ") : "none yet"}

Request:
${input.request}`,
        },
      ],
      maxTokens: 1200,
    });
    const parsed = Reply.safeParse(result.object);
    reply = parsed.success ? parsed.data : null;
  } catch {
    reply = null;
  }

  // Generated questions, cleaned: valid ids, 2-4 options, a real suggestion
  const used = new Set(Object.keys(FIXED_QUESTIONS));
  const generated: ClarifyQuestion[] = [];
  for (const question of reply?.questions ?? []) {
    const options = [...new Set(question.options.map((option) => option.trim().slice(0, 80)).filter(Boolean))].slice(0, 4);
    if (options.length < 2 || !question.question.trim()) continue;
    let id = question.id.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "").slice(0, 24) || "detail";
    while (used.has(id)) id = `${id}_${used.size}`;
    used.add(id);
    generated.push({
      id,
      question: question.question.trim().slice(0, 140),
      options,
      suggested: Math.min(Math.max(0, question.suggested), options.length - 1),
    });
    if (generated.length === 3) break;
  }

  // Delivery: connected apps first, then "just show me", then apps still to set up
  const connected = new Set(input.connected);
  const choices = Object.entries(DELIVERY) as [keyof typeof DELIVERY, (typeof DELIVERY)[keyof typeof DELIVERY]][];
  const ordered = [
    ...choices.filter(([, choice]) => choice.app && connected.has(choice.app)),
    ...choices.filter(([, choice]) => !choice.app),
    ...choices.filter(([, choice]) => choice.app && !connected.has(choice.app)),
  ];
  const deliveryLabels = ordered.map(([, choice]) => (choice.app && !connected.has(choice.app) ? `${choice.label} (set up later)` : choice.label));
  const guess = reply?.delivery && reply.delivery !== "unsure" ? reply.delivery : null;
  const deliverySuggested = Math.max(0, guess ? ordered.findIndex(([key]) => key === guess) : 0);

  const cadenceKeys = Object.keys(CADENCE) as (keyof typeof CADENCE)[];
  // Daily when unsure: frequent enough to be useful, light on search quotas
  const cadenceGuess = reply?.cadence && reply.cadence !== "unsure" ? reply.cadence : "daily";

  const questions: ClarifyQuestion[] = [
    ...generated,
    { id: "deliver", question: FIXED_QUESTIONS.deliver, options: deliveryLabels, suggested: deliverySuggested },
    { id: "cadence", question: FIXED_QUESTIONS.cadence, options: cadenceKeys.map((key) => CADENCE[key]), suggested: cadenceKeys.indexOf(cadenceGuess) },
    {
      id: "approval",
      question: FIXED_QUESTIONS.approval,
      options: Object.values(APPROVAL),
      suggested: Object.keys(APPROVAL).indexOf(reply?.approval ?? "never"),
    },
  ];

  return {
    request: input.request,
    understood: reply?.understood.trim().slice(0, 240) || input.request.slice(0, 240),
    questions,
    picks: Object.fromEntries(questions.map((question) => [question.id, question.suggested])),
    status: "open",
  };
}

const oneLine = (value: string, max: number) => value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The approval option picked on the card, or undefined when it wasn't asked or was typed in. */
export function confirmedApproval(clarifications: string[] = []): Reply["approval"] | undefined {
  const prefix = `${FIXED_QUESTIONS.approval} `;
  const answer = clarifications.find((line) => line.startsWith(prefix))?.slice(prefix.length);
  return (Object.keys(APPROVAL) as Reply["approval"][]).find((key) => APPROVAL[key] === answer);
}

/** Confirmed answers as lines for the compiler, from untrusted client input. */
export function formatClarifications(answers: unknown): string[] {
  if (!Array.isArray(answers)) return [];
  return answers
    .slice(0, 8)
    .flatMap((entry: Partial<ClarifyAnswer>) => {
      const question = typeof entry?.question === "string" ? oneLine(entry.question, 140) : "";
      const answer = typeof entry?.answer === "string" ? oneLine(entry.answer, 200) : "";
      return question && answer ? [`${question} ${answer}`] : [];
    });
}
