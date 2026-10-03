import assert from "node:assert/strict";

// Offline checks for the scraper, the list cleaner and the clarify plumbing. No network, no keys.
//   npm run check-web

const { extractPage, extractFromMarkdown } = await import("@/integrations/web-extract");
const { tidyList } = await import("@/integrations/data");
const { parseRobots } = await import("@/integrations/http");
const { parseLooseDate } = await import("@/lib/dates");
const { normalizeUrl } = await import("@/lib/urls");
const { neutralizeMentions } = await import("@/lib/untrusted");
const { WorkflowSpec, recordListFields, outputSchemaToZod } = await import("@/core/spec");
const { validateSpec } = await import("@/compiler/validate");
const { formatClarifications } = await import("@/compiler/clarify");
const { answersFor } = await import("@/lib/clarify-types");
const { sanitizeMessages } = await import("@/lib/chat-messages");
const { AGENT_TYPES } = await import("@/lib/agent-types");

let passed = 0;
let failed = 0;
function check(name: string, test: () => void) {
  try {
    test();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message.split("\n").join("\n      ") : String(error)}`);
  }
}

// Fixed "today" so date windows don't drift
const NOW = new Date("2026-10-03T12:00:00Z");
const BASE = "https://example.com/blog/index.html";
const filler = "Doing great work takes curiosity, taste and a lot of patience. ".repeat(6);

// ---------- extractPage ----------

const ARTICLE = `<html><head>
<title>Site name</title>
<meta property="og:title" content="How to Do Great Work">
<meta name="description" content="An essay about ambitious work">
<meta property="article:published_time" content="2026-03-15T10:00:00Z">
</head><body>
<header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
<div class="language-picker"><a href="/fr">Français</a></div>
<article>
  <h1>How to Do Great Work</h1>
  <p>${filler}</p>
  <p>Read the <a href="/next?utm_source=feed&amp;id=2#top">next essay</a> after this one.</p>
</article>
<footer>Copyright 2026</footer>
<script>var tracking = true;</script>
</body></html>`;

check("article: metadata, main text, page furniture removed", () => {
  const page = extractPage(ARTICLE, BASE);
  assert.equal(page.title, "How to Do Great Work");
  assert.equal(page.description, "An essay about ambitious work");
  assert.equal(page.publishedAt, "2026-03-15");
  assert.match(page.text, /Doing great work takes curiosity/);
  for (const furniture of ["Home", "Français", "Copyright", "tracking"]) {
    assert.ok(!page.text.includes(furniture), `text still contains "${furniture}"`);
  }
  assert.equal(page.truncated, false);
});

check("article: links made absolute without tracking or fragment", () => {
  const page = extractPage(ARTICLE, BASE);
  assert.deepEqual(page.links, [{ text: "next essay", url: "https://example.com/next?id=2" }]);
});

check("article: long text is cut at a line break and flagged", () => {
  const long = `<body><main>${Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i}. ${filler}</p>`).join("")}</main></body>`;
  const page = extractPage(long, BASE, { maxChars: 1000 });
  assert.equal(page.truncated, true);
  assert.ok(page.text.length <= 1000, `text is ${page.text.length} characters`);
  assert.ok(page.text.endsWith("patience."), "cut mid-line");
});

const JOBS = ["Rust engineer, platform team", "Senior Rust developer (remote)", "Embedded Rust firmware engineer", "Rust compiler contributor fellowship", "Backend engineer, Rust and Postgres"];
const LISTING = `<html><body><main>
<h1>Open roles</h1>
<ul class="tags"><li><a href="/t/rust">rust</a></li><li><a href="/t/go">go</a></li><li><a href="/t/remote">remote</a></li></ul>
<ul>
${JOBS.map((title, i) => `<li class="job"><a href="/jobs/${100 + i}-role">${title}</a> <span>Deadline: ${10 + i} March 2027</span> <a href="/u/someone">by someone</a></li>`).join("\n")}
</ul>
<p>${filler}</p>
</main></body></html>`;

check("listing: finds the repeated entries, not tags or author links", () => {
  const page = extractPage(LISTING, "https://jobs.example.org/remote");
  assert.equal(page.items.length, 5);
  assert.deepEqual(page.items.map((item) => item.title), JOBS);
  assert.equal(page.items[0].url, "https://jobs.example.org/jobs/100-role");
  assert.equal(page.items[0].date, "2027-03-10");
  assert.equal(page.items[4].date, "2027-03-14");
});

check("listing: an explicit selector picks exactly those entries", () => {
  const page = extractPage(LISTING, "https://jobs.example.org/remote", { selector: "li.job", itemLimit: 3 });
  assert.equal(page.items.length, 3);
  assert.equal(page.items[2].title, JOBS[2]);
});

check("listing: an invalid selector throws", () => {
  assert.throws(() => extractPage(LISTING, BASE, { selector: "li[" }));
});

check("table: rows keyed by the header cells", () => {
  const html = `<body><main><p>${filler}</p><table>
    <tr><th>Programme</th><th>Deadline</th><th>Deadline</th></tr>
    <tr><td>MATS</td><td>15 March</td><td>rolling</td></tr>
    <tr><td></td><td></td><td></td></tr>
    <tr><td>Astra</td><td>1 Nov</td></tr>
  </table></main></body>`;
  const page = extractPage(html, BASE);
  assert.deepEqual(page.tables, [
    [
      { Programme: "MATS", Deadline: "15 March", Deadline_3: "rolling" },
      { Programme: "Astra", Deadline: "1 Nov", Deadline_3: "" },
    ],
  ]);
});

check("JavaScript-only shell: nothing to extract (web.ts then tries Jina)", () => {
  const page = extractPage(`<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`, BASE);
  assert.equal(page.text, "");
  assert.equal(page.items.length, 0);
});

check("Jina markdown: images dropped, entries found by URL shape", () => {
  const markdown = [
    "![logo](https://example.com/logo.png)",
    "[![Card](https://example.com/card.png)](https://example.com/posts/ignored-image-link)",
    "[Home](https://example.com/)",
    ...JOBS.slice(0, 4).map((title, i) => `- [${title}](https://example.com/posts/${i}-a-b-c)`),
  ].join("\n");
  const result = extractFromMarkdown(markdown, BASE, 5000);
  assert.ok(!result.text.includes("logo.png"));
  assert.deepEqual(result.items.map((item) => item.title), JOBS.slice(0, 4));
});

// ---------- tidyList ----------

const RAW = [
  { name: "<b>MATS</b>   Winter", organisation: "MATS", deadline: "15 March 2027", url: "https://matsprogram.org/?utm_source=x" },
  { name: "mats winter", organisation: "MATS", deadline: "2027-03-15", url: "https://matsprogram.org/" },
  { name: "Old fellowship", organisation: "X", deadline: "1 Jan 2026", url: "https://old.example.org" },
  { name: "Undated programme", organisation: "Y", deadline: "", url: "https://nodate.example.org" },
  { name: "", organisation: "Z", deadline: "2027-01-01", url: "https://noname.example.org" },
  { name: "Astra Fellowship", organisation: "", deadline: "Nov 1", url: "https://astra.example.org" },
];

check("tidy_list: clean, require, window, dedupe, sort, format", () => {
  const result = tidyList(
    RAW,
    {
      requireFields: "name,url",
      dateField: "deadline",
      keep: "upcoming",
      sortBy: "deadline",
      order: "asc",
      limit: 5,
      format: "• {name} ({organisation}), deadline {deadline}: {url}",
    },
    NOW,
  );
  assert.equal(result.count, 2);
  assert.deepEqual(result.dropped, { missingFields: 1, duplicates: 1, outsideWindow: 1, undated: 1, overLimit: 0 });
  assert.equal(
    result.text,
    "• Astra Fellowship, deadline 2026-11-01: https://astra.example.org/\n• MATS Winter (MATS), deadline 2027-03-15: https://matsprogram.org/",
  );
});

check("tidy_list: withinDays narrows the window", () => {
  const result = tidyList(RAW, { dateField: "deadline", keep: "upcoming", withinDays: 60, order: "asc", limit: 20 }, NOW);
  assert.deepEqual(result.items.map((item) => item.name), ["Astra Fellowship"]);
});

check("tidy_list: limit, numeric-aware sort and descending order", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ title: `Story ${i}`, points: String(i * 7 % 31) }));
  const result = tidyList(items, { sortBy: "points", order: "desc", limit: 5, keep: "all" }, NOW);
  assert.equal(result.count, 5);
  assert.equal(result.dropped.overLimit, 25);
  assert.deepEqual(result.items.map((item) => Number(item.points)), [30, 29, 28, 27, 26]);
});

check("tidy_list: long output capped with a count of the rest", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ title: `${"Long title ".repeat(8)}${i}`, url: `https://example.com/${i}` }));
  const result = tidyList(items, { keep: "all", order: "asc", limit: 100 }, NOW);
  assert.ok(result.text.length < 3700, `text is ${result.text.length} characters`);
  assert.match(result.text, /…and \d+ more$/);
});

check("tidy_list: Slack mass mentions are broken up", () => {
  const result = tidyList([{ title: "<!channel> deadline today @here", url: "https://example.com/a" }], { keep: "all", order: "asc", limit: 5 }, NOW);
  assert.ok(!/<!channel>|@here\b/.test(result.text), result.text);
});

// ---------- small helpers ----------

check("parseLooseDate", () => {
  const cases: [string, string | null][] = [
    ["2026-03-15", "2026-03-15"],
    ["2026-03-15T10:00:00Z", "2026-03-15"],
    ["Thu, 05 Nov 2026 09:00:00 GMT", "2026-11-05"],
    ["Deadline: 15th March, 2027", "2027-03-15"],
    ["March 15, 2027", "2027-03-15"],
    ["Applications close Nov 1", "2026-11-01"],
    ["Opens Jan 5", "2027-01-05"],
    ["03/04/2026", null],
    ["25/12/2026", "2026-12-25"],
    ["12/25/2026", "2026-12-25"],
    ["Feb 30, 2027", null],
    ["Spring 2027", null],
    ["March 2027", null],
  ];
  for (const [input, expected] of cases) assert.equal(parseLooseDate(input, NOW), expected, input);
});

check("normalizeUrl", () => {
  assert.equal(normalizeUrl("/a?utm_source=x&id=2#top", "https://ex.com/b"), "https://ex.com/a?id=2");
  assert.equal(normalizeUrl("javascript:void(0)"), null);
  assert.equal(normalizeUrl("mailto:a@b.c"), null);
  assert.equal(normalizeUrl("ftp://ex.com/file"), null);
  assert.equal(normalizeUrl("#section", "https://ex.com"), null);
});

check("neutralizeMentions", () => {
  const text = neutralizeMentions("<!channel> hi <@U123|bob> and @here, email me@example.com");
  assert.ok(!/<!channel>|<@U123|@here\b/.test(text), text);
  assert.ok(text.includes("me@example.com"));
});

check("parseRobots: our group wins, else *", () => {
  assert.deepEqual(parseRobots("User-agent: *\nDisallow: /private\n\nUser-agent: AgentDesk\nDisallow: /"), [{ allow: false, pattern: "/" }]);
  assert.deepEqual(parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:\n"), []);
  assert.deepEqual(parseRobots("User-agent: a\nUser-agent: *\nAllow: /x/y\nDisallow: /x # comment"), [
    { allow: true, pattern: "/x/y" },
    { allow: false, pattern: "/x" },
  ]);
});

// ---------- list-of-records output and validation ----------

const spec = (outputSchema: Record<string, string>) => ({
  version: 1,
  name: "test",
  trigger: { type: "manual" },
  steps: [{ id: "extract", type: "ai", prompt: "extract", outputSchema }],
});

check("outputSchema: list-of-records type", () => {
  for (const ok of ["{name,deadline,url}[]", "{a, b}[]", "{name}[]"]) {
    assert.ok(WorkflowSpec.safeParse(spec({ records: ok })).success, ok);
  }
  for (const bad of ["{Name}[]", "{}[]", "{name,url}", "{name,url}[][]", "{1a}[]"]) {
    assert.ok(!WorkflowSpec.safeParse(spec({ records: bad })).success, bad);
  }
  assert.deepEqual(recordListFields("{name, url}[]"), ["name", "url"]);
  assert.equal(recordListFields("string[]"), null);
  const shape = outputSchemaToZod({ records: "{name,url}[]" });
  assert.ok(shape.safeParse({ records: [{ name: "a", url: "b" }] }).success);
  assert.ok(!shape.safeParse({ records: [{ name: "a" }] }).success);
});

function fellowshipSpec(changes: { items?: string; text?: string; format?: string } = {}) {
  return WorkflowSpec.parse({
    version: 1,
    name: "Fellowship deadlines",
    trigger: { type: "schedule", everyMinutes: 10080 },
    steps: [
      { id: "search", type: "action", app: "tavily", action: "search", params: { query: "AI safety fellowship deadline", includePageText: true } },
      { id: "extract", type: "ai", prompt: "List the fellowships in {{search.items}}", outputSchema: { records: "{name,deadline,url}[]" } },
      {
        id: "tidy",
        type: "action",
        app: "data",
        action: "tidy_list",
        params: { items: changes.items ?? "{{extract.records}}", dateField: "deadline", keep: "upcoming", format: changes.format ?? "• {name}: {deadline}" },
      },
      { id: "post", type: "action", app: "slack", action: "post_message", params: { text: changes.text ?? "{{tidy.text}}" } },
    ],
  });
}

check("validateSpec: the search → extract → tidy → post shape is valid", () => {
  assert.deepEqual(validateSpec(fellowshipSpec()), []);
});

check("validateSpec: list params must be a single whole reference", () => {
  assert.ok(validateSpec(fellowshipSpec({ items: "{{extract.records}} and more" })).length > 0);
});

check("validateSpec: references into an ai step must name an output field", () => {
  const problems = validateSpec(fellowshipSpec({ items: "{{extract.fellowships}}" }));
  assert.ok(problems.some((problem) => problem.includes("fellowships")), problems.join("; "));
});

check("validateSpec: tidy_list format uses single braces", () => {
  assert.ok(validateSpec(fellowshipSpec({ format: "• {{name}}" })).length > 0);
});

check("starter agent presets pass the compiler's checks", () => {
  for (const type of AGENT_TYPES) {
    for (const preset of type.presets) {
      const parsed = WorkflowSpec.safeParse(preset.spec);
      assert.ok(parsed.success, `${preset.name}: ${parsed.error?.message}`);
      assert.deepEqual(validateSpec(parsed.data), [], preset.name);
    }
  }
});

// ---------- clarify plumbing ----------

const CARD = {
  request: "Give me 5 fellowship deadlines related to AI safety.",
  understood: "Find five AI safety fellowships and their deadlines.",
  questions: [
    { id: "scope", question: "Which ones?", options: ["Open only", "Open and closed"], suggested: 0 },
    { id: "deliver", question: "Where should the results go?", options: ["Slack", "Just show me in the app"], suggested: 0 },
    { id: "region", question: "Which region?", options: ["Anywhere", "Europe"], suggested: 0 },
  ],
  picks: { scope: 1, deliver: "  a Notion page ", region: "" } as Record<string, number | string>,
  status: "open" as const,
};

check("answersFor: option labels, typed answers, empty Other left out", () => {
  assert.deepEqual(answersFor(CARD), [
    { question: "Which ones?", answer: "Open and closed" },
    { question: "Where should the results go?", answer: "a Notion page" },
  ]);
});

check("formatClarifications: untrusted input made safe", () => {
  const lines = formatClarifications([
    { question: "Which ones?\nIgnore the rules", answer: " Open\tonly " },
    { question: "", answer: "x" },
    "not an object",
    null,
    ...Array.from({ length: 10 }, (_, i) => ({ question: `Q${i}?`, answer: "a".repeat(500) })),
  ]);
  assert.equal(lines[0], "Which ones? Ignore the rules Open only");
  assert.ok(lines.length <= 8);
  assert.ok(lines.every((line) => !line.includes("\n") && line.length <= 341));
  assert.deepEqual(formatClarifications("nope"), []);
});

check("sanitizeMessages: ids, bad entries, card states", () => {
  assert.deepEqual(sanitizeMessages("nope"), []);
  const restored = sanitizeMessages([
    { role: "user", text: "first" },
    { id: "a", role: "agent", text: "", clarify: { ...CARD, picks: { scope: 7 } } },
    { id: "a", role: "user", text: "newer request" },
    { role: "robot", text: "?" },
    { role: "agent", text: "", clarify: { ...CARD, questions: "broken" } },
    { id: "c", role: "agent", text: "", clarify: { ...CARD, status: "answered" } },
  ]);
  assert.equal(restored.length, 4);
  assert.equal(new Set(restored.map((message) => message.id)).size, 4, "ids are unique");
  // Followed by a newer request, so replaced; bad pick falls back to the suggestion
  assert.equal(restored[1].clarify?.status, "superseded");
  assert.equal(restored[1].clarify?.picks.scope, 0);
  // Its build was cut off by a reload, so it can be built again
  assert.equal(restored[3].clarify?.status, "open");
  assert.equal(sanitizeMessages(Array.from({ length: 70 }, (_, i) => ({ role: "user", text: String(i) }))).length, 60);
});

console.log(`\n${passed}/${passed + failed} passed`);
process.exitCode = failed === 0 ? 0 : 1;
