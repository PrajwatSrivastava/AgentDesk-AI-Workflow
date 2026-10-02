import type { RunContext } from "./types";

const TEMPLATE = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;
const WHOLE_TEMPLATE = /^\s*\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}\s*$/;

// Stops a model-written path from reaching the prototype chain.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Own properties only. Accepts both items.0.title and items[0].title.
function getPath(root: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let current = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (FORBIDDEN_KEYS.has(segment)) return undefined;

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }

    if (typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function scope(ctx: RunContext): Record<string, unknown> {
  return { ...ctx.steps, trigger: ctx.trigger, agent: { ...ctx.agent.vars, name: ctx.agent.name, role: ctx.agent.role } };
}

/** A lone reference keeps its type, so "{{fetch.count}}" compares as a number in conditions. */
export function resolveValue(template: string, ctx: RunContext): unknown {
  const whole = WHOLE_TEMPLATE.exec(template);
  if (whole) return getPath(scope(ctx), whole[1]);
  return resolveString(template, ctx);
}

/** Objects and arrays are interpolated as indented JSON (for prompts like {{fetch.items}}). */
export function resolveString(template: string, ctx: RunContext): string {
  const data = scope(ctx);
  return template.replace(TEMPLATE, (_match, path: string) => {
    const value = getPath(data, path);
    return stringify(value);
  });
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

// Null/undefined drops the param: lastRunAt is null on the first run and optional Zod fields reject null.
// Empty strings are kept so a spec containing "" fails validation on that field.
export function resolveParams(
  params: Record<string, string | number | boolean>,
  ctx: RunContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const resolved = typeof value === "string" ? resolveValue(value, ctx) : value;
    if (resolved === null || resolved === undefined) continue;
    out[key] = resolved;
  }
  return out;
}

export function setPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment && !FORBIDDEN_KEYS.has(segment));
  if (segments.length === 0) return;

  let current: Record<string, unknown> = root;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== "object") current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}

function referencePath(template: string): string | null {
  const match = WHOLE_TEMPLATE.exec(template);
  return match ? match[1] : null;
}

/** Only editable when the first shown item is a single reference like {{draft.text}}. */
export function editTarget(step: { shows: string[] }): string | null {
  return step.shows[0] ? referencePath(step.shows[0]) : null;
}

export function referencesIn(value: unknown): string[] {
  const found: string[] = [];
  walk(value);
  return found;

  function walk(node: unknown): void {
    if (typeof node === "string") {
      for (const match of node.matchAll(TEMPLATE)) found.push(match[1]);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  }
}
