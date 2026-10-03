import { z } from "zod";
import { parseLooseDate, todayIso } from "@/lib/dates";
import { neutralizeMentions } from "@/lib/untrusted";
import { normalizeUrl } from "@/lib/urls";
import { defineAction, defineApp } from "./define";

const MAX_TEXT = 3500;
const DAY_MS = 24 * 60 * 60 * 1000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

const fieldList = (value?: string) =>
  (value ?? "").split(",").map((field) => field.trim()).filter(Boolean);

/** Plain text from whatever a scraper or model put in a field. */
function cleanValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(cleanValue).filter(Boolean).join(", ");
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#39|[a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

// Case and punctuation don't make two entries different
const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const shiftDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);

function compare(a: string, b: string): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0; // empty values sort last either way
  const numA = Number(a);
  const numB = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export interface TidyOptions {
  requireFields?: string;
  dedupeBy?: string;
  dateField?: string;
  keep: "all" | "upcoming" | "past";
  withinDays?: number;
  sortBy?: string;
  order: "asc" | "desc";
  limit: number;
  format?: string;
}

/**
 * Cleans and structures a list of records: strip markup, drop incomplete entries, keep a date
 * window, dedupe, sort, limit, and render each entry as a line of text. Deterministic, no AI.
 */
export function tidyList(raw: Record<string, unknown>[], options: TidyOptions, now: Date = new Date()) {
  const dropped = { missingFields: 0, duplicates: 0, outsideWindow: 0, undated: 0, overLimit: 0 };
  const today = todayIso(now);
  const dateField = options.dateField?.trim();

  // 1. Normalise every value to clean text; URLs and dates to canonical forms
  let items = raw.map((entry) => {
    const item: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry ?? {})) {
      let text = cleanValue(value);
      if (/^(url|link|href|website)$/i.test(key)) text = normalizeUrl(text) ?? text;
      item[key] = text;
    }
    if (dateField && item[dateField]) item[dateField] = parseLooseDate(item[dateField], now) ?? item[dateField];
    return item;
  });

  // 2. Required fields
  const required = fieldList(options.requireFields);
  items = items.filter((item) => {
    const ok = required.every((field) => item[field]);
    if (!ok) dropped.missingFields++;
    return ok;
  });

  // 3. Date window
  if (dateField && (options.keep !== "all" || options.withinDays)) {
    items = items.filter((item) => {
      const date = item[dateField];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        if (options.keep === "all") return true;
        dropped.undated++;
        return false;
      }
      let inside = options.keep === "upcoming" ? date >= today : options.keep === "past" ? date < today : true;
      if (inside && options.withinDays) {
        const days = options.withinDays;
        if (options.keep === "upcoming") inside = date <= shiftDays(today, days);
        else if (options.keep === "past") inside = date >= shiftDays(today, -days);
        else inside = date >= shiftDays(today, -days) && date <= shiftDays(today, days);
      }
      if (!inside) dropped.outsideWindow++;
      return inside;
    });
  }

  // 4. Dedupe on the chosen fields, else the link, else the whole entry
  const dedupe = fieldList(options.dedupeBy);
  const seen = new Set<string>();
  items = items.filter((item) => {
    const keyFields = dedupe.length ? dedupe : "url" in item ? ["url"] : Object.keys(item);
    const key = keyFields.map((field) => fold(item[field] ?? "")).join("|");
    if (!key.replace(/\|/g, "")) return true;
    if (seen.has(key)) {
      dropped.duplicates++;
      return false;
    }
    seen.add(key);
    return true;
  });

  // 5. Sort, empty values last
  const sortFields = fieldList(options.sortBy);
  if (sortFields.length) {
    const direction = options.order === "desc" ? -1 : 1;
    items.sort((a, b) => {
      for (const field of sortFields) {
        const x = a[field] ?? "";
        const y = b[field] ?? "";
        if (!x || !y) {
          const result = compare(x, y);
          if (result) return result;
          continue;
        }
        const result = compare(x, y) * direction;
        if (result) return result;
      }
      return 0;
    });
  }

  // 6. Limit
  if (items.length > options.limit) {
    dropped.overLimit = items.length - options.limit;
    items = items.slice(0, options.limit);
  }

  // 7. Render as readable lines
  const render = (item: Record<string, string>) => {
    if (options.format) {
      return options.format
        .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, field: string) => item[field] ?? "")
        .replace(/\(\s*\)|\[\s*\]/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/ ([,;:])/g, "$1")
        .replace(/(?:\s*[,:–—-]\s*)+$/u, "")
        .trim();
    }
    return `• ${Object.values(item).filter(Boolean).join(" — ")}`;
  };
  const lines: string[] = [];
  let length = 0;
  for (const [index, item] of items.entries()) {
    const line = render(item);
    if (!line) continue;
    if (length + line.length > MAX_TEXT) {
      lines.push(`…and ${items.length - index} more`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }

  return { count: items.length, items, text: neutralizeMentions(lines.join("\n")), dropped };
}

const tidy = defineAction({
  app: "data",
  action: "tidy_list",
  description:
    "Clean and organise a list of entries from an earlier step: strip leftover HTML, drop entries missing key fields, keep only upcoming or past dates, remove duplicates, sort, limit, and render each entry as a readable line. Use it between any list (scraped items, search results, records extracted by an ai step) and a message, so messages post {{tidy.text}} instead of raw data.",
  returns: "{ count, items: [ ...cleaned entries ], text (one formatted line per entry), dropped: { missingFields, duplicates, outsideWindow, undated, overLimit } }",
  params: z.object({
    items: z.array(z.record(z.string(), z.unknown())).max(500).describe("a whole reference to a list, e.g. {{extract.records}} or {{search.items}}"),
    requireFields: z.string().max(200).optional().describe("comma-separated fields an entry must have, e.g. name,url"),
    dedupeBy: z.string().max(200).optional().describe("comma-separated fields that identify the same entry; default url"),
    dateField: z.string().max(60).optional().describe("field holding the entry's date, e.g. deadline"),
    keep: z.enum(["all", "upcoming", "past"]).default("all").describe("upcoming keeps dates from today on; needs dateField"),
    withinDays: z.number().int().min(1).max(366).optional().describe("only dates within this many days of today"),
    sortBy: z.string().max(200).optional().describe("comma-separated fields to sort by, e.g. deadline"),
    order: z.enum(["asc", "desc"]).default("asc"),
    limit: z.number().int().min(1).max(100).default(20),
    format: z.string().max(300).optional().describe('line template using single braces, e.g. "• {name} ({organisation}), deadline {deadline}: {url}"'),
  }),
  async run({ items, ...options }) {
    return tidyList(items, options);
  },
});

export const data = defineApp({
  key: "data",
  label: "Data",
  auth: "none",
  actions: [tidy],
});
