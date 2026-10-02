import { newToken } from "@/lib/crypto";
import { evaluate } from "../conditions";
import { resolveString } from "../resolve";
import type { StepHandler } from "../types";

// If `when` is set and false, no approval is needed and the run continues ("ask me only if it's urgent").
export const runHuman: StepHandler<"human"> = async (step, ctx) => {
  if (step.when) {
    const { pass, detail } = evaluate(step.when, ctx);
    if (!pass) {
      return {
        kind: "ok",
        output: { paused: false, because: `${detail.left} did not meet the approval condition` },
      };
    }
  }

  return {
    kind: "pause",
    approvalToken: newToken(),
    message: resolveString(step.message, ctx),
    shows: step.shows.map((template) => resolveString(template, ctx)),
  };
};
