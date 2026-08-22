// Products — full admin product management: search/filter, create/edit with
// image + gallery uploads (camera/gallery, compressed), attributes, modifier
// group assignment (ordered, full-replace), bulk activate/deactivate/archive/
// price/delete, duplicate. Deleting/archiving requires live connection.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AdminPage, Card, ConfirmDialog, EmptyState, Pill } from '../../components/admin/kit';
import { ModalSheet, NumberField, SelectField, TagsField, TextField, ToggleField, ImageField } from '../../components/admin/fields';
import {
  archiveProducts,
  createProduct,
  deleteProduct,
  duplicateProduct,
  getProducts,
  updateProduct,
  updateProducts,
  validateProduct,
} from '../../services/admin/products';
import { getModifierGroups, getProductModifierGroups, setProductModifierGroups } from '../../services/admin/modifiers';
import { getCategories } from '../../services/admin/categories';
import { deleteImageByUrl } from '../../services/admin/imageUpload';
import type { AdminProduct } from '../../lib/adminTypes';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';
import { aud } from '../../lib/money';

type StatusFilter = 'active' | 'inactive' | 'archived' | 'all';

/** Form draft — numeric fields as text; everything else mirrors AdminProduct. */
interface EditorDraft {
  name: string;
  description: string;
  price: string;
  category: string;
  sku: string;
  active: boolean;
  available: boolean;
  featured: boolean;
  popular: boolean;
  vegetarian: boolean;
  vegan: boolean;
  halal: boolean;
  glutenFree: boolean;
  preparationTime: string;
  calories: string;
  ingredients: string[];
  allergens: string[];
  tags: string[];
  displayOrder: string;
  imageUrl: string | null;
  gallery: string[];
  visibility: AdminProduct['visibility'];
  internalNotes: string;
  modifierGroupIds: string[];
}

function newDraft(): EditorDraft {
  return {
    name: '', description: '', price: '', category: '', sku: '', active: true, available: true,
    featured: false, popular: false, vegetarian: false, vegan: false, halal: false, glutenFree: false,
    preparationTime: '10', calories: '', ingredients: [], allergens: [], tags: [], displayOrder: '0',
    imageUrl: null, gallery: [], visibility: 'public', internalNotes: '', modifierGroupIds: [],
  };
}

function draftFromProduct(product: AdminProduct, modifierGroupIds: string[]): EditorDraft {
  return {
    name: product.name,
    description: product.description,
    price: String(product.price),
    category: product.category,
    sku: product.sku,
    active: product.active,
    available: product.available,
    featured: product.featured,
    popular: product.popular,
    vegetarian: product.vegetarian,
    vegan: product.vegan,
    halal: product.halal,
    glutenFree: product.glutenFree,
    preparationTime: String(product.preparationTime),
    calories: product.calories === null ? '' : String(product.calories),
    ingredients: product.ingredients,
    allergens: product.allergens,
    tags: product.tags,
    displayOrder: String(product.displayOrder),
    imageUrl: product.imageUrl,
    gallery: product.gallery,
    visibility: product.visibility,
    internalNotes: product.internalNotes,
    modifierGroupIds,
  };
}

export default function ProductsScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [modifierGroups, setModifierGroups] = useState<Array<{ id: string; name: string; active: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminProduct | null>(null);
  const [bulkPrice, setBulkPrice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [prods, cats, groups] = await Promise.all([getProducts(), getCategories(), getModifierGroups()]);
      setProducts(prods);
      setCategories(cats.map((c) => ({ id: c.id, name: c.name })));
      setModifierGroups(groups.map((g) => ({ id: g.id, name: g.name, active: g.active })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load products.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = products.filter((product) => {
    if (statusFilter === 'active' && (!product.active || product.archived)) return false;
    if (statusFilter === 'inactive' && (product.active || product.archived)) return false;
    if (statusFilter === 'archived' && !product.archived) return false;
    if (statusFilter !== 'archived' && statusFilter !== 'all' && product.archived) return false;
    if (statusFilter === 'all' && product.archived) return false;
    if (categoryFilter !== 'all' && product.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${product.name} ${product.sku} ${product.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const openEditor = async (product?: AdminProduct) => {
    setError('');
    setMessage('');
    if (product) {
      const assigned = await getProductModifierGroups(product.id);
      setDraftId(product.id);
      setDraft(draftFromProduct(product, assigned.map((a) => a.groupId)));
    } else {
      setDraftId(null);
      setDraft(newDraft());
    }
  };

  const save = async () => {
    if (!draft) return;
    const validation = validateProduct({
      name: draft.name,
      category: draft.category,
      price: Number(draft.price),
      preparationTime: Number(draft.preparationTime),
    });
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const normalized: Partial<AdminProduct> = {
        name: draft.name,
        description: draft.description,
        price: Number(draft.price),
        category: draft.category,
        sku: draft.sku,
        active: draft.active,
        available: draft.available,
        featured: draft.featured,
        popular: draft.popular,
        vegetarian: draft.vegetarian,
        vegan: draft.vegan,
        halal: draft.halal,
        glutenFree: draft.glutenFree,
        preparationTime: Number(draft.preparationTime),
        calories: draft.calories === '' ? null : Number(draft.calories),
        ingredients: draft.ingredients,
        allergens: draft.allergens,
        tags: draft.tags,
        displayOrder: Number(draft.displayOrder || 0),
        imageUrl: draft.imageUrl,
        gallery: draft.gallery,
        visibility: draft.visibility,
        internalNotes: draft.internalNotes,
      };
      if (draftId) {
        await updateProduct(draftId, normalized);
        await setProductModifierGroups(draftId, draft.modifierGroupIds);
      } else {
        // Create then assign groups (needs the new id).
        await createProduct(normalized);
        const fresh = await getProducts();
        const created = fresh.find((p) => p.name === normalized.name && !p.archived);
        if (created) await setProductModifierGroups(created.id, draft.modifierGroupIds);
      }
      setDraft(null);
      setMessage('Saved.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (action: 'activate' | 'deactivate' | 'archive' | 'restore' | 'price' | 'delete') => {
    if (!selected.length) return;
    if (!online && action !== 'activate' && action !== 'deactivate') {
      setError('This bulk action needs a live connection.');
      return;
    }
    setBusy(true);
    try {
      if (action === 'price') {
        const price = Number(bulkPrice);
        if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid price first.');
        await updateProducts(selected, { price });
      } else if (action === 'delete') {
        for (const id of selected) await deleteProduct(id);
      } else if (action === 'archive' || action === 'restore') {
        await archiveProducts(selected, action === 'archive');
      } else {
        await updateProducts(selected, { active: action === 'activate' });
      }
      setSelected([]);
      setBulkPrice('');
      setMessage(`Bulk ${action} done.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk action failed.');
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) => [styles.chip, active && styles.chipActive];

  return (
    <AdminPage
      title="Products"
      subtitle={`${visible.length} of ${products.length} products`}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
      actions={
        <Pressable style={styles.addButton} onPress={() => void openEditor()}>
          <Text style={styles.addButtonText}>+ NEW</Text>
        </Pressable>
      }
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, SKU, tags…"
        placeholderTextColor={dark.textDim}
        style={styles.search}
      />
      <View style={styles.filterRow}>
        {(['active', 'inactive', 'archived', 'all'] as StatusFilter[]).map((s) => (
          <Pressable key={s} onPress={() => setStatusFilter(s)} style={chip(statusFilter === s)}>
            <Text style={[styles.chipText, statusFilter === s && { color: dark.accentText }]}>{s.toUpperCase()}</Text>
          </Pressable>
        ))}
        <View style={{ width: 10 }} />
        <Pressable onPress={() => setCategoryFilter('all')} style={chip(categoryFilter === 'all')}>
          <Text style={[styles.chipText, categoryFilter === 'all' && { color: dark.accentText }]}>ALL CATEGORIES</Text>
        </Pressable>
        {categories.slice(0, 8).map((category) => (
          <Pressable key={category.id} onPress={() => setCategoryFilter(category.name)} style={chip(categoryFilter === category.name)}>
            <Text style={[styles.chipText, categoryFilter === category.name && { color: dark.accentText }]} numberOfLines={1}>
              {category.name.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {selected.length ? (
        <Card style={{ marginTop: 10 }} title={`${selected.length} selected`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable style={styles.miniButton} disabled={busy} onPress={() => void bulk('activate')}><Text style={styles.miniText}>ACTIVATE</Text></Pressable>
            <Pressable style={styles.miniButton} disabled={busy} onPress={() => void bulk('deactivate')}><Text style={styles.miniText}>DEACTIVATE</Text></Pressable>
            <Pressable style={styles.miniButton} disabled={busy} onPress={() => void bulk('archive')}><Text style={styles.miniText}>ARCHIVE</Text></Pressable>
            <Pressable style={styles.miniButton} disabled={busy} onPress={() => void bulk('restore')}><Text style={styles.miniText}>RESTORE</Text></Pressable>
            <Pressable
              style={[styles.miniButton, { borderColor: dark.danger }]}
              disabled={busy || !online}
              onPress={() => void bulk('delete')}
            >
              <Text style={[styles.miniText, { color: dark.danger }]}>DELETE</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                value={bulkPrice}
                onChangeText={setBulkPrice}
                keyboardType="numeric"
                placeholder="price"
                placeholderTextColor={dark.textDim}
                style={[styles.priceInput, { borderColor: dark.border, color: dark.text }]}
              />
              <Pressable style={styles.miniButton} disabled={busy || !online || !bulkPrice} onPress={() => void bulk('price')}>
                <Text style={styles.miniText}>SET PRICE</Text>
              </Pressable>
            </View>
            <Pressable style={styles.miniButton} onPress={() => setSelected([])}><Text style={styles.miniText}>CLEAR</Text></Pressable>
          </View>
        </Card>
      ) : null}

      {visible.map((product) => {
        const isSelected = selected.includes(product.id);
        return (
          <View key={product.id} style={[styles.row, isSelected && { borderColor: dark.accent }]}>
            <Pressable
              style={[styles.checkbox, isSelected && { backgroundColor: dark.accent, borderColor: dark.accent }]}
              onPress={() => setSelected((prev) => (isSelected ? prev.filter((id) => id !== product.id) : [...prev, product.id]))}
            >
              {isSelected ? <Text style={{ color: dark.accentText, fontWeight: '900' }}>✓</Text> : null}
            </Pressable>
            {product.imageUrl ? (
              <Image source={{ uri: product.imageUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: dark.surfaceAlt, borderWidth: 1, borderColor: dark.border }]} />
            )}
            <Pressable style={{ flex: 1 }} onPress={() => void openEditor(product)}>
              <Text style={[styles.rowTitle, { color: dark.text }]} numberOfLines={1}>{product.name}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {product.category} · {aud(Math.round(product.price * 100))} {product.sku ? `· ${product.sku}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {product.archived ? <Pill label="ARCHIVED" tone="bad" /> : product.active ? <Pill label="ACTIVE" tone="good" /> : <Pill label="INACTIVE" tone="warn" />}
                {product.available ? null : <Pill label="UNAVAILABLE" tone="warn" />}
                {product.featured ? <Pill label="FEATURED" tone="info" /> : null}
                {product.popular ? <Pill label="POPULAR" /> : null}
              </View>
            </Pressable>
            <Pressable style={styles.duplicate} onPress={() => void duplicateProduct(product).then(() => load())}>
              <Text style={styles.duplicateText}>COPY</Text>
            </Pressable>
          </View>
        );
      })}
      {!visible.length && !loading ? <EmptyState text="No products match." /> : null}

      <ConfirmDialog
        visible={confirmDelete !== null}
        title={`Delete ${confirmDelete?.name ?? ''}?`}
        message="This permanently removes the product. Consider archiving instead."
        danger
        confirmLabel="DELETE"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void deleteProduct(target.id).then(load);
        }}
      />

      {/* ── Editor ── */}
      <ModalSheet
        visible={draft !== null}
        title={draftId ? 'Edit product' : 'New product'}
        onClose={() => setDraft(null)}
        footer={
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable style={[styles.footerButton, { backgroundColor: dark.surfaceAlt }]} onPress={() => setDraft(null)}>
              <Text style={[styles.footerButtonText, { color: dark.text }]}>CANCEL</Text>
            </Pressable>
            <Pressable style={[styles.footerButton, { backgroundColor: dark.accent, opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void save()}>
              <Text style={[styles.footerButtonText, { color: dark.accentText }]}>SAVE</Text>
            </Pressable>
          </View>
        }
      >
        {draft ? (
          <View>
            <TextField label="Name" value={draft.name ?? ''} onChangeText={(name) => setDraft({ ...draft, name })} />
            <TextField label="Description" value={draft.description ?? ''} onChangeText={(description) => setDraft({ ...draft, description })} multiline />
            <TextField
              label="Category"
              value={draft.category ?? ''}
              onChangeText={(category) => setDraft({ ...draft, category })}
              hint={categories.length ? `Existing: ${categories.slice(0, 6).map((c) => c.name).join(', ')}` : 'Free text'}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><NumberField label="Price (AUD)" value={String(draft.price ?? '')} onChangeText={(price) => setDraft({ ...draft, price })} /></View>
              <View style={{ flex: 1 }}><NumberField label="Prep time (min)" value={String(draft.preparationTime ?? '')} onChangeText={(preparationTime) => setDraft({ ...draft, preparationTime })} /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><TextField label="SKU" value={draft.sku ?? ''} onChangeText={(sku) => setDraft({ ...draft, sku })} autoCapitalize="characters" /></View>
              <View style={{ flex: 1 }}><NumberField label="Display order" value={String(draft.displayOrder ?? '0')} onChangeText={(displayOrder) => setDraft({ ...draft, displayOrder })} /></View>
            </View>

            <ImageField
              label="Cover image"
              url={draft.imageUrl ?? null}
              folder="products"
              onPicked={(url) => setDraft({ ...draft, imageUrl: url })}
              onClear={() => setDraft({ ...draft, imageUrl: null })}
            />

            <Text style={styles.sectionLabel}>GALLERY</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(draft.gallery ?? []).map((url, i) => (
                <View key={url} style={{ width: 104 }}>
                  <Image source={{ uri: url }} style={styles.galleryImage} />
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                    {i > 0 ? (
                      <Pressable style={styles.galleryMini} onPress={() => {
                        const gallery = [...(draft.gallery ?? [])];
                        [gallery[i - 1], gallery[i]] = [gallery[i], gallery[i - 1]];
                        setDraft({ ...draft, gallery });
                      }}><Text style={styles.galleryMiniText}>◀</Text></Pressable>
                    ) : null}
                    <Pressable style={styles.galleryMini} onPress={() => setDraft({ ...draft, gallery: (draft.gallery ?? []).filter((_, j) => j !== i) })}>
                      <Text style={styles.galleryMiniText}>✕</Text>
                    </Pressable>
                    {i < (draft.gallery ?? []).length - 1 ? (
                      <Pressable style={styles.galleryMini} onPress={() => {
                        const gallery = [...(draft.gallery ?? [])];
                        [gallery[i + 1], gallery[i]] = [gallery[i], gallery[i + 1]];
                        setDraft({ ...draft, gallery });
                      }}><Text style={styles.galleryMiniText}>▶</Text></Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
              <Pressable
                style={[styles.galleryAdd, { borderColor: dark.info }]}
                onPress={() =>
                  void import('../../services/admin/imageUpload').then(async (m) => {
                    const result = await m.pickAndUploadImage('gallery', 'products');
                    if (result) setDraft((d) => (d ? { ...d, gallery: [...(d.gallery ?? []), result.url] } : d));
                  })
                }
              >
                <Text style={{ color: dark.info, fontWeight: '800' }}>+ ADD IMAGE</Text>
              </Pressable>
            </View>
            {draft.imageUrl ? (
              <Pressable onPress={() => setDraft({ ...draft, gallery: [...(draft.gallery ?? []), draft.imageUrl!], imageUrl: null })} style={{ marginTop: 6 }}>
                <Text style={{ color: dark.textDim, fontSize: 12 }}>Cover can be demoted into the gallery from the swap arrow once added.</Text>
              </Pressable>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}><NumberField label="Calories" value={String(draft.calories ?? '')} onChangeText={(calories) => setDraft({ ...draft, calories })} /></View>
              <View style={{ flex: 2 }}><TagsField label="Tags" value={draft.tags ?? []} onChange={(tags) => setDraft({ ...draft, tags })} /></View>
            </View>
            <TagsField label="Ingredients" value={draft.ingredients ?? []} onChange={(ingredients) => setDraft({ ...draft, ingredients })} />
            <TagsField label="Allergens" value={draft.allergens ?? []} onChange={(allergens) => setDraft({ ...draft, allergens })} />
            <TextField label="Internal notes (staff only)" value={draft.internalNotes ?? ''} onChangeText={(internalNotes) => setDraft({ ...draft, internalNotes })} multiline />

            <SelectField
              label="Visibility"
              value={draft.visibility ?? 'public'}
              onChange={(visibility) => setDraft({ ...draft, visibility })}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'hidden', label: 'Hidden' },
                { value: 'private', label: 'Private' },
              ]}
            />

            <Card title="Availability & attributes" style={{ marginTop: 6 }}>
              <ToggleField label="Active" value={draft.active ?? true} onChange={(active) => setDraft({ ...draft, active })} />
              <ToggleField label="Available" value={draft.available ?? true} onChange={(available) => setDraft({ ...draft, available })} />
              <ToggleField label="Featured" value={draft.featured ?? false} onChange={(featured) => setDraft({ ...draft, featured })} />
              <ToggleField label="Popular" value={draft.popular ?? false} onChange={(popular) => setDraft({ ...draft, popular })} />
              <ToggleField label="Vegetarian" value={draft.vegetarian ?? false} onChange={(vegetarian) => setDraft({ ...draft, vegetarian })} />
              <ToggleField label="Vegan" value={draft.vegan ?? false} onChange={(vegan) => setDraft({ ...draft, vegan })} />
              <ToggleField label="Halal" value={draft.halal ?? false} onChange={(halal) => setDraft({ ...draft, halal })} />
              <ToggleField label="Gluten-free" value={draft.glutenFree ?? false} onChange={(glutenFree) => setDraft({ ...draft, glutenFree })} />
            </Card>

            <Card title="Modifier groups" style={{ marginTop: 10 }}>
              <Text style={styles.hint}>Assigned groups show in this order on the menu.</Text>
              {(draft.modifierGroupIds ?? []).map((groupId, i) => {
                const group = modifierGroups.find((g) => g.id === groupId);
                return (
                  <View key={groupId} style={styles.assignedRow}>
                    <Text style={{ flex: 1, color: dark.text, fontWeight: '700' }}>{group?.name ?? groupId.slice(0, 8)}</Text>
                    {i > 0 ? (
                      <Pressable style={styles.galleryMini} onPress={() => {
                        const ids = [...draft.modifierGroupIds];
                        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                        setDraft({ ...draft, modifierGroupIds: ids });
                      }}><Text style={styles.galleryMiniText}>▲</Text></Pressable>
                    ) : null}
                    <Pressable style={styles.galleryMini} onPress={() => setDraft({ ...draft, modifierGroupIds: draft.modifierGroupIds.filter((id) => id !== groupId) })}>
                      <Text style={styles.galleryMiniText}>✕</Text>
                    </Pressable>
                  </View>
                );
              })}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {modifierGroups
                  .filter((g) => g.active && !(draft.modifierGroupIds ?? []).includes(g.id))
                  .map((group) => (
                    <Pressable
                      key={group.id}
                      style={styles.chip}
                      onPress={() => setDraft({ ...draft, modifierGroupIds: [...(draft.modifierGroupIds ?? []), group.id] })}
                    >
                      <Text style={styles.chipText}>+ {group.name}</Text>
                    </Pressable>
                  ))}
              </View>
            </Card>

            {draftId ? (
              <Pressable
                style={[styles.footerButton, { borderColor: dark.danger, borderWidth: 2, marginTop: 16 }]}
                disabled={busy || !online}
                onPress={() => {
                  const target = products.find((p) => p.id === draftId);
                  if (target) setConfirmDelete(target);
                }}
              >
                <Text style={[styles.footerButtonText, { color: dark.danger }]}>DELETE PRODUCT</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  addButton: { backgroundColor: dark.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: dark.accentText, fontWeight: '900', letterSpacing: 0.5 },
  search: { backgroundColor: dark.surface, borderColor: dark.border, color: dark.text, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: dark.surface },
  chipActive: { backgroundColor: dark.accent, borderColor: dark.accent },
  chipText: { color: dark.textDim, fontWeight: '800', fontSize: 12 },
  message: { color: dark.info, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: dark.surface, borderRadius: 12, borderWidth: 2, borderColor: dark.border, padding: 12, marginTop: 8 },
  checkbox: { width: 34, height: 34, borderRadius: 8, borderWidth: 2, borderColor: dark.border, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 54, height: 54, borderRadius: 10 },
  rowTitle: { fontSize: 16, fontWeight: '800' },
  rowMeta: { color: dark.textDim, fontSize: 13, marginTop: 2 },
  duplicate: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  duplicateText: { color: dark.textDim, fontWeight: '800', fontSize: 11 },
  miniButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  miniText: { color: dark.info, fontWeight: '800', fontSize: 12 },
  priceInput: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, width: 90, fontSize: 15 },
  sectionLabel: { color: dark.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  hint: { color: dark.textDim, fontSize: 12, marginBottom: 8 },
  galleryImage: { width: 104, height: 78, borderRadius: 8 },
  galleryMini: { borderWidth: 1, borderColor: dark.border, borderRadius: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: dark.surfaceAlt },
  galleryMiniText: { color: dark.text, fontSize: 12 },
  galleryAdd: { width: 104, height: 78, borderRadius: 8, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  assignedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: dark.border },
  footerButton: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  footerButtonText: { fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
});
