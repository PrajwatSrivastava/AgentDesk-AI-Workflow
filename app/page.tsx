import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ConnectionsPrompt } from "@/components/ConnectionsPrompt";
import { SetupNotice } from "@/components/SetupNotice";
import { db } from "@/db";
import { agents, workflows } from "@/db/schema";
import { AGENT_TYPES, findAgentType } from "@/lib/agent-types";
import { findApp } from "@/integrations/registry";
import { AccountMenu } from "@/components/AccountMenu";
import { getCurrentUser, type CurrentUser } from "@/lib/session";
import { connectionStates } from "@/lib/setup";
import { redirect } from "next/navigation";

// Without this the build prerenders the page with no DB and bakes in the setup notice.
export const dynamic = "force-dynamic";

interface AgentCard {
  id: string;
  type: string;
  name: string;
  description: string;
  color: string;
  skills: number;
  suggests: string[];
}

async function loadAgents(user: CurrentUser): Promise<AgentCard[] | { error: string }> {
  try {
    const rows = await db
      .select({
        id: agents.id,
        type: agents.type,
        name: agents.name,
        role: agents.role,
        skills: count(workflows.id),
      })
      .from(agents)
      .leftJoin(workflows, eq(workflows.agentId, agents.id))
      .where(eq(agents.userId, user.id))
      .groupBy(agents.id)
      .orderBy(agents.createdAt);

    return rows.map((row) => {
      const type = findAgentType(row.type);
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        description: type?.description ?? row.role,
        color: type?.avatarColor ?? "#5c6ff0",
        skills: Number(row.skills),
        suggests: type?.suggests ?? [],
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function LandingPage() {
  let user: CurrentUser | null;
  try {
    user = await getCurrentUser();
  } catch (error) {
    // no database configured yet
    return <SetupNotice message={error instanceof Error ? error.message : String(error)} />;
  }
  if (!user) redirect("/login");

  const [result, states] = await Promise.all([
    loadAgents(user),
    connectionStates(user.id).catch(() => new Map<string, Record<string, string>>()),
  ]);

  if ("error" in result) {
    return <SetupNotice message={result.error} />;
  }

  const hasAgents = result.length > 0;

  return (
    <main className="bg-lavender flex-1">
      <ConnectionsPrompt states={states} returnTo="/" />
      <AccountMenu />
      <div className="mx-auto max-w-5xl px-6 py-20">
        <header className="text-center">
          <h1 className="mx-auto max-w-2xl text-5xl leading-[1.05] font-bold tracking-[-0.02em] text-balance sm:text-6xl">
            Build an <span className="text-accent">AI team</span> that works for you
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-[17px] text-muted">
            Describe a job in plain English. Your agent turns it into a workflow you
            can read, then runs it on a schedule.
          </p>
        </header>

        {hasAgents ? (
          <>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {result.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="group bg-surface flex flex-col rounded-2xl border border-rule p-6 transition-colors hover:border-ink/20"
                >
                  <div className="flex justify-center py-6">
                    <AgentAvatar color={agent.color} size={108} />
                  </div>
                  <h2 className="text-[17px] font-semibold">{agent.name}</h2>
                  <p className="text-muted mt-1 text-sm leading-snug">
                    {agent.description}
                  </p>
                  <div className="text-muted mt-5 flex items-baseline justify-between border-t border-rule pt-3 text-xs">
                    <span>
                      {agent.skills} {agent.skills === 1 ? "skill" : "skills"}
                    </span>
                    <span className="truncate pl-3 text-right">
                      {agent.suggests
                        .map((key) => findApp(key)?.label ?? key)
                        .join(" · ")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            <div className="mt-12 text-center">
              <Link
                href="/onboard"
                className="bg-ink text-paper inline-flex h-11 items-center rounded-lg px-6 text-sm font-medium transition-colors hover:bg-ink/90"
              >
                Hire another agent
              </Link>
            </div>
          </>
        ) : (
          <div className="mt-14">
            <p className="text-muted mb-5 text-center text-sm">
              No agents yet. Pick a role to start with.
            </p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {AGENT_TYPES.slice(0, 3).map((type) => (
                <Link
                  key={type.key}
                  href={`/onboard?type=${type.key}`}
                  className="bg-surface flex flex-col rounded-2xl border border-rule p-6 transition-colors hover:border-ink/20"
                >
                  <div className="flex justify-center py-6">
                    <AgentAvatar color={type.avatarColor} size={108} />
                  </div>
                  <h2 className="text-[17px] font-semibold">{type.name}</h2>
                  <p className="text-muted mt-1 text-sm leading-snug">
                    {type.description}
                  </p>
                </Link>
              ))}
            </div>
            <div className="mt-12 text-center">
              <Link
                href="/onboard"
                className="bg-ink text-paper inline-flex h-11 items-center rounded-lg px-6 text-sm font-medium transition-colors hover:bg-ink/90"
              >
                Get started
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
