"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { answerConnectionsPrompt } from "@/app/actions/session";
import { Button } from "@/components/ui/Button";

export interface PromptApp {
  key: string;
  label: string;
  status: "ready" | "needs details" | "not connected";
  optional: boolean;
}

// Buttons are plain forms so a click before hydration still works.
export function ConnectionsPromptDialog({
  apps,
  returnTo,
}: {
  apps: PromptApp[];
  returnTo: string;
}) {
  const later = useRef<HTMLFormElement>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connections-prompt-title"
        // Escape counts as "Maybe later"
        onKeyDown={(event) => {
          if (event.key === "Escape") later.current?.requestSubmit();
        }}
        className="bg-surface w-full max-w-md rounded-2xl border border-rule p-6 shadow-xl"
      >
        <h2 id="connections-prompt-title" className="text-lg font-semibold">
          Connect your apps
        </h2>
        <p className="text-muted mt-1.5 text-sm leading-relaxed">
          Agents deliver their results through these. Connect each one once, on the
          Connections page, and every agent can use it.
        </p>

        <ul className="mt-4 divide-y divide-rule rounded-lg border border-rule">
          {apps.map((app) => (
            <li key={app.key} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
              <span>
                {app.label}
                {app.optional && <span className="text-muted text-xs"> · optional</span>}
              </span>
              {app.status === "ready" ? (
                <span className="text-done bg-done-soft rounded-full px-2.5 py-0.5 text-xs font-medium">
                  Connected
                </span>
              ) : (
                <span className="text-muted text-xs">
                  {app.status === "needs details" ? "Needs details" : "Not connected"}
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <form action={answerConnectionsPrompt}>
            <input
              type="hidden"
              name="goTo"
              value={`/connections?next=${encodeURIComponent(returnTo)}`}
            />
            <SubmitButton variant="primary" autoFocus>
              Set up connections
            </SubmitButton>
          </form>
          <form ref={later} action={answerConnectionsPrompt}>
            <SubmitButton variant="ghost">Maybe later</SubmitButton>
          </form>
        </div>
        <p className="text-muted mt-3 text-xs">You can always do this later from Connections.</p>
      </div>
    </div>
  );
}

function SubmitButton({
  variant,
  autoFocus,
  children,
}: {
  variant: "primary" | "ghost";
  autoFocus?: boolean;
  children: React.ReactNode;
}) {
  // Disabled while pending so a double click sends one answer.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} autoFocus={autoFocus} disabled={pending}>
      {children}
    </Button>
  );
}
