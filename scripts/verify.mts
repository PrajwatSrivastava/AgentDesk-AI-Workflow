import { config } from "dotenv";

config({ path: ".env.local" });

const { and, asc, desc, eq, inArray } = await import("drizzle-orm");
const { db } = await import("@/db");
const { agents, approvals, runs, stepRuns, users, workflows } = await import("@/db/schema");
const { decide } = await import("@/core/approvals");
const { resumeRun, runWorkflow } = await import("@/core/executor");
const { formatMicros } = await import("@/lib/pricing");

// Run (or approve) one of a user's workflows from the CLI. Dry run unless --live.
//   tsx scripts/verify.mts <email> "Watch Hacker News" --fresh
//   tsx scripts/verify.mts <email> "Draft a post" --approve --edit "my text"
//   tsx scripts/verify.mts <email> "Watch Hacker News" --live
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const editIndex = args.indexOf("--edit");
const editText = editIndex === -1 ? undefined : args[editIndex + 1];
const positional = args.filter(
  (arg, index) => !arg.startsWith("--") && (editIndex === -1 || index !== editIndex + 1),
);

const [email, target] = positional;
if (!email || !target) {
  console.error('usage: tsx scripts/verify.mts <email> "<workflow name>" [--fresh] [--live] [--approve [--edit "text"]]');
  process.exit(1);
}
const dryRun = !flags.has("--live");
// clears lastRunAt so the run sees a full window
const fresh = flags.has("--fresh");
const approve = flags.has("--approve");

const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
if (!user) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}
const owned = await db.query.agents.findMany({ where: eq(agents.userId, user.id), columns: { id: true } });
const candidates = owned.length
  ? await db.query.workflows.findMany({
      where: inArray(workflows.agentId, owned.map((agent) => agent.id)),
      orderBy: asc(workflows.createdAt),
    })
  : [];
const workflow = candidates.find((row) => row.name.toLowerCase().includes(target.toLowerCase()));
if (!workflow) {
  console.error(`${email} has no workflow matching "${target}".`);
  process.exit(1);
}

if (approve) {
  const waiting = await db.query.runs.findFirst({
    where: and(eq(runs.workflowId, workflow.id), eq(runs.status, "waiting")),
    orderBy: desc(runs.startedAt),
  });
  if (!waiting) {
    console.error(`"${workflow.name}" has no run waiting for approval.`);
    process.exit(1);
  }

  const pending = await db.query.approvals.findFirst({
    where: and(eq(approvals.runId, waiting.id), eq(approvals.status, "pending")),
  });
  if (!pending) {
    console.error("That run is waiting but has no pending approval row.");
    process.exit(1);
  }

  console.log(`approving: ${pending.message}`);
  if (editText) console.log(`with edit: ${editText.slice(0, 80)}…`);

  await decide(pending.token, "approved", editText ? { value: editText } : undefined);
  const resumed = await resumeRun(waiting.id);

  await report(resumed.id);
} else {
  if (fresh) {
    await db
      .update(workflows)
      .set({ lastRunAt: null })
      .where(eq(workflows.id, workflow.id));
  }

  console.log(
    `running "${workflow.name}"${dryRun ? " (dry run)" : " (LIVE)"}${fresh ? " (full window)" : ""}\n`,
  );

  const run = await runWorkflow(workflow.id, "manual", { dryRun });
  await report(run.id);
}

// process.exit() here crashes libuv on Windows while sockets close; let the loop drain.

async function report(runId: string): Promise<void> {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  const steps = await db.query.stepRuns.findMany({
    where: eq(stepRuns.runId, runId),
    orderBy: (step, { asc }) => [asc(step.position)],
  });

  for (const step of steps) {
    const facts = [`${step.durationMs}ms`];
    if (step.tokensIn || step.tokensOut) {
      facts.push(`${(step.tokensIn ?? 0) + (step.tokensOut ?? 0)} tok`);
    }
    if (step.costMicros) facts.push(formatMicros(step.costMicros));

    console.log(
      `${step.position + 1}. ${step.stepId.padEnd(8)} ${step.type.padEnd(7)} ${step.status.padEnd(10)} ${facts.join(" · ")}`,
    );
    if (step.error) console.log(`   error: ${step.error.split("\n")[0]}`);
    if (step.output) {
      const preview = JSON.stringify(step.output);
      console.log(`   out:   ${preview.slice(0, 160)}${preview.length > 160 ? "…" : ""}`);
    }
  }

  console.log(`\nrun ${run?.status} · ${formatMicros(run?.costMicros ?? 0)}`);
  if (run?.errorMessage) console.log(`error: ${run.errorMessage}`);
  if (run?.haltReason) console.log(`halted: ${run.haltReason}`);
}
