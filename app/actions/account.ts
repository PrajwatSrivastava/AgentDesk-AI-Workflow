"use server";

import { loadAccountSummary, type AccountSummary } from "@/lib/account";
import { requireUser } from "@/lib/session";

/** Re-read when the account menu opens or a run starts waiting. */
export async function getAccountSummary(): Promise<AccountSummary> {
  const user = await requireUser();
  return loadAccountSummary(user);
}
