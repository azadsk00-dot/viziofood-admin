// Form fields — controlled, touch-first, both orientations.
// SelectField uses chips (no platform Picker); TagsField edits comma lists;
// ImageField wraps the upload pipeline with progress and retry.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { dark } from '../../theme';
import { pickAndUploadImage } from '../../services/admin/imageUpload';

const inputStyle: object = {
  backgroundColor: dark.surfaceAlt,
  borderColor: dark.border,
  color: dark.text,
  borderWidth: 1.5,
  borderRadius: 10,
  paddingHorizontal: 14,
  paddingVertical: 10,
  fontSize: 16,
};

function Label(props: { text: string; hint?: string }): React.ReactElement {
  return (
    <View>
      <Text style={styles.label}>{props.text.toUpperCase()}</Text>
      {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
    </View>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  hint?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Label text={props.label} hint={props.hint} />
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={dark.textDim}
        multiline={props.multiline}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        keyboardType={props.keyboardType ?? 'default'}
        style={[inputStyle, props.multiline && { minHeight: 84, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function NumberField(props: {
  label: string;
  value: string; // controlled as text for smooth typing
  onChangeText: (v: string) => void;
  hint?: string;
  placeholder?: string;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Label text={props.label} hint={props.hint} />
      <TextInput
        value={props.value}
        onChangeText={(v) => props.onChangeText(v.replace(/[^0-9.\-]/g, ''))}
        placeholder={props.placeholder}
        placeholderTextColor={dark.textDim}
        keyboardType="numeric"
        style={inputStyle}
      />
    </View>
  );
}

export function ToggleField(props: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }): React.ReactElement {
  return (
    <Pressable style={styles.toggleRow} onPress={() => props.onChange(!props.value)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{props.label}</Text>
        {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
      </View>
      <View style={[styles.track, { backgroundColor: props.value ? dark.accent : dark.surfaceAlt, justifyContent: props.value ? 'flex-end' : 'flex-start' }]}>
        <View style={[styles.thumb, { backgroundColor: props.value ? dark.accentText : dark.textDim }]} />
      </View>
    </Pressable>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  hint?: string;
}): React.ReactElement {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.field}>
      <Label text={props.label} hint={props.hint} />
      <View style={[styles.chipRow, { flexWrap: width < 640 ? 'wrap' : 'nowrap' }]}>
        {props.options.map((option) => {
          const active = option.value === props.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => props.onChange(option.value)}
              style={[styles.chip, active && { backgroundColor: dark.accent, borderColor: dark.accent }]}
            >
              <Text style={[styles.chipText, active && { color: dark.accentText }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function TagsField(props: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string; placeholder?: string }): React.ReactElement {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) props.onChange([...props.value, ...parts]);
    setDraft('');
  };
  return (
    <View style={styles.field}>
      <Label text={props.label} hint={props.hint ?? 'Comma-separated'} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          placeholder={props.placeholder ?? 'Add and press Enter'}
          placeholderTextColor={dark.textDim}
          style={[inputStyle, { flex: 1 }]}
        />
        <Pressable style={styles.addButton} onPress={commit}>
          <Text style={styles.addButtonText}>ADD</Text>
        </Pressable>
      </View>
      {props.value.length ? (
        <View style={styles.tagRow}>
          {props.value.map((tag, i) => (
            <Pressable key={`${tag}-${i}`} style={styles.tag} onPress={() => props.onChange(props.value.filter((_, j) => j !== i))}>
              <Text style={styles.tagText}>{tag} ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DaysOfWeekField(props: { value: number[]; onChange: (v: number[]) => void }): React.ReactElement {
  return (
    <View style={styles.field}>
      <Label text="Days of week" hint="Empty = every day" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {DAY_NAMES.map((name, day) => {
          const active = props.value.includes(day);
          return (
            <Pressable
              key={name}
              onPress={() => props.onChange(active ? props.value.filter((d) => d !== day) : [...props.value, day])}
              style={[styles.chip, active && { backgroundColor: dark.accent, borderColor: dark.accent }]}
            >
              <Text style={[styles.chipText, active && { color: dark.accentText }]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ImageField(props: {
  label: string;
  url: string | null;
  onPicked: (url: string, path: string) => void;
  onClear?: () => void;
  folder: 'products' | 'branding';
  hint?: string;
}): React.ReactElement {
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const pick = async (source: 'camera' | 'gallery') => {
    setError('');
    setProgress(0);
    try {
      const result = await pickAndUploadImage(source, props.folder, (fraction, text) => {
        setProgress(fraction);
        if (text) setNote(text ?? '');
      });
      if (result) props.onPicked(result.url, result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.field}>
      <Label text={props.label} hint={props.hint ?? 'Compressed automatically (max 1920px, JPEG)'} />
      {props.url ? (
        <Image source={{ uri: props.url }} style={styles.imagePreview} resizeMode="contain" />
      ) : (
        <View style={[styles.imageEmpty, { borderColor: dark.border }]}>
          <Text style={{ color: dark.textDim }}>No image</Text>
        </View>
      )}
      {progress !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <ActivityIndicator color={dark.accent} />
          <Text style={{ color: dark.info, fontWeight: '700', fontSize: 13 }}>
            {note} {Math.round(progress * 100)}%
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Pressable style={styles.addButton} onPress={() => void pick('gallery')}>
            <Text style={styles.addButtonText}>GALLERY</Text>
          </Pressable>
          <Pressable style={styles.addButton} onPress={() => void pick('camera')}>
            <Text style={styles.addButtonText}>CAMERA</Text>
          </Pressable>
          {props.url && props.onClear ? (
            <Pressable style={[styles.addButton, { borderColor: dark.danger }]} onPress={props.onClear}>
              <Text style={[styles.addButtonText, { color: dark.danger }]}>REMOVE</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {error ? <Text style={{ color: dark.danger, marginTop: 6, fontWeight: '700' }}>{error} — try again.</Text> : null}
    </View>
  );
}

export function ModalSheet(props: {
  visible: boolean;
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const { width, height } = useWindowDimensions();
  const wide = width >= 820;
  return (
    <Modal visible={props.visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={props.onClose}>
      <View style={styles.sheetBackdrop}>
        <View
          style={[
            styles.sheet,
            wide
              ? { width: Math.min(760, width - 80), maxHeight: height - 100, borderRadius: 18 }
              : { width: '100%', height: height - 60, borderRadius: 18 },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{props.title}</Text>
            <Pressable onPress={props.onClose} style={styles.closeButton}>
              <Text style={{ color: dark.text, fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {props.children}
          </ScrollView>
          {props.footer ? <View style={styles.sheetFooter}>{props.footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { color: dark.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  hint: { color: dark.textDim, fontSize: 12, marginBottom: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, minHeight: 52 },
  toggleLabel: { color: dark.text, fontSize: 16, fontWeight: '600' },
  track: { width: 56, height: 32, borderRadius: 18, borderWidth: 2, borderColor: dark.border, padding: 2 },
  thumb: { width: 22, height: 22, borderRadius: 11 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: dark.surfaceAlt },
  chipText: { color: dark.text, fontWeight: '700', fontSize: 14 },
  addButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: dark.surfaceAlt },
  addButtonText: { color: dark.info, fontWeight: '800', fontSize: 13 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { backgroundColor: dark.surfaceAlt, borderWidth: 1, borderColor: dark.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  tagText: { color: dark.text, fontSize: 13, fontWeight: '600' },
  imagePreview: { width: '100%', height: 180, borderRadius: 12, backgroundColor: dark.surfaceAlt },
  imageEmpty: { height: 100, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: dark.surface, overflow: 'hidden', borderWidth: 1, borderColor: dark.border },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: dark.border },
  sheetTitle: { flex: 1, color: dark.text, fontSize: 19, fontWeight: '900' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { padding: 16, paddingBottom: 32 },
  sheetFooter: { padding: 14, borderTopWidth: 1, borderTopColor: dark.border, flexDirection: 'row', gap: 12 },
});
