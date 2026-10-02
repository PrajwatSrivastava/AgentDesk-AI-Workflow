"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { signIn, signUp } from "@/app/actions/session";
import { Button } from "@/components/ui/Button";

const COPY = {
  signin: {
    title: "Sign in",
    subtitle: "Welcome back to Agent Desk.",
    submit: "Sign in",
    pending: "Signing in…",
    switchText: "New here?",
    switchLink: "Create an account",
    switchHref: "/signup",
  },
  signup: {
    title: "Create your account",
    subtitle: "Your agents, workflows and connections are private to you.",
    submit: "Create account",
    pending: "Creating your account…",
    switchText: "Already have an account?",
    switchLink: "Sign in",
    switchHref: "/login",
  },
} as const;

export function AuthForm({ mode, next }: { mode: "signin" | "signup"; next: string }) {
  const [state, action, pending] = useActionState(mode === "signin" ? signIn : signUp, {});
  // Set after mount to avoid a hydration mismatch, and again after each reply
  // because React resets form fields when an action returns.
  const timeZoneField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (timeZoneField.current) {
      timeZoneField.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }, [state]);

  const copy = COPY[mode];
  const switchHref = next === "/" ? copy.switchHref : `${copy.switchHref}?next=${encodeURIComponent(next)}`;

  return (
    <main className="bg-lavender flex flex-1 items-center justify-center px-6 py-20">
      <div className="bg-surface w-full max-w-sm rounded-2xl border border-rule p-8">
        <p className="text-muted text-xs font-medium">Agent Desk</p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em]">{copy.title}</h1>
        <p className="text-muted mt-1.5 text-sm">{copy.subtitle}</p>

        <form action={action} className="mt-6 space-y-3">
          <input type="hidden" name="next" value={next} />
          {mode === "signup" && (
            <input ref={timeZoneField} type="hidden" name="timeZone" defaultValue="" />
          )}

          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              name="email"
              required
              autoFocus
              autoComplete="email"
              defaultValue={state.email}
              className="mt-1.5 block w-full rounded-lg border border-rule px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password"
              name="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="mt-1.5 block w-full rounded-lg border border-rule px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {mode === "signup" && (
              <span className="text-muted mt-1 block text-xs">At least 8 characters.</span>
            )}
          </label>

          {state.error && <p className="text-failed text-sm">{state.error}</p>}

          <Button type="submit" variant="primary" className="w-full" disabled={pending}>
            {pending ? copy.pending : copy.submit}
          </Button>
        </form>

        <p className="text-muted mt-6 text-center text-sm">
          {copy.switchText}{" "}
          <Link href={switchHref} className="text-ink font-medium underline">
            {copy.switchLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
