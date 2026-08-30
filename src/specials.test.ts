import { describe, expect, it } from 'vitest';
import {
  describeSchedule,
  discountPercent,
  isSpecialLive,
  localDateKey,
  parseClock,
  resolveActiveSpecial,
} from './lib/specials';
import type { Special } from './types';

const special = (overrides: Partial<Special> = {}): Special => ({
  id: 's1',
  title: 'Chicken Alfredo Special',
  description: 'Creamy, garlicky, generous.',
  imageUrl: null,
  price: 16,
  originalPrice: 20,
  discountPercent: 20,
  active: true,
  archived: false,
  startDate: null,
  endDate: null,
  startTime: null,
  endTime: null,
  daysOfWeek: [],
  ctaText: 'Order now',
  ctaLink: '/menu',
  category: 'Pasta',
  dietary: [],
  ingredients: [],
  allergens: [],
  badge: 'Special',
  priority: 100,
  displayLocation: 'both',
  productId: null,
  stockQuantity: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const monday = new Date('2026-08-24T12:00:00'); // a Monday
const tuesday = new Date('2026-08-25T12:00:00');

describe('clock parsing', () => {
  it('parses HH:MM', () => {
    expect(parseClock('11:30')).toBe(690);
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(1439);
  });
  it('rejects invalid times and nulls', () => {
    expect(parseClock(null)).toBeNull();
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('ab:cd')).toBeNull();
  });
});

describe('special scheduling', () => {
  it('is live when active and unscheduled', () => {
    expect(isSpecialLive(special(), monday)).toBe(true);
  });

  it('respects day-of-week (the Monday/Tuesday/Wednesday rotation)', () => {
    const mondayOnly = special({ daysOfWeek: [1] });
    expect(isSpecialLive(mondayOnly, monday)).toBe(true);
    expect(isSpecialLive(mondayOnly, tuesday)).toBe(false);
  });

  it('empty daysOfWeek means every day', () => {
    expect(isSpecialLive(special({ daysOfWeek: [] }), tuesday)).toBe(true);
  });

  it('respects the date window (endDate inclusive through the final day)', () => {
    const windowed = special({ startDate: '2026-08-24', endDate: '2026-08-26' });
    expect(isSpecialLive(windowed, new Date('2026-08-24T23:59'))).toBe(true);
    expect(isSpecialLive(windowed, new Date('2026-08-26T23:59'))).toBe(true);
    expect(isSpecialLive(windowed, new Date('2026-08-27T00:01'))).toBe(false);
    expect(isSpecialLive(windowed, new Date('2026-08-23T12:00'))).toBe(false);
  });

  it('respects the time window', () => {
    const lunch = special({ startTime: '11:00', endTime: '15:00' });
    expect(isSpecialLive(lunch, new Date('2026-08-24T11:00'))).toBe(true);
    expect(isSpecialLive(lunch, new Date('2026-08-24T14:59'))).toBe(true);
    expect(isSpecialLive(lunch, new Date('2026-08-24T15:01'))).toBe(false);
    expect(isSpecialLive(lunch, new Date('2026-08-24T10:59'))).toBe(false);
  });

  it('inactive, archived, and sold-out specials are never live', () => {
    expect(isSpecialLive(special({ active: false }), monday)).toBe(false);
    expect(isSpecialLive(special({ archived: true }), monday)).toBe(false);
    expect(isSpecialLive(special({ stockQuantity: 0 }), monday)).toBe(false);
    expect(isSpecialLive(special({ stockQuantity: 5 }), monday)).toBe(true);
  });
});

describe('resolution', () => {
  it('picks the highest priority live special', () => {
    const low = special({ id: 'low', priority: 200, title: 'Low' });
    const high = special({ id: 'high', priority: 10, title: 'High' });
    expect(resolveActiveSpecial([low, high], monday)?.id).toBe('high');
  });

  it('breaks priority ties by earliest createdAt (deterministic across clients)', () => {
    const a = special({ id: 'a', priority: 100, createdAt: '2026-08-01T00:00:00.000Z' });
    const b = special({ id: 'b', priority: 100, createdAt: '2026-08-02T00:00:00.000Z' });
    expect(resolveActiveSpecial([b, a], monday)?.id).toBe('a');
  });

  it('returns null when nothing is live', () => {
    expect(resolveActiveSpecial([special({ active: false })], monday)).toBeNull();
    expect(resolveActiveSpecial([], monday)).toBeNull();
  });

  it('weekday rotation example: Monday chicken, Tuesday prawns', () => {
    const chicken = special({ id: 'mon', title: 'Chicken Alfredo Special', daysOfWeek: [1] });
    const prawns = special({ id: 'tue', title: 'Prawn Pasta Special', daysOfWeek: [2] });
    expect(resolveActiveSpecial([chicken, prawns], monday)?.id).toBe('mon');
    expect(resolveActiveSpecial([chicken, prawns], tuesday)?.id).toBe('tue');
  });
});

describe('boundary conditions (exact times)', () => {
  // A lunch special: 11:00–15:00 local time.
  const lunch = () => special({ startTime: '11:00', endTime: '15:00' });

  it('is NOT live before the start time', () => {
    expect(isSpecialLive(lunch(), new Date(2026, 7, 24, 10, 59))).toBe(false);
  });

  it('is live EXACTLY at the start time (inclusive)', () => {
    expect(isSpecialLive(lunch(), new Date(2026, 7, 24, 11, 0))).toBe(true);
  });

  it('is live during the window', () => {
    expect(isSpecialLive(lunch(), new Date(2026, 7, 24, 12, 30))).toBe(true);
  });

  it('is live EXACTLY at the end time (inclusive)', () => {
    expect(isSpecialLive(lunch(), new Date(2026, 7, 24, 15, 0))).toBe(true);
  });

  it('is NOT live one minute after the end time', () => {
    expect(isSpecialLive(lunch(), new Date(2026, 7, 24, 15, 1))).toBe(false);
  });

  it('an inactive special loses even inside its window', () => {
    expect(isSpecialLive(special({ startTime: '11:00', endTime: '15:00', active: false }), new Date(2026, 7, 24, 12, 0))).toBe(false);
  });

  it('multiple competing specials: highest priority wins, ties by age', () => {
    const now = new Date(2026, 7, 24, 12, 0);
    const low = special({ id: 'low', priority: 200, title: 'Low' });
    const high = special({ id: 'high', priority: 10, title: 'High' });
    const tiedOlder = special({ id: 'older', priority: 10, createdAt: '2026-07-01T00:00:00.000Z' });
    expect(resolveActiveSpecial([low, high], now)?.id).toBe('high');
    expect(resolveActiveSpecial([high, tiedOlder], now)?.id).toBe('older');
  });
});

describe('timezone handling (Perth)', () => {
  it('uses the browser/agent LOCAL clock, so a Perth kitchen sees Perth time', () => {
    // The scheduler reads Date.getHours()/getDay() — local time. A special
    // scheduled 11:00–15:00 is live during Perth lunch on a Perth machine
    // regardless of the server/JWT timezone.
    const lunch = special({ startTime: '11:00', endTime: '15:00' });
    const perthLunch = new Date(2026, 7, 24, 12, 0); // constructed in local tz
    expect(isSpecialLive(lunch, perthLunch)).toBe(true);
  });

  it('day-of-week matches the LOCAL calendar day', () => {
    // 2026-08-24 is a Monday everywhere; the check uses local getDay().
    const mondayOnly = special({ daysOfWeek: [1] });
    expect(isSpecialLive(mondayOnly, new Date(2026, 7, 24, 12, 0))).toBe(true);
    expect(isSpecialLive(mondayOnly, new Date(2026, 7, 25, 12, 0))).toBe(false);
  });

  it('endDate runs through the whole final local day (inclusive)', () => {
    const endsWednesday = special({ endDate: '2026-08-26' });
    expect(isSpecialLive(endsWednesday, new Date(2026, 7, 26, 23, 59))).toBe(true);
    expect(isSpecialLive(endsWednesday, new Date(2026, 7, 27, 0, 1))).toBe(false);
  });
});

describe('labels', () => {
  it('describes the schedule for admin lists', () => {
    expect(describeSchedule(special())).toContain('Every day');
    expect(describeSchedule(special({ daysOfWeek: [1, 2] }))).toContain('Mon, Tue');
  });

  it('derives the discount percent from prices', () => {
    expect(discountPercent(16, 20)).toBe(20);
    expect(discountPercent(20, 20)).toBeNull();
    expect(discountPercent(16, null)).toBeNull();
    expect(discountPercent(16, 10)).toBeNull(); // markup is not a discount
  });

  it('formats local date keys without timezone drift', () => {
    expect(localDateKey(new Date(2026, 7, 24))).toBe('2026-08-24');
  });
});
