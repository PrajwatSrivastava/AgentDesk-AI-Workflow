import { and, count, eq, gte } from "drizzle-orm";
import { runWorkflow } from "@/core/executor";
import { WorkflowSpec } from "@/core/spec";
import { db } from "@/db";
import { runs, workflows } from "@/db/schema";
import { isUuid } from "@/lib/access";
import { fail, handle, ok } from "@/lib/api";
import { DailyLimitError } from "@/lib/quota";

// Schedules can't loop (next_run_at advances when claimed), but a webhook workflow
// that posts somewhere which calls back here can. This caps it.
const MAX_RUNS_PER_HOUR = 60;

// Body is stored with the run and may end up in a prompt
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { workflowId } = await params;
    // Postgres errors on a malformed uuid
    if (!isUuid(workflowId)) return fail("No such workflow", 404);

    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });
    if (!workflow) return fail("No such workflow", 404);
    if (workflow.enabled !== 1) {
      return fail("This workflow is disabled", 409, "Enable it on the agent's page.");
    }

    const spec = WorkflowSpec.parse(workflow.spec);
    if (spec.trigger.type !== "webhook") {
      return fail(
        `This workflow is triggered by ${spec.trigger.type}, not a webhook`,
        409,
      );
    }

    const anHourAgo = new Date(Date.now() - 3_600_000);
    const [recent] = await db
      .select({ total: count() })
      .from(runs)
      .where(and(eq(runs.workflowId, workflowId), gte(runs.startedAt, anHourAgo)));

    if ((recent?.total ?? 0) >= MAX_RUNS_PER_HOUR) {
      return fail(
        `This workflow has already run ${MAX_RUNS_PER_HOUR} times in the last hour`,
        429,
        "Runs are capped per hour to stop a webhook loop. Check whether something this workflow writes to is calling it back.",
      );
    }

    const body = await readBody(request);
    if (body === TOO_LARGE) return fail(`The body is over ${MAX_BODY_BYTES / 1024} KB`, 413);
    try {
      const run = await runWorkflow(workflowId, "webhook", {}, body);
      return ok({ runId: run.id, status: run.status }, 202);
    } catch (error) {
      if (error instanceof DailyLimitError) return fail(error.message, 429);
      throw error;
    }
  });
}

const TOO_LARGE = Symbol("too large");

// Stops reading at the limit so a huge body is never buffered whole.
// NUL chars are stripped because Postgres jsonb rejects them.
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return TOO_LARGE;

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8").replaceAll("\u0000", "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // non-JSON bodies are passed through as text
    return text;
  }
}
