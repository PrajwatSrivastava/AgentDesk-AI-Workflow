// Server only. Read lazily so a missing variable only fails where it's used.

export class ConfigError extends Error {
  constructor(name: string, hint: string) {
    super(`${name} is not set. ${hint}`);
    this.name = "ConfigError";
  }
}

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(name, hint);
  return value;
}

function list(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

export const env = {
  get databaseUrl(): string {
    return required(
      "DATABASE_URL",
      "Create a free Postgres database at neon.tech and copy its connection string into .env.local.",
    );
  },

  get nebiusApiKey(): string {
    return required(
      "NEBIUS_API_KEY",
      "Create a key at tokenfactory.nebius.com (API keys) and add it to .env.local.",
    );
  },

  /** Comma-separated fallback order, overrides the defaults in lib/llm/nebius.ts. */
  get nebiusCompilerModels(): string[] | undefined {
    return list(process.env.NEBIUS_COMPILER_MODELS);
  },

  get nebiusSummaryModels(): string[] | undefined {
    return list(process.env.NEBIUS_SUMMARY_MODELS);
  },

  /** 32 bytes, hex */
  get encryptionKey(): string {
    return required(
      "ENCRYPTION_KEY",
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  },

  /** Must be on a domain verified in Resend, otherwise sends get a 403. */
  get resendFrom(): string {
    return required(
      "RESEND_FROM",
      "Must be an address on a domain you have verified in Resend, e.g. agent@yourdomain.com.",
    );
  },

  /** Schedule intervals count in seconds instead of minutes. */
  get demoMode(): boolean {
    return process.env.DEMO_MODE === "true";
  },

  /** Base for absolute approval links in outbound messages. */
  get appUrl(): string {
    // `||` because .env.example has an empty APP_URL=
    return (
      process.env.APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
    );
  },

  /** Lets an external cron call /api/tick. */
  get tickSecret(): string | undefined {
    return process.env.TICK_SECRET || undefined;
  },
} as const;
