import type { ClarifyCard, ClarifyQuestion } from "./clarify-types";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** Compiler complaints, shown when a request could not be built. */
  problems?: string[];
  /** Questions to confirm before the request is built */
  clarify?: ClarifyCard;
}

// Older messages are dropped so localStorage stays small
const MAX_MESSAGES = 60;

export function newMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Open cards become superseded once the user sends something new. */
export function supersedeOpen(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.clarify?.status === "open"
      ? { ...message, clarify: { ...message.clarify, status: "superseded" } }
      : message,
  );
}

const isString = (value: unknown): value is string => typeof value === "string";

function readQuestion(raw: unknown): ClarifyQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, question, options, suggested } = raw as Record<string, unknown>;
  if (!isString(id) || !isString(question) || !Array.isArray(options) || !options.every(isString)) return null;
  if (options.length === 0 || !Number.isInteger(suggested)) return null;
  return { id, question, options, suggested: Math.min(Math.max(0, suggested as number), options.length - 1) };
}

function readCard(raw: unknown): ClarifyCard | null {
  if (!raw || typeof raw !== "object") return null;
  const { request, understood, questions, picks, status } = raw as Record<string, unknown>;
  if (!isString(request) || !isString(understood) || !Array.isArray(questions)) return null;
  if (status !== "open" && status !== "answered" && status !== "superseded") return null;

  const read = questions.map(readQuestion);
  if (read.some((question) => question === null)) return null;
  const valid = read as ClarifyQuestion[];
  const savedPicks = picks && typeof picks === "object" ? (picks as Record<string, unknown>) : {};

  // A pick must point at a real option, or be the user's own text
  const cleanPicks = Object.fromEntries(
    valid.map((question) => {
      const pick = savedPicks[question.id];
      const ok =
        (Number.isInteger(pick) && (pick as number) >= 0 && (pick as number) < question.options.length) ||
        (isString(pick) && pick.length <= 200);
      return [question.id, ok ? (pick as number | string) : question.suggested];
    }),
  );
  return { request, understood, questions: valid, picks: cleanPicks, status };
}

/**
 * Chat restored from localStorage, which may be from an older version or edited by hand.
 * Bad entries are dropped, ids filled in, and a card whose build was cut off by a reload
 * is opened again.
 */
export function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];

  for (const entry of raw.slice(-MAX_MESSAGES)) {
    if (!entry || typeof entry !== "object") continue;
    const { id, role, text, problems, clarify } = entry as Record<string, unknown>;
    if ((role !== "user" && role !== "agent") || !isString(text)) continue;

    const message: ChatMessage = { id: isString(id) && !seen.has(id) ? id : newMessageId(), role, text };
    if (Array.isArray(problems)) message.problems = problems.filter(isString);
    if (clarify !== undefined) {
      const card = readCard(clarify);
      if (!card) continue;
      message.clarify = card;
    }
    seen.add(message.id);
    messages.push(message);
  }

  return messages.map((message, index) => {
    const card = message.clarify;
    if (!card) return message;
    const later = messages.slice(index + 1);
    // A newer request replaced it
    if (card.status === "open" && later.some((next) => next.role === "user")) {
      return { ...message, clarify: { ...card, status: "superseded" } };
    }
    // Answered, but the reply never arrived
    if (card.status === "answered" && later.length === 0) {
      return { ...message, clarify: { ...card, status: "open" } };
    }
    return message;
  });
}
