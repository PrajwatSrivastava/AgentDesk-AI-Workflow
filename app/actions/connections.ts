"use server";

import { and, eq } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { describeError } from "@/integrations/http";
import { checkPage } from "@/integrations/notion";
import { findApp } from "@/integrations/registry";
import { encryptSecret } from "@/lib/crypto";
import { requireUser } from "@/lib/session";
import { connectionSecret, type SetupResult } from "@/lib/setup";

// Checked against the live service before saving. Secrets are AES-256-GCM encrypted,
// bound to user and app, and never sent back to the client.
export async function saveConnection(app: string, secret: string): Promise<SetupResult> {
  const user = await requireUser();
  const definition = findApp(app);
  if (!definition || definition.auth !== "token") {
    return { ok: false, error: `${definition?.label ?? app} needs no credential` };
  }

  const trimmed = secret.trim();
  if (!trimmed) return { ok: false, error: "Paste a credential first" };

  let detail = "Saved.";
  if (definition.verify) {
    try {
      detail = await definition.verify(trimmed);
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }

  const sealed = encryptSecret({ userId: user.id, app }, trimmed);

  // Upsert keyed on (user, app), so it can only ever touch the caller's own row
  await db
    .insert(connections)
    .values({ userId: user.id, app, label: definition.label, secret: sealed })
    .onConflictDoUpdate({
      target: [connections.userId, connections.app],
      set: { secret: sealed, label: definition.label, lastError: null, lastErrorAt: null },
    });

  // Used by both the Connections page and the agent setup checklist
  refresh();
  return { ok: true, detail };
}

/** Per-user connection detail (Notion page, email address), shared by all of the user's agents. */
export async function saveConnectionSetting(
  app: string,
  key: string,
  value: string,
): Promise<SetupResult> {
  const user = await requireUser();
  const setting = findApp(app)?.settings?.find((candidate) => candidate.key === key);
  if (!setting) return { ok: false, error: "That is not a setting of this app" };

  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Enter a value first" };
  if (trimmed.length > 500) return { ok: false, error: "That is too long" };

  const row = await db.query.connections.findFirst({
    where: and(eq(connections.userId, user.id), eq(connections.app, app)),
  });
  if (!row) return { ok: false, error: "Connect the app first, then set this." };

  let stored = trimmed;
  let detail = "Saved.";
  // Display name for values like a page id
  let title: string | undefined;
  try {
    if (setting.check === "email") {
      const email = z.email().safeParse(trimmed.toLowerCase());
      if (!email.success) return { ok: false, error: "That doesn't look like an email address." };
      stored = email.data;
      detail = `Emails will go to ${stored}.`;
    } else if (setting.check === "notionPage") {
      const token = await connectionSecret(user.id, app);
      if (!token) return { ok: false, error: "Re-paste your Notion token above, then try again." };
      const page = await checkPage(trimmed, token);
      // Store the id; the slug in a Notion URL changes when the page is renamed.
      stored = page.id;
      title = page.title;
      detail = `Found the page "${page.title}".`;
    }
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }

  const settings = { ...row.settings, [key]: stored };
  if (title) settings[`${key}Title`] = title;
  else delete settings[`${key}Title`];

  // A new value is often the fix for the last error, so clear it. The next run re-raises it if not.
  await db
    .update(connections)
    .set({ settings, lastError: null, lastErrorAt: null })
    .where(and(eq(connections.id, row.id), eq(connections.userId, user.id)));

  refresh();
  return { ok: true, detail };
}

export async function deleteConnection(app: string): Promise<void> {
  const user = await requireUser();
  await db
    .delete(connections)
    .where(and(eq(connections.userId, user.id), eq(connections.app, app)));
  revalidatePath("/connections");
}
