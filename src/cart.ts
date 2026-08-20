export type CartModifier={id:string;name:string;price:number};export type CartItem={key:string;productId:string;name:string;price:number;quantity:number;modifiers:CartModifier[];instructions:string};export type Fulfilment='Pickup'|'Delivery';export type CartState={items:CartItem[];fulfilment:Fulfilment;coupon?:string};
// Configurable checkout charges, sourced from restaurant_settings (Admin →
// Settings → Delivery & Charges). Percentages are expressed in percent units
// (e.g. 10 = 10%); deliveryFee is a fixed AUD amount.
export type Charges={deliveryFee:number;taxRate:number;serviceChargeRate:number;cardFeeRate:number};
export const noCharges:Charges={deliveryFee:0,taxRate:0,serviceChargeRate:0,cardFeeRate:0};
const KEY='vizio-food-cart';export const emptyCart=():CartState=>({items:[],fulfilment:'Pickup'});
const normalizedModifiers=(items:CartModifier[])=>[...items].sort((a,b)=>a.id.localeCompare(b.id));const signature=(item:Pick<CartItem,'productId'|'modifiers'|'instructions'>)=>JSON.stringify({productId:item.productId,modifiers:normalizedModifiers(item.modifiers).map(m=>m.id),instructions:item.instructions.trim()});
export const addItem=(cart:CartState,item:CartItem):CartState=>{const key=signature(item);const matching=cart.items.findIndex(existing=>signature(existing)===key);if(matching<0)return{...cart,items:[...cart.items,{...item,modifiers:normalizedModifiers(item.modifiers),instructions:item.instructions.trim()}]};return{...cart,items:cart.items.map((existing,index)=>index===matching?{...existing,quantity:existing.quantity+item.quantity}:existing)}};
export const updateQuantity=(cart:CartState,key:string,quantity:number):CartState=>quantity<1?removeItem(cart,key):{...cart,items:cart.items.map(item=>item.key===key?{...item,quantity}:item)};export const removeItem=(cart:CartState,key:string):CartState=>({...cart,items:cart.items.filter(item=>item.key!==key)});export const clearCart=(cart:CartState):CartState=>({...cart,items:[]});
export const readCart=():CartState=>{try{const parsed=JSON.parse(localStorage.getItem(KEY)??'null') as Partial<CartState>|null;if(!parsed||!Array.isArray(parsed.items))return emptyCart();return{items:parsed.items.map(item=>({...item,modifiers:Array.isArray(item.modifiers)?item.modifiers:[],instructions:typeof item.instructions==='string'?item.instructions:''})),fulfilment:parsed.fulfilment==='Delivery'?'Delivery':'Pickup',coupon:parsed.coupon}}catch{return emptyCart()}};export const writeCart=(cart:CartState)=>localStorage.setItem(KEY,JSON.stringify(cart));// Integer-cent arithmetic keeps the displayed total bit-identical to the
// amount create-checkout charges (it mirrors this math server-side, reading
// the same restaurant_settings row). Formula, applied top to bottom:
//   subtotal  = Σ round((unit price + modifier prices) × 100) × quantity
//   service   = round(subtotal × serviceChargeRate%)
//   tax       = round(subtotal × taxRate%)            (tax basis: subtotal)
//   delivery  = fixed fee, Delivery fulfilment only
//   card fee  = round((subtotal + service + tax + delivery) × cardFeeRate%)
//               (base excludes the card fee itself — no circular math)
//   total     = subtotal + service + tax + delivery + card fee
// Each component is rounded to cents independently, exactly as printed.
export const totals=(cart:CartState,charges:Charges=noCharges)=>{const subtotalCents=cart.items.reduce((sum,item)=>sum+Math.round((item.price+item.modifiers.reduce((s,m)=>s+m.price,0))*100)*item.quantity,0);const serviceCents=Math.round(subtotalCents*charges.serviceChargeRate/100);const taxCents=Math.round(subtotalCents*charges.taxRate/100);const deliveryCents=cart.fulfilment==='Delivery'?Math.round(charges.deliveryFee*100):0;const cardCents=Math.round((subtotalCents+serviceCents+taxCents+deliveryCents)*charges.cardFeeRate/100);return{subtotal:subtotalCents/100,service:serviceCents/100,tax:taxCents/100,delivery:deliveryCents/100,cardFee:cardCents/100,total:(subtotalCents+serviceCents+taxCents+deliveryCents+cardCents)/100}};
