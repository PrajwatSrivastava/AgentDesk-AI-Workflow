import { eq } from "drizzle-orm";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ConnectionRow, type ConnectionState, type ReturnLink } from "@/components/ConnectionRow";
import { SetupNotice } from "@/components/SetupNotice";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { APPS, appsNeedingConnection } from "@/integrations/registry";
import { findOwnedAgent } from "@/lib/access";
import { decryptSecret, maskSecret } from "@/lib/crypto";
import { requireUser, safeNextPath } from "@/lib/session";

// Live connection state, so no prerendering
export const dynamic = "force-dynamic";

// Integrations take a pasted API key or nothing at all. There is no OAuth flow.
export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string; next?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const focusApp = appsNeedingConnection().find((app) => app.key === params.app);
  let states: ConnectionState[];
  let returnTo: ReturnLink | null;

  try {
    const [rows, back] = await Promise.all([
      db.query.connections.findMany({ where: eq(connections.userId, user.id) }),
      describeReturn(user.id, params.next),
    ]);
    returnTo = back;
    const byApp = new Map(rows.map((row) => [row.app, row]));

    states = appsNeedingConnection().map((app) => {
      const row = byApp.get(app.key);
      return {
        app: app.key,
        label: app.label,
        authHint: app.authHint,
        placeholder: app.placeholder,
        steps: app.setupSteps ?? [],
        masked: row ? safeMask(user.id, row.app, row.secret) : null,
        lastError: row?.lastError ?? null,
        settings: (app.settings ?? []).map((setting) => {
          const saved = row?.settings[setting.key]?.trim();
          return {
            key: setting.key,
            label: setting.label,
            hint: setting.hint,
            placeholder: setting.placeholder,
            display: saved ? (row?.settings[`${setting.key}Title`] ?? saved) : null,
            suggested: setting.suggestAccountEmail ? user.email : undefined,
          };
        }),
      };
    });
  } catch (error) {
    return <SetupNotice message={error instanceof Error ? error.message : String(error)} />;
  }

  const noAuthApps = APPS.filter((app) => app.auth === "none");

  return (
    <>
      <AppHeader title="Connections" />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {returnTo && (
          <div className="bg-accent-soft mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm">
            <span>
              {focusApp
                ? `Set up ${focusApp.label} below, then head back.`
                : "Set up what you need below, then head back."}
            </span>
            <Link href={returnTo.href} className="font-medium underline">
              ← {returnTo.label}
            </Link>
          </div>
        )}

        <p className="text-muted mb-6 text-sm">
          These are yours alone, and every one of your agents uses them — so each
          is set up once, here. Each credential is encrypted with AES-256-GCM,
          bound to your account, before it reaches the database, and is never
          sent back to a browser.
        </p>

        <div className="bg-surface overflow-hidden rounded-xl border border-rule">
          {states.map((state) => (
            <ConnectionRow
              key={state.app}
              connection={state}
              highlight={state.app === focusApp?.key}
              returnTo={returnTo}
            />
          ))}
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-medium">Ready without setup</h2>
          <p className="text-muted mt-1.5 text-xs">
            {new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
              noAuthApps.map((app) => app.label),
            )}{" "}
            need no credentials at all, so a new workflow can fetch real data
            immediately.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-medium">One thing to check first</h2>
          <p className="text-muted mt-1.5 text-xs leading-relaxed">
            Until you verify a domain in Resend, it only delivers to the email you
            signed up to Resend with. Make sure &ldquo;Send emails to&rdquo; under Resend
            above is that address, or Resend will refuse to send.
          </p>
        </section>
      </main>
    </>
  );
}

// Same-site paths only. The agent name is shown only if the agent belongs to this user.
async function describeReturn(
  userId: string,
  next: string | undefined,
): Promise<ReturnLink | null> {
  if (!next) return null;
  const href = safeNextPath(next);
  if (href === "/") return { href, label: "Back to your agents" };
  const agentId = /^\/agents\/([^/?#]+)/.exec(href)?.[1];
  const agent = agentId ? await findOwnedAgent(userId, agentId) : null;
  return { href, label: agent ? `Back to ${agent.name}` : "Back" };
}

// Keys sealed under an old ENCRYPTION_KEY can't be decrypted; don't break the page over it.
function safeMask(userId: string, app: string, ciphertext: string): string {
  try {
    return maskSecret(decryptSecret({ userId, app }, ciphertext));
  } catch {
    return "unreadable — re-paste this credential";
  }
}
