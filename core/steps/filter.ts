import { evaluate } from "../conditions";
import type { StepHandler } from "../types";

// A false filter ends the run as skipped. "Nothing to report" is a normal result and shouldn't show as a failure.
export const runFilter: StepHandler<"filter"> = async (step, ctx) => {
  const { pass, detail } = evaluate(step.condition, ctx);

  if (!pass) {
    const shown = JSON.stringify(detail.resolvedLeft ?? null);
    const right = detail.right === undefined ? "" : ` ${JSON.stringify(detail.right)}`;
    return {
      kind: "halt",
      reason: `${detail.left} resolved to ${shown}, which is not ${detail.op}${right}`,
    };
  }

  return { kind: "ok", output: { passed: true, ...detail } };
};
