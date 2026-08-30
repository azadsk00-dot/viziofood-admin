// Minimal UI kit — buttons, badges, cards, fields. Large touch targets,
// zero animation noise.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing, type as typeScale } from '../theme';

// ── Button ──────────────────────────────────────────────────────────────────

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  small?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  block,
  small,
}: ButtonProps) {
  const palette = {
    primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: '#F3C7C7' },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        block && styles.buttonBlock,
        {
          backgroundColor: disabled || loading ? colors.surfaceAlt : palette.bg,
          borderColor: disabled || loading ? colors.border : palette.border,
          opacity: pressed && !disabled && !loading ? 0.8 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            small && styles.buttonLabelSmall,
            { color: disabled || loading ? colors.textFaint : palette.fg },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────

interface BadgeProps {
  label: string;
  color?: string;
  background?: string;
}

export function Badge({ label, color = colors.text, background = colors.surfaceAlt }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ── Field (labelled input) ──────────────────────────────────────────────────

interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
}

export function Field({ label, error, hint, ...inputProps }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textFaint}
        style={[styles.fieldInput, error ? { borderColor: colors.danger } : null]}
        {...inputProps}
      />
      {hint && !error ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ── Section header ──────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  count,
  color = colors.text,
}: {
  title: string;
  count?: number;
  color?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
      {typeof count === 'number' ? (
        <View style={[styles.sectionCount, { backgroundColor: color + '22' }]}>
          <Text style={[styles.sectionCountLabel, { color }]}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

// ── Row helper ──────────────────────────────────────────────────────────────

export function InfoRow({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonSmall: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  buttonBlock: { flex: 1 },
  buttonLabel: {
    fontSize: typeScale.bodyLarge,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  buttonLabelSmall: { fontSize: typeScale.small, letterSpacing: 0.3 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeLabel: {
    fontSize: typeScale.small,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  fieldWrap: { marginBottom: spacing.lg },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: typeScale.small,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  fieldInput: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
    fontSize: typeScale.bodyLarge,
  },
  fieldHint: { color: colors.textFaint, fontSize: typeScale.small, marginTop: spacing.xs },
  fieldError: { color: colors.danger, fontSize: typeScale.small, marginTop: spacing.xs },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: typeScale.heading,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  sectionCount: {
    minWidth: 30,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  sectionCountLabel: { fontSize: typeScale.small, fontWeight: '900' },
  empty: { alignItems: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { color: colors.textMuted, fontSize: typeScale.bodyLarge, fontWeight: '700' },
  emptySubtitle: { color: colors.textFaint, fontSize: typeScale.small, textAlign: 'center' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  infoLabel: { color: colors.textMuted, fontSize: typeScale.body },
  infoValue: { color: colors.text, fontSize: typeScale.body, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
});
