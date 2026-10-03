import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ConnectionsPrompt } from "@/components/ConnectionsPrompt";
import type { AgentValue } from "@/components/workspace/AgentSettings";
import { Workspace, type WorkflowSummary } from "@/components/workspace/Workspace";
import { WorkflowSpec } from "@/core/spec";
import { findOwnedAgentWithWorkflows } from "@/lib/access";
import { findAgentType, isIntegrationValue, isUnsetValue, valueField } from "@/lib/agent-types";
import { dailyLimitFor, runsUsedToday } from "@/lib/quota";
import { loadAgentRuns, loadLatestRunOfFirstWorkflow } from "@/lib/run-views";
import { requireUser } from "@/lib/session";
import { connectionStates, setupNeeds } from "@/lib/setup";
import { toSpecView } from "@/lib/spec-view";

// Applies to this page's server actions too. A run that searches, reads pages and calls the
// model several times can take a minute or more. 300 s is the Vercel Hobby limit with Fluid compute.
export const maxDuration = 300;

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const [user, { id }, { welcome }] = await Promise.all([requireUser(), params, searchParams]);

  // Every query filters by user, so they can all run together without a prior ownership check.
  const [agent, states, used, recent, latestRun] = await Promise.all([
    findOwnedAgentWithWorkflows(user.id, id),
    connectionStates(user.id),
    runsUsedToday(user.id, user.timeZone),
    loadAgentRuns(user.id, id),
    loadLatestRunOfFirstWorkflow(user.id, id),
  ]);
  // also covers agents owned by someone else
  if (!agent) notFound();

  // Skip specs that no longer parse so one bad row can't break the page.
  const summaries: WorkflowSummary[] = [];
  for (const row of agent.workflows) {
    const parsed = WorkflowSpec.safeParse(row.spec);
    if (!parsed.success) continue;
    summaries.push({
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      view: toSpecView(parsed.data),
      setup: setupNeeds(parsed.data, agent.vars, states),
    });
  }

  // Integration values are managed on the Connections page.
  const ownValues = Object.entries(agent.vars).filter(([key]) => !isIntegrationValue(key));
  const values: AgentValue[] = ownValues.map(([key, value]) => {
    const field = valueField(key);
    return {
      key,
      label: field.label,
      value,
      unset: isUnsetValue(value),
      hint: field.hint,
      placeholder: field.placeholder,
    };
  });

  const type = findAgentType(agent.type);
  // The workspace opens on the first workflow, so its latest run is preloaded.
  const initialRun = latestRun && latestRun.workflowId === summaries[0]?.id ? latestRun : null;

  return (
    <>
      <AppHeader
        title={agent.name}
        subtitle={agent.role}
        avatarColor={type?.avatarColor ?? "#5c6ff0"}
      />
      <div className="flex min-h-0 flex-1 flex-col py-6">
        <Workspace
          userId={user.id}
          timeZone={user.timeZone}
          agentId={agent.id}
          agentName={agent.name}
          workflows={summaries}
          values={values}
          allowance={{ used, limit: dailyLimitFor(user) }}
          initialRecent={recent}
          initialRun={initialRun}
          welcome={welcome === "1"}
        />
      </div>
      <ConnectionsPrompt states={states} returnTo={`/agents/${agent.id}`} />
    </>
  );
}
