// Reports — revenue/volume/AOV/product/category/refund/fee metrics over
// selectable date ranges with server-bounded fetch (not a 24h slice),
// plus CSV export via the share sheet.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { AdminPage, BarChart, Card, EmptyState, StatCard } from '../../components/admin/kit';
import { TextField } from '../../components/admin/fields';
import { attachOrderItems, fetchOrdersPage } from '../../services/admin/ordersAdmin';
import { csvFileName, reportCsv } from '../../lib/csv';
import { RANGE_LABELS, RangePreset, buildReport, windowFor } from '../../lib/reports';
import type { AdminOrder } from '../../lib/adminTypes';
import { aud } from '../../lib/money';
import { dark } from '../../theme';

type ReportRange = '7' | '30' | '90' | 'custom';

export default function ReportsScreen(): React.ReactElement {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<ReportRange>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch enough history for the largest standard window; the window
      // filter itself is applied exactly in lib/reports.
      const page = await fetchOrdersPage(0, 500);
      await attachOrderItems(page.orders);
      setOrders(page.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preset: RangePreset = range === 'custom' ? 'custom' : range === '7' ? 'week7' : range === '30' ? 'month30' : 'month';
  const window = windowFor(preset, Date.now(), { from: customFrom, to: customTo });
  const report = buildReport(orders, window);

  const exportCsv = async () => {
    await Share.share({ title: 'Vizio report', message: reportCsv(report.scoped) });
  };

  // Category performance derived from item → product-name prefix matching is
  // not reliable; report per-product (authoritative) and note the limitation.
  return (
    <AdminPage
      title="Reports"
      subtitle={`${RANGE_LABELS[preset]} · ${report.paidOrders} paid orders`}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      actions={
        <Pressable style={styles.exportButton} onPress={() => void exportCsv()}>
          <Text style={styles.exportText}>EXPORT CSV</Text>
        </Pressable>
      }
    >
      <View style={styles.rangeRow}>
        {(['7', '30', '90', 'custom'] as ReportRange[]).map((r) => (
          <Pressable key={r} onPress={() => setRange(r)} style={[styles.chip, range === r && styles.chipActive]}>
            <Text style={[styles.chipText, range === r && { color: dark.accentText }]}>
              {r === 'custom' ? 'CUSTOM' : `${r} DAYS`}
            </Text>
          </Pressable>
        ))}
      </View>
      {range === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><TextField label="From (YYYY-MM-DD)" value={customFrom} onChangeText={setCustomFrom} placeholder="2026-08-01" /></View>
          <View style={{ flex: 1 }}><TextField label="To (YYYY-MM-DD)" value={customTo} onChangeText={setCustomTo} placeholder="2026-08-31" /></View>
        </View>
      ) : null}

      <View style={styles.statGrid}>
        <StatCard label="Net revenue" value={aud(report.netRevenueCents)} tone="good" caption={`Refunded ${aud(report.refundedCents)}`} />
        <StatCard label="Paid orders" value={String(report.paidOrders)} caption={`${report.cancelledOrders} cancelled`} />
        <StatCard label="Average order" value={aud(report.averageOrderCents)} />
        <StatCard label="Discounts" value={aud(report.discountCents)} />
        <StatCard label="Tax collected" value={aud(report.taxCents)} />
        <StatCard label="Service charge" value={aud(report.serviceChargeCents)} />
        <StatCard label="Card fees" value={aud(report.cardFeeCents)} />
        <StatCard label="Delivery fees" value={aud(report.deliveryFeeCents)} caption={`${report.pickupOrders} pickup · ${report.deliveryOrders} delivery`} />
      </View>

      <Card title="Daily net revenue" style={{ marginTop: 14 }}>
        {report.daily.some((d) => d.revenueCents > 0) ? <BarChart data={report.daily} /> : <EmptyState text="No revenue in this range." />}
      </Card>

      <Card title="Product performance (top 10 by revenue)" style={{ marginTop: 14 }}>
        {report.topProducts.length ? (
          report.topProducts.map((product, i) => (
            <View key={product.name} style={styles.topRow}>
              <Text style={styles.topIndex}>{i + 1}</Text>
              <Text style={{ flex: 1, color: dark.text, fontWeight: '700' }} numberOfLines={1}>{product.name}</Text>
              <Text style={styles.topMeta}>{product.quantity}×</Text>
              <Text style={[styles.topMeta, { color: dark.text }]}>{aud(product.revenueCents)}</Text>
            </View>
          ))
        ) : (
          <EmptyState text="No product sales in this range." />
        )}
      </Card>

      <Text style={styles.hint}>
        Metrics aggregate paid orders (refunded/partially refunded included, cancelled excluded) from the database —
        the same contract the web uses, with correct local-midnight day bucketing. Category performance is derivable
        from Products × these product rows.
      </Text>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  chip: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: dark.surface },
  chipActive: { backgroundColor: dark.accent, borderColor: dark.accent },
  chipText: { color: dark.textDim, fontWeight: '800', fontSize: 12 },
  exportButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  exportText: { color: dark.info, fontWeight: '800', fontSize: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: dark.border },
  topIndex: { color: dark.accent, fontWeight: '900', width: 20 },
  topMeta: { color: dark.textDim, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { color: dark.textDim, fontSize: 12, marginTop: 12, lineHeight: 18 },
});
