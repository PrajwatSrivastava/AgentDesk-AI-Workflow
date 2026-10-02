import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RunStatus, StepType, WorkflowSpec } from "@/core/spec";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stored lowercased */
    email: text("email").notNull(),
    /** scrypt hash. Null for the pre-accounts owner row until someone signs up with its email. */
    passwordHash: text("password_hash"),
    /** IANA zone from the browser; the daily run limit resets at local midnight */
    timeZone: text("time_zone").notNull().default("UTC"),
    /** Skips the daily run limit. Set with `npm run run-limit`. */
    runLimitExempt: boolean("run_limit_exempt").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

// Stored server-side so sessions can be revoked. Only the token hash is kept.
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

/** One row per user per local day */
export const dailyRunUsage = pgTable(
  "daily_run_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    runs: integer("runs").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Workflows, runs and approvals are owned through this */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Key from lib/agent-types.ts */
    type: text("type").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    persona: text("persona").notNull(),
    avatarSeed: text("avatar_seed").notNull(),
    /** Referenced in specs as {{agent.*}}, e.g. watchTerm */
    vars: jsonb("vars").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agents_user_idx").on(table.userId)],
);

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    spec: jsonb("spec").$type<WorkflowSpec>().notNull(),
    enabled: integer("enabled").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // tick query: enabled = 1 and next_run_at <= now()
    index("workflows_due_idx").on(table.enabled, table.nextRunAt),
    index("workflows_agent_idx").on(table.agentId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull(),
    trigger: jsonb("trigger").notNull(),
    dryRun: integer("dry_run").notNull().default(0),
    errorMessage: text("error_message"),
    /** Why a filter stopped the run (status `skipped`) */
    haltReason: text("halt_reason"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** Micro-dollars; cents would round most runs to zero */
    costMicros: integer("cost_micros").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("runs_workflow_idx").on(table.workflowId, table.startedAt),
    index("runs_status_idx").on(table.status),
  ],
);

export const stepRuns = pgTable(
  "step_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    type: text("type").$type<StepType>().notNull(),
    status: text("status").$type<"succeeded" | "failed" | "halted" | "waiting" | "skipped">().notNull(),
    position: integer("position").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    /** Exact prompt sent (AI steps only) */
    promptText: text("prompt_text"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costMicros: integer("cost_micros"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("step_runs_run_idx").on(table.runId, table.position),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    token: text("token").notNull(),
    status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
    message: text("message").notNull(),
    context: jsonb("context").$type<string[]>().notNull().default([]),
    /** Approver's edit; replaces the paused step's output */
    editedOutput: jsonb("edited_output"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("approvals_token_idx").on(table.token),
    index("approvals_run_idx").on(table.runId),
  ],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The secret's encryption is bound to this user */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    label: text("label").notNull(),
    /** AES-256-GCM ciphertext. Never logged or sent to the client. */
    secret: text("secret").notNull(),
    /** Non-secret settings by key, e.g. Notion page id, recipient email */
    settings: jsonb("settings").$type<Record<string, string>>().notNull().default({}),
    /** Set when an action last failed auth */
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("connections_user_app_idx").on(table.userId, table.app)],
);

export const userRelations = relations(users, ({ many }) => ({
  agents: many(agents),
  connections: many(connections),
}));

export const agentRelations = relations(agents, ({ one, many }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  workflows: many(workflows),
}));

export const connectionRelations = relations(connections, ({ one }) => ({
  user: one(users, { fields: [connections.userId], references: [users.id] }),
}));

export const workflowRelations = relations(workflows, ({ one, many }) => ({
  agent: one(agents, { fields: [workflows.agentId], references: [agents.id] }),
  runs: many(runs),
}));

export const runRelations = relations(runs, ({ one, many }) => ({
  workflow: one(workflows, { fields: [runs.workflowId], references: [workflows.id] }),
  steps: many(stepRuns),
  approvals: many(approvals),
}));

export const stepRunRelations = relations(stepRuns, ({ one }) => ({
  run: one(runs, { fields: [stepRuns.runId], references: [runs.id] }),
}));

export const approvalRelations = relations(approvals, ({ one }) => ({
  run: one(runs, { fields: [approvals.runId], references: [runs.id] }),
}));

export type User = typeof users.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type StepRun = typeof stepRuns.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Connection = typeof connections.$inferSelect;
