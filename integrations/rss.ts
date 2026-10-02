import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { cap, getText, IntegrationError, newerThan } from "./http";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
  // Otherwise a title like "2.10" becomes the number 2.1
  parseTagValue: false,
});

// RSS 2.0: rss.channel.item, Atom: feed.entry
function extractEntries(parsed: Record<string, unknown>): {
  feedTitle: string;
  entries: Record<string, unknown>[];
} {
  const rss = parsed.rss as { channel?: Record<string, unknown> } | undefined;
  if (rss?.channel) {
    return {
      feedTitle: text(rss.channel.title) ?? "Untitled feed",
      entries: toArray(rss.channel.item),
    };
  }

  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (feed) {
    return {
      feedTitle: text(feed.title) ?? "Untitled feed",
      entries: toArray(feed.entry),
    };
  }

  throw new IntegrationError(
    "That URL did not return RSS or Atom XML",
    undefined,
    "Check the feed URL. Many sites publish it at /feed or /rss.",
  );
}

function toArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

// Plain string, or an object when there's CDATA/attributes
function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>)["#text"];
    if (typeof inner === "string") return inner;
  }
  return null;
}

function link(entry: Record<string, unknown>): string | null {
  const raw = entry.link;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const alternate = raw.find(
      (candidate) =>
        candidate && typeof candidate === "object" && candidate["@rel"] !== "self",
    );
    return (alternate as Record<string, string> | undefined)?.["@href"] ?? null;
  }
  if (raw && typeof raw === "object") {
    return (raw as Record<string, string>)["@href"] ?? text(raw);
  }
  return null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const fetchFeed = defineAction({
  app: "rss",
  action: "fetch_feed",
  description:
    "Fetch the newest entries from an RSS or Atom feed. Use this to watch a blog, changelog, news site or podcast. Also works for GitHub releases (github.com/<owner>/<repo>/releases.atom), Google News top stories (news.google.com/rss) and searches (news.google.com/rss/search?q=<term>), YouTube channels (youtube.com/feeds/videos.xml?channel_id=<id>) and arXiv (export.arxiv.org/api/query?search_query=all:<term>).",
  returns: "{ count, feedTitle, items: [{ title, url, publishedAt, author, excerpt }] }",
  params: z.object({
    url: z.string().url().describe("full URL of the RSS or Atom feed"),
    since: z
      .string()
      .optional()
      .describe("ISO timestamp; only entries published after this. Undated entries are dropped"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async run({ url, since, limit }) {
    const xml = await getText(url, {
      label: "RSS feed",
      // workflow-supplied URL (SSRF)
      publicOnly: true,
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      hint: "If this keeps failing, the site may be blocking datacenter IPs. Try a different feed.",
    });

    const parsed = parser.parse(xml) as Record<string, unknown>;
    const { feedTitle, entries } = extractEntries(parsed);

    const all = entries.map((entry) => {
      const summary =
        text(entry.description) ?? text(entry.summary) ?? text(entry.content) ?? "";
      return {
        title: text(entry.title) ?? "(untitled)",
        url: link(entry),
        publishedAt: text(entry.pubDate) ?? text(entry.published) ?? text(entry.updated),
        // Atom uses <author><name>
        author:
          text(entry.author) ??
          text((entry.author as Record<string, unknown> | undefined)?.name) ??
          text(entry["dc:creator"]),
        excerpt: stripHtml(summary).slice(0, 500),
      };
    });

    // Filter before cap so limit applies to new entries only
    const items = cap(
      newerThan(all, since, (item) => item.publishedAt ?? ""),
      limit,
    );

    return { count: items.length, feedTitle, items };
  },
});

export const rss = defineApp({
  key: "rss",
  label: "RSS",
  auth: "none",
  actions: [fetchFeed],
});
