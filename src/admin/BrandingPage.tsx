import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Image as ImageIcon, Save, Trash2, Upload } from 'lucide-react';
import { PageTitle } from './components';
import { deleteProductImage, getSettings, saveSettings, uploadBrandImage } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';

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

  const useTextLogo = () => setLogoUrl(null);

  if (resource.loading) return <section className="admin-page"><PageTitle title="Website Branding" /><p className="admin-message">Loading…</p></section>;
  if (resource.error) return <section className="admin-page"><PageTitle title="Website Branding" /><p className="admin-message error">{resource.error}</p></section>;

  return (
    <section className="admin-page">
      <PageTitle title="Website Branding">
        <button className="admin-primary" onClick={() => void handleSave()} disabled={saving || uploading}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </PageTitle>

      <section className="admin-card settings-section">
        <div className="settings-section-header">
          <ImageIcon size={18} />
          <h2>Website Logo</h2>
        </div>

        <div className="admin-form">
          <div className="branding-preview" aria-label="Logo preview">
            <header className="branding-preview-nav">
              {logoUrl
                ? <img src={logoUrl} alt="Website logo preview" className="brand-logo" />
                : <span className="brand">VIZIO <i>FOOD</i></span>}
            </header>
            <p className="settings-hint">Preview of the site header. Until you upload and save a logo, the current text logo stays in place.</p>
          </div>

          <div className="settings-field">
            <span>Logo image</span>
            <div className="image-field">
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => void handleImage(event)} />
              <button className="admin-primary outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Upload size={15} /> {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              {logoUrl && <button className="admin-primary outline" onClick={useTextLogo} disabled={uploading}><Trash2 size={15} /> Use text logo</button>}
            </div>
          </div>

          <p className="settings-hint">PNG, JPEG or WebP up to 8 MB (large images are compressed automatically). The saved logo appears in the public site header and footer immediately after saving — no redeploy needed.</p>
        </div>
      </section>
    </section>
  );
}
