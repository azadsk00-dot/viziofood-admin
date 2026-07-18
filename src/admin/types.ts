export type OrderStatus='New'|'Accepted'|'Preparing'|'Ready'|'Completed'|'Cancelled';
export interface Product{[key:string]:any;id:string;name:string;category:string;price:number;active:boolean;available?:boolean;featured?:boolean;popular?:boolean;vegetarian?:boolean;vegan?:boolean;halal?:boolean;glutenFree?:boolean;spicyLevel?:number;preparationTime?:number;calories?:number|null;ingredients?:string[];allergens?:string[];displayOrder?:number;imageUrl?:string|null;galleryImages?:string[];archivedAt?:string|null;description:string}
export interface Order{id:string;customer:string;email:string;total:number;status:OrderStatus;createdAt:string;items:number;notes?:string}
export interface Customer{id:string;name:string;email:string;orders:number;spend:number;lastOrder:string}
export interface RestaurantSettings{name:string;address:string;phone:string;email:string;deliveryFee:number;taxRate:number;hours:string;instagram:string}
