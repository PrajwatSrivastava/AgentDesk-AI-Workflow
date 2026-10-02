import { config } from "dotenv";

config({ path: ".env.local" });

const { eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { connections } = await import("@/db/schema");
const { env } = await import("@/lib/env");
const { decryptSecret, encryptSecret, keyFromHex } = await import("@/lib/crypto");

// Rotate the credential encryption key. Writes nothing unless every secret round-trips.
//   NEW_ENCRYPTION_KEY=<64 hex chars> tsx scripts/reencrypt.mts
//   (make a key with: npm run keygen)
const newHex = process.env.NEW_ENCRYPTION_KEY?.trim();
if (!newHex) {
  console.error("Set NEW_ENCRYPTION_KEY to the key to rotate to (npm run keygen makes one).");
  process.exit(1);
}
const currentKey = keyFromHex(env.encryptionKey);
const targetKey = keyFromHex(newHex);
if (targetKey.equals(currentKey)) {
  console.error("NEW_ENCRYPTION_KEY is the same as the current ENCRYPTION_KEY.");
  process.exit(1);
}

const rows = await db.query.connections.findMany();
if (rows.length === 0) {
  console.log("No stored connections; nothing to do. Just replace ENCRYPTION_KEY.");
} else {
  const failures: string[] = [];
  const updates: { id: string; label: string; secret: string }[] = [];

  for (const row of rows) {
    const owner = { userId: row.userId, app: row.app };
    try {
      const plaintext = decryptSecret(owner, row.secret, currentKey);
      const secret = encryptSecret(owner, plaintext, targetKey);
      if (decryptSecret(owner, secret, targetKey) !== plaintext) throw new Error("mismatch");
      updates.push({ id: row.id, label: `${row.app} (user ${row.userId.slice(0, 8)})`, secret });
    } catch {
      failures.push(`${row.app} (user ${row.userId.slice(0, 8)})`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `Nothing written. Could not open: ${failures.join(", ")}.\n` +
        "Either ENCRYPTION_KEY in .env.local is not the key these were saved under, or\n" +
        "the stored value was altered. Those users need to re-paste the credential.",
    );
    process.exitCode = 1;
  } else {
    const [first, ...rest] = updates.map((update) =>
      db.update(connections).set({ secret: update.secret }).where(eq(connections.id, update.id)),
    );
    await db.batch([first, ...rest]);

    for (const update of updates) console.log(`re-encrypted ${update.label}`);
    console.log(
      `\n${updates.length} secret(s) written.\n\n` +
        "Now replace ENCRYPTION_KEY in .env.local with the new key and restart the server.\n" +
        "Until you do, the running app cannot read these secrets.",
    );
    process.exitCode = 0;
  }
}
