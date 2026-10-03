import { WorkflowSpec, WorkflowSpecShape } from "@/core/spec";
import { addUsage, EMPTY_USAGE, generateObject, type LlmMessage, type LlmUsage } from "@/lib/llm";
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

// One repair turn. The schema is enforced by Gemini, and longer repair loops rarely converge.
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

    const problems = inspect(result.object);
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

// Runs even though Gemini enforces the schema. It's cheap and the last check before the executor.
function inspect(object: unknown): {
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

  const problems = validateSpec(spec);
  return problems.length === 0
    ? { spec, problems: [], fixes }
    : { problems, fixes };
}
