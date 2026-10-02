import type { Condition, Step } from "@/core/spec";
import { findApp } from "@/integrations/registry";

const OP_WORDS: Record<Condition["op"], string> = {
  eq: "is",
  neq: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  is_empty: "is empty",
  not_empty: "is not empty",
};

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function plain(reference: string): string {
  return reference.replace(/\{\{\s*|\s*\}\}/g, "");
}

function describeCondition(condition: Condition): string {
  const word = OP_WORDS[condition.op];
  if (condition.op === "is_empty" || condition.op === "not_empty") {
    return `${plain(condition.left)} ${word}`;
  }
  return `${plain(condition.left)} ${word} ${JSON.stringify(condition.right)}`;
}

export function describeStep(step: Step): string {
  switch (step.type) {
    case "action":
    case "notify": {
      const label = findApp(step.app)?.label ?? step.app;
      return `${label}: ${humanize(step.action)}`;
    }
    case "ai": {
      const fields = Object.keys(step.outputSchema);
      const shown = fields.slice(0, 3).join(", ");
      const more = fields.length > 3 ? ` +${fields.length - 3} more` : "";
      return `Ask the model for ${shown}${more}`;
    }
    case "filter":
      return `Continue only if ${describeCondition(step.condition)}`;
    case "human":
      return step.when
        ? `Ask you to approve, if ${describeCondition(step.when)}`
        : "Ask you to approve";
  }
}

export function stepKindLabel(type: Step["type"]): string {
  switch (type) {
    case "action":
      return "Action";
    case "ai":
      return "AI";
    case "filter":
      return "Filter";
    case "human":
      return "Approval";
    case "notify":
      return "Notify";
  }
}
