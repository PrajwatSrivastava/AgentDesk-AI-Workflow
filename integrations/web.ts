import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { getJson, getPage, IntegrationError } from "./http";
import { extractFromMarkdown, extractPage, type ExtractedPage } from "./web-extract";

const JINA_TIMEOUT_MS = 20_000;
// Jina Reader allows 20 requests a minute per IP without a key; stay under it per instance.
const JINA_PER_MINUTE = 15;
const jinaCalls: number[] = [];

// The direct fetch found almost nothing: likely a page that renders with JavaScript.
const isThin = (page: ExtractedPage, wantItems: boolean) =>
  page.text.length < 200 || (wantItems && page.items.length < 2);

interface Read {
  page: ExtractedPage;
  url: string;
  via: "direct" | "jina";
  note?: string;
}

async function viaJina(url: string): Promise<{ markdown: string; title: string } | null> {
  const now = Date.now();
  while (jinaCalls.length && now - jinaCalls[0] > 60_000) jinaCalls.shift();
  if (jinaCalls.length >= JINA_PER_MINUTE) return null;
  jinaCalls.push(now);

  const key = process.env.JINA_API_KEY;
  const body = await getJson<{ data?: { content?: string; title?: string } }>(`https://r.jina.ai/${url}`, {
    label: "Jina Reader",
    timeoutMs: JINA_TIMEOUT_MS,
    headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
  });
  return body.data?.content ? { markdown: body.data.content, title: body.data.title ?? "" } : null;
}

async function readUrl(url: string, options: { selector?: string; maxChars: number; itemLimit: number }, wantItems: boolean): Promise<Read> {
  let page: ExtractedPage | null = null;
  let finalUrl = url;
  try {
    const fetched = await getPage(url, { label: "Web page", timeoutMs: 15_000 });
    finalUrl = fetched.finalUrl;
    try {
      page = extractPage(fetched.body, finalUrl, options);
    } catch (error) {
      if (options.selector && error instanceof Error) {
        throw new IntegrationError(`"${options.selector}" is not a valid CSS selector`, undefined, "Leave the selector out to detect entries automatically.");
      }
      throw error;
    }
  } catch (error) {
    // Only a refusal by the site itself is worth retrying elsewhere; never SSRF or robots refusals
    if (!(error instanceof IntegrationError && (error.status === 403 || error.status === 429))) throw error;
  }

  if (page && !isThin(page, wantItems)) return { page, url: finalUrl, via: "direct" };

  // Selectors apply to the site's HTML, which Jina doesn't return
  if (options.selector && page) return { page, url: finalUrl, via: "direct" };

  let jina: Awaited<ReturnType<typeof viaJina>> = null;
  try {
    jina = await viaJina(finalUrl);
  } catch {
    jina = null;
  }
  if (jina) {
    const fromMarkdown = extractFromMarkdown(jina.markdown, finalUrl, options.maxChars);
    return {
      page: {
        title: page?.title || jina.title,
        description: page?.description ?? "",
        publishedAt: page?.publishedAt ?? null,
        tables: page?.tables ?? [],
        ...fromMarkdown,
        items: fromMarkdown.items.slice(0, options.itemLimit),
      },
      url: finalUrl,
      via: "jina",
    };
  }
  if (page) return { page, url: finalUrl, via: "direct", note: "The page looked mostly empty and the JavaScript fallback was unavailable." };
  throw new IntegrationError(
    "That site refused the request",
    403,
    "Some sites block automated readers. Try another page, or the site's RSS feed.",
  );
}

const readPage = defineAction({
  app: "web",
  action: "read_page",
  description:
    "Read one web page and return its main text, links and tables, cleaned of menus, ads and scripts. Use for a single article, announcement or information page at a known URL. For a page that lists many entries (jobs, events, fellowships, posts) use web.list_items instead.",
  returns: "{ url, title, description, publishedAt, text, links: [{ text, url }], tables: [[{ column: value }]], via, truncated }",
  params: z.object({
    url: z.string().url().describe("full URL of the page"),
    selector: z.string().max(200).optional().describe("CSS selector for the part of the page to read; omit to detect the main content"),
    maxChars: z.number().int().min(1000).max(20000).default(8000).describe("how much text to keep"),
  }),
  async run({ url, selector, maxChars }) {
    const { page, url: finalUrl, via, note } = await readUrl(url, { selector, maxChars, itemLimit: 0 }, false);
    return {
      url: finalUrl,
      title: page.title,
      description: page.description,
      publishedAt: page.publishedAt,
      text: page.text,
      links: page.links,
      tables: page.tables,
      via,
      truncated: page.truncated,
      ...(note ? { note } : {}),
    };
  },
});

const listItems = defineAction({
  app: "web",
  action: "list_items",
  description:
    "Read a web page that lists many entries (jobs, events, fellowships, grants, blog posts, releases) and return each entry with its title, link, date and a short text. Entries are detected automatically; pass a CSS selector only if the user gives one.",
  returns: "{ count, url, via, items: [{ title, url, date (YYYY-MM-DD or null), text }] }",
  params: z.object({
    url: z.string().url().describe("full URL of the listing page"),
    selector: z.string().max(200).optional().describe("CSS selector matching one entry; omit to detect entries automatically"),
    limit: z.number().int().min(1).max(30).default(15),
  }),
  async run({ url, selector, limit }) {
    const { page, url: finalUrl, via, note } = await readUrl(url, { selector, maxChars: 4000, itemLimit: limit }, true);
    return { count: page.items.length, url: finalUrl, via, items: page.items, ...(note ? { note } : {}) };
  },
});

export const web = defineApp({
  key: "web",
  label: "Web",
  auth: "none",
  actions: [readPage, listItems],
});
