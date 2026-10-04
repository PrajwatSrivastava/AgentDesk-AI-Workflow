import { recordListFields, type StepType, type WorkflowSpec } from "@/core/spec";
import { findAction } from "@/integrations/registry";

// Answers as the clarify card sends them, after formatClarifications
const SEND_TO = {
  slack: "Where should the results go? Slack",
  app: "Where should the results go? Just show me in the app",
};
const NO_APPROVAL = "Should it ask you before sending? No, send it automatically";
const ASK_WHEN_IMPORTANT = "Should it ask you before sending? Only when something looks important";
const SENDS = ["slack.post_message", "resend.send_email", "notion.append_to_page"];
const WEB = ["tavily.search", "web.read_page", "web.list_items"];

// Structural checks only (actions, cadence, filters, approvals). Exact matching would break on wording changes.
export interface Fixture {
  name: string;
  request: string;
  /** Confirmed details, as the clarify card would send them */
  clarifications?: string[];
  expect: {
    triggerType?: WorkflowSpec["trigger"]["type"];
    everyMinutes?: number;
    /** app.action pairs that must appear in the spec. */
    usesActions?: string[];
    /** app.action pairs that must not appear */
    lacksActions?: string[];
    /** Minimum number of steps calling an app.action, e.g. one search per topic */
    actionAtLeast?: Record<string, number>;
    /** Some ai step extracts a list of records ({a,b}[]) */
    aiListField?: boolean;
    /** Sending steps post a tidy_list's text, never raw items */
    deliversListText?: boolean;
    hasStepTypes?: StepType[];
    lacksStepTypes?: StepType[];
    /** Checked both ways: a missing `when` pauses every run, an extra one stops asking. */
    humanHasWhen?: boolean;
    /** Some filter's left must mention this field (catches count filters on object-shaped sources). */
    filterTestsField?: string;
  };
}

export const FIXTURES: Fixture[] = [
  {
    name: "hn mentions to slack with conditional approval",
    request:
      "Every hour, check Hacker News for mentions of Linear and send me anything important on Slack. Ask me before posting if it's urgent.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 60,
      usesActions: ["hackernews.search_stories", "slack.post_message"],
      // A named source shouldn't turn into a web search
      lacksActions: WEB,
      hasStepTypes: ["filter", "ai", "human"],
      humanHasWhen: true,
    },
  },
  {
    // The same request as it arrives from the app, after the clarify card
    name: "conditional approval confirmed on the card",
    request:
      "Every hour, check Hacker News for mentions of Linear and send me anything important on Slack. Ask me before posting if it's urgent.",
    clarifications: [SEND_TO.slack, "How often should it run? Every hour", ASK_WHEN_IMPORTANT],
    expect: {
      triggerType: "schedule",
      everyMinutes: 60,
      usesActions: ["hackernews.search_stories", "slack.post_message"],
      hasStepTypes: ["ai", "human"],
      humanHasWhen: true,
    },
  },
  {
    // Should use top_stories. search_stories with an empty query only fails at run time.
    name: "top stories, no search term",
    request:
      "Send me an email at me@example.com with the top 5 Hacker News stories from the last hour.",
    expect: {
      triggerType: "schedule",
      usesActions: ["hackernews.top_stories", "resend.send_email"],
      lacksStepTypes: ["human"],
    },
  },
  {
    name: "weather, only when it will rain",
    request:
      "Every morning, check the weather in London and post to Slack only if it's going to rain today.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 1440,
      usesActions: ["weather.forecast", "slack.post_message"],
      hasStepTypes: ["filter"],
      lacksStepTypes: ["human"],
      filterTestsField: "rain",
    },
  },
  {
    name: "lobsters by tag",
    request: "Every evening, post the top Lobsters stories tagged rust to Slack.",
    expect: {
      triggerType: "schedule",
      usesActions: ["lobsters.stories", "slack.post_message"],
    },
  },
  {
    name: "follow a bluesky account",
    request:
      "Every hour, check what bsky.app has posted on Bluesky, summarise anything new and send it to Slack.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 60,
      usesActions: ["bluesky.author_posts", "slack.post_message"],
      hasStepTypes: ["ai", "filter"],
    },
  },
  {
    name: "dev.to draft with approval",
    request:
      "Each morning, find the top Dev.to articles about react this week, draft a LinkedIn post about the best one, and let me approve it before it goes to Slack.",
    expect: {
      triggerType: "schedule",
      usesActions: ["devto.articles", "slack.post_message"],
      hasStepTypes: ["ai", "human"],
      humanHasWhen: false,
    },
  },
  {
    name: "rss digest to notion, daily",
    request:
      "Read the Vercel changelog RSS feed every morning and log a plain-English summary to my Notion page.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 1440,
      usesActions: ["rss.fetch_feed", "notion.append_to_page"],
      lacksActions: WEB,
      hasStepTypes: ["ai"],
      lacksStepTypes: ["human"],
    },
  },
  {
    name: "github issues to slack, no approval",
    request:
      "Twice a day, look at new open issues on vercel/next.js and post a summary to Slack. No need to ask me.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 720,
      usesActions: ["github.list_issues", "slack.post_message"],
      lacksStepTypes: ["human"],
    },
  },
  {
    name: "hn to email",
    request:
      "Search Hacker News for posts about AI agents every 4 hours and email me a digest at me@example.com.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 240,
      usesActions: ["hackernews.search_stories", "resend.send_email"],
      hasStepTypes: ["ai"],
    },
  },
  {
    name: "frequent rss check",
    request:
      "Check https://news.ycombinator.com/rss every 15 minutes and Slack me anything about databases.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 15,
      usesActions: ["rss.fetch_feed", "slack.post_message"],
      // A feed URL should be read as a feed, not scraped
      lacksActions: WEB,
      hasStepTypes: ["filter"],
    },
  },
  {
    name: "competitor repo research, weekly",
    request:
      "Once a week, search GitHub for workflow automation repositories and append the top results to Notion.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 10080,
      usesActions: ["github.search_repos", "notion.append_to_page"],
    },
  },
  {
    name: "unconditional approval before sending",
    request:
      "Every morning summarise new Hacker News posts about our product Acme and always ask me to approve the summary before it goes to Slack.",
    expect: {
      triggerType: "schedule",
      usesActions: ["hackernews.search_stories", "slack.post_message"],
      hasStepTypes: ["human", "ai"],
      // "always ask me", so no condition
      humanHasWhen: false,
    },
  },
  {
    name: "sentiment classification",
    request:
      "Hourly, find Hacker News discussion of Supabase, work out whether the sentiment is positive or negative, and only Slack me when it's negative.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 60,
      usesActions: ["hackernews.search_stories", "slack.post_message"],
      hasStepTypes: ["ai", "filter"],
    },
  },
  {
    name: "webhook trigger",
    request:
      "When my site sends a webhook, summarise the payload and post it to Slack.",
    expect: {
      triggerType: "webhook",
      usesActions: ["slack.post_message"],
      hasStepTypes: ["ai"],
    },
  },
  {
    name: "manual trigger",
    request:
      "I want to run this by hand: search GitHub for issues on facebook/react and email them to me@example.com.",
    expect: {
      triggerType: "manual",
      usesActions: ["github.list_issues", "resend.send_email"],
    },
  },
  {
    name: "two sources in one workflow",
    request:
      "Every hour check both Hacker News for 'Drizzle ORM' and the https://orm.drizzle.team/rss.xml feed, then Slack me a combined summary.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 60,
      usesActions: ["hackernews.search_stories", "rss.fetch_feed", "slack.post_message"],
      hasStepTypes: ["ai"],
    },
  },
  {
    name: "draft content for review",
    request:
      "Each morning, read https://blog.example.com/feed, draft a LinkedIn post about the most interesting item, and let me approve it before emailing it to me@example.com.",
    expect: {
      triggerType: "schedule",
      everyMinutes: 1440,
      usesActions: ["rss.fetch_feed", "resend.send_email"],
      hasStepTypes: ["ai", "human"],
    },
  },
  {
    // The example from the clarify card: no source named, so it has to search
    name: "fellowship deadlines via web search",
    request: "Give me 5 fellowship deadlines related to AI safety.",
    clarifications: [
      "Which fellowships should be included? Only ones still accepting applications",
      SEND_TO.slack,
      "How often should it run? Every week",
      NO_APPROVAL,
    ],
    expect: {
      triggerType: "schedule",
      everyMinutes: 10080,
      usesActions: ["tavily.search", "data.tidy_list", "slack.post_message"],
      aiListField: true,
      deliversListText: true,
      lacksStepTypes: ["human"],
    },
  },
  {
    // Was compiled as one topic ("AI failures leading to climate disasters"), which found nothing
    name: "two news topics, searched separately",
    request: "AI security news on AI failures and climate disasters",
    clarifications: [
      "Which news do you want? News on each topic",
      "Where should the results go? Notion",
      "How often should it run? Only when I run it",
      NO_APPROVAL,
    ],
    // A link list (records + tidy_list) and a written digest are both fine; one search per topic is the point
    expect: {
      triggerType: "manual",
      usesActions: ["tavily.search", "notion.append_to_page"],
      actionAtLeast: { "tavily.search": 2 },
      hasStepTypes: ["ai"],
    },
  },
  {
    name: "listing page via list_items",
    request:
      "Check https://jobs.example.org/remote for new job posts that mention Rust and send me the list.",
    clarifications: [SEND_TO.slack, "How often should it run? Every day", NO_APPROVAL],
    expect: {
      triggerType: "schedule",
      everyMinutes: 1440,
      usesActions: ["web.list_items", "slack.post_message"],
      lacksActions: ["tavily.search"],
    },
  },
  {
    name: "one article via read_page, run by hand",
    request: "Summarise https://paulgraham.com/greatwork.html in five bullet points.",
    clarifications: [SEND_TO.app, "How often should it run? Only when I run it", NO_APPROVAL],
    expect: {
      triggerType: "manual",
      usesActions: ["web.read_page"],
      lacksActions: [...SENDS, "tavily.search"],
      hasStepTypes: ["ai"],
    },
  },
  {
    // "Just show me in the app" means the run page is the destination
    name: "show me in the app, no send step",
    request: "Read the Vercel changelog at https://vercel.com/atom and summarise what changed.",
    clarifications: [SEND_TO.app, "How often should it run? Every day", NO_APPROVAL],
    expect: {
      triggerType: "schedule",
      everyMinutes: 1440,
      usesActions: ["rss.fetch_feed"],
      lacksActions: SENDS,
      hasStepTypes: ["ai"],
    },
  },
];

/** Empty array means the fixture passed. */
export function checkFixture(fixture: Fixture, spec: WorkflowSpec): string[] {
  const failures: string[] = [];
  const { expect } = fixture;

  if (expect.triggerType && spec.trigger.type !== expect.triggerType) {
    failures.push(`trigger is "${spec.trigger.type}", expected "${expect.triggerType}"`);
  }

  if (expect.everyMinutes !== undefined) {
    const actual = spec.trigger.type === "schedule" ? spec.trigger.everyMinutes : undefined;
    if (actual !== expect.everyMinutes) {
      failures.push(`cadence is ${actual ?? "n/a"} minutes, expected ${expect.everyMinutes}`);
    }
  }

  const usedActions = new Set(
    spec.steps
      .filter((step) => step.type === "action" || step.type === "notify")
      .map((step) => `${step.app}.${step.action}`),
  );
  for (const required of expect.usesActions ?? []) {
    if (!usedActions.has(required)) {
      failures.push(`missing action ${required} (got: ${[...usedActions].join(", ") || "none"})`);
    }
  }
  for (const forbidden of expect.lacksActions ?? []) {
    if (usedActions.has(forbidden)) failures.push(`should not use ${forbidden}`);
  }
  for (const [action, minimum] of Object.entries(expect.actionAtLeast ?? {})) {
    const times = spec.steps.filter(
      (step) => (step.type === "action" || step.type === "notify") && `${step.app}.${step.action}` === action,
    ).length;
    if (times < minimum) failures.push(`${action} is used ${times} time(s), expected at least ${minimum}`);
  }

  if (expect.aiListField) {
    const extracts = spec.steps.some(
      (step) => step.type === "ai" && Object.values(step.outputSchema).some((type) => recordListFields(type)),
    );
    if (!extracts) failures.push("no ai step extracts a list of records ({a,b}[])");
  }

  if (expect.deliversListText) {
    const tidyIds = spec.steps
      .filter((step) => step.type === "action" && step.app === "data" && step.action === "tidy_list")
      .map((step) => step.id);
    const sendParams = spec.steps.flatMap((step) =>
      (step.type === "action" || step.type === "notify") && findAction(step.app, step.action)?.sideEffect
        ? Object.values(step.params).filter((value): value is string => typeof value === "string")
        : [],
    );
    const postsText = sendParams.some((value) =>
      tidyIds.some((id) => new RegExp(`\\{\\{\\s*${id}\\.text\\s*\\}\\}`).test(value)),
    );
    if (!postsText) failures.push("the sending step doesn't post a tidy_list's text");
    if (sendParams.some((value) => /\.items\s*\}\}/.test(value))) {
      failures.push("the sending step posts raw .items");
    }
  }

  const usedTypes = new Set(spec.steps.map((step) => step.type));
  for (const required of expect.hasStepTypes ?? []) {
    if (!usedTypes.has(required)) failures.push(`missing a "${required}" step`);
  }
  for (const forbidden of expect.lacksStepTypes ?? []) {
    if (usedTypes.has(forbidden)) failures.push(`should not contain a "${forbidden}" step`);
  }

  if (expect.filterTestsField) {
    const field = expect.filterTestsField.toLowerCase();
    const tested = spec.steps.some(
      (step) => step.type === "filter" && step.condition.left.toLowerCase().includes(field),
    );
    if (!tested) {
      const lefts = spec.steps
        .filter((step) => step.type === "filter")
        .map((step) => (step.type === "filter" ? step.condition.left : ""));
      failures.push(
        `no filter tests a "${expect.filterTestsField}" field (filters test: ${lefts.join(", ") || "nothing"})`,
      );
    }
  }

  if (expect.humanHasWhen !== undefined) {
    const human = spec.steps.find((step) => step.type === "human");
    if (!human) {
      failures.push("expected an approval step to check the condition on");
    } else if (human.type === "human") {
      const hasWhen = human.when !== undefined;
      if (hasWhen !== expect.humanHasWhen) {
        failures.push(
          expect.humanHasWhen
            ? "approval step has no `when`, so it would pause on every run"
            : "approval step has a `when`, but the request asked to always be consulted",
        );
      }
    }
  }

  return failures;
}
