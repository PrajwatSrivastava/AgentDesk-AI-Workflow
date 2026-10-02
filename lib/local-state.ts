// Chat and unsaved drafts per agent. Keys include the user id, and sign-out
// clears every key with this prefix.

const PREFIX = "agentdesk:";

export function workspaceKey(userId: string, agentId: string): string {
  return `${PREFIX}${userId}:workspace:${agentId}`;
}

export function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Storage disabled or bad JSON
    return null;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or quota full, not worth an error
  }
}

export function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable
  }
}

export function clearAllLocal(): void {
  try {
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith(PREFIX));
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable
  }
}
