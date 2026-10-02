import type { WorkflowSpec } from "@/core/spec";

export interface AgentType {
  key: string;
  name: string;
  /** One line */
  description: string;
  role: string;
  /** Only affects the compiler's wording */
  persona: string;
  avatarColor: string;
  /** App keys */
  suggests: string[];
  /** {{agent.*}} values. Empty means the workspace asks before the first run. */
  vars: Record<string, string>;
  presets: { name: string; spec: WorkflowSpec }[];
}

// No amber avatars: amber is reserved for "needs a human" in the UI.
export const AGENT_TYPES: readonly AgentType[] = [
  {
    key: "personal-assistant",
    name: "Personal Assistant",
    description: "Manages meetings, emails, and tasks",
    role: "Keep track of what needs doing and surface it at the right time",
    persona: "Concise and practical. Leads with what needs a decision.",
    avatarColor: "#c97b4b",
    suggests: ["weather", "slack", "notion"],
    vars: {},
    presets: [
      {
        name: "Morning briefing",
        spec: {
          version: 1,
          name: "Morning briefing",
          trigger: { type: "schedule", everyMinutes: 1440 },
          steps: [
            {
              id: "feed",
              type: "action",
              app: "rss",
              action: "fetch_feed",
              params: { url: "https://news.ycombinator.com/rss", limit: 10 },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{feed.count}}", op: "gt", right: 0 },
            },
            {
              id: "brief",
              type: "ai",
              prompt:
                "Write a three-sentence morning briefing from these headlines. Plain language, no hype.\n\n{{feed.items}}",
              outputSchema: { summary: "string", topStory: "string" },
            },
            {
              id: "send",
              type: "action",
              app: "slack",
              action: "post_message",
              params: { text: "*Morning briefing*\n\n{{brief.summary}}" },
            },
          ],
        },
      },
    ],
  },
  {
    key: "market-researcher",
    name: "Market Researcher",
    description: "Research competitors, trending topics, & sentiment",
    role: "Watch the market and report what changed",
    persona: "Analytical. Separates signal from noise and says which is which.",
    avatarColor: "#8b5cf6",
    suggests: ["hackernews", "lobsters", "github"],
    // Multi-word queries are searched as an exact phrase
    vars: { watchTerm: "Drizzle ORM" },
    presets: [
      {
        name: "Watch Hacker News for mentions",
        spec: {
          version: 1,
          name: "Watch Hacker News for mentions",
          trigger: { type: "schedule", everyMinutes: 60 },
          steps: [
            {
              id: "fetch",
              type: "action",
              app: "hackernews",
              action: "search_stories",
              params: { query: "{{agent.watchTerm}}", since: "{{trigger.lastRunAt}}" },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{fetch.count}}", op: "gt", right: 0 },
            },
            {
              id: "brief",
              type: "ai",
              prompt:
                "You are briefing a founder on new Hacker News discussion of their product.\n\nWrite two or three sentences on what was said and why it matters. Set urgent to true only if this needs a reply today.\n\n{{fetch.items}}",
              outputSchema: {
                summary: "string",
                sentiment: "positive|neutral|negative",
                urgent: "boolean",
              },
            },
            {
              id: "check",
              type: "human",
              when: { left: "{{brief.urgent}}", op: "eq", right: true },
              message: "An urgent mention came up. Post it to Slack?",
              shows: ["{{brief.summary}}"],
            },
            {
              id: "post",
              type: "action",
              app: "slack",
              action: "post_message",
              params: { text: "*New mentions on Hacker News*\n\n{{brief.summary}}" },
            },
          ],
        },
      },
      {
        name: "Weekly competitor repo scan",
        spec: {
          version: 1,
          name: "Weekly competitor repo scan",
          trigger: { type: "schedule", everyMinutes: 10080 },
          steps: [
            {
              id: "search",
              type: "action",
              app: "github",
              action: "search_repos",
              params: { query: "workflow automation", limit: 10 },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{search.count}}", op: "gt", right: 0 },
            },
            {
              id: "digest",
              type: "ai",
              prompt:
                "Summarise the competitive landscape from these repositories. Note which are gaining traction.\n\n{{search.items}}",
              outputSchema: { summary: "string", notable: "string[]" },
            },
            {
              id: "post",
              type: "action",
              app: "slack",
              action: "post_message",
              params: { text: "*Weekly competitor scan*\n\n{{digest.summary}}" },
            },
          ],
        },
      },
    ],
  },
  {
    key: "social-media-marketer",
    name: "Social Media Marketer",
    description: "Perform content research and draft articles and social posts",
    role: "Find what is worth writing about and draft it",
    persona: "Writes in a clear, direct voice. No exclamation marks, no hype.",
    avatarColor: "#5c6ff0",
    suggests: ["devto", "bluesky", "hackernews"],
    vars: { topic: "developer tools" },
    presets: [
      {
        name: "Draft a post from today's news",
        spec: {
          version: 1,
          name: "Draft a post from today's news",
          trigger: { type: "schedule", everyMinutes: 1440 },
          steps: [
            {
              id: "fetch",
              type: "action",
              app: "hackernews",
              action: "search_stories",
              params: { query: "{{agent.topic}}", since: "{{trigger.lastRunAt}}" },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{fetch.count}}", op: "gt", right: 0 },
            },
            {
              id: "draft",
              type: "ai",
              prompt:
                "Pick the single most interesting item below and draft a short LinkedIn post about it. Lead with the specific thing that happened, not a generic hook.\n\n{{fetch.items}}",
              outputSchema: { post: "string", angle: "string" },
            },
            {
              id: "review",
              type: "human",
              message: "Draft ready. Send it to your inbox?",
              shows: ["{{draft.post}}"],
            },
            {
              id: "send",
              type: "action",
              app: "resend",
              action: "send_email",
              // No `to`: uses the address from the Connections page
              params: {
                subject: "Draft: {{draft.angle}}",
                body: "{{draft.post}}",
              },
            },
          ],
        },
      },
    ],
  },
  {
    key: "daily-briefer",
    name: "Daily Briefer",
    description: "Weather, rain alerts and the top news on Slack",
    role: "Start each day with the local weather and the news that matters",
    persona: "Brief and warm. Leads with anything that changes today's plans.",
    avatarColor: "#0ea5e9",
    suggests: ["weather", "rss", "slack"],
    vars: { city: "" },
    presets: [
      {
        name: "Morning brief: weather and top 5 news",
        spec: {
          version: 1,
          name: "Morning brief: weather and top 5 news",
          trigger: { type: "schedule", everyMinutes: 1440 },
          steps: [
            {
              id: "weather",
              type: "action",
              app: "weather",
              action: "forecast",
              params: { location: "{{agent.city}}" },
            },
            {
              id: "news",
              type: "action",
              app: "rss",
              action: "fetch_feed",
              params: { url: "https://news.google.com/rss", limit: 5 },
            },
            {
              id: "brief",
              type: "ai",
              prompt:
                "Write a morning briefing for someone in {{agent.city}}.\n\nweather: one or two sentences on today's weather with the high and low. If willRain is true, start with a plain rain warning that gives the chance of rain.\nheadlines: the five stories below as five lines, each starting with \"• \" and one short plain-language sentence. Leave out the publisher name at the end of each title.\n\nWeather:\n{{weather}}\n\nTop stories right now:\n{{news.items}}",
              outputSchema: { weather: "string", headlines: "string" },
            },
            {
              id: "post",
              type: "action",
              app: "slack",
              action: "post_message",
              params: {
                text: "*Good morning*\n\n{{brief.weather}}\n\n*Top 5 stories right now*\n{{brief.headlines}}",
              },
            },
          ],
        },
      },
      {
        // No ai step, so this costs nothing to run
        name: "Rain alert",
        spec: {
          version: 1,
          name: "Rain alert",
          trigger: { type: "schedule", everyMinutes: 720 },
          steps: [
            {
              id: "weather",
              type: "action",
              app: "weather",
              action: "forecast",
              params: { location: "{{agent.city}}" },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{weather.willRain}}", op: "eq", right: true },
            },
            {
              id: "post",
              type: "action",
              app: "slack",
              action: "post_message",
              params: {
                text: "*Rain likely in {{weather.location}} today*\n{{weather.today.rainChance}}% chance, about {{weather.today.rainTotal}} {{weather.units.precipitation}} expected. Forecast: {{weather.today.condition}}, high {{weather.today.high}}{{weather.units.temperature}}.",
              },
            },
          ],
        },
      },
    ],
  },
  {
    key: "trend-spotter",
    name: "Trend Spotter",
    description: "Spot topics trending across developer communities",
    role: "Find what several developer communities are talking about at the same time",
    persona: "Curious and precise. Names the communities behind every trend.",
    avatarColor: "#10b981",
    suggests: ["hackernews", "devto", "notion"],
    vars: {},
    presets: [
      {
        name: "Cross-community trend spotter",
        spec: {
          version: 1,
          name: "Cross-community trend spotter",
          trigger: { type: "schedule", everyMinutes: 1440 },
          steps: [
            {
              id: "hn",
              type: "action",
              app: "hackernews",
              action: "top_stories",
              params: { limit: 15 },
            },
            {
              id: "lobsters",
              type: "action",
              app: "lobsters",
              action: "stories",
              params: { sort: "hottest", limit: 15 },
            },
            {
              id: "devto",
              type: "action",
              app: "devto",
              action: "articles",
              params: { sort: "top", days: 1, limit: 15 },
            },
            {
              id: "spot",
              type: "ai",
              prompt:
                "Below are today's top posts from three developer communities. Find the topics that at least two of them are discussing. Match on subject rather than exact title: the same release, company, technology or debate counts.\n\nfound: true only if at least one topic appears in two or more communities.\nheading: \"Trends for\" followed by the date of {{trigger.firedAt}} written out, e.g. \"Trends for 2 October 2026\".\ntrends: up to five lines, most widely discussed first, each in the form \"• Topic (communities): why people are talking about it\".\n\nHacker News:\n{{hn.items}}\n\nLobsters:\n{{lobsters.items}}\n\nDev.to:\n{{devto.items}}",
              outputSchema: { found: "boolean", heading: "string", trends: "string" },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{spot.found}}", op: "eq", right: true },
            },
            {
              id: "save",
              type: "action",
              app: "notion",
              action: "append_to_page",
              // No `pageId`: uses the page from the Connections page
              params: { text: "{{spot.heading}}\n{{spot.trends}}" },
            },
          ],
        },
      },
    ],
  },
  {
    key: "news-monitor",
    name: "News Monitor",
    description: "Follow any topic across the news and new research",
    role: "Track a topic across news outlets and research papers and report what is new",
    persona: "Neutral and factual. Names the outlet or paper behind every claim.",
    avatarColor: "#db2777",
    suggests: ["rss", "slack"],
    vars: { newsTopic: "", researchTopic: "" },
    presets: [
      {
        name: "News monitor",
        spec: {
          version: 1,
          name: "News monitor",
          trigger: { type: "schedule", everyMinutes: 360 },
          steps: [
            {
              id: "news",
              type: "action",
              app: "rss",
              action: "fetch_feed",
              // %22 quotes the topic so it matches as a phrase
              params: {
                url: "https://news.google.com/rss/search?q=%22{{agent.newsTopic}}%22+when:1d&hl=en",
                since: "{{trigger.lastRunAt}}",
                limit: 10,
              },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{news.count}}", op: "gt", right: 0 },
            },
            {
              id: "brief",
              type: "ai",
              prompt:
                "Summarise the latest news coverage of {{agent.newsTopic}}.\n\nsummary: one line per distinct story, at most five, each starting with \"• \" and ending with the outlet in brackets. Merge articles that cover the same story.\ntone: the overall tone of the coverage.\n\n{{news.items}}",
              outputSchema: { summary: "string", tone: "positive|neutral|negative|mixed" },
            },
            {
              id: "post",
              type: "action",
              app: "slack",
              action: "post_message",
              params: {
                text: "*{{agent.newsTopic}} in the news* ({{brief.tone}})\n\n{{brief.summary}}",
              },
            },
          ],
        },
      },
      {
        name: "Weekly research digest",
        spec: {
          version: 1,
          name: "Weekly research digest",
          trigger: { type: "schedule", everyMinutes: 10080 },
          steps: [
            {
              id: "papers",
              type: "action",
              app: "rss",
              action: "fetch_feed",
              params: {
                url: "https://export.arxiv.org/api/query?search_query=all:%22{{agent.researchTopic}}%22&sortBy=submittedDate&sortOrder=descending&max_results=20",
                since: "{{trigger.lastRunAt}}",
                limit: 15,
              },
            },
            {
              id: "gate",
              type: "filter",
              condition: { left: "{{papers.count}}", op: "gt", right: 0 },
            },
            {
              id: "digest",
              type: "ai",
              prompt:
                "Explain these new research papers on {{agent.researchTopic}} to a smart reader who is not a specialist.\n\ndigest: the five most significant papers, one per line. Each line starts with \"• \", then the paper title between single asterisks for Slack bold, then one sentence on what it found and why it matters.\n\n{{papers.items}}",
              outputSchema: { digest: "string" },
            },
            {
              id: "post",
              type: "action",
              app: "slack",
              action: "post_message",
              params: { text: "*New research on {{agent.researchTopic}}*\n\n{{digest.digest}}" },
            },
          ],
        },
      },
    ],
  },
];

// Per-agent values only. Things like the Notion page or email recipient live on the connection.
export interface ValueField {
  label: string;
  hint?: string;
  placeholder?: string;
  /** Validated against a live service before saving. */
  check?: "place";
}

// Keyed by value name so chat-compiled workflows get the same prompts as presets.
const VALUE_FIELDS: Record<string, ValueField> = {
  city: {
    label: "Your city",
    hint: "Used for the weather forecast. Add the country if the name is common.",
    placeholder: "e.g. Pune, India",
    check: "place",
  },
  newsTopic: {
    label: "News topic",
    hint: "A company, product or subject, matched as an exact phrase.",
    placeholder: "e.g. electric vehicles",
  },
  researchTopic: {
    label: "Research topic",
    hint: "Searched as an exact phrase across new arXiv papers.",
    placeholder: "e.g. AI agents",
  },
  watchTerm: { label: "Product or company to watch", placeholder: "e.g. Drizzle ORM" },
  topic: { label: "Topic", placeholder: "e.g. developer tools" },
};

export function valueField(key: string): ValueField {
  return VALUE_FIELDS[key] ?? { label: humanize(key) };
}

/** Integration settings that older stored agents may still carry. Never asked for per agent. */
export function isIntegrationValue(key: string): boolean {
  return /e-?mail|inbox|recipient|notionpage|pageid/i.test(key);
}

// Placeholder defaults that may still be stored on old agents; treat as unset.
const SHIPPED_PLACEHOLDERS = new Set(["me@example.com", "you@example.com"]);

export function isUnsetValue(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed === "" || SHIPPED_PLACEHOLDERS.has(trimmed);
}

function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function findAgentType(key: string): AgentType | undefined {
  return AGENT_TYPES.find((type) => type.key === key);
}
