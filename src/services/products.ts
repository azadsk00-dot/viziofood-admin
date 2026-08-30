import { supabase, supabaseConfigurationError } from '../lib/supabase';
export type ProductCategory='Pasta'|'Coffee'|'Extras'|string;
export interface CustomerProduct{id:string;name:string;description:string;price:number;category:ProductCategory;categoryId:string|null;active:boolean;available:boolean;featured:boolean;popular:boolean;vegetarian:boolean;vegan:boolean;glutenFree:boolean;halal:boolean;createdAt:string;updatedAt:string;imageUrl:string|null;preparationTime:number;displayOrder:number;isCombo:boolean}
export interface MenuCategory{id:string;name:string}
const client=()=>{if(!supabase)throw new Error(supabaseConfigurationError);return supabase};
export async function fetchActiveProducts():Promise<CustomerProduct[]>{const {data,error}=await client().from('products').select('id,name,description,price,category,category_id,active,available,featured,popular,vegetarian,vegan,gluten_free,halal,created_at,updated_at,image_url,preparation_time,display_order,is_combo').eq('active',true).eq('available',true).is('archived_at',null).order('display_order').order('name');if(error){console.error(error);throw error}return(data??[]).map(row=>({id:String(row.id),name:String(row.name),description:String(row.description??''),price:Number(row.price),category:String(row.category??'Pasta'),categoryId:row.category_id?String(row.category_id):null,active:Boolean(row.active),available:Boolean(row.available),featured:Boolean(row.featured),popular:Boolean(row.popular),vegetarian:Boolean(row.vegetarian),vegan:Boolean(row.vegan),glutenFree:Boolean(row.gluten_free),halal:Boolean(row.halal),createdAt:String(row.created_at),updatedAt:String(row.updated_at),imageUrl:row.image_url?String(row.image_url):null,preparationTime:Number(row.preparation_time??15),displayOrder:Number(row.display_order??0),isCombo:row.is_combo===true}))}
// Active categories in the admin-controlled display order (Admin →
// Categories). Drives the menu's section buttons and product ordering.
export async function fetchActiveCategories():Promise<MenuCategory[]>{const {data,error}=await client().from('categories').select('id,name,display_order').eq('active',true).order('display_order').order('name');if(error){console.error(error);throw error}return(data??[]).map(row=>({id:String(row.id),name:String(row.name)}))}
// Modifier groups assigned to each product, for the add-to-cart dialog. RLS
// hides deactivated groups/options from the public client; groups with no
// active options are dropped so they can never block the customer.
export interface PublicModifierOption{id:string;name:string;price:number;priceMode:'adjustment'|'override'}
export interface PublicModifierGroup{id:string;name:string;required:boolean;minSelections:number;maxSelections:number;options:PublicModifierOption[]}
export async function fetchProductModifierGroups():Promise<Record<string,PublicModifierGroup[]>>{
  const c=client();
  const [linksResult,optionsResult]=await Promise.all([
    c.from('product_modifier_groups').select('product_id,display_order,modifier_groups!inner(id,name,required,min_selections,max_selections)').eq('modifier_groups.active',true).order('display_order'),
    c.from('modifiers').select('id,group_id,name,price,pricing_mode,display_order').eq('active',true).order('display_order').order('name')
  ]);
  if(linksResult.error){console.error(linksResult.error);throw linksResult.error}
  if(optionsResult.error){console.error(optionsResult.error);throw optionsResult.error}
  const optionsByGroup=new Map<string,PublicModifierOption[]>();
  for(const row of optionsResult.data??[]){if(!row.group_id)continue;const groupId=String(row.group_id);const list=optionsByGroup.get(groupId)??[];list.push({id:String(row.id),name:String(row.name),price:Number(row.price),priceMode:row.pricing_mode==='override'?'override':'adjustment'});optionsByGroup.set(groupId,list)}
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


// ── Combos (bundles) ──
export interface ComboOption{productId:string;name:string;description:string;imageUrl:string|null;price:number}
export interface ComboGroup{id:string;name:string;required?:boolean;minSelections:number;maxSelections:number;inheritExtras:boolean;options:ComboOption[]}
// Combo definition for the customer dialog: active choice groups in display
// order with their explicitly configured eligible products (price 0 =
// included, >0 = upgrade). Never category-driven — only products the staff
// individually selected appear here.
export async function fetchComboDefinition(productId:string):Promise<ComboGroup[]>{
  const c=client();
  const [groupsResult,optionsResult]=await Promise.all([
    c.from('combo_groups').select('id,name,min_selections,max_selections,inherit_extras').eq('product_id',productId).eq('active',true).order('display_order'),
    c.from('combo_options').select('group_id,price,display_order,products!inner(id,name,description,image_url,active,available,archived_at)').order('display_order')
  ]);
  if(groupsResult.error)throw groupsResult.error;
  if(optionsResult.error)throw optionsResult.error;
  const byGroup=new Map<string,ComboOption[]>();
  for(const row of optionsResult.data??[]){
    const product=(row.products??null) as unknown as {id:string;name:string;description:string|null;image_url:string|null;active:boolean;available:boolean;archived_at:string|null}|null;
    if(!row.group_id||!product?.id||product.active===false||product.available===false||product.archived_at)continue;
    const list=byGroup.get(String(row.group_id))??[];
    list.push({productId:String(product.id),name:String(product.name),description:String(product.description??''),imageUrl:product.image_url?String(product.image_url):null,price:Number(row.price??0)});
    byGroup.set(String(row.group_id),list);
  }
  return (groupsResult.data??[]).map(row=>({id:String(row.id),name:String(row.name),required:Number(row.min_selections??1)>0,minSelections:Number(row.min_selections??1),maxSelections:Number(row.max_selections??1),inheritExtras:row.inherit_extras===true,options:byGroup.get(String(row.id))??[]}));
}
// Inherited extras for a selected child product: only OPTIONAL modifier
// groups (required standalone choices like a protein pick don't apply inside
// a combo) and only adjustment-mode options (sizes/overrides excluded).
export async function fetchComboExtras(childProductId:string):Promise<PublicModifierGroup[]>{
  const c=client();
  const [linksResult,optionsResult]=await Promise.all([
    c.from('product_modifier_groups').select('product_id,modifier_groups!inner(id,name,required,min_selections,max_selections)').eq('product_id',childProductId).eq('modifier_groups.active',true).eq('modifier_groups.required',false).order('display_order'),
    c.from('modifiers').select('id,group_id,name,price,pricing_mode,display_order').eq('active',true).order('display_order').order('name')
  ]);
  if(linksResult.error)throw linksResult.error;
  if(optionsResult.error)throw optionsResult.error;
  const optionsByGroup=new Map<string,PublicModifierOption[]>();
  for(const row of optionsResult.data??[]){
    if(!row.group_id)continue;
    const mode=row.pricing_mode==='override'?'override':'adjustment';
    if(mode==='override')continue; // size-style options never inherit
    const groupId=String(row.group_id);
    const list=optionsByGroup.get(groupId)??[];
    list.push({id:String(row.id),name:String(row.name),price:Number(row.price),priceMode:mode});
    optionsByGroup.set(groupId,list);
  }
  const groups:PublicModifierGroup[]=[];
  for(const row of linksResult.data??[]){
    const group=(row.modifier_groups??null) as unknown as {id:string;name:string;required:boolean;min_selections:number;max_selections:number}|null;
    if(!group?.id)continue;
    const options=optionsByGroup.get(String(group.id))??[];
    if(!options.length)continue;
    groups.push({id:String(group.id),name:String(group.name),required:group.required===true,minSelections:Number(group.min_selections??0),maxSelections:Number(group.max_selections??0),options});
  }
  return groups;
}
