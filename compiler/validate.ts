import { z } from "zod";
import { referencesIn } from "@/core/resolve";
import type { WorkflowSpec } from "@/core/spec";
import { findAction } from "@/integrations/registry";

// Checks the schema can't express: unknown actions, misnamed params, references to steps that haven't run.
export function validateSpec(spec: WorkflowSpec): string[] {
  const problems: string[] = [];
  const available = new Set<string>(["trigger", "agent"]);

  for (const [index, step] of spec.steps.entries()) {
    const at = `step ${index + 1} ("${step.id}")`;

    for (const reference of referencesIn(stepReferenceSources(step))) {
      const root = reference.split(/[.[]/)[0];
      if (!available.has(root)) {
        problems.push(
          available.size <= 2
            ? `${at} references {{${reference}}}, but no earlier step produces "${root}"`
            : `${at} references {{${reference}}}, but "${root}" is not the trigger, the agent, or an earlier step (available: ${[...available].join(", ")})`,
        );
      }
    }

    if (step.type === "action" || step.type === "notify") {
      const definition = findAction(step.app, step.action);
      if (!definition) {
        problems.push(`${at} calls ${step.app}.${step.action}, which does not exist`);
      } else {
        problems.push(...checkParams(at, step.params, definition.params.shape));
      }
    }

    // With no reference the model gets no data, replies "please provide the stories...", and that gets posted.
    if (step.type === "ai" && referencesIn(step.prompt).length === 0) {
      problems.push(
        `${at} has a prompt with no {{reference}} in it, so the model receives no data to work on — interpolate the earlier step's output, e.g. {{${
          [...available].find((name) => name !== "trigger" && name !== "agent") ??
          "fetch"
        }.items}}`,
      );
    }

    // Added after the check so a step can't reference itself.
    available.add(step.id);
  }

  return problems;
}

function stepReferenceSources(step: WorkflowSpec["steps"][number]): unknown {
  switch (step.type) {
    case "action":
    case "notify":
      return step.params;
    case "ai":
      return step.prompt;
    case "filter":
      return step.condition.left;
    case "human":
      return [step.message, step.when?.left, ...step.shows];
  }
}

// Names only, not types: a number param can hold "{{fetch.count}}" until it's resolved at run time.
function checkParams(
  at: string,
  params: Record<string, unknown>,
  shape: Record<string, z.core.$ZodType>,
): string[] {
  const problems: string[] = [];
  const known = Object.keys(shape);

  for (const name of Object.keys(params)) {
    if (!known.includes(name)) {
      problems.push(
        `${at} passes unknown parameter "${name}" (accepts: ${known.join(", ") || "none"})`,
      );
    }
  }

  for (const name of known) {
    // Required = schema rejects undefined, so params with a default don't count.
    const isRequired = !z.safeParse(shape[name], undefined).success;
    if (isRequired && params[name] === undefined) {
      problems.push(`${at} is missing required parameter "${name}"`);
    }
  }

  return problems;
}
