// ORDER DETAIL — the full order, opened from a board card tap (never an
// inline expansion). Layout per spec: header (number, customer, type,
// payment, requested time) → ITEMS → SPECIAL INSTRUCTIONS → PAYMENT →
// TOTAL → one state-appropriate action (+ Reprint).

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../app/navigation';
import type { Order } from '../types';
import { colors, radius, spacing, type as typeScale } from '../theme';
import { useOrdersStore } from '../state/ordersStore';
import {
  ADVANCE_LABEL,
  advanceTarget,
  canTransition,
  fulfilmentLabel,
  isPaid,
  modifierNames,
  paymentLabel,
} from '../orders/orderStatus';
import { formatClock, formatMoney, timeAgo } from '../lib/format';
import { fetchOrder, updateOrderStatus } from '../services/orderService';
import { printerQueue } from '../services/printerQueue';
import { Button } from '../components/ui';
import { OfflineBanner } from '../components/ConnectionBanner';

/** "Pickup time: 7:30 PM" / "Dine-in time: 7:30 PM" / "ASAP" (spec §10). */
function requestedTimeText(order: Order): string {
  if (order.scheduledAt === null) return 'ASAP';
  const prefix = order.fulfilment === 'Delivery' ? 'Delivery time' : `${order.fulfilment} time`;
  return `${prefix}: ${formatClock(order.scheduledAt)}`;
}

export function OrderDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const orderId = (route.params as RootStackParamList['OrderDetail']).orderId;
  const order = useOrdersStore((state) => state.orders[orderId]);
  const [loading, setLoading] = useState(!order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not in today's store (e.g. opened from HISTORY) → fetch it.
  useEffect(() => {
    if (order) return;
    let cancelled = false;
    fetchOrder(orderId)
      .then((fetched) => {
        if (!cancelled && fetched) useOrdersStore.getState().upsertOrders([fetched]);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Order could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, order]);

  const advance = async () => {
    if (!order) return;
    const target = advanceTarget(order.status);
    if (!target || !canTransition(order.status, target)) return;
    setBusy(true);
    setError(null);
    try {
      await updateOrderStatus(order.id, target);
      useOrdersStore.getState().upsertOrders([
        { ...order, status: target, updatedAt: new Date().toISOString() },
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the order.');
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    if (!order) return;
    setBusy(true);
    try {
      // The queue needs full item detail — refetch if the stored copy is thin.
      const full = order.items.length ? order : await fetchOrder(order.id);
      if (full) printerQueue.enqueueReprint(full);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.safe, styles.center, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <Text style={styles.missing}>Order not found</Text>
        <Text style={styles.missingDetail}>
          {error ?? 'It may be older than this device keeps locally. Check HISTORY.'}
        </Text>
      </View>
    );
  }

  const target = advanceTarget(order.status);
  const advanceLabel = ADVANCE_LABEL[order.status] ?? null;
  const canAdvance = target !== null && advanceLabel !== null && canTransition(order.status, target);
  const paid = isPaid(order.paymentStatus);

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to orders"
          onPress={() => navigation.goBack()}
          hitSlop={12}
        >
          <Text style={styles.back}>‹ Orders</Text>
        </Pressable>

        <Text style={styles.number}>#{order.orderNumber}</Text>
        <Text style={styles.customer}>{order.customerName}</Text>
        <View style={styles.chipRow}>
          <Chip label={fulfilmentLabel(order.fulfilment)} />
          <Chip
            label={paymentLabel(order.paymentStatus)}
            color={paid ? colors.accent : colors.warning}
            bg={paid ? colors.accentSoft : colors.warningSoft}
          />
        </View>
        <Text style={styles.timeLabel}>{requestedTimeText(order)}</Text>
        <Text style={styles.meta}>Placed {timeAgo(order.createdAt)}</Text>

        <Section title={`ITEMS (${order.items.length || order.itemsCount})`}>
          {order.items.length ? (
            order.items.map((item) => (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemHead}>
                  <Text style={styles.itemQty}>{item.quantity} ×</Text>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemPrice}>{formatMoney(item.unitPrice)}</Text>
                </View>
                {modifierNames(item).map((modifier) => (
                  <Text key={modifier} style={styles.itemModifier}>
                    {modifier}
                  </Text>
                ))}
                {item.notes ? <Text style={styles.itemNote}>Note: {item.notes}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.muted}>{order.itemsCount} item(s)</Text>
          )}
        </Section>

        <Section title="SPECIAL INSTRUCTIONS">
          {order.specialInstructions ? (
            <Text style={styles.instructions}>{order.specialInstructions}</Text>
          ) : (
            <Text style={styles.muted}>None</Text>
          )}
        </Section>

        {order.fulfilment === 'Delivery' && (order.address || order.deliveryInstructions) ? (
          <Section title="DELIVERY">
            <Text style={styles.body}>
              {[order.address, order.suburb, order.postcode].filter(Boolean).join(', ')}
            </Text>
            {order.deliveryInstructions ? (
              <Text style={styles.mutedTop}>{order.deliveryInstructions}</Text>
            ) : null}
          </Section>
        ) : null}

        <Section title="PAYMENT">
          <Row label="Status" value={paymentLabel(order.paymentStatus)} strong={paid} danger={!paid && order.paymentStatus !== 'pending'} />
          {order.customerPhone ? <Row label="Customer phone" value={order.customerPhone} /> : null}
          {order.refundStatus ? <Row label="Refund" value={order.refundStatus.toUpperCase()} /> : null}
          {order.cancelledAt ? <Row label="Cancelled" value={timeAgo(order.cancelledAt)} /> : null}
        </Section>

        <Section title="TOTAL">
          <Text style={styles.total}>{formatMoney(order.total)}</Text>
        </Section>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {canAdvance && advanceLabel ? (
          <Button label={advanceLabel} onPress={() => void advance()} loading={busy} />
        ) : null}
        <Button
          label="REPRINT RECEIPT"
          variant="secondary"
          small
          onPress={() => void print()}
          disabled={busy}
        />
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Chip({
  label,
  color = colors.text,
  bg = colors.surfaceAlt,
}: {
  label: string;
  color?: string;
  bg?: string;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipLabel, { color }]}>{label}</Text>
    </View>
  );
}

function Row({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          strong ? { color: colors.accent, fontWeight: '800' } : null,
          danger ? { color: colors.danger, fontWeight: '800' } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  back: { color: colors.accent, fontSize: typeScale.body, fontWeight: '700', marginBottom: spacing.md },
  number: { color: colors.text, fontSize: 26, fontWeight: '900' },
  customer: { color: colors.text, fontSize: typeScale.bodyLarge, fontWeight: '700', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  chipLabel: { fontSize: typeScale.small, fontWeight: '800', letterSpacing: 0.4 },
  timeLabel: {
    color: colors.text,
    fontSize: typeScale.body,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  meta: { color: colors.textFaint, fontSize: typeScale.small, marginTop: 2 },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    color: colors.textFaint,
    fontSize: typeScale.tiny,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  sectionBody: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  item: { marginBottom: spacing.md },
  itemHead: { flexDirection: 'row', gap: spacing.sm, alignItems: 'baseline' },
  itemQty: { color: colors.text, fontSize: typeScale.bodyLarge, fontWeight: '900' },
  itemName: { color: colors.text, fontSize: typeScale.bodyLarge, fontWeight: '700', flex: 1 },
  itemPrice: { color: colors.textMuted, fontSize: typeScale.body },
  itemModifier: { color: colors.textMuted, fontSize: typeScale.body, paddingLeft: spacing.xl },
  itemNote: { color: colors.warning, fontSize: typeScale.body, paddingLeft: spacing.xl },
  instructions: { color: colors.text, fontSize: typeScale.body, fontWeight: '600' },
  body: { color: colors.text, fontSize: typeScale.body },
  muted: { color: colors.textFaint, fontSize: typeScale.body },
  mutedTop: { color: colors.textMuted, fontSize: typeScale.body, marginTop: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: 3,
  },
  rowLabel: { color: colors.textMuted, fontSize: typeScale.body },
  rowValue: { color: colors.text, fontSize: typeScale.body, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  total: { color: colors.text, fontSize: 24, fontWeight: '900' },
  error: {
    color: colors.danger,
    fontSize: typeScale.body,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  missing: { color: colors.text, fontSize: typeScale.heading, fontWeight: '800' },
  missingDetail: { color: colors.textMuted, fontSize: typeScale.small, textAlign: 'center' },
});
