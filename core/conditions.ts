import type { Condition } from "./spec";
import { resolveValue } from "./resolve";
import type { RunContext } from "./types";

export interface ConditionResult {
  pass: boolean;
  /** Shown in the run inspector. */
  detail: {
    left: string;
    resolvedLeft: unknown;
    op: Condition["op"];
    right?: string | number | boolean;
  };
}

export function evaluate(condition: Condition, ctx: RunContext): ConditionResult {
  const resolvedLeft = resolveValue(condition.left, ctx);
  const { op, right } = condition;

  return {
    pass: compare(resolvedLeft, op, right),
    detail: { left: condition.left, resolvedLeft, op, right },
  };
}

function compare(
  left: unknown,
  op: Condition["op"],
  right: string | number | boolean | undefined,
): boolean {
  switch (op) {
    case "is_empty":
      return isEmpty(left);
    case "not_empty":
      return !isEmpty(left);
    case "eq":
      return looseEquals(left, right);
    case "neq":
      return !looseEquals(left, right);
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return numericCompare(left, op, right);
    case "contains":
      return contains(left, right);
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  // array eq number compares length, same as gt/lt
  if (Array.isArray(left) && typeof right === "number") return left.length === right;
  if (typeof left === "number" || typeof right === "number") {
    const l = Number(left);
    const r = Number(right);
    if (!Number.isNaN(l) && !Number.isNaN(r)) return l === r;
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    return toBool(left) === toBool(right);
  }
  return String(left) === String(right);
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

// Arrays compare by length, numeric strings as numbers ("3" > 2). Anything non-numeric fails.
function numericCompare(
  left: unknown,
  op: "gt" | "gte" | "lt" | "lte",
  right: unknown,
): boolean {
  const l = toNumber(left);
  const r = toNumber(right);
  if (Number.isNaN(l) || Number.isNaN(r)) return false;
  switch (op) {
    case "gt":
      return l > r;
    case "gte":
      return l >= r;
    case "lt":
      return l < r;
    case "lte":
      return l <= r;
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? Number.NaN : Number(trimmed);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return Number.NaN;
}

function contains(left: unknown, right: unknown): boolean {
  if (right === null || right === undefined) return false;
  const needle = String(right).toLowerCase();

  if (Array.isArray(left)) {
    return left.some((item) => String(item).toLowerCase().includes(needle));
  }
  if (left === null || left === undefined) return false;
  if (typeof left === "object") {
    return JSON.stringify(left).toLowerCase().includes(needle);
  }
  return String(left).toLowerCase().includes(needle);
}
