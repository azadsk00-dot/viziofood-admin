/**
 * Modifiers admin — groups (e.g. "Choose Your Protein") and their options
 * (Beef, Chicken +$4). Group/option order is rewritten 1..n on every move;
 * option names are unique per group, case-insensitively. parseModifierPrice
 * and findDuplicateInGroup are covered by ModifiersPage.test.ts — keep them
 * semantically identical when editing.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import type { ModifierGroup, ModifierOption } from './types';
import { createModifier, createModifierGroup, deleteModifier, deleteModifierGroup, getModifierGroups, getModifierOptions, updateModifier, updateModifierGroup } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Skeleton, Textarea, Toggle } from '../ui';
import { aud } from '../lib/money';

const blankGroup = (): Omit<ModifierGroup, 'id'> => ({ name: '', required: false, minSelections: 0, maxSelections: 0, active: true, displayOrder: 0 });
const blankOption = (groupId: string): Omit<ModifierOption, 'id'> => ({ groupId, name: '', description: '', price: 0, active: true, displayOrder: 0 });

// The price field edits as free text so intermediate states ("", "2.", "2.50")
// stay exactly as typed; this converts to a number only at save time.
// Empty is treated as 0 (the established default); anything that is not a
// finite non-negative number is a validation error.
export function parseModifierPrice(text: string): { price: number } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { price: 0 };
  const price = Number(trimmed);
  if (!Number.isFinite(price)) return { error: 'Enter a valid price (e.g. 2.50).' };
  if (price < 0) return { error: 'Price cannot be negative.' };
  return { price };
}

// Postgres unique violations arrive as PostgREST error code 23505 — surface
// them as a clear message instead of the raw constraint text.
const isDuplicateName = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

// Option names are unique per GROUP (case-insensitively) — the same name in
// different groups is valid. Mirrors the database index
// modifiers_group_name_ci_unique_idx on (group_id, lower(trim(name))).
// `siblingNames` are the existing option names in the SAME group; the edited
// option's own name is excluded so saving without renaming always passes.
export function findDuplicateInGroup(name: string, siblingNames: string[], editingName?: string): string | undefined {
  const target = name.trim().toLowerCase();
  if (!target) return undefined;
  return siblingNames.find((existing) => existing.trim().toLowerCase() === target && existing !== editingName);
}

function GroupEditor({ item, done, close }: { item?: ModifierGroup; done: () => Promise<void>; close: () => void }) {
  const [value, setValue] = useState<Omit<ModifierGroup, 'id'>>(item ? { ...item } : blankGroup());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const set = <K extends keyof typeof value>(key: K, next: (typeof value)[K]) => setValue((v) => ({ ...v, [key]: next }));
  // The required toggle drives the standard selection limits; the explicit
  // min/max fields stay available for future setups (max 0 = unlimited).
  const toggleRequired = (required: boolean) => setValue((v) => required
    ? { ...v, required, minSelections: Math.max(1, v.minSelections), maxSelections: v.maxSelections === 0 ? 1 : v.maxSelections }
    : { ...v, required, minSelections: 0, maxSelections: 0 });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.name.trim()) { setError('Group name is required.'); return; }
    setBusy(true);
    setError('');
    try {
      if (item) await updateModifierGroup(item.id, value);
      else await createModifierGroup(value);
      await done();
      toast.show('Modifier group saved');
      close();
    } catch (reason) {
      if (isDuplicateName(reason)) {
        setError(`A group named “${value.name.trim()}” already exists — group names must be unique.`);
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Could not save group.');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={close}
      title={item ? 'Edit modifier group' : 'Add modifier group'}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" form="modifier-group-form" disabled={busy}>{busy ? 'Saving…' : 'Save group'}</Button>
        </>
      }
    >
      <form id="modifier-group-form" onSubmit={save}>
        {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
        <Field label="Group name" htmlFor="mg-name">
          <Input id="mg-name" required value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Choose Your Protein" />
        </Field>
        <div style={{ marginBottom: 14 }}>
          <Toggle
            checked={value.required}
            onChange={toggleRequired}
            label="Required — the customer must choose before adding to cart"
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Minimum selections" htmlFor="mg-min">
            <Input id="mg-min" type="number" min={0} max={20} value={value.minSelections} onChange={(e) => set('minSelections', Number(e.target.value))} />
          </Field>
          <Field label="Maximum selections" hint="0 = unlimited" htmlFor="mg-max">
            <Input id="mg-max" type="number" min={0} max={20} value={value.maxSelections} onChange={(e) => set('maxSelections', Number(e.target.value))} />
          </Field>
        </div>
        <Toggle checked={value.active} onChange={(v) => set('active', v)} label="Active — available to assign to products" />
      </form>
    </Modal>
  );
}

function OptionEditor({ groupId, item, siblingNames = [], done, close }: { groupId: string; item?: ModifierOption; siblingNames?: string[]; done: () => Promise<void>; close: () => void }) {
  const [value, setValue] = useState<Omit<ModifierOption, 'id'>>(item ? { ...item } : blankOption(groupId));
  // Price is edited as text so Backspace can empty the field and "2."/"2.50"
  // survive mid-typing; the numeric conversion happens once, on save.
  const [priceText, setPriceText] = useState(item ? String(item.price) : '0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const set = <K extends keyof typeof value>(key: K, next: (typeof value)[K]) => setValue((v) => ({ ...v, [key]: next }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const name = value.name.trim();
    if (!name) { setError('Option name is required.'); return; }
    // Uniqueness is per group and case-insensitive — the same name may exist
    // in any OTHER group; only a clash inside this group is rejected.
    const clash = findDuplicateInGroup(name, siblingNames, item?.name);
    if (clash) { setError(`An option named “${clash}” already exists in this group.`); return; }
    const parsedPrice = parseModifierPrice(priceText);
    if ('error' in parsedPrice) { setError(parsedPrice.error); return; }
    setBusy(true);
    setError('');
    try {
      if (item) await updateModifier(item.id, { ...value, name, price: parsedPrice.price });
      else await createModifier({ ...value, name, price: parsedPrice.price });
      await done();
      toast.show('Option saved');
      close();
    } catch (reason) {
      if (isDuplicateName(reason)) { setError(`An option named “${name}” already exists in this group.`); return; }
      setError(reason instanceof Error ? reason.message : 'Could not save option.');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={close}
      title={item ? 'Edit option' : 'Add option'}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" form="modifier-option-form" disabled={busy}>{busy ? 'Saving…' : 'Save option'}</Button>
        </>
      }
    >
      <form id="modifier-option-form" onSubmit={save}>
        {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
        <Field label="Name" htmlFor="mo-name">
          <Input id="mo-name" required value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Beef Bacon" />
        </Field>
        <Field label="Price added (AUD)" htmlFor="mo-price" hint="Empty = free">
          <Input id="mo-price" type="text" inputMode="decimal" autoComplete="off" value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Description" htmlFor="mo-desc" hint="Optional — shown to admins">
          <Textarea id="mo-desc" rows={2} value={value.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Toggle checked={value.active} onChange={(v) => set('active', v)} label="Active — selectable by customers" />
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
    return (groups.data ?? []).filter((g) => !term || g.name.toLowerCase().includes(term));
  }, [groups.data, search]);
  const optionsFor = (groupId: string) => (options.data ?? []).filter((o) => o.groupId === groupId);
  // Sibling names drive the per-group duplicate check in the option editor.
  const namesInGroup = (groupId: string) => optionsFor(groupId).map((option) => option.name);

  // Group order is rewritten 1..n across the full list (index resolved
  // against all groups so reordering stays correct while filtering).
  const moveGroup = async (group: ModifierGroup, direction: -1 | 1) => {
    const list = [...(groups.data ?? [])];
    const index = list.findIndex((g) => g.id === group.id);
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
    const index = list.findIndex((o) => o.id === option.id);
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
    if (!window.confirm(`Delete ${group.name}? Its options and product assignments are removed. Existing orders are not affected.`)) return;
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
    if (!window.confirm(`Delete ${option.name}? It is removed from its group. Existing orders are not affected.`)) return;
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
    <>
      <div className="admin-head">
        <div>
          <h1>Modifiers</h1>
          <p className="admin-head__sub">Groups of choices inside a product — e.g. “Choose Your Protein” with Beef or Chicken.</p>
        </div>
        <Button onClick={() => setAddingGroup(true)}><Plus size={16} /> Add modifier group</Button>
      </div>

      <div className="admin-toolbar">
        <div className="vz-row" style={{ flex: 1, minWidth: 220 }}>
          <Search size={16} color="var(--muted)" style={{ position: 'absolute', marginLeft: 12 }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search groups" aria-label="Search modifier groups" style={{ paddingLeft: 38 }} />
        </div>
      </div>

      {groups.loading || options.loading ? (
        <div className="vz-stack"><Skeleton height={140} /><Skeleton height={140} /></div>
      ) : groups.error ? (
        <p className="vz-error-box">{groups.error}</p>
      ) : visible.length === 0 ? (
        <EmptyState title="No modifier groups yet">
          Create groups like “Choose Your Protein” or “Extras”, add options, then assign them to products from the Products page.
        </EmptyState>
      ) : (
        <div className="vz-stack">
          {visible.map((group) => {
            const groupOptions = optionsFor(group.id);
            return (
              <Card key={group.id} pad>
                <div className="vz-row vz-row--between vz-row--wrap" style={{ marginBottom: 12 }}>
                  <div className="vz-row vz-row--wrap">
                    <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{group.name}</h2>
                    <Badge tone={group.required ? 'terracotta' : 'neutral'}>{group.required ? `Required · min ${group.minSelections}` : 'Optional'}</Badge>
                    {group.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  <div className="vz-row">
                    <Button size="sm" variant="ghost" title="Move up" disabled={busy} onClick={() => void moveGroup(group, -1)}><ArrowUp size={15} /></Button>
                    <Button size="sm" variant="ghost" title="Move down" disabled={busy} onClick={() => void moveGroup(group, 1)}><ArrowDown size={15} /></Button>
                    <Button size="sm" variant="secondary" onClick={() => setGroupEditor(group)}><Pencil size={14} /> Edit</Button>
                    <Button size="sm" variant="ghost" title={group.active ? 'Deactivate' : 'Activate'} disabled={busy} onClick={() => void toggleGroup(group)}><Power size={15} /></Button>
                    <Button size="sm" variant="danger" title="Delete group" disabled={busy} onClick={() => void removeGroup(group)}><Trash2 size={15} /></Button>
                  </div>
                </div>

                {groupOptions.length ? (
                  <div className="admin-list" style={{ marginBottom: 12 }}>
                    {groupOptions.map((option) => (
                      <div className="admin-list__row" key={option.id}>
                        <div className="admin-list__main">
                          <div className="admin-list__title">
                            {option.name}{' '}
                            {option.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Off</Badge>}
                          </div>
                          {option.description && <div className="admin-list__sub">{option.description}</div>}
                        </div>
                        <strong>{option.price > 0 ? `+${aud(option.price)}` : 'Free'}</strong>
                        <div className="vz-row">
                          <Button size="sm" variant="ghost" title="Move up" disabled={busy} onClick={() => void moveOption(group.id, option, -1)}><ArrowUp size={14} /></Button>
                          <Button size="sm" variant="ghost" title="Move down" disabled={busy} onClick={() => void moveOption(group.id, option, 1)}><ArrowDown size={14} /></Button>
                          <Button size="sm" variant="ghost" title="Edit option" onClick={() => setOptionEditor({ groupId: group.id, option })}><Pencil size={14} /></Button>
                          <Button size="sm" variant="ghost" title={option.active ? 'Deactivate' : 'Activate'} disabled={busy} onClick={() => void toggleOption(option)}><Power size={14} /></Button>
                          <Button size="sm" variant="danger" title="Delete option" disabled={busy} onClick={() => void removeOption(option)}><Trash2 size={14} /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="vz-muted" style={{ marginBottom: 12 }}>No options yet.</p>
                )}

                <Button variant="secondary" size="sm" onClick={() => setAddingOption(group.id)}>
                  <Plus size={14} /> Add option
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <p className="vz-muted" style={{ marginTop: 16, fontSize: '0.85rem' }}>
        Assign groups per product from Admin → Products → Edit → Modifiers — nothing is assigned automatically.
        Group order here is the order customers see.
      </p>

      {addingGroup && <GroupEditor close={() => setAddingGroup(false)} done={reload} />}
      {groupEditor && <GroupEditor item={groupEditor} close={() => setGroupEditor(undefined)} done={reload} />}
      {addingOption && <OptionEditor groupId={addingOption} siblingNames={namesInGroup(addingOption)} close={() => setAddingOption(undefined)} done={reload} />}
      {optionEditor && <OptionEditor groupId={optionEditor.groupId} item={optionEditor.option} siblingNames={namesInGroup(optionEditor.groupId)} close={() => setOptionEditor(undefined)} done={reload} />}
    </>
  );
}

export default ModifiersPage;
