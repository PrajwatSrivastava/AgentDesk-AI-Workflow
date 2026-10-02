"use client";

import Link from "next/link";

// Catch-all for uncaught errors (DB blips, stale server actions after a deploy).
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="bg-surface w-full max-w-md rounded-2xl border border-rule p-8 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-muted mt-2 text-sm">
          Nothing you saved is lost. Try again, or go back to your agents.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="bg-ink text-paper rounded-lg px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
          <Link href="/" className="rounded-lg border border-rule px-4 py-2 text-sm">
            Your agents
          </Link>
        </div>
      </div>
    </main>
  );
}
