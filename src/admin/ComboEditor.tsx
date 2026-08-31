/**
 * Combo choice-group editor, rendered inside the product modal when the
 * product is flagged "Combo (bundle)". Each group holds the products staff
 * INDIVIDUALLY selected as eligible — never a whole category. Per option:
 * price 0 = included in the bundle price, positive = a one-off upgrade.
 * "Inherit extras" offers the chosen child's optional add-on modifiers
 * (adjustment mode only) as paid extras in the customer builder.
 *
 * Product selection is CATEGORY-BASED: collapsible category sections (Pizza,
 * Pasta, Drinks, …) so building a bundle never means scrolling one giant
 * every-product list. Search still spans all categories and auto-expands
 * matching sections; selections from multiple categories can coexist in one
 * group.
 */

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AdminComboGroup } from './supabase';
import { getProducts } from './supabase';
import { useResource } from './useResource';
import { Badge, Button, Input, Select } from '../ui';

export { CategoryProductPicker };

/** Selectable min/max values (0–6; extend here if the data model allows). */
export const SELECTION_RANGE = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Editor-level guard for the whole group set (the server stays authoritative
 * for pricing; this blocks obviously unusable configurations):
 *   • every group needs a name
 *   • 0 ≤ min ≤ max
 *   • enough eligible products to satisfy the minimum
 */
export function validateChoiceGroups(groups: AdminComboGroup[]): string | null {
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group.name.trim()) return `Choice group ${index + 1} needs a name.`;
    if (group.minSelections < 0 || group.maxSelections < 0 || group.minSelections > group.maxSelections) {
      return `Choice group ${index + 1}: minimum selections must not exceed the maximum.`;
    }
    if (group.maxSelections > 0 && group.options.length < group.minSelections) {
      return `Choice group ${index + 1} (${group.name.trim()}) needs at least ${group.minSelections} eligible product${group.minSelections === 1 ? '' : 's'}.`;
    }
  }
  return null;
}

/** Pure: group products into collapsible category sections, filtered by search. */
export function groupProductsByCategory(
  products: Array<{ id: string; name: string; category: string; price: number }>,
  query: string,
): Array<{ category: string; items: typeof products }> {
  const q = query.trim().toLowerCase();
  const byCategory = new Map<string, typeof products>();
  for (const product of products) {
    const key = product.category || 'Other';
    byCategory.set(key, [...(byCategory.get(key) ?? []), product]);
  }
  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      items: q
        ? items.filter((item) => `${item.name} ${category}`.toLowerCase().includes(q))
        : items,
    }))
    .filter((section) => section.items.length > 0)
    .sort((a, b) => a.category.localeCompare(b.category));
}

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
          <div className="vz-row vz-row--wrap" style={{ marginTop: 8, gap: 10, alignItems: 'center' }}>
            <label className="vz-row" style={{ gap: 6, fontSize: '0.85rem' }}>
              Minimum selections
              <Select
                aria-label={`Minimum selections for group ${index + 1}`}
                value={String(group.minSelections)}
                style={{ width: 'auto' }}
                onChange={(event) => update(index, { minSelections: Number(event.target.value) })}
              >
                {SELECTION_RANGE.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </label>
            <label className="vz-row" style={{ gap: 6, fontSize: '0.85rem' }}>
              Maximum selections
              <Select
                aria-label={`Maximum selections for group ${index + 1}`}
                value={String(group.maxSelections)}
                style={{ width: 'auto' }}
                onChange={(event) => update(index, { maxSelections: Number(event.target.value) })}
              >
                {SELECTION_RANGE.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </label>
            <Badge tone={group.minSelections > 0 ? 'terracotta' : 'neutral'}>{group.minSelections > 0 ? 'Required' : 'Optional'}</Badge>
            {group.minSelections > group.maxSelections && (
              <Badge tone="terracotta">Minimum exceeds maximum</Badge>
            )}
          </div>
          <div className="vz-row vz-row--wrap" style={{ marginTop: 8, gap: 10 }}>
            <label className="vz-row" style={{ gap: 6, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={group.inheritExtras} onChange={(event) => update(index, { inheritExtras: event.target.checked })} />
              Inherit this choice’s optional extras
            </label>
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
            <CategoryProductPicker
              products={(allProducts.data ?? []).filter((product) => product.active && !product.archived && product.id !== productId)}
              selectedIds={group.options.map((option) => option.productId)}
              onToggle={(product, checked) => toggleOption(index, product, checked)}
            />
          )}
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => setGroups([...groups, blankGroup(groups.length)])}>
        <Plus size={14} /> Add choice group
      </Button>
    </div>
  );
}

/**
 * Category-first product picker: collapsible sections per category so staff
 * tick exactly the products they want without scrolling the whole menu.
 * Search spans every category and auto-expands the sections with matches.
 * `singleSelect` renders rows as click-to-pick buttons (used by Add-from-menu).
 */
function CategoryProductPicker({ products, selectedIds, onToggle, singleSelect }: {
  products: Array<{ id: string; name: string; category: string; price: number }>;
  selectedIds: string[];
  onToggle: (product: { id: string; name: string }, checked: boolean) => void;
  singleSelect?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const sections = useMemo(() => groupProductsByCategory(products, query), [products, query]);
  const searching = query.trim().length > 0;
  const isOpen = (category: string) =>
    searching ? true : open[category] ?? false; // searching auto-expands matches

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 8 }}>
      <div className="vz-row" style={{ gap: 6, marginBottom: 8 }}>
        <Search size={14} style={{ flexShrink: 0, marginTop: 3 }} />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all products…"
          aria-label="Search products"
          style={{ border: 'none', padding: '2px 0', fontSize: '0.85rem', background: 'transparent' }}
        />
        {searching ? (
          <Button type="button" size="sm" variant="ghost" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></Button>
        ) : null}
      </div>
      {sections.length === 0 ? (
        <p className="vz-muted" style={{ fontSize: '0.8rem', margin: '4px 0' }}>No products match.</p>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {sections.map(({ category, items }) => {
            const expanded = isOpen(category);
            const selectedInSection = items.filter((item) => selectedIds.includes(item.id)).length;
            return (
              <div key={category} style={{ borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  className="vz-row vz-row--between"
                  style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 2px', fontSize: '0.85rem', fontWeight: 700 }}
                  aria-expanded={expanded}
                  onClick={() => setOpen((current) => ({ ...current, [category]: !expanded }))}
                >
                  <span className="vz-row" style={{ gap: 6 }}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    📁 {category}
                  </span>
                  <span className="vz-muted" style={{ fontWeight: 400, fontSize: '0.78rem' }}>
                    {selectedInSection ? `${selectedInSection} selected · ` : ''}{items.length} product{items.length === 1 ? '' : 's'}
                  </span>
                </button>
                {expanded ? (
                  <div style={{ padding: '0 2px 6px 20px' }}>
                    {items.map((product) => {
                      const checked = selectedIds.includes(product.id);
                      return singleSelect ? (
                        <button
                          key={product.id}
                          type="button"
                          className="vz-row vz-row--between"
                          style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: '0.82rem' }}
                          onClick={() => onToggle(product, true)}
                        >
                          <span>{product.name}</span>
                          <span className="vz-muted" style={{ fontSize: '0.78rem' }}>Select →</span>
                        </button>
                      ) : (
                        <label key={product.id} className="vz-row" style={{ gap: 6, fontSize: '0.82rem', padding: '2px 0', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => onToggle(product, event.target.checked)}
                          />
                          {product.name}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
