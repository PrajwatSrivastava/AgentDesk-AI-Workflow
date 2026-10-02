import { z } from "zod";

/** `params` validates arguments at run time and also generates the compiler's catalog. */
export interface Action {
  app: string;
  action: string;
  description: string;
  /** Output shape for the catalog. A guessed field name resolves to nothing and halts the run. */
  returns?: string;
  params: z.ZodObject<z.ZodRawShape>;
  /** Connection key this action needs a secret for, if any. */
  needs?: string;
  /** Param name -> connection setting key, used when the spec leaves the param out (e.g. Notion pageId). */
  settingDefaults?: Record<string, string>;
  /** Externally visible effect, skipped on dry runs. */
  sideEffect: boolean;
  run(params: unknown, secret?: string): Promise<unknown>;
}

interface ActionInput<S extends z.ZodObject<z.ZodRawShape>> {
  app: string;
  action: string;
  description: string;
  returns?: string;
  params: S;
  needs?: string;
  settingDefaults?: Record<string, string>;
  sideEffect?: boolean;
  run(params: z.infer<S>, secret?: string): Promise<unknown>;
}

export function defineAction<S extends z.ZodObject<z.ZodRawShape>>(
  input: ActionInput<S>,
): Action {
  return {
    app: input.app,
    action: input.action,
    description: input.description,
    returns: input.returns,
    params: input.params,
    needs: input.needs,
    settingDefaults: input.settingDefaults,
    sideEffect: input.sideEffect ?? false,
    // Validation lives here so no handler can forget it.
    run: (params, secret) => input.run(input.params.parse(params), secret),
  };
}

export interface SetupStep {
  text: string;
  link?: { href: string; label: string };
}

/** Per-connection detail besides the credential (Notion page, email address). Shared by all agents, all required. */
export interface AppSetting {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  check?: "email" | "notionPage";
  /** Pre-filled with the signed-in account's email. */
  suggestAccountEmail?: boolean;
}

export interface App {
  key: string;
  label: string;
  auth: "none" | "token";
  /** Shown on the Connections form. */
  authHint?: string;
  setupSteps?: SetupStep[];
  settings?: AppSetting[];
  placeholder?: string;
  /** Tests the credential against the live service before saving. Throws IntegrationError on rejection. */
  verify?(secret: string): Promise<string>;
  actions: Action[];
}

export function defineApp(app: App): App {
  return app;
}
