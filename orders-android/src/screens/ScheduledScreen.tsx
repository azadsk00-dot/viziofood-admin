// SCHEDULED — future orders, chronological, split into UPCOMING and
// READY TO PROCESS (inside the preparation window). Scheduled times come
// from the "Scheduled pickup: …" sentences in order notes (the existing
// VIZIO FOOD convention — no schema change involved).

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, radius, spacing, type as typeScale } from '../theme';
import type { Order } from '../types';
import { useOrdersStore } from '../state/ordersStore';
import { scheduledGroups } from '../orders/board';
import { fulfilmentLabel } from '../orders/orderStatus';
import { formatClock, formatDate, formatMoney, shortOrderNumber, timeUntil } from '../lib/format';
import { OfflineBanner } from '../components/ConnectionBanner';
import { Badge, EmptyState, SectionHeader } from '../components/ui';

function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ScheduledCard({ order, onOpen }: { order: Order; onOpen: () => void }) {
  if (order.scheduledAt === null) return null;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Scheduled order ${order.orderNumber}`}
      style={({ pressed }) => [styles.card, pressed && { borderColor: colors.accent, opacity: 0.92 }]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.number}>#{shortOrderNumber(order.orderNumber)}</Text>
        <Text style={styles.countdown}>{timeUntil(order.scheduledAt)}</Text>
      </View>
      <Text style={styles.customer}>{order.customerName}</Text>
      <View style={styles.badgeRow}>
        <Badge label={fulfilmentLabel(order.fulfilment)} />
        <Badge
          label={order.paymentStatus === 'paid' ? 'PAID' : order.paymentStatus.toUpperCase()}
          color={order.paymentStatus === 'paid' ? colors.accent : colors.warning}
          background={order.paymentStatus === 'paid' ? colors.accentSoft : colors.warningSoft}
        />
        <Badge label={order.status.toUpperCase()} />
      </View>
      <Text style={styles.when}>
        {formatDate(order.scheduledAt)} at {formatClock(order.scheduledAt)}
      </Text>
      <Text style={styles.items} numberOfLines={2}>
        {order.items.length
          ? order.items.map((item) => `${item.quantity}× ${item.name}`).join(' • ')
          : `${order.itemsCount} item(s)`}
      </Text>
      <Text style={styles.total}>{formatMoney(order.total)}</Text>
    </Pressable>
  );
}

export function ScheduledScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const orders = useOrdersStore((state) => state.orders);
  const now = useNowTick();

  const groups = useMemo(() => scheduledGroups(Object.values(orders), now), [orders, now]);

  const openOrder = (orderId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).navigate('OrderDetail', { orderId });
  };

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <OfflineBanner />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>VIZIO FOOD</Text>
          <Text style={styles.title}>SCHEDULED</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {groups.upcoming.length === 0 && groups.readyToProcess.length === 0 ? (
          <EmptyState
            title="No scheduled orders"
            subtitle="Future pickup/dine-in orders appear here with a countdown."
          />
        ) : null}

        <SectionHeader
          title="READY TO PROCESS"
          count={groups.readyToProcess.length}
          color={colors.ready}
        />
        {groups.readyToProcess.map((order) => (
          <ScheduledCard key={order.id} order={order} onOpen={() => openOrder(order.id)} />
        ))}

        <SectionHeader title="UPCOMING" count={groups.upcoming.length} color={colors.info} />
        {groups.upcoming.map((order) => (
          <ScheduledCard key={order.id} order={order} onOpen={() => openOrder(order.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  brand: { color: colors.accent, fontSize: typeScale.small, fontWeight: '900', letterSpacing: 3 },
  title: { color: colors.text, fontSize: typeScale.title, fontWeight: '900', letterSpacing: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  number: { color: colors.text, fontSize: typeScale.cardTitle, fontWeight: '900' },
  countdown: { color: colors.info, fontSize: typeScale.body, fontWeight: '800' },
  customer: {
    color: colors.text,
    fontSize: typeScale.cardBody,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  when: { color: colors.text, fontSize: typeScale.body, fontWeight: '700', marginBottom: spacing.xs },
  items: { color: colors.textMuted, fontSize: typeScale.body, marginBottom: spacing.xs },
  total: { color: colors.text, fontSize: typeScale.bodyLarge, fontWeight: '900' },
});
