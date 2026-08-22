// Customers — aggregated read-only view (order count, spend, last order)
// with per-customer order history. Privacy: derived entirely from the
// orders table under RLS; nothing extra is stored.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AdminPage, Card, EmptyState, Pill } from '../../components/admin/kit';
import { ModalSheet } from '../../components/admin/fields';
import { getCustomerSummaries } from '../../services/admin/misc';
import { fetchOrdersPage } from '../../services/admin/ordersAdmin';
import type { CustomerSummary } from '../../lib/adminTypes';
import { formatDateTime } from '../../lib/format';
import { aud } from '../../lib/money';
import { dark } from '../../theme';

export default function CustomersScreen(): React.ReactElement {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<CustomerSummary | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; orderNumber: string; total: number; status: string; createdAt: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCustomers(await getCustomerSummaries());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (customer: CustomerSummary) => {
    setDetail(customer);
    setHistoryLoading(true);
    setHistory([]);
    try {
      const page = await fetchOrdersPage(0, 50, customer.email || customer.phone || undefined);
      setHistory(
        page.orders
          .filter((o) => o.customerEmail.toLowerCase() === customer.email.toLowerCase() || o.customerPhone === customer.phone)
          .map((o) => ({ id: o.id, orderNumber: o.orderNumber, total: o.total, status: o.status, createdAt: o.createdAt })),
      );
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const visible = customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q);
  });

  return (
    <AdminPage
      title="Customers"
      subtitle={`${customers.length} customers (from orders)`}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
    >
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, email, phone…"
        placeholderTextColor={dark.textDim}
        style={styles.search}
      />
      {visible.slice(0, 100).map((customer) => (
        <Pressable key={customer.id} style={styles.row} onPress={() => void openDetail(customer)}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: dark.text }]} numberOfLines={1}>{customer.name || customer.email || 'Unknown'}</Text>
            <Text style={styles.meta} numberOfLines={1}>{customer.email || customer.phone || '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.spend, { color: dark.text }]}>{aud(Math.round(customer.spend * 100))}</Text>
            <Text style={styles.meta}>{customer.orders} orders · last {formatDateTime(customer.lastOrder)}</Text>
          </View>
        </Pressable>
      ))}
      {!visible.length && !loading ? <EmptyState text="No customers match." /> : null}

      <ModalSheet visible={detail !== null} title={detail?.name || detail?.email || 'Customer'} onClose={() => setDetail(null)}>
        {detail ? (
          <View>
            <Card title="Summary">
              <Text style={styles.meta}>{detail.email || '—'}</Text>
              <Text style={styles.meta}>{detail.phone || '—'}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Pill label={`${detail.orders} ORDERS`} tone="info" />
                <Pill label={`${aud(Math.round(detail.spend * 100))} SPENT`} tone="good" />
              </View>
            </Card>
            <Card title="Order history" style={{ marginTop: 10 }}>
              {historyLoading ? (
                <Text style={styles.meta}>Loading…</Text>
              ) : history.length ? (
                history.map((order) => (
                  <View key={order.id} style={styles.historyRow}>
                    <Text style={{ color: dark.text, fontWeight: '700' }}>#{order.orderNumber.replace('VF-', '')}</Text>
                    <Text style={styles.meta}>{order.status}</Text>
                    <Text style={styles.meta}>{formatDateTime(order.createdAt)}</Text>
                    <Text style={{ color: dark.text, fontWeight: '800' }}>{aud(Math.round(order.total * 100))}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.meta}>No orders found for this contact.</Text>
              )}
            </Card>
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: dark.surface, borderColor: dark.border, color: dark.text, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: dark.surface, borderRadius: 12, borderWidth: 1, borderColor: dark.border, padding: 12, marginTop: 8 },
  name: { fontSize: 16, fontWeight: '800' },
  meta: { color: dark.textDim, fontSize: 13, marginTop: 2 },
  spend: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  historyRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: dark.border, alignItems: 'center' },
});
