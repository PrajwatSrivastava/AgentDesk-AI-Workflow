import type { StepType, WorkflowSpec } from "@/core/spec";
import { describeStep, stepKindLabel } from "./describe-step";
import { describeSchedule } from "./schedule";

// Server only. The label helpers import the integration registry (server config),
// so labels are computed here and the panel stays a plain client component.
export interface StepView {
  id: string;
  type: StepType;
  label: string;
  kind: string;
}

export interface SpecView {
  name: string;
  triggerLabel: string;
  triggerType: WorkflowSpec["trigger"]["type"];
  steps: StepView[];
}

export function toSpecView(spec: WorkflowSpec): SpecView {
  return {
    name: spec.name,
    triggerType: spec.trigger.type,
    triggerLabel: describeTrigger(spec.trigger),
    steps: spec.steps.map((step) => ({
      id: step.id,
      type: step.type,
      label: describeStep(step),
      kind: stepKindLabel(step.type),
    })),
  };
}

function describeTrigger(trigger: WorkflowSpec["trigger"]): string {
  switch (trigger.type) {
    case "schedule":
      return describeSchedule(trigger.everyMinutes);
    case "webhook":
      return "when a webhook arrives";
    case "manual":
      return "when you run it";
  }
}
