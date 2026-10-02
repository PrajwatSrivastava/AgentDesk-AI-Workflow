import { config } from "dotenv";

config({ path: ".env.local" });

const { and, eq, inArray } = await import("drizzle-orm");
const { db } = await import("@/db");
const { agents, users } = await import("@/db/schema");
const { AGENT_TYPES } = await import("@/lib/agent-types");
const { installAgents } = await import("@/lib/starter-agents");

// Top up one user's starter agents after types change in lib/agent-types.ts.
//   tsx scripts/seed.mts <email>            add any starter types that user lacks
//   tsx scripts/seed.mts <email> --prune    also delete their agents of retired types
const args = process.argv.slice(2);
const prune = args.includes("--prune");
const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
if (!email) {
  console.error("usage: tsx scripts/seed.mts <email> [--prune]");
  process.exit(1);
}

const user = await db.query.users.findFirst({ where: eq(users.email, email) });
if (!user) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}

const existing = await db.query.agents.findMany({
  where: eq(agents.userId, user.id),
  with: { workflows: { with: { runs: { columns: { id: true } } } } },
});
const currentTypes = new Set(AGENT_TYPES.map((type) => type.key));

if (prune) {
  const retired = existing.filter((agent) => !currentTypes.has(agent.type));
  for (const agent of retired) {
    const runs = agent.workflows.reduce((sum, workflow) => sum + workflow.runs.length, 0);
    console.log(
      `remove ${agent.name} [${agent.type}] with ${agent.workflows.length} workflow(s), ${runs} run(s)`,
    );
  }
  if (retired.length > 0) {
    // ON DELETE CASCADE removes workflows, runs and approvals
    await db.delete(agents).where(
      and(
        eq(agents.userId, user.id),
        inArray(
          agents.id,
          retired.map((agent) => agent.id),
        ),
      ),
    );
  }
}

const present = new Set(existing.map((agent) => agent.type));
const missing = AGENT_TYPES.filter((type) => !present.has(type.key));
for (const type of AGENT_TYPES) {
  console.log(`${present.has(type.key) ? "skip  " : "create"} ${type.name}`);
}
const created = await installAgents(user.id, missing);

console.log(`\n${created} agent(s) created for ${email}`);
process.exitCode = 0;
