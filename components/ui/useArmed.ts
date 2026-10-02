"use client";

import { useEffect, useState } from "react";

/** Two-click confirm. Disarms after `ms` so a much later click doesn't confirm. */
export function useArmed(ms = 4000): { armed: boolean; arm: () => void } {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(timer);
  }, [armed, ms]);

  return { armed, arm: () => setArmed(true) };
}
