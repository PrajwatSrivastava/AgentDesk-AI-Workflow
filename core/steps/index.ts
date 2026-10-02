import type { Step } from "../spec";
import type { RunContext, StepResult } from "../types";
import { runAction, runNotify } from "./action";
import { runAi } from "./ai";
import { runFilter } from "./filter";
import { runHuman } from "./human";

// A switch so the build fails if a new step type has no handler.
export function runStep(step: Step, ctx: RunContext): Promise<StepResult> {
  switch (step.type) {
    case "action":
      return runAction(step, ctx);
    case "ai":
      return runAi(step, ctx);
    case "filter":
      return runFilter(step, ctx);
    case "human":
      return runHuman(step, ctx);
    case "notify":
      return runNotify(step, ctx);
  }
}
