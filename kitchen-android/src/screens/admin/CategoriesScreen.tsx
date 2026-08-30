// Categories — create/edit/archive/delete + reorder (order drives the public
// menu). Renames propagate the text label to products.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AdminPage, Card, ConfirmDialog, EmptyState, Pill } from '../../components/admin/kit';
import { ModalSheet, TextField } from '../../components/admin/fields';
import { createCategory, deleteCategory, getCategories, reorderCategories, updateCategory } from '../../services/admin/categories';
import type { AdminCategory } from '../../lib/adminTypes';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';

interface Draft { id?: string; name: string; description: string; active: boolean }

export default function CategoriesScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminCategory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCategories(await getCategories());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const move = async (index: number, delta: -1 | 1) => {
    const next = [...categories];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(next);
    try {
      await reorderCategories(next.map((c) => c.id));
      setMessage('Order saved — the public menu follows this order.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reorder failed.');
      await load();
    }
  };

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    try {
      if (draft.id) {
        await updateCategory(draft.id, { name: draft.name, description: draft.description, active: draft.active });
      } else {
        await createCategory(draft.name, draft.description);
      }
      setDraft(null);
      setMessage('Saved.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const visible = categories.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <AdminPage
      title="Categories"
      subtitle="Order controls the public menu"
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
      actions={
        <Pressable style={styles.addButton} onPress={() => setDraft({ name: '', description: '', active: true })}>
          <Text style={styles.addButtonText}>+ NEW</Text>
        </Pressable>
      }
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search categories…"
        placeholderTextColor={dark.textDim}
        style={styles.search}
      />

      {visible.map((category, index) => (
        <Card key={category.id} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.orderButtons}>
              <Pressable style={styles.orderButton} onPress={() => void move(index, -1)}><Text style={styles.orderButtonText}>▲</Text></Pressable>
              <Pressable style={styles.orderButton} onPress={() => void move(index, 1)}><Text style={styles.orderButtonText}>▼</Text></Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: dark.text }]}>{category.name}</Text>
              {category.description ? <Text style={styles.meta} numberOfLines={1}>{category.description}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <Pill label={`${category.count} PRODUCTS`} />
                <Pill label={category.active ? 'ACTIVE' : 'INACTIVE'} tone={category.active ? 'good' : 'warn'} />
              </View>
            </View>
            <Pressable
              style={styles.miniButton}
              onPress={() => void updateCategory(category.id, { active: !category.active }).then(load)}
            >
              <Text style={styles.miniText}>{category.active ? 'DEACTIVATE' : 'ACTIVATE'}</Text>
            </Pressable>
            <Pressable style={styles.miniButton} onPress={() => setDraft({ id: category.id, name: category.name, description: category.description, active: category.active })}>
              <Text style={styles.miniText}>EDIT</Text>
            </Pressable>
          </View>
        </Card>
      ))}
      {!visible.length && !loading ? <EmptyState text="No categories." /> : null}

      <ConfirmDialog
        visible={confirmDelete !== null}
        title={`Delete ${confirmDelete?.name ?? ''}?`}
        message="Products keep their category text label but lose the link. Consider deactivating instead."
        danger
        confirmLabel="DELETE"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void deleteCategory(target.id).then(load);
        }}
      />

      <ModalSheet
        visible={draft !== null}
        title={draft?.id ? 'Edit category' : 'New category'}
        onClose={() => setDraft(null)}
        footer={
          <Pressable style={[styles.saveButton, { opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void save()}>
            <Text style={styles.saveButtonText}>SAVE</Text>
          </Pressable>
        }
      >
        {draft ? (
          <View>
            <TextField label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <TextField label="Description" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} multiline />
            {draft.id ? (
              <Text style={styles.hint}>Renaming also updates the category label on products linked to it.</Text>
            ) : null}
            {draft.id ? (
              <Pressable
                style={[styles.deleteButton, { opacity: online ? 1 : 0.5 }]}
                disabled={!online}
                onPress={() => {
                  const target = categories.find((c) => c.id === draft.id);
                  if (target) {
                    setDraft(null);
                    setConfirmDelete(target);
                  }
                }}
              >
                <Text style={styles.deleteButtonText}>DELETE CATEGORY</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  addButton: { backgroundColor: dark.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: dark.accentText, fontWeight: '900' },
  search: { backgroundColor: dark.surface, borderColor: dark.border, color: dark.text, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginBottom: 6 },
  message: { color: dark.info, fontWeight: '700', marginBottom: 8 },
  orderButtons: { gap: 4 },
  orderButton: { width: 34, height: 30, borderWidth: 1.5, borderColor: dark.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: dark.surfaceAlt },
  orderButtonText: { color: dark.text, fontSize: 12 },
  name: { fontSize: 17, fontWeight: '800' },
  meta: { color: dark.textDim, fontSize: 13, marginTop: 2 },
  miniButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  miniText: { color: dark.info, fontWeight: '800', fontSize: 11 },
  saveButton: { backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: dark.accentText, fontWeight: '900', fontSize: 15 },
  deleteButton: { borderColor: dark.danger, borderWidth: 2, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  deleteButtonText: { color: dark.danger, fontWeight: '900' },
  hint: { color: dark.textDim, fontSize: 12, marginTop: 4 },
});
