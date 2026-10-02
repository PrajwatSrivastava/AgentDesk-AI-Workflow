import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { Agent, fetch as undiciFetch } from "undici";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Each query is an HTTPS call to Neon. Node's fetch drops idle sockets after ~4s and a reconnect
// measured 0.9-1.9s (vs 0.3s warm), which the 5s dashboard poll would hit almost every time.
const keepAlive = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 10 * 60_000,
});
neonConfig.fetchFunction = (input: string, init?: RequestInit) =>
  undiciFetch(input, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: keepAlive });

type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | undefined;

function connect(): Database {
  instance ??= drizzle(neon(env.databaseUrl), { schema });
  return instance;
}

// Lazy, because `next build` evaluates modules and would fail on a missing DATABASE_URL.
export const db = new Proxy({} as Database, {
  get: (_target, property, receiver) => Reflect.get(connect(), property, receiver),
});
