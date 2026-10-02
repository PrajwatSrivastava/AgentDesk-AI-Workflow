"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveAgentValue } from "@/app/actions/agents";
import { Button } from "@/components/ui/Button";
import { useArmed } from "@/components/ui/useArmed";

export interface AgentValue {
  key: string;
  label: string;
  value: string;
  /** Empty, or a placeholder that shipped as a default. */
  unset: boolean;
  hint?: string;
  placeholder?: string;
}

// Per-agent values only. Integration details are per account, on /connections.
export function AgentSettings({
  agentId,
  values,
  onClose,
  onDelete,
}: {
  agentId: string;
  values: AgentValue[];
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <section
      aria-label="Agent settings"
      className="bg-surface shrink-0 rounded-xl border border-rule"
    >
      <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 className="text-[15px] font-semibold">Agent settings</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      {values.length === 0 ? (
        <p className="text-muted px-4 py-4 text-sm">
          No settings yet. One appears here when a skill needs a value from you.
        </p>
      ) : (
        <ul>
          {values.map((value) => (
            <SettingRow key={value.key} agentId={agentId} setting={value} />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-3">
        <p className="text-[13px] font-medium">Delete this agent</p>
        <DeleteAgentButton onConfirm={onDelete} />
      </div>
    </section>
  );
}

function DeleteAgentButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const { armed, arm } = useArmed();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={armed ? "danger" : "secondary"}
      size="sm"
      disabled={pending}
      onClick={() => (armed ? startTransition(onConfirm) : arm())}
    >
      {pending ? "Deleting…" : armed ? "Really delete?" : "Delete agent"}
    </Button>
  );
}

function SettingRow({ agentId, setting }: { agentId: string; setting: AgentValue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEditing() {
    setDraft(setting.unset ? "" : setting.value);
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveAgentValue(agentId, setting.key, draft);
      if (result.ok) {
        setNotice(result.detail);
        setEditing(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <li className="border-b border-rule px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{setting.label}</p>
          {!editing && (
            <p className={setting.unset ? "text-muted text-xs" : "truncate text-xs"}>
              {setting.unset ? "Not set" : setting.value}
            </p>
          )}
        </div>
        {!editing && (
          <Button size="sm" onClick={startEditing}>
            {setting.unset ? "Set" : "Edit"}
          </Button>
        )}
      </div>

      {editing && (
        <>
          {setting.hint && (
            <p className="text-muted mt-1.5 text-xs leading-relaxed">{setting.hint}</p>
          )}
          <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={setting.placeholder ?? "Type here"}
              aria-label={setting.label}
              autoComplete="off"
              autoFocus
              className="placeholder:text-muted/70 min-w-0 flex-1 rounded-lg border border-rule px-3 py-2 text-xs outline-none focus:border-accent"
            />
            <Button type="submit" variant="primary" size="sm" disabled={pending || !draft.trim()}>
              {pending ? "Checking…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </form>
        </>
      )}

      {notice && <p className="text-done mt-1.5 text-xs">{notice}</p>}
      {error && <p className="text-failed mt-1.5 text-xs leading-relaxed">{error}</p>}
    </li>
  );
}
