import { env } from "@/lib/env";
import { costMicros, type ModelTier } from "@/lib/pricing";
import { parseJsonReply, toProviderJsonSchema } from "./schema";
import type { ObjectRequest, ObjectResult } from "./types";

// Fallback lists, since model availability changes by the hour. On 2026-10-01 several flash
// models gave 503, Pro gave 429 and 2.5-flash gave 404. Override with GEMINI_*_MODELS.
const DEFAULT_MODELS: Record<ModelTier, string[]> = {
  // Thinking models
  compiler: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview"],
  // No thinking, much cheaper
  summary: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
};

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 90_000;
const ATTEMPTS_PER_MODEL = 2;
/** Longer retry delays skip to the next model. */
const MAX_WAIT_MS = 15_000;
const RETRYABLE = new Set([429, 500, 503]);

function modelsFor(tier: ModelTier): string[] {
  const configured =
    tier === "compiler" ? env.geminiCompilerModels : env.geminiSummaryModels;
  return configured ?? DEFAULT_MODELS[tier];
}

interface GeminiError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { "@type"?: string; retryDelay?: string }[];
  };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

// Output is constrained by responseJsonSchema. Caching is implicit; hits show up in cachedContentTokenCount.
export async function generateObject(request: ObjectRequest): Promise<ObjectResult> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: toProviderJsonSchema(request.schema),
      maxOutputTokens: request.maxTokens,
    },
  });

  const failures: string[] = [];

  for (const model of modelsFor(request.tier)) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": env.geminiApiKey,
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
        return toResult(model, (await response.json()) as GeminiResponse);
      }

      const error = ((await response.json().catch(() => ({}))) as GeminiError).error;
      const message = error?.message ?? response.statusText;

      // Listed but not available to this key, retrying won't help
      if (response.status === 404) {
        failures.push(`${model}: not available to this key`);
        break;
      }

      if (RETRYABLE.has(response.status)) {
        const wait = retryWait(response, error, attempt);
        if (attempt < ATTEMPTS_PER_MODEL && wait <= MAX_WAIT_MS) {
          await sleep(wait);
          continue;
        }
        failures.push(`${model}: ${response.status} ${shorten(message)}`);
        break;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Gemini refused the API key (${response.status}): ${message}\n\nCheck GEMINI_API_KEY in .env.local, or create a new key at aistudio.google.com/apikey.`,
        );
      }

      // Bad request, other models would reject it too
      throw new Error(`Gemini rejected the request (${response.status}): ${message}`);
    }
  }

  throw new Error(
    `Every configured Gemini model is unavailable right now — ${failures.join("; ")}.\n\nThis is usually a short-lived demand spike. Try again in a minute, or set GEMINI_COMPILER_MODELS / GEMINI_SUMMARY_MODELS to models that are serving.`,
  );
}

function toResult(model: string, data: GeminiResponse): ObjectResult {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    const blocked = data.promptFeedback?.blockReason;
    throw new Error(
      blocked
        ? `Gemini blocked the request (${blocked}).`
        : "Gemini returned no candidates.",
    );
  }

  // Drop thought summaries
  const raw = (candidate.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");

  if (!raw && candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini stopped without a reply (${candidate.finishReason}).`);
  }

  const usage = data.usageMetadata ?? {};
  // promptTokenCount includes cached tokens, which bill at the cache rate
  const cached = usage.cachedContentTokenCount ?? 0;
  const tokensIn = Math.max(0, (usage.promptTokenCount ?? 0) - cached);
  // Thinking bills as output
  const tokensOut = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);

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

// RetryInfo delay (e.g. "21s") first, then Retry-After, then exponential backoff with jitter.
function retryWait(response: Response, error: GeminiError["error"], attempt: number): number {
  const hinted = error?.details?.find((detail) => detail.retryDelay)?.retryDelay;
  if (hinted) {
    const seconds = Number.parseFloat(hinted);
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  }
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
