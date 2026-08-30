// Branding — logo upload (camera/gallery, compressed) into the shared
// product-images/branding storage folder, saved to restaurant_settings and
// propagated to the public site via realtime. Supports a text-logo fallback.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { AdminPage, Card, Pill } from '../../components/admin/kit';
import { ImageField } from '../../components/admin/fields';
import { getRestaurantSettings, saveRestaurantSettings } from '../../services/admin/settings';
import { deleteImageByUrl } from '../../services/admin/imageUpload';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';

export default function BrandingScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const previousRef = React.useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const settings = await getRestaurantSettings();
      setLogoUrl(settings?.logoUrl ?? null);
      previousRef.current = settings?.logoUrl ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load branding.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (nextUrl: string | null) => {
    setBusy(true);
    setError('');
    try {
      await saveRestaurantSettings({ logoUrl: nextUrl });
      const previous = previousRef.current;
      if (previous && previous !== nextUrl) await deleteImageByUrl(previous);
      previousRef.current = nextUrl;
      setLogoUrl(nextUrl);
      setMessage(nextUrl ? 'Logo saved — the website updates live.' : 'Switched to text logo.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage
      title="Branding"
      subtitle="Logo used across the public site"
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
    >
      {message ? <Text style={{ color: dark.info, fontWeight: '700', marginBottom: 8 }}>{message}</Text> : null}

      <Card title="Live preview">
        <View style={{ alignItems: 'center', paddingVertical: 18, backgroundColor: '#0B0E13', borderRadius: 12 }}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={{ width: 220, height: 80 }} resizeMode="contain" />
          ) : (
            <Text style={{ color: '#E7C54A', fontSize: 30, fontWeight: '900', letterSpacing: 3 }}>VIZIO FOOD</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pill label={logoUrl ? 'IMAGE LOGO' : 'TEXT LOGO'} tone="info" />
        </View>
      </Card>

      <Card title="Upload" style={{ marginTop: 12 }}>
        <ImageField
          label="Logo"
          url={logoUrl}
          folder="branding"
          hint="Compressed to max 1920px JPEG before upload"
          onPicked={(url) => void save(url)}
          onClear={() => void save(null)}
        />
        {busy ? <Text style={{ color: dark.info, fontWeight: '700', marginTop: 8 }}>Saving…</Text> : null}
      </Card>

      <Text style={{ color: dark.textDim, fontSize: 12, marginTop: 10 }}>
        Brand assets live in the shared `product-images` storage bucket under branding/. The previous logo object is
        deleted after a successful swap.
      </Text>
    </AdminPage>
  );
}
