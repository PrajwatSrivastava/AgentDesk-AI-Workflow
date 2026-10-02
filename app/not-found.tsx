import Link from "next/link";

export default function NotFound() {
  return (
    <main className="bg-lavender flex flex-1 items-center justify-center px-6 py-20">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Nothing here</h1>
        <p className="text-muted mt-2 text-sm">
          That agent, run or approval link doesn&apos;t exist. It may have been
          deleted.
        </p>
        <Link
          href="/"
          className="bg-ink hover:bg-ink/90 mt-6 inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium text-paper transition-colors"
        >
          Back to your agents
        </Link>
      </div>
    </main>
  );
}
