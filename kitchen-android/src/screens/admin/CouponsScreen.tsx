// Coupons — complete coupon management (percent/fixed, minimum order, usage
// limits, windows, category restrictions). Validation mirrors the web's zod
// contract; RLS remains authoritative.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminPage, Card, ConfirmDialog, EmptyState, Pill } from '../../components/admin/kit';
import { ModalSheet, NumberField, SelectField, TagsField, TextField, ToggleField } from '../../components/admin/fields';
import { deleteCoupon, getCoupons, saveCoupon, validateCoupon } from '../../services/admin/coupons';
import type { AdminCoupon } from '../../lib/adminTypes';
import { couponDiscountCents, isCouponUsable } from '../../lib/couponLogic';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';
import { aud } from '../../lib/money';

import type { CouponKind } from '../../lib/adminTypes';

/** Form draft — numeric fields as text for smooth typing. */
interface Draft {
  code: string;
  kind: CouponKind;
  value: string;
  minimumOrder: string;
  categoryNames: string[];
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  active: boolean;
}

function newDraft(): Draft {
  return { code: '', kind: 'percent', value: '', minimumOrder: '0', categoryNames: [], startsAt: '', endsAt: '', usageLimit: '', active: true };
}

function draftFromCoupon(coupon: AdminCoupon): Draft {
  return {
    code: coupon.code,
    kind: coupon.kind,
    value: String(coupon.value),
    minimumOrder: String(coupon.minimumOrder),
    categoryNames: coupon.categoryNames,
    startsAt: coupon.startsAt ?? '',
    endsAt: coupon.endsAt ?? '',
    usageLimit: coupon.usageLimit === null ? '' : String(coupon.usageLimit),
    active: coupon.active,
  };
}

export default function CouponsScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminCoupon | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCoupons(await getCoupons());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load coupons.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    const normalized: Partial<AdminCoupon> = {
      code: draft.code.toUpperCase(),
      kind: draft.kind,
      value: Number(draft.value),
      minimumOrder: Number(draft.minimumOrder || 0),
      categoryNames: draft.categoryNames,
      usageLimit: draft.usageLimit === '' ? null : Number(draft.usageLimit),
      startsAt: draft.startsAt || null,
      endsAt: draft.endsAt || null,
      active: draft.active,
    };
    const validation = validateCoupon(normalized);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    try {
      await saveCoupon({ ...normalized, id: draftId ?? undefined });
      setDraft(null);
      setMessage('Coupon saved.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage
      title="Coupons"
      subtitle={`${coupons.filter((c) => c.active).length} active`}
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
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {coupons.map((coupon) => {
        const previewBasis = 5000; // $50 preview basket
        const usable = isCouponUsable(coupon, previewBasis);
        return (
          <Card key={coupon.id} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[styles.code, { color: dark.text }]}>{coupon.code}</Text>
              <Pill label={coupon.kind === 'percent' ? `${coupon.value}% OFF` : `${aud(Math.round(coupon.value * 100))} OFF`} tone="info" />
              <Pill label={coupon.active ? 'ACTIVE' : 'OFF'} tone={coupon.active ? 'good' : 'warn'} />
              <View style={{ flex: 1 }} />
              <Pressable style={styles.miniButton} onPress={() => void saveCoupon({ id: coupon.id, active: !coupon.active }).then(load)}>
                <Text style={styles.miniText}>{coupon.active ? 'DEACTIVATE' : 'ACTIVATE'}</Text>
              </Pressable>
              <Pressable
                style={styles.miniButton}
                onPress={() => {
                  setDraftId(coupon.id);
                  setDraft(draftFromCoupon(coupon));
                }}
              >
                <Text style={styles.miniText}>EDIT</Text>
              </Pressable>
              <Pressable style={[styles.miniButton, { borderColor: dark.danger }]} disabled={!online} onPress={() => setConfirmDelete(coupon)}>
                <Text style={[styles.miniText, { color: dark.danger }]}>DELETE</Text>
              </Pressable>
            </View>
            <Text style={styles.meta}>
              Min order {aud(Math.round(coupon.minimumOrder * 100))} · used {coupon.timesUsed}
              {coupon.usageLimit !== null ? ` / ${coupon.usageLimit}` : ' (unlimited)'}
              {coupon.startsAt || coupon.endsAt ? ` · ${coupon.startsAt?.slice(0, 10) ?? '…'} → ${coupon.endsAt?.slice(0, 10) ?? '…'}` : ' · always'}
              {coupon.categoryNames.length ? ` · categories: ${coupon.categoryNames.join(', ')}` : ''}
            </Text>
            <Text style={[styles.meta, { color: usable ? dark.success : dark.textDim }]}>
              {usable
                ? `Preview: ${aud(couponDiscountCents(coupon, [], previewBasis))} off a ${aud(previewBasis)} basket`
                : 'Not currently usable (window, limit, minimum or inactive)'}
            </Text>
          </Card>
        );
      })}
      {!coupons.length && !loading ? <EmptyState text="No coupons yet." /> : null}

      <ConfirmDialog
        visible={confirmDelete !== null}
        title={`Delete coupon ${confirmDelete?.code ?? ''}?`}
        message="This cannot be undone."
        danger
        confirmLabel="DELETE"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void deleteCoupon(target.id).then(load);
        }}
      />

      <ModalSheet
        visible={draft !== null}
        title={draftId ? `Edit ${draft?.code ?? ''}` : 'New coupon'}
        onClose={() => setDraft(null)}
        footer={
          <Pressable style={[styles.saveButton, { opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void save()}>
            <Text style={styles.saveButtonText}>SAVE</Text>
          </Pressable>
        }
      >
        {draft ? (
          <View>
            <TextField label="Code" value={draft.code} onChangeText={(code) => setDraft({ ...draft, code: code.toUpperCase() })} autoCapitalize="characters" hint="3–40 chars, letters/numbers/dashes" />
            <SelectField
              label="Kind"
              value={draft.kind}
              onChange={(kind) => setDraft({ ...draft, kind })}
              options={[{ value: 'percent', label: 'Percentage' }, { value: 'fixed', label: 'Fixed amount' }]}
            />
            <NumberField
              label={draft.kind === 'fixed' ? 'Amount (AUD)' : 'Percent (0–100)'}
              value={draft.value}
              onChangeText={(value) => setDraft({ ...draft, value })}
            />
            <NumberField label="Minimum order (AUD, 0 = none)" value={draft.minimumOrder} onChangeText={(minimumOrder) => setDraft({ ...draft, minimumOrder })} />
            <NumberField label="Usage limit (blank = unlimited)" value={draft.usageLimit} onChangeText={(usageLimit) => setDraft({ ...draft, usageLimit })} />
            <TextField label="Starts (YYYY-MM-DD HH:MM, optional)" value={draft.startsAt} onChangeText={(startsAt) => setDraft({ ...draft, startsAt })} placeholder="2026-01-01 00:00" />
            <TextField label="Ends (YYYY-MM-DD HH:MM, optional)" value={draft.endsAt} onChangeText={(endsAt) => setDraft({ ...draft, endsAt })} placeholder="2026-12-31 23:59" />
            <TagsField label="Category restrictions" value={draft.categoryNames} onChange={(categoryNames) => setDraft({ ...draft, categoryNames })} hint="Empty = whole order" />
            <ToggleField label="Active" value={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  addButton: { backgroundColor: dark.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: dark.accentText, fontWeight: '900' },
  message: { color: dark.info, fontWeight: '700', marginBottom: 8 },
  code: { fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  meta: { color: dark.textDim, fontSize: 13, marginTop: 6 },
  miniButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  miniText: { color: dark.info, fontWeight: '800', fontSize: 11 },
  saveButton: { backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: dark.accentText, fontWeight: '900', fontSize: 15 },
});
