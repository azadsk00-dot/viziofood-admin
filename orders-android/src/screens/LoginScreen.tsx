// Login — existing VIZIO FOOD staff/kitchen/admin account. Customer accounts
// are rejected by the auth store.

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type as typeScale } from '../theme';
import { useAuthStore } from '../state/authStore';
import { Button, Field } from '../components/ui';

export function LoginScreen() {
  const signIn = useAuthStore((state) => state.signIn);
  const error = useAuthStore((state) => state.error);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    await signIn(email.trim(), password);
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.brandTitle}>VIZIO FOOD</Text>
            <Text style={styles.brandSubtitle}>ORDERS</Text>
          </View>

          <View style={styles.form}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@viziofood.com"
              editable={!busy}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              placeholder="••••••••"
              editable={!busy}
              onSubmitEditing={submit}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={busy ? 'Signing in…' : 'SIGN IN'} onPress={submit} loading={busy} />
            <Text style={styles.hint}>
              Use a VIZIO FOOD admin, staff or kitchen account. Notification
              permission is requested right after sign-in so new orders ring
              even when the app is in the background.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xxl },
  brand: { alignItems: 'center', marginBottom: spacing.xxl, gap: spacing.xs },
  brandTitle: { color: colors.text, fontSize: 34, fontWeight: '900', letterSpacing: 3 },
  brandSubtitle: { color: colors.accent, fontSize: typeScale.heading, fontWeight: '900', letterSpacing: 8 },
  form: { gap: spacing.sm },
  error: {
    color: colors.danger,
    fontSize: typeScale.body,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.textFaint,
    fontSize: typeScale.small,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 19,
  },
});
