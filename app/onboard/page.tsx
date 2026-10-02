import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { TypePicker, type TypeOption } from "@/components/onboard/TypePicker";
import { AGENT_TYPES } from "@/lib/agent-types";
import { requireUser } from "@/lib/session";

// Keeps preset specs on the server
const OPTIONS: TypeOption[] = AGENT_TYPES.map((type) => ({
  key: type.key,
  name: type.name,
  description: type.description,
  avatarColor: type.avatarColor,
  presetCount: type.presets.length,
}));

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireUser();
  const { type } = await searchParams;

  return (
    <main className="bg-lavender flex-1">
      <AccountMenu />
      <div className="mx-auto max-w-4xl px-6 py-16">
        <Link href="/" className="text-muted text-sm hover:text-ink">
          ← All agents
        </Link>

        <h1 className="mt-8 mb-8 text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
          <span className="text-muted">1.</span> Describe the agent you want to create
        </h1>

        <TypePicker options={OPTIONS} initialSelected={type} />

        <p className="text-muted mt-6 text-sm">
          You&apos;ll give it its first skill next.
        </p>
      </div>
    </main>
  );
}
