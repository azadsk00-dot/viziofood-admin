// Regression tests for the OrderDetailScreen crash (2026-08-30 incident):
// a zustand selector that returned `Object.values(jobs).filter(...)` produced
// a NEW array on every store snapshot; with useSyncExternalStore that reads
// as "the store changed during render" → re-render → new array → infinite
// loop → "Maximum update depth exceeded" once print retries started churning
// the jobs store. The screen now selects the stable map and derives with
// these helpers + useMemo.

import { describe, expect, it } from 'vitest';
import { createJobsForOrderSelector, jobsForOrder } from '../src/lib/jobViews';
import type { PrintJob } from '../src/lib/types';

const job = (id: string, orderId: string): PrintJob => ({
  id,
  orderId,
  orderNumber: 'VF-TEST',
  printerId: 'printer-1',
  status: 'QUEUED',
  attempts: 0,
  maxAttempts: 5,
  lastError: '',
  createdAt: '2026-08-30T00:00:00Z',
  printedAt: null,
  origin: 'auto',
});

describe('jobsForOrder', () => {
  it('returns only the jobs of that order', () => {
    const a1 = job('j1', 'order-a');
    const a2 = job('j2', 'order-a');
    const b1 = job('j3', 'order-b');
    expect(jobsForOrder({ j1: a1, j2: a2, j3: b1 }, 'order-a')).toEqual([a1, a2]);
    expect(jobsForOrder({ j1: a1, j2: a2, j3: b1 }, 'order-b')).toEqual([b1]);
  });

  it('handles an empty map', () => {
    expect(jobsForOrder({}, 'order-a')).toEqual([]);
  });
});

describe('createJobsForOrderSelector (crash regression)', () => {
  it('is referentially stable while the jobs map is unchanged', () => {
    // The OLD pattern (derive inside the selector) fails exactly this
    // invariant — a new array per call — which is what triggered the loop.
    const select = createJobsForOrderSelector();
    const jobs = { j1: job('j1', 'order-a') };
    const first = select(jobs, 'order-a');
    const second = select(jobs, 'order-a');
    expect(second).toBe(first);
  });

  it('returns a fresh result when the store actually changes', () => {
    const select = createJobsForOrderSelector();
    const jobs1 = { j1: job('j1', 'order-a') };
    const jobs2 = { j1: job('j1', 'order-a'), j2: job('j2', 'order-a') };
    const before = select(jobs1, 'order-a');
    const after = select(jobs2, 'order-a');
    expect(after).not.toBe(before);
    expect(after).toHaveLength(2);
  });

  it('does not mutate or alias the previous result across orders', () => {
    const select = createJobsForOrderSelector();
    const jobs = { j1: job('j1', 'order-a'), j2: job('j2', 'order-b') };
    const forA = select(jobs, 'order-a');
    const forB = select(jobs, 'order-b');
    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(forA[0].id).toBe('j1');
    expect(forB[0].id).toBe('j2');
  });
});
