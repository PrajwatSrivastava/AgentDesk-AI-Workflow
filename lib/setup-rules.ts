// No DB imports, so the browser can apply the same blocking rules as the server.

export type SetupItem =
  | {
      kind: "connection";
      app: string;
      label: string;
      /** false when there's no credential yet */
      connected: boolean;
      /** Labels of settings still to fill in */
      missing: string[];
      /** Recommended only, the step runs without it */
      optional: boolean;
    }
  | {
      kind: "value";
      key: string;
      label: string;
      hint?: string;
      placeholder?: string;
    };

export type SetupResult = { ok: true; detail: string } | { ok: false; error: string };

export function isOptional(item: SetupItem): boolean {
  return item.kind === "connection" && item.optional;
}

// Test runs suppress sends, so only missing values block them (reads need values too).
export function blockingItems(items: SetupItem[], dryRun: boolean): SetupItem[] {
  const required = items.filter((item) => !isOptional(item));
  return dryRun ? required.filter((item) => item.kind === "value") : required;
}
