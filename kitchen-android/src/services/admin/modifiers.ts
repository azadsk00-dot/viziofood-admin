// Modifiers admin service — mirrors web: modifier_groups + modifiers tables,
// required toggle drives min/max (radio-like when required+max=1), product
// assignment via product_modifier_groups full replace.

import { supabase } from '../../lib/supabase';
import type { ModifierGroup, ModifierOption } from '../../lib/adminTypes';

export async function getModifierGroups(): Promise<ModifierGroup[]> {
  const { data, error } = await supabase
    .from('modifier_groups')
    .select('id,name,required,min_selections,max_selections,active,display_order')
    .order('display_order')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      name: (r.name as string) ?? '',
      required: Boolean(r.required),
      minSelections: Number(r.min_selections ?? 0),
      maxSelections: Number(r.max_selections ?? 0),
      active: Boolean(r.active),
      displayOrder: Number(r.display_order ?? 0),
    };
  });
}

export async function getModifierOptions(): Promise<ModifierOption[]> {
  const { data, error } = await supabase
    .from('modifiers')
    .select('id,group_id,name,description,price,active,display_order')
    .order('display_order')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      groupId: r.group_id as string,
      name: (r.name as string) ?? '',
      description: (r.description as string) ?? '',
      price: Number(r.price ?? 0),
      active: Boolean(r.active),
      displayOrder: Number(r.display_order ?? 0),
    };
  });
}

export async function saveModifierGroup(group: Partial<ModifierGroup> & { id?: string }): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (group.name !== undefined) payload.name = group.name.trim();
  if (group.required !== undefined) payload.required = group.required;
  if (group.minSelections !== undefined) payload.min_selections = group.minSelections;
  if (group.maxSelections !== undefined) payload.max_selections = group.maxSelections;
  if (group.active !== undefined) payload.active = group.active;
  if (group.displayOrder !== undefined) payload.display_order = group.displayOrder;
  const { error } = group.id
    ? await supabase.from('modifier_groups').update(payload).eq('id', group.id)
    : await supabase.from('modifier_groups').insert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteModifierGroup(id: string): Promise<void> {
  const { error } = await supabase.from('modifier_groups').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function saveModifierOption(option: Partial<ModifierOption> & { id?: string; groupId: string }): Promise<void> {
  const payload: Record<string, unknown> = { group_id: option.groupId };
  if (option.name !== undefined) payload.name = option.name.trim();
  if (option.description !== undefined) payload.description = option.description;
  if (option.price !== undefined) payload.price = Number(option.price);
  if (option.active !== undefined) payload.active = option.active;
  if (option.displayOrder !== undefined) payload.display_order = option.displayOrder;
  const { error } = option.id
    ? await supabase.from('modifiers').update(payload).eq('id', option.id)
    : await supabase.from('modifiers').insert(payload);
  if (error) {
    if (/23505|duplicate/i.test(error.message)) throw new Error('An option with this name already exists in the group.');
    throw new Error(error.message);
  }
}

export async function deleteModifierOption(id: string): Promise<void> {
  const { error } = await supabase.from('modifiers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function reorderModifierGroups(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('modifier_groups').update({ display_order: index + 1 }).eq('id', id).then(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    ),
  );
}

export async function reorderModifierOptions(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('modifiers').update({ display_order: index + 1 }).eq('id', id).then(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    ),
  );
}

export async function getProductModifierGroups(
  productId: string,
): Promise<Array<{ groupId: string; name: string; displayOrder: number }>> {
  const { data, error } = await supabase
    .from('product_modifier_groups')
    .select('display_order,modifier_groups(id,name,required,active)')
    .eq('product_id', productId)
    .order('display_order');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((raw) => {
    const r = raw as { display_order: number; modifier_groups: { id: string; name: string } | null };
    return { groupId: r.modifier_groups?.id ?? '', name: r.modifier_groups?.name ?? '', displayOrder: r.display_order };
  }).filter((entry) => entry.groupId);
}

/** Full replace — web parity: delete all, insert ordered. */
export async function setProductModifierGroups(productId: string, groupIds: string[]): Promise<void> {
  const { error: deleteError } = await supabase.from('product_modifier_groups').delete().eq('product_id', productId);
  if (deleteError) throw new Error(deleteError.message);
  if (!groupIds.length) return;
  const { error } = await supabase
    .from('product_modifier_groups')
    .insert(groupIds.map((groupId, index) => ({ product_id: productId, group_id: groupId, display_order: index + 1 })));
  if (error) throw new Error(error.message);
}
