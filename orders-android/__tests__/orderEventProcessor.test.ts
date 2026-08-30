// OrderEventProcessor — THE central dedupe + auto-accept decision.
// Every duplicate-protection guarantee of the app is tested here.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

const notifyNewOrder = vi.fn();
const enqueueAuto = vi.fn();
const fetchOrderItems = vi.fn();
const updateOrderStatus = vi.fn();

vi.mock('../src/services/notificationService', () => ({
  notifyNewOrder: (...args: unknown[]) => notifyNewOrder(...args),
}));
vi.mock('../src/services/printerQueue', () => ({
  printerQueue: { enqueueAuto: (...args: unknown[]) => enqueueAuto(...args), start: vi.fn(), onWake: vi.fn() },
}));
vi.mock('../src/services/orderService', () => ({
  fetchOrderItems: (...args: unknown[]) => fetchOrderItems(...args),
  updateOrderStatus: (...args: unknown[]) => updateOrderStatus(...args),
}));

import { processIncomingOrder } from '../src/services/orderEventProcessor';
import { useOrdersStore } from '../src/state/ordersStore';
import { useSettingsStore } from '../src/state/settingsStore';
import type { Order } from '../src/types';

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    orderNumber: 'VF-1001',
    status: 'New',
    paymentStatus: 'paid',
    fulfilment: 'Pickup',
    customerName: 'John Smith',
    customerPhone: '',
    customerEmail: '',
    address: '',
    suburb: '',
    postcode: '',
    deliveryInstructions: '',
    specialInstructions: '',
    scheduledText: null,
    scheduledAt: null,
    total: 28.5,
    taxTotal: 2.5,
    itemsCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAt: null,
    cancellationReason: '',
    refundStatus: '',
    items: [],
    ...overrides,
  };
}

function resetStores() {
  useOrdersStore.getState().clearAll();
  useOrdersStore.setState({ alertedOrderIds: [] });
  useSettingsStore.getState().savePrinter({ autoPrint: true, address: '192.168.1.116' });
}

describe('processIncomingOrder', () => {
  beforeEach(() => {
    notifyNewOrder.mockClear();
    enqueueAuto.mockClear();
    fetchOrderItems.mockClear().mockResolvedValue([]);
    updateOrderStatus.mockClear().mockResolvedValue({ orderId: 'ord-1', status: 'Preparing' });
    resetStores();
  });

  it('alerts (notify + auto print) and AUTO-ACCEPTS a genuinely new paid order', async () => {
    await processIncomingOrder(order(), 'realtime');
    expect(notifyNewOrder).toHaveBeenCalledTimes(1);
    expect(enqueueAuto).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus).toHaveBeenCalledWith('ord-1', 'Preparing');
    // Optimistic local flip: the board shows PREPARING without a round-trip.
    expect(useOrdersStore.getState().orders['ord-1']?.status).toBe('Preparing');
  });

  it('does NOT alert twice for the same order (duplicate realtime event)', async () => {
    await processIncomingOrder(order(), 'realtime');
    await processIncomingOrder(order(), 'realtime'); // INSERT then UPDATE replay
    await processIncomingOrder(order(), 'reconcile'); // reconnect sweep
    expect(notifyNewOrder).toHaveBeenCalledTimes(1);
    expect(enqueueAuto).toHaveBeenCalledTimes(1);
  });

  it('app restart: persisted alerted ids suppress re-alerting old paid orders', async () => {
    await processIncomingOrder(order(), 'realtime');
    // Simulate restart: orders map cleared (pruned) but alertedOrderIds persist.
    useOrdersStore.setState({ orders: {} });
    await processIncomingOrder(order(), 'reconcile');
    expect(notifyNewOrder).toHaveBeenCalledTimes(1);
  });

  it('never alerts unpaid (Draft/pending) orders and never auto-accepts them', async () => {
    await processIncomingOrder(order({ status: 'Draft', paymentStatus: 'pending' }), 'realtime');
    await processIncomingOrder(order({ status: 'New', paymentStatus: 'pending' }), 'realtime');
    expect(notifyNewOrder).not.toHaveBeenCalled();
    expect(enqueueAuto).not.toHaveBeenCalled();
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it('retries auto-accept for a paid order still stuck in New (e.g. earlier write failed)', async () => {
    await processIncomingOrder(order(), 'realtime');
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    // Another event arrives while still New (the DB write had failed).
    await processIncomingOrder(order(), 'reconcile');
    expect(updateOrderStatus).toHaveBeenCalledTimes(2);
    expect(notifyNewOrder).toHaveBeenCalledTimes(1); // never re-alerted
  });

  it('does not alert status changes of already-live orders', async () => {
    await processIncomingOrder(order(), 'realtime'); // the alert moment
    await processIncomingOrder(order({ status: 'Preparing' }), 'realtime');
    expect(notifyNewOrder).toHaveBeenCalledTimes(1);
  });

  it('reconcile discovery of an OLD paid order marks it handled without alerting (fresh install)', async () => {
    const morning = order({ createdAt: new Date(Date.now() - 5 * 3600_000).toISOString() });
    await processIncomingOrder(morning, 'reconcile');
    expect(notifyNewOrder).not.toHaveBeenCalled();
    expect(useOrdersStore.getState().alertedOrderIds).toContain('ord-1');
  });

  it('reconcile discovery of a RECENT missed order alerts (offline gap protection)', async () => {
    const missed = order({ createdAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    await processIncomingOrder(missed, 'reconcile');
    expect(notifyNewOrder).toHaveBeenCalledTimes(1);
    expect(enqueueAuto).toHaveBeenCalledTimes(1);
  });

  it('skips auto-print when auto-print is off, but still notifies', async () => {
    useSettingsStore.getState().savePrinter({ autoPrint: false, address: '192.168.1.116' });
    await processIncomingOrder(order(), 'realtime');
    expect(notifyNewOrder).toHaveBeenCalledTimes(1);
    expect(enqueueAuto).not.toHaveBeenCalled();
  });

  it('skips auto-print when no printer address is configured', async () => {
    useSettingsStore.getState().savePrinter({ autoPrint: true, address: '' });
    await processIncomingOrder(order(), 'realtime');
    expect(notifyNewOrder).toHaveBeenCalledTimes(1);
    expect(enqueueAuto).not.toHaveBeenCalled();
  });

  it('updates an existing order in place (no duplicate cards)', async () => {
    await processIncomingOrder(order(), 'realtime');
    await processIncomingOrder(order({ status: 'Preparing' }), 'realtime');
    const orders = useOrdersStore.getState().orders;
    expect(Object.keys(orders)).toEqual(['ord-1']);
    expect(orders['ord-1']?.status).toBe('Preparing');
  });

  it('fetches items for orders that arrive without item rows', async () => {
    await processIncomingOrder(order(), 'realtime');
    expect(fetchOrderItems).toHaveBeenCalledWith('ord-1');
  });

  it('auto-accept failure rolls the optimistic flip back locally', async () => {
    updateOrderStatus.mockRejectedValueOnce(new Error('RLS denied'));
    await processIncomingOrder(order(), 'realtime');
    // Await the async auto-accept failure handler.
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(useOrdersStore.getState().orders['ord-1']?.status).toBe('New');
  });
});
