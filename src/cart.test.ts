import { describe, expect, it } from 'vitest'; import { addItem, clearCart, emptyCart, noCharges, removeItem, totals, updateQuantity, type CartItem, type CartState, type Charges } from './cart';
const item=(overrides:Partial<CartItem>={}):CartItem=>({key:'a',productId:'pasta',name:'Pasta',price:20,quantity:1,modifiers:[],instructions:'',...overrides});
describe('cart reducers',()=>{it('merges identical product, modifiers and notes',()=>{const cart=addItem(addItem(emptyCart(),item()),item({key:'b'}));expect(cart.items).toHaveLength(1);expect(cart.items[0].quantity).toBe(2)});it('keeps different notes and modifiers as separate lines',()=>{let cart=addItem(emptyCart(),item({instructions:'No chilli'}));cart=addItem(cart,item({key:'b',instructions:'Extra chilli'}));cart=addItem(cart,item({key:'c',modifiers:[{id:'pesto',name:'Pesto',price:3}]}));expect(cart.items).toHaveLength(3)});it('decreases, removes and clears items',()=>{let cart=addItem(emptyCart(),item({quantity:2}));cart=updateQuantity(cart,'a',1);expect(cart.items[0].quantity).toBe(1);cart=removeItem(cart,'a');expect(cart.items).toHaveLength(0);expect(clearCart(addItem(emptyCart(),item())).items).toHaveLength(0)});});

// Shared checkout calculation — mirrors the create-checkout Edge Function
// formula. No rate is hardcoded anywhere; these tests pin the math itself.
const cartWith=(items:CartItem[],fulfilment:CartState['fulfilment']='Pickup'):CartState=>({items,fulfilment});
const money=(cents:number)=>cents/100;
describe('checkout totals',()=>{
  const charges=(overrides:Partial<Charges>={}):Charges=>({deliveryFee:0,taxRate:0,serviceChargeRate:0,cardFeeRate:0,...overrides});
  it('charges nothing by default when settings have no rates',()=>{
    const value=totals(cartWith([item({price:23})]),noCharges);
    expect(value).toEqual({subtotal:23,tax:0,service:0,delivery:0,cardFee:0,total:23});
  });
  it('production settings: $23, 0% tax, 5% service, 2.5% card, $0 delivery → $24.75',()=>{
    const value=totals(cartWith([item({price:23})]),charges({deliveryFee:0,taxRate:0,serviceChargeRate:5,cardFeeRate:2.5}));
    expect(value.subtotal).toBe(23);
    expect(value.service).toBe(1.15);
    expect(value.tax).toBe(0);
    expect(value.delivery).toBe(0);
    expect(value.cardFee).toBe(0.6); // 2.5% of (23 + 1.15) = 60.375c → 60c
    expect(value.total).toBe(24.75);
  });
  it('10% tax appears ONLY when the database rate is 10 (legacy parity check)',()=>{
    const value=totals(cartWith([item({price:23})]),charges({deliveryFee:0,taxRate:10,serviceChargeRate:0,cardFeeRate:0}));
    expect(value.tax).toBe(2.3);
    expect(value.total).toBe(25.3);
  });
  it('applies a configurable tax rate instead of a hardcoded 10%',()=>{
    const twenty=totals(cartWith([item({price:23})]),charges({taxRate:50}));
    expect(money(Math.round(twenty.tax*100))).toBe(11.5); // 50% of $23
    const ten=totals(cartWith([item({price:23})]),charges({taxRate:10}));
    expect(ten.tax).toBe(2.3); // matches the previous 10% behaviour
  });
  it('computes the documented example: $23 subtotal, 5% service, 10% tax, $5 delivery, 1.75% card fee',()=>{
    const value=totals(cartWith([item({price:23})],'Delivery'),charges({deliveryFee:5,taxRate:10,serviceChargeRate:5,cardFeeRate:1.75}));
    expect(value.subtotal).toBe(23);
    expect(value.service).toBe(1.15);
    expect(value.tax).toBe(2.3);
    expect(value.delivery).toBe(5);
    expect(value.cardFee).toBe(0.55); // 1.75% of (23 + 1.15 + 2.30 + 5) = $55.04c → 55c
    expect(value.total).toBe(32);
  });
  it('bases the card fee on the pre-card-fee amount (no circular calculation)',()=>{
    const onlyCard=totals(cartWith([item({price:100})]),charges({cardFeeRate:10}));
    expect(onlyCard.cardFee).toBe(10); // 10% of 100, not of 110
    expect(onlyCard.total).toBe(110);
  });
  it('charges delivery only for Delivery fulfilment and rounds each line to cents',()=>{
    const pickup=totals(cartWith([item({price:19.99,quantity:1})]),charges({deliveryFee:5}));
    expect(pickup.delivery).toBe(0);
    const delivery=totals(cartWith([item({price:19.99})],'Delivery'),charges({deliveryFee:5}));
    expect(delivery.delivery).toBe(5);
    const thirds=totals(cartWith([item({price:0.01,quantity:3})]),charges({taxRate:10}));
    // subtotal 3c → tax = round(0.3c) = 0c; nothing drifts into fractions of a cent
    expect(thirds.tax).toBe(0);
    expect(thirds.total).toBe(0.03);
  });
});
