// Settings normalization tests — a corrupted store must never break the app,
// and thresholds must stay strictly increasing.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, normalizeThresholds } from '../src/lib/settings';

describe('normalizeSettings', () => {
  it('fills defaults for missing/invalid values', () => {
    const repaired = normalizeSettings({ volume: 42, warnMinutes: 'not-a-number', theme: 'neon' } as never);
    expect(repaired.volume).toBe(1);
    expect(repaired.warnMinutes).toBe(DEFAULT_SETTINGS.warnMinutes);
    expect(repaired.theme).toBe('dark');
  });

  it('keeps valid custom values', () => {
    const repaired = normalizeSettings({ warnMinutes: 5, urgentMinutes: 8, managerMinutes: 12, volume: 0.6 });
    expect(repaired.warnMinutes).toBe(5);
    expect(repaired.urgentMinutes).toBe(8);
    expect(repaired.volume).toBeCloseTo(0.6);
  });

  it('survives null/undefined input entirely', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('normalizeThresholds', () => {
  it('repairs non-increasing escalation thresholds', () => {
    const repaired = normalizeThresholds(normalizeSettings({ warnMinutes: 10, urgentMinutes: 5, managerMinutes: 3 }));
    expect(repaired.urgentMinutes).toBeGreaterThan(repaired.warnMinutes);
    expect(repaired.managerMinutes).toBeGreaterThan(repaired.urgentMinutes);
    expect(repaired.overdueMinutes).toBeGreaterThanOrEqual(repaired.urgentMinutes);
  });
});
