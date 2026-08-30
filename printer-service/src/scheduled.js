// Scheduled-pickup note handling — receipts show exactly ONE authoritative
// scheduled-pickup line; auto-generated "Scheduled pickup: …" sentences
// never surface again as order notes. Port of kitchen-android scheduledNote.ts.

const SCHEDULED_SENTENCE =
  /scheduled pickup\s*:\s*(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}(?:,?\s*\d{4})?(?:,?\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi;

export function findScheduledSentences(text) {
  if (!text) return [];
  return [...String(text).matchAll(SCHEDULED_SENTENCE)].map((m) => m[0]);
}

export function stripScheduledSentences(text) {
  if (!text) return '';
  return String(text)
    .replace(SCHEDULED_SENTENCE, ' ')
    .replace(/\s*[•|,;]\s*(?=\n|$)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** The datetime text of the authoritative (last) scheduled sentence. */
export function authoritativeScheduledPickup(sentences) {
  if (!sentences.length) return null;
  const times = sentences.map((s) => s.replace(/^\s*scheduled pickup\s*:\s*/i, '').trim());
  const unique = [...new Set(times)];
  return unique[unique.length - 1] ?? null;
}

/** Lift scheduled sentences out of order/item notes into one field. */
export function extractScheduledPickup(order, items) {
  const sentences = [
    ...findScheduledSentences(order.notes),
    ...(items ?? []).flatMap((item) => findScheduledSentences(item.notes)),
  ];
  if (!sentences.length) return { order, items: items ?? [] };
  const scheduledPickup = authoritativeScheduledPickup(sentences);
  const notes = stripScheduledSentences(order.notes) || null;
  return {
    order: { ...order, scheduledPickup, notes },
    items: (items ?? []).map((item) => {
      const clean = stripScheduledSentences(item.notes);
      return clean ? { ...item, notes: clean } : { ...item, notes: null };
    }),
  };
}
