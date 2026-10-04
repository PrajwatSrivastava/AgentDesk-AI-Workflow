import { WorkflowSpec, WorkflowSpecShape } from "@/core/spec";
import { addUsage, EMPTY_USAGE, generateObject, type LlmMessage, type LlmUsage } from "@/lib/llm";
import { confirmedApproval } from "./clarify";
import { normalizeSpec } from "./normalize";
import { compilerSystemPrompt, compilerUserMessage } from "./prompt";
import { validateSpec } from "./validate";

export interface CompileUsage extends LlmUsage {
  attempts: number;
  /** Model used for the final attempt, after any fallback. */
  model?: string;
}

export type CompileResult =
  | { ok: true; spec: WorkflowSpec; usage: CompileUsage; fixes: string[] }
  | { ok: false; message: string; problems: string[]; usage: CompileUsage };

export interface CompileRequest {
  request: string;
  agentName: string;
  agentRole: string;
  agentVars: Record<string, string>;
  /** Details the user confirmed before compiling, one line each */
  clarifications?: string[];
}

// ~1k tokens for an 8-step spec plus room for reasoning tokens.
const MAX_SPEC_TOKENS = 4000;

// One repair turn. The schema is enforced by the provider, and longer repair loops rarely converge.
const MAX_ATTEMPTS = 2;

export async function compile(input: CompileRequest): Promise<CompileResult> {
  const usage: CompileUsage = { ...EMPTY_USAGE, attempts: 0 };
  const messages: LlmMessage[] = [
    { role: "user", content: compilerUserMessage(input) },
  ];

  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    usage.attempts = attempt;

    const result = await generateObject({
      tier: "compiler",
      schema: WorkflowSpecShape,
      system: compilerSystemPrompt(),
      messages,
      maxTokens: MAX_SPEC_TOKENS,
    });

    addUsage(usage, result.usage);
    usage.model = result.model;

    const problems = inspect(result.object, input.clarifications);
    if (problems.spec) {
      return { ok: true, spec: problems.spec, usage, fixes: problems.fixes };
    }
    lastProblems = problems.problems;

    if (attempt === MAX_ATTEMPTS) break;

    messages.push(
      { role: "assistant", content: result.raw || JSON.stringify(result.object) },
      {
        role: "user",
        content: `That specification has problems:\n\n${lastProblems
          .map((problem) => `- ${problem}`)
          .join(
            "\n",
          )}\n\nReturn a corrected specification as a single JSON object. Use only actions and parameters from the catalog.`,
      },
    );
  }

  return {
    ok: false,
    message:
      "I couldn't build that from the integrations available. Try describing it as steps — what to check, what to decide, and where to send the result.",
    problems: lastProblems,
    usage,
  };
}

// Runs even though the provider enforces the schema. It's cheap and the last check before the executor.
function inspect(object: unknown, clarifications?: string[]): {
  spec?: WorkflowSpec;
  problems: string[];
  fixes: string[];
} {
  if (object === null || object === undefined) {
    return { problems: ["The reply was not a JSON object."], fixes: [] };
  }

  const parsed = WorkflowSpec.safeParse(object);
  if (!parsed.success) {
    return {
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`,
      ),
      fixes: [],
    };
  }

  // Fixing mechanical defects locally is cheaper and more reliable than asking the model.
  const { spec, fixes } = normalizeSpec(parsed.data);

  const problems = [...validateSpec(spec), ...approvalProblems(spec, clarifications)];
  return problems.length === 0
    ? { spec, problems: [], fixes }
    : { problems, fixes };
}

// Models often leave out the optional `when`, which turns "ask me if it's urgent" into a pause on
// every run. The approval answer confirmed on the card says exactly what was meant.
function approvalProblems(spec: WorkflowSpec, clarifications?: string[]): string[] {
  const human = spec.steps.filter((step) => step.type === "human");
  switch (confirmedApproval(clarifications)) {
    case "never":
      return human.length === 0
        ? []
        : ["The user confirmed they don't want to be asked, so remove the human step."];
    case "always":
      return human.length > 0 && human.every((step) => !step.when)
        ? []
        : ["The user confirmed they want to approve every run, so add one human step without `when` before the sending step."];
    case "when_flagged":
      return human.length > 0 && human.every((step) => step.when)
        ? []
        : ["The user confirmed they want to be asked only when something looks important, so the human step needs a `when` that tests a boolean field such as `important` from the preceding ai step. Without `when` it pauses on every run."];
    default:
      return [];
  }
}
