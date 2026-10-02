import { cookies } from "next/headers";
import { appsNeedingConnection } from "@/integrations/registry";
import { CONNECTIONS_PROMPT_COOKIE } from "@/lib/session-cookie";
import { missingSettings, type ConnectionStates } from "@/lib/setup";
import { ConnectionsPromptDialog, type PromptApp } from "./ConnectionsPromptDialog";

/**
 * Asked once per sign-in while a required app isn't set up.
 * Uses the states the page already loaded to save a DB round trip.
 */
export async function ConnectionsPrompt({
  states,
  returnTo,
}: {
  states: ConnectionStates;
  returnTo: string;
}) {
  if ((await cookies()).get(CONNECTIONS_PROMPT_COOKIE)) return null;

  const apps: PromptApp[] = appsNeedingConnection().map((app) => {
    const saved = states.get(app.key);
    return {
      key: app.key,
      label: app.label,
      status:
        saved === undefined
          ? "not connected"
          : missingSettings(app.settings, saved).length > 0
            ? "needs details"
            : "ready",
      // Read-only apps (GitHub here) are optional
      optional: app.actions.every((action) => !action.sideEffect),
    };
  });

  if (apps.every((app) => app.status === "ready" || app.optional)) return null;

  return <ConnectionsPromptDialog apps={apps} returnTo={returnTo} />;
}
