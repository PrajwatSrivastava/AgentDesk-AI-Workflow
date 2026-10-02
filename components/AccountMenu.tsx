import { cookies } from "next/headers";
import { loadAccountSummary } from "@/lib/account";
import { dailyLimitFor } from "@/lib/quota";
import { getCurrentUser } from "@/lib/session";
import { THEME_COOKIE, toTheme } from "@/lib/theme";
import { AccountMenuButton } from "./AccountMenuButton";

// Summary is passed as an unawaited promise so the page doesn't block on it.
export async function AccountMenu() {
  const [user, store] = await Promise.all([getCurrentUser(), cookies()]);
  if (!user) return null;
  return (
    <AccountMenuButton
      email={user.email}
      runLimit={dailyLimitFor(user)}
      theme={toTheme(store.get(THEME_COOKIE)?.value)}
      summary={loadAccountSummary(user).catch(() => null)}
    />
  );
}
