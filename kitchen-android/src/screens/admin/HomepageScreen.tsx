// Homepage promo content — full editor for the legacy homepage_content row
// (the web has the service layer but no editor; the public site renders it
// as fallback with realtime). Saves are audit-logged.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { AdminPage, Card, Pill } from '../../components/admin/kit';
import { ImageField, ModalSheet, NumberField, SelectField, TextField, ToggleField } from '../../components/admin/fields';
import { getHomepageContent, saveHomepageContent } from '../../services/admin/misc';
import type { HomepageContent } from '../../lib/adminTypes';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';

export default function HomepageScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [content, setContent] = useState<HomepageContent | null>(null);
  const [draft, setDraft] = useState<HomepageContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setContent(await getHomepageContent());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load homepage content.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      await saveHomepageContent(draft);
      setMessage('Saved — the public homepage updates via realtime.');
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage
      title="Homepage promo"
      subtitle="Promo banner shown on the public homepage"
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
      actions={
        <Text onPress={() => setDraft(content ?? emptyContent())} style={{ color: dark.accent, fontWeight: '900' }}>
          EDIT
        </Text>
      }
    >
      {message ? <Text style={{ color: dark.info, fontWeight: '700', marginBottom: 8 }}>{message}</Text> : null}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pill label={content?.enabled ? 'ENABLED' : 'DISABLED'} tone={content?.enabled ? 'good' : 'warn'} />
          <Pill label={(content?.promoType ?? 'daily').toUpperCase()} tone="info" />
        </View>
        <Text style={{ color: dark.text, fontSize: 20, fontWeight: '900', marginTop: 12 }}>{content?.title || 'No promo configured'}</Text>
        {content?.description ? <Text style={{ color: dark.textDim, marginTop: 4 }}>{content.description}</Text> : null}
        {content?.price !== null && content?.price !== undefined ? (
          <Text style={{ color: dark.accent, fontWeight: '900', marginTop: 4 }}>${content.price.toFixed(2)}</Text>
        ) : null}
        {content?.imageUrl ? <Image source={{ uri: content.imageUrl }} style={{ width: '100%', height: 160, borderRadius: 12, marginTop: 10 }} resizeMode="cover" /> : null}
        <Text style={{ color: dark.textDim, marginTop: 10, fontSize: 13 }}>
          Button: “{content?.buttonText || '—'}” → {content?.buttonLink || '—'} · Window: {content?.startDate ?? '…'} → {content?.endDate ?? '…'}
        </Text>
      </Card>
      <Text style={{ color: dark.textDim, fontSize: 12, marginTop: 10 }}>
        Specials are the modern homepage feature; this promo renders as the fallback. Changes propagate to the website through Supabase realtime.
      </Text>

      <ModalSheet
        visible={draft !== null}
        title="Edit homepage promo"
        onClose={() => setDraft(null)}
        footer={
          <Text onPress={() => void save()} style={{ textAlign: 'center', color: dark.accentText, backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 14, fontWeight: '900', overflow: 'hidden', opacity: busy ? 0.5 : 1 }}>
            SAVE
          </Text>
        }
      >
        {draft ? (
          <View>
            <ToggleField label="Enabled" value={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} hint="Enabling requires a title" />
            <SelectField
              label="Promo type"
              value={draft.promoType}
              onChange={(promoType) => setDraft({ ...draft, promoType })}
              options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]}
            />
            <TextField label="Title" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
            <TextField label="Description" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} multiline />
            <NumberField label="Price (AUD, optional)" value={draft.price === null ? '' : String(draft.price)} onChangeText={(price) => setDraft({ ...draft, price: price === '' ? null : Number(price) })} />
            <ImageField
              label="Promo image"
              url={draft.imageUrl}
              folder="branding"
              onPicked={(url) => setDraft({ ...draft, imageUrl: url })}
              onClear={() => setDraft({ ...draft, imageUrl: null })}
            />
            <TextField label="Button text" value={draft.buttonText} onChangeText={(buttonText) => setDraft({ ...draft, buttonText })} />
            <TextField label="Button link" value={draft.buttonLink} onChangeText={(buttonLink) => setDraft({ ...draft, buttonLink })} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><TextField label="Start date" value={draft.startDate ?? ''} onChangeText={(startDate) => setDraft({ ...draft, startDate })} placeholder="YYYY-MM-DD" /></View>
              <View style={{ flex: 1 }}><TextField label="End date" value={draft.endDate ?? ''} onChangeText={(endDate) => setDraft({ ...draft, endDate })} placeholder="YYYY-MM-DD" /></View>
            </View>
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

function emptyContent(): HomepageContent {
  return {
    id: '', enabled: false, promoType: 'daily', title: '', description: '', price: null,
    imageUrl: null, buttonText: 'Order now', buttonLink: '/menu', startDate: null, endDate: null,
  };
}
