export type ProductVisibility = 'public' | 'hidden' | 'private';

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  sku: string;
  active: boolean;
  available: boolean;
  featured: boolean;
  popular: boolean;
  archived: boolean;
  archivedAt: string | null;
  vegetarian: boolean;
  vegan: boolean;
  halal: boolean;
  glutenFree: boolean;
  preparationTime: number;
  calories: number | null;
  ingredients: string[];
  allergens: string[];
  tags: string[];
  displayOrder: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  gallery: string[];
  visibility: ProductVisibility;
  internalNotes: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export type ProductDraft = Omit<Product, 'id' | 'createdBy' | 'updatedBy'>;
export type OrderStatus = 'New' | 'Accepted' | 'Preparing' | 'Ready' | 'Completed' | 'Rejected';
export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'refunded' | 'unknown';
export interface OrderItem { id:string; name:string; quantity:number; unitPrice:number; modifiers:string[]; notes:string }
export interface Order { orderId:string; orderNumber:string; customer:string; email:string; phone:string; fulfilment:'Pickup'|'Delivery'; paymentStatus:PaymentStatus; total:number; status:OrderStatus; createdAt:string; items:OrderItem[]; itemsCount:number; notes:string }
export interface Customer { id:string; name:string; email:string; orders:number; spend:number; lastOrder:string }
export interface RestaurantSettings { name:string; address:string; phone:string; email:string; deliveryFee:number; taxRate:number; hours:string; instagram:string }
