/** Shown when the database can't be reached, usually on a fresh clone. */
export function SetupNotice({ message }: { message: string }) {
  return (
    <main className="bg-lavender flex flex-1 items-center justify-center px-6 py-20">
      <div className="bg-surface w-full max-w-xl rounded-2xl border border-rule p-8">
        <h1 className="text-xl font-semibold">Finish setting up</h1>
        <p className="text-muted mt-2 text-sm">
          The database isn&apos;t reachable yet. Three steps and you&apos;re running.
        </p>

        <ol className="mt-6 space-y-5 text-sm">
          <li>
            <p className="font-medium">1. Create a database</p>
            <p className="text-muted mt-1">
              Make a free Postgres project at neon.tech and copy its connection
              string into <code className="font-mono text-xs">.env.local</code> as{" "}
              <code className="font-mono text-xs">DATABASE_URL</code>.
            </p>
          </li>
          <li>
            <p className="font-medium">2. Add the remaining keys</p>
            <pre className="bg-paper text-muted mt-2 overflow-x-auto rounded-lg border border-rule p-3 font-mono text-xs">
              {`GEMINI_API_KEY=...
ENCRYPTION_KEY=<64 hex chars>`}
            </pre>
            <p className="text-muted mt-2">
              Generate the encryption key with{" "}
              <code className="font-mono text-xs">npm run keygen</code>. Every other
              option is described in <code className="font-mono text-xs">.env.example</code>.
            </p>
          </li>
          <li>
            <p className="font-medium">3. Create the tables, then sign up</p>
            <pre className="bg-paper text-muted mt-2 overflow-x-auto rounded-lg border border-rule p-3 font-mono text-xs">
              npm run db:push
            </pre>
            <p className="text-muted mt-2">
              Restart the app and create an account. It comes with the starter agents.
            </p>
          </li>
        </ol>

        <details className="mt-6">
          <summary className="text-muted cursor-pointer text-xs hover:text-ink">
            What the server reported
          </summary>
          <p className="text-muted mt-2 font-mono text-xs break-words">{message}</p>
        </details>
      </div>
    </main>
  );
}
