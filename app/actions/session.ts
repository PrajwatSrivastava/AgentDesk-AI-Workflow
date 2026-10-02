"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  endAllSessions,
  endSession,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  requireUser,
  safeNextPath,
  startSession,
  verifyAgainstNothing,
  verifyPassword,
} from "@/lib/session";
import { CONNECTIONS_PROMPT_COOKIE, sessionCookieOptions } from "@/lib/session-cookie";
import { installAgents } from "@/lib/starter-agents";

export interface AuthState {
  error?: string;
  /** Echoed back so the form keeps what was typed */
  email?: string;
}

// Slows down password guessing
const FAILURE_DELAY_MS = 1000;

const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

function readTimeZone(value: FormDataEntryValue | null): string {
  const zone = typeof value === "string" ? value : "";
  if (!zone) return "UTC";
  try {
    // Throws on unknown IANA zones; returns the canonical name the database recognises.
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export async function signUp(_previous: AuthState, form: FormData): Promise<AuthState> {
  const parsedEmail = Email.safeParse(form.get("email"));
  const rawEmail = String(form.get("email") ?? "");
  if (!parsedEmail.success) return { error: "Enter a valid email address.", email: rawEmail };

  const email = parsedEmail.data;
  const password = String(form.get("password") ?? "");
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { error: `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`, email };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { error: `Keep your password under ${PASSWORD_MAX_LENGTH} characters.`, email };
  }

  const timeZone = readTimeZone(form.get("timeZone"));
  const passwordHash = await hashPassword(password);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  let userId: string;
  if (existing?.passwordHash) {
    return { error: "An account with this email already exists. Sign in instead.", email };
  } else if (existing) {
    // Passwordless owner account left by the multi-user migration. The isNull
    // guard stops two racing sign-ups from both claiming it.
    const [claimed] = await db
      .update(users)
      .set({ passwordHash, timeZone })
      .where(and(eq(users.id, existing.id), isNull(users.passwordHash)))
      .returning({ id: users.id });
    if (!claimed) return { error: "An account with this email already exists. Sign in instead.", email };
    userId = claimed.id;
  } else {
    try {
      const [created] = await db
        .insert(users)
        .values({ email, passwordHash, timeZone })
        .returning({ id: users.id });
      userId = created.id;
    } catch {
      // unique email index, lost a race with another sign-up
      return { error: "An account with this email already exists. Sign in instead.", email };
    }
    await installAgents(userId);
  }

  await startSession(userId);
  redirect(safeNextPath(String(form.get("next") ?? "/")));
}

export async function signIn(_previous: AuthState, form: FormData): Promise<AuthState> {
  const parsedEmail = Email.safeParse(form.get("email"));
  const password = String(form.get("password") ?? "").slice(0, PASSWORD_MAX_LENGTH + 1);
  const email = parsedEmail.success ? parsedEmail.data : String(form.get("email") ?? "");

  const user = parsedEmail.success
    ? await db.query.users.findFirst({ where: eq(users.email, parsedEmail.data) })
    : undefined;

  // Same work and same error for unknown email or wrong password, so accounts can't be enumerated.
  const valid = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await verifyAgainstNothing(password);

  if (!user || !valid) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return { error: "That email and password don't match an account.", email };
  }

  await startSession(user.id);
  redirect(safeNextPath(String(form.get("next") ?? "/")));
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/login");
}

export async function signOutEverywhere(): Promise<void> {
  const user = await requireUser();
  await endAllSessions(user.id);
  redirect("/login");
}

// Both prompt buttons post here. Going to set up counts as an answer too,
// otherwise the prompt reappears before every app is connected.
export async function answerConnectionsPrompt(form: FormData): Promise<void> {
  await requireUser();
  (await cookies()).set(CONNECTIONS_PROMPT_COOKIE, "answered", sessionCookieOptions);
  const goTo = form.get("goTo");
  if (typeof goTo === "string" && goTo) redirect(safeNextPath(goTo));
  refresh();
}
