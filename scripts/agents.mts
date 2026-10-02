import { config } from "dotenv";

config({ path: ".env.local" });

const { asc, eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { agents } = await import("@/db/schema");

// List agents by owner, or delete one (FKs cascade to workflows, runs, approvals).
//   tsx scripts/agents.mts
//   tsx scripts/agents.mts --delete <id>
const args = process.argv.slice(2);
const deleteIndex = args.indexOf("--delete");

if (deleteIndex !== -1) {
  const id = args[deleteIndex + 1];
  if (!id) {
    console.error("usage: tsx scripts/agents.mts --delete <id>");
    process.exit(1);
  }
  const [removed] = await db
    .delete(agents)
    .where(eq(agents.id, id))
    .returning({ name: agents.name });
  console.log(removed ? `deleted "${removed.name}"` : `no agent with id ${id}`);
} else {
  const rows = await db.query.agents.findMany({
    orderBy: asc(agents.createdAt),
    with: {
      user: { columns: { email: true } },
      workflows: { with: { runs: { columns: { id: true } } } },
    },
  });

  let owner = "";
  for (const agent of rows.sort((a, b) => a.user.email.localeCompare(b.user.email))) {
    if (agent.user.email !== owner) {
      owner = agent.user.email;
      console.log(`\n${owner}`);
    }
    const runs = agent.workflows.reduce((sum, workflow) => sum + workflow.runs.length, 0);
    console.log(
      `  ${agent.id}  ${agent.name} [${agent.type}]  ${agent.workflows.length} workflows, ${runs} runs`,
    );
    for (const workflow of agent.workflows) {
      console.log(`      ${workflow.enabled === 1 ? "on " : "off"}  ${workflow.name} (${workflow.runs.length} runs)`);
    }
  }
  console.log(`\n${rows.length} agents`);
}

// process.exit() crashes libuv on Windows while DB sockets are closing
process.exitCode = 0;
