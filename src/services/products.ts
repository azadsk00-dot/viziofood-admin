import { supabase, supabaseConfigurationError } from '../lib/supabase';
export type ProductCategory='Pasta'|'Coffee'|'Extras'|string;
export interface CustomerProduct{id:string;name:string;description:string;price:number;category:ProductCategory;categoryId:string|null;active:boolean;available:boolean;featured:boolean;popular:boolean;vegetarian:boolean;vegan:boolean;glutenFree:boolean;halal:boolean;createdAt:string;updatedAt:string;imageUrl:string|null;preparationTime:number;displayOrder:number}
export interface MenuCategory{id:string;name:string}
const client=()=>{if(!supabase)throw new Error(supabaseConfigurationError);return supabase};
export async function fetchActiveProducts():Promise<CustomerProduct[]>{const {data,error}=await client().from('products').select('id,name,description,price,category,category_id,active,available,featured,popular,vegetarian,vegan,gluten_free,halal,created_at,updated_at,image_url,preparation_time,display_order').eq('active',true).eq('available',true).is('archived_at',null).order('display_order').order('name');if(error){console.error(error);throw error}return(data??[]).map(row=>({id:String(row.id),name:String(row.name),description:String(row.description??''),price:Number(row.price),category:String(row.category??'Pasta'),categoryId:row.category_id?String(row.category_id):null,active:Boolean(row.active),available:Boolean(row.available),featured:Boolean(row.featured),popular:Boolean(row.popular),vegetarian:Boolean(row.vegetarian),vegan:Boolean(row.vegan),glutenFree:Boolean(row.gluten_free),halal:Boolean(row.halal),createdAt:String(row.created_at),updatedAt:String(row.updated_at),imageUrl:row.image_url?String(row.image_url):null,preparationTime:Number(row.preparation_time??15),displayOrder:Number(row.display_order??0)}))}
// Active categories in the admin-controlled display order (Admin →
// Categories). Drives the menu's section buttons and product ordering.
export async function fetchActiveCategories():Promise<MenuCategory[]>{const {data,error}=await client().from('categories').select('id,name,display_order').eq('active',true).order('display_order').order('name');if(error){console.error(error);throw error}return(data??[]).map(row=>({id:String(row.id),name:String(row.name)}))}
// Modifier groups assigned to each product, for the add-to-cart dialog. RLS
// hides deactivated groups/options from the public client; groups with no
// active options are dropped so they can never block the customer.
export interface PublicModifierOption{id:string;name:string;price:number}
export interface PublicModifierGroup{id:string;name:string;required:boolean;minSelections:number;maxSelections:number;options:PublicModifierOption[]}
export async function fetchProductModifierGroups():Promise<Record<string,PublicModifierGroup[]>>{
  const c=client();
  const [linksResult,optionsResult]=await Promise.all([
    c.from('product_modifier_groups').select('product_id,display_order,modifier_groups!inner(id,name,required,min_selections,max_selections)').eq('modifier_groups.active',true).order('display_order'),
    c.from('modifiers').select('id,group_id,name,price,display_order').eq('active',true).order('display_order').order('name')
  ]);
  if(linksResult.error){console.error(linksResult.error);throw linksResult.error}
  if(optionsResult.error){console.error(optionsResult.error);throw optionsResult.error}
  const optionsByGroup=new Map<string,PublicModifierOption[]>();
  for(const row of optionsResult.data??[]){if(!row.group_id)continue;const groupId=String(row.group_id);const list=optionsByGroup.get(groupId)??[];list.push({id:String(row.id),name:String(row.name),price:Number(row.price)});optionsByGroup.set(groupId,list)}
  const map:Record<string,PublicModifierGroup[]>={};
  for(const row of linksResult.data??[]){
    const group=(row.modifier_groups??null) as unknown as {id:string;name:string;required:boolean;min_selections:number;max_selections:number}|null;
    if(!row.product_id||!group?.id)continue;
    const options=optionsByGroup.get(String(group.id))??[];
    if(!options.length)continue;
    const productId=String(row.product_id);
    (map[productId]??=[]).push({id:String(group.id),name:String(group.name),required:group.required===true,minSelections:Number(group.min_selections??0),maxSelections:Number(group.max_selections??0),options});
  }
  return map;
}
