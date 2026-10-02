import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, workflows } from "@/db/schema";

// All lookups by browser-supplied id go through here. Another user's record
// and a missing one both return null, so ids can't be probed.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on a malformed uuid, so callers treat it as not found. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export async function findOwnedAgent(userId: string, agentId: string) {
  if (!isUuid(agentId)) return null;
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.userId, userId)),
  });
  return agent ?? null;
}

export async function findOwnedAgentWithWorkflows(userId: string, agentId: string) {
  if (!isUuid(agentId)) return null;
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.userId, userId)),
    with: { workflows: { orderBy: (workflow, { asc }) => [asc(workflow.createdAt)] } },
  });
  return agent ?? null;
}

export async function findOwnedWorkflow(userId: string, workflowId: string) {
  if (!isUuid(workflowId)) return null;
  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
    with: { agent: true },
  });
  return workflow && workflow.agent.userId === userId ? workflow : null;
}
