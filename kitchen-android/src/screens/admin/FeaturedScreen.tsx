// Featured dishes — product flags (featured + featured_order), dense 1..n
// ordering, publishable eligibility = active + available + !archived + public.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AdminPage, Card, EmptyState, Pill } from '../../components/admin/kit';
import { getProducts, updateProduct } from '../../services/admin/products';
import type { AdminProduct } from '../../lib/adminTypes';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';
import { aud } from '../../lib/money';

function publishable(product: AdminProduct): boolean {
  return product.active && product.available && !product.archived && product.visibility === 'public';
}

export default function FeaturedScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProducts(await getProducts());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load products.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const featured = useMemo(
    () =>
      products
        .filter((p) => p.featured && publishable(p))
        .sort((a, b) => (a.featuredOrder ?? 0) - (b.featuredOrder ?? 0) || a.name.localeCompare(b.name)),
    [products],
  );

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => !p.featured && publishable(p))
      .filter((p) => !q || `${p.name} ${p.category} ${p.sku}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [products, search]);

  const add = async (product: AdminProduct) => {
    await updateProduct(product.id, { featured: true, featuredOrder: featured.length + 1 });
    setMessage(`${product.name} added to the homepage.`);
    await load();
  };

  const remove = async (product: AdminProduct) => {
    await updateProduct(product.id, { featured: false, featuredOrder: 0 });
    await rewriteOrder(featured.filter((p) => p.id !== product.id));
    setMessage(`${product.name} removed.`);
    await load();
  };

  const move = async (index: number, delta: -1 | 1) => {
    const next = [...featured];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await rewriteOrder(next);
    await load();
  };

  const rewriteOrder = async (ordered: AdminProduct[]) => {
    await Promise.all(ordered.map((p, i) => updateProduct(p.id, { featuredOrder: i + 1 })));
  };

  return (
    <AdminPage
      title="Featured dishes"
      subtitle={`${featured.length} on the homepage (max 6 shown publicly)`}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Card title="On the homepage">
        {featured.map((product, index) => (
          <View key={product.id} style={styles.row}>
            <Text style={styles.index}>{index + 1}</Text>
            {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: dark.surfaceAlt }]} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: dark.text }]} numberOfLines={1}>{product.name}</Text>
              <Text style={styles.meta}>{product.category} · {aud(Math.round(product.price * 100))}</Text>
            </View>
            <Pressable style={styles.miniButton} onPress={() => void move(index, -1)}><Text style={styles.miniText}>▲</Text></Pressable>
            <Pressable style={styles.miniButton} onPress={() => void move(index, 1)}><Text style={styles.miniText}>▼</Text></Pressable>
            <Pressable style={[styles.miniButton, { borderColor: dark.danger }]} disabled={!online} onPress={() => void remove(product)}>
              <Text style={[styles.miniText, { color: dark.danger }]}>REMOVE</Text>
            </Pressable>
          </View>
        ))}
        {!featured.length ? <EmptyState text="No featured dishes yet." /> : null}
        <Text style={styles.hint}>Preview: the public homepage shows these in this order (first 6), updating live.</Text>
      </Card>

      <Card title="Add a dish" style={{ marginTop: 12 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search publishable products…"
          placeholderTextColor={dark.textDim}
          style={styles.search}
        />
        {candidates.map((product) => (
          <View key={product.id} style={styles.row}>
            {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: dark.surfaceAlt }]} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: dark.text }]} numberOfLines={1}>{product.name}</Text>
              <Text style={styles.meta}>{product.category} · {aud(Math.round(product.price * 100))}</Text>
            </View>
            <Pressable style={[styles.miniButton, { borderColor: dark.success }]} disabled={!online} onPress={() => void add(product)}>
              <Text style={[styles.miniText, { color: dark.success }]}>ADD</Text>
            </Pressable>
          </View>
        ))}
        {!candidates.length ? <EmptyState text="No publishable products match (must be active, available, public, not archived)." /> : null}
        <Pill label="PUBLISHABLE = ACTIVE + AVAILABLE + PUBLIC" />
      </Card>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  message: { color: dark.info, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: dark.border },
  index: { color: dark.accent, fontWeight: '900', fontSize: 16, width: 22 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  name: { fontSize: 15, fontWeight: '800' },
  meta: { color: dark.textDim, fontSize: 13 },
  miniButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  miniText: { color: dark.info, fontWeight: '800', fontSize: 12 },
  search: { backgroundColor: dark.surfaceAlt, borderColor: dark.border, color: dark.text, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, marginBottom: 8 },
  hint: { color: dark.textDim, fontSize: 12, marginTop: 10 },
});
