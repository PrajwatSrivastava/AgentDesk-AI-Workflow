import { z } from "zod";
import { neutralizeMentions } from "@/lib/untrusted";
import { defineAction, defineApp } from "./define";
import { getJson, IntegrationError, request } from "./http";

const API = "https://api.tavily.com";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
  published_date?: string;
}

const csv = (value?: string) =>
  (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);

// Tavily's own status codes: 432 = plan limit reached, 433 = pay-as-you-go limit reached
function tavilyError(error: unknown): never {
  if (error instanceof IntegrationError) {
    if (error.status === 401) {
      throw new IntegrationError("Tavily rejected the API key", 401, "Paste a fresh key from app.tavily.com on the Connections page.");
    }
    if (error.status === 432 || error.status === 433) {
      throw new IntegrationError(
        "This month's free Tavily searches are used up",
        error.status,
        "Searches reset on the 1st of the month. Run the skill less often, or upgrade the Tavily plan.",
      );
    }
    if (error.status === 429) {
      throw new IntegrationError("Tavily is rate limiting requests", 429, "Try again in a minute.");
    }
  }
  throw error;
}

const search = defineAction({
  app: "tavily",
  action: "search",
  description:
    "Search the web and return the best matching pages with a short snippet each, and optionally each page's full text. Use when the job needs current information from the web and no specific URL is given (for example fellowships, grants, events, deadlines, prices). Each call uses one of the user's monthly Tavily searches.",
  returns: "{ count, query, items: [{ title, url, snippet, publishedAt, pageText }] }",
  params: z.object({
    query: z.string().min(2).max(300).describe("what to search for, phrased like a search engine query"),
    limit: z.number().int().min(1).max(10).default(5),
    topic: z.enum(["general", "news"]).default("general").describe("news for recent articles"),
    timeRange: z.enum(["day", "week", "month", "year"]).optional().describe("only pages from this recent period"),
    includePageText: z.boolean().default(false).describe("also return each page's main text (up to 4000 characters); use when details are needed, with limit 5 or less"),
    includeDomains: z.string().max(300).optional().describe("comma-separated domains to search only, e.g. 80000hours.org,aisafety.com"),
    excludeDomains: z.string().max(300).optional().describe("comma-separated domains to skip"),
  }),
  needs: "tavily",
  secretRequired: true,
  async run({ query, limit, topic, timeRange, includePageText, includeDomains, excludeDomains }, secret) {
    if (!secret) {
      throw new IntegrationError("No Tavily API key is connected", undefined, "Add a free Tavily key on the Connections page.");
    }
    let results: TavilyResult[] = [];
    try {
      const response = await request(`${API}/search`, {
        method: "POST",
        label: "Tavily",
        timeoutMs: 20_000,
        headers: { authorization: `Bearer ${secret}` },
        body: {
          query,
          max_results: limit,
          topic,
          search_depth: "basic",
          ...(timeRange ? { time_range: timeRange } : {}),
          ...(includePageText ? { include_raw_content: "text" } : {}),
          ...(csv(includeDomains).length ? { include_domains: csv(includeDomains) } : {}),
          ...(csv(excludeDomains).length ? { exclude_domains: csv(excludeDomains) } : {}),
        },
      });
      results = ((await response.json()) as { results?: TavilyResult[] }).results ?? [];
    } catch (error) {
      tavilyError(error);
    }
    const items = results
      .filter((result) => result.url && result.title)
      .map((result) => ({
        title: neutralizeMentions(result.title ?? ""),
        url: result.url ?? "",
        snippet: neutralizeMentions((result.content ?? "").slice(0, 600)),
        publishedAt: result.published_date ?? null,
        pageText: includePageText ? neutralizeMentions((result.raw_content ?? "").slice(0, 4000)) : "",
      }));
    return { count: items.length, query, items };
  },
});

export const tavily = defineApp({
  key: "tavily",
  label: "Tavily",
  auth: "token",
  authHint:
    "Lets agents search the web. Free plan: 1,000 searches a month, no card needed. Each run of a search skill uses one, so an hourly skill uses about 720 a month.",
  placeholder: "tvly-…",
  setupSteps: [
    {
      text: "Create a free account at Tavily (1,000 searches a month, no credit card).",
      link: { href: "https://app.tavily.com", label: "Open Tavily" },
    },
    { text: "Copy your API key from the Overview page. It starts with tvly-." },
    { text: "Paste it below. It's checked against Tavily before it's saved." },
  ],
  async verify(secret) {
    try {
      const usage = await getJson<{ key?: { usage?: number; limit?: number | null } }>(`${API}/usage`, {
        label: "Tavily",
        headers: { authorization: `Bearer ${secret}` },
      });
      const used = usage.key?.usage;
      const limit = usage.key?.limit;
      return typeof used === "number" && typeof limit === "number"
        ? `Connected. ${used} of ${limit} searches used this month.`
        : "Connected.";
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 404) {
        // No usage endpoint on this account: a one-result search proves the key instead
        await request(`${API}/search`, {
          method: "POST",
          label: "Tavily",
          headers: { authorization: `Bearer ${secret}` },
          body: { query: "test", max_results: 1 },
        }).catch(tavilyError);
        return "Connected.";
      }
      tavilyError(error);
    }
  },
  actions: [search],
});
