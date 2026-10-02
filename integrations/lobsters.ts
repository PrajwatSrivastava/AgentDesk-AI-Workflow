import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { cap, getJson, IntegrationError, newerThan } from "./http";

interface LobstersStory {
  short_id: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  created_at: string;
  submitter_user: string;
  tags: string[];
  comments_url: string;
  description_plain: string;
}

const stories = defineAction({
  app: "lobsters",
  action: "stories",
  description:
    "Get stories from Lobsters, a programming-focused link aggregator similar to Hacker News but with tagged topics. Use a tag to follow one subject (e.g. rust, ai, security, web, databases). Without a tag, returns the front page.",
  returns:
    "{ count, items: [{ title, url, score, comments, author, tags, createdAt, discussionUrl, excerpt }] }",
  params: z.object({
    tag: z
      .string()
      // LLM-written and goes into the URL path, so restrict to tag characters
      .regex(/^[a-z0-9_-]{1,30}$/, "a lowercase Lobsters tag, e.g. rust or ai")
      .optional()
      .describe("topic tag such as rust, ai, security; omit for the front page"),
    sort: z.enum(["hottest", "newest"]).default("hottest").describe("ignored when a tag is given"),
    since: z.string().optional().describe("ISO timestamp; only stories posted after this"),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  async run({ tag, sort, since, limit }) {
    const path = tag ? `t/${tag}` : sort;

    let data: LobstersStory[];
    try {
      data = await getJson<LobstersStory[]>(`https://lobste.rs/${path}.json`, {
        label: "Lobsters",
      });
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 404) {
        throw new IntegrationError(
          `Lobsters has no tag "${tag}"`,
          404,
          "See lobste.rs/tags for the full list. Common ones: ai, rust, security, web, databases, programming.",
        );
      }
      throw error;
    }

    const items = cap(
      newerThan(data, since, (story) => story.created_at),
      limit,
    ).map((story) => ({
      id: story.short_id,
      title: story.title,
      // Text posts have no url
      url: story.url || story.comments_url,
      score: story.score,
      comments: story.comment_count,
      author: story.submitter_user,
      tags: story.tags,
      createdAt: story.created_at,
      discussionUrl: story.comments_url,
      excerpt: story.description_plain?.slice(0, 500) || null,
    }));

    return { count: items.length, items };
  },
});

export const lobsters = defineApp({
  key: "lobsters",
  label: "Lobsters",
  auth: "none",
  actions: [stories],
});
