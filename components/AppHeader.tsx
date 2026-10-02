import Link from "next/link";
import { AccountMenu } from "./AccountMenu";
import { AgentAvatar } from "./AgentAvatar";

export function AppHeader({
  title,
  subtitle,
  avatarColor,
}: {
  title?: string;
  subtitle?: string;
  avatarColor?: string;
}) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-6">
        <Link href="/" className="text-muted hover:text-ink shrink-0 text-sm font-medium">
          Agent Desk
        </Link>

        {title && (
          <>
            <span className="text-rule" aria-hidden="true">
              /
            </span>
            <div className="flex min-w-0 items-center gap-2">
              {avatarColor && <AgentAvatar color={avatarColor} size={22} />}
              <span className="truncate text-sm font-medium">{title}</span>
              {subtitle && (
                <span className="text-muted hidden truncate text-xs sm:inline">{subtitle}</span>
              )}
            </div>
          </>
        )}
      </div>
      {/* Renders nothing when signed out (e.g. an approval link). */}
      <AccountMenu />
    </header>
  );
}
