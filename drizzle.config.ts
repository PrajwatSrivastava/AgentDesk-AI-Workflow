import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit only reads .env on its own; settings live in .env.local
config({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // CLI only, so plain process.env is fine (lib/env.ts is for the app)
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
