import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  CalendarDays,
  ImageIcon,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { PageTitle } from './components';
import { deleteProductImage, getHomepageContent, saveHomepageContent, uploadBrandImage } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import type { HomepageContent, HomepagePromoType } from './types';

export function HomepageContentPage() {
  const resource = useResource(getHomepageContent);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState<HomepageContent>({
    enabled: false, promoType: 'daily', title: '', description: '', price: null,
    imageUrl: null, buttonText: '', buttonLink: '', startDate: null, endDate: null,
  });

  useEffect(() => {
    if (resource.data) setContent(resource.data);
  }, [resource.data]);

  const set = <K extends keyof HomepageContent>(key: K, value: HomepageContent[K]) =>
    setContent(current => ({ ...current, [key]: value }));

  const handleImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadBrandImage(file, 'promo');
      const previous = content.imageUrl;
      set('imageUrl', url);
      if (previous) await deleteProductImage(previous).catch(() => undefined);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Image upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    const previous = content.imageUrl;
    set('imageUrl', null);
    if (previous) await deleteProductImage(previous).catch(() => undefined);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveHomepageContent(content);
      toast.show('Homepage content saved.');
      void resource.reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not save homepage content.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (resource.loading) return <section className="admin-page"><PageTitle title="Homepage Content" /><p className="admin-message">Loading…</p></section>;
  if (resource.error) return <section className="admin-page"><PageTitle title="Homepage Content" /><p className="admin-message error">{resource.error}</p></section>;

  return (
    <section className="admin-page">
      <PageTitle title="Homepage Content">
        <button className="admin-primary" onClick={() => void handleSave()} disabled={saving || uploading}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </PageTitle>

      <section className="admin-card settings-section">
        <div className="settings-section-header">
          <Sparkles size={18} />
          <h2>Homepage Special</h2>
        </div>

        <div className="admin-form homepage-form">
          <label className="check-label homepage-toggle">
            <input
              type="checkbox"
              checked={content.enabled}
              onChange={e => set('enabled', e.target.checked)}
            />
            Show the special on the public homepage
          </label>
          <p className="settings-hint">When off, the section is hidden from visitors immediately — no redeploy needed.</p>

          <label className="settings-field">
            <span>Special type</span>
            <select value={content.promoType} onChange={e => set('promoType', e.target.value as HomepagePromoType)}>
              <option value="daily">Special of the Day</option>
              <option value="weekly">Special of the Week</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Title</span>
            <input value={content.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Truffle Tagliatelle Night" />
          </label>

          <label className="settings-field">
            <span>Short description</span>
            <textarea value={content.description} onChange={e => set('description', e.target.value)} placeholder="One or two lines shown under the title." />
          </label>

          <label className="settings-field">
            <span>Price ($) — optional</span>
            <input type="number" step="0.01" min="0" value={content.price ?? ''} onChange={e => set('price', e.target.value === '' ? null : Number(e.target.value))} placeholder="24.00" />
          </label>

          <div className="settings-field">
            <span><ImageIcon size={13} /> Image — optional</span>
            <div className="image-field">
              {content.imageUrl
                ? <div className="image-preview-wrap">
                    <img src={content.imageUrl} alt="Homepage special preview" className="image-preview wide" />
                    <button className="table-button danger" onClick={() => void removeImage()} title="Remove image"><Trash2 size={16} /></button>
                  </div>
                : <p className="settings-hint">No image selected — the section shows a plain accent card.</p>}
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => void handleImage(event)} />
              <button className="admin-primary outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Upload size={15} /> {uploading ? 'Uploading…' : content.imageUrl ? 'Replace image' : 'Upload image'}
              </button>
            </div>
          </div>

          <label className="settings-field">
            <span>Button text — optional</span>
            <input value={content.buttonText} onChange={e => set('buttonText', e.target.value)} placeholder="Order this special" />
          </label>

          <label className="settings-field">
            <span>Button link — optional</span>
            <input value={content.buttonLink} onChange={e => set('buttonLink', e.target.value)} placeholder="/menu or https://…" />
          </label>

          <div className="homepage-dates">
            <label className="settings-field">
              <span><CalendarDays size={13} /> Start date — optional</span>
              <input type="date" value={content.startDate ?? ''} onChange={e => set('startDate', e.target.value || null)} />
            </label>
            <label className="settings-field">
              <span><CalendarDays size={13} /> End date — optional</span>
              <input type="date" value={content.endDate ?? ''} onChange={e => set('endDate', e.target.value || null)} />
            </label>
          </div>
          <p className="settings-hint">With dates set, the special only appears (and the button stays live) from start to end date. Leave both empty to always show.</p>
        </div>
      </section>
    </section>
  );
}
