// Shared building blocks — big buttons, pills, banners, rows.
// Everything targets ≥56dp touch targets for use with wet hands in a rush.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { useSettingsStore } from '../state/settingsStore';
import { dark, light, ThemeColors } from '../theme';

export function useTheme(): ThemeColors {
  const theme = useSettingsStore((s) => s.settings.theme);
  return theme === 'light' ? light : dark;
}

export function BigButton(props: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const theme = useTheme();
  const { title, onPress, variant = 'primary', disabled, busy, small, style } = props;
  const bg =
    variant === 'primary' ? theme.accent
    : variant === 'danger' ? theme.danger
    : variant === 'secondary' ? theme.surfaceAlt
    : 'transparent';
  const fg = variant === 'primary' ? theme.accentText : variant === 'danger' ? '#fff' : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: theme.border, opacity: disabled ? 0.4 : pressed ? 0.82 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function StatusPill(props: { label: string; color: string }): React.ReactElement {
  return (
    <View style={[styles.pill, { backgroundColor: `${props.color}22`, borderColor: props.color }]}>
      <Text style={[styles.pillText, { color: props.color }]}>{props.label}</Text>
    </View>
  );
}

export function Screen(props: { children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const theme = useTheme();
  const { children, scroll, style } = props;
  if (scroll) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={[styles.screenContent, style]}
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, { backgroundColor: theme.background }, style]}>{children}</View>;
}

export function SectionTitle(props: { title: string; right?: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: theme.textDim }]}>{props.title}</Text>
      {props.right}
    </View>
  );
}

export function Field(props: { label: string; value: string; danger?: boolean }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textDim }]}>{props.label}</Text>
      <Text style={[styles.fieldValue, { color: props.danger ? theme.danger : theme.text }]} numberOfLines={2}>
        {props.value}
      </Text>
    </View>
  );
}

export function BigInput(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[styles.fieldLabel, { color: theme.textDim, marginBottom: 6 }]}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure}
        keyboardType={props.keyboardType ?? 'default'}
        placeholder={props.placeholder}
        placeholderTextColor={theme.textDim}
        autoCapitalize={props.autoCapitalize ?? 'none'}
        autoCorrect={false}
        style={[styles.input, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, color: theme.text }]}
      />
    </View>
  );
}

export function Toggle(props: { label: string; value: boolean; onChange: (value: boolean) => void; hint?: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <Pressable onPress={() => props.onChange(!props.value)} style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: theme.text }]}>{props.label}</Text>
        {props.hint ? <Text style={[styles.toggleHint, { color: theme.textDim }]}>{props.hint}</Text> : null}
      </View>
      <View
        style={[
          styles.toggleTrack,
          {
            backgroundColor: props.value ? theme.accent : theme.surfaceAlt,
            borderColor: theme.border,
            justifyContent: props.value ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <View style={[styles.toggleThumb, { backgroundColor: props.value ? theme.accentText : theme.textDim }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 64,
    minWidth: 120,
    borderRadius: 14,
    borderWidth: 2,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 48, minWidth: 90, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  buttonTextSmall: { fontSize: 15, fontWeight: '700' },
  pill: { borderRadius: 8, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  pillText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  screen: { flex: 1, padding: 16 },
  screenContent: { padding: 16, paddingBottom: 48 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', opacity: 0.9 },
  fieldValue: { fontSize: 17, fontWeight: '600', marginTop: 2 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, minHeight: 60 },
  toggleLabel: { fontSize: 17, fontWeight: '600' },
  toggleHint: { fontSize: 13, marginTop: 2 },
  toggleTrack: { width: 64, height: 36, borderRadius: 20, borderWidth: 2, justifyContent: 'center', padding: 2 },
  toggleThumb: { width: 26, height: 26, borderRadius: 13, alignSelf: 'flex-end' },
});
