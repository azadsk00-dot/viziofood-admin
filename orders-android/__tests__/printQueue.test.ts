// PrinterQueue engine — serialization, retries, dedupe, failure handling.
// Native modules (Star SDK, AsyncStorage) are mocked; only pure queue logic runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

const printReceipt = vi.fn();
const notifyPrintFailure = vi.fn();

vi.mock('../src/printer/printerService', () => ({
  printReceipt: (...args: unknown[]) => printReceipt(...args),
  testConnection: vi.fn(),
  printTestReceipt: vi.fn(),
  snapshotForReceipt: (order: { orderNumber: string }) => ({
    orderNumber: order.orderNumber,
    customer: 'Test',
    fulfilment: 'Pickup',
    createdAt: new Date().toISOString(),
    scheduledText: null,
    notes: '',
    lines: [],
    total: 10,
  }),
}));

vi.mock('../src/services/notificationService', () => ({
  notifyPrintFailure: (...args: unknown[]) => notifyPrintFailure(...args),
}));

import { printerQueue } from '../src/services/printerQueue';
import { usePrintQueueStore } from '../src/state/printQueueStore';
import { useSettingsStore } from '../src/state/settingsStore';
import type { Order, ReceiptSnapshot } from '../src/types';

function order(id: string): Order {
  return {
    id,
    orderNumber: 'VF-' + id,
    status: 'New',
    paymentStatus: 'paid',
    fulfilment: 'Pickup',
    customerName: 'Test',
    customerPhone: '',
    customerEmail: '',
    address: '',
    suburb: '',
    postcode: '',
    deliveryInstructions: '',
    specialInstructions: '',
    scheduledText: null,
    scheduledAt: null,
    total: 10,
    taxTotal: 1,
    itemsCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAt: null,
    cancellationReason: '',
    refundStatus: '',
    items: [],
  };
}

function receiptFor(id: string): ReceiptSnapshot | undefined {
  return usePrintQueueStore.getState().jobs[id]?.receipt;
}

const jobs = () => usePrintQueueStore.getState().jobs;
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

describe('PrinterQueue', () => {
  beforeEach(() => {
    // Fake only the retry timers — setImmediate/microtasks stay real so the
    // async pump loop can flush between assertions.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    printReceipt.mockReset().mockResolvedValue({ ok: true });
    notifyPrintFailure.mockClear();
    usePrintQueueStore.getState().removeJobs(Object.keys(jobs()));
    useSettingsStore.getState().savePrinter({ autoPrint: true, address: '192.168.1.116' });
    (printerQueue as unknown as { started: boolean }).started = false;
    printerQueue.start();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prints a queued job and marks it printed', async () => {
    printerQueue.enqueueAuto(order('a'));
    await flush();
    expect(printReceipt).toHaveBeenCalledTimes(1);
    expect(jobs().a?.state).toBe('printed');
    expect(jobs().a?.printedAt).not.toBeNull();
  });

  it('never queues two auto receipts for the same order (duplicate realtime event)', async () => {
    printerQueue.enqueueAuto(order('a'));
    printerQueue.enqueueAuto(order('a'));
    await flush();
    expect(Object.keys(jobs())).toEqual(['a']);
    expect(printReceipt).toHaveBeenCalledTimes(1);
  });

  it('prints two arriving orders strictly in order (A then B, serialized)', async () => {
    let resolveFirst!: (value: { ok: boolean }) => void;
    printReceipt.mockImplementationOnce(
      () => new Promise<{ ok: boolean }>((resolve) => { resolveFirst = resolve; }),
    );
    printerQueue.enqueueAuto(order('a'));
    printerQueue.enqueueAuto(order('b'));
    await flush();
    // A is printing (its promise is held); B must NOT have started.
    expect(printReceipt).toHaveBeenCalledTimes(1);
    expect(jobs().a?.state).toBe('printing');
    expect(jobs().b?.state).toBe('queued');
    resolveFirst({ ok: true });
    await flush();
    expect(printReceipt).toHaveBeenCalledTimes(2);
    expect(printReceipt).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ orderNumber: 'VF-a' }),
    );
    expect(printReceipt).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ orderNumber: 'VF-b' }),
    );
    expect(jobs().a?.state).toBe('printed');
    expect(jobs().b?.state).toBe('printed');
  });

  it('retries with backoff and succeeds when the printer recovers', async () => {
    printReceipt.mockResolvedValueOnce({ ok: false, error: 'Could not reach the printer 192.168.1.116.' });
    printerQueue.enqueueAuto(order('a'));
    await flush();
    expect(jobs().a?.state).toBe('retrying');
    expect(jobs().a?.attempts).toBe(1);
    expect(jobs().a?.lastError).toContain('192.168.1.116');

    // First backoff is 5s.
    await vi.advanceTimersByTimeAsync(5_100);
    await flush();
    expect(printReceipt).toHaveBeenCalledTimes(2);
    expect(jobs().a?.state).toBe('printed');
  });

  it('marks FAILED after max attempts and notifies — then manual retry works', async () => {
    printReceipt.mockResolvedValue({ ok: false, error: 'Could not reach the printer 192.168.1.116.' });
    printerQueue.enqueueAuto(order('a'));
    await flush(); // attempt 1 → retrying
    for (let i = 2; i <= 5; i++) {
      await vi.advanceTimersByTimeAsync(61_000);
      await flush();
    }
    expect(printReceipt).toHaveBeenCalledTimes(5);
    expect(jobs().a?.state).toBe('failed');
    expect(notifyPrintFailure).toHaveBeenCalledTimes(1);

    printReceipt.mockResolvedValue({ ok: true });
    printerQueue.retryJob('a');
    await flush();
    expect(printReceipt).toHaveBeenCalledTimes(6);
    expect(jobs().a?.state).toBe('printed');
  });

  it('manual reprint requeues an already-printed order exactly once more', async () => {
    printerQueue.enqueueAuto(order('a'));
    await flush();
    expect(jobs().a?.state).toBe('printed');
    printerQueue.enqueueReprint(order('a'));
    await flush();
    expect(printReceipt).toHaveBeenCalledTimes(2);
    expect(jobs().a?.origin).toBe('reprint');
  });

  it('clears completed jobs only', async () => {
    // A pre-existing FAILED job (left by an earlier outage) and a fresh order
    // that prints fine.
    usePrintQueueStore.getState().upsertJob({
      id: 'a',
      orderNumber: 'VF-a',
      state: 'failed',
      attempts: 5,
      maxAttempts: 5,
      lastError: 'offline',
      nextAttemptAt: null,
      origin: 'auto',
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      printedAt: null,
      receipt: {
        orderNumber: 'VF-a',
        customer: 'X',
        fulfilment: 'Pickup',
        createdAt: new Date().toISOString(),
        scheduledText: null,
        notes: '',
        lines: [],
        total: 0,
      },
    });
    printerQueue.enqueueAuto(order('b')); // prints fine
    await flush();
    expect(jobs().a?.state).toBe('failed');
    expect(jobs().b?.state).toBe('printed');
    printerQueue.clearCompleted();
    expect(Object.keys(jobs()).sort()).toEqual(['a']);
  });

  it('captures the receipt snapshot at enqueue time', () => {
    printerQueue.enqueueAuto(order('a'));
    expect(receiptFor('a')?.orderNumber).toBe('VF-a');
    expect(receiptFor('a')?.customer).toBe('Test');
  });

  it('recovers jobs stranded in printing by a restart', async () => {
    usePrintQueueStore.getState().upsertJob({
      id: 'stranded',
      orderNumber: 'VF-stranded',
      state: 'printing',
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
      nextAttemptAt: null,
      origin: 'auto',
      createdAt: new Date().toISOString(),
      printedAt: null,
      receipt: {
        orderNumber: 'VF-stranded',
        customer: 'X',
        fulfilment: 'Pickup',
        createdAt: new Date().toISOString(),
        scheduledText: null,
        notes: '',
        lines: [],
        total: 0,
      },
    });
    printerQueue.onWake();
    await flush();
    expect(jobs().stranded?.state).toBe('printed');
  });
});
