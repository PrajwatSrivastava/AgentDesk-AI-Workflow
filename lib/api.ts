import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConfigError } from "./env";
import { IntegrationError } from "@/integrations/http";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, hint?: string): NextResponse {
  return NextResponse.json({ error: message, hint }, { status });
}

/** Maps known errors to responses that say what to fix. */
export async function handle(
  work: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConfigError) {
      return fail(error.message, 500);
    }
    if (error instanceof IntegrationError) {
      return fail(error.message, 502, error.hint);
    }
    if (error instanceof ZodError) {
      return fail(
        error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; "),
        422,
      );
    }
    // Log only. DB error messages include query text and some routes are public.
    console.error("[api]", error);
    return fail("Something went wrong on our side. Try again in a minute.", 500);
  }
}
