"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat-messages";
import { cn } from "@/lib/cn";
import { ClarifyCard } from "./ClarifyCard";

const SUGGESTIONS = [
  "Every hour, check Hacker News for mentions of Linear and send me anything important on Slack. Ask me before posting if it's urgent.",
  "Each morning, read https://vercel.com/atom and email me a summary at me@example.com.",
  "Twice a day, look at new open issues on vercel/next.js and post a digest to Slack.",
  "Give me 5 fellowship deadlines related to AI safety.",
];

const BUSY_LABEL = {
  clarify: "Reading your request…",
  compile: "Working out the steps…",
};

export function ChatPane({
  agentName,
  messages,
  busy,
  onSubmit,
  onPick,
  onBuild,
}: {
  agentName: string;
  messages: ChatMessage[];
  busy: keyof typeof BUSY_LABEL | null;
  onSubmit: (request: string) => void | Promise<void>;
  onPick: (messageId: string, questionId: string, pick: number | string) => void;
  onBuild: (messageId: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setValue("");
    void onSubmit(trimmed);
  }

  return (
    <section className="bg-surface flex min-h-[26rem] flex-col rounded-xl border border-rule lg:min-h-0">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="pt-4">
            <p className="text-sm">
              Describe a job for {agentName} in plain English.
            </p>
            <p className="text-muted mt-1.5 text-xs">
              Say what to check, how often, and where the result should go.
            </p>
            <div className="mt-5 space-y-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="border-rule text-muted hover:border-ink/25 hover:text-ink block w-full rounded-lg border px-3 py-2.5 text-left text-xs leading-relaxed transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(message.role === "user" && "flex justify-end")}
              >
                <div
                  className={cn(
                    "text-sm leading-relaxed",
                    message.clarify ? "max-w-full" : "max-w-[85%]",
                    message.role === "user"
                      ? "bg-accent-soft text-ink rounded-2xl rounded-br-md px-3.5 py-2.5"
                      : "text-ink",
                  )}
                >
                  {message.text && <p className="whitespace-pre-line">{message.text}</p>}

                  {message.clarify && (
                    <ClarifyCard
                      card={message.clarify}
                      disabled={busy !== null}
                      onPick={(questionId, pick) => onPick(message.id, questionId, pick)}
                      onBuild={() => void onBuild(message.id)}
                    />
                  )}

                  {message.problems && message.problems.length > 0 && (
                    <ul className="text-muted mt-2 space-y-1 text-xs">
                      {/* Index keys, since two steps can report the identical problem */}
                      {message.problems.map((problem, index) => (
                        <li key={index}>· {problem}</li>
                      ))}
                    </ul>
                  )}

                </div>
              </li>
            ))}

            {busy && (
              <li className="text-muted flex items-center gap-2 text-sm">
                <span className="bg-accent size-1.5 animate-pulse rounded-full" />
                {BUSY_LABEL[busy]}
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="border-t border-rule p-3">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(value);
            }
          }}
          rows={3}
          disabled={busy !== null}
          placeholder={`Ask ${agentName}…`}
          aria-label={`Describe a job for ${agentName}`}
          className="placeholder:text-muted/70 w-full resize-none rounded-lg border border-rule px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted text-[11px]">Enter to send</span>
          <button
            type="button"
            onClick={() => send(value)}
            disabled={busy !== null || value.trim().length === 0}
            className="bg-ink hover:bg-ink/90 h-8 rounded-lg px-3.5 text-[13px] font-medium text-paper transition-colors disabled:bg-ink/30"
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
