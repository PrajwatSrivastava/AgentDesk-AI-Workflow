import { db } from "@/db";
import { agents, workflows } from "@/db/schema";
import { AGENT_TYPES, findAgentType, type AgentType } from "./agent-types";

/** Workflows start disabled until the user finishes setup and turns them on. */
export async function installAgents(
  userId: string,
  types: readonly AgentType[] = AGENT_TYPES,
): Promise<number> {
  if (types.length === 0) return 0;

  const created = await db
    .insert(agents)
    .values(
      types.map((type) => ({
        userId,
        type: type.key,
        name: type.name,
        role: type.role,
        persona: type.persona,
        avatarSeed: type.key,
        vars: type.vars,
      })),
    )
    .returning({ id: agents.id, type: agents.type });

  // Match by type, RETURNING order isn't guaranteed
  const presets = created.flatMap((agent) =>
    (findAgentType(agent.type)?.presets ?? []).map((preset) => ({
      agentId: agent.id,
      name: preset.name,
      spec: preset.spec,
      enabled: 0,
    })),
  );
  if (presets.length > 0) await db.insert(workflows).values(presets);

  return created.length;
}
