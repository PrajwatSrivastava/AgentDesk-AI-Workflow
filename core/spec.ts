import { z } from "zod";

// Only place workflow shape is defined. Compiler writes it, executor walks it, DB stores it as JSONB.

export const STEP_TYPES = ["action", "ai", "filter", "human", "notify"] as const;
export type StepType = (typeof STEP_TYPES)[number];

const stepId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,23}$/, "step id must be lower_snake_case, max 24 chars");

// Structured conditions instead of expression strings, so model output is never eval'd.
const CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "is_empty",
  "not_empty",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const Condition = z.object({
  left: z.string().describe("template reference, e.g. {{fetch.count}}"),
  op: z.enum(CONDITION_OPS),
  right: scalar.optional().describe("omit for is_empty / not_empty"),
});
export type Condition = z.infer<typeof Condition>;

// Flat field->type map. Nested schemas are harder for the model to emit correctly, so the one
// list type is a list of records with string fields only: "{name,deadline,url}[]".
// The pattern stays simple because it is also sent to the model as part of the compiler's schema.
const outputFieldType = z
  .string()
  .regex(
    /^(string|number|boolean|string\[\]|[a-z0-9_]+(\|[a-z0-9_]+)+|\{[a-z][a-z0-9_]*(, ?[a-z][a-z0-9_]*)*\}\[\])$/,
    'must be "string", "number", "boolean", "string[]", a pipe enum like "low|high", or a list of records like "{name,url}[]"',
  );

/** Field names of a list-of-records type such as "{name,url}[]", else null. At most 8 fields. */
export function recordListFields(type: string): string[] | null {
  const match = /^\{(.+)\}\[\]$/.exec(type);
  return match ? match[1].split(",").map((field) => field.trim()).filter(Boolean).slice(0, 8) : null;
}

const OutputSchema = z.record(z.string(), outputFieldType);
export type OutputSchema = z.infer<typeof OutputSchema>;

/** Action params are scalars in every integration we ship. */
const ActionParams = z.record(z.string(), scalar);

const baseStep = { id: stepId };

const ActionStep = z.object({
  ...baseStep,
  type: z.literal("action"),
  app: z.string(),
  action: z.string(),
  params: ActionParams.default({}),
});

const AiStep = z.object({
  ...baseStep,
  type: z.literal("ai"),
  prompt: z.string().min(1),
  outputSchema: OutputSchema,
});

const FilterStep = z.object({
  ...baseStep,
  type: z.literal("filter"),
  condition: Condition,
});

const HumanStep = z.object({
  ...baseStep,
  type: z.literal("human"),
  // Short describe() text: it goes into the constrained-decoding schema on every request.
  // Compiler fixture 1 checks that `when` is set for conditional requests and omitted otherwise.
  // Before `message`, as in the prompt's worked example: decoders that write fields in schema order
  // (Nebius/vLLM) otherwise get past `message`, follow the example on to `shows` and drop `when`.
  when: Condition.optional().describe(
    "condition for pausing; omit to pause on every run",
  ),
  message: z.string().min(1).describe("what the approver is being asked"),
  shows: z.array(z.string()).default([]).describe("template refs to render as context"),
});

const NotifyStep = z.object({
  ...baseStep,
  type: z.literal("notify"),
  app: z.string(),
  action: z.string(),
  params: ActionParams.default({}),
});

export const Step = z.discriminatedUnion("type", [
  ActionStep,
  AiStep,
  FilterStep,
  HumanStep,
  NotifyStep,
]);
export type Step = z.infer<typeof Step>;

const Trigger = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("schedule"),
    everyMinutes: z.number().int().min(1).max(10080),
  }),
  z.object({ type: z.literal("webhook") }),
  z.object({ type: z.literal("manual") }),
]);
export type Trigger = z.infer<typeof Trigger>;

// Converted to JSON Schema, which can't express superRefine, so cross-field checks live in WorkflowSpec.
export const WorkflowSpecShape = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(80),
  trigger: Trigger,
  /** Max 8 to bound cost per run and keep a run readable on one screen. */
  steps: z.array(Step).min(1).max(8),
});

// Already used as template scope names, so a step with one of these ids would be shadowed.
const RESERVED_STEP_IDS = new Set(["trigger", "agent"]);

export const WorkflowSpec = WorkflowSpecShape
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    for (const [i, step] of spec.steps.entries()) {
      if (RESERVED_STEP_IDS.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "id"],
          message: `"${step.id}" is reserved; give the step another id`,
        });
      }
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "id"],
          message: `duplicate step id "${step.id}"`,
        });
      }
      seen.add(step.id);
    }
  });

export type WorkflowSpec = z.infer<typeof WorkflowSpec>;

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "succeeded",
  "skipped",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export function outputSchemaToZod(schema: OutputSchema) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [field, type] of Object.entries(schema)) {
    shape[field] = fieldTypeToZod(type);
  }
  return z.object(shape);
}

function fieldTypeToZod(type: string): z.ZodTypeAny {
  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "string[]":
      return z.array(z.string());
    default: {
      const fields = recordListFields(type);
      if (fields) {
        return z.array(z.object(Object.fromEntries(fields.map((field) => [field, z.string()])))).max(40);
      }
      const options = type.split("|");
      return z.enum(options as [string, ...string[]]);
    }
  }
}
