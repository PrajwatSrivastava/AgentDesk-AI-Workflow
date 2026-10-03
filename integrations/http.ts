import { lookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// All outbound calls go through here for shared timeouts and error shape.

const DEFAULT_TIMEOUT_MS = 10_000;

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Some feeds and WAFs reject requests without an identifying UA
const USER_AGENT = "AgentDesk/0.1";

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Next step for the operator, shown in the UI. */
    readonly hint?: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Service name used in error messages. */
  label: string;
  hint?: string;
  /** Set for workflow-supplied URLs (e.g. feed addresses). Restricts to the public internet. */
  publicOnly?: boolean;
}

// Blocked for workflow-supplied URLs (SSRF): loopback, private, link-local incl. 169.254.169.254, reserved.
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
// No ::ffff:0:0/96 rule. BlockList already applies the IPv4 rules to mapped
// addresses, and that rule would match every IPv4 address.
for (const [network, prefix] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  return family === 0 || PRIVATE.check(address, family === 6 ? "ipv6" : "ipv4");
}

// Filters at connect time so the checked address is the dialled one (no DNS rebinding).
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 0);
    const usable = addresses.filter((entry) => !isPrivateAddress(entry.address));
    if (usable.length === 0) {
      return callback(new Error(`${hostname} is not on the public internet`), "", 0);
    }
    if (options.all) return callback(null, usable);
    callback(null, usable[0].address, usable[0].family);
  });
};

const publicOnlyAgent = new Agent({ connect: { lookup: publicLookup } });

// Literal IP hosts skip the lookup, so check them here
function assertPublicUrl(url: URL, label: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IntegrationError(`${label} must be an http or https address`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) {
    throw new IntegrationError(`${label} must be on the public internet, not ${host}`);
  }
}

export function describeError(error: unknown): string {
  if (error instanceof IntegrationError && error.hint) return `${error.message}. ${error.hint}`;
  return error instanceof Error ? error.message : String(error);
}

export async function request(url: string, options: RequestOptions): Promise<Response> {
  return (await requestWithUrl(url, options)).response;
}

// Same as request(), plus the URL actually reached after redirects.
async function requestWithUrl(url: string, options: RequestOptions): Promise<{ response: Response; url: string }> {
  const { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, label, hint, publicOnly } = options;
  const signal = AbortSignal.timeout(timeoutMs);
  const init = {
    method,
    headers: {
      "user-agent": USER_AGENT,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  };

  let response: Response;
  let finalUrl = url;
  try {
    if (publicOnly) {
      ({ response, url: finalUrl } = await fetchPublic(url, init, label));
    } else {
      response = await fetch(url, init);
    }
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new IntegrationError(`${label} did not respond within ${timeoutMs / 1000}s`, undefined, hint);
    }
    // undici reports a public-only refusal as the cause of "fetch failed"
    const reason = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    throw new IntegrationError(
      `${label} could not be reached: ${reason ?? (error instanceof Error ? error.message : String(error))}`,
      undefined,
      hint,
    );
  }

  if (!response.ok) {
    // Don't echo the body for workflow URLs, it could leak content from another service.
    const detail = publicOnly ? "" : (await response.text().catch(() => "")).slice(0, 400);
    throw new IntegrationError(
      `${label} returned ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
      hint,
    );
  }

  return { response, url: finalUrl };
}

// Manual redirects so every hop gets the public-only check.
async function fetchPublic(url: string, init: RequestInit, label: string): Promise<{ response: Response; url: string }> {
  let target = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(target, label);
    const response = (await undiciFetch(target, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      redirect: "manual",
      dispatcher: publicOnlyAgent,
    })) as unknown as Response;

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return { response, url: target.href };
    await response.body?.cancel();
    target = new URL(location, target);
  }
  throw new IntegrationError(`${label} redirected more than ${MAX_REDIRECTS} times`);
}

// Size-limited read. Maps a mid-body timeout to IntegrationError instead of a bare DOMException.
async function readBody(response: Response, label: string): Promise<string> {
  return (await readBytes(response, label)).toString("utf8");
}

async function readBytes(response: Response, label: string): Promise<Buffer> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new IntegrationError(`${label} sent more than ${MAX_BODY_BYTES / 1024 / 1024} MB`);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new IntegrationError(`${label} sent more than ${MAX_BODY_BYTES / 1024 / 1024} MB`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new IntegrationError(`${label} did not finish responding in time`);
    }
    throw error;
  }
  return Buffer.concat(chunks);
}

export interface Page {
  body: string;
  /** After redirects; relative links resolve against this. */
  finalUrl: string;
  contentType: string;
}

/**
 * Fetches a web page from a workflow-supplied URL: public internet only, robots.txt respected,
 * HTML or plain text only, decoded with the page's own charset.
 */
export async function getPage(url: string, options: { label: string; hint?: string; timeoutMs?: number }): Promise<Page> {
  const parsed = new URL(url);
  if (!(await robotsAllow(parsed))) {
    throw new IntegrationError(
      `${parsed.hostname} asks automated tools not to read this page (robots.txt)`,
      undefined,
      "Use another page, or that site's RSS feed if it has one.",
    );
  }

  const { response, url: finalUrl } = await requestWithUrl(url, {
    ...options,
    publicOnly: true,
    headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
  });
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/.test(contentType)) {
    await response.body?.cancel();
    throw new IntegrationError(
      `${options.label}: that address is not a web page (${contentType.split(";")[0]})`,
      undefined,
      "Point it at an HTML page. PDFs and downloads can't be read.",
    );
  }
  const bytes = await readBytes(response, options.label);
  return { body: decode(bytes, contentType), finalUrl, contentType };
}

// Header charset first, then <meta charset>, then UTF-8.
function decode(bytes: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/.exec(contentType)?.[1];
  const head = bytes.subarray(0, 2048).toString("latin1");
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // unknown label, try the next one
    }
  }
  return bytes.toString("utf8");
}

const ROBOTS_TTL_MS = 60 * 60 * 1000;
const robotsCache = new Map<string, { at: number; rules: RobotsRule[] }>();

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

// Missing or unreadable robots.txt means allowed, as crawlers treat it.
async function robotsAllow(url: URL): Promise<boolean> {
  let entry = robotsCache.get(url.origin);
  if (!entry || Date.now() - entry.at > ROBOTS_TTL_MS) {
    let rules: RobotsRule[] = [];
    try {
      const text = await getText(`${url.origin}/robots.txt`, { label: "robots.txt", publicOnly: true, timeoutMs: 3000 });
      rules = parseRobots(text.slice(0, 64 * 1024));
    } catch {
      rules = [];
    }
    entry = { at: Date.now(), rules };
    robotsCache.set(url.origin, entry);
  }
  const path = `${url.pathname}${url.search}`;
  let best: RobotsRule | null = null;
  for (const rule of entry.rules) {
    if (!robotsMatch(rule.pattern, path)) continue;
    // Longest match wins; on a tie, Allow wins
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

// Rules for our own user agent if the file names it, otherwise the `*` group.
export function parseRobots(text: string): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) {
      // "Disallow:" with no path allows everything
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    }
  }
  const ours = groups.filter((group) => group.agents.some((agent) => agent.startsWith("agentdesk")));
  const chosen = ours.length > 0 ? ours : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

export async function getJson<T>(url: string, options: Omit<RequestOptions, "method" | "body">): Promise<T> {
  const response = await request(url, { ...options, method: "GET" });
  const text = await readBody(response, options.label);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IntegrationError(`${options.label} did not return JSON`, undefined, options.hint);
  }
}

export async function getText(url: string, options: Omit<RequestOptions, "method" | "body">): Promise<string> {
  const response = await request(url, { ...options, method: "GET" });
  return readBody(response, options.label);
}

/** Limits items passed to AI steps to keep prompt cost down. */
export function cap<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

/** For APIs without a time filter. Missing or invalid `since` (first run) keeps everything. */
export function newerThan<T>(
  items: T[],
  since: string | undefined,
  dateOf: (item: T) => string,
): T[] {
  if (!since) return items;
  const cutoff = new Date(since).getTime();
  if (!Number.isFinite(cutoff)) return items;
  return items.filter((item) => new Date(dateOf(item)).getTime() > cutoff);
}
