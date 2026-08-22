// Categories admin service — mirrors web src/admin/supabase.ts: counts are
// computed client-side from products; renames propagate the text label to
// products (matching the products_sync_category trigger behaviour).

import { supabase } from '../../lib/supabase';
import type { AdminCategory } from '../../lib/adminTypes';

export async function getCategories(): Promise<AdminCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,description,active,display_order')
    .order('display_order')
    .order('name');
  if (error) throw new Error(error.message);

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('category,active,available,archived_at');
  if (productsError) throw new Error(productsError.message);

  const liveByCategory = new Map<string, number>();
  for (const row of (products ?? []) as Array<{ category: string; active: boolean; available: boolean; archived_at: string | null }>) {
    if (row.active === false || row.available === false || row.archived_at) continue;
    const key = (row.category ?? '').toLowerCase();
    liveByCategory.set(key, (liveByCategory.get(key) ?? 0) + 1);
  }

  return (data ?? []).map((row) => {
    const r = row as { id: string; name: string; description: string | null; active: boolean; display_order: number };
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      active: r.active,
      displayOrder: r.display_order,
      count: liveByCategory.get((r.name ?? '').toLowerCase()) ?? 0,
    };
  });
}

export async function createCategory(name: string, description: string): Promise<void> {
  const { error } = await supabase.from('categories').insert({ name: name.trim(), description });
  if (error) throw new Error(error.message);
}

export async function updateCategory(
  id: string,
  changes: { name?: string; description?: string; active?: boolean; displayOrder?: number },
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (changes.name !== undefined) payload.name = changes.name.trim();
  if (changes.description !== undefined) payload.description = changes.description;
  if (changes.active !== undefined) payload.active = changes.active;
  if (changes.displayOrder !== undefined) payload.display_order = changes.displayOrder;
  const { error } = await supabase.from('categories').update(payload).eq('id', id);
  if (error) throw new Error(error.message);

  // Rename: keep the product text label in sync (web parity).
  if (changes.name !== undefined) {
    const { data: linked } = await supabase.from('products').select('id').eq('category_id', id).limit(1);
    if (linked && linked.length) {
      await supabase.from('products').update({ category: changes.name.trim() }).eq('category_id', id);
    }
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Persist a full 1..n ordering. */
export async function reorderCategories(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('categories').update({ display_order: index + 1 }).eq('id', id).then(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    ),
  );
}
