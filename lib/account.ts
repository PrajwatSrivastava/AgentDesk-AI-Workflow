import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, approvals, runs, workflows } from "@/db/schema";
import { appsNeedingConnection } from "@/integrations/registry";
import { runsUsedToday } from "./quota";
import type { CurrentUser } from "./session";
import { connectionStates, missingSettings } from "./setup";

export interface PendingApproval {
  token: string;
  message: string;
  agentName: string;
  workflowName: string;
  /** ISO string */
  createdAt: string;
}

export interface AccountSummary {
  runsToday: number;
  /** Connected with all required settings filled in. */
  appsReady: number;
  appsTotal: number;
  approvals: PendingApproval[];
  /** Total pending, can be more than approvals.length. */
  approvalsWaiting: number;
}

const MENU_APPROVALS = 3;

/** `total` is a window count, so it ignores the limit. */
export async function loadPendingApprovals(
  userId: string,
  limit: number,
): Promise<{ items: PendingApproval[]; total: number }> {
  const rows = await db
    .select({
      token: approvals.token,
      message: approvals.message,
      agentName: agents.name,
      workflowName: workflows.name,
      createdAt: approvals.createdAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(approvals)
    .innerJoin(runs, eq(approvals.runId, runs.id))
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .innerJoin(agents, eq(workflows.agentId, agents.id))
    .where(
      and(eq(agents.userId, userId), eq(approvals.status, "pending"), eq(runs.status, "waiting")),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(limit);

  return {
    items: rows.map((row) => ({
      token: row.token,
      message: row.message,
      agentName: row.agentName,
      workflowName: row.workflowName,
      createdAt: row.createdAt.toISOString(),
    })),
    total: rows[0]?.total ?? 0,
  };
}

export async function loadAccountSummary(user: CurrentUser): Promise<AccountSummary> {
  const [runsToday, states, pending] = await Promise.all([
    runsUsedToday(user.id, user.timeZone),
    connectionStates(user.id),
    loadPendingApprovals(user.id, MENU_APPROVALS),
  ]);
  const apps = appsNeedingConnection();
  const appsReady = apps.filter((app) => {
    const saved = states.get(app.key);
    return saved !== undefined && !saved.lastError && missingSettings(app.settings, saved.settings).length === 0;
  }).length;

  return {
    runsToday,
    appsReady,
    appsTotal: apps.length,
    approvals: pending.items,
    approvalsWaiting: pending.total,
  };
}
