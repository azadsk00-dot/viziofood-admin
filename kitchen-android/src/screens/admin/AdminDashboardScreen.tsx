// Admin Dashboard — revenue/orders/average/orders-live metrics over properly
// aligned Today/Yesterday/7-day/30-day/This-month windows (the web's week/
// month reuse of a 24h slice and UTC bucket bug are fixed in lib/reports),
// daily revenue chart, top products, recent orders, status summary, alerts.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminPage, BarChart, Card, EmptyState, Pill, StatCard } from '../../components/admin/kit';
import { fetchOrdersPage, attachOrderItems } from '../../services/admin/ordersAdmin';
import type { AdminOrder } from '../../lib/adminTypes';
import { RANGE_LABELS, RangePreset, buildReport, windowFor } from '../../lib/reports';
import { aud } from '../../lib/money';
import { dark } from '../../theme';
import { navigateToSection } from '../../navigation/sectionNav';

const RANGES: RangePreset[] = ['today', 'yesterday', 'week7', 'month30', 'month'];
const LIVE_STATUSES = ['New', 'Accepted', 'Preparing', 'Ready'];

export default function AdminDashboardScreen(): React.ReactElement {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<RangePreset>('today');
  const [liveCount, setLiveCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Aggregate over the most recent orders (server-ordered); the window
      // filter and all metrics come from lib/reports (exact, local-midnight).
      const page = await fetchOrdersPage(0, 400);
      await attachOrderItems(page.orders);
      setOrders(page.orders);
      setLiveCount(page.orders.filter((o) => LIVE_STATUSES.includes(o.status)).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = buildReport(orders, windowFor(range));
  const recent = orders.slice(0, 6);
  const statusSummary = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled'].map((status) => ({
    status,
    count: report.scoped.filter((o) => o.status === status).length,
  }));

  return (
    <AdminPage title="Dashboard" subtitle="Revenue, orders and operations" loading={loading} error={error} onRefresh={() => void load()}>
      <View style={styles.rangeRow}>
        {RANGES.map((preset) => (
          <Pressable
            key={preset}
            onPress={() => setRange(preset)}
            style={[styles.rangeChip, range === preset && styles.rangeChipActive]}
          >
            <Text style={[styles.rangeText, range === preset && { color: dark.accentText }]}>{RANGE_LABELS[preset].toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.statGrid}>
        <StatCard label="Net revenue" value={aud(report.netRevenueCents)} caption={`Gross ${aud(report.grossRevenueCents)} · refunded ${aud(report.refundedCents)}`} tone="good" />
        <StatCard label="Paid orders" value={String(report.paidOrders)} caption={`${report.cancelledOrders} cancelled in range`} />
        <StatCard label="Average order" value={aud(report.averageOrderCents)} caption="Net of refunds" />
        <StatCard label="Live now" value={String(liveCount)} caption="New/Accepted/Preparing/Ready" tone={liveCount > 0 ? 'warn' : 'default'} />
        <StatCard label="Pickup" value={String(report.pickupOrders)} />
        <StatCard label="Delivery" value={String(report.deliveryOrders)} />
        <StatCard label="Charges collected" value={aud(report.taxCents + report.serviceChargeCents)} caption={`Tax ${aud(report.taxCents)} · service ${aud(report.serviceChargeCents)}`} />
        <StatCard label="Discounts given" value={aud(report.discountCents)} />
      </View>

      <Card title="Daily net revenue" style={{ marginTop: 14 }}>
        {report.daily.some((d) => d.revenueCents > 0) ? (
          <BarChart data={report.daily} />
        ) : (
          <EmptyState text="No revenue in this range yet." />
        )}
      </Card>

      <View style={styles.twoColumn}>
        <Card title="Top products">
          {report.topProducts.length ? (
            report.topProducts.slice(0, 6).map((product, i) => (
              <View key={product.name} style={styles.topRow}>
                <Text style={styles.topIndex}>{i + 1}</Text>
                <Text style={[styles.topName, { color: dark.text }]} numberOfLines={1}>{product.name}</Text>
                <Text style={styles.topMeta}>{product.quantity}× · {aud(product.revenueCents)}</Text>
              </View>
            ))
          ) : (
            <EmptyState text="No product sales in this range." />
          )}
        </Card>

        <Card title="Order status summary">
          <View style={styles.statusGrid}>
            {statusSummary.map(({ status, count }) => (
              <View key={status} style={styles.statusCell}>
                <Text style={[styles.statusCount, { color: count ? dark.text : dark.textDim }]}>{count}</Text>
                <Text style={styles.statusLabel}>{status.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </Card>
      </View>

      <Card title="Recent orders" style={{ marginTop: 14 }}>
        {recent.length ? (
          recent.map((order) => (
            <Pressable key={order.id} style={styles.recentRow} onPress={() => navigateToSection('orders')}>
              <Text style={[styles.recentNumber, { color: dark.text }]}>#{order.orderNumber.replace('VF-', '')}</Text>
              <Text style={styles.recentName} numberOfLines={1}>{order.customerName}</Text>
              <Pill
                label={order.status.toUpperCase()}
                tone={order.status === 'Cancelled' ? 'bad' : order.status === 'Completed' ? 'good' : 'info'}
              />
              <Text style={[styles.recentTotal, { color: dark.text }]}>{aud(Math.round(order.total * 100))}</Text>
            </Pressable>
          ))
        ) : (
          <EmptyState text="No orders yet." />
        )}
      </Card>

      {liveCount >= 6 ? (
        <View style={styles.alertBar}>
          <Text style={styles.alertText}>⚠ BUSY — {liveCount} live orders in progress</Text>
        </View>
      ) : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  rangeChip: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: dark.surface },
  rangeChipActive: { backgroundColor: dark.accent, borderColor: dark.accent },
  rangeText: { color: dark.textDim, fontWeight: '800', fontSize: 12, letterSpacing: 0.6 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  topIndex: { color: dark.accent, fontWeight: '900', fontSize: 15, width: 20 },
  topName: { flex: 1, fontSize: 15, fontWeight: '700' },
  topMeta: { color: dark.textDim, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statusCell: { flexBasis: '30%', alignItems: 'center', paddingVertical: 8, backgroundColor: dark.surfaceAlt, borderRadius: 10 },
  statusCount: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statusLabel: { color: dark.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: dark.border },
  recentNumber: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  recentName: { flex: 1, color: dark.textDim, fontSize: 14, fontWeight: '600' },
  recentTotal: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  alertBar: { backgroundColor: dark.warning, borderRadius: 12, padding: 12, marginTop: 14, alignItems: 'center' },
  alertText: { color: '#1A1405', fontWeight: '900', fontSize: 15 },
});
