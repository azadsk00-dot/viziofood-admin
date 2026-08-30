// Auto-prepare eligibility rules — the gates that stop reconciliation from
// bulk-advancing history and stop any order from being prepared twice.

import { describe, expect, it } from 'vitest';
import { isAutoPrepareEligible, MAX_ORDER_AGE_MS } from '../src/lib/autoPrepareRules';

const NOW = Date.parse('2026-08-30T12:00:00Z');

const order = (overrides: Partial<Parameters<typeof isAutoPrepareEligible>[0]> = {}) => ({
  id: 'order-1',
  status: 'New' as const,
  createdAt: '2026-08-30T11:30:00Z',
  ...overrides,
});

describe('isAutoPrepareEligible', () => {
  it('accepts a fresh NEW order that was never prepared', () => {
    expect(isAutoPrepareEligible(order(), new Set(), NOW)).toBe(true);
  });

  it('rejects non-NEW orders', () => {
    for (const status of ['Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Draft'] as const) {
      expect(isAutoPrepareEligible(order({ status }), new Set(), NOW)).toBe(false);
    }
  });

  it('rejects orders this device already prepared (persisted dedupe)', () => {
    expect(isAutoPrepareEligible(order(), new Set(['order-1']), NOW)).toBe(false);
  });

  it('rejects orders older than the eligibility window', () => {
    const stale = order({ createdAt: '2026-08-29T06:00:00Z' });
    expect(NOW - Date.parse(stale.createdAt)).toBeGreaterThan(MAX_ORDER_AGE_MS);
    expect(isAutoPrepareEligible(stale, new Set(), NOW)).toBe(false);
  });

  it('accepts an order exactly at the window edge', () => {
    const edge = new Date(NOW - MAX_ORDER_AGE_MS).toISOString();
    expect(isAutoPrepareEligible(order({ createdAt: edge }), new Set(), NOW)).toBe(true);
  });

  it('rejects an unparseable createdAt (defensive: never prepare unknowns)', () => {
    expect(isAutoPrepareEligible(order({ createdAt: 'not-a-date' }), new Set(), NOW)).toBe(false);
  });

  it('does not touch other devices\' prepared ids', () => {
    expect(isAutoPrepareEligible(order(), new Set(['other-order']), NOW)).toBe(true);
  });
});
