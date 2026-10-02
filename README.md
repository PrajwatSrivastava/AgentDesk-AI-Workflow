# Agent Desk

Describe a job in plain English and get a workflow you can read, test and
schedule. For example:

```
"Every hour, check Hacker News for mentions of Linear and send me anything
 important on Slack. Ask me before posting if it's urgent."
```

becomes a five-step workflow: fetch, filter, summarise, ask for approval, post.
You review it before saving, run it as a test (nothing is sent), then switch it
on.

## How it works

An LLM writes the workflow definition once, as JSON validated against a Zod
schema and the integration registry. After that a plain executor replays the
definition on every run. The model never decides at run time which steps run or
what they are called with; it only writes the text inside `ai` steps.

That also limits prompt injection. Fetched content can change what a summary
says, but it can't add a step or change an action's arguments, because those
were fixed when the workflow was saved.

```
core/
  spec.ts         workflow schema
  executor.ts     runs a spec step by step (start here)
  resolve.ts      {{template}} resolution, own properties only, no eval
  conditions.ts   structured filter conditions
  tick.ts         claims due workflows and runs them
  approvals.ts    pause, notify, decide
  steps/          one handler per step type
integrations/
  define.ts       action contract
  registry.ts     catalog used by both the executor and the compiler prompt
  hackernews, lobsters, devto, bluesky, rss, github, weather, slack, resend, notion
compiler/
  prompt.ts       system prompt, built from the registry
  compile.ts      call, normalise, validate, retry, give up
  validate.ts     checks the JSON schema can't express
  fixtures.ts     17 example requests with expected structure
```

Each action declares its parameters once as a Zod schema. The same schema
validates arguments at run time and describes the action to the compiler, so the
two can't drift. Adding an integration means one new file and one line in
`registry.ts`.

### LLM

Everything runs on Gemini (`lib/llm/gemini.ts`), with `responseJsonSchema` for
constrained output. The compiler uses thinking flash models and `ai` steps use
flash-lite. Each tier tries models from an ordered list: retry on 503/429, skip
on 404, fail on 400. Override the lists with `GEMINI_COMPILER_MODELS` and
`GEMINI_SUMMARY_MODELS`.

Every reply is still validated with Zod and against the registry, with one
repair attempt for mistakes like an unknown action or a reference to a step
that hasn't run yet.

### Scheduling

Vercel Cron on the Hobby plan only runs daily, so scheduling goes through
`POST /api/tick`, which claims due workflows in one statement:

```sql
UPDATE workflows
SET next_run_at = now() + (everyMinutes * interval '1 minute')
WHERE id IN (
  SELECT id FROM workflows WHERE enabled = 1 AND next_run_at <= now()
  ORDER BY next_run_at LIMIT 5 FOR UPDATE SKIP LOCKED
)
RETURNING id
```

Two ticks can't claim the same workflow, and it works over Neon's HTTP driver,
which has no interactive transactions. An open dashboard calls the tick every
five seconds. In production, point an external cron at `/api/tick` with
`TICK_SECRET` so workflows run without a tab open.

## Setup

Requires Node 20.9+ and Postgres (Neon works well).

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run keygen                 # prints an ENCRYPTION_KEY
npm run db:push                # create tables
npm run dev                    # open the app and create an account
```

New accounts get the six starter agents and their workflows.

Upgrading a database from before accounts existed:
`npm run migrate:users -- you@example.com` moves all existing data to an owner
account with that email. Sign up with the same email to claim it.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `GEMINI_API_KEY` | yes | free tier available at aistudio.google.com/apikey |
| `GEMINI_COMPILER_MODELS`, `GEMINI_SUMMARY_MODELS` | no | comma-separated model fallback lists |
| `ENCRYPTION_KEY` | yes | 64 hex chars from `npm run keygen`; rotate with `npm run reencrypt` |
| `RESEND_FROM` | for email | sender address on a domain verified in Resend |
| `APP_URL` | no | base URL for approval links; defaults to `VERCEL_URL`, then localhost |
| `DEMO_MODE` | no | treats schedule units as seconds, for demos |
| `TICK_SECRET` | in production | bearer token for `/api/tick` |

### Scripts

```bash
npm run fixtures                 # compile all fixtures, report pass rate and cost
npm run fixtures -- "top stories"   # just one
npm run typecheck
npm run db:studio

# Run the engine from the command line (dry run unless --live)
npm run verify -- you@example.com "Watch Hacker News" --fresh
npm run verify -- you@example.com "Draft a post" --approve --edit "…"
npm run verify -- you@example.com "Watch Hacker News" --live
npm run build-flow -- you@example.com market-researcher "Every morning, …"

# Per-account changes
npm run set-var -- you@example.com market-researcher watchTerm "Drizzle ORM"
npm run seed -- you@example.com            # add missing starter agents
npm run seed -- you@example.com --prune    # and delete retired ones
npm run run-limit -- you@example.com unlimited   # or: default

# Admin, across all accounts
npm run workflows                  # check stored specs against the registry
npm run workflows -- --delete <id>
npm run agents                     # list agents by owner
npm run agents -- --delete <id>

# Rotate the encryption key (all rows or none)
NEW_ENCRYPTION_KEY=<64 hex> npm run reencrypt

# Call one integration directly, no LLM or database
npm run probe -- hackernews top_stories '{"limit":5}'
```

`--fresh` clears the last-run time so the run fetches a full window.

## Integrations

No OAuth: each integration takes a pasted key or nothing.

| App | Auth | Notes |
|---|---|---|
| Hacker News | none | Algolia search API |
| Lobsters, Dev.to, Bluesky | none | public feeds and search |
| Weather | none | Open-Meteo forecast and geocoding |
| RSS | none | some sites block datacenter IPs. Feed URLs can only reach the public internet (private and metadata addresses are refused, including after redirects) |
| GitHub | token (optional) | raises the 60 requests/hour unauthenticated limit |
| Slack | incoming webhook | the Connections page links to a pre-filled Slack app setup |
| Resend | API key | without a verified domain it only delivers to your own Resend address |
| Notion | personal access token | `Notion-Version: 2026-03-11` |

Everything that belongs to an integration (the key, the Notion page, the email
recipient) is set once on the Connections page and shared by all agents. Each
value is checked against the live service before it's saved. An agent only
asks for its own values, such as a city or a topic. Until a workflow's setup is
complete, Run and the on/off switch are disabled, and the server refuses them
too. Test runs only need the agent's values, since they send nothing.

Reddit isn't included: its free API access is closed to new apps.

## Accounts and security

- Every page and server action loads the signed-in user first, and every id
  from the browser is looked up together with that user (`lib/access.ts`).
  Another user's data looks the same as missing data.
- Runs load only their owner's connections.
- Credentials are encrypted with AES-256-GCM, with the user id and app name as
  authenticated data, so a ciphertext copied to another row won't decrypt.
  Secrets are never sent to the browser; the UI shows a mask.
- Sessions are stored server-side as token hashes, in an HttpOnly, SameSite=Lax
  cookie. Signing out deletes the session; "Sign out of all devices" deletes
  every session for the account. Passwords use scrypt.
- Approvals are recorded with a conditional update, so a double click or two
  devices can't approve twice or resume a run twice.
- Each user gets 25 workflow runs per day (any kind), reset at their local
  midnight, enforced with an atomic upsert in the executor.
- Approval links, webhook triggers and `/api/tick` work without a session
  because each carries its own secret.

## Known limitations

- No password reset or email verification.
- Sign-in attempts are slowed down but not rate limited.
- A Notion personal access token can reach every page its owner can.
- No automatic retries. `last_run_at` moves only on a completed pass
  (succeeded, filtered out, or paused for approval), to the time that run
  started, so a failed run's window is retried.
- Steps are a flat list of up to eight, with no branching.
- All email goes out from `RESEND_FROM`, using each user's own Resend key.
  Unless that address is `onboarding@resend.dev`, other users' keys will be
  refused for the sender domain. A per-user sender setting would fix this.
- Server actions run one at a time per tab, so a long manual run blocks the
  dashboard poll until it finishes.
- `drizzle-kit` bundles an old `esbuild` with a dev-server advisory; it's only
  used from the CLI.

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Its free
API is for non-commercial use.
