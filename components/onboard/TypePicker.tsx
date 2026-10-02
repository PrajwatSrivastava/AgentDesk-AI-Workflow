"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createAgent } from "@/app/actions/agents";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export interface TypeOption {
  key: string;
  name: string;
  description: string;
  avatarColor: string;
  presetCount: number;
}

export function TypePicker({
  options,
  initialSelected,
}: {
  options: TypeOption[];
  initialSelected?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(
    initialSelected && options.some((option) => option.key === initialSelected)
      ? initialSelected
      : options[0].key,
  );
  const [error, setError] = useState<string | null>(null);

  const preview = options.find((option) => option.key === selected)!;

  function next() {
    setError(null);
    startTransition(async () => {
      try {
        const { id } = await createAgent(selected);
        router.push(`/agents/${id}?welcome=1`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  return (
    <div className="bg-surface grid gap-0 overflow-hidden rounded-2xl border border-rule md:grid-cols-[1fr_360px]">
      <div className="p-8">
        <h2 className="text-[15px] font-medium">What kind of agent are you creating?</h2>

        <div
          role="radiogroup"
          aria-label="Agent type"
          className="mt-5 grid gap-2.5 sm:grid-cols-2"
        >
          {options.map((option) => {
            const active = option.key === selected;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(option.key)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-left text-sm transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-rule hover:border-ink/25",
                )}
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    active ? "border-accent" : "border-muted/50",
                  )}
                >
                  {active && <span className="bg-accent size-2 rounded-full" />}
                </span>
                {option.name}
              </button>
            );
          })}
        </div>

        {error && (
          <p className="text-failed mt-5 text-sm">
            {error}
          </p>
        )}

        <div className="mt-7">
          <Button variant="primary" onClick={next} disabled={pending}>
            {pending ? "Creating…" : "Next"}
          </Button>
        </div>
      </div>

      <aside className="bg-lavender flex items-center justify-center p-8">
        <div className="bg-surface w-full max-w-[260px] rounded-2xl border border-rule p-6 text-center">
          <div className="flex justify-center py-4">
            <AgentAvatar color={preview.avatarColor} size={104} />
          </div>
          <h3 className="text-[15px] font-semibold">{preview.name}</h3>
          <p className="text-muted mt-1.5 text-[13px] leading-snug">
            {preview.description}
          </p>
          <p className="text-muted mt-4 border-t border-rule pt-3 text-xs">
            Starts with {preview.presetCount}{" "}
            {preview.presetCount === 1 ? "skill" : "skills"}
          </p>
        </div>
      </aside>
    </div>
  );
}
