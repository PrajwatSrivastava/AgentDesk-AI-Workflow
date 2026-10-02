import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/lib/env";
import { runWorkflow } from "./executor";

// Per tick, to stay inside the function time limit.
const BATCH_SIZE = 5;

export interface TickResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

// Claim is a single UPDATE with SKIP LOCKED that also moves next_run_at, so overlapping ticks can't grab
// the same workflow. One statement also suits Neon's HTTP driver (no interactive transactions).
export async function tickOnce(): Promise<TickResult> {
  // Demo mode treats everyMinutes as seconds.
  const unit = env.demoMode ? sql`interval '1 second'` : sql`interval '1 minute'`;

  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE workflows
    SET next_run_at = now() + (COALESCE((spec -> 'trigger' ->> 'everyMinutes')::int, 60) * ${unit})
    WHERE id IN (
      SELECT id FROM workflows
      WHERE enabled = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= now()
        AND spec -> 'trigger' ->> 'type' = 'schedule'
      ORDER BY next_run_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  const ids = claimed.rows.map((row) => row.id);
  if (ids.length === 0) return { claimed: 0, succeeded: 0, failed: 0 };

  const outcomes = await Promise.allSettled(
    ids.map((id) => runWorkflow(id, "schedule")),
  );

  return {
    claimed: ids.length,
    succeeded: outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    failed: outcomes.filter((outcome) => outcome.status === "rejected").length,
  };
}
