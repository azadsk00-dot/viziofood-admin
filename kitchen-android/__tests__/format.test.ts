// Formatting helpers tests.

import { describe, expect, it } from 'vitest';
import { formatElapsed, formatMoney, formatMinutesAgo, shortOrderNumber, uuidv4 } from '../src/lib/format';

describe('formatElapsed', () => {
  it('renders mm:ss and h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59)).toBe('0:59');
    expect(formatElapsed(134)).toBe('2:14');
    expect(formatElapsed(728)).toBe('12:08');
    expect(formatElapsed(3661)).toBe('1:01:01');
  });
  it('never shows negative time', () => {
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('formatMoney', () => {
  it('formats AUD dollars', () => {
    expect(formatMoney(25)).toBe('$25.00');
    expect(formatMoney(12.5)).toBe('$12.50');
    expect(formatMoney(null)).toBe('$0.00');
    expect(formatMoney(Number.NaN)).toBe('$0.00');
  });
});

describe('formatMinutesAgo', () => {
  it('humanizes ages', () => {
    expect(formatMinutesAgo(20)).toBe('just now');
    expect(formatMinutesAgo(60)).toBe('1 min ago');
    expect(formatMinutesAgo(180)).toBe('3 min ago');
  });
});

describe('shortOrderNumber', () => {
  it('strips the VF- prefix', () => {
    expect(shortOrderNumber('VF-12345678')).toBe('12345678');
    expect(shortOrderNumber('CUSTOM-1')).toBe('CUSTOM-1');
  });
});

describe('uuidv4', () => {
  it('produces distinct valid-looking v4 UUIDs', () => {
    const a = uuidv4();
    const b = uuidv4();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
