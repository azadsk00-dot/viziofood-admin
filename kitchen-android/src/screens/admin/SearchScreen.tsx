// Global search — one box across orders, products, customers, coupons and
// modifier groups; deep-links into the owning section.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AdminPage, Card, EmptyState, Pill } from '../../components/admin/kit';
import { fetchOrdersPage } from '../../services/admin/ordersAdmin';
import { getProducts } from '../../services/admin/products';
import { getCoupons } from '../../services/admin/coupons';
import { getModifierGroups } from '../../services/admin/modifiers';
import { navigateToSection } from '../../navigation/sectionNav';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';
import { formatDateTime } from '../../lib/format';
import { aud } from '../../lib/money';

interface Hit { key: string; section: 'orders' | 'products' | 'customers' | 'coupons' | 'modifiers'; title: string; meta: string }

export default function SearchScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = async () => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return;
    setBusy(true);
    setSearched(true);
    const found: Hit[] = [];
    try {
      const [orders, products, coupons, groups] = await Promise.all([
        fetchOrdersPage(0, 30, query.trim()).catch(() => ({ orders: [] })),
        getProducts().catch(() => []),
        getCoupons().catch(() => []),
        getModifierGroups().catch(() => []),
      ]);

      for (const order of orders.orders.slice(0, 10)) {
        found.push({
          key: `o-${order.id}`,
          section: 'orders',
          title: `#${order.orderNumber.replace('VF-', '')} — ${order.customerName || 'Customer'}`,
          meta: `${order.status} · ${aud(Math.round(order.total * 100))} · ${formatDateTime(order.createdAt)}`,
        });
      }
      for (const product of products.filter((p) => `${p.name} ${p.sku} ${p.tags.join(' ')}`.toLowerCase().includes(q)).slice(0, 10)) {
        found.push({
          key: `p-${product.id}`,
          section: 'products',
          title: product.name,
          meta: `${product.category} · ${aud(Math.round(product.price * 100))}${product.archived ? ' · archived' : ''}`,
        });
      }
      const seenCustomers = new Set<string>();
      for (const order of orders.orders) {
        const key = (order.customerEmail || order.customerPhone || '').toLowerCase();
        if (key && !seenCustomers.has(key) && `${order.customerName} ${key}`.toLowerCase().includes(q)) {
          seenCustomers.add(key);
          found.push({ key: `c-${key}`, section: 'customers', title: order.customerName || key, meta: `${order.customerPhone || order.customerEmail}` });
        }
      }
      for (const coupon of coupons.filter((c) => c.code.toLowerCase().includes(q)).slice(0, 10)) {
        found.push({
          key: `k-${coupon.id}`,
          section: 'coupons',
          title: coupon.code,
          meta: `${coupon.kind === 'percent' ? `${c(coupon.value)}%` : aud(Math.round(coupon.value * 100))} off · ${coupon.active ? 'active' : 'off'}`,
        });
      }
      for (const group of groups.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 10)) {
        found.push({ key: `m-${group.id}`, section: 'modifiers', title: group.name, meta: `modifier group · ${group.active ? 'active' : 'off'}` });
      }
    } finally {
      setHits(found);
      setBusy(false);
    }
    function c(n: number): string {
      return String(n);
    }
  };

  return (
    <AdminPage
      title="Search"
      subtitle="Orders, products, customers, coupons, modifiers"
      loading={busy}
      offlineBlocked={!online}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void runSearch()}
          placeholder="Search everything…"
          placeholderTextColor={dark.textDim}
          style={styles.search}
          returnKeyType="search"
        />
        <Pressable style={styles.goButton} onPress={() => void runSearch()}>
          <Text style={styles.goButtonText}>SEARCH</Text>
        </Pressable>
      </View>

      {hits.map((hit) => (
        <Pressable key={hit.key} style={styles.row} onPress={() => navigateToSection(hit.section)}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: dark.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{hit.title}</Text>
            <Text style={styles.meta} numberOfLines={1}>{hit.meta}</Text>
          </View>
          <Pill label={hit.section.toUpperCase()} tone="info" />
        </Pressable>
      ))}
      {searched && !hits.length && !busy ? <EmptyState text="Nothing found." /> : null}
      {!searched ? <EmptyState text="Type at least 2 characters and search." /> : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  search: { flex: 1, backgroundColor: dark.surface, borderColor: dark.border, color: dark.text, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  goButton: { backgroundColor: dark.accent, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  goButtonText: { color: dark.accentText, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: dark.surface, borderRadius: 12, borderWidth: 1, borderColor: dark.border, padding: 12, marginTop: 8 },
  meta: { color: dark.textDim, fontSize: 13, marginTop: 2 },
});
