/**
 * Cart domain logic — pure reducers with localStorage persistence.
 * Monetary math lives in lib/money.ts; cart.ts owns identity and shape.
 *
 * A line's `key` is its deterministic signature (product + sorted modifier
 * ids + trimmed instructions), so identical adds merge, and quantity
 * updates/removals always address the right line.
 */

import type { CartItem, CartModifier, CartState, Charges, ChargeBreakdown, Coupon, Fulfilment } from './types';
import { totals } from './lib/money';

const STORAGE_KEY = 'vizio-food-cart';

export const emptyCart = (): CartState => ({ items: [], fulfilment: 'Pickup' });

const normalizedModifiers = (items: CartModifier[]): CartModifier[] =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

/** Deterministic line identity — also used as the cart item key. */
export const lineKey = (item: Pick<CartItem, 'productId' | 'modifiers' | 'instructions'>): string =>
  JSON.stringify({
    productId: item.productId,
    modifiers: normalizedModifiers(item.modifiers).map((m) => m.id),
    instructions: item.instructions.trim(),
  });

export const addItem = (cart: CartState, item: Omit<CartItem, 'key'>): CartState => {
  const key = lineKey(item);
  const normalized: CartItem = {
    ...item,
    key,
    modifiers: normalizedModifiers(item.modifiers),
    instructions: item.instructions.trim(),
  };
  const existing = cart.items.findIndex((line) => line.key === key);
  if (existing < 0) return { ...cart, items: [...cart.items, normalized] };
  return {
    ...cart,
    items: cart.items.map((line, index) =>
      index === existing ? { ...line, quantity: line.quantity + item.quantity } : line,
    ),
  };
};

export const updateQuantity = (cart: CartState, key: string, quantity: number): CartState =>
  quantity < 1
    ? removeItem(cart, key)
    : { ...cart, items: cart.items.map((item) => (item.key === key ? { ...item, quantity } : item)) };

export const removeItem = (cart: CartState, key: string): CartState => ({
  ...cart,
  items: cart.items.filter((item) => item.key !== key),
});

export const clearCart = (cart: CartState): CartState => ({ ...cart, items: [] });

/** Defensive localStorage read — corrupt data degrades to an empty cart. */
export const readCart = (): CartState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<CartState> | null;
    if (!parsed || !Array.isArray(parsed.items)) return emptyCart();
    return {
      items: parsed.items.map((item) => ({
        ...item,
        modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
        instructions: typeof item.instructions === 'string' ? item.instructions : '',
      })),
      fulfilment: parsed.fulfilment === 'Delivery' ? 'Delivery' : 'Pickup',
      couponCode: typeof parsed.couponCode === 'string' ? parsed.couponCode : undefined,
    };
  } catch {
    return emptyCart();
  }
};

export const writeCart = (cart: CartState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Storage full or unavailable — the in-memory cart still works.
  }
};

// Re-exported so existing imports keep working; see lib/money.ts for the formula.
export { totals };
export type { Charges, ChargeBreakdown, Coupon, CartItem, CartState, CartModifier, Fulfilment };
export const noCharges: Charges = { deliveryFee: 0, taxRate: 0, serviceChargeRate: 0, cardFeeRate: 0 };
