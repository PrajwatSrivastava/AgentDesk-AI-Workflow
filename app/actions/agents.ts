"use server";

import { and, eq } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { agents, workflows } from "@/db/schema";
import { describeError } from "@/integrations/http";
import { geocode, placeLabel } from "@/integrations/weather";
import { findOwnedAgent, isUuid } from "@/lib/access";
import { findAgentType, isIntegrationValue, valueField } from "@/lib/agent-types";
import { requireUser } from "@/lib/session";
import type { SetupResult } from "@/lib/setup";

/** Preset workflows are installed disabled so they can be tested before going live. */
export async function createAgent(typeKey: string): Promise<{ id: string }> {
  const user = await requireUser();
  const type = findAgentType(typeKey);
  if (!type) throw new Error(`Unknown agent type: ${typeKey}`);

  const [agent] = await db
    .insert(agents)
    .values({
      userId: user.id,
      type: type.key,
      name: type.name,
      role: type.role,
      persona: type.persona,
      avatarSeed: `${type.key}-${Date.now()}`,
      vars: type.vars,
    })
    .returning({ id: agents.id });

  for (const preset of type.presets) {
    await db.insert(workflows).values({
      agentId: agent.id,
      name: preset.name,
      spec: preset.spec,
      enabled: 0,
    });
  }

  revalidatePath("/");
  return agent;
}

/** Workflows, runs and approvals are removed by FK cascades. Scoped to the user's own agents. */
export async function deleteAgent(agentId: string): Promise<void> {
  const user = await requireUser();
  if (isUuid(agentId)) {
    await db.delete(agents).where(and(eq(agents.id, agentId), eq(agents.userId, user.id)));
  }
  revalidatePath("/");
  redirect("/");
}

// Same key format the compiler and templates accept
const VALUE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const MAX_VALUE_LENGTH = 300;

/** Sets an {{agent.*}} value. Places are geocoded first, since a bad city would fail every run. */
export async function saveAgentValue(
  agentId: string,
  key: string,
  value: string,
): Promise<SetupResult> {
  const user = await requireUser();
  if (!VALUE_KEY.test(key)) return { ok: false, error: "That is not a valid setting name" };
  if (isIntegrationValue(key)) {
    return { ok: false, error: "This is set on the Connections page, not per agent." };
  }

  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Enter a value first" };
  if (trimmed.length > MAX_VALUE_LENGTH) {
    return { ok: false, error: `Keep it under ${MAX_VALUE_LENGTH} characters` };
  }

  const agent = await findOwnedAgent(user.id, agentId);
  if (!agent) return { ok: false, error: "That agent no longer exists." };

  let detail = "Saved.";
  try {
    if (valueField(key).check === "place") {
      detail = `Found ${placeLabel(await geocode(trimmed))}.`;
    }
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }

  await db
    .update(agents)
    .set({ vars: { ...agent.vars, [key]: trimmed } })
    .where(eq(agents.id, agent.id));

  refresh();
  return { ok: true, detail };
}
