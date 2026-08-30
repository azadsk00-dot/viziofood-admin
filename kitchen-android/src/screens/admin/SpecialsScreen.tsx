// Specials — INDEPENDENT special-of-the-day management. A special owns its
// title/price/image/schedule; the optional product link never overwrites
// special fields. Live state = active + stock + date → time → day-of-week.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminPage, Card, ConfirmDialog, EmptyState, Pill } from '../../components/admin/kit';
import { DaysOfWeekField, ModalSheet, NumberField, SelectField, TagsField, TextField, ToggleField, ImageField } from '../../components/admin/fields';
import { deleteSpecial, duplicateSpecial, getSpecials, saveSpecial, validateSpecial } from '../../services/admin/specials';
import { getProducts } from '../../services/admin/products';
import { describeSchedule, discountPercent, specialState } from '../../lib/specialsLogic';
import type { AdminSpecial } from '../../lib/adminTypes';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';
import { aud } from '../../lib/money';

/** Form draft — numeric fields as text for smooth typing. */
interface Draft {
  title: string;
  description: string;
  imageUrl: string | null;
  price: string;
  originalPrice: string;
  active: boolean;
  archived: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  ctaText: string;
  ctaLink: string;
  dietary: string[];
  ingredients: string[];
  allergens: string[];
  badge: string;
  priority: string;
  displayLocation: AdminSpecial['displayLocation'];
  productId: string | null;
  stockQuantity: string;
}

function newDraft(): Draft {
  return {
    title: '', description: '', imageUrl: null, price: '', originalPrice: '', active: false, archived: false,
    startDate: '', endDate: '', startTime: '', endTime: '', daysOfWeek: [], ctaText: 'Order now', ctaLink: '/menu',
    dietary: [], ingredients: [], allergens: [], badge: 'Special', priority: '100', displayLocation: 'both',
    productId: null, stockQuantity: '',
  };
}

function draftFromSpecial(special: AdminSpecial): Draft {
  return {
    title: special.title,
    description: special.description,
    imageUrl: special.imageUrl,
    price: String(special.price),
    originalPrice: special.originalPrice === null ? '' : String(special.originalPrice),
    active: special.active,
    archived: special.archived,
    startDate: special.startDate ?? '',
    endDate: special.endDate ?? '',
    startTime: special.startTime ?? '',
    endTime: special.endTime ?? '',
    daysOfWeek: special.daysOfWeek,
    ctaText: special.ctaText,
    ctaLink: special.ctaLink,
    dietary: special.dietary,
    ingredients: special.ingredients,
    allergens: special.allergens,
    badge: special.badge,
    priority: String(special.priority),
    displayLocation: special.displayLocation,
    productId: special.productId,
    stockQuantity: special.stockQuantity === null ? '' : String(special.stockQuantity),
  };
}

export default function SpecialsScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [specials, setSpecials] = useState<AdminSpecial[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminSpecial | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, p] = await Promise.all([getSpecials(), getProducts().catch(() => [])]);
      setSpecials(s);
      setProducts(p.map((x) => ({ id: x.id, name: x.name })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load specials.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    const normalized: Partial<AdminSpecial> = {
      title: draft.title,
      description: draft.description,
      imageUrl: draft.imageUrl,
      price: Number(draft.price),
      originalPrice: draft.originalPrice === '' ? null : Number(draft.originalPrice),
      active: draft.active,
      archived: draft.archived,
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
      daysOfWeek: draft.daysOfWeek,
      ctaText: draft.ctaText,
      ctaLink: draft.ctaLink,
      dietary: draft.dietary,
      ingredients: draft.ingredients,
      allergens: draft.allergens,
      badge: draft.badge,
      priority: Number(draft.priority || 100),
      displayLocation: draft.displayLocation,
      productId: draft.productId || null,
      stockQuantity: draft.stockQuantity === '' ? null : Number(draft.stockQuantity),
    };
    const validation = validateSpecial(normalized);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    try {
      await saveSpecial({ ...normalized, id: draftId ?? undefined });
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const statePill = (special: AdminSpecial) => {
    const state = specialState(special);
    if (state === 'live') return <Pill label="LIVE NOW" tone="good" />;
    if (state === 'archived') return <Pill label="ARCHIVED" tone="bad" />;
    if (state === 'scheduled') return <Pill label="SCHEDULED" tone="info" />;
    return <Pill label="OFF" tone="warn" />;
  };

  const liveCount = specials.filter((s) => specialState(s) === 'live').length;

  return (
    <AdminPage
      title="Specials"
      subtitle={`${liveCount} live now · independent of products`}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
      actions={
        <Pressable style={styles.addButton} onPress={() => { setDraftId(null); setDraft(newDraft()); }}>
          <Text style={styles.addButtonText}>+ NEW</Text>
        </Pressable>
      }
    >
      {specials.map((special) => (
        <Card key={special.id} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {special.imageUrl ? (
              <Image source={{ uri: special.imageUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: dark.surfaceAlt, borderWidth: 1, borderColor: dark.border }]} />
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={[styles.title, { color: dark.text }]} numberOfLines={1}>{special.title}</Text>
                {statePill(special)}
              </View>
              <Text style={styles.meta}>{aud(Math.round(special.price * 100))}{special.originalPrice ? ` (was ${aud(Math.round(special.originalPrice * 100))}, −${discountPercent(special) ?? 0}%)` : ''}</Text>
              <Text style={styles.meta} numberOfLines={2}>{describeSchedule(special)}</Text>
              <Text style={styles.meta}>
                {special.displayLocation} · priority {special.priority}
                {special.stockQuantity !== null ? ` · stock ${special.stockQuantity}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <Pressable
                  style={styles.miniButton}
                  disabled={special.archived}
                  onPress={() => void saveSpecial({ id: special.id, active: !special.active }).then(load)}
                >
                  <Text style={styles.miniText}>{special.active ? 'DEACTIVATE' : 'ACTIVATE'}</Text>
                </Pressable>
                <Pressable
                  style={styles.miniButton}
                  onPress={() => {
                    setDraftId(special.id);
                    setDraft(draftFromSpecial(special));
                  }}
                >
                  <Text style={styles.miniText}>EDIT</Text>
                </Pressable>
                <Pressable style={styles.miniButton} onPress={() => void duplicateSpecial(special).then(load)}><Text style={styles.miniText}>COPY</Text></Pressable>
                <Pressable
                  style={styles.miniButton}
                  onPress={() => void saveSpecial({ id: special.id, archived: !special.archived }).then(load)}
                >
                  <Text style={styles.miniText}>{special.archived ? 'RESTORE' : 'ARCHIVE'}</Text>
                </Pressable>
                {!special.archived ? (
                  <Pressable style={[styles.miniButton, { borderColor: dark.danger }]} disabled={!online} onPress={() => setConfirmDelete(special)}>
                    <Text style={[styles.miniText, { color: dark.danger }]}>DELETE</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        </Card>
      ))}
      {!specials.length && !loading ? <EmptyState text="No specials yet." /> : null}
      <Text style={styles.hint}>Liveness: active → stock → date window → time window → days of week.</Text>

      <ConfirmDialog
        visible={confirmDelete !== null}
        title={`Delete special ${confirmDelete?.title ?? ''}?`}
        message="This cannot be undone."
        danger
        confirmLabel="DELETE"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void deleteSpecial(target.id).then(load);
        }}
      />

      <ModalSheet
        visible={draft !== null}
        title={draftId ? 'Edit special' : 'New special'}
        onClose={() => setDraft(null)}
        footer={
          <Pressable style={[styles.saveButton, { opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void save()}>
            <Text style={styles.saveButtonText}>SAVE</Text>
          </Pressable>
        }
      >
        {draft ? (
          <View>
            <TextField label="Title" value={draft.title ?? ''} onChangeText={(title) => setDraft({ ...draft, title })} />
            <TextField label="Description" value={draft.description ?? ''} onChangeText={(description) => setDraft({ ...draft, description })} multiline />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><NumberField label="Price (AUD)" value={String(draft.price ?? '')} onChangeText={(price) => setDraft({ ...draft, price })} /></View>
              <View style={{ flex: 1 }}><NumberField label="Original price" value={String(draft.originalPrice ?? '')} onChangeText={(originalPrice) => setDraft({ ...draft, originalPrice })} hint="Optional strike-through" /></View>
            </View>
            <TextField label="Badge" value={draft.badge ?? ''} onChangeText={(badge) => setDraft({ ...draft, badge })} hint="Defaults to 'Special'" />
            <ImageField
              label="Special image"
              url={draft.imageUrl ?? null}
              folder="products"
              onPicked={(url) => setDraft({ ...draft, imageUrl: url })}
              onClear={() => setDraft({ ...draft, imageUrl: null })}
            />

            <Card title="Schedule" style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><TextField label="Start date" value={draft.startDate ?? ''} onChangeText={(startDate) => setDraft({ ...draft, startDate })} placeholder="YYYY-MM-DD" /></View>
                <View style={{ flex: 1 }}><TextField label="End date" value={draft.endDate ?? ''} onChangeText={(endDate) => setDraft({ ...draft, endDate })} placeholder="YYYY-MM-DD" /></View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><TextField label="Start time" value={draft.startTime ?? ''} onChangeText={(startTime) => setDraft({ ...draft, startTime })} placeholder="HH:MM" /></View>
                <View style={{ flex: 1 }}><TextField label="End time" value={draft.endTime ?? ''} onChangeText={(endTime) => setDraft({ ...draft, endTime })} placeholder="HH:MM" /></View>
              </View>
              <DaysOfWeekField value={draft.daysOfWeek ?? []} onChange={(daysOfWeek) => setDraft({ ...draft, daysOfWeek })} />
            </Card>

            <Card title="Display & ordering" style={{ marginTop: 10 }}>
              <TextField label="CTA text" value={draft.ctaText ?? ''} onChangeText={(ctaText) => setDraft({ ...draft, ctaText })} />
              <TextField label="CTA link" value={draft.ctaLink ?? ''} onChangeText={(ctaLink) => setDraft({ ...draft, ctaLink })} />
              <SelectField
                label="Display location"
                value={draft.displayLocation ?? 'both'}
                onChange={(displayLocation) => setDraft({ ...draft, displayLocation })}
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'homepage', label: 'Homepage' },
                  { value: 'menu', label: 'Menu' },
                ]}
              />
              <NumberField label="Priority (lower shows first)" value={String(draft.priority ?? '100')} onChangeText={(priority) => setDraft({ ...draft, priority })} />
              <NumberField label="Daily stock (blank = unlimited)" value={String(draft.stockQuantity ?? '')} onChangeText={(stockQuantity) => setDraft({ ...draft, stockQuantity })} />
              <SelectField
                label="Linked product (optional — ordering uses its modifiers; special values stay independent)"
                value={draft.productId ?? ''}
                onChange={(productId) => setDraft({ ...draft, productId: productId || null })}
                options={[{ value: '', label: 'None' }, ...products.slice(0, 60).map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Card>

            <TagsField label="Dietary" value={draft.dietary ?? []} onChange={(dietary) => setDraft({ ...draft, dietary })} />
            <TagsField label="Ingredients" value={draft.ingredients ?? []} onChange={(ingredients) => setDraft({ ...draft, ingredients })} />
            <TagsField label="Allergens" value={draft.allergens ?? []} onChange={(allergens) => setDraft({ ...draft, allergens })} />
            <ToggleField label="Active" value={draft.active ?? false} onChange={(active) => setDraft({ ...draft, active })} />
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  addButton: { backgroundColor: dark.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: dark.accentText, fontWeight: '900' },
  thumb: { width: 76, height: 76, borderRadius: 10 },
  title: { fontSize: 17, fontWeight: '800', flexShrink: 1 },
  meta: { color: dark.textDim, fontSize: 13, marginTop: 2 },
  miniButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  miniText: { color: dark.info, fontWeight: '800', fontSize: 11 },
  hint: { color: dark.textDim, fontSize: 12, marginTop: 12 },
  saveButton: { backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: dark.accentText, fontWeight: '900', fontSize: 15 },
});
