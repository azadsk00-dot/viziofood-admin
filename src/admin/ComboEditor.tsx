/**
 * Combo choice-group editor, rendered inside the product modal when the
 * product is flagged "Combo (bundle)". Each group holds the products staff
 * INDIVIDUALLY selected as eligible — never a whole category. Per option:
 * price 0 = included in the bundle price, positive = a one-off upgrade.
 * "Inherit extras" offers the chosen child's optional add-on modifiers
 * (adjustment mode only) as paid extras in the customer builder.
 */

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { AdminComboGroup } from './supabase';
import { getProducts } from './supabase';
import { useResource } from './useResource';
import { Badge, Button, Input } from '../ui';

const blankGroup = (displayOrder: number): AdminComboGroup => ({
  id: '', name: '', displayOrder, minSelections: 1, maxSelections: 1, inheritExtras: false, active: true, options: [],
});

export function ComboEditor({ productId, groups, setGroups, loaded }: {
  productId?: string;
  groups: AdminComboGroup[];
  setGroups: (next: AdminComboGroup[]) => void;
  loaded: boolean;
}) {
  const allProducts = useResource(getProducts);

  const update = (index: number, patch: Partial<AdminComboGroup>) =>
    setGroups(groups.map((group, i) => (i === index ? { ...group, ...patch } : group)));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    [next[index], next[target]] = [next[target], next[index]];
    setGroups(next);
  };

  const toggleOption = (index: number, product: { id: string; name: string }, checked: boolean) =>
    update(index, {
      options: checked
        ? [...groups[index].options, { productId: product.id, name: product.name, price: 0 }]
        : groups[index].options.filter((option) => option.productId !== product.id),
    });

  const setOptionPrice = (index: number, productId: string, price: number) =>
    update(index, { options: groups[index].options.map((option) => (option.productId === productId ? { ...option, price } : option)) });

  const moveOption = (index: number, optionIndex: number, direction: -1 | 1) => {
    const options = [...groups[index].options];
    const target = optionIndex + direction;
    if (target < 0 || target >= options.length) return;
    [options[optionIndex], options[target]] = [options[target], options[optionIndex]];
    update(index, { options });
  };

  // A brand-new product has no id yet — its choice groups are configured
  // here immediately and persisted by the product save (createProduct →
  // saveComboGroups). Only an EXISTING product needs its saved groups
  // loaded first.
  if (!loaded) {
    return <p className="vz-muted" style={{ fontSize: '0.82rem' }}>Loading combo groups…</p>;
  }

  return (
    <div className="vz-stack" style={{ gap: 14 }}>
      {groups.map((group, index) => (
        <div key={index} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12 }}>
          <div className="vz-row vz-row--between" style={{ marginBottom: 8 }}>
            <strong>{index + 1}. {group.name || '(unnamed group)'}</strong>
            <div className="vz-row">
              <Button type="button" size="sm" variant="ghost" title="Move group up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></Button>
              <Button type="button" size="sm" variant="ghost" title="Move group down" disabled={index === groups.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></Button>
              <Button type="button" size="sm" variant="danger" title="Remove group" onClick={() => setGroups(groups.filter((_, i) => i !== index))}><X size={14} /></Button>
            </div>
          </div>
          <Input
            value={group.name}
            placeholder="Group name (e.g. Choose your drink)"
            aria-label="Group name"
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <div className="vz-row vz-row--wrap" style={{ marginTop: 8, gap: 10 }}>
            <label className="vz-row" style={{ gap: 6, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={group.inheritExtras} onChange={(event) => update(index, { inheritExtras: event.target.checked })} />
              Inherit this choice’s optional extras
            </label>
            <Badge tone={group.minSelections > 0 ? 'terracotta' : 'neutral'}>{group.minSelections > 0 ? 'Required' : 'Optional'}</Badge>
          </div>

          <p className="vz-muted" style={{ fontSize: '0.8rem', margin: '10px 0 6px' }}>
            Tick the products that are eligible for this choice — only ticked products are ever offered. Price 0 = included; a positive price is a one-off upgrade.
          </p>
          {group.options.length > 0 && (
            <div className="vz-stack" style={{ gap: 4, marginBottom: 8 }}>
              {group.options.map((option, optionIndex) => (
                <div key={option.productId} className="vz-row vz-row--between" style={{ fontSize: '0.85rem', gap: 8 }}>
                  <span className="vz-row" style={{ gap: 4 }}>
                    <strong>{optionIndex + 1}.</strong> {option.name}
                  </span>
                  <span className="vz-row" style={{ gap: 4 }}>
                    <span className="vz-muted">$</span>
                    <Input
                      type="number" min={0} step="0.01" value={option.price} aria-label={`Upgrade price for ${option.name}`}
                      style={{ width: 84 }}
                      onChange={(event) => setOptionPrice(index, option.productId, Number(event.target.value))}
                    />
                    <Button type="button" size="sm" variant="ghost" title="Move choice up" disabled={optionIndex === 0} onClick={() => moveOption(index, optionIndex, -1)}><ArrowUp size={13} /></Button>
                    <Button type="button" size="sm" variant="ghost" title="Move choice down" disabled={optionIndex === group.options.length - 1} onClick={() => moveOption(index, optionIndex, 1)}><ArrowDown size={13} /></Button>
                    <Button type="button" size="sm" variant="danger" title="Remove choice" onClick={() => update(index, { options: group.options.filter((candidate) => candidate.productId !== option.productId) })}><X size={13} /></Button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {allProducts.loading ? (
            <p className="vz-muted" style={{ fontSize: '0.8rem' }}>Loading products…</p>
          ) : allProducts.error ? (
            <p className="vz-muted" style={{ fontSize: '0.8rem' }}>Products could not be loaded — save keeps the current choices unchanged.</p>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 8 }}>
              {(allProducts.data ?? []).filter((product) => product.active && !product.archived && product.id !== productId).map((product) => {
                const option = group.options.find((candidate) => candidate.productId === product.id);
                return (
                  <label key={product.id} className="vz-row" style={{ gap: 6, fontSize: '0.82rem', padding: '2px 0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(option)}
                      onChange={(event) => toggleOption(index, product, event.target.checked)}
                    />
                    {product.name} <small className="vz-muted">({product.category})</small>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => setGroups([...groups, blankGroup(groups.length)])}>
        <Plus size={14} /> Add choice group
      </Button>
    </div>
  );
}
