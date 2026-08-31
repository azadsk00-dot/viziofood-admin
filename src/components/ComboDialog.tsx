/**
 * Combo (bundle) builder dialog. The customer walks the combo's choice
 * groups ("Choose your pasta", "Choose your drink" — or "Choose 2–3 pizzas"):
 * each group enforces its OWN configured minimum/maximum selections, and each
 * eligible product shows "Included" (or its upgrade price) — never its
 * standalone price. When selections are made in a group flagged
 * inheritExtras, each chosen child's OPTIONAL add-on modifiers (adjustment
 * mode only — sizes and required standalone choices are excluded by
 * fetchComboExtras) load as paid extras. Add stays blocked until every
 * group's minimum is satisfied; selections beyond a group's maximum are
 * refused with a toast.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useCart } from '../context/CartProvider';
import { useToast } from './Toast';
import { lineUnitPrice } from '../lib/money';
import { atSelectionLimit, describeComboRule, selectionCountError } from '../lib/comboRules';
import type { CartItem, CartModifier, ComboSelection } from '../types';
import { fetchComboDefinition, fetchComboExtras, type ComboGroup, type CustomerProduct, type PublicModifierGroup } from '../services/products';
import { aud } from '../lib/money';
import { Button, Modal, Skeleton, Textarea } from '../ui';

interface ExtrasState { groups: PublicModifierGroup[]; choices: Record<string, string[]> }

export function ComboDialog({ combo, onClose }: { combo: CustomerProduct; onClose: () => void }) {
  const { addItem } = useCart();
  const toast = useToast();
  const [groups, setGroups] = useState<ComboGroup[] | null>(null);
  const [error, setError] = useState('');
  // groupId → chosen productIds (a group may allow several selections)
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  // childProductId → its optional extras groups + chosen modifier ids
  const [extras, setExtras] = useState<Record<string, ExtrasState>>({});
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    let active = true;
    setGroups(null);
    setError('');
    fetchComboDefinition(combo.id)
      .then((definition) => { if (active) setGroups(definition); })
      .catch(() => { if (active) setError('We couldn’t load this combo right now. Please try again.'); });
    return () => { active = false; };
  }, [combo.id]);

  // Load inherited extras for every selected child of an inheritExtras group.
  useEffect(() => {
    if (!groups) return;
    for (const group of groups) {
      if (!group.inheritExtras) continue;
      for (const productId of choices[group.id] ?? []) {
        if (extras[productId]) continue;
        setExtras((current) => ({ ...current, [productId]: { groups: [], choices: {} } }));
        fetchComboExtras(productId)
          .then((extraGroups) => setExtras((current) => ({ ...current, [productId]: { groups: extraGroups, choices: {} } })))
          .catch(() => setExtras((current) => ({ ...current, [productId]: { groups: [], choices: {} } })));
      }
    }
  }, [choices, groups, extras]);

  const toggleChoice = (group: ComboGroup, productId: string) => {
    const selected = choices[group.id] ?? [];
    if (selected.includes(productId)) {
      setChoices((current) => ({ ...current, [group.id]: selected.filter((id) => id !== productId) }));
      return;
    }
    if (atSelectionLimit(group, selected.length)) {
      toast.show(`Up to ${group.maxSelections} from ${group.name}.`, { type: 'error' });
      return;
    }
    setChoices((current) => ({ ...current, [group.id]: [...selected, productId] }));
  };

  const selections: ComboSelection[] = useMemo(() => {
    if (!groups) return [];
    const out: ComboSelection[] = [];
    for (const group of groups) {
      for (const productId of choices[group.id] ?? []) {
        const option = group.options.find((candidate) => candidate.productId === productId);
        if (!option) continue;
        out.push({ groupId: group.id, groupName: group.name, productId: option.productId, productName: option.name, upgrade: Number(option.price.toFixed(2)) });
      }
    }
    return out;
  }, [groups, choices]);

  // Every selected inheritExtras child that has extras, most recent group first.
  const extrasSections = useMemo(() => {
    if (!groups) return [] as Array<{ productId: string; state: ExtrasState }>;
    const sections: Array<{ productId: string; state: ExtrasState }> = [];
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      if (!group.inheritExtras) continue;
      for (const productId of [...(choices[group.id] ?? [])].reverse()) {
        const state = extras[productId];
        if (state && state.groups.length) sections.push({ productId, state });
      }
    }
    return sections;
  }, [groups, choices, extras]);

  const chosenExtras: CartModifier[] = useMemo(() => {
    const out: CartModifier[] = [];
    for (const section of extrasSections) {
      for (const group of section.state.groups) {
        for (const option of group.options) {
          if ((section.state.choices[group.id] ?? []).includes(option.id)) {
            out.push({ id: option.id, name: option.name, price: option.price, priceMode: option.priceMode });
          }
        }
      }
    }
    return out;
  }, [extrasSections]);

  const toggleExtra = (productId: string, group: PublicModifierGroup, optionId: string) => {
    const state = extras[productId];
    if (!state) return;
    const selected = state.choices[group.id] ?? [];
    let next: string[];
    if (selected.includes(optionId)) {
      next = selected.filter((id) => id !== optionId);
    } else {
      if (group.maxSelections > 0 && selected.length >= group.maxSelections) {
        toast.show(`Up to ${group.maxSelections} from ${group.name}.`, { type: 'error' });
        return;
      }
      next = [...selected, optionId];
    }
    setExtras((current) => ({ ...current, [productId]: { groups: state.groups, choices: { ...state.choices, [group.id]: next } } }));
  };

  const productName = (productId: string): string => {
    if (!groups) return '';
    for (const group of groups) {
      const option = group.options.find((candidate) => candidate.productId === productId);
      if (option) return option.name;
    }
    return '';
  };

  // A group is unsatisfied while the customer has chosen fewer than its minimum.
  const unsatisfied = (groups ?? []).filter((group) => selectionCountError(group, (choices[group.id] ?? []).length) === 'under');
  const provisional: Omit<CartItem, 'key'> = {
    productId: combo.id,
    name: combo.name,
    price: combo.price,
    quantity: 1,
    modifiers: chosenExtras,
    instructions: instructions.trim(),
    combo: selections.length ? selections : null,
  };
  const total = lineUnitPrice(provisional);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Build your ${combo.name}`}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontWeight: 800, fontSize: '1.05rem' }}>{aud(total)}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={unsatisfied.length > 0}
            onClick={() => {
              addItem(provisional);
              toast.show(`${combo.name} added to your order`);
              onClose();
            }}
          >
            <Plus size={16} /> Add to order
          </Button>
        </>
      }
    >
      {combo.description && <p className="vz-muted" style={{ marginTop: 0 }}>{combo.description}</p>}
      <p className="vz-muted" style={{ fontSize: '0.85rem' }}>{aud(combo.price)} total — your choices included.</p>

      {error && <p className="vz-field__error" role="alert">{error}</p>}
      {groups === null && !error && <div className="vz-stack">{Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} height={72} />)}</div>}
      {groups !== null && groups.length === 0 && (
        <p className="vz-muted">This combo isn’t configured yet — please check back soon.</p>
      )}

      {groups?.map((group) => {
        const selected = choices[group.id] ?? [];
        return (
          <div className="mod-group" key={group.id}>
            <div className="mod-group__head">
              <span className="mod-group__name">{group.name}</span>
              <span className="mod-group__rule">{describeComboRule(group)}</span>
            </div>
            <div className="mod-options">
              {group.options.map((option) => {
                const checked = selected.includes(option.productId);
                return (
                  <label key={option.productId} className={`mod-option ${checked ? 'is-checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleChoice(group, option.productId)}
                    />
                    <span className="mod-option__name">
                      {option.name}
                      {option.description && <small className="vz-muted" style={{ display: 'block', fontSize: '0.72rem' }}>{option.description}</small>}
                    </span>
                    {option.price > 0
                      ? <span className="mod-option__price">+{aud(option.price)}</span>
                      : <span className="mod-option__price" style={{ color: 'var(--olive, #4a7c59)' }}>Included</span>}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      {extrasSections.length > 0 && (
        <section aria-label="Optional extras" style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: '1.02rem' }}>Optional extras <small className="vz-muted" style={{ fontWeight: 400 }}>added to your combo</small></h3>
          {extrasSections.map(({ productId, state }) => (
            <div key={productId}>
              <p className="vz-eyebrow" style={{ marginBottom: 6 }}>{productName(productId)}</p>
              {state.groups.map((group) => (
                <div className="mod-group" key={group.id}>
                  <div className="mod-group__head">
                    <span className="mod-group__name">{group.name}</span>
                    <span className="mod-group__rule">{group.maxSelections > 1 ? `Up to ${group.maxSelections}` : 'Optional'}</span>
                  </div>
                  <div className="mod-options">
                    {group.options.map((option) => {
                      const checked = (state.choices[group.id] ?? []).includes(option.id);
                      return (
                        <label key={option.id} className={`mod-option ${checked ? 'is-checked' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleExtra(productId, group, option.id)} />
                          <span className="mod-option__name">{option.name}</span>
                          {option.price > 0 && <span className="mod-option__price">+{aud(option.price)}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <div className="vz-field" style={{ marginTop: 16 }}>
        <label className="vz-field__label" htmlFor="combo-instructions">Special instructions</label>
        <Textarea
          id="combo-instructions"
          placeholder="Allergies, extra care, a birthday…"
          value={instructions}
          maxLength={500}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>

      {unsatisfied.length > 0 && (
        <p className="vz-field__error" role="alert">
          {unsatisfied
            .map((group) => `${group.name}: choose ${group.minSelections === group.maxSelections ? String(group.minSelections) : `${group.minSelections}–${group.maxSelections}`} (${(choices[group.id] ?? []).length} selected)`)
            .join(' · ')}
        </p>
      )}
    </Modal>
  );
}
