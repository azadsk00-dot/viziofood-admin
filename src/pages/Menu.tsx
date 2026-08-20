import { useMemo, useState } from 'react'; import { motion } from 'framer-motion'; import { Plus, X } from 'lucide-react'; import hero from '../assets/hero-pasta.png'; import { addItem, readCart, writeCart, type CartModifier } from '../cart'; import { useToast } from '../components/Toast'; import { useProducts } from '../hooks/useProducts'; import { useRestaurantSettings } from '../hooks/useRestaurantSettings'; import type { CustomerProduct, PublicModifierGroup } from '../services/products';

// The menu is fully database-driven: products and categories come from
// Supabase (ordered by the admin Categories page), and each product carries
// its own assigned modifier groups (Admin → Products → Modifiers). The old
// hardcoded modifier array is gone.

const Skeleton=()=> <div className="menu-grid" aria-label="Loading menu">{[1,2,3].map(i=><div className="menu-item menu-skeleton" key={i}/>)}</div>;

export default function Menu(){
  const {products,categories:menuCategories,modifierGroupsByProduct,loading,error,retry}=useProducts();
  const {settings}=useRestaurantSettings();
  const paused=settings?!settings.ordersEnabled:false;
  const [filter,setFilter]=useState('All');
  const [selected,setSelected]=useState<CustomerProduct>();
  const [choices,setChoices]=useState<Record<string,string[]>>({});
  const [instructions,setInstructions]=useState('');
  const toast=useToast();
  const categories=useMemo(()=>menuCategories.length?['All',...menuCategories.map(c=>c.name)]:['All',...Array.from(new Set(products.map(p=>p.category)))],[menuCategories,products]);
  const filtered=useMemo(()=>products.filter(product=>filter==='All'||product.category===filter),[products,filter]);
  const groupsFor=(dish:CustomerProduct):PublicModifierGroup[]=>modifierGroupsByProduct[dish.id]??[];
  // Products without modifier groups go straight to the cart — no empty
  // customisation dialog.
  const addDirect=(dish:CustomerProduct)=>{
    if(paused){toast.show(settings?.orderPauseMessage||'Online ordering is currently paused.','error');return}
    writeCart(addItem(readCart(),{key:crypto.randomUUID(),productId:dish.id,name:dish.name,price:dish.price,quantity:1,modifiers:[],instructions:''}));
    toast.show(`${dish.name} added to cart`);
  };
  const openCustomiser=(dish:CustomerProduct)=>{if(!groupsFor(dish).length){addDirect(dish);return}if(paused){toast.show(settings?.orderPauseMessage||'Online ordering is currently paused.','error');return}setSelected(dish);setChoices({});setInstructions('')};
  const selectedModifiers=(groups:PublicModifierGroup[]):CartModifier[]=>groups.flatMap(group=>(choices[group.id]??[]).map(optionId=>{const option=group.options.find(o=>o.id===optionId);return option?{id:option.id,name:option.name,price:option.price}:null})).filter((m):m is CartModifier=>m!==null);
  // A group is satisfied once the customer has picked at least its minimum
  // selections; Add to Cart stays blocked until every group with a minimum
  // (i.e. every required group) is satisfied. Optional groups can be skipped.
  const unsatisfied=(groups:PublicModifierGroup[])=>groups.filter(group=>(choices[group.id]??[]).length<group.minSelections);
  const choose=(group:PublicModifierGroup,optionId:string)=>setChoices(current=>{const selectedIds=current[group.id]??[];if(group.minSelections===1&&group.maxSelections===1)return{...current,[group.id]:[optionId]};if(selectedIds.includes(optionId))return{...current,[group.id]:selectedIds.filter(id=>id!==optionId)};if(group.maxSelections>0&&selectedIds.length>=group.maxSelections){toast.show(`Up to ${group.maxSelections} from ${group.name}.`,'error');return current}return{...current,[group.id]:[...selectedIds,optionId]}});
  const add=()=>{if(!selected)return;const modifiers=selectedModifiers(groupsFor(selected));writeCart(addItem(readCart(),{key:crypto.randomUUID(),productId:selected.id,name:selected.name,price:selected.price,quantity:1,modifiers,instructions}));setSelected(undefined);toast.show(`${selected.name} added to cart`)};
  const productGroups=selected?groupsFor(selected):[];const blocked=unsatisfied(productGroups);const total=selected?selected.price+selectedModifiers(productGroups).reduce((sum,m)=>sum+m.price,0):0;
  return <main className="menu-page">
    <section className="page-head"><p className="eyebrow">Our menu</p><h1>Made with<br/><em>intention.</em></h1><p>Seasonal ingredients, Italian technique, no unnecessary fuss.</p></section>
    {paused&&<p className="menu-paused-note" role="status">{settings?.orderPauseMessage||'Online ordering is currently paused.'} You can still browse the menu — your cart is saved.</p>}
    <div className="filters" aria-label="Menu categories">{categories.map(category=><button className={filter===category?'active':''} onClick={()=>setFilter(category)} key={category}>{category}</button>)}</div>
    {loading?<Skeleton/>:error?<div className="admin-message error" role="alert">{error}<button className="textlink retry" onClick={()=>void retry()}>Try again</button></div>:!filtered.length?<div className="admin-message">No dishes are available right now.</div>:
    <section className="menu-grid">{filtered.map((dish,i)=><motion.article initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:i*.04}} className="menu-item" key={dish.id}>
      <div className="menu-image" style={{backgroundImage:`url(${dish.imageUrl||hero})`}}/>
      <div><h2>{dish.name}</h2><p>{dish.description}</p>
        <div className="item-bottom"><b>{dish.price?`$${dish.price.toFixed(2)}`:'Available'}</b><button onClick={()=>openCustomiser(dish)} aria-label={`Customize ${dish.name}`}><Plus size={18}/></button></div>
      </div>
    </motion.article>)}</section>}
    {selected&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={`Customize ${selected.name}`}>
      <button className="modal-close" onClick={()=>setSelected(undefined)} aria-label="Close"><X/></button>
      <h2>{selected.name}</h2><p>Choose your options and add a note for the kitchen.</p>
      {productGroups.map(group=>{const single=group.minSelections===1&&group.maxSelections===1;const chosen=choices[group.id]??[];return <fieldset className="mod-group" key={group.id}>
        <legend>{group.name}{group.minSelections>0&&<em className="mod-required" aria-hidden="true"> *</em>}{group.required&&<small className="mod-required-label">Required</small>}{!single&&group.maxSelections>0&&<small className="mod-required-label">Up to {group.maxSelections}</small>}</legend>
        {group.options.map(option=>{const checked=chosen.includes(option.id);return <label className="modifier" key={option.id}>{single?<input type="radio" name={group.id} checked={checked} onChange={()=>choose(group,option.id)}/>:<input type="checkbox" checked={checked} onChange={()=>choose(group,option.id)}/>}{option.name}{option.price>0?` +$${option.price.toFixed(2)}`:''}</label>})}
      </fieldset>})}
      <label>Special instructions<textarea value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="e.g. no chilli"/></label>
      {blocked.length>0&&<p className="mod-blocked" role="alert">Choose an option from {blocked.map(group=>group.name).join(', ')} to continue.</p>}
      <button className="admin-primary" onClick={add} disabled={blocked.length>0}>Add to cart · ${total.toFixed(2)}</button>
    </section></div>}
    <p className="gf-note">GF pasta available on request. Please let us know about any allergies.</p>
  </main>;
}
