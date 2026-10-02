import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { cap, getJson, IntegrationError, newerThan } from "./http";

// Public AppView, no auth. No search action: searchPosts returns 403 without a session.

interface FeedItem {
  post: {
    uri: string;
    author: { handle: string; displayName?: string };
    record: { text: string; createdAt: string };
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
  };
  /** Set on reposts */
  reason?: { $type: string };
}

function normaliseHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").replace(/^https?:\/\/bsky\.app\/profile\//, "");
}

/** `at://did/app.bsky.feed.post/<rkey>` to bsky.app URL */
function webUrl(uri: string, handle: string): string {
  const rkey = uri.split("/").at(-1);
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

const authorPosts = defineAction({
  app: "bluesky",
  action: "author_posts",
  description:
    "Get the recent posts of one specific Bluesky account. Use this to follow a person, company or publication. This cannot search Bluesky for a keyword — it only reads a named account's own posts.",
  returns:
    "{ count, handle, items: [{ text, url, author, likes, reposts, replies, createdAt, isRepost }] }",
  params: z.object({
    handle: z
      .string()
      .min(3)
      .max(253)
      .describe('account handle, e.g. "bsky.app" or "@jay.bsky.team"'),
    includeReposts: z.boolean().default(false),
    since: z.string().optional().describe("ISO timestamp; only posts created after this"),
    limit: z.number().int().min(1).max(30).default(10),
  }),
  async run({ handle, includeReposts, since, limit }) {
    const actor = normaliseHandle(handle);
    if (!/^(did:[a-z]+:[a-zA-Z0-9._:-]+|[a-zA-Z0-9.-]+)$/.test(actor)) {
      throw new IntegrationError(
        `"${handle}" is not a Bluesky handle`,
        undefined,
        'A handle looks like "name.bsky.social" or a custom domain such as "bsky.app".',
      );
    }

    const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed");
    url.searchParams.set("actor", actor);
    url.searchParams.set("limit", String(Math.min(limit * 2, 50)));
    url.searchParams.set("filter", "posts_no_replies");

    let data: { feed: FeedItem[] };
    try {
      data = await getJson<{ feed: FeedItem[] }>(url.toString(), { label: "Bluesky" });
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 400) {
        throw new IntegrationError(
          `Bluesky has no account "${actor}"`,
          400,
          "Check the handle on bsky.app — custom-domain handles have no .bsky.social suffix.",
        );
      }
      throw error;
    }

    const own = includeReposts ? data.feed : data.feed.filter((item) => !item.reason);
    const items = cap(
      newerThan(own, since, (item) => item.post.record.createdAt),
      limit,
    ).map((item) => ({
      id: item.post.uri,
      text: item.post.record.text,
      url: webUrl(item.post.uri, item.post.author.handle),
      author: item.post.author.displayName || item.post.author.handle,
      likes: item.post.likeCount ?? 0,
      reposts: item.post.repostCount ?? 0,
      replies: item.post.replyCount ?? 0,
      createdAt: item.post.record.createdAt,
      isRepost: Boolean(item.reason),
    }));

    return { count: items.length, handle: actor, items };
  },
});

export const bluesky = defineApp({
  key: "bluesky",
  label: "Bluesky",
  auth: "none",
  actions: [authorPosts],
});
