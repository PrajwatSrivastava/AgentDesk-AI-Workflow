"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { saveAgentValue } from "@/app/actions/agents";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { isOptional, type SetupItem } from "@/lib/setup-rules";

/**
 * What a skill still needs before it can run. Integration details link out to
 * /connections; only this agent's own values are entered here.
 */
export function SetupChecklist({ agentId, items }: { agentId: string; items: SetupItem[] }) {
  // Lives here since a row unmounts as soon as its item is satisfied.
  const [confirmations, setConfirmations] = useState<string[]>([]);

  const required = items.filter((item) => !isOptional(item));
  const optional = items.filter(isOptional);
  if (items.length === 0 && confirmations.length === 0) return null;

  const onDone = (line: string) => setConfirmations((prior) => [...prior, line]);
  const keyOf = (item: SetupItem) =>
    item.kind === "connection" ? `app:${item.app}` : `value:${item.key}`;

  return (
    <section
      aria-label="Setup"
      className={cn("border-b border-rule px-4 py-4", required.length > 0 && "bg-accent-soft/50")}
    >
      {required.length > 0 ? (
        <>
          <h3 className="text-[13px] font-semibold">Finish setup before this skill runs</h3>
          <p className="text-muted mt-0.5 text-xs">
            {required.length === 1 ? "One thing" : `${required.length} things`} left.
          </p>
        </>
      ) : (
        confirmations.length > 0 && (
          <h3 className="text-done text-[13px] font-semibold">
            Setup complete. This skill is ready to run.
          </h3>
        )
      )}

      {confirmations.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {confirmations.map((line) => (
            <li key={line} className="text-done text-xs">
              {line}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ol className={cn("space-y-2.5", (required.length > 0 || confirmations.length > 0) && "mt-3")}>
          {[...required, ...optional].map((item) =>
            item.kind === "connection" ? (
              <ConnectionRow key={keyOf(item)} item={item} agentId={agentId} />
            ) : (
              <ValueRow key={keyOf(item)} item={item} agentId={agentId} onDone={onDone} />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function ConnectionRow({
  item,
  agentId,
}: {
  item: Extract<SetupItem, { kind: "connection" }>;
  agentId: string;
}) {
  const href = `/connections?app=${encodeURIComponent(item.app)}&next=${encodeURIComponent(`/agents/${agentId}`)}`;
  const details = item.missing.map((label) => label.toLowerCase()).join(" and ");
  const title = !item.connected
    ? `Connect ${item.label}`
    : `Finish setting up ${item.label}`;
  const explanation = item.optional
    ? "Works without it, at lower limits. Set up once on the Connections page."
    : !item.connected
      ? `Add it on the Connections page${details ? `, with the ${details}` : ""}. Every agent then uses it.`
      : `Set the ${details} on the Connections page. Every agent then uses it.`;

  return (
    <li className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">
          {title}
          <span className="text-muted ml-1.5 text-[11px] font-normal">
            {item.optional ? "optional" : "needed to send"}
          </span>
        </p>
        <p className="text-muted mt-0.5 text-xs">{explanation}</p>
      </div>
      <Link
        href={href}
        className={cn(
          "inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-[13px] font-medium transition-colors",
          item.optional
            ? "border border-rule text-ink hover:border-ink/30"
            : "bg-ink text-paper hover:bg-ink/90",
        )}
      >
        Go to Connections →
      </Link>
    </li>
  );
}

function ValueRow({
  item,
  agentId,
  onDone,
}: {
  item: Extract<SetupItem, { kind: "value" }>;
  agentId: string;
  onDone: (confirmation: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveAgentValue(agentId, item.key, value);
      if (result.ok) onDone(`${item.label}: ${result.detail}`);
      else setError(result.error);
    });
  }

  return (
    <li className="bg-surface rounded-lg border border-rule p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-medium">{item.label}</h4>
        <span className="text-muted shrink-0 text-[11px]">needed to run</span>
      </div>

      {item.hint && <p className="text-muted mt-1.5 text-xs leading-relaxed">{item.hint}</p>}

      <form onSubmit={submit} className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={item.placeholder ?? "Type here"}
          aria-label={item.label}
          autoComplete="off"
          className="placeholder:text-muted/70 min-w-0 flex-1 rounded-lg border border-rule px-3 py-2 text-xs outline-none focus:border-accent"
        />
        <Button type="submit" variant="primary" size="sm" disabled={pending || !value.trim()}>
          {pending ? "Checking…" : "Save"}
        </Button>
      </form>

      {error && <p className="text-failed mt-2 text-xs leading-relaxed">{error}</p>}
    </li>
  );
}
