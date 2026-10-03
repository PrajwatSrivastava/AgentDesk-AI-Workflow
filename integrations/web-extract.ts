import * as cheerio from "cheerio";
import { parseLooseDate } from "@/lib/dates";
import { normalizeUrl } from "@/lib/urls";

export interface ExtractedLink {
  text: string;
  url: string;
}

export interface ExtractedItem {
  title: string;
  url: string;
  /** YYYY-MM-DD when the entry shows a date */
  date: string | null;
  text: string;
}

export interface ExtractedPage {
  title: string;
  description: string;
  publishedAt: string | null;
  text: string;
  truncated: boolean;
  links: ExtractedLink[];
  /** Each table as rows keyed by its header cells */
  tables: Record<string, string>[][];
  items: ExtractedItem[];
}

interface ExtractOptions {
  /** CSS selector for the entries of a listing page */
  selector?: string;
  maxChars?: number;
  itemLimit?: number;
}

// Page furniture that is never the content.
const NOISE = [
  "script", "style", "noscript", "svg", "iframe", "canvas", "template", "object", "embed",
  "nav", "aside", "form", "button", "select", "dialog",
  "body > header", "body > footer", "footer",
  "[role=navigation]", "[role=banner]", "[role=contentinfo]", "[role=search]",
  "[aria-hidden=true]", "[hidden]",
].join(",");

// Menus and widgets recognised by their class or id (language pickers, breadcrumbs, cookie bars...)
const NOISE_NAME = /(^|[\s_-])(nav|navbar|navigation|menu|dropdown|breadcrumbs?|cookies?|consent|banner|share|sharing|social|sidebar|toolbar|popup|modal|language|languages|skip|subscribe|newsletter|related|comments?|footer|masthead|toc|navbox|catlinks|printfooter|mw-portlet)([\s_-]|$)/i;

// Article bodies, most specific first
const CONTENT = ["[itemprop=articleBody]", "#mw-content-text", ".entry-content", ".post-content", ".article-body", "article", "main", "[role=main]", "#content", "#main"] as const;

const BLOCKS = "p,div,li,dt,dd,h1,h2,h3,h4,h5,h6,tr,section,article,blockquote,pre,figcaption,table,ul,ol";

const clean = (value: string | undefined | null) => (value ?? "").replace(/\s+/g, " ").trim();

/**
 * Entries of one list usually share a URL shape (/job/123, /posts/my-title, ?jobId=5).
 * Slug-like and numeric path segments become * and query keys are kept, values dropped.
 */
export function urlPattern(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => (/\d/.test(segment) || segment.length > 24 || segment.split("-").length > 2 ? "*" : segment))
      .join("/");
    const keys = [...url.searchParams.keys()].sort().join("&");
    return `${url.host}/${path}${keys ? `?${keys}` : ""}`;
  } catch {
    return href;
  }
}

/** The largest group of at least 3 links sharing a URL shape, if any. */
function largestPatternGroup<T extends { url: string; title: string }>(entries: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = urlPattern(entry.url);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  let best: T[] = [];
  let bestDistinct = 0;
  for (const group of groups.values()) {
    const meaningful = group.filter((entry) => entry.title.length >= 15);
    // "Read more" or "Discuss this" repeated on every card is a button, not an entry title
    const distinct = new Set(meaningful.map((entry) => entry.title.toLowerCase())).size;
    if (distinct >= 3 && distinct > bestDistinct) {
      best = meaningful;
      bestDistinct = distinct;
    }
  }
  return best;
}

/**
 * Turns raw HTML into clean, structured data: readable text of the main content, links,
 * tables as rows, and the entries of a listing page. Deterministic, no AI.
 * Throws a SyntaxError for an invalid `selector`.
 */
export function extractPage(html: string, baseUrl: string, options: ExtractOptions = {}): ExtractedPage {
  const maxChars = options.maxChars ?? 8000;
  const itemLimit = options.itemLimit ?? 15;
  const $ = cheerio.load(html);

  // Metadata first, before scripts (JSON-LD) are removed
  const title = clean($("meta[property='og:title']").attr("content")) || clean($("title").first().text()) || clean($("h1").first().text());
  const description = clean($("meta[name='description']").attr("content")) || clean($("meta[property='og:description']").attr("content"));
  let publishedAt =
    parseLooseDate($("meta[property='article:published_time']").attr("content")) ??
    parseLooseDate($("time[datetime]").first().attr("datetime"));
  if (!publishedAt) {
    $("script[type='application/ld+json']").each((_, el) => {
      if (publishedAt) return;
      try {
        const data = JSON.parse($(el).text()) as Record<string, unknown> | Record<string, unknown>[];
        for (const node of Array.isArray(data) ? data : [data]) {
          const value = node.datePublished ?? node.startDate ?? node.dateCreated;
          if (typeof value === "string") publishedAt = parseLooseDate(value);
          if (publishedAt) break;
        }
      } catch {
        // malformed JSON-LD is common, skip it
      }
    });
  }

  $(NOISE).remove();
  $("div,ul,ol,section,span,p,table").each((_, el) => {
    const $el = $(el);
    const name = `${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""}`;
    if (NOISE_NAME.test(name) && !$el.is("main,article,[role=main]")) $el.remove();
  });
  $("br").replaceWith("\n");
  $(BLOCKS).each((_, el) => {
    $(el).prepend("\n").append("\n");
  });

  // Main content: the most specific container with real text, else the whole body (cheerio always adds one)
  let root = $("body");
  for (const candidate of CONTENT) {
    const found = $(candidate).first();
    if (found.length && clean(found.text()).length > 200) {
      root = found;
      break;
    }
  }

  // Text: one trimmed line per block, empty and repeated lines dropped
  const lines: string[] = [];
  for (const line of root.text().split("\n")) {
    const tidy = clean(line);
    if (tidy && tidy !== lines[lines.length - 1]) lines.push(tidy);
  }
  let text = lines.join("\n");
  let truncated = false;
  if (text.length > maxChars) {
    const cut = text.lastIndexOf("\n", maxChars);
    text = text.slice(0, cut > maxChars / 2 ? cut : maxChars);
    truncated = true;
  }

  // Links: absolute, deduped, with readable text
  const links: ExtractedLink[] = [];
  const seenLinks = new Set<string>();
  root.find("a[href]").each((_, el) => {
    if (links.length >= 50) return false;
    const url = normalizeUrl($(el).attr("href"), baseUrl);
    const linkText = clean($(el).text()) || clean($(el).attr("title"));
    if (!url || !linkText || seenLinks.has(url)) return;
    seenLinks.add(url);
    links.push({ text: linkText.slice(0, 200), url });
  });

  // Tables: header row becomes the keys
  const tables: Record<string, string>[][] = [];
  root.find("table").each((_, table) => {
    if (tables.length >= 3) return false;
    const $table = $(table);
    if ($table.find("table").length) return; // skip layout tables that nest others
    const rows = $table.find("tr").toArray();
    if (rows.length < 2) return;
    const headerCells = $(rows[0]).find("th,td").toArray().map((cell, index) => clean($(cell).text()) || `column_${index + 1}`);
    if (headerCells.length < 2) return;
    const keys = headerCells.map((key, index) => (headerCells.indexOf(key) === index ? key : `${key}_${index + 1}`));
    const body: Record<string, string>[] = [];
    for (const row of rows.slice(1, 51)) {
      const cells = $(row).find("td,th").toArray().map((cell) => clean($(cell).text()));
      if (cells.every((cell) => !cell)) continue;
      body.push(Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ""])));
    }
    if (body.length) tables.push(body);
  });

  // Entries of a listing page
  const pageUrl = normalizeUrl(baseUrl);
  const toItem = (el: Parameters<typeof $>[0]): ExtractedItem | null => {
    const $el = $(el);
    const heading = $el.find("h1,h2,h3,h4").first();
    // The entry's own link is the one with the most text (not a vote arrow or an author name)
    const anchors = (heading.find("a[href]").length ? heading.find("a[href]") : $el.find("a[href]")).toArray();
    let longest = anchors[0];
    for (const candidate of anchors) {
      if (clean($(candidate).text()).length > clean($(longest).text()).length) longest = candidate;
    }
    const anchor = $el.is("a[href]") ? $el : longest ? $(longest) : $el.find("a[href]").first();
    const url = normalizeUrl(anchor.attr("href"), baseUrl);
    const body = clean($el.text());
    const itemTitle = clean(heading.text()) || clean(anchor.text()) || body.slice(0, 120);
    if (!itemTitle || !url || url === pageUrl) return null;
    const date = parseLooseDate($el.find("time[datetime]").attr("datetime")) ?? parseLooseDate(body);
    return { title: itemTitle.slice(0, 200), url, date, text: body.slice(0, 400) };
  };

  const fromNodes = (nodes: Parameters<typeof $>[0][], minTitle = 0): ExtractedItem[] => {
    const items: ExtractedItem[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const item = toItem(node);
      if (!item || item.title.length < minTitle || seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
    return items;
  };

  let items: ExtractedItem[];
  if (options.selector) {
    items = fromNodes($(options.selector).toArray());
  } else {
    // Candidate groups of repeated entries; the one with the most real entries wins
    const groups: Parameters<typeof $>[0][][] = [root.find("article").toArray()];
    root.find("ul,ol").each((_, list) => {
      groups.push($(list).children("li").filter((__, li) => $(li).find("a[href]").length > 0).toArray());
    });
    groups.push(root.find("h2,h3").filter((_, h) => $(h).find("a[href]").length > 0).toArray());
    root.find("table").each((_, table) => {
      groups.push($(table).find("tr").filter((__, tr) => $(tr).find("a[href]").length > 0).toArray());
    });
    // Links that share a URL shape, each with its nearest block as context
    const byPattern = largestPatternGroup(
      root.find("a[href]").toArray().map((a) => ({ node: a, url: normalizeUrl($(a).attr("href"), baseUrl) ?? "", title: clean($(a).text()) })),
    );
    groups.push(byPattern.map((entry) => $(entry.node).closest("li,article,tr").get(0) ?? entry.node));

    let best: ExtractedItem[] = [];
    let bestScore = 0;
    for (const group of groups) {
      if (group.length < 3) continue;
      // Short titles are menus, tags or usernames rather than entries; repeated ones are buttons
      const candidate = fromNodes(group, 15);
      const score = new Set(candidate.map((item) => item.title.toLowerCase())).size;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    items = best;
  }

  return { title, description, publishedAt, text, truncated, links, tables, items: items.slice(0, itemLimit) };
}

/** Readable text and links from Jina Reader's markdown, for pages that need JavaScript. */
export function extractFromMarkdown(markdown: string, baseUrl: string, maxChars: number): Pick<ExtractedPage, "text" | "truncated" | "links" | "items"> {
  // Images first, so a linked image doesn't become link text
  const withoutImages = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  for (const match of withoutImages.matchAll(/\[([^\]]{2,200})\]\((https?:[^)\s]+)\)/g)) {
    const url = normalizeUrl(match[2], baseUrl);
    const linkText = clean(match[1].replace(/[*_`#]/g, ""));
    if (!url || !linkText || seen.has(url)) continue;
    seen.add(url);
    links.push({ text: linkText, url });
  }
  const text = withoutImages
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map(clean)
    .filter(Boolean)
    .join("\n");
  const truncated = text.length > maxChars;
  const items = largestPatternGroup(links.map((link) => ({ ...link, title: link.text }))).map((link) => ({
    title: link.text,
    url: link.url,
    date: parseLooseDate(link.text),
    text: link.text,
  }));
  return { text: truncated ? text.slice(0, maxChars) : text, truncated, links: links.slice(0, 50), items };
}
