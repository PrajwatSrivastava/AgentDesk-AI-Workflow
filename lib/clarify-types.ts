// Shared by the server action and the chat UI, so no server imports here.

export interface ClarifyQuestion {
  id: string;
  question: string;
  options: string[];
  /** Index of the pre-selected option */
  suggested: number;
}

export interface ClarifyCard {
  /** The request as the user typed it */
  request: string;
  /** One-line restatement, shown above the questions */
  understood: string;
  questions: ClarifyQuestion[];
  /** Question id -> chosen option index, or the user's own text for "Other" */
  picks: Record<string, number | string>;
  status: "open" | "answered" | "superseded";
}

export interface ClarifyAnswer {
  question: string;
  answer: string;
}

/** The answers a card's picks stand for; an empty "Other" is left out. */
export function answersFor(card: ClarifyCard): ClarifyAnswer[] {
  return card.questions.flatMap((question) => {
    const pick = card.picks[question.id] ?? question.suggested;
    const answer = typeof pick === "number" ? question.options[pick] : pick.trim();
    return answer ? [{ question: question.question, answer }] : [];
  });
}
