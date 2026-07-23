import type { Order } from './types';

/** Vendor-neutral payload for a future kitchen-printer adapter. */
export interface KitchenPrintJob {
  orderId: string;
  orderNumber: string;
  fulfilment: Order['fulfilment'];
  customer: string;
  lines: Array<{ quantity:number; name:string; modifiers:string[]; notes:string }>;
  notes: string;
  createdAt: string;
}

export function createKitchenPrintJob(order: Order): KitchenPrintJob {
  return { orderId:order.orderId, orderNumber:order.orderNumber, fulfilment:order.fulfilment, customer:order.customer, lines:order.items.map(item=>({quantity:item.quantity,name:item.name,modifiers:item.modifiers,notes:item.notes})), notes:order.notes, createdAt:order.createdAt };
}
