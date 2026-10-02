import { createDecipheriv, randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const { decryptSecret, encryptSecret, keyFromHex } = await import("@/lib/crypto");
const { env } = await import("@/lib/env");

// One-off: assign all existing data to a new passwordless owner account (claimed by signing up).
//   tsx scripts/migrate-multi-user.mts <owner-email>
// Credentials are re-encrypted bound to the owner and checked in memory first. Single transaction.
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("usage: tsx scripts/migrate-multi-user.mts <owner-email>");
  process.exit(1);
}

const sql = neon(env.databaseUrl);

const [state] = (await sql`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'user_id'
  ) AS migrated
`) as { migrated: boolean }[];
if (state.migrated) {
  console.log("Already migrated: agents have owners. Nothing to do.");
  process.exit(0);
}

const key = keyFromHex(env.encryptionKey);
const ownerId = randomUUID();

// Pre-user secret formats: v1 (no AAD) and v2 (AAD connection:<app>)
function openOld(app: string, payload: string): string {
  const parts = payload.split(".");
  const [ivPart, tagPart, dataPart, aad] =
    parts[0] === "v2"
      ? [parts[1], parts[2], parts[3], Buffer.from(`connection:${app}`, "utf8")]
      : [parts[0], parts[1], parts[2], undefined];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

const stored = (await sql`SELECT id, app, secret FROM connections`) as {
  id: string;
  app: string;
  secret: string;
}[];

const reencrypted: { id: string; app: string; secret: string }[] = [];
const unreadable: string[] = [];
for (const row of stored) {
  try {
    const plaintext = openOld(row.app, row.secret);
    const secret = encryptSecret({ userId: ownerId, app: row.app }, plaintext, key);
    if (decryptSecret({ userId: ownerId, app: row.app }, secret, key) !== plaintext) {
      throw new Error("round trip mismatch");
    }
    reencrypted.push({ id: row.id, app: row.app, secret });
  } catch {
    unreadable.push(row.app);
  }
}
if (unreadable.length > 0) {
  console.error(
    `Nothing changed. Could not open the saved ${unreadable.join(", ")} credential(s) with the\n` +
      "current ENCRYPTION_KEY. Fix the key, or remove those connections, then run this again.",
  );
  process.exit(1);
}

await sql.transaction([
  sql`CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    time_zone text DEFAULT 'UTC' NOT NULL,
    run_limit_exempt boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
  )`,
  sql`CREATE UNIQUE INDEX users_email_idx ON users (email)`,
  sql`CREATE TABLE sessions (
    token_hash text PRIMARY KEY NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  sql`CREATE INDEX sessions_user_idx ON sessions (user_id)`,
  sql`CREATE TABLE daily_run_usage (
    user_id uuid NOT NULL,
    day date NOT NULL,
    runs integer DEFAULT 0 NOT NULL,
    CONSTRAINT daily_run_usage_user_id_day_pk PRIMARY KEY (user_id, day),
    CONSTRAINT daily_run_usage_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  sql`INSERT INTO users (id, email) VALUES (${ownerId}, ${email})`,

  sql`ALTER TABLE agents ADD COLUMN user_id uuid`,
  sql`UPDATE agents SET user_id = ${ownerId}`,
  sql`ALTER TABLE agents ALTER COLUMN user_id SET NOT NULL`,
  sql`ALTER TABLE agents ADD CONSTRAINT agents_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
  sql`CREATE INDEX agents_user_idx ON agents (user_id)`,

  // In the current schema and read by sign-in/run code
  sql`ALTER TABLE connections ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb NOT NULL`,
  sql`ALTER TABLE connections ADD COLUMN user_id uuid`,
  sql`UPDATE connections SET user_id = ${ownerId}`,
  ...reencrypted.map((row) => sql`UPDATE connections SET secret = ${row.secret} WHERE id = ${row.id}`),
  sql`ALTER TABLE connections ALTER COLUMN user_id SET NOT NULL`,
  sql`ALTER TABLE connections ADD CONSTRAINT connections_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
  sql`DROP INDEX IF EXISTS connections_app_idx`,
  sql`CREATE UNIQUE INDEX connections_user_app_idx ON connections (user_id, app)`,
]);

const [counts] = (await sql`
  SELECT (SELECT count(*) FROM agents WHERE user_id = ${ownerId}) AS agents,
         (SELECT count(*) FROM connections WHERE user_id = ${ownerId}) AS connections
`) as { agents: string; connections: string }[];

console.log(`Owner account created for ${email} (no password yet).`);
console.log(`Moved to it: ${counts.agents} agent(s), ${counts.connections} credential(s): ${reencrypted.map((row) => row.app).join(", ") || "none"}.`);
console.log(`\nSign up with ${email} to claim it and set your password.`);
process.exitCode = 0;
