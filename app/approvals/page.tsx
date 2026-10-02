import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { loadPendingApprovals } from "@/lib/account";
import { requireUser } from "@/lib/session";

export default async function ApprovalsPage() {
  const user = await requireUser();
  const { items } = await loadPendingApprovals(user.id, 100);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: user.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <>
      <AppHeader title="Approvals" />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-xl font-semibold">Waiting for you</h1>

        {items.length === 0 ? (
          <p className="text-muted mt-2 text-sm">Nothing is waiting for your approval.</p>
        ) : (
          <ul className="bg-surface mt-5 divide-y divide-rule overflow-hidden rounded-xl border border-rule">
            {items.map((item) => (
              <li key={item.token}>
                <Link
                  href={`/approvals/${item.token}`}
                  className="hover:bg-ink/5 flex items-start gap-3 px-4 py-3.5 transition-colors"
                >
                  <span className="bg-waiting mt-1.5 size-2 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.agentName}
                      <span className="text-muted font-normal"> · {item.workflowName}</span>
                    </span>
                    <span className="text-muted mt-0.5 block text-sm">{item.message}</span>
                  </span>
                  <span className="text-muted shrink-0 text-xs">
                    {when.format(new Date(item.createdAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
