import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function PlugIcon() {
  return (
    <Icon>
      <path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v4" />
    </Icon>
  );
}

export function DevicesIcon() {
  return (
    <Icon>
      <rect x="2.5" y="5" width="13" height="9.5" rx="1.5" />
      <path d="M1 18h17" />
      <rect x="18" y="9" width="5" height="10" rx="1.2" />
    </Icon>
  );
}

export function SignOutIcon() {
  return (
    <Icon>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
    </Icon>
  );
}

export function ChevronIcon() {
  return (
    <Icon width="14" height="14">
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}
