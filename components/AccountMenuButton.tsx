"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { getAccountSummary } from "@/app/actions/account";
import { signOut, signOutEverywhere } from "@/app/actions/session";
import { ChevronIcon, DevicesIcon, PlugIcon, SignOutIcon } from "@/components/icons";
import { useArmed } from "@/components/ui/useArmed";
import type { AccountSummary } from "@/lib/account";
import { ACTIVITY_EVENT } from "@/lib/activity";
import { cn } from "@/lib/cn";
import { clearAllLocal } from "@/lib/local-state";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

const THEME_LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

/** Items reachable with the arrow keys. */
const ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]';

const itemClass =
  "hover:bg-ink/5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors";

// Survives navigation so the next page's menu can show the last numbers while fresh ones load.
let lastSummary: { email: string; summary: AccountSummary } | null = null;

function forgetAccount(): void {
  lastSummary = null;
  clearAllLocal();
}

function reloadSummary(email: string, apply: (summary: AccountSummary) => void): void {
  getAccountSummary().then(
    (fresh) => {
      lastSummary = { email, summary: fresh };
      apply(fresh);
    },
    () => {},
  );
}

// Cookie lets the server render the right theme on the next load (no flash).
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function AccountMenuButton({
  email,
  runLimit,
  theme: initialTheme,
  summary: streamed,
}: {
  email: string;
  runLimit: number | null;
  theme: Theme;
  /** Resolves to null if the summary could not be loaded. */
  summary: Promise<AccountSummary | null>;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [summary, setSummary] = useState(() => (lastSummary?.email === email ? lastSummary.summary : null));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusFirstItem = useRef(false);
  const themeLabel = useId();
  const pathname = usePathname();

  useEffect(() => {
    let current = true;
    void streamed.then((fresh) => {
      if (!current || !fresh) return;
      lastSummary = { email, summary: fresh };
      setSummary(fresh);
    });
    return () => {
      current = false;
    };
  }, [streamed, email]);

  useEffect(() => {
    const reload = () => reloadSummary(email, setSummary);
    window.addEventListener(ACTIVITY_EVENT, reload);
    return () => window.removeEventListener(ACTIVITY_EVENT, reload);
  }, [email]);

  useEffect(() => {
    if (!open) return;
    if (focusFirstItem.current) menu.current?.querySelector<HTMLElement>(ITEMS)?.focus();
    const closeOnOutside = (event: globalThis.MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    if (open) {
      setOpen(false);
      return;
    }
    // detail is 0 for keyboard activation. Only then move focus into the menu.
    focusFirstItem.current = event.detail === 0;
    setOpen(true);
    reloadSummary(email, setSummary);
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    const targets: Record<string, number> = {
      ArrowDown: at === last ? 0 : at + 1,
      ArrowUp: at <= 0 ? last : at - 1,
      Home: 0,
      End: last,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  function chooseTheme(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  const close = () => setOpen(false);
  const onConnections = pathname === "/connections";
  const waiting = summary?.approvalsWaiting ?? 0;

  return (
    <div ref={root} className="fixed bottom-5 left-5 z-40">
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          onKeyDown={moveFocus}
          className="menu-in bg-surface absolute bottom-full left-0 mb-3 w-72 rounded-2xl border border-rule p-1.5 shadow-xl"
        >
          <div className="px-2.5 pt-2.5 pb-3">
            <div className="flex items-center gap-3">
              <Avatar email={email} className="size-9 shrink-0 text-sm" />
              <div className="min-w-0">
                <p className="text-muted text-xs">Signed in as</p>
                <p className="truncate text-sm font-medium" title={email}>
                  {email}
                </p>
              </div>
            </div>
            <RunsToday used={summary?.runsToday} limit={runLimit} />
          </div>

          {summary && waiting > 0 && (
            <>
              <div className="border-t border-rule" />
              <WaitingApprovals summary={summary} onNavigate={close} />
            </>
          )}

          <div className="border-t border-rule" />

          <div className="py-1.5">
            <Link
              href="/connections"
              role="menuitem"
              aria-current={onConnections ? "page" : undefined}
              onClick={close}
              className={cn(itemClass, onConnections && "bg-ink/5")}
            >
              <span className="text-muted">
                <PlugIcon />
              </span>
              <span className="flex-1">Connections</span>
              <ConnectionsStatus summary={summary} />
              <span className="text-muted">
                <ChevronIcon />
              </span>
            </Link>

            <div className="px-2.5 pt-2.5 pb-1">
              <p className="text-muted mb-1 text-xs" id={themeLabel}>
                Theme
              </p>
              <div className="-mx-1.5 flex" role="group" aria-labelledby={themeLabel}>
                {THEMES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === option}
                    onClick={() => chooseTheme(option)}
                    className="hover:bg-ink/5 flex flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm transition-colors"
                  >
                    <Radio checked={theme === option} />
                    {THEME_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-rule" />

          <div className="pt-1.5">
            <form action={signOut} onSubmit={forgetAccount}>
              <SignOutItem />
            </form>
            <form action={signOutEverywhere} onSubmit={forgetAccount}>
              <SignOutEverywhereItem />
            </form>
          </div>
        </div>
      )}

      <button
        ref={trigger}
        type="button"
        aria-label={waiting > 0 ? `Account menu, ${waiting} waiting for approval` : "Account menu"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "relative rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95",
          open && "ring-accent ring-offset-paper ring-2 ring-offset-2",
        )}
      >
        <Avatar email={email} className="size-10 text-sm" />
        {waiting > 0 && (
          <span
            aria-hidden="true"
            className="bg-waiting ring-paper absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-[#16181b] tabular-nums ring-2"
          >
            {waiting > 9 ? "9+" : waiting}
          </span>
        )}
      </button>
    </div>
  );
}

function Avatar({ email, className }: { email: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("bg-ink text-paper grid place-items-center rounded-full font-semibold uppercase", className)}
    >
      {email.charAt(0)}
    </span>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors",
        checked ? "border-accent" : "border-muted/50",
      )}
    >
      {checked && <span className="bg-accent size-2 rounded-full" />}
    </span>
  );
}

function RunsToday({ used, limit }: { used: number | undefined; limit: number | null }) {
  const full = limit !== null && used !== undefined && used >= limit;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Runs today</span>
        {used === undefined ? (
          <span className="bg-ink/10 h-3 w-12 animate-pulse rounded" aria-label="Loading" />
        ) : (
          <span className={cn("font-medium tabular-nums", full && "text-failed")}>
            {limit === null ? `${used} · no daily limit` : `${used} of ${limit}`}
          </span>
        )}
      </div>
      {limit !== null && (
        <div className="bg-ink/10 mt-1.5 h-1 overflow-hidden rounded-full">
          <div
            className={cn("h-full rounded-full transition-[width] duration-300", full ? "bg-failed" : "bg-accent")}
            style={{ width: `${Math.min(100, ((used ?? 0) / limit) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function WaitingApprovals({ summary, onNavigate }: { summary: AccountSummary; onNavigate: () => void }) {
  const more = summary.approvalsWaiting - summary.approvals.length;
  return (
    <div className="py-1.5">
      <p className="text-muted flex items-center justify-between px-2.5 pt-1 pb-1 text-xs">
        Waiting for you
        <span className="bg-waiting-soft text-waiting rounded-full px-1.5 font-medium tabular-nums">
          {summary.approvalsWaiting}
        </span>
      </p>
      {summary.approvals.map((approval) => (
        <Link
          key={approval.token}
          href={`/approvals/${approval.token}`}
          role="menuitem"
          onClick={onNavigate}
          className={cn(itemClass, "items-start")}
        >
          <span className="bg-waiting mt-1.5 size-2 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{approval.agentName}</span>
            <span className="text-muted block truncate text-xs" title={approval.message}>
              {approval.message}
            </span>
          </span>
        </Link>
      ))}
      {more > 0 && (
        <Link href="/approvals" role="menuitem" onClick={onNavigate} className={cn(itemClass, "text-muted text-xs")}>
          <span className="flex-1">See all {summary.approvalsWaiting}</span>
          <ChevronIcon />
        </Link>
      )}
    </div>
  );
}

function ConnectionsStatus({ summary }: { summary: AccountSummary | null }) {
  if (!summary) return null;
  if (summary.appsReady === summary.appsTotal) {
    return (
      <span className="text-done flex items-center gap-1 text-xs">
        <span className="bg-done size-1.5 rounded-full" />
        All set
      </span>
    );
  }
  return (
    <span className="text-muted text-xs tabular-nums">
      {summary.appsReady} of {summary.appsTotal} ready
    </span>
  );
}

function SignOutItem() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" role="menuitem" disabled={pending} className={cn(itemClass, "disabled:opacity-60")}>
      <span className="text-muted">
        <SignOutIcon />
      </span>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

/** Two clicks, since it signs out every other device too. */
function SignOutEverywhereItem() {
  const { pending } = useFormStatus();
  const { armed, arm } = useArmed();

  return (
    <button
      type="submit"
      role="menuitem"
      disabled={pending}
      onClick={(event) => {
        if (armed) return;
        event.preventDefault();
        arm();
      }}
      className={cn(itemClass, "disabled:opacity-60", armed && "text-failed")}
    >
      <span className={armed ? undefined : "text-muted"}>
        <DevicesIcon />
      </span>
      {pending
        ? "Signing out everywhere…"
        : armed
          ? "Click again to sign out everywhere"
          : "Sign out of all devices"}
    </button>
  );
}
