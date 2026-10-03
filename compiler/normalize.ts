import { referencesIn } from "@/core/resolve";
import type { WorkflowSpec } from "@/core/spec";
import { findAction } from "@/integrations/registry";
import { isIntegrationValue } from "@/lib/agent-types";

const AGENT_REFERENCE = /^\s*\{\{\s*agent\.([a-zA-Z0-9_]+)\s*\}\}\s*$/;
const MAX_RESULTS_WITH_TEXT = 5;

export interface Normalized {
  spec: WorkflowSpec;
  /** One human-readable line per repair. */
  fixes: string[];
}

// Fixes with exactly one right answer, applied before validation. Main one: an ai prompt with no reference
// gets the nearest earlier data step appended, since repair prompts don't reliably fix it.
export function normalizeSpec(spec: WorkflowSpec): Normalized {
  const fixes: string[] = [];
  let nearestSource: string | undefined;

  const steps = spec.steps.map((step) => {
    let current = step;

    // Drop recipient/page params taken from {{agent.*}} so the action uses the connection's setting.
    if (current.type === "action" || current.type === "notify") {
      const defaults = findAction(current.app, current.action)?.settingDefaults ?? {};
      const params = { ...current.params };
      for (const param of Object.keys(defaults)) {
        const value = params[param];
        const key = typeof value === "string" ? AGENT_REFERENCE.exec(value)?.[1] : undefined;
        if (key && isIntegrationValue(key)) {
          delete params[param];
          fixes.push(
            `step "${current.id}" took ${param} from {{agent.${key}}}; it now uses the one set on the Connections page`,
          );
        }
      }
      // Page text is up to 4000 characters per result, so more than 5 bloats the next ai step (rule 13)
      if (
        current.app === "tavily" &&
        current.action === "search" &&
        params.includePageText === true &&
        typeof params.limit === "number" &&
        params.limit > MAX_RESULTS_WITH_TEXT
      ) {
        fixes.push(`step "${current.id}" asked for ${params.limit} results with page text; reduced to ${MAX_RESULTS_WITH_TEXT}`);
        params.limit = MAX_RESULTS_WITH_TEXT;
      }
      current = { ...current, params };
    }

    if (
      current.type === "ai" &&
      referencesIn(current.prompt).length === 0 &&
      nearestSource
    ) {
      fixes.push(
        `step "${current.id}" referenced no data; attached {{${nearestSource}}}`,
      );
      current = { ...current, prompt: `${current.prompt}\n\n{{${nearestSource}}}` };
    }

    // filter/human/notify outputs aren't data a later prompt would want
    if (current.type === "action" || current.type === "ai") {
      nearestSource = current.id;
    }

    return current;
  });

  return { spec: { ...spec, steps }, fixes };
}
