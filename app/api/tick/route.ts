import { tickOnce } from "@/core/tick";
import { fail, handle, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { equalStrings } from "@/lib/session";

// Due runs execute inside the request
export const maxDuration = 300;

// Scheduler endpoint for an external cron (Vercel Hobby cron is daily only), locked by TICK_SECRET.
// The dashboard ticks through a server action so the secret never reaches the client.
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const secret = env.tickSecret;
    if (secret) {
      const provided = request.headers.get("authorization") ?? "";
      if (!equalStrings(provided, `Bearer ${secret}`)) {
        return fail("Not authorised", 401, "Send Authorization: Bearer <TICK_SECRET>.");
      }
    } else if (process.env.NODE_ENV === "production") {
      // Without a secret anyone could trigger every due workflow.
      return fail("TICK_SECRET is not set", 503, "Set it before exposing this route.");
    }

    return ok(await tickOnce());
  });
}

// some cron services can only send GET
export const GET = POST;
