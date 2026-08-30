// Formatting helpers.

import { describe, expect, it } from 'vitest';
import { formatClock, formatMoney, shortOrderNumber, startOfToday, timeAgo } from '../src/lib/format';

describe('formatMoney', () => {
  it('renders AUD with the A$ prefix', () => {
    expect(formatMoney(28.5)).toBe('A$28.50');
    expect(formatMoney(0)).toBe('A$0.00');
    expect(formatMoney(-5)).toBe('-A$5.00');
    expect(formatMoney(null)).toBe('A$0.00');
    expect(formatMoney(Number.NaN)).toBe('A$0.00');
  });
});

describe('timeAgo', () => {
  const now = Date.now();

  it('renders minutes and hours', () => {
    expect(timeAgo(new Date(now - 30_000).toISOString(), now)).toBe('just now');
    expect(timeAgo(new Date(now - 120_000).toISOString(), now)).toBe('2 min ago');
    expect(timeAgo(new Date(now - 65 * 60_000).toISOString(), now)).toBe('1h 5m ago');
  });

  it('handles missing/invalid input', () => {
    expect(timeAgo(null, now)).toBe('—');
    expect(timeAgo('garbage', now)).toBe('—');
  });
});

describe('shortOrderNumber', () => {
  it('strips the VF- prefix, keeps other forms', () => {
    expect(shortOrderNumber('VF-12345678')).toBe('12345678');
    expect(shortOrderNumber('XYZ-1')).toBe('XYZ-1');
  });
});

describe('formatClock', () => {
  it('renders HH:MM', () => {
    const t = new Date(2026, 7, 25, 9, 5, 0);
    expect(formatClock(t.toISOString())).toBe('09:05');
  });
});

describe('startOfToday', () => {
  it('is local midnight today', () => {
    const iso = startOfToday();
    const d = new Date(iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});
