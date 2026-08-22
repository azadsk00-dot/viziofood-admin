// Orders admin — full web-parity order management: status/paid/fulfilment
// filters + search, server-paged loading, order detail with charge breakdown,
// status history, full/partial refunds (live-connection only), cancel with
// reason + audit, CSV export via the Android share sheet, reprint.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { AdminPage, Card, EmptyState, Pill } from '../../components/admin/kit';
import { ModalSheet, NumberField, TextField, ToggleField } from '../../components/admin/fields';
import {
  attachOrderItems,
  cancelOrderWithAudit,
  fetchOrdersPage,
  getOrderStatusHistory,
  isPaidOrder,
  processRefund,
  refundableRemainingCents,
  updateOrderStatus,
} from '../../services/admin/ordersAdmin';
import { reprintOrder } from '../../services/printActions';
import { csvFileName, ordersToCsv } from '../../lib/csv';
import { aud } from '../../lib/money';
import { formatDateTime } from '../../lib/format';
import { canCancelPaidOrders, canRefund } from '../../lib/permissions';
import { useAuthStore } from '../../state/authStore';
import { useOrdersStore } from '../../state/ordersStore';
import type { AdminOrder } from '../../lib/adminTypes';
import type { OrderStatus } from '../../lib/types';
import { canTransition } from '../../lib/orderLogic';
import { dark } from '../../theme';

const PAGE_SIZE = 25;
const STATUS_TABS: Array<OrderStatus | 'all'> = ['all', 'New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Rejected'];
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  New: 'Accepted', Accepted: 'Preparing', Preparing: 'Ready', Ready: 'Completed',
};

type PaymentFilter = 'all' | 'paid' | 'unpaid' | 'refunded';
type FulfilmentFilter = 'all' | 'Pickup' | 'Delivery';

export default function OrdersScreen(): React.ReactElement {
  const role = useAuthStore((s) => s.role);
  const online = useOrdersStore((s) => s.internetOnline);
  const { width } = useWindowDimensions();

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [nextFrom, setNextFrom] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [fulfilment, setFulfilment] = useState<FulfilmentFilter>('all');
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [detail, setDetail] = useState<AdminOrder | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; status: string; changedBy: string | null; createdAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [cancelFor, setCancelFor] = useState<AdminOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [refundFor, setRefundFor] = useState<AdminOrder | null>(null);
  const [refundPartial, setRefundPartial] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('Customer requested cancellation');
  const [refundAck, setRefundAck] = useState(false);

  const loadPage = useCallback(
    async (from: number, replace: boolean) => {
      setLoading(true);
      setError('');
      try {
        const page = await fetchOrdersPage(from, PAGE_SIZE, searchQuery || undefined);
        if (replace) await attachOrderItems(page.orders);
        setOrders((prev) => (replace ? page.orders : [...prev, ...page.orders]));
        setNextFrom(page.nextFrom);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load orders.');
      } finally {
        setLoading(false);
      }
    },
    [searchQuery],
  );

  useEffect(() => {
    void loadPage(0, true);
  }, [loadPage]);

  const filtered = orders.filter((order) => {
    if (status !== 'all' && order.status !== status) return false;
    if (payment === 'paid' && !isPaidOrder(order)) return false;
    if (payment === 'unpaid' && isPaidOrder(order)) return false;
    if (payment === 'refunded' && !(order.refundAmount > 0)) return false;
    if (fulfilment !== 'all' && order.fulfilment !== fulfilment) return false;
    return true;
  });

  const openDetail = async (order: AdminOrder) => {
    setDetail(order);
    setHistory([]);
    setHistory(await getOrderStatusHistory(order.id));
  };

  const advance = async (order: AdminOrder) => {
    const to = NEXT[order.status];
    if (!to) return;
    setBusy(true);
    try {
      await updateOrderStatus(order.id, to);
      const updated = { ...order, status: to };
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
      setDetail((d) => (d?.id === order.id ? updated : d));
      setMessage(`Order ${order.orderNumber} → ${to}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancelFor || !cancelReason.trim()) return;
    setBusy(true);
    try {
      await cancelOrderWithAudit(cancelFor, cancelReason.trim());
      if (isPaidOrder(cancelFor) && refundableRemainingCents(cancelFor) > 0 && canRefund(role)) {
        const refund = await processRefund(cancelFor.id, undefined, `Order cancelled: ${cancelReason.trim()}`);
        setMessage(refund.ok ? `Cancelled — full refund ${refund.refundStatus ?? 'started'}.` : `Cancelled, but refund failed: ${refund.error}`);
      } else {
        setMessage('Order cancelled.');
      }
      setCancelFor(null);
      setCancelReason('');
      await loadPage(0, true);
      setDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  };

  const doRefund = async () => {
    if (!refundFor || !refundAck) return;
    let amount: number | undefined;
    if (refundPartial) {
      const parsed = Number(refundAmount);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > refundableRemainingCents(refundFor) / 100) {
        setError('Refund amount must be more than 0 and at most the remaining amount.');
        return;
      }
      amount = parsed;
    }
    setBusy(true);
    const result = await processRefund(refundFor.id, amount, refundReason);
    setBusy(false);
    if (result.ok) {
      setMessage(`Refund ${result.refundStatus ?? 'started'}${result.refundAmount ? ` — ${aud(Math.round(result.refundAmount * 100))}` : ''}.`);
      setRefundFor(null);
      setRefundAck(false);
      await loadPage(0, true);
    } else {
      setError(result.error ?? 'Refund failed.');
    }
  };

  const exportCsv = async () => {
    await Share.share({ title: 'Vizio orders export', message: ordersToCsv(filtered) });
  };

  const chip = (active: boolean) => [styles.chip, active && styles.chipActive];
  const chipText = (active: boolean) => [styles.chipText, active && { color: dark.accentText }];

  const detailCharge = (label: string, cents: number) => (
    <View key={label} style={styles.chargeRow}>
      <Text style={styles.chargeLabel}>{label}</Text>
      <Text style={[styles.chargeValue, { color: dark.text }]}>{aud(cents)}</Text>
    </View>
  );

  return (
    <AdminPage
      title="Orders"
      subtitle={`${filtered.length} shown${nextFrom !== null ? ' · more available' : ''}`}
      loading={loading && orders.length === 0}
      error={error}
      onRefresh={() => void loadPage(0, true)}
      offlineBlocked={!online}
      actions={
        <Pressable style={styles.exportButton} onPress={() => void exportCsv()}>
          <Text style={styles.exportText}>EXPORT CSV</Text>
        </Pressable>
      }
    >
      <TextInput
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => {
          setSearchQuery(search);
          void loadPage(0, true);
        }}
        placeholder="Search order #, name, phone, email…"
        placeholderTextColor={dark.textDim}
        style={styles.search}
        returnKeyType="search"
      />

      <View style={[styles.filterRow, { flexWrap: width < 900 ? 'wrap' : 'nowrap' }]}>
        {STATUS_TABS.map((tab) => (
          <Pressable key={tab} onPress={() => setStatus(tab)} style={chip(status === tab)}>
            <Text style={chipText(status === tab)}>{tab === 'all' ? 'ALL' : tab.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[styles.filterRow, { flexWrap: width < 900 ? 'wrap' : 'nowrap', marginTop: 8 }]}>
        {(['all', 'paid', 'unpaid', 'refunded'] as PaymentFilter[]).map((p) => (
          <Pressable key={p} onPress={() => setPayment(p)} style={chip(payment === p)}>
            <Text style={chipText(payment === p)}>{p.toUpperCase()}</Text>
          </Pressable>
        ))}
        <View style={{ width: 12 }} />
        {(['all', 'Pickup', 'Delivery'] as FulfilmentFilter[]).map((f) => (
          <Pressable key={f} onPress={() => setFulfilment(f)} style={chip(fulfilment === f)}>
            <Text style={chipText(fulfilment === f)}>{f === 'all' ? 'ALL FULFILMENT' : f.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {filtered.map((order) => (
        <Pressable key={order.id} style={styles.orderRow} onPress={() => void openDetail(order)}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={[styles.orderNumber, { color: dark.text }]}>#{order.orderNumber.replace('VF-', '')}</Text>
              <Pill label={order.status.toUpperCase()} tone={order.status === 'Cancelled' || order.status === 'Rejected' ? 'bad' : order.status === 'Completed' ? 'good' : 'info'} />
              <Pill label={order.fulfilment.toUpperCase()} />
              {order.refundStatus ? <Pill label={`REFUND ${order.refundStatus.toUpperCase()}`} tone={order.refundStatus === 'failed' ? 'bad' : 'warn'} /> : null}
              {!isPaidOrder(order) ? <Pill label="UNPAID" tone="warn" /> : null}
            </View>
            <Text style={styles.orderMeta} numberOfLines={1}>
              {order.customerName || '—'} · {order.itemsCount} items · {formatDateTime(order.createdAt)}
            </Text>
          </View>
          <Text style={[styles.orderTotal, { color: dark.text }]}>{aud(Math.round(order.total * 100))}</Text>
        </Pressable>
      ))}

      {!filtered.length && !loading ? <EmptyState text="No orders match these filters." /> : null}

      {nextFrom !== null ? (
        <Pressable style={styles.moreButton} disabled={loading} onPress={() => void loadPage(nextFrom, false)}>
          {loading ? <ActivityIndicator color={dark.accent} /> : <Text style={styles.moreText}>LOAD MORE</Text>}
        </Pressable>
      ) : null}

      {/* ── Order detail sheet ── */}
      <ModalSheet
        visible={detail !== null}
        title={detail ? `Order #${detail.orderNumber.replace('VF-', '')}` : ''}
        onClose={() => setDetail(null)}
        footer={
          detail && NEXT[detail.status] && canTransition(detail.status, NEXT[detail.status] as OrderStatus) ? (
            <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void advance(detail)}>
              <Text style={styles.primaryButtonText}>MARK {NEXT[detail.status]!.toUpperCase()}</Text>
            </Pressable>
          ) : null
        }
      >
        {detail ? (
          <View>
            <Card>
              <Text style={styles.sectionLabel}>CUSTOMER</Text>
              <Text style={[styles.value, { color: dark.text }]}>{detail.customerName || '—'}</Text>
              <Text style={styles.subValue}>{detail.customerEmail || '—'} · {detail.customerPhone || '—'}</Text>
              {detail.fulfilment === 'Delivery' ? (
                <Text style={styles.subValue}>{[detail.address, detail.suburb, detail.postcode].filter(Boolean).join(', ')}</Text>
              ) : null}
              <Text style={styles.subValue}>Placed {formatDateTime(detail.createdAt)} · {detail.fulfilment}</Text>
            </Card>

            <Card style={{ marginTop: 10 }} title="Items">
              {detail.items.map((item) => (
                <View key={item.id} style={{ marginBottom: 6 }}>
                  <Text style={[styles.value, { color: dark.text }]}>{item.quantity} × {item.name} — {aud(Math.round(item.unitPrice * 100))}</Text>
                  {item.modifiers.map((m, i) => (
                    <Text key={i} style={styles.subValue}>   + {m}</Text>
                  ))}
                  {item.notes ? <Text style={[styles.subValue, { color: dark.warning }]}>   NOTE: {item.notes}</Text> : null}
                </View>
              ))}
              {detail.specialInstructions ? (
                <Text style={[styles.subValue, { color: dark.warning, marginTop: 6 }]}>ORDER NOTE: {detail.specialInstructions}</Text>
              ) : null}
            </Card>

            <Card style={{ marginTop: 10 }} title="Payment & charges">
              {detailCharge('Subtotal', Math.round(detail.subtotal * 100))}
              {detail.discountTotal > 0 ? detailCharge(`Discount${detail.couponCode ? ` (${detail.couponCode})` : ''}`, -Math.round(detail.discountTotal * 100)) : null}
              {detailCharge('Service charge', Math.round(detail.serviceCharge * 100))}
              {detailCharge('Tax', Math.round(detail.taxTotal * 100))}
              {detailCharge('Delivery', Math.round(detail.deliveryFee * 100))}
              {detailCharge('Card processing', Math.round(detail.cardProcessingFee * 100))}
              <View style={[styles.chargeRow, { borderTopWidth: 1, borderTopColor: dark.border, marginTop: 6, paddingTop: 6 }]}>
                <Text style={[styles.chargeLabel, { color: dark.text, fontWeight: '900' }]}>TOTAL</Text>
                <Text style={[styles.chargeValue, { color: dark.text, fontWeight: '900' }]}>{aud(Math.round(detail.total * 100))}</Text>
              </View>
              <Text style={[styles.subValue, { marginTop: 8 }]}>
                Payment: {detail.paymentStatus.toUpperCase()} · Stripe ref {detail.paymentIntentId || detail.stripeSessionId || '—'}
              </Text>
              {detail.refundStatus ? (
                <Text style={[styles.subValue, { color: dark.warning }]}>
                  Refund {detail.refundStatus} — {aud(Math.round(detail.refundAmount * 100))} · {detail.refundId || 'pending'} ·{' '}
                  {detail.refundReason || ''} {detail.refundedAt ? `(${formatDateTime(detail.refundedAt)})` : ''}
                </Text>
              ) : null}
              {detail.cancelledAt ? (
                <Text style={[styles.subValue, { color: dark.danger }]}>Cancelled {formatDateTime(detail.cancelledAt)} — {detail.cancellationReason}</Text>
              ) : null}
            </Card>

            <Card style={{ marginTop: 10 }} title="Status history">
              {history.length ? (
                history.map((entry) => (
                  <Text key={entry.id} style={styles.subValue}>
                    {formatDateTime(entry.createdAt)} — {entry.status}
                    {entry.changedBy ? ` (by ${entry.changedBy.slice(0, 8)})` : ''}
                  </Text>
                ))
              ) : (
                <Text style={styles.subValue}>No recorded transitions (server history unavailable).</Text>
              )}
            </Card>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              {canRefund(role) && isPaidOrder(detail) && refundableRemainingCents(detail) > 0 && detail.refundStatus !== 'pending' ? (
                <Pressable
                  style={[styles.actionButton, { borderColor: dark.warning }]}
                  disabled={!online}
                  onPress={() => {
                    setRefundFor(detail);
                    setRefundPartial(false);
                    setRefundAmount((refundableRemainingCents(detail) / 100).toFixed(2));
                  }}
                >
                  <Text style={[styles.actionText, { color: dark.warning }]}>REFUND…</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.actionButton, { borderColor: dark.info }]}
                disabled={busy}
                onPress={() => void reprintOrder(detail.id).then((r) => setMessage(r.ok ? `Reprint queued (${r.requeued}).` : r.error ?? 'Reprint failed.'))}
              >
                <Text style={[styles.actionText, { color: dark.info }]}>REPRINT</Text>
              </Pressable>
              {canCancelPaidOrders(role) && !['Cancelled', 'Rejected', 'Completed'].includes(detail.status) ? (
                <Pressable style={[styles.actionButton, { borderColor: dark.danger }]} disabled={busy} onPress={() => setCancelFor(detail)}>
                  <Text style={[styles.actionText, { color: dark.danger }]}>CANCEL…</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </ModalSheet>

      {/* ── Cancel dialog ── */}
      <ModalSheet visible={cancelFor !== null} title="Cancel order" onClose={() => setCancelFor(null)}>
        {cancelFor ? (
          <View>
            <Text style={styles.subValue}>
              Cancelling #{cancelFor.orderNumber.replace('VF-', '')}. A paid order will also receive a full Stripe refund. The state
              machine records who cancelled and why.
            </Text>
            <TextField label="Reason (required)" value={cancelReason} onChangeText={setCancelReason} multiline placeholder="Customer changed their mind…" />
            <Pressable
              style={[styles.primaryButton, { backgroundColor: dark.danger, opacity: !cancelReason.trim() || busy ? 0.5 : 1 }]}
              disabled={!cancelReason.trim() || busy}
              onPress={() => void doCancel()}
            >
              <Text style={[styles.primaryButtonText, { color: '#fff' }]}>CONFIRM CANCEL</Text>
            </Pressable>
          </View>
        ) : null}
      </ModalSheet>

      {/* ── Refund dialog ── */}
      <ModalSheet visible={refundFor !== null} title="Refund order" onClose={() => setRefundFor(null)}>
        {refundFor ? (
          <View>
            <Text style={styles.subValue}>
              Remaining refundable: {aud(refundableRemainingCents(refundFor))} of {aud(Math.round(refundFor.total * 100))}.
              Refunds run live against Stripe — they are never queued offline.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
              <Pressable style={chip(!refundPartial)} onPress={() => setRefundPartial(false)}>
                <Text style={chipText(!refundPartial)}>FULL</Text>
              </Pressable>
              <Pressable style={chip(refundPartial)} onPress={() => setRefundPartial(true)}>
                <Text style={chipText(refundPartial)}>PARTIAL</Text>
              </Pressable>
            </View>
            {refundPartial ? (
              <NumberField label="Amount (AUD)" value={refundAmount} onChangeText={setRefundAmount} hint={`At most ${(refundableRemainingCents(refundFor) / 100).toFixed(2)}`} />
            ) : null}
            <TextField label="Reason" value={refundReason} onChangeText={setRefundReason} />
            <ToggleField label="I understand this refunds the customer via Stripe" value={refundAck} onChange={setRefundAck} />
            <Pressable
              style={[styles.primaryButton, { backgroundColor: dark.warning, opacity: !refundAck || busy ? 0.5 : 1 }]}
              disabled={!refundAck || busy}
              onPress={() => void doRefund()}
            >
              <Text style={[styles.primaryButtonText, { color: '#1A1405' }]}>REFUND {refundPartial ? '$' + refundAmount : 'FULL'}</Text>
            </Pressable>
          </View>
        ) : null}
      </ModalSheet>

    </AdminPage>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: dark.surface, borderColor: dark.border, color: dark.text, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  filterRow: { flexDirection: 'row', gap: 6 },
  chip: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: dark.surface },
  chipActive: { backgroundColor: dark.accent, borderColor: dark.accent },
  chipText: { color: dark.textDim, fontWeight: '800', fontSize: 12, letterSpacing: 0.4 },
  exportButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  exportText: { color: dark.info, fontWeight: '800', fontSize: 12, letterSpacing: 0.6 },
  message: { color: dark.info, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: dark.surface, borderRadius: 12, borderWidth: 1, borderColor: dark.border, padding: 12, marginTop: 8 },
  orderNumber: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  orderMeta: { color: dark.textDim, fontSize: 13, marginTop: 4, fontWeight: '600' },
  orderTotal: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  moreButton: { alignItems: 'center', padding: 16, marginTop: 6 },
  moreText: { color: dark.info, fontWeight: '800', letterSpacing: 0.8 },
  sectionLabel: { color: dark.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  value: { fontSize: 16, fontWeight: '700' },
  subValue: { color: dark.textDim, fontSize: 13, marginTop: 2, lineHeight: 19 },
  chargeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  chargeLabel: { color: dark.textDim, fontSize: 14, fontWeight: '600' },
  chargeValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  primaryButton: { backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryButtonText: { color: dark.accentText, fontWeight: '900', fontSize: 16, letterSpacing: 0.5 },
  actionButton: { borderWidth: 2, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: dark.surfaceAlt },
  actionText: { fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
});
