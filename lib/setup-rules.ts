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
      /** A read can't run without it (web search), as opposed to a send */
      neededForReads?: boolean;
      /** Why the service refused the saved credential on the last run, until it is saved again */
      rejected?: string;
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

// The same for every kind of run. A test run sends nothing, but it should still prove the
// skill is set up, or a skill that passes its test can fail the first real run.
export function blockingItems(items: SetupItem[]): SetupItem[] {
  return items.filter((item) => !isOptional(item));
}
