/**
 * Combo (bundle) builder dialog. The customer walks the combo's required
 * choice groups ("Choose your pasta", "Choose your drink") — each eligible
 * product shows "Included" (or its upgrade price) and never its standalone
 * price. When a selection is made in a group flagged inheritExtras, that
 * child product's OPTIONAL add-on modifiers (adjustment mode only — sizes
 * and required standalone choices are excluded by fetchComboExtras) load as
 * paid extras. Add stays blocked until every required choice is made.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useCart } from '../context/CartProvider';
import { useToast } from './Toast';
import { lineUnitPrice } from '../lib/money';
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
  // groupId → chosen productId (choice groups are pick-one)
  const [choices, setChoices] = useState<Record<string, string>>({});
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

  // Load inherited extras when a child is selected in an inheritExtras group.
  useEffect(() => {
    if (!groups) return;
    for (const group of groups) {
      if (!group.inheritExtras) continue;
      const productId = choices[group.id];
      if (!productId || extras[productId]) continue;
      setExtras((current) => ({ ...current, [productId]: { groups: [], choices: {} } }));
      fetchComboExtras(productId)
        .then((extraGroups) => setExtras((current) => ({ ...current, [productId]: { groups: extraGroups, choices: {} } })))
        .catch(() => setExtras((current) => ({ ...current, [productId]: { groups: [], choices: {} } })));
    }
  }, [choices, groups, extras]);

  // The extras shown are those of the most recent inheritExtras selection.
  const activeExtras = useMemo(() => {
    if (!groups) return null;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      if (!group.inheritExtras) continue;
      const productId = choices[group.id];
      if (productId && extras[productId]) return { productId, ...extras[productId] };
    }
    return null;
  }, [groups, choices, extras]);

  const selections: ComboSelection[] = useMemo(() => {
    if (!groups) return [];
    return groups
      .filter((group) => choices[group.id] && group.options.some((option) => option.productId === choices[group.id]))
      .map((group) => {
        const option = group.options.find((candidate) => candidate.productId === choices[group.id])!;
        return { groupId: group.id, groupName: group.name, productId: option.productId, productName: option.name, upgrade: Number(option.price.toFixed(2)) };
      });
  }, [groups, choices]);

  const chosenExtras: CartModifier[] = useMemo(() => {
    const out: CartModifier[] = [];
    for (const group of activeExtras?.groups ?? []) {
      for (const option of group.options) {
        if ((activeExtras?.choices[group.id] ?? []).includes(option.id)) {
          out.push({ id: option.id, name: option.name, price: option.price, priceMode: option.priceMode });
        }
      }
    }
    return out;
  }, [activeExtras]);

  const toggleExtra = (group: PublicModifierGroup, optionId: string) => {
    if (!activeExtras) return;
    const { productId, groups: extraGroups, choices: extraChoices } = activeExtras;
    const selected = extraChoices[group.id] ?? [];
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
    setExtras((current) => ({ ...current, [productId]: { groups: extraGroups, choices: { ...extraChoices, [group.id]: next } } }));
  };

  const unsatisfied = (groups ?? []).filter((group) => group.minSelections > 0 && !choices[group.id]);
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

      {groups?.map((group) => (
        <div className="mod-group" key={group.id}>
          <div className="mod-group__head">
            <span className="mod-group__name">{group.name}</span>
            <span className="mod-group__rule">{group.minSelections > 0 ? 'Choose one' : 'Optional'}</span>
          </div>
          <div className="mod-options">
            {group.options.map((option) => {
              const selected = choices[group.id] === option.productId;
              return (
                <label key={option.productId} className={`mod-option ${selected ? 'is-checked' : ''}`}>
                  <input
                    type="radio"
                    name={group.id}
                    checked={selected}
                    onChange={() => setChoices((current) => ({ ...current, [group.id]: option.productId }))}
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
      ))}

      {(activeExtras?.groups.length ?? 0) > 0 && (
        <section aria-label="Optional extras" style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: '1.02rem' }}>Optional extras <small className="vz-muted" style={{ fontWeight: 400 }}>added to your combo</small></h3>
          {(activeExtras?.groups ?? []).map((group) => (
            <div className="mod-group" key={group.id}>
              <div className="mod-group__head">
                <span className="mod-group__name">{group.name}</span>
                <span className="mod-group__rule">{group.maxSelections > 1 ? `Up to ${group.maxSelections}` : 'Optional'}</span>
              </div>
              <div className="mod-options">
                {group.options.map((option) => {
                  const checked = (activeExtras?.choices[group.id] ?? []).includes(option.id);
                  return (
                    <label key={option.id} className={`mod-option ${checked ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleExtra(group, option.id)} />
                      <span className="mod-option__name">{option.name}</span>
                      {option.price > 0 && <span className="mod-option__price">+{aud(option.price)}</span>}
                    </label>
                  );
                })}
              </div>
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
          Choose {unsatisfied.map((group) => group.name.toLowerCase()).join(', ')} to continue.
        </p>
      )}
    </Modal>
  );
}
