import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { cap, getJson } from "./http";

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
  story_text: string | null;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
}

function toItems(hits: AlgoliaHit[], limit: number) {
  return cap(hits, limit).map((hit) => ({
    id: hit.objectID,
    title: hit.title ?? "(untitled)",
    url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author,
    points: hit.points ?? 0,
    comments: hit.num_comments ?? 0,
    createdAt: hit.created_at,
    discussionUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    excerpt: hit.story_text?.slice(0, 500) ?? null,
  }));
}

function epochSeconds(iso: string): number | null {
  const seconds = Math.floor(new Date(iso).getTime() / 1000);
  return Number.isFinite(seconds) ? seconds : null;
}

// Algolia does prefix expansion and typo tolerance (bare `Tesla` matches ~20k stories).
// Quoting turns both off. Applied to single words too.
function toPhrase(query: string): string {
  const trimmed = query.trim();
  return trimmed.includes('"') ? trimmed : `"${trimmed}"`;
}

const searchStories = defineAction({
  app: "hackernews",
  action: "search_stories",
  description:
    "Search Hacker News story titles for a specific keyword or product name, newest first. Use this only when there is a term to search for — to get the best stories with no search term, use top_stories instead. A multi-word name is matched as an exact phrase.",
  returns:
    "{ count, totalMatches, query, items: [{ title, url, points, comments, author, createdAt, discussionUrl, excerpt }] }",
  params: z.object({
    query: z.string().min(1).describe("product name or keyword; full names work best"),
    since: z
      .string()
      .optional()
      .describe("ISO timestamp; only return stories created after this"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async run({ query, since, limit }) {
    const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
    url.searchParams.set("query", toPhrase(query));
    url.searchParams.set("tags", "story");
    url.searchParams.set("hitsPerPage", String(limit));
    url.searchParams.set("restrictSearchableAttributes", "title,url");
    url.searchParams.set("advancedSyntax", "true");

    if (since) {
      const seconds = epochSeconds(since);
      if (seconds !== null) {
        url.searchParams.set("numericFilters", `created_at_i>${seconds}`);
      }
    }

    const data = await getJson<AlgoliaResponse>(url.toString(), {
      label: "Hacker News",
    });

    const items = toItems(data.hits, limit);
    return { count: items.length, totalMatches: data.nbHits, query, items };
  },
});

// For requests with no search term. Uses /search (HN ranking), not /search_by_date.
const topStories = defineAction({
  app: "hackernews",
  action: "top_stories",
  description:
    "Get the highest-ranked Hacker News stories. With no `since`, returns the current front page. With `since`, returns the best stories posted after that time. Use this whenever the request has no search term — 'top 5 stories', 'what's on Hacker News today', 'best posts this morning'.",
  returns:
    "{ count, window, items: [{ title, url, points, comments, author, createdAt, discussionUrl }] }",
  params: z.object({
    since: z
      .string()
      .optional()
      .describe(
        "ISO timestamp; rank the best stories posted after this instead of the front page",
      ),
    limit: z.number().int().min(1).max(30).default(10),
  }),
  async run({ since, limit }) {
    const url = new URL("https://hn.algolia.com/api/v1/search");
    url.searchParams.set("hitsPerPage", String(limit));

    const seconds = since ? epochSeconds(since) : null;
    if (seconds !== null) {
      url.searchParams.set("tags", "story");
      url.searchParams.set("numericFilters", `created_at_i>${seconds}`);
    } else {
      url.searchParams.set("tags", "front_page");
    }

    const data = await getJson<AlgoliaResponse>(url.toString(), {
      label: "Hacker News",
    });

    const items = toItems(data.hits, limit);
    return {
      count: items.length,
      window: seconds === null ? "front page" : `since ${since}`,
      items,
    };
  },
});

export const hackernews = defineApp({
  key: "hackernews",
  label: "Hacker News",
  auth: "none",
  actions: [topStories, searchStories],
});
