// HOME — the two-column order board:
//
//   PREPARING (left)   READY (right)
//
// Compact cards (number, customer, type), newest at the top of both columns,
// tap opens the FULL detail screen (never an inline expansion). One order
// changing re-renders only that card (memo + store reference identity) — no
// flicker, no scroll reset, no full reload.

import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, type as typeScale } from '../theme';
import { useOrdersStore } from '../state/ordersStore';
import { useAuthStore } from '../state/authStore';
import { boardColumns } from '../orders/board';
import { realtimeOrderService } from '../services/realtimeOrderService';
import { dismissAllNotifications } from '../services/notificationService';
import { OrderCard } from '../components/OrderCard';
import {
  ConnectionIndicator,
  NotificationPermissionBanner,
  OfflineBanner,
} from '../components/ConnectionBanner';

export function LiveOrdersScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const orders = useOrdersStore((state) => state.orders);
  const syncStatus = useOrdersStore((state) => state.syncStatus);
  const signOut = useAuthStore((state) => state.signOut);
  const [refreshing, setRefreshing] = useState(false);

  const columns = useMemo(() => boardColumns(Object.values(orders)), [orders]);

  // Opening the board = staff saw the alerts → clear the notification shade.
  useEffect(() => {
    void dismissAllNotifications();
  }, []);

  const openOrder = (orderId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).navigate('OrderDetail', { orderId });
  };

  const openSettings = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).navigate('Settings');
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await realtimeOrderService.syncNow();
    setRefreshing(false);
  };

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <OfflineBanner />
      <NotificationPermissionBanner />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>VIZIO FOOD</Text>
          <Text style={styles.title}>ORDERS</Text>
        </View>
        <View style={styles.headerRight}>
          <ConnectionIndicator />
          <Text style={styles.settingsLink} onPress={openSettings}>
            ⚙ Settings
          </Text>
          <Text style={styles.signOut} onPress={() => void signOut()}>
            Sign out
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.board}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.column}>
          <ColumnHeader title="PREPARING" count={columns.PREPARING.length} color={colors.preparing} />
          {columns.PREPARING.map((order) => (
            <OrderCard key={order.id} order={order} onOpen={() => openOrder(order.id)} />
          ))}
        </View>

        <View style={styles.column}>
          <ColumnHeader title="READY" count={columns.READY.length} color={colors.ready} />
          {columns.READY.map((order) => (
            <OrderCard key={order.id} order={order} onOpen={() => openOrder(order.id)} />
          ))}
          {columns.PREPARING.length === 0 && columns.READY.length === 0 ? (
            <Text style={styles.empty}>
              {syncStatus === 'ready' || syncStatus === 'idle'
                ? 'No active orders right now'
                : 'Loading orders…'}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function ColumnHeader({
  title,
  count,
  color,
}: {
  title: string;
  count: number;
  color: string;
}) {
  return (
    <View style={styles.columnHeader}>
      <Text style={[styles.columnTitle, { color }]}>{title}</Text>
      <Text style={[styles.columnCount, { color }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  brand: { color: colors.textFaint, fontSize: typeScale.tiny, fontWeight: '800', letterSpacing: 2.5 },
  title: { color: colors.text, fontSize: typeScale.title, fontWeight: '900', letterSpacing: 0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingsLink: { color: colors.text, fontSize: typeScale.small, fontWeight: '700' },
  signOut: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: '600' },
  board: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  column: { flex: 1, minWidth: 0 },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  columnTitle: { fontSize: typeScale.small, fontWeight: '900', letterSpacing: 1.2 },
  columnCount: { fontSize: typeScale.small, fontWeight: '900' },
  empty: {
    color: colors.textFaint,
    fontSize: typeScale.small,
    textAlign: 'center',
    padding: spacing.xl,
  },
});
