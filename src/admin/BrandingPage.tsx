/**
 * Branding admin — logo upload with live header preview. The saved logo is
 * the settings-driven source of truth for the public site header/footer
 * (realtime: appears without a redeploy).
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Image as ImageIcon, Save, Trash2, Upload } from 'lucide-react';
import { deleteProductImage, getSettings, saveSettings, uploadBrandImage } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import { Button, Card, Skeleton } from '../ui';

export function BrandingPage() {
  const resource = useResource(getSettings);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLogoUrl(resource.data?.logoUrl ?? null);
  }, [resource.data]);

  const handleImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadBrandImage(file, 'logo');
      setLogoUrl(url);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Logo upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const previous = resource.data?.logoUrl ?? null;
      await saveSettings({ logoUrl });
      if (logoUrl !== previous && previous) await deleteProductImage(previous).catch(() => undefined);
      toast.show('Branding saved.');
      void resource.reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not save branding.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Branding</h1>
          <p className="admin-head__sub">The site logo — live on the public header and footer the moment you save.</p>
        </div>
        <Button onClick={() => void handleSave()} disabled={saving || uploading}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {resource.loading ? (
        <Skeleton height={220} />
      ) : resource.error ? (
        <p className="vz-error-box">{resource.error}</p>
      ) : (
        <Card pad>
          <div className="vz-row" style={{ gap: 8, marginBottom: 16 }}>
            <ImageIcon size={18} color="var(--terracotta)" />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Website logo</h2>
          </div>

          <div style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 20px',
            background: 'var(--cream)',
            marginBottom: 18,
          }} aria-label="Logo preview">
            {logoUrl
              ? <img src={logoUrl} alt="Website logo preview" style={{ height: 46, width: 'auto' }} />
              : <span className="site-logo__word" style={{ fontSize: '1.35rem' }}>Vizio Food</span>}
            <p className="vz-muted" style={{ fontSize: '0.82rem', marginTop: 10, marginBottom: 0 }}>
              Preview of the site header. Until you upload and save a logo, the text logo stays in place.
            </p>
          </div>

          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void handleImage(event)} />
          <div className="vz-row">
            <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
              <Upload size={15} /> {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
            </Button>
            {logoUrl && (
              <Button variant="ghost" onClick={() => setLogoUrl(null)} disabled={uploading}>
                <Trash2 size={15} /> Use text logo
              </Button>
            )}
          </div>

          <p className="vz-muted" style={{ fontSize: '0.84rem', marginTop: 14, marginBottom: 0 }}>
            PNG, JPEG or WebP up to 8 MB (large images are compressed automatically).
          </p>
        </Card>
      )}
    </>
  );
}
