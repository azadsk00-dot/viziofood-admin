// Login — kitchen staff sign-in. Only admin/staff/kitchen accounts pass
// (checked against profiles.role; RLS is the real enforcement layer).

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../state/authStore';
import { BigButton, BigInput, Screen, useTheme } from '../components/ui';

export default function LoginScreen(): React.ReactElement {
  const theme = useTheme();
  const signIn = useAuthStore((s) => s.signIn);
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const error = useAuthStore((s) => s.error);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setMessage('');
    await signIn(email.trim(), password);
    setBusy(false);
  };

  const forgot = async () => {
    if (!email.trim()) {
      setMessage('Enter your email above first, then tap Forgot password.');
      return;
    }
    setBusy(true);
    const result = await resetPassword(email.trim());
    setBusy(false);
    setMessage(result.ok ? 'Reset email sent — check the inbox on a device with email.' : result.error ?? 'Could not send reset email.');
  };

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'android' ? undefined : 'padding'} style={styles.wrap}>
        <Text style={[styles.brand, { color: theme.accent }]}>VIZIO FOOD</Text>
        <Text style={[styles.title, { color: theme.text }]}>Kitchen Tablet</Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>
          Sign in with your kitchen account. Ask an admin if you don't have one.
        </Text>

        <View style={styles.form}>
          <BigInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="kitchen@viziofood.com" />
          <BigInput label="Password" value={password} onChangeText={setPassword} secure placeholder="••••••••" />
          {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
          {message ? <Text style={[styles.error, { color: theme.info }]}>{message}</Text> : null}
          <BigButton title="SIGN IN" onPress={() => void submit()} busy={busy} disabled={busy} />
          <BigButton title="Forgot password" variant="ghost" small onPress={() => void forgot()} disabled={busy} style={{ alignSelf: 'center', marginTop: 8 }} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, maxWidth: 560, width: '100%', alignSelf: 'center', justifyContent: 'center' },
  brand: { fontSize: 34, fontWeight: '900', letterSpacing: 3, textAlign: 'center' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  hint: { fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  form: {},
  error: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
});
