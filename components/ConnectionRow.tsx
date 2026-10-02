"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import {
  deleteConnection,
  saveConnection,
  saveConnectionSetting,
} from "@/app/actions/connections";
import { Button } from "@/components/ui/Button";
import { useArmed } from "@/components/ui/useArmed";
import type { SetupStep } from "@/integrations/define";
import { cn } from "@/lib/cn";

const UNREACHABLE = "That didn't go through. Check your connection and try again.";

export interface SettingState {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Saved value as shown to the user (e.g. a page title, not its id). Null when unset. */
  display: string | null;
  /** Pre-filled when nothing is saved yet, e.g. the account's own email. */
  suggested?: string;
}

export interface ConnectionState {
  app: string;
  label: string;
  authHint?: string;
  placeholder?: string;
  steps: SetupStep[];
  /** Null when nothing is connected yet. */
  masked: string | null;
  lastError: string | null;
  settings: SettingState[];
}

export interface ReturnLink {
  href: string;
  label: string;
}

export function ConnectionRow({
  connection,
  highlight = false,
  returnTo,
}: {
  connection: ConnectionState;
  /** The app an agent sent the user here to set up. */
  highlight?: boolean;
  returnTo?: ReturnLink | null;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const connected = connection.masked !== null;
  const ready = connected && connection.settings.every((setting) => setting.display !== null);

  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) row.current?.scrollIntoView({ block: "center" });
  }, [highlight]);

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await saveConnection(connection.app, value);
        if (result.ok) {
          setValue("");
          setNotice(result.detail);
        } else {
          setError(result.error);
        }
      } catch {
        setError(UNREACHABLE);
      }
    });
  }

  // Two clicks to remove, every agent shares this credential
  const removal = useArmed();
  function remove() {
    if (!removal.armed) return removal.arm();
    setNotice(null);
    startTransition(async () => {
      try {
        await deleteConnection(connection.app);
      } catch {
        setError(UNREACHABLE);
      }
    });
  }

  return (
    <div
      ref={row}
      id={`connection-${connection.app}`}
      className={cn(
        "border-b border-rule px-5 py-5 last:border-b-0",
        highlight && "bg-accent-soft/60 shadow-[inset_3px_0_0_var(--color-accent)]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium">{connection.label}</h2>
        {ready ? (
          <span className="text-done bg-done-soft shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
            Connected
          </span>
        ) : (
          <span className="text-muted shrink-0 text-xs">
            {connected ? "Needs details" : "Not connected"}
          </span>
        )}
      </div>

      {connection.authHint && (
        <p className="text-muted mt-1.5 text-xs leading-relaxed">{connection.authHint}</p>
      )}

      {!connected && connection.steps.length > 0 && (
        <ol className="text-muted mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed">
          {connection.steps.map((step) => (
            <li key={step.text}>
              {step.text}
              {step.link && (
                <>
                  {" "}
                  <a
                    href={step.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent font-medium hover:underline"
                  >
                    {step.link.label} ↗
                  </a>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {connection.lastError && (
        <p className="bg-failed-soft text-failed mt-3 rounded-md px-3 py-2 text-xs leading-relaxed">
          Last attempt failed: {connection.lastError}
        </p>
      )}

      {connected && <p className="text-muted mt-3 font-mono text-xs">{connection.masked}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={connected ? "Paste a new value to replace" : connection.placeholder ?? "Paste here"}
          aria-label={`${connection.label} credential`}
          autoComplete="off"
          className="placeholder:text-muted/70 min-w-0 flex-1 rounded-lg border border-rule px-3 py-2 font-mono text-xs outline-none focus:border-accent"
        />
        <Button variant="primary" size="sm" onClick={save} disabled={pending || value.trim().length === 0}>
          {pending ? "Checking…" : "Save"}
        </Button>
        {connected && (
          <Button variant={removal.armed ? "danger" : "secondary"} size="sm" onClick={remove} disabled={pending}>
            {removal.armed ? "Really remove?" : "Remove"}
          </Button>
        )}
      </div>

      {notice && <p className="text-done mt-2 text-xs">{notice}</p>}
      {error && <p className="text-failed mt-2 text-xs leading-relaxed">{error}</p>}

      {/* Settings are validated with the saved token, so they need a connection first. */}
      {connected && connection.settings.length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-rule pt-4">
          {connection.settings.map((setting) => (
            <SettingField key={setting.key} app={connection.app} setting={setting} />
          ))}
        </ul>
      )}

      {ready && highlight && returnTo && (
        <p className="text-done mt-4 text-sm font-medium">
          {connection.label} is ready.{" "}
          <Link href={returnTo.href} className="text-ink underline">
            {returnTo.label} →
          </Link>
        </p>
      )}
    </div>
  );
}

function SettingField({ app, setting }: { app: string; setting: SettingState }) {
  const [editing, setEditing] = useState(setting.display === null);
  const [draft, setDraft] = useState(setting.display === null ? setting.suggested ?? "" : "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveConnectionSetting(app, setting.key, draft);
        if (result.ok) {
          setNotice(result.detail);
          setEditing(false);
          setDraft("");
        } else {
          setError(result.error);
        }
      } catch {
        setError(UNREACHABLE);
      }
    });
  }

  return (
    <li>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{setting.label}</p>
          {!editing && <p className="truncate text-xs">{setting.display}</p>}
        </div>
        {!editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>

      {editing && (
        <>
          {setting.hint && <p className="text-muted mt-1 text-xs leading-relaxed">{setting.hint}</p>}
          <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={setting.placeholder ?? "Type here"}
              aria-label={`${setting.label} for ${app}`}
              autoComplete="off"
              className="placeholder:text-muted/70 min-w-0 flex-1 rounded-lg border border-rule px-3 py-2 text-xs outline-none focus:border-accent"
            />
            <Button type="submit" variant="primary" size="sm" disabled={pending || !draft.trim()}>
              {pending ? "Checking…" : "Save"}
            </Button>
            {setting.display !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            )}
          </form>
        </>
      )}

      {notice && <p className="text-done mt-1.5 text-xs">{notice}</p>}
      {error && <p className="text-failed mt-1.5 text-xs leading-relaxed">{error}</p>}
    </li>
  );
}
