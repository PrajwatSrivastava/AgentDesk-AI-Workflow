import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { newToken } from "./crypto";
import {
  CONNECTIONS_PROMPT_COOKIE,
  looksLikeSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "./session-cookie";

export interface CurrentUser {
  id: string;
  email: string;
  timeZone: string;
  runLimitExempt: boolean;
}

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** About 32 MB and 100 ms per hash */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HASH_BYTES = 64;

export const PASSWORD_MIN_LENGTH = 8;
/** Caps the hashing work one request can cause. */
export const PASSWORD_MAX_LENGTH = 200;

/** `scrypt$N$r$p$salt$hash`. Params are stored so the cost can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, HASH_BYTES, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltPart, hashPart] = stored.split("$");
  if (scheme !== "scrypt" || !saltPart || !hashPart) return false;
  const expected = Buffer.from(hashPart, "base64url");
  const actual = await scryptAsync(password, Buffer.from(saltPart, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Unknown emails still pay for a full verify, so timing doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

export async function verifyAgainstNothing(password: string): Promise<false> {
  await verifyPassword(password, await DUMMY_HASH);
  return false;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Server actions only, since it sets a cookie. */
export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);
  store.delete(CONNECTIONS_PROMPT_COOKIE);
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (looksLikeSessionToken(token)) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
  store.delete(CONNECTIONS_PROMPT_COOKIE);
}

/** Other devices keep their cookies, but those no longer match a session. */
export async function endAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(CONNECTIONS_PROMPT_COOKIE);
}

/** Memoised per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!looksLikeSessionToken(token)) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      timeZone: users.timeZone,
      runLimitExempt: users.runLimitExempt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
});

// proxy.ts only checks that a cookie exists. The session itself is validated here.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Same-site paths only, otherwise login becomes an open redirect. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return "/";
  // Parse like a browser would, so "/\t/evil.com" (read as "//evil.com") is caught.
  const base = "http://agent-desk.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return "/";
  }
  if (url.origin !== base) return "/";
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith("/login") || path.startsWith("/signup") ? "/" : path;
}

export function equalStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
