/**
 * Integer-cent money math. THE authoritative checkout formula for every
 * client (web display, Edge Function charging, future mobile apps).
 *
 * All inputs are AUD decimal amounts as stored in the DB; internally every
 * value is converted to cents and rounded independently so the displayed
 * total is bit-identical to the amount create-checkout charges. Never use
 * floating-point accumulation here.
 *
 * Formula, applied top to bottom:
 *   subtotal  = Σ round((unit price + modifier prices) × 100) × quantity
 *   discount  = coupon: percent → round(subtotal × value/100)
 *               fixed → min(round(value×100), subtotal) (never below zero)
 *               product/category coupons discount only matching lines
 *   service   = round((subtotal − discount) × serviceChargeRate%)
 *   tax       = round((subtotal − discount) × taxRate%)   (tax basis: discounted subtotal)
 *   delivery  = fixed fee, Delivery fulfilment only
 *   card fee  = round((subtotal − discount + service + tax + delivery) × cardFeeRate%)
 *               (base excludes the card fee itself — no circular math)
 *   total     = subtotal − discount + service + tax + delivery + card fee
 * Each component is rounded to cents independently, exactly as printed.
 */

import type { CartItem, CartModifier, CartState, Charges, ChargeBreakdown, Coupon } from '../types';

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

/** The cart-line shape the math needs — with or without the runtime `key`. */
export type CartLine = Pick<CartItem, 'productId' | 'name' | 'price' | 'quantity' | 'modifiers'>;

export const emptyCharges: Charges = {
  deliveryFee: 0,
  taxRate: 0,
  serviceChargeRate: 0,
  cardFeeRate: 0,
};

const lineSubtotalCents = (item: CartLine): number => {
  const unitCents = toCents(item.price) + item.modifiers.reduce((sum, m) => sum + toCents(m.price), 0);
  return unitCents * item.quantity;
};

/** Cart lines a coupon applies to. Empty result → coupon not applicable. */
export const couponApplicableItems = (coupon: Coupon, items: readonly CartLine[]): CartLine[] => {
  const byProduct = coupon.productIds.length > 0;
  const byCategory = coupon.categoryNames.length > 0;
  if (!byProduct && !byCategory) return [...items];
  return items.filter(
    (item) =>
      (!byProduct || coupon.productIds.includes(item.productId)) &&
      // Category-scoped coupons fall back to name matching on the cart line;
      // the server re-checks against the authoritative product row.
      (!byCategory || coupon.categoryNames.some((c) => c.toLowerCase() === item.name.toLowerCase())),
  );
};

/**
 * Discount in cents for a coupon applied to a cart. Returns 0 when the
 * coupon does not apply (minimum order unmet, no matching lines, inactive,
 * outside its date window, or exhausted usage limit).
 */
export const couponDiscountCents = (
  coupon: Pick<Coupon, 'kind' | 'value' | 'minimumOrder' | 'active' | 'startsAt' | 'endsAt' | 'usageLimit' | 'timesUsed' | 'productIds' | 'categoryNames'> | null | undefined,
  items: readonly CartLine[],
  subtotalCents: number,
  now: Date = new Date(),
): number => {
  if (!coupon || !coupon.active) return 0;
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return 0;
  if (coupon.endsAt && now > new Date(coupon.endsAt)) return 0;
  if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) return 0;
  if (subtotalCents < toCents(coupon.minimumOrder)) return 0;

  const scoped = couponApplicableItems({ ...(coupon as Coupon), id: '', code: '' }, items);
  const basis = scoped.length ? scoped.reduce((sum, item) => sum + lineSubtotalCents(item), 0) : 0;
  if (basis <= 0) return 0;

  const discount =
    coupon.kind === 'percent'
      ? Math.round((basis * coupon.value) / 100)
      : Math.min(toCents(coupon.value), basis);
  // Never discount more than the whole order.
  return Math.min(discount, subtotalCents);
};

export const totals = (
  cart: CartState,
  charges: Charges = emptyCharges,
  coupon: Coupon | null = null,
): ChargeBreakdown => {
  const subtotalCents = cart.items.reduce((sum, item) => sum + lineSubtotalCents(item), 0);
  const discountCents = couponDiscountCents(coupon, cart.items, subtotalCents);
  const netSubtotalCents = subtotalCents - discountCents;

  const serviceCents = Math.round((netSubtotalCents * charges.serviceChargeRate) / 100);
  const taxCents = Math.round((netSubtotalCents * charges.taxRate) / 100);
  const deliveryCents = cart.fulfilment === 'Delivery' ? toCents(charges.deliveryFee) : 0;
  const cardCents = Math.round(
    ((netSubtotalCents + serviceCents + taxCents + deliveryCents) * charges.cardFeeRate) / 100,
  );

  return {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    service: fromCents(serviceCents),
    tax: fromCents(taxCents),
    delivery: fromCents(deliveryCents),
    cardFee: fromCents(cardCents),
    total: fromCents(netSubtotalCents + serviceCents + taxCents + deliveryCents + cardCents),
  };
};

/** AUD currency formatting for display. */
export const aud = (amount: number): string =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);
