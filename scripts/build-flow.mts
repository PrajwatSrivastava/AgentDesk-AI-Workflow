import { config } from "dotenv";

config({ path: ".env.local" });

const { and, asc, eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { agents, users, workflows } = await import("@/db/schema");
const { compile } = await import("@/compiler/compile");
const { toSpecView } = await import("@/lib/spec-view");
const { formatMicros } = await import("@/lib/pricing");

// Compile a request like the chat pane does and save it (disabled) for one account.
//   tsx scripts/build-flow.mts <email> <agent-type> "<request>" [--agent <id-prefix>]
const args = process.argv.slice(2);
const agentIndex = args.indexOf("--agent");
const agentPrefix = agentIndex === -1 ? undefined : args[agentIndex + 1];
const [email, typeKey, request] = args.filter(
  (arg, index) => !arg.startsWith("--") && (agentIndex === -1 || index !== agentIndex + 1),
);
if (!email || !typeKey || !request) {
  console.error(
    'usage: tsx scripts/build-flow.mts <email> <agent-type> "<request>" [--agent <id-prefix>]',
  );
  process.exit(1);
}

const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
if (!user) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}

// Several agents can share a type; default to the oldest
const matching = await db.query.agents.findMany({
  where: and(eq(agents.userId, user.id), eq(agents.type, typeKey)),
  orderBy: asc(agents.createdAt),
});
const agent = agentPrefix
  ? matching.find((candidate) => candidate.id.startsWith(agentPrefix))
  : matching.at(0);
if (!agent) {
  console.error(
    agentPrefix
      ? `No ${typeKey} agent with id starting "${agentPrefix}". Candidates: ${matching
          .map((candidate) => candidate.id.slice(0, 8))
          .join(", ")}`
      : `${email} has no agent of type "${typeKey}". Run npm run seed -- ${email} first.`,
  );
  process.exit(1);
}
if (!agentPrefix && matching.length > 1) {
  console.log(
    `note: ${matching.length} agents of this type; using the oldest (${agent.id.slice(0, 8)}). Pass --agent to choose.`,
  );
}

console.log(`agent:   ${agent.name}`);
console.log(`vars:    ${JSON.stringify(agent.vars)}`);
console.log(`request: ${request}\n`);

const result = await compile({
  request,
  agentName: agent.name,
  agentRole: agent.role,
  agentVars: agent.vars,
});

if (!result.ok) {
  console.error(`compile failed: ${result.message}`);
  for (const problem of result.problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const view = toSpecView(result.spec);
console.log(`compiled "${view.name}" — runs ${view.triggerLabel}`);
for (const [index, step] of view.steps.entries()) {
  console.log(`  ${index + 1}. ${step.label}  [${step.kind}]`);
}
console.log(
  `\nattempts: ${result.usage.attempts} · cost: ${formatMicros(result.usage.costMicros)} · model: ${result.usage.model ?? "unknown"}`,
);
for (const fix of result.fixes) console.log(`repaired: ${fix}`);

// Not via saveWorkflow: its revalidatePath call needs a Next request context.
const [saved] = await db
  .insert(workflows)
  .values({
    agentId: agent.id,
    name: result.spec.name,
    spec: result.spec,
    enabled: 0,
  })
  .returning({ id: workflows.id });

console.log(`saved as ${saved.id}`);
console.log(`\nnext: npm run verify -- ${email} "${view.name}" --fresh`);
process.exitCode = 0;