/**
 * Menu page — fully database-driven. Category filters follow the admin's
 * category order; every product card opens the customizer modal when it has
 * modifier groups (required groups block Add-to-cart until satisfied), and
 * adds straight to the cart otherwise. Ordering pauses block adds but never
 * browsing.
 */

import { useMemo, useState } from 'react';
import { Leaf, WheatOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { useCart } from '../context/CartProvider';
import { useToast } from '../components/Toast';
import { useProducts } from '../hooks/useProducts';
import { useRestaurantSettings } from '../hooks/useRestaurantSettings';
import type { CustomerProduct, PublicModifierGroup } from '../services/products';
import { Badge, Button, Card, EmptyState, ErrorBox, Modal, Skeleton, Textarea } from '../ui';
import { aud } from '../lib/money';

function ModifierGroup({
  group,
  selected,
  onToggle,
}: {
  group: PublicModifierGroup;
  selected: Set<string>;
  onToggle: (optionId: string) => void;
}) {
  const isSingle = group.minSelections === 1 && group.maxSelections === 1;
  const atMax = group.maxSelections > 0 && [...selected].filter((id) => group.options.some((o) => o.id === id)).length >= group.maxSelections;

  return (
    <div className="mod-group">
      <div className="mod-group__head">
        <span className="mod-group__name">{group.name}</span>
        <span className="mod-group__rule">
          {group.required
            ? isSingle
              ? 'Choose one'
              : `Choose ${group.minSelections}${group.maxSelections > group.minSelections ? `–${group.maxSelections}` : ''}`
            : 'Optional'}
        </span>
      </div>
      <div className="mod-options">
        {group.options.map((option) => {
          const checked = selected.has(option.id);
          return (
            <label key={option.id} className={`mod-option ${checked ? 'is-checked' : ''}`}>
              <input
                type={isSingle ? 'radio' : 'checkbox'}
                name={group.id}
                checked={checked}
                onChange={() => {
                  if (isSingle) {
                    group.options.forEach((o) => selected.delete(o.id));
                    onToggle(option.id);
                    return;
                  }
                  if (!checked && atMax) return; // max enforced silently; rule shown in header
                  onToggle(option.id);
                }}
              />
              <span className="mod-option__name">{option.name}</span>
              {option.price > 0 && <span className="mod-option__price">+{aud(option.price)}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Customizer({
  product,
  groups,
  onClose,
}: {
  product: CustomerProduct;
  groups: PublicModifierGroup[];
  onClose: () => void;
}) {
  const { addItem } = useCart();
  const toast = useToast();
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, Set<string>>>({});
  const [instructions, setInstructions] = useState('');

  const toggle = (groupId: string, optionId: string) => {
    setSelectedByGroup((current) => {
      const set = new Set(current[groupId] ?? []);
      if (set.has(optionId)) set.delete(optionId);
      else set.add(optionId);
      return { ...current, [groupId]: set };
    });
  };

  const collect = () =>
    groups.flatMap((group) =>
      [...(selectedByGroup[group.id] ?? [])]
        .map((id) => group.options.find((o) => o.id === id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map((o) => ({ id: o.id, name: o.name, price: o.price })),
    );

  const unsatisfied = groups.filter((group) => group.required && (selectedByGroup[group.id] ?? new Set()).size < group.minSelections);
  const modifiers = collect();
  const unitPrice = product.price + modifiers.reduce((sum, m) => sum + m.price, 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontWeight: 800, fontSize: '1.05rem' }}>{aud(unitPrice)}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={unsatisfied.length > 0}
            onClick={() => {
              addItem({
                productId: product.id,
                name: product.name,
                price: product.price,
                quantity: 1,
                modifiers,
                instructions: instructions.trim(),
              });
              toast.show(`${product.name} added to your order`);
              onClose();
            }}
          >
            Add to order
          </Button>
        </>
      }
    >
      {product.description && <p className="vz-muted" style={{ marginTop: 0 }}>{product.description}</p>}
      {groups.map((group) => (
        <ModifierGroup
          key={group.id}
          group={group}
          selected={selectedByGroup[group.id] ?? new Set()}
          onToggle={(optionId) => toggle(group.id, optionId)}
        />
      ))}
      <div className="vz-field">
        <label className="vz-field__label" htmlFor="special-instructions">Special instructions</label>
        <Textarea
          id="special-instructions"
          placeholder="Allergies, extra care, a birthday…"
          value={instructions}
          maxLength={500}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>
      {unsatisfied.length > 0 && (
        <p className="vz-field__error" role="alert">
          Choose {unsatisfied.map((g) => g.name).join(', ')} to continue.
        </p>
      )}
    </Modal>
  );
}

export default function Menu() {
  const { products, categories, modifierGroupsByProduct, loading, error, retry } = useProducts();
  const { settings } = useRestaurantSettings();
  const { addItem } = useCart();
  const toast = useToast();
  const [filter, setFilter] = useState<string>('All');
  const [customizing, setCustomizing] = useState<CustomerProduct | null>(null);

  const visible = useMemo(
    () => (filter === 'All' ? products : products.filter((p) => p.category.toLowerCase() === filter.toLowerCase())),
    [products, filter],
  );

  const add = (product: CustomerProduct) => {
    if (settings && !settings.ordersEnabled) {
      toast.show(settings.orderPauseMessage || 'Online ordering is paused right now.', { type: 'error' });
      return;
    }
    const groups = modifierGroupsByProduct[product.id] ?? [];
    if (groups.length > 0) {
      setCustomizing(product);
      return;
    }
    addItem({ productId: product.id, name: product.name, price: product.price, quantity: 1, modifiers: [], instructions: '' });
    toast.show(`${product.name} added to your order`);
  };

  return (
    <div className="vz-container vz-section" style={{ paddingTop: 'clamp(28px, 5vw, 54px)' }}>
      <p className="vz-eyebrow">Our menu</p>
      <h1 style={{ marginBottom: 6 }}>Made with intention.</h1>
      <p className="vz-muted" style={{ maxWidth: '52ch' }}>
        Seasonal ingredients, Italian technique, no unnecessary fuss.
      </p>

      <div className="menu-filter" role="group" aria-label="Menu categories">
        <button className={filter === 'All' ? 'is-active' : ''} onClick={() => setFilter('All')}>All</button>
        {categories.map((category) => (
          <button
            key={category.id}
            className={filter === category.name ? 'is-active' : ''}
            onClick={() => setFilter(category.name)}
          >
            {category.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="menu-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="menu-item">
              <Skeleton height={175} style={{ borderRadius: 0 }} />
              <div style={{ padding: 16 }}>
                <Skeleton height={20} width="70%" />
                <Skeleton height={14} width="90%" style={{ marginTop: 8 }} />
              </div>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="vz-stack">
          <ErrorBox>{error}</ErrorBox>
          <div><Button variant="secondary" onClick={() => void retry()}>Try again</Button></div>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing on this section yet">Check another category.</EmptyState>
      ) : (
        <div className="menu-grid">
          {visible.map((product, index) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.04, 0.3) }}
            >
              <Card className="menu-item">
                <div className="menu-item__image">
                  {product.imageUrl && <img src={product.imageUrl} alt={product.name} loading="lazy" />}
                  <div className="menu-item__flags">
                    {product.popular && <Badge tone="gold">Popular</Badge>}
                    {product.vegetarian && <Badge tone="olive" dot>Vegetarian</Badge>}
                    {product.glutenFree && <Badge tone="info" dot>GF</Badge>}
                  </div>
                </div>
                <div className="menu-item__body">
                  <div className="menu-item__name">{product.name}</div>
                  <div className="menu-item__desc">{product.description}</div>
                  <div className="menu-item__foot">
                    <span className="menu-item__price">{aud(product.price)}</span>
                    <Button size="sm" onClick={() => add(product)}>
                      {(modifierGroupsByProduct[product.id] ?? []).length > 0 ? 'Customize' : 'Add'}
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <p className="vz-muted" style={{ marginTop: 34, textAlign: 'center' }}>
        GF pasta available on request. Please let us know about any allergies.
      </p>

      {customizing && (
        <Customizer
          product={customizing}
          groups={modifierGroupsByProduct[customizing.id] ?? []}
          onClose={() => setCustomizing(null)}
        />
      )}
    </div>
  );
}
