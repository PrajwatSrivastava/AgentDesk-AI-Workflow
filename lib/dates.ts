const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";

const PATTERNS: { re: RegExp; parts: (m: RegExpExecArray) => [number | null, number, number] }[] = [
  // 2026-03-15, 2026/03/15, 2026-03-15T10:00:00Z
  { re: /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/, parts: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // 15 March 2026, 15th Mar, 2026
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH},?\\s+(\\d{4})\\b`, "i"), parts: (m) => [Number(m[3]), MONTHS[m[2].toLowerCase().replace(".", "")], Number(m[1])] },
  // March 15, 2026 / Mar 15th 2026
  { re: new RegExp(`\\b${MONTH}\\s+${DAY},?\\s+(\\d{4})\\b`, "i"), parts: (m) => [Number(m[3]), MONTHS[m[1].toLowerCase().replace(".", "")], Number(m[2])] },
  // 15 March (no year)
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}\\b`, "i"), parts: (m) => [null, MONTHS[m[2].toLowerCase().replace(".", "")], Number(m[1])] },
  // March 15 (no year)
  { re: new RegExp(`\\b${MONTH}\\s+${DAY}\\b`, "i"), parts: (m) => [null, MONTHS[m[1].toLowerCase().replace(".", "")], Number(m[2])] },
];

// 03/04/2026 is ambiguous, so numeric day/month dates are only used when one part is over 12.
const NUMERIC = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;

function valid(year: number, month: number, day: number): boolean {
  if (!month || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Today's date as YYYY-MM-DD in UTC. */
export function todayIso(now: Date = new Date()): string {
  return iso(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

/**
 * First date found in free text, as YYYY-MM-DD, or null. A date without a year is its next
 * occurrence after `now`.
 */
export function parseLooseDate(text: string | null | undefined, now: Date = new Date()): string | null {
  if (!text) return null;
  for (const { re, parts } of PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    const [year, month, day] = parts(match);
    if (year !== null) {
      if (valid(year, month, day)) return iso(year, month, day);
      continue;
    }
    // No year: this year unless that date has already passed
    let guess = now.getUTCFullYear();
    if (!valid(guess, month, day)) continue;
    if (iso(guess, month, day) < todayIso(now)) guess += 1;
    if (valid(guess, month, day)) return iso(guess, month, day);
  }

  const numeric = NUMERIC.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (a > 12 && valid(year, b, a)) return iso(year, b, a);
    if (b > 12 && valid(year, a, b)) return iso(year, a, b);
  }
  return null;
}
