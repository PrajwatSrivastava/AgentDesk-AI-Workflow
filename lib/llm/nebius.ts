import { env } from "@/lib/env";
import { costMicros, type ModelTier } from "@/lib/pricing";
import { parseJsonReply, toProviderJsonSchema } from "./schema";
import type { ObjectRequest, ObjectResult } from "./types";

// Nebius Token Factory serves open models behind an OpenAI-compatible API. Only models tagged
// structured_outputs in GET /v1/models are listed, so every reply is decoded against the schema.
// Override with NEBIUS_*_MODELS.
// Picked with npm run fixtures and npm run clarify on 2026-10-04. DeepSeek V4 Pro compiles in about
// 5 s for ~$0.015; Flash is as accurate at ~$0.001 but takes 10-30 s and timed out under load.
// gpt-oss-120b timed out too. For summaries, Qwen3-235B passed every clarify check; 30B missed some.
const DEFAULT_MODELS: Record<ModelTier, string[]> = {
  compiler: ["deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4-Flash-0731", "Qwen/Qwen3-235B-A22B-Instruct-2507"],
  summary: ["Qwen/Qwen3-235B-A22B-Instruct-2507", "Qwen/Qwen3-30B-A3B-Instruct-2507"],
};

// Sent as reasoning_effort to these models only; non-reasoning models may reject the parameter.
// Low cuts Flash's compile time by about two thirds with no loss on the fixtures.
const REASONING_EFFORT: Record<string, string> = {
  "deepseek-ai/DeepSeek-V4-Flash-0731": "low",
};

const ENDPOINT = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 90_000;
const ATTEMPTS_PER_MODEL = 2;
/** Longer retry delays skip to the next model. */
const MAX_WAIT_MS = 15_000;
// 529 is "system overloaded"
const RETRYABLE = new Set([429, 500, 502, 503, 529]);

function modelsFor(tier: ModelTier): string[] {
  const configured =
    tier === "compiler" ? env.nebiusCompilerModels : env.nebiusSummaryModels;
  return configured ?? DEFAULT_MODELS[tier];
}

// OpenAI-style { error: { message } }, or FastAPI-style { detail } on validation errors
interface NebiusError {
  error?: string | { message?: string };
  detail?: string | { msg?: string }[];
  message?: string;
}

function errorMessage(body: NebiusError, fallback: string): string {
  if (typeof body.error === "string") return body.error;
  if (body.error?.message) return body.error.message;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) return body.detail.map((item) => item.msg ?? JSON.stringify(item)).join("; ");
  return body.message ?? fallback;
}

interface NebiusResponse {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number | null } | null;
  };
}

export async function generateObject(request: ObjectRequest): Promise<ObjectResult> {
  const schema = toProviderJsonSchema(request.schema);
  // The decoder enforces the schema but the model never sees it. The compiler's schema carries field
  // descriptions its prompt relies on, so it goes in the prompt too, as Nebius recommends. Summary prompts describe their own fields, and adding the schema there
  // made the clarify step stop asking questions. Appended last, so the prompt stays a cacheable prefix.
  const system =
    request.tier === "compiler"
      ? `${request.system}\n\nReply with a single JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`
      : request.system;
  const payload = {
    messages: [{ role: "system", content: system }, ...request.messages],
    response_format: {
      type: "json_schema",
      json_schema: { name: "reply", schema, strict: true },
    },
    // Includes reasoning tokens on reasoning models
    max_tokens: request.maxTokens,
  };

  const failures: string[] = [];
  const models = modelsFor(request.tier);
  /** Models that refused the request itself (400/422), with the first reason */
  let rejected = 0;
  let rejection = "";

  for (const model of models) {
    const effort = REASONING_EFFORT[model];
    const body = JSON.stringify({ model, ...payload, ...(effort && { reasoning_effort: effort }) });
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.nebiusApiKey}`,
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // Timeout or network error, try the next model
        failures.push(`${model}: ${error instanceof Error ? error.name : "network error"}`);
        break;
      }

      if (response.ok) {
        return toResult(model, (await response.json()) as NebiusResponse);
      }

      const message = errorMessage(
        (await response.json().catch(() => ({}))) as NebiusError,
        response.statusText,
      );

      if (response.status === 401) {
        throw new Error(
          `Nebius refused the API key (401): ${message}\n\nCheck NEBIUS_API_KEY in .env.local, or create a new key at tokenfactory.nebius.com.`,
        );
      }

      // Billing is per account, so every model would refuse
      if (response.status === 402) {
        throw new Error(
          `The Nebius account is out of credit (402): ${message}\n\nTop up the balance at tokenfactory.nebius.com, then try again.`,
        );
      }

      // Unknown model or no access to it, retrying won't help
      if (response.status === 403 || response.status === 404) {
        failures.push(`${model}: not available to this key`);
        break;
      }

      if (RETRYABLE.has(response.status)) {
        const wait = retryWait(response, attempt);
        if (attempt < ATTEMPTS_PER_MODEL && wait <= MAX_WAIT_MS) {
          await sleep(wait);
          continue;
        }
        failures.push(`${model}: ${response.status} ${shorten(message)}`);
        break;
      }

      // Bad request. Models differ in what their schema decoder accepts, so try the next one.
      rejected++;
      rejection ||= `${response.status}: ${message}`;
      failures.push(`${model}: ${response.status} ${shorten(message)}`);
      break;
    }
  }

  if (rejected === models.length) {
    throw new Error(`Nebius rejected the request (${rejection})`);
  }
  const setting = request.tier === "compiler" ? "NEBIUS_COMPILER_MODELS" : "NEBIUS_SUMMARY_MODELS";
  throw new Error(
    `Every configured Nebius model is unavailable right now — ${failures.join("; ")}.\n\nThis is usually short-lived. Try again in a minute, or set ${setting} to other models from tokenfactory.nebius.com that support structured output.`,
  );
}

function toResult(model: string, data: NebiusResponse): ObjectResult {
  const choice = data.choices?.[0];
  if (!choice) throw new Error("Nebius returned no choices.");

  if (choice.message?.refusal) {
    throw new Error(`The model refused the request: ${shorten(choice.message.refusal)}`);
  }

  // Reasoning arrives separately (reasoning_content), so content is just the reply
  const raw = choice.message?.content ?? "";
  if (!raw && choice.finish_reason && choice.finish_reason !== "stop") {
    throw new Error(`Nebius stopped without a reply (${choice.finish_reason}).`);
  }

  const usage = data.usage ?? {};
  // prompt_tokens includes cached tokens
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const tokensIn = Math.max(0, (usage.prompt_tokens ?? 0) - cached);
  // completion_tokens already includes reasoning tokens
  const tokensOut = usage.completion_tokens ?? 0;

  return {
    object: parseJsonReply(raw),
    raw,
    model,
    usage: {
      tokensIn,
      tokensOut,
      cacheReadTokens: cached,
      costMicros: costMicros(model, { tokensIn, tokensOut, cacheReadTokens: cached }),
    },
  };
}

// Retry-After first, then exponential backoff with jitter.
function retryWait(response: Response, attempt: number): number {
  const header = Number.parseFloat(response.headers.get("retry-after") ?? "");
  if (Number.isFinite(header)) return Math.ceil(header * 1000);
  return 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(message: string): string {
  return message.length > 80 ? `${message.slice(0, 80)}…` : message;
}
