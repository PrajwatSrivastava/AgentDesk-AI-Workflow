import { config } from "dotenv";

config({ path: ".env.local" });

const { and, asc, eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { agents, users } = await import("@/db/schema");

// Sets a var on all of one user's agents of that type.
//   tsx scripts/set-agent-var.mts <email> <agent-type> <key> <value>
const [rawEmail, typeKey, key, value] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!email || !typeKey || !key || value === undefined) {
  console.error("usage: tsx scripts/set-agent-var.mts <email> <agent-type> <key> <value>");
  process.exit(1);
}

const user = await db.query.users.findFirst({ where: eq(users.email, email) });
if (!user) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}

const matching = await db.query.agents.findMany({
  where: and(eq(agents.userId, user.id), eq(agents.type, typeKey)),
  orderBy: asc(agents.createdAt),
});
if (matching.length === 0) {
  console.error(`${email} has no agent of type "${typeKey}".`);
  process.exit(1);
}

for (const agent of matching) {
  await db
    .update(agents)
    .set({ vars: { ...agent.vars, [key]: value } })
    .where(and(eq(agents.id, agent.id), eq(agents.userId, user.id)));
  console.log(`${agent.name} (${agent.id.slice(0, 8)}): ${key} = ${JSON.stringify(value)}`);
}

console.log(`\nupdated ${matching.length} agent(s)`);
process.exitCode = 0;
