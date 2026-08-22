// Modifiers — groups + options. Required toggle drives min/max semantics
// (required + max 1 behaves radio-like; optional + max 0 = multi-checkbox),
// duplicate option names per group prevented (client + DB unique index).

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminPage, Card, ConfirmDialog, EmptyState, Pill } from '../../components/admin/kit';
import { ModalSheet, NumberField, TextField, ToggleField } from '../../components/admin/fields';
import {
  deleteModifierGroup,
  deleteModifierOption,
  getModifierGroups,
  getModifierOptions,
  reorderModifierGroups,
  reorderModifierOptions,
  saveModifierGroup,
  saveModifierOption,
} from '../../services/admin/modifiers';
import type { ModifierGroup, ModifierOption } from '../../lib/adminTypes';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';
import { aud } from '../../lib/money';

interface GroupDraft { id?: string; name: string; required: boolean; minSelections: string; maxSelections: string; active: boolean }
interface OptionDraft { id?: string; groupId: string; groupName: string; name: string; price: string; description: string; active: boolean }

export default function ModifiersScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [options, setOptions] = useState<ModifierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmGroup, setConfirmGroup] = useState<ModifierGroup | null>(null);
  const [confirmOption, setConfirmOption] = useState<ModifierOption | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [g, o] = await Promise.all([getModifierGroups(), getModifierOptions()]);
      setGroups(g);
      setOptions(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load modifiers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveGroup = async () => {
    if (!groupDraft || !groupDraft.name.trim()) {
      setError('Group name is required.');
      return;
    }
    const required = groupDraft.required;
    let min = Math.max(0, Math.round(Number(groupDraft.minSelections) || 0));
    let max = Math.max(0, Math.round(Number(groupDraft.maxSelections) || 0));
    // Web-parity required/limits semantics.
    if (required) {
      min = Math.max(1, min);
      if (max === 0) max = 1;
    } else {
      min = 0;
      max = 0;
    }
    setBusy(true);
    try {
      await saveModifierGroup({ id: groupDraft.id, name: groupDraft.name, required, minSelections: min, maxSelections: max, active: groupDraft.active });
      setGroupDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveOption = async () => {
    if (!optionDraft) return;
    if (!optionDraft.name.trim()) {
      setError('Option name is required.');
      return;
    }
    const price = optionDraft.price.trim() === '' ? 0 : Number(optionDraft.price);
    if (!Number.isFinite(price) || price < 0) {
      setError('Price add-on must be 0 or more.');
      return;
    }
    const siblings = options.filter((o) => o.groupId === optionDraft.groupId && o.id !== optionDraft.id).map((o) => o.name.toLowerCase());
    if (siblings.includes(optionDraft.name.trim().toLowerCase())) {
      setError('An option with this name already exists in the group.');
      return;
    }
    setBusy(true);
    try {
      await saveModifierOption({
        id: optionDraft.id,
        groupId: optionDraft.groupId,
        name: optionDraft.name,
        price,
        description: optionDraft.description,
        active: optionDraft.active,
      });
      setOptionDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const moveGroup = async (index: number, delta: -1 | 1) => {
    const next = [...groups];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setGroups(next);
    try {
      await reorderModifierGroups(next.map((g) => g.id));
    } catch {
      await load();
    }
  };

  const moveOption = async (groupId: string, index: number, delta: -1 | 1) => {
    const groupOptions = options.filter((o) => o.groupId === groupId);
    const next = [...groupOptions];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOptions((prev) => [...prev.filter((o) => o.groupId !== groupId), ...next]);
    try {
      await reorderModifierOptions(next.map((o) => o.id));
    } catch {
      await load();
    }
  };

  return (
    <AdminPage
      title="Modifiers"
      subtitle="Groups, options and product assignment (in Products)"
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
      actions={
        <Pressable style={styles.addButton} onPress={() => setGroupDraft({ name: '', required: true, minSelections: '1', maxSelections: '1', active: true })}>
          <Text style={styles.addButtonText}>+ GROUP</Text>
        </Pressable>
      }
    >
      {groups.map((group, index) => {
        const groupOptions = options.filter((o) => o.groupId === group.id);
        const isOpen = expanded === group.id;
        return (
          <Card key={group.id} style={{ marginTop: 8 }}>
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setExpanded(isOpen ? null : group.id)}>
              <Text style={{ fontSize: 16 }}>{isOpen ? '▾' : '▸'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: dark.text }]}>{group.name}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <Pill label={group.required ? `REQUIRED · MIN ${group.minSelections}${group.maxSelections ? ` · MAX ${group.maxSelections}` : ''}` : 'OPTIONAL'} tone="info" />
                  <Pill label={`${groupOptions.length} OPTIONS`} />
                  <Pill label={group.active ? 'ACTIVE' : 'OFF'} tone={group.active ? 'good' : 'warn'} />
                </View>
              </View>
            </Pressable>

            {isOpen ? (
              <View style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Pressable style={styles.orderButton} onPress={() => void moveGroup(index, -1)}><Text style={styles.orderButtonText}>▲ MOVE UP</Text></Pressable>
                  <Pressable style={styles.orderButton} onPress={() => void moveGroup(index, 1)}><Text style={styles.orderButtonText}>▼ MOVE DOWN</Text></Pressable>
                  <Pressable style={styles.orderButton} onPress={() => void saveModifierGroup({ id: group.id, active: !group.active }).then(load)}>
                    <Text style={styles.orderButtonText}>{group.active ? 'DEACTIVATE' : 'ACTIVATE'}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.orderButton}
                    onPress={() =>
                      setGroupDraft({
                        id: group.id, name: group.name, required: group.required,
                        minSelections: String(group.minSelections), maxSelections: String(group.maxSelections), active: group.active,
                      })
                    }
                  >
                    <Text style={styles.orderButtonText}>EDIT</Text>
                  </Pressable>
                  <Pressable style={[styles.orderButton, { borderColor: dark.danger }]} disabled={!online} onPress={() => setConfirmGroup(group)}>
                    <Text style={[styles.orderButtonText, { color: dark.danger }]}>DELETE</Text>
                  </Pressable>
                </View>

                {groupOptions.map((option, optionIndex) => (
                  <View key={option.id} style={styles.optionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: dark.text, fontWeight: '700', fontSize: 15 }}>{option.name}</Text>
                      <Text style={styles.meta}>
                        {option.price > 0 ? `+${aud(Math.round(option.price * 100))}` : 'no extra'} · {option.active ? 'active' : 'off'}
                        {option.description ? ` · ${option.description}` : ''}
                      </Text>
                    </View>
                    <Pressable style={styles.tinyButton} onPress={() => void moveOption(group.id, optionIndex, -1)}><Text style={styles.tinyButtonText}>▲</Text></Pressable>
                    <Pressable style={styles.tinyButton} onPress={() => void moveOption(group.id, optionIndex, 1)}><Text style={styles.tinyButtonText}>▼</Text></Pressable>
                    <Pressable
                      style={styles.tinyButton}
                      onPress={() =>
                        setOptionDraft({
                          id: option.id, groupId: group.id, groupName: group.name,
                          name: option.name, price: String(option.price), description: option.description, active: option.active,
                        })
                      }
                    >
                      <Text style={styles.tinyButtonText}>EDIT</Text>
                    </Pressable>
                    <Pressable style={styles.tinyButton} disabled={!online} onPress={() => setConfirmOption(option)}><Text style={[styles.tinyButtonText, { color: dark.danger }]}>✕</Text></Pressable>
                  </View>
                ))}

                <Pressable
                  style={[styles.addButton, { alignSelf: 'flex-start', marginTop: 8 }]}
                  onPress={() => setOptionDraft({ groupId: group.id, groupName: group.name, name: '', price: '', description: '', active: true })}
                >
                  <Text style={styles.addButtonText}>+ OPTION</Text>
                </Pressable>
              </View>
            ) : null}
          </Card>
        );
      })}
      {!groups.length && !loading ? <EmptyState text="No modifier groups yet." /> : null}

      <ConfirmDialog
        visible={confirmGroup !== null}
        title={`Delete group ${confirmGroup?.name ?? ''}?`}
        message="Its options and product assignments are removed too."
        danger
        confirmLabel="DELETE"
        onCancel={() => setConfirmGroup(null)}
        onConfirm={() => {
          const target = confirmGroup;
          setConfirmGroup(null);
          if (target) void deleteModifierGroup(target.id).then(load);
        }}
      />
      <ConfirmDialog
        visible={confirmOption !== null}
        title={`Delete option ${confirmOption?.name ?? ''}?`}
        message="This cannot be undone."
        danger
        confirmLabel="DELETE"
        onCancel={() => setConfirmOption(null)}
        onConfirm={() => {
          const target = confirmOption;
          setConfirmOption(null);
          if (target) void deleteModifierOption(target.id).then(load);
        }}
      />

      <ModalSheet
        visible={groupDraft !== null}
        title={groupDraft?.id ? 'Edit group' : 'New group'}
        onClose={() => setGroupDraft(null)}
        footer={
          <Pressable style={[styles.saveButton, { opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void saveGroup()}>
            <Text style={styles.saveButtonText}>SAVE</Text>
          </Pressable>
        }
      >
        {groupDraft ? (
          <View>
            <TextField label="Group name" value={groupDraft.name} onChangeText={(name) => setGroupDraft({ ...groupDraft, name })} />
            <ToggleField
              label="Required"
              value={groupDraft.required}
              onChange={(required) =>
                setGroupDraft({
                  ...groupDraft,
                  required,
                  minSelections: required ? String(Math.max(1, Number(groupDraft.minSelections) || 1)) : '0',
                  maxSelections: required ? (Number(groupDraft.maxSelections) || 1) === 0 ? '1' : groupDraft.maxSelections : '0',
                })
              }
              hint="Required + max 1 behaves like radio buttons"
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><NumberField label="Min selections" value={groupDraft.minSelections} onChangeText={(minSelections) => setGroupDraft({ ...groupDraft, minSelections })} hint="0–20" /></View>
              <View style={{ flex: 1 }}><NumberField label="Max selections" value={groupDraft.maxSelections} onChangeText={(maxSelections) => setGroupDraft({ ...groupDraft, maxSelections })} hint="0 = unlimited" /></View>
            </View>
            <ToggleField label="Active" value={groupDraft.active} onChange={(active) => setGroupDraft({ ...groupDraft, active })} />
          </View>
        ) : null}
      </ModalSheet>

      <ModalSheet
        visible={optionDraft !== null}
        title={optionDraft?.id ? `Edit option — ${optionDraft?.groupName}` : `New option — ${optionDraft?.groupName ?? ''}`}
        onClose={() => setOptionDraft(null)}
        footer={
          <Pressable style={[styles.saveButton, { opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void saveOption()}>
            <Text style={styles.saveButtonText}>SAVE</Text>
          </Pressable>
        }
      >
        {optionDraft ? (
          <View>
            <TextField label="Option name" value={optionDraft.name} onChangeText={(name) => setOptionDraft({ ...optionDraft, name })} />
            <NumberField label="Price added (AUD)" value={optionDraft.price} onChangeText={(price) => setOptionDraft({ ...optionDraft, price })} hint="Empty = 0" />
            <TextField label="Description (staff-facing)" value={optionDraft.description} onChangeText={(description) => setOptionDraft({ ...optionDraft, description })} multiline />
            <ToggleField label="Active" value={optionDraft.active} onChange={(active) => setOptionDraft({ ...optionDraft, active })} />
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  addButton: { backgroundColor: dark.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: dark.accentText, fontWeight: '900' },
  name: { fontSize: 17, fontWeight: '800' },
  meta: { color: dark.textDim, fontSize: 13, marginTop: 2 },
  orderButton: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: dark.surfaceAlt },
  orderButtonText: { color: dark.text, fontWeight: '800', fontSize: 12 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: dark.border },
  tinyButton: { borderWidth: 1, borderColor: dark.border, borderRadius: 8, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  tinyButtonText: { color: dark.text, fontSize: 12, fontWeight: '800' },
  saveButton: { backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: dark.accentText, fontWeight: '900', fontSize: 15 },
});
