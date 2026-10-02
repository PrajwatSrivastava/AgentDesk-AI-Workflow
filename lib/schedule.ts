import { env } from "./env";

// Demo mode reads the interval as seconds. The stored spec stays in minutes.
export function nextRunFrom(from: Date, everyMinutes: number): Date {
  const intervalMs = env.demoMode ? everyMinutes * 1_000 : everyMinutes * 60_000;
  return new Date(from.getTime() + intervalMs);
}

export function describeSchedule(everyMinutes: number): string {
  if (env.demoMode) {
    return `every ${everyMinutes}s (demo mode)`;
  }
  if (everyMinutes % 1440 === 0) {
    const days = everyMinutes / 1440;
    return days === 1 ? "every day" : `every ${days} days`;
  }
  if (everyMinutes % 60 === 0) {
    const hours = everyMinutes / 60;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }
  return `every ${everyMinutes} minutes`;
}
