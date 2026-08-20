import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import type { ModifierGroup, ModifierOption } from './types';
import { createModifier, createModifierGroup, deleteModifier, deleteModifierGroup, getModifierGroups, getModifierOptions, updateModifier, updateModifierGroup } from './supabase';
import { useResource } from './useResource';
import { Modal, PageTitle, Status } from './components';
import { useToast } from '../components/Toast';

const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
const blankGroup = (): Omit<ModifierGroup, 'id'> => ({ name: '', required: false, minSelections: 0, maxSelections: 0, active: true, displayOrder: 0 });
const blankOption = (groupId: string): Omit<ModifierOption, 'id'> => ({ groupId, name: '', description: '', price: 0, active: true, displayOrder: 0 });

function GroupEditor({ item, done, close }: { item?: ModifierGroup; done: () => Promise<void>; close: () => void }) {
  const [value, setValue] = useState<Omit<ModifierGroup, 'id'>>(item ? { ...item } : blankGroup());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = <K extends keyof typeof value>(key: K, next: (typeof value)[K]) => setValue(v => ({ ...v, [key]: next }));
  // The required toggle drives the standard selection limits; the explicit
  // min/max fields stay available for future setups (max 0 = unlimited).
  const toggleRequired = (required: boolean) => setValue(v => required
    ? { ...v, required, minSelections: Math.max(1, v.minSelections), maxSelections: v.maxSelections === 0 ? 1 : v.maxSelections }
    : { ...v, required, minSelections: 0, maxSelections: 0 });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.name.trim()) { toast.show('Group name is required.', 'error'); return; }
    setBusy(true);
    try {
      if (item) await updateModifierGroup(item.id, value);
      else await createModifierGroup(value);
      await done();
      toast.show('Modifier group saved');
      close();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save group.', 'error');
    } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? 'Edit modifier group' : 'Add modifier group'} onClose={close}>
      <form className="admin-form" onSubmit={save}>
        <label>Group name<input required value={value.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Choose Your Protein" /></label>
        <label className="check-label"><input type="checkbox" checked={value.required} onChange={e => toggleRequired(e.target.checked)} />Required — the customer must choose from this group before adding to cart</label>
        <div className="editor-grid">
          <label>Minimum selections<input type="number" min="0" max="20" value={value.minSelections} onChange={e => set('minSelections', Number(e.target.value))} /></label>
          <label>Maximum selections<small> 0 = unlimited</small><input type="number" min="0" max="20" value={value.maxSelections} onChange={e => set('maxSelections', Number(e.target.value))} /></label>
        </div>
        <label className="check-label"><input type="checkbox" checked={value.active} onChange={e => set('active', e.target.checked)} />Active — available to assign to products</label>
        <button className="admin-primary" disabled={busy}>{busy ? 'Saving…' : 'Save group'}</button>
      </form>
    </Modal>
  );
}

function OptionEditor({ groupId, item, done, close }: { groupId: string; item?: ModifierOption; done: () => Promise<void>; close: () => void }) {
  const [value, setValue] = useState<Omit<ModifierOption, 'id'>>(item ? { ...item } : blankOption(groupId));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = <K extends keyof typeof value>(key: K, next: (typeof value)[K]) => setValue(v => ({ ...v, [key]: next }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.name.trim()) { toast.show('Option name is required.', 'error'); return; }
    setBusy(true);
    try {
      if (item) await updateModifier(item.id, value);
      else await createModifier(value);
      await done();
      toast.show('Option saved');
      close();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save option.', 'error');
    } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? 'Edit option' : 'Add option'} onClose={close}>
      <form className="admin-form" onSubmit={save}>
        <label>Name<input required value={value.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Beef Bacon" /></label>
        <label>Price added<input type="number" min="0" step=".01" value={value.price} onChange={e => set('price', Number(e.target.value))} /></label>
        <label>Description<textarea rows={2} value={value.description} onChange={e => set('description', e.target.value)} placeholder="Optional — shown to admins" /></label>
        <label className="check-label"><input type="checkbox" checked={value.active} onChange={e => set('active', e.target.checked)} />Active — selectable by customers</label>
        <button className="admin-primary" disabled={busy}>{busy ? 'Saving…' : 'Save option'}</button>
      </form>
    </Modal>
  );
}

export function ModifiersPage() {
  const groups = useResource(getModifierGroups);
  const options = useResource(getModifierOptions);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [groupEditor, setGroupEditor] = useState<ModifierGroup>();
  const [addingGroup, setAddingGroup] = useState(false);
  const [optionEditor, setOptionEditor] = useState<{ groupId: string; option?: ModifierOption }>();
  const [addingOption, setAddingOption] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reload = async () => { await Promise.all([groups.reload(), options.reload()]); };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (groups.data ?? []).filter(g => !term || g.name.toLowerCase().includes(term));
  }, [groups.data, search]);
  const optionsFor = (groupId: string) => (options.data ?? []).filter(o => o.groupId === groupId);

  // Group order is rewritten 1..n across the full list (index resolved
  // against all groups so reordering stays correct while filtering).
  const moveGroup = async (group: ModifierGroup, direction: -1 | 1) => {
    const list = [...(groups.data ?? [])];
    const index = list.findIndex(g => g.id === group.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setBusy(true);
    try {
      await Promise.all(list.map((g, position) => updateModifierGroup(g.id, { displayOrder: position + 1 })));
      await groups.reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not reorder groups.', 'error');
    } finally { setBusy(false); }
  };

  // Option order is rewritten 1..n within the group.
  const moveOption = async (groupId: string, option: ModifierOption, direction: -1 | 1) => {
    const list = [...optionsFor(groupId)];
    const index = list.findIndex(o => o.id === option.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setBusy(true);
    try {
      await Promise.all(list.map((o, position) => updateModifier(o.id, { displayOrder: position + 1 })));
      await options.reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not reorder options.', 'error');
    } finally { setBusy(false); }
  };

  const toggleGroup = async (group: ModifierGroup) => {
    setBusy(true);
    try {
      await updateModifierGroup(group.id, { active: !group.active });
      await groups.reload();
      toast.show(group.active ? `${group.name} deactivated — hidden from products and customers.` : `${group.name} activated.`);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not update group.', 'error');
    } finally { setBusy(false); }
  };

  const toggleOption = async (option: ModifierOption) => {
    setBusy(true);
    try {
      await updateModifier(option.id, { active: !option.active });
      await options.reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not update option.', 'error');
    } finally { setBusy(false); }
  };

  const removeGroup = async (group: ModifierGroup) => {
    if (!confirm(`Delete ${group.name}? Its options and product assignments are removed. Existing orders are not affected.`)) return;
    setBusy(true);
    try {
      await deleteModifierGroup(group.id);
      await reload();
      toast.show('Group deleted');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not delete group.', 'error');
    } finally { setBusy(false); }
  };

  const removeOption = async (option: ModifierOption) => {
    if (!confirm(`Delete ${option.name}? It is removed from its group. Existing orders are not affected.`)) return;
    setBusy(true);
    try {
      await deleteModifier(option.id);
      await options.reload();
      toast.show('Option deleted');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not delete option.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <section className="admin-page">
      <PageTitle title="Modifiers">
        <button className="admin-primary" onClick={() => setAddingGroup(true)}><Plus size={16} />Add modifier group</button>
      </PageTitle>
      <section className="admin-card">
        <label className="admin-search"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search groups" aria-label="Search modifier groups" /></label>
        {groups.loading || options.loading ? <p className="admin-message">Loading modifiers…</p> : groups.error ? <p className="admin-message error">{groups.error}</p> : !visible.length ? <p className="admin-message">No modifier groups yet. Create groups like “Choose Your Protein” or “Extras”, add options, then assign groups to products from the Products page.</p> : (
          <div className="modifier-groups">
            {visible.map(group => {
              const groupOptions = optionsFor(group.id);
              return (
                <article className="modifier-group-card" key={group.id}>
                  <header>
                    <span className="featured-actions">
                      <button className="table-button" title="Move up" disabled={busy} onClick={() => void moveGroup(group, -1)}><ArrowUp size={16} /></button>
                      <button className="table-button" title="Move down" disabled={busy} onClick={() => void moveGroup(group, 1)}><ArrowDown size={16} /></button>
                    </span>
                    <div className="modifier-group-title">
                      <h2>{group.name}</h2>
                      <span className="modifier-group-tags">
                        <Status value={group.required ? 'Required' : 'Optional'} />
                        <Status value={group.active ? 'Active' : 'Inactive'} />
                      </span>
                    </div>
                    <span className="featured-actions">
                      <button className="table-button" title="Edit group" onClick={() => setGroupEditor(group)}><Pencil size={16} /></button>
                      <button className="table-button" title={group.active ? 'Deactivate' : 'Activate'} disabled={busy} onClick={() => void toggleGroup(group)}><Power size={16} /></button>
                      <button className="table-button danger" title="Delete group" disabled={busy} onClick={() => void removeGroup(group)}><Trash2 size={16} /></button>
                    </span>
                  </header>
                  {groupOptions.length ? (
                    <ol className="modifier-options">
                      {groupOptions.map(option => (
                        <li key={option.id}>
                          <span className="modifier-option-name"><b>{option.name}</b><small>{option.description}</small></span>
                          <b className="modifier-option-price">{option.price > 0 ? `+${money(option.price)}` : 'Free'}</b>
                          <Status value={option.active ? 'Active' : 'Inactive'} />
                          <span className="featured-actions">
                            <button className="table-button" title="Move up" disabled={busy} onClick={() => void moveOption(group.id, option, -1)}><ArrowUp size={15} /></button>
                            <button className="table-button" title="Move down" disabled={busy} onClick={() => void moveOption(group.id, option, 1)}><ArrowDown size={15} /></button>
                            <button className="table-button" title="Edit option" onClick={() => setOptionEditor({ groupId: group.id, option })}><Pencil size={15} /></button>
                            <button className="table-button" title={option.active ? 'Deactivate' : 'Activate'} disabled={busy} onClick={() => void toggleOption(option)}><Power size={15} /></button>
                            <button className="table-button danger" title="Delete option" disabled={busy} onClick={() => void removeOption(option)}><Trash2 size={15} /></button>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="admin-message">No options yet.</p>}
                  <button className="admin-primary outline" onClick={() => setAddingOption(group.id)}><Plus size={15} />Add option</button>
                </article>
              );
            })}
          </div>
        )}
        <p className="settings-hint">Modifier groups hold the options customers choose inside a product (e.g. “Choose Your Protein” with Beef, Beef Bacon, Chicken). Assign groups per product from Admin → Products → Edit → Modifiers — nothing is assigned automatically. Group order here is the order customers see.</p>
      </section>
      {addingGroup && <GroupEditor close={() => setAddingGroup(false)} done={reload} />}
      {groupEditor && <GroupEditor item={groupEditor} close={() => setGroupEditor(undefined)} done={reload} />}
      {addingOption && <OptionEditor groupId={addingOption} close={() => setAddingOption(undefined)} done={reload} />}
      {optionEditor && <OptionEditor groupId={optionEditor.groupId} item={optionEditor.option} close={() => setOptionEditor(undefined)} done={reload} />}
    </section>
  );
}
export default ModifiersPage;
