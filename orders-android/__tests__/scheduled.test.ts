// Scheduled-order parsing — the production "Scheduled pickup: …" convention.

import { describe, expect, it } from 'vitest';
import {
  PREPARATION_WINDOW_MINUTES,
  authoritativeScheduledText,
  findScheduledSentences,
  isFutureScheduled,
  parseScheduledTime,
  scheduledCategory,
  stripScheduledSentences,
} from '../src/orders/scheduled';

describe('findScheduledSentences', () => {
  it('finds pickup, dine-in and delivery sentences', () => {
    const text = 'Scheduled pickup: Tue, 25 Aug, 11:15 AM • extra napkins';
    expect(findScheduledSentences(text)).toEqual(['Scheduled pickup: Tue, 25 Aug, 11:15 AM']);
    expect(findScheduledSentences('Scheduled dine-in: 25 Aug 6:30 PM')).toHaveLength(1);
    expect(findScheduledSentences('Scheduled delivery: 25 Aug 2027 6:30 PM')).toHaveLength(1);
  });

  it('ignores genuine customer notes that merely mention the word scheduled', () => {
    expect(findScheduledSentences('Can I be scheduled for the evening shift meal?')).toHaveLength(0);
    expect(findScheduledSentences('Not scheduled pickup: soon please')).toHaveLength(0);
  });

  it('handles no time / no year forms', () => {
    expect(findScheduledSentences('Scheduled pickup: 25 Aug')).toHaveLength(1);
    expect(findScheduledSentences('Scheduled pickup: Wed, 30 Sep, 2027')).toHaveLength(1);
  });
});

describe('stripScheduledSentences', () => {
  it('removes the sentences but keeps genuine notes', () => {
    const text = 'Scheduled pickup: Tue, 25 Aug, 3:15 AM • Please cut in half';
    const stripped = stripScheduledSentences(text);
    expect(stripped).toBe('Please cut in half');
    expect(findScheduledSentences(stripped)).toHaveLength(0);
  });

  it('returns empty for notes that were only a scheduled sentence', () => {
    expect(stripScheduledSentences('Scheduled pickup: 25 Aug, 6:30 PM')).toBe('');
  });
});

describe('authoritativeScheduledText', () => {
  it('uses the LAST occurrence (local rendering follows the UTC one)', () => {
    const sentences = [
      'Scheduled pickup: Tue, 25 Aug, 3:15 AM',
      'Scheduled pickup: Tue, 25 Aug, 11:15 AM',
    ];
    expect(authoritativeScheduledText(sentences)).toBe('Tue, 25 Aug, 11:15 AM');
  });

  it('collapses duplicates', () => {
    expect(
      authoritativeScheduledText(['Scheduled pickup: 25 Aug, 6:00 PM', 'Scheduled pickup: 25 Aug, 6:00 PM']),
    ).toBe('25 Aug, 6:00 PM');
  });
});

describe('parseScheduledTime', () => {
  const noon = new Date(2026, 7, 25, 12, 0, 0).getTime(); // 25 Aug 2026, local

  it('parses day + month + 12h time', () => {
    const t = parseScheduledTime('Tue, 25 Aug, 11:15 AM', noon);
    expect(t).not.toBeNull();
    const d = new Date(t!);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 7, 25, 11, 15,
    ]);
  });

  it('parses PM times', () => {
    const t = parseScheduledTime('25 Aug, 6:30 PM', noon)!;
    expect(new Date(t).getHours()).toBe(18);
  });

  it('parses 12 AM as midnight and 12 PM as noon', () => {
    expect(new Date(parseScheduledTime('25 Aug, 12:05 AM', noon)!).getHours()).toBe(0);
    expect(new Date(parseScheduledTime('25 Aug, 12:05 PM', noon)!).getHours()).toBe(12);
  });

  it('parses explicit years', () => {
    const t = parseScheduledTime('25 Aug 2027, 1:00 PM', noon)!;
    expect(new Date(t).getFullYear()).toBe(2027);
  });

  it('rolls a year-less date forward when far in the past (Dec → Jan)', () => {
    const january = new Date(2027, 0, 15, 9, 0, 0).getTime();
    const t = parseScheduledTime('20 Dec, 6:00 PM', january)!;
    expect(new Date(t).getFullYear()).toBe(2027);
    expect(new Date(t).getMonth()).toBe(11);
  });

  it('returns null for garbage', () => {
    expect(parseScheduledTime('whenever')).toBeNull();
    expect(parseScheduledTime('99 XXX')).toBeNull();
    expect(parseScheduledTime(null)).toBeNull();
  });
});

describe('scheduledCategory', () => {
  const now = Date.now();

  it('upcoming beyond the preparation window', () => {
    expect(scheduledCategory(now + 3 * 3600_000, now)).toBe('upcoming');
  });

  it('readyToProcess inside the window and past due', () => {
    expect(scheduledCategory(now + (PREPARATION_WINDOW_MINUTES - 5) * 60_000, now)).toBe(
      'readyToProcess',
    );
    expect(scheduledCategory(now - 60_000, now)).toBe('readyToProcess');
  });

  it('null when there is no scheduled time', () => {
    expect(scheduledCategory(null, now)).toBeNull();
  });

  it('isFutureScheduled matches the category', () => {
    expect(isFutureScheduled({ scheduledAt: now + 3600_000 }, now)).toBe(true);
    expect(isFutureScheduled({ scheduledAt: now + 60_000 }, now)).toBe(false);
    expect(isFutureScheduled({ scheduledAt: null }, now)).toBe(false);
  });
});
