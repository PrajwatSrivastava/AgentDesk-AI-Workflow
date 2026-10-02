// Tells the account menu to refresh its badge (e.g. a run started or stopped waiting).
export const ACTIVITY_EVENT = "agentdesk:activity";

export function announceActivity(): void {
  window.dispatchEvent(new Event(ACTIVITY_EVENT));
}
