import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { cap, getJson, newerThan } from "./http";

interface DevtoArticle {
  id: number;
  title: string;
  description: string;
  url: string;
  published_at: string;
  positive_reactions_count: number;
  comments_count: number;
  reading_time_minutes: number;
  tag_list: string[];
  user: { name: string; username: string };
}

const articles = defineAction({
  app: "devto",
  action: "articles",
  description:
    "Get developer articles from Dev.to, optionally for one tag (e.g. ai, react, rust, webdev). Sort by 'top' for the most-reacted articles of recent days, or 'latest' for the newest. Good material for content research and drafting posts.",
  returns:
    "{ count, items: [{ title, url, author, reactions, comments, readingMinutes, tags, publishedAt, excerpt }] }",
  params: z.object({
    tag: z
      .string()
      .regex(/^[a-z0-9]{1,30}$/, "a lowercase Dev.to tag with no spaces, e.g. webdev")
      .optional()
      .describe("topic tag such as ai, react, webdev; omit for all topics"),
    sort: z.enum(["top", "latest"]).default("top"),
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(7)
      .describe("for sort=top: how many days back to rank over"),
    since: z.string().optional().describe("ISO timestamp; only articles published after this"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async run({ tag, sort, days, since, limit }) {
    const url = new URL(
      sort === "latest" ? "https://dev.to/api/articles/latest" : "https://dev.to/api/articles",
    );
    // Over-fetch since the `since` filter runs afterwards
    url.searchParams.set("per_page", String(Math.min(limit * 3, 60)));
    if (tag) url.searchParams.set("tag", tag);
    if (sort === "top") url.searchParams.set("top", String(days));

    const data = await getJson<DevtoArticle[]>(url.toString(), { label: "Dev.to" });

    let ordered = newerThan(data, since, (article) => article.published_at);
    // /latest isn't strictly date-ordered when filtered by tag
    if (sort === "latest") {
      ordered = [...ordered].sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      );
    }

    const items = cap(ordered, limit).map((article) => ({
      id: article.id,
      title: article.title,
      url: article.url,
      author: article.user.name || article.user.username,
      reactions: article.positive_reactions_count,
      comments: article.comments_count,
      readingMinutes: article.reading_time_minutes,
      tags: article.tag_list,
      publishedAt: article.published_at,
      excerpt: article.description?.slice(0, 500) || null,
    }));

    return { count: items.length, items };
  },
});

export const devto = defineApp({
  key: "devto",
  label: "Dev.to",
  auth: "none",
  actions: [articles],
});
