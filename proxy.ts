import { NextResponse, type NextRequest } from "next/server";
import {
  looksLikeSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session-cookie";

// Only checks that a session-shaped cookie exists (no DB call). The real check is
// requireUser() in each page and server action.
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (looksLikeSessionToken(token)) {
    const response = NextResponse.next();
    // sliding expiry
    if (request.method === "GET") {
      response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    }
    return response;
  }

  // Server actions and other fetches get a 401. A redirect would just be followed by fetch.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new NextResponse("Sign in first.", { status: 401 });
  }

  const login = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

// Skips static assets, login/signup, and routes with their own credential:
// approval links (token), webhooks (workflow id) and the scheduler (TICK_SECRET).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|signup|approvals/|api/hooks/|api/tick).*)",
  ],
};
