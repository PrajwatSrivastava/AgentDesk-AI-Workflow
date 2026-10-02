import { config } from "dotenv";

config({ path: ".env.local" });

const { findAction } = await import("@/integrations/registry");

// Run one integration action against the live service (no LLM, no DB).
//   tsx scripts/probe-action.mts hackernews top_stories '{"limit":5}'
const [app, name, argvParams] = process.argv.slice(2);
if (!app || !name) {
  console.error(
    "usage: tsx scripts/probe-action.mts <app> <action> '<json params>'\n" +
      "   or: set PROBE_PARAMS to the JSON and omit the argument",
  );
  process.exit(1);
}

// Use PROBE_PARAMS on Windows; PowerShell mangles quotes in JSON args
const rawParams = process.env.PROBE_PARAMS ?? argvParams ?? "{}";

const action = findAction(app, name);
if (!action) {
  console.error(`No action ${app}.${name}`);
  process.exit(1);
}

const params = JSON.parse(rawParams) as Record<string, unknown>;
const secret = process.env[`PROBE_SECRET`];

console.log(`${app}.${name}  params=${JSON.stringify(params)}\n`);

// exitCode, not process.exit() (libuv crash on Windows)
try {
  const started = Date.now();
  const output = await action.run(params, secret);
  console.log(`ok in ${Date.now() - started}ms\n`);
  console.log(JSON.stringify(output, null, 2).slice(0, 1800));
  process.exitCode = 0;
} catch (error) {
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}