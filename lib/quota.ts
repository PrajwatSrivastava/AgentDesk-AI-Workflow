import { sql } from "drizzle-orm";
import { db } from "@/db";

/** All run kinds count, test runs included. Resuming after an approval doesn't. */
export const DAILY_RUN_LIMIT = 25;

export class DailyLimitError extends Error {
  constructor() {
    super(
      `You've used all ${DAILY_RUN_LIMIT} workflow runs for today. Runs start again at midnight.`,
    );
    this.name = "DailyLimitError";
  }
}

/** null means no limit (see `npm run run-limit`). */
export function dailyLimitFor(user: { runLimitExempt: boolean }): number | null {
  return user.runLimitExempt ? null : DAILY_RUN_LIMIT;
}

// Single upsert: the row lock stops two concurrent runs both getting past the limit.
// Day is in the user's sign-up time zone. Unlimited accounts are still counted.
export async function claimDailyRun(
  userId: string,
  timeZone: string,
  limit: number | null,
): Promise<boolean> {
  const result = await db.execute<{ runs: number }>(sql`
    INSERT INTO daily_run_usage (user_id, day, runs)
    VALUES (${userId}, (now() AT TIME ZONE ${timeZone})::date, 1)
    ON CONFLICT (user_id, day) DO UPDATE
      SET runs = daily_run_usage.runs + 1
      WHERE ${limit === null ? sql`true` : sql`daily_run_usage.runs < ${limit}`}
    RETURNING runs
  `);
  return result.rows.length > 0;
}

export async function runsUsedToday(userId: string, timeZone: string): Promise<number> {
  const result = await db.execute<{ runs: number }>(sql`
    SELECT runs FROM daily_run_usage
    WHERE user_id = ${userId} AND day = (now() AT TIME ZONE ${timeZone})::date
  `);
  return Number(result.rows[0]?.runs ?? 0);
}

export interface RunAllowance {
  used: number;
  /** null when there is no limit */
  limit: number | null;
}
