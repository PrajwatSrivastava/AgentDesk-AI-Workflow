// Also imported by proxy.ts, so keep DB and Node-only imports out of here.

export const SESSION_COOKIE = "agent_desk_session";

// 400 days is the browser maximum. The proxy refreshes the cookie on each visit.
const SESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export const sessionCookieOptions = {
  httpOnly: true,
  // localhost counts as secure, so a local `npm start` still works
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
};

// "Connect your apps" prompt answered. Cleared on sign-in and sign-out. UI state only.
export const CONNECTIONS_PROMPT_COOKIE = "agent_desk_connections_prompt";

/** 32 random bytes, base64url */
export function looksLikeSessionToken(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
