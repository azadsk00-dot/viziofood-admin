import { useCallback, useEffect, useState } from 'react'; import { fetchActiveCategories, fetchActiveProducts, fetchProductModifierGroups, type CustomerProduct, type MenuCategory, type PublicModifierGroup } from '../services/products';
// Menu data for the public site: real products only (modifiers live in their
// own tables and never appear as menu items), ordered by category display
// order → product display order → name, plus each product's assigned
// modifier groups (with their options) for the add-to-cart dialog.
export function useProducts(){
  const [products,setProducts]=useState<CustomerProduct[]>([]);
  const [categories,setCategories]=useState<MenuCategory[]>([]);
  const [modifierGroupsByProduct,setModifierGroupsByProduct]=useState<Record<string,PublicModifierGroup[]>>({});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string>();
  const load=useCallback(async()=>{
    setLoading(true);setError(undefined);
    try{
      const [productList,categoryList,groupMap]=await Promise.all([fetchActiveProducts(),fetchActiveCategories().catch(()=>[]),fetchProductModifierGroups().catch(()=>({}))]);
      const order=new Map(categoryList.map((category,index)=>[category.name.toLowerCase(),index]));
      const visible=categoryList.length?productList.filter(product=>order.has(product.category.toLowerCase())):productList;
      const sorted=[...visible].sort((a,b)=>(order.get(a.category.toLowerCase())??9999)-(order.get(b.category.toLowerCase())??9999)||a.displayOrder-b.displayOrder||a.name.localeCompare(b.name));
      setProducts(sorted);setCategories(categoryList);setModifierGroupsByProduct(groupMap);
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to load the menu.')}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void load()},[load]);
  return{products,categories,modifierGroupsByProduct,loading,error,retry:load};
}
