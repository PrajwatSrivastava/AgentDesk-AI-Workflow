"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAgent as deleteAgentAction } from "@/app/actions/agents";
import { getLatestRun, pollAgent, refreshAgent, tickFromDashboard } from "@/app/actions/runs";
import {
  compileRequest,
  deleteWorkflow as deleteWorkflowAction,
  runNow as runNowAction,
  saveWorkflow,
  setEnabled as setEnabledAction,
} from "@/app/actions/workflows";
import type { WorkflowSpec } from "@/core/spec";
import { announceActivity } from "@/lib/activity";
import { cn } from "@/lib/cn";
import { readLocal, removeLocal, workspaceKey, writeLocal } from "@/lib/local-state";
import type { RunAllowance } from "@/lib/quota";
import type { RunSummary, RunView } from "@/lib/run-views";
import { blockingItems, type SetupItem } from "@/lib/setup-rules";
import type { SpecView } from "@/lib/spec-view";
import { AgentSettings, type AgentValue } from "./AgentSettings";
import { ChatPane, type ChatMessage } from "./ChatPane";
import { RecentRuns } from "./RecentRuns";
import { SetupChecklist } from "./SetupChecklist";
import { WorkflowPanel } from "./WorkflowPanel";

export interface WorkflowSummary {
  id: string;
  name: string;
  enabled: boolean;
  view: SpecView;
  setup: SetupItem[];
}

/** Scheduler tick interval while the dashboard is open. */
const POLL_MS = 5000;

const UNREACHABLE = "That didn't go through. Check your connection and try again.";

type Draft = { spec: WorkflowSpec; view: SpecView };

/** Kept in localStorage until sign-out. */
interface SavedWorkspace {
  messages: ChatMessage[];
  draft: Draft | null;
}

export function Workspace({
  userId,
  timeZone,
  agentId,
  agentName,
  workflows,
  values,
  allowance: initialAllowance,
  initialRecent,
  initialRun,
  welcome,
}: {
  userId: string;
  /** User's time zone, so server and client format run times the same. */
  timeZone: string;
  agentId: string;
  agentName: string;
  workflows: WorkflowSummary[];
  values: AgentValue[];
  allowance: RunAllowance;
  initialRecent: RunSummary[];
  /** Latest run of the first workflow (selected on arrival). */
  initialRun: RunView | null;
  welcome: boolean;
}) {
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string | null>(workflows[0]?.id ?? null);
  const [run, setRun] = useState<RunView | null>(initialRun);
  const [recent, setRecent] = useState<RunSummary[]>(initialRecent);
  const [busy, setBusy] = useState<string | null>(null);
  const [staggered, setStaggered] = useState(false);
  const [allowance, setAllowance] = useState(initialAllowance);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const showingDraft = draft !== null && selected === null;
  const current = workflows.find((workflow) => workflow.id === selected) ?? null;

  // Restored in an effect: reading localStorage during render breaks hydration.
  const storageKey = workspaceKey(userId, agentId);
  const justRestored = useRef(false);
  useEffect(() => {
    const saved = readLocal<SavedWorkspace>(storageKey);
    if (saved && Array.isArray(saved.messages)) {
      setMessages(saved.messages);
      if (saved.draft?.spec && saved.draft.view) {
        setDraft(saved.draft);
        setSelected(null);
      }
    } else if (saved) {
      // old format or corrupt
      removeLocal(storageKey);
    }
    justRestored.current = true;
  }, [storageKey]);

  useEffect(() => {
    // Skip the write in the same commit as the restore, or the empty initial state overwrites it.
    if (justRestored.current) {
      justRestored.current = false;
      return;
    }
    writeLocal(storageKey, { messages, draft } satisfies SavedWorkspace);
  }, [storageKey, messages, draft]);

  // Server actions are queued, so a reply can arrive after the selection changed.
  // Only apply it if its workflow is still selected.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const showRun = (view: RunView | null, forWorkflow: string | null) => {
    if (forWorkflow === selectedRef.current) setRun(view);
  };
  const shownRun = run && run.workflowId === selected ? run : null;

  // Let the account badge know when the waiting count changes
  const waitingRuns = recent.filter((summary) => summary.status === "waiting").length;
  const announcedWaiting = useRef(waitingRuns);
  useEffect(() => {
    if (waitingRuns === announcedWaiting.current) return;
    announcedWaiting.current = waitingRuns;
    announceActivity();
  }, [waitingRuns]);

  // Picks up apps connected in another tab.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [router]);

  // initialRun covers the first selection; fetch only when it changes.
  const arrivedWith = useRef(selected);
  useEffect(() => {
    if (selected === arrivedWith.current) return;
    arrivedWith.current = null;
    if (!selected) {
      setRun(null);
      return;
    }
    let current = true;
    getLatestRun(selected).then(
      (latest) => {
        if (current) setRun(latest);
      },
      () => {
        // The next poll fills it in.
      },
    );
    return () => {
      current = false;
    };
  }, [selected]);

  // The open tab drives the scheduler. The ref stops polls overlapping when a cycle
  // outlasts POLL_MS. Hidden tabs still tick but skip the reads.
  const polling = useRef(false);
  useEffect(() => {
    const timer = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        if (document.visibilityState === "hidden") {
          await tickFromDashboard();
          return;
        }
        const poll = await pollAgent(agentId, selected);
        setRecent(poll.runs);
        setAllowance(poll.allowance);
        if (selected) showRun(poll.run, selected);
        if (poll.claimed > 0) router.refresh();
      } catch {
        // ignore, next tick retries
      } finally {
        polling.current = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [agentId, selected, router]);

  async function submit(request: string) {
    setMessages((prior) => [...prior, { role: "user", text: request }]);
    setBusy("compile");
    setStaggered(false);

    try {
      const { ok, spec, view, message, problems } = await compileRequest(agentId, request);

      if (!ok || !spec || !view) {
        setMessages((prior) => [
          ...prior,
          { role: "agent", text: message ?? "I couldn't build that.", problems },
        ]);
        return;
      }

      setDraft({ spec, view });
      setSelected(null);
      setStaggered(true);
      setMessages((prior) => [...prior, { role: "agent", text: summarise(spec, view) }]);
    } catch (error) {
      setMessages((prior) => [
        ...prior,
        { role: "agent", text: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setBusy(null);
    }
  }

  // These actions revalidate the page themselves, no router.refresh() needed.

  async function save() {
    if (!draft) return;
    setBusy("save");
    try {
      const result = await saveWorkflow(agentId, draft.spec);
      if (!result.ok) {
        setMessages((prior) => [...prior, { role: "agent", text: result.error }]);
        return;
      }
      setDraft(null);
      setSelected(result.id);
      setStaggered(false);
      setMessages((prior) => [
        ...prior,
        { role: "agent", text: "Saved. Test it, then switch it on." },
      ]);
    } catch {
      setMessages((prior) => [...prior, { role: "agent", text: UNREACHABLE }]);
    } finally {
      setBusy(null);
    }
  }

  async function trigger(kind: "test" | "run") {
    if (!selected) return;
    const workflowId = selected;
    setBusy(kind);
    setNotice(null);
    try {
      const result = await runNowAction(workflowId, { dryRun: kind === "test" });
      if (!result.ok) setNotice(result.error);
      const fresh = await refreshAgent(agentId, workflowId);
      showRun(fresh.run, workflowId);
      setRecent(fresh.runs);
      setAllowance(fresh.allowance);
    } catch {
      setNotice(UNREACHABLE);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy("delete");
    try {
      await deleteWorkflowAction(selected);
      const remaining = workflows.filter((workflow) => workflow.id !== selected);
      setSelected(remaining[0]?.id ?? null);
      setRun(null);
    } catch {
      setNotice(UNREACHABLE);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(next: boolean) {
    if (!selected) return;
    setBusy("enable");
    try {
      const result = await setEnabledAction(selected, next);
      if (!result.ok) setNotice(result.error);
    } catch {
      setNotice(UNREACHABLE);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6 pb-8">
      {welcome && (
        <h1 className="mb-6 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
          <span className="text-muted">2.</span> Give your agent its first skill
        </h1>
      )}

      {/* Panes scroll internally on desktop; on mobile the page scrolls. */}
      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[42fr_58fr]">
        <ChatPane
          agentName={agentName}
          messages={messages}
          busy={busy === "compile"}
          onSubmit={submit}
        />

        <section className="flex min-h-0 flex-col gap-3 lg:overflow-hidden">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="tablist" aria-label="Skills">
              {draft && (
                <SkillChip
                  active={showingDraft}
                  onClick={() => setSelected(null)}
                  label="Draft"
                  tone="accent"
                />
              )}
              {workflows.map((workflow) => (
                <SkillChip
                  key={workflow.id}
                  active={selected === workflow.id}
                  onClick={() => {
                    setSelected(workflow.id);
                    setStaggered(false);
                    setNotice(null);
                  }}
                  label={workflow.name}
                  tone={workflow.enabled ? "on" : "off"}
                />
              ))}
            </div>
            <button
              type="button"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                settingsOpen
                  ? "border-ink/25 bg-surface text-ink"
                  : "border-rule text-muted hover:text-ink",
              )}
            >
              Agent settings
            </button>
          </div>

          {settingsOpen && (
            <AgentSettings
              agentId={agentId}
              values={values}
              onClose={() => setSettingsOpen(false)}
              onDelete={async () => {
                removeLocal(storageKey);
                await deleteAgentAction(agentId);
              }}
            />
          )}

          {showingDraft && draft ? (
            <WorkflowPanel
              view={draft.view}
              isDraft
              staggered={staggered}
              busy={busy}
              actions={{
                onSave: save,
                onDiscard: () => {
                  setDraft(null);
                  setSelected(workflows[0]?.id ?? null);
                },
              }}
            />
          ) : current ? (
            <WorkflowPanel
              // Remount per skill so an armed Delete doesn't carry over
              key={current.id}
              view={current.view}
              run={shownRun}
              enabled={current.enabled}
              busy={busy}
              allowance={allowance}
              notice={notice}
              setup={<SetupChecklist key={current.id} agentId={agentId} items={current.setup} />}
              blocked={blockedBy(current.setup)}
              actions={{
                onTestRun: () => trigger("test"),
                onRunNow: () => trigger("run"),
                onToggleEnabled: toggle,
                onDelete: remove,
              }}
            />
          ) : (
            <div className="bg-surface text-muted flex flex-1 items-center justify-center rounded-xl border border-rule p-10 text-center text-sm">
              This agent has no skills yet. Describe a job on the left.
            </div>
          )}

          <RecentRuns runs={recent} selectedWorkflowId={selected} timeZone={timeZone} />
        </section>
      </div>
    </div>
  );
}

function SkillChip({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone: "on" | "off" | "accent";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex max-w-52 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-ink/25 bg-surface text-ink"
          : "border-transparent bg-ink/[0.04] text-muted hover:text-ink",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "on" && "bg-done",
          tone === "off" && "bg-ink/20",
          tone === "accent" && "bg-accent",
        )}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Same check the server runs before starting a run. */
function blockedBy(setup: SetupItem[]): { test: boolean; run: boolean } {
  return {
    test: blockingItems(setup, true).length > 0,
    run: blockingItems(setup, false).length > 0,
  };
}

// Built from the spec, no second model call needed.
function summarise(spec: WorkflowSpec, view: SpecView): string {
  const count = spec.steps.length;
  const approvalAt = spec.steps.findIndex((step) => step.type === "human");
  const approval = spec.steps[approvalAt];

  const sentences = [
    `I've put together a ${count}-step skill that runs ${view.triggerLabel}.`,
  ];
  if (approval?.type === "human") {
    const where = approvalAt === count - 2 ? " before the final step" : "";
    sentences.push(
      approval.when
        ? `It asks for your approval${where} only when its condition is met.`
        : `It pauses for your approval${where} on every run.`,
    );
  }
  sentences.push("Have a look on the right, then test it before switching it on.");

  return sentences.join(" ");
}
