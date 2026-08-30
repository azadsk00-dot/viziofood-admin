// Scheduled-order handling.
//
// VIZIO FOOD has no scheduled_for column; order-creation paths embed
// "Scheduled pickup: Tue, 25 Aug, 11:15 AM" style sentences into the order
// notes (observed in production — the same convention the kitchen tablet
// app normalises). The orders terminal treats those sentences as THE
// scheduling signal:
//
//   - one authoritative scheduled line per order (the LAST occurrence — the
//     correctly formatted local time follows any auto-generated UTC one)
//   - auto-generated sentences are stripped from customer notes so they never
//     appear twice; genuine customer notes are never touched
//   - orders scheduled beyond the preparation window stay OFF the live board
//     (they live on the SCHEDULED tab as UPCOMING) and move to READY TO
//     PROCESS once inside the window

const SCHEDULED_SENTENCE =
  /scheduled (?:pickup|dine-in|delivery)\s*:\s*(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}(?:,?\s*\d{4})?(?:,?\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi;

/** How far ahead of the scheduled time an order becomes actionable. */
export const PREPARATION_WINDOW_MINUTES = 30;

/** All scheduled sentences found in a text (exact matched substrings). */
export function findScheduledSentences(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(SCHEDULED_SENTENCE)].map((m) => m[0]);
}

/** Remove scheduled sentences and tidy leftover separators. */
export function stripScheduledSentences(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(SCHEDULED_SENTENCE, ' ')
    .replace(/\s*[•|,;]\s*(?=\n|$)/g, '')
    // A separator orphaned where the sentence was removed ("• " at the head).
    .replace(/^[\s•|,;]+/, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** The datetime text of the authoritative (last, deduped) scheduled sentence. */
export function authoritativeScheduledText(sentences: string[]): string | null {
  if (!sentences.length) return null;
  const times = sentences.map((s) =>
    s.replace(/^\s*scheduled (?:pickup|dine-in|delivery)\s*:\s*/i, '').trim(),
  );
  const unique = [...new Set(times)];
  return unique[unique.length - 1] ?? null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse "Tue, 25 Aug, 11:15 AM" / "25 Aug 2027 6:30 PM" / "25 Aug" into an
 * epoch-ms timestamp in the device's local timezone. No year → assume the
 * current year, rolling forward when the date is >6 months in the past
 * (handles December orders parsed in January). Returns null when unparseable.
 */
export function parseScheduledTime(text: string | null | undefined, now: number = Date.now()): number | null {
  if (!text) return null;
  const m = text.match(
    /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})(?:,?\s*(\d{4}))?(?:,?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i,
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!Number.isInteger(day) || day < 1 || day > 31 || month === undefined) return null;

  const year = m[3] ? Number(m[3]) : new Date(now).getFullYear();
  let hours = m[4] ? Number(m[4]) : 0;
  const minutes = m[5] ? Number(m[5]) : 0;
  const meridiem = m[6]?.toUpperCase();
  if (m[4] && meridiem) {
    if (meridiem === 'AM' && hours === 12) hours = 0;
    if (meridiem === 'PM' && hours !== 12) hours += 12;
  }
  if (hours > 23 || minutes > 59) return null;

  const parsed = new Date(year, month, day, hours, minutes, 0, 0).getTime();
  if (Number.isNaN(parsed)) return null;
  if (!m[3] && parsed < now - 183 * 24 * 3600_000) {
    // No year given and the date is far in the past → it means next year.
    return new Date(year + 1, month, day, hours, minutes, 0, 0).getTime();
  }
  return parsed;
}

export type ScheduledCategory = 'upcoming' | 'readyToProcess';

/**
 * Board routing for scheduled orders. A scheduled order inside the
 * preparation window (or past its time) is READY TO PROCESS and appears on
 * the live board; beyond the window it stays UPCOMING on the SCHEDULED tab.
 */
export function scheduledCategory(
  scheduledAt: number | null,
  now: number = Date.now(),
): ScheduledCategory | null {
  if (scheduledAt === null) return null;
  return scheduledAt - now <= PREPARATION_WINDOW_MINUTES * 60_000
    ? 'readyToProcess'
    : 'upcoming';
}

/** True when the order must NOT appear on the live board yet. */
export function isFutureScheduled(order: { scheduledAt: number | null }, now: number = Date.now()): boolean {
  return scheduledCategory(order.scheduledAt, now) === 'upcoming';
}
