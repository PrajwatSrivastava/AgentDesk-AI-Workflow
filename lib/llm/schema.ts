import { z } from "zod";

// Constrained decoding supports less of JSON Schema than Zod emits, so these keywords are
// stripped. Replies are still checked against the full Zod schema.
const UNSUPPORTED_KEYWORDS = new Set(["propertyNames", "$schema", "default"]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;

    // Keys under `properties` are field names, so a field called `default` is kept
    if (key === "properties" && value && typeof value === "object") {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([field, schema]) => [field, sanitize(schema)]),
      );
      continue;
    }

    out[key] = sanitize(value);
  }
  return out;
}

export function toProviderJsonSchema(schema: z.ZodType): unknown {
  return sanitize(z.toJSONSchema(schema, { io: "output" }));
}

/** Reasoning models sometimes fence the JSON or add text after it. */
export function parseJsonReply(raw: string): unknown {
  const text = raw.trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
