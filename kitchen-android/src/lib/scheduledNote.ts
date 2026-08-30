// Scheduled-pickup note handling — receipts must show exactly ONE
// authoritative scheduled-pickup line, and automatically generated
// "Scheduled pickup: …" sentences must NOT surface again as order notes.
//
// Why: order-creation paths have been observed to embed "Scheduled pickup:
// Tue, 25 Aug, 3:15 AM" style sentences into the order notes — sometimes
// formatted in UTC (3:15 AM) next to the correct local rendering
// (11:15 AM, Perth = UTC+8). The string is data, not code: no repository
// source generates it, so the ticket boundary normalises it instead of
// touching stored values.
//
// Rules:
//   - Only strict "Scheduled pickup: <Day, DD Mon(, YYYY,) H:MM( AM/PM)>"
//     sentences are treated as auto-generated — a genuine customer note is
//     never stripped.
//   - The LAST occurrence is authoritative (the correctly formatted local
//     time follows the auto-generated UTC one on real receipts).
//   - Identical duplicates collapse to one line.

import type { TicketItem, TicketOrder } from './starline';

const SCHEDULED_SENTENCE =
  /scheduled (?:pickup|dine-in)\s*:\s*(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}(?:,?\s*\d{4})?(?:,?\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi;

/** All scheduled-pickup sentences found in a text (exact matched substrings). */
export function findScheduledSentences(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(SCHEDULED_SENTENCE)].map((m) => m[0]);
}

/** Remove scheduled-pickup sentences and tidy leftover separators. */
export function stripScheduledSentences(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(SCHEDULED_SENTENCE, ' ')
    .replace(/\s*[•|,;]\s*(?=\n|$)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** The datetime text of the authoritative (last) scheduled sentence. */
export function authoritativeScheduledPickup(sentences: string[]): string | null {
  if (!sentences.length) return null;
  const times = sentences.map((s) => s.replace(/^\s*scheduled (?:pickup|dine-in)\s*:\s*/i, '').trim());
  const unique = [...new Set(times)];
  return unique[unique.length - 1] ?? null;
}

/**
 * Normalise a ticket payload: scheduled-pickup sentences are lifted out of
 * the order/item notes into one `scheduledPickup` field; remaining genuine
 * note text is preserved.
 */
export function extractScheduledPickup(order: TicketOrder, items: TicketItem[]): { order: TicketOrder; items: TicketItem[] } {
  const sentences = [
    ...findScheduledSentences(order.notes),
    ...items.flatMap((item) => findScheduledSentences(item.notes)),
  ];
  if (!sentences.length) return { order, items };
  const scheduledPickup = authoritativeScheduledPickup(sentences);
  const cleanNotes = stripScheduledSentences(order.notes) || null;
  return {
    order: { ...order, scheduledPickup, notes: cleanNotes },
    items: items.map((item) => {
      const clean = stripScheduledSentences(item.notes);
      return clean ? { ...item, notes: clean } : { ...item, notes: null };
    }),
  };
}
