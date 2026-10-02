import { config } from "dotenv";

config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const { env } = await import("@/lib/env");
const { DAILY_RUN_LIMIT } = await import("@/lib/quota");

// Toggle the daily run limit for one account (usage is still counted). Adds the column if missing.
//   tsx scripts/run-limit.mts <email> unlimited
//   tsx scripts/run-limit.mts <email> default
const [rawEmail, mode] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!email || (mode !== "unlimited" && mode !== "default")) {
  console.error("usage: tsx scripts/run-limit.mts <email> <unlimited|default>");
  process.exit(1);
}

const sql = neon(env.databaseUrl);
await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS run_limit_exempt boolean DEFAULT false NOT NULL`;

const updated = (await sql`
  UPDATE users SET run_limit_exempt = ${mode === "unlimited"}
  WHERE email = ${email}
  RETURNING email
`) as { email: string }[];

if (updated.length === 0) {
  console.error(`No account for ${email}.`);
  process.exitCode = 1;
} else {
  console.log(
    mode === "unlimited"
      ? `${email} now has no daily run limit.`
      : `${email} is back to the default limit of ${DAILY_RUN_LIMIT} runs a day.`,
  );
  process.exitCode = 0;
}
