import { z } from "zod";
import type { Action, App } from "./define";
import { bluesky } from "./bluesky";
import { data } from "./data";
import { devto } from "./devto";
import { github } from "./github";
import { hackernews } from "./hackernews";
import { lobsters } from "./lobsters";
import { notion } from "./notion";
import { resend } from "./resend";
import { rss } from "./rss";
import { slack } from "./slack";
import { tavily } from "./tavily";
import { weather } from "./weather";
import { web } from "./web";

// Keep this order fixed: the catalog is the cached prompt prefix and caching is a byte-prefix match.
// Sources first, then processing, then destinations.
export const APPS: readonly App[] = [
  hackernews,
  lobsters,
  devto,
  bluesky,
  rss,
  github,
  weather,
  tavily,
  web,
  data,
  slack,
  resend,
  notion,
];

const ACTION_INDEX: ReadonlyMap<string, Action> = new Map(
  APPS.flatMap((app) => app.actions.map((action) => [`${app.key}.${action.action}`, action])),
);

export function findAction(app: string, action: string): Action | undefined {
  return ACTION_INDEX.get(`${app}.${action}`);
}

export function findApp(key: string): App | undefined {
  return APPS.find((app) => app.key === key);
}

export function appsNeedingConnection(): App[] {
  return APPS.filter((app) => app.auth === "token");
}

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  items?: { type?: string };
}

interface JsonSchemaObject {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

function describeType(property: JsonSchemaProperty): string {
  if (property.enum) return property.enum.map((value) => String(value)).join("|");
  const type = Array.isArray(property.type) ? property.type[0] : property.type;
  if (type === "array") return `${property.items?.type ?? "string"}[]`;
  if (property.format === "email") return "string (email)";
  if (property.format === "uri" || property.format === "url") return "string (url)";
  return type ?? "string";
}

/** One line per action, for prompts that only need to know what's possible (the clarifier). */
export function capabilitiesForPrompt(): string {
  return APPS.flatMap((app) =>
    app.actions.map((action) => {
      const key = app.auth === "token" ? " [needs a connection]" : "";
      return `- ${app.key}.${action.action}${key}: ${action.description.split(". ")[0].replace(/\.$/, "")}.`;
    }),
  ).join("\n");
}

/** Action catalog for the compiler prompt, built from the same Zod schemas used at run time. */
export function catalogForPrompt(): string {
  const lines: string[] = [];

  for (const app of APPS) {
    const auth = app.auth === "none" ? "no credentials required" : "requires a connection";
    lines.push(`## ${app.key} (${app.label}, ${auth})`);

    for (const action of app.actions) {
      lines.push(`### ${app.key}.${action.action}`);
      lines.push(action.description);

      const schema = z.toJSONSchema(action.params, { io: "input" }) as JsonSchemaObject;
      const required = new Set(schema.required ?? []);
      const properties = Object.entries(schema.properties ?? {});

      if (properties.length === 0) {
        lines.push("params: none");
      } else {
        lines.push("params:");
        for (const [name, property] of properties) {
          const bits = [describeType(property)];
          bits.push(required.has(name) ? "required" : "optional");
          if (property.default !== undefined) {
            bits.push(`default ${JSON.stringify(property.default)}`);
          }
          const suffix = property.description ? ` — ${property.description}` : "";
          lines.push(`  - ${name}: ${bits.join(", ")}${suffix}`);
        }
      }
      if (action.returns) lines.push(`returns: ${action.returns}`);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}
