"use client";

import { useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import type { ClarifyCard as Card, ClarifyQuestion } from "@/lib/clarify-types";
import { cn } from "@/lib/cn";

export function ClarifyCard({
  card,
  disabled,
  onPick,
  onBuild,
}: {
  card: Card;
  disabled: boolean;
  onPick: (questionId: string, pick: number | string) => void;
  onBuild: () => void;
}) {
  if (card.status === "superseded") {
    return (
      <p className="text-muted text-sm">
        {card.understood} <span className="text-xs">(replaced by your newer request)</span>
      </p>
    );
  }
  const answered = card.status === "answered";

  return (
    <div className="space-y-3.5 rounded-xl border border-rule p-3.5">
      <p className="text-sm">
        <span className="text-muted">Here&apos;s what I understood: </span>
        {card.understood}
      </p>
      {!answered && (
        <p className="text-muted text-xs">
          Check these before I build it. My best guesses are already selected.
        </p>
      )}

      <div className="space-y-3">
        {card.questions.map((question) => {
          const pick = card.picks[question.id] ?? question.suggested;
          return answered ? (
            <div key={question.id} className="text-xs">
              <p className="text-muted">{question.question}</p>
              <p className="mt-0.5 text-[13px]">
                {(typeof pick === "number" ? question.options[pick] : pick.trim()) || "No preference"}
              </p>
            </div>
          ) : (
            <Question
              key={question.id}
              question={question}
              pick={pick}
              disabled={disabled}
              onPick={(next) => onPick(question.id, next)}
            />
          );
        })}
      </div>

      {!answered && (
        <Button variant="primary" size="sm" disabled={disabled} onClick={onBuild}>
          Build it
        </Button>
      )}
    </div>
  );
}

function Question({
  question,
  pick,
  disabled,
  onPick,
}: {
  question: ClarifyQuestion;
  /** Option index, or the user's own text */
  pick: number | string;
  disabled: boolean;
  onPick: (pick: number | string) => void;
}) {
  const labelId = useId();
  const typing = typeof pick === "string";
  // Focus the text box only when the user just chose "Other…"
  const focusNext = useRef(false);

  return (
    <div>
      <p id={labelId} className="text-muted mb-1.5 text-xs">
        {question.question}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {question.options.map((option, index) => (
          // Index keys: the options never reorder
          <Chip key={index} checked={pick === index} disabled={disabled} onClick={() => onPick(index)}>
            {option}
          </Chip>
        ))}
        <Chip
          checked={typing}
          disabled={disabled}
          onClick={() => {
            if (typing) return;
            focusNext.current = true;
            onPick("");
          }}
        >
          Other…
        </Chip>
      </div>
      {typing && (
        <input
          ref={(node) => {
            if (node && focusNext.current) {
              focusNext.current = false;
              node.focus();
            }
          }}
          type="text"
          value={pick}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => onPick(event.target.value)}
          placeholder="Type your answer"
          aria-label={`Your answer: ${question.question}`}
          className="placeholder:text-muted/70 mt-2 w-full rounded-lg border border-rule px-3 py-2 text-xs outline-none focus:border-accent disabled:opacity-60"
        />
      )}
    </div>
  );
}

function Chip({
  checked,
  disabled,
  onClick,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-default disabled:opacity-60",
        checked
          ? "border-accent bg-accent-soft text-ink font-medium"
          : "border-rule text-muted hover:border-ink/30 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
