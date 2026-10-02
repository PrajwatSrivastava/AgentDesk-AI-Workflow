import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { cap, getJson, IntegrationError } from "./http";

// Unauthenticated: 60 req/hour per IP, easily used up on shared serverless egress. A PAT gives 5,000/hour.
const API = "https://api.github.com";

function headers(secret?: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  };
}

const RATE_LIMIT_HINT =
  "Without a token GitHub allows only 60 requests per hour per IP. Add a personal access token in Connections.";

interface Issue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  comments: number;
  created_at: string;
  updated_at: string;
  body: string | null;
  user: { login: string } | null;
  labels: ({ name: string } | string)[];
  pull_request?: unknown;
}

const listIssues = defineAction({
  app: "github",
  action: "list_issues",
  description:
    "List recent issues on a public GitHub repository. Pull requests are excluded. Use this to watch a project's bug tracker.",
  returns:
    "{ count, repo, items: [{ number, title, url, state, author, comments, createdAt, labels, excerpt }] }",
  params: z.object({
    repo: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/, 'must be "owner/name", e.g. vercel/next.js')
      // Reject "../user" etc., which would resolve to /user/issues (the token's private issues)
      .refine((value) => !value.split("/").some((part) => /^\.+$/.test(part)), {
        message: 'must be "owner/name", e.g. vercel/next.js',
      })
      .describe('repository as "owner/name"'),
    state: z.enum(["open", "closed", "all"]).default("open"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  needs: "github",
  async run({ repo, state, limit }, secret) {
    const url = new URL(`${API}/repos/${repo}/issues`);
    url.searchParams.set("state", state);
    url.searchParams.set("per_page", String(Math.min(limit * 2, 40)));
    url.searchParams.set("sort", "created");

    const issues = await getJson<Issue[]>(url.toString(), {
      label: "GitHub",
      headers: headers(secret),
      hint: RATE_LIMIT_HINT,
    });

    const items = cap(
      issues.filter((issue) => !issue.pull_request),
      limit,
    ).map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      state: issue.state,
      author: issue.user?.login ?? null,
      comments: issue.comments,
      createdAt: issue.created_at,
      labels: issue.labels.map((label) =>
        typeof label === "string" ? label : label.name,
      ),
      excerpt: issue.body?.slice(0, 500) ?? null,
    }));

    return { count: items.length, repo, items };
  },
});

interface RepoSearchResponse {
  total_count: number;
  items: {
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
    updated_at: string;
  }[];
}

const searchRepos = defineAction({
  app: "github",
  action: "search_repos",
  description:
    "Search public GitHub repositories, most stars first. Use this for competitive research on open-source projects.",
  returns:
    "{ count, totalMatches, query, items: [{ name, url, description, stars, language, updatedAt }] }",
  params: z.object({
    query: z.string().min(1).describe("search terms, e.g. 'workflow automation'"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  needs: "github",
  async run({ query, limit }, secret) {
    const url = new URL(`${API}/search/repositories`);
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "stars");
    url.searchParams.set("per_page", String(limit));

    const data = await getJson<RepoSearchResponse>(url.toString(), {
      label: "GitHub",
      headers: headers(secret),
      hint: RATE_LIMIT_HINT,
    });

    const items = cap(data.items, limit).map((repo) => ({
      name: repo.full_name,
      url: repo.html_url,
      description: repo.description,
      stars: repo.stargazers_count,
      language: repo.language,
      updatedAt: repo.updated_at,
    }));

    return { count: items.length, totalMatches: data.total_count, query, items };
  },
});

export const github = defineApp({
  key: "github",
  label: "GitHub",
  auth: "token",
  authHint:
    "Optional. Without a token GitHub allows 60 requests an hour, shared by everyone using this server; with one, 5,000 an hour of your own. Read-only access to public repositories is all it needs. Free.",
  placeholder: "github_pat_…",
  setupSteps: [
    {
      text: "Open GitHub's page for a new fine-grained token. Sign in first if it asks.",
      link: {
        href: "https://github.com/settings/personal-access-tokens/new",
        label: "Create a GitHub token",
      },
    },
    {
      text: "Name it Agent Desk and choose an expiration — 90 days is a sensible default. Under Repository access pick Public repositories. Leave every permission off.",
    },
    { text: "Click Generate token, copy it, and paste it below. GitHub shows it only once." },
  ],
  // /rate_limit doesn't count against the limit and reports the token's quota
  async verify(secret) {
    try {
      const limits = await getJson<{ resources?: { core?: { limit?: number } } }>(
        `${API}/rate_limit`,
        { label: "GitHub", headers: headers(secret) },
      );
      const limit = limits.resources?.core?.limit;
      return limit
        ? `Connected. GitHub now allows ${limit.toLocaleString()} requests an hour.`
        : "Connected.";
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 401) {
        throw new IntegrationError(
          "GitHub rejected that token",
          401,
          "Copy it again — it may be cut short, expired or revoked.",
        );
      }
      throw error;
    }
  },
  actions: [listIssues, searchRepos],
});
