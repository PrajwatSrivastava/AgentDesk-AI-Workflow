"use server";

import { tickOnce } from "@/core/tick";
import { dailyLimitFor, runsUsedToday, type RunAllowance } from "@/lib/quota";
import { loadAgentRuns, loadLatestRun, type RunSummary, type RunView } from "@/lib/run-views";
import { requireUser, type CurrentUser } from "@/lib/session";

// The DB can be ~250ms away, so each action checks the session once and then reads in parallel.

export async function getLatestRun(workflowId: string): Promise<RunView | null> {
  const user = await requireUser();
  return loadLatestRun(user.id, workflowId);
}

export interface AgentSnapshot {
  runs: RunSummary[];
  /** null when no workflow is selected */
  run: RunView | null;
  allowance: RunAllowance;
}

async function snapshot(
  user: CurrentUser,
  agentId: string,
  workflowId: string | null,
): Promise<AgentSnapshot> {
  const [runs, run, used] = await Promise.all([
    loadAgentRuns(user.id, agentId),
    workflowId ? loadLatestRun(user.id, workflowId) : Promise.resolve(null),
    runsUsedToday(user.id, user.timeZone),
  ]);
  return { runs, run, allowance: { used, limit: dailyLimitFor(user) } };
}

export async function refreshAgent(
  agentId: string,
  workflowId: string | null,
): Promise<AgentSnapshot> {
  const user = await requireUser();
  return snapshot(user, agentId, workflowId);
}

export interface AgentPoll extends AgentSnapshot {
  /** Workflows run by this tick */
  claimed: number;
}

// The tick is global: any polling tab runs every user's due workflows, each with its owner's credentials.
export async function pollAgent(agentId: string, workflowId: string | null): Promise<AgentPoll> {
  const user = await requireUser();
  const { claimed } = await tickOnce();
  return { claimed, ...(await snapshot(user, agentId, workflowId)) };
}

/** For hidden tabs: runs due work without re-reading the workspace. */
export async function tickFromDashboard(): Promise<{ claimed: number }> {
  await requireUser();
  const { claimed } = await tickOnce();
  return { claimed };
}
