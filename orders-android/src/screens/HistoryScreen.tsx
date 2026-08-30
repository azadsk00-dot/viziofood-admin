// HISTORY — past orders with server-side search + date filtering and lazy
// pagination. Thousands of orders never load at once.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, radius, spacing, type as typeScale } from '../theme';
import type { Order } from '../types';
import { fetchHistoryPage, type HistoryFilter } from '../services/orderService';
import { fulfilmentLabel } from '../orders/orderStatus';
import { formatDateTime, formatMoney, shortOrderNumber } from '../lib/format';
import { OfflineBanner } from '../components/ConnectionBanner';
import { Badge, Button, EmptyState } from '../components/ui';

type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'all';

const RANGE_PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All' },
];

function rangeBounds(preset: RangePreset): { from: string | null; to: string | null } {
  const dayStart = (offsetDays: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  };
  const dayEnd = (offsetDays: number) => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  };
  switch (preset) {
    case 'today':
      return { from: dayStart(0), to: null };
    case 'yesterday':
      return { from: dayStart(-1), to: dayEnd(-1) };
    case '7d':
      return { from: dayStart(-6), to: null };
    case '30d':
      return { from: dayStart(-29), to: null };
    default:
      return { from: null, to: null };
  }
}

export function HistoryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [statusFilter, setStatusFilter] = useState<Order['status'] | 'all'>('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce search typing → server-side ILIKE queries.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const loadPage = useCallback(
    async (pageIndex: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const { from, to } = rangeBounds(preset);
        const filter: HistoryFilter = { query: debouncedQuery, from, to, status: statusFilter };
        const result = await fetchHistoryPage(filter, pageIndex);
        setOrders((previous) =>
          replace ? result.orders : [...previous, ...result.orders],
        );
        setHasMore(result.hasMore);
        setPage(pageIndex);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? `History could not be loaded: ${reason.message}`
            : 'History could not be loaded.',
        );
        if (replace) setOrders([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [preset, debouncedQuery, statusFilter],
  );

  // Refetch page 0 whenever the filter changes (search debounce, range
  // preset, status). The fetch is deferred a microtask so state updates
  // happen after the effect body returns, not synchronously inside it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await loadPage(0, true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

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
          <Text style={styles.title}>HISTORY</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search order # or customer"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
        {RANGE_PRESETS.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => setPreset(item.id)}
            style={[styles.chip, preset === item.id && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, preset === item.id && styles.chipLabelActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
        {(['all', 'Completed', 'Cancelled'] as const).map((status) => (
          <Pressable
            key={status}
            accessibilityRole="button"
            onPress={() => setStatusFilter(status)}
            style={[styles.chip, statusFilter === status && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, statusFilter === status && styles.chipLabelActive]}>
              {status === 'all' ? 'Any status' : status}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.list}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && orders.length === 0 ? (
          <EmptyState title="No orders match" subtitle="Try a different search or date range." />
        ) : null}

        {orders.map((order) => (
          <Pressable
            key={order.id}
            accessibilityRole="button"
            accessibilityLabel={`Order ${order.orderNumber}`}
            onPress={() => openOrder(order.id)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.rowHead}>
              <Text style={styles.rowNumber}>#{shortOrderNumber(order.orderNumber)}</Text>
              <Text style={styles.rowDate}>{formatDateTime(order.createdAt)}</Text>
            </View>
            <View style={styles.rowHead}>
              <Text style={styles.rowCustomer} numberOfLines={1}>
                {order.customerName}
              </Text>
              <Text style={styles.rowTotal}>{formatMoney(order.total)}</Text>
            </View>
            <View style={styles.rowBadges}>
              <Badge label={fulfilmentLabel(order.fulfilment)} />
              <Badge
                label={order.status.toUpperCase()}
                color={
                  order.status === 'Completed'
                    ? colors.completed
                    : order.status === 'Cancelled' || order.status === 'Rejected'
                      ? colors.danger
                      : colors.text
                }
              />
              <Badge
                label={order.paymentStatus === 'paid' ? 'PAID' : order.paymentStatus.toUpperCase()}
                color={order.paymentStatus === 'paid' ? colors.accent : colors.warning}
                background={order.paymentStatus === 'paid' ? colors.accentSoft : colors.warningSoft}
              />
            </View>
          </Pressable>
        ))}

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ margin: spacing.lg }} />
        ) : hasMore ? (
          <Button
            label="LOAD MORE"
            variant="secondary"
            small
            onPress={() => void loadPage(page + 1, false)}
          />
        ) : null}
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
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    minHeight: 50,
    fontSize: typeScale.bodyLarge,
  },
  chips: { flexGrow: 0, paddingHorizontal: spacing.lg },
  chipsContent: { gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipLabel: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: '800' },
  chipLabelActive: { color: colors.accent },
  list: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.md },
  error: { color: colors.danger, fontSize: typeScale.body, fontWeight: '700', marginBottom: spacing.md },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowNumber: { color: colors.text, fontSize: typeScale.bodyLarge, fontWeight: '900' },
  rowDate: { color: colors.textFaint, fontSize: typeScale.small },
  rowCustomer: { color: colors.textMuted, fontSize: typeScale.body, flexShrink: 1 },
  rowTotal: { color: colors.text, fontSize: typeScale.body, fontWeight: '800' },
  rowBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
});
