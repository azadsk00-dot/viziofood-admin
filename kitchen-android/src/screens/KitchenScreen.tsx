// Dashboard — the main kitchen screen.
//
// - Live order board (realtime + reconciliation, offline-tolerant)
// - Filter tabs, search, quick actions, rush banner, alert overlay hookup
// - One-second tick drives every card's elapsed timer + escalation colours

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useOrdersStore } from '../state/ordersStore';
import { useSettingsStore } from '../state/settingsStore';
import { acknowledgeOrder, updateOrderStatus } from '../services/orderActions';
import { syncService } from '../services/syncService';
import { OrderCard } from '../components/OrderCard';
import { ConnectionBanner, PrinterChip } from '../components/ConnectionBanner';
import { BigButton, useTheme } from '../components/ui';
import type { KitchenOrder } from '../lib/types';
import { FILTER_LABELS, OrderFilter, advanceTarget, filterOrders, isUnacknowledged, sortOrders } from '../lib/orderLogic';
import { navigateToOrder } from '../navigation/RootNavigator';
import { navigateToSection } from '../navigation/sectionNav';

const FILTER_TABS: OrderFilter[] = [
  'live', 'new', 'accepted', 'preparing', 'ready', 'completed',
  'pickup', 'delivery', 'urgent', 'overdue', 'unacknowledged', 'cancelled',
];

/** Rush banner when active orders exceed the configured multiple of warnMinutes pressure. */
function rushLevel(activeCount: number, unackedCount: number): 'none' | 'busy' | 'rush' {
  if (unackedCount >= 3 || activeCount >= 10) return 'rush';
  if (unackedCount >= 1 || activeCount >= 6) return 'busy';
  return 'none';
}

export default function KitchenScreen(): React.ReactElement {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const orders = useOrdersStore((s) => s.orders);
  const online = useOrdersStore((s) => s.internetOnline);
  const settings = useSettingsStore((s) => s.settings);
  const [filter, setFilter] = useState<OrderFilter>(settings.defaultFilter);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const searchRef = useRef<TextInput>(null);

  // 1-second heartbeat drives every visible timer.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const all = useMemo(() => Object.values(orders), [orders]);
  const visible = useMemo(
    () => sortOrders(filterOrders(all, filter, query, settings, now), settings.sortOldestFirst),
    [all, filter, query, settings, now],
  );

  const counts = useMemo(() => {
    const active = all.filter((o) => ['New', 'Accepted', 'Preparing', 'Ready'].includes(o.status));
    return {
      active: active.length,
      new: all.filter((o) => o.status === 'New').length,
      unacked: all.filter(isUnacknowledged).length,
    };
  }, [all, now]);

  const rush = rushLevel(counts.active, counts.unacked);
  const numColumns = width > 1280 ? 3 : width > 800 ? 2 : 1;

  const advance = async (order: KitchenOrder) => {
    const target = advanceTarget(order.status);
    if (!target) return;
    setBusyId(order.id);
    await updateOrderStatus(order, target);
    setBusyId(null);
  };

  const ack = async (orderId: string) => {
    setBusyId(orderId);
    await acknowledgeOrder(orderId);
    setBusyId(null);
  };

  const syncNow = async () => {
    setSyncing(true);
    await syncService.syncNow();
    setSyncing(false);
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ConnectionBanner />

      {rush !== 'none' ? (
        <View style={[styles.rush, { backgroundColor: rush === 'rush' ? theme.danger : theme.warning }]}>
          <Text style={styles.rushText}>
            {rush === 'rush' ? '⚠️ RUSH — MANY ORDERS WAITING' : 'BUSY — orders queueing up'}
          </Text>
        </View>
      ) : null}

      <View style={[styles.toolbar, { borderBottomColor: theme.border }]}>
        <Pressable
          testID="sync-now"
          onPress={() => void syncNow()}
          style={[styles.syncButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.syncText, { color: online ? theme.text : theme.offline }]}>
            {syncing ? 'SYNCING…' : 'SYNC NOW'}
          </Text>
        </Pressable>

        <TextInput
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search order #, customer, item…"
          placeholderTextColor={theme.textDim}
          style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
        />

        <PrinterChip onPress={() => navigateToSection('printQueue')} />
      </View>

      <View style={[styles.tabsRow, { borderBottomColor: theme.border }]}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTER_TABS}
          keyExtractor={(item) => item}
          renderItem={({ item }) => {
            const active = item === filter;
            return (
              <Pressable
                onPress={() => setFilter(item)}
                style={[
                  styles.tab,
                  { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.border },
                ]}
              >
                <Text style={[styles.tabText, { color: active ? theme.accentText : theme.textDim }]}>
                  {FILTER_LABELS[item]}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      <FlatList
        data={visible}
        numColumns={numColumns}
        key={`board-${numColumns}`}
        keyExtractor={(order) => order.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
        columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            settings={settings}
            now={now}
            busy={busyId === item.id}
            onOpen={(id) => navigateToOrder(id)}
            onAdvance={(order) => void advance(order)}
            onAcknowledge={(id) => void ack(id)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.textDim }]}>
              {online ? 'No orders in this view' : 'OFFLINE — showing last known orders'}
            </Text>
            <Text style={[styles.emptySub, { color: theme.textDim }]}>
              {online
                ? filter === 'live' ? 'New paid orders appear here instantly.' : 'Try a different filter.'
                : 'Orders received before the outage remain visible. Reconnect to catch up.'}
            </Text>
            {!online ? (
              <BigButton title="SYNC NOW" onPress={() => void syncNow()} busy={syncing} style={{ marginTop: 16 }} />
            ) : null}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rush: { paddingVertical: 8, alignItems: 'center' },
  rushText: { color: '#0B0E13', fontSize: 17, fontWeight: '900', letterSpacing: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  syncButton: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  syncText: { fontSize: 14, fontWeight: '900' },
  search: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15 },
  tabsRow: { borderBottomWidth: 1 },
  tab: { borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 4, marginVertical: 8 },
  tabText: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  empty: { alignItems: 'center', padding: 40, gap: 6 },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
  emptySub: { fontSize: 15, textAlign: 'center' },
});
