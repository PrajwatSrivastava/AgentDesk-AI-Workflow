import { config } from "dotenv";

config({ path: ".env.local" });

const { asc, eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { workflows } = await import("@/db/schema");
const { WorkflowSpec } = await import("@/core/spec");
const { validateSpec } = await import("@/compiler/validate");
const { normalizeSpec } = await import("@/compiler/normalize");

// List stored workflows and re-validate them against the current registry.
//   tsx scripts/workflows.mts
//   tsx scripts/workflows.mts --delete <id>
//   tsx scripts/workflows.mts --show <id>
//   tsx scripts/workflows.mts --repair            preview mechanical fixes
//   tsx scripts/workflows.mts --repair --apply    write them
const args = process.argv.slice(2);
const deleteIndex = args.indexOf("--delete");
const showIndex = args.indexOf("--show");
const repair = args.includes("--repair");
const apply = args.includes("--apply");

if (deleteIndex !== -1) {
  const id = args[deleteIndex + 1];
  if (!id) {
    console.error("usage: tsx scripts/workflows.mts --delete <id>");
    process.exit(1);
  }
  const [removed] = await db
    .delete(workflows)
    .where(eq(workflows.id, id))
    .returning({ name: workflows.name });
  console.log(removed ? `deleted "${removed.name}"` : `no workflow with id ${id}`);
} else if (showIndex !== -1) {
  const id = args[showIndex + 1];
  const row = id
    ? await db.query.workflows.findFirst({ where: eq(workflows.id, id) })
    : undefined;
  if (!row) {
    console.error(`no workflow with id ${id ?? "(missing)"}`);
    process.exit(1);
  }
  console.log(JSON.stringify(row.spec, null, 2));
} else if (repair) {
  await repairAll(apply);
} else {
  await audit();
}

// Saved specs never go through the compiler again, so apply its normalize fixes here.
async function repairAll(write: boolean): Promise<void> {
  const rows = await db.query.workflows.findMany({ orderBy: asc(workflows.createdAt) });
  let repaired = 0;

  for (const row of rows) {
    const parsed = WorkflowSpec.safeParse(row.spec);
    if (!parsed.success) continue;

    const { spec, fixes } = normalizeSpec(parsed.data);
    if (fixes.length === 0) continue;

    const remaining = validateSpec(spec);
    console.log(`${row.name} (${row.id.slice(0, 8)})`);
    for (const fix of fixes) console.log(`   fix:   ${fix}`);
    console.log(
      remaining.length === 0
        ? "   after: valid"
        : `   after: still invalid — ${remaining.join("; ")}`,
    );

    if (write && remaining.length === 0) {
      await db.update(workflows).set({ spec }).where(eq(workflows.id, row.id));
      repaired++;
    }
  }

  console.log(
    write
      ? `\nwrote ${repaired} repaired workflow(s)`
      : "\npreview only — re-run with --apply to write",
  );
}

// No process.exit() on success: crashes libuv on Windows while DB sockets close

async function audit(): Promise<void> {
  const rows = await db.query.workflows.findMany({
    orderBy: asc(workflows.createdAt),
    with: { agent: true },
  });

  let broken = 0;
  for (const row of rows) {
    const parsed = WorkflowSpec.safeParse(row.spec);
    const problems = parsed.success
      ? validateSpec(parsed.data)
      : ["spec does not parse"];

    // Empty strings pass the schema but fail at run time
    if (parsed.success) {
      for (const step of parsed.data.steps) {
        if (step.type !== "action" && step.type !== "notify") continue;
        for (const [key, value] of Object.entries(step.params)) {
          if (typeof value === "string" && value.trim() === "") {
            problems.push(`step "${step.id}" passes an empty ${key}`);
          }
        }
      }
    }

    const state = problems.length === 0 ? "ok     " : "BROKEN ";
    if (problems.length > 0) broken++;

    console.log(
      `${state} ${row.enabled === 1 ? "on " : "off"}  ${row.id}  ${row.agent.name} / ${row.name}`,
    );
    for (const problem of problems) console.log(`         - ${problem}`);
  }

  console.log(`\n${rows.length} workflows, ${broken} broken`);
  if (broken > 0) {
    console.log("remove one with: npm run workflows -- --delete <id>");
  }
}