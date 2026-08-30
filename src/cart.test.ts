import { describe, expect, it } from 'vitest';
import { addItem, clearCart, emptyCart, noCharges, removeItem, updateQuantity } from './cart';
import { totals, couponDiscountCents, aud, effectiveUnitPrice, lineUnitPrice } from './lib/money';
import type { CartItem, CartState, Charges, Coupon } from './types';

const item = (overrides: Partial<CartItem> = {}): Omit<CartItem, 'key'> => ({
  productId: 'pasta',
  name: 'Pasta',
  price: 20,
  quantity: 1,
  modifiers: [],
  instructions: '',
  ...overrides,
});

describe('cart reducers', () => {
  it('merges identical product, modifiers and notes', () => {
    const cart = addItem(addItem(emptyCart(), item()), item());
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2);
    expect(cart.items[0].key).toBeTruthy();
  });

  it('keeps different notes and modifiers as separate lines', () => {
    let cart = addItem(emptyCart(), item({ instructions: 'No chilli' }));
    cart = addItem(cart, item({ instructions: 'Extra chilli' }));
    cart = addItem(cart, item({ modifiers: [{ id: 'pesto', name: 'Pesto', price: 3 }] }));
    expect(cart.items).toHaveLength(3);
  });

  it('decreases, removes and clears items', () => {
    let cart = addItem(emptyCart(), item({ quantity: 2 }));
    const key = cart.items[0].key;
    cart = updateQuantity(cart, key, 1);
    expect(cart.items[0].quantity).toBe(1);
    cart = removeItem(cart, key);
    expect(cart.items).toHaveLength(0);
    expect(clearCart(addItem(emptyCart(), item())).items).toHaveLength(0);
  });

  it('uses the line signature as the key so updates address the right line', () => {
    const cart = addItem(emptyCart(), item({ instructions: 'note' }));
    const other = addItem(cart, item({ instructions: 'different' }));
    const updated = updateQuantity(other, cart.items[0].key, 5);
    expect(updated.items.find((line) => line.key === cart.items[0].key)?.quantity).toBe(5);
    expect(updated.items.find((line) => line.key === other.items[1].key)?.quantity).toBe(1);
  });
});

// ── Checkout math — pins the EXACT formula shared with create-checkout ──
const cartWith = (items: Omit<CartItem, 'key'>[], fulfilment: CartState['fulfilment'] = 'Pickup'): CartState => ({
  items: items.map((line, index) => ({ ...line, key: `test-${index}` })),
  fulfilment,
});

describe('checkout totals', () => {
  const charges = (overrides: Partial<Charges> = {}): Charges => ({
    deliveryFee: 0, taxRate: 0, serviceChargeRate: 0, cardFeeRate: 0, ...overrides,
  });

  it('charges nothing when settings have no rates', () => {
    const value = totals(cartWith([item({ price: 23 })]), noCharges);
    expect(value).toEqual({ subtotal: 23, discount: 0, tax: 0, service: 0, delivery: 0, cardFee: 0, total: 23 });
  });

  it('production settings: $23, 5% service, 2.5% card → $24.75', () => {
    const value = totals(cartWith([item({ price: 23 })]), charges({ serviceChargeRate: 5, cardFeeRate: 2.5 }));
    expect(value.subtotal).toBe(23);
    expect(value.service).toBe(1.15);
    expect(value.cardFee).toBe(0.6);
    expect(value.total).toBe(24.75);
  });

  it('documented example: $23 + 5% service + 10% tax + $5 delivery + 1.75% card → $32.00', () => {
    const value = totals(
      cartWith([item({ price: 23 })], 'Delivery'),
      charges({ deliveryFee: 5, taxRate: 10, serviceChargeRate: 5, cardFeeRate: 1.75 }),
    );
    expect(value.service).toBe(1.15);
    expect(value.tax).toBe(2.3);
    expect(value.delivery).toBe(5);
    expect(value.cardFee).toBe(0.55);
    expect(value.total).toBe(32.0);
  });

  it('rounds each line to cents independently (per-cent rounding)', () => {
    const value = totals(cartWith([item({ price: 19.99 }), item({ price: 19.99 })]), charges({ taxRate: 10 }));
    // 2 × 1999 = 3998; tax = 399.8 → 400 → $4.00
    expect(value.subtotal).toBe(39.98);
    expect(value.tax).toBe(4.0);
    expect(value.total).toBe(43.98);
  });

  it('card fee never compounds on itself', () => {
    const value = totals(cartWith([item({ price: 100 })]), charges({ cardFeeRate: 10 }));
    expect(value.cardFee).toBe(10);
    expect(value.total).toBe(110); // not 110 + 11
  });

  it('delivery fee applies to delivery only', () => {
    const charges = { deliveryFee: 5, taxRate: 0, serviceChargeRate: 0, cardFeeRate: 0 };
    expect(totals(cartWith([item({ price: 10 })], 'Pickup'), charges).delivery).toBe(0);
    expect(totals(cartWith([item({ price: 10 })], 'Delivery'), charges).delivery).toBe(5);
  });
});

// ── Coupons — the discount half of the money engine ──

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: 'c1',
  code: 'PASTA10',
  kind: 'percent',
  value: 10,
  minimumOrder: 0,
  productIds: [],
  categoryNames: [],
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  timesUsed: 0,
  active: true,
  ...overrides,
});

describe('coupon discounts', () => {
  it('percent coupons discount the subtotal', () => {
    const cents = couponDiscountCents(coupon({ value: 10 }), [item({ price: 40 })], 4000);
    expect(cents).toBe(400);
  });

  it('fixed coupons are capped at the order value', () => {
    const cents = couponDiscountCents(coupon({ kind: 'fixed', value: 50 }), [item({ price: 30 })], 3000);
    expect(cents).toBe(3000);
  });

  it('respects minimum order', () => {
    expect(couponDiscountCents(coupon({ minimumOrder: 50 }), [item({ price: 30 })], 3000)).toBe(0);
    expect(couponDiscountCents(coupon({ minimumOrder: 50 }), [item({ price: 60 })], 6000)).toBe(600);
  });

  it('respects date window and usage limit', () => {
    const now = new Date('2026-09-01T12:00:00');
    expect(couponDiscountCents(coupon({ startsAt: '2026-09-02T00:00:00' }), [item()], 2000, now)).toBe(0);
    expect(couponDiscountCents(coupon({ endsAt: '2026-08-31T00:00:00' }), [item()], 2000, now)).toBe(0);
    expect(couponDiscountCents(coupon({ usageLimit: 3, timesUsed: 3 }), [item()], 2000, now)).toBe(0);
    expect(couponDiscountCents(coupon({ usageLimit: 3, timesUsed: 2 }), [item()], 2000, now)).toBe(200);
  });

  it('inactive coupons never apply', () => {
    expect(couponDiscountCents(coupon({ active: false }), [item()], 2000)).toBe(0);
  });

  it('charges compound on the discounted subtotal', () => {
    const value = totals(
      cartWith([item({ price: 40 })]),
      { deliveryFee: 0, taxRate: 10, serviceChargeRate: 0, cardFeeRate: 0 },
      coupon({ value: 50 }),
    );
    expect(value.discount).toBe(20);
    expect(value.tax).toBe(2); // 10% of the NET $20, not the gross $40
    expect(value.total).toBe(22);
  });

  it('formats AUD correctly', () => {
    expect(aud(24.75)).toBe('$24.75');
    expect(aud(0)).toBe('$0.00');
  });
});

// ── Combo (bundle) pricing — the $21 Pasta Lunch Combo contract ──
// Base $21 + included choices at $0; only positive upgrades and inherited
// extras add. The child's standalone price NEVER contributes.
describe('combo bundle pricing', () => {
  const comboLine = (overrides: Partial<CartItem> = {}): CartItem => ({
    key: 'k',
    productId: 'combo-1',
    name: 'Pasta Lunch Combo',
    price: 21,
    quantity: 1,
    modifiers: [],
    instructions: '',
    combo: [
      { groupId: 'g-pasta', groupName: 'Choose your pasta', productId: 'p-lasagna', productName: 'Lasagna', upgrade: 0 },
      { groupId: 'g-drink', groupName: 'Choose your drink', productId: 'p-coke', productName: 'Coke', upgrade: 0 },
    ],
    ...overrides,
  });

  it('Example A: $21 combo + included $24 lasagna + included coke = $21', () => {
    expect(lineUnitPrice(comboLine())).toBe(21);
  });

  it('Example B: + $3 inherited extra = $24', () => {
    const line = comboLine({ modifiers: [{ id: 'm-parm', name: 'Parmesan', price: 3 }] });
    expect(lineUnitPrice(line)).toBe(24);
  });

  it('Example C: swapping the pasta (different standalone price) keeps $21', () => {
    const line = comboLine({
      combo: [
        { groupId: 'g-pasta', groupName: 'Choose your pasta', productId: 'p-carbonara', productName: 'Carbonara', upgrade: 0 },
        { groupId: 'g-drink', groupName: 'Choose your drink', productId: 'p-pepsi', productName: 'Pepsi', upgrade: 0 },
      ],
    });
    expect(lineUnitPrice(line)).toBe(21);
  });

  it('a paid upgrade adds exactly its configured price', () => {
    const line = comboLine({
      combo: [
        { groupId: 'g-pasta', groupName: 'Choose your pasta', productId: 'p-lasagna', productName: 'Lasagna', upgrade: 0 },
        { groupId: 'g-drink', groupName: 'Choose your drink', productId: 'p-redbull', productName: 'Red Bull', upgrade: 3 },
      ],
    });
    expect(lineUnitPrice(line)).toBe(24);
  });

  it('identical combo selections merge; different selections stay separate lines', () => {
    const first = addItem(emptyCart(), comboLine({ key: 'a' }));
    const same = addItem(first, comboLine({ key: 'b', instructions: '' }));
    expect(same.items).toHaveLength(1);
    expect(same.items[0].quantity).toBe(2);
    const different = addItem(first, comboLine({
      key: 'c',
      combo: [
        { groupId: 'g-pasta', groupName: 'Choose your pasta', productId: 'p-pesto', productName: 'Pesto', upgrade: 0 },
        { groupId: 'g-drink', groupName: 'Choose your drink', productId: 'p-coke', productName: 'Coke', upgrade: 0 },
      ],
    }));
    expect(different.items).toHaveLength(2);
  });

  it('combo lines total with charges exactly like ordinary lines', () => {
    const value = totals(
      { ...emptyCart(), items: [comboLine()] },
      { deliveryFee: 0, taxRate: 10, serviceChargeRate: 0, cardFeeRate: 0 },
      null,
    );
    expect(value.subtotal).toBe(21);
    expect(value.tax).toBe(2.1);
    expect(value.total).toBe(23.1);
  });
});

// ── Pricing modes: adjustments add; overrides replace (pizza sizes) ──
describe('modifier pricing modes', () => {
  it('override replaces the base price; $0 override keeps the base', () => {
    expect(effectiveUnitPrice(14, [{ id: 'm1', name: 'Large', price: 19, priceMode: 'override' }])).toBe(19);
    expect(effectiveUnitPrice(14, [{ id: 'm1', name: 'Small', price: 0, priceMode: 'override' }])).toBe(14);
  });

  it('adjustments still add, including after an override', () => {
    expect(effectiveUnitPrice(14, [
      { id: 'm1', name: 'Large', price: 19, priceMode: 'override' },
      { id: 'm2', name: 'Extra cheese', price: 2 },
    ])).toBe(21);
  });

  it('legacy carts without priceMode keep pure additive behaviour', () => {
    expect(effectiveUnitPrice(14, [{ id: 'm2', name: 'Extra cheese', price: 2 }])).toBe(16);
  });
});
