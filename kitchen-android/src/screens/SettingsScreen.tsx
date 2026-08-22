// Settings — alert sound/volume/repeat/vibration + test buttons, display,
// workflow thresholds, sync interval, printer agent, account.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettingsStore } from '../state/settingsStore';
import { useAuthStore } from '../state/authStore';
import { syncService } from '../services/syncService';
import { testAlertSound } from '../services/alertPlayer';
import { sendTestNotification, registerForPush } from '../services/notifications';
import { RECONCILE_CHOICES } from '../lib/settings';
import { BigButton, BigInput, Screen, SectionTitle, Toggle, useTheme } from '../components/ui';

export default function SettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const email = useAuthStore((s) => s.email);
  const role = useAuthStore((s) => s.role);
  const fullName = useAuthStore((s) => s.fullName);
  const signOut = useAuthStore((s) => s.signOut);

  const [pushMessage, setPushMessage] = useState('');

  useEffect(() => {
    syncService.onSettingsChanged();
  }, [settings.reconcileIntervalSec]);

  const stepper = (label: string, key: 'repeatCount' | 'repeatIntervalSec' | 'warnMinutes' | 'urgentMinutes' | 'managerMinutes' | 'overdueMinutes', step: number, min: number, max: number, hint: string) => (
    <View style={styles.stepperRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stepperLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.stepperHint, { color: theme.textDim }]}>{hint}</Text>
      </View>
      <Pressable style={[styles.stepButton, { borderColor: theme.border }]} onPress={() => update({ [key]: Math.max(min, settings[key] - step) } as never)}>
        <Text style={[styles.stepButtonText, { color: theme.text }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: theme.text }]}>{settings[key]}</Text>
      <Pressable style={[styles.stepButton, { borderColor: theme.border }]} onPress={() => update({ [key]: Math.min(max, settings[key] + step) } as never)}>
        <Text style={[styles.stepButtonText, { color: theme.text }]}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen scroll>
      <SectionTitle title="Alerts" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Toggle label="New order sound" value={settings.soundEnabled} onChange={(v) => update({ soundEnabled: v })} hint="The custom Vizio multi-tone kitchen chime" />
        <View style={styles.volumeRow}>
          <Text style={[styles.stepperLabel, { color: theme.text }]}>Volume — {Math.round(settings.volume * 100)}%</Text>
          <View style={[styles.volumeBar, { borderColor: theme.border }]}>
            {[0.2, 0.4, 0.6, 0.8, 1].map((v) => (
              <Pressable
                key={v}
                onPress={() => update({ volume: v })}
                style={[styles.volumeStep, { backgroundColor: settings.volume >= v - 0.01 ? theme.accent : 'transparent' }]}
              />
            ))}
          </View>
        </View>
        {stepper('Repeat count', 'repeatCount', 1, 0, 20, '0 = keep repeating until someone acknowledges')}
        {stepper('Repeat interval (s)', 'repeatIntervalSec', 1, 3, 120, 'Gap between repeats while unacknowledged')}
        <Toggle label="Vibration" value={settings.vibrationEnabled} onChange={(v) => update({ vibrationEnabled: v })} />
        <View style={styles.testRow}>
          <BigButton title="TEST ORDER SOUND" small variant="secondary" onPress={() => void testAlertSound()} style={{ flex: 1 }} />
          <BigButton title="TEST NOTIFICATION" small variant="secondary" onPress={() => void sendTestNotification()} style={{ flex: 1 }} />
        </View>
        <Text style={[styles.hint, { color: theme.textDim }]}>
          Stand where the food is prepared. If you cannot hear the test sound clearly, raise the
          volume — real orders use exactly this sound at exactly this volume.
        </Text>
        <View style={styles.testRow}>
          <BigButton
            title="RE-REGISTER PUSH"
            small
            variant="ghost"
            onPress={() => {
              setPushMessage('Registering…');
              void (async () => {
                const result = await registerForPush();
                setPushMessage(result.ok ? 'Push token registered.' : result.error ?? 'Registration failed.');
              })();
            }}
            style={{ flex: 1 }}
          />
        </View>
        {pushMessage ? <Text style={[styles.hint, { color: theme.info }]}>{pushMessage}</Text> : null}
      </View>

      <SectionTitle title="Escalation thresholds (minutes)" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {stepper('Warning at', 'warnMinutes', 1, 1, 60, 'NEW order this old is highlighted')}
        {stepper('Urgent at', 'urgentMinutes', 1, 2, 90, 'NEW order this old is urgent')}
        {stepper('Manager alert at', 'managerMinutes', 1, 3, 180, 'NEW order this old needs a manager')}
        {stepper('Overdue at', 'overdueMinutes', 1, 3, 240, 'Accepted/Preparing past this = OVERDUE')}
      </View>

      <SectionTitle title="Display" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Toggle label="Keep screen awake" value={settings.keepScreenAwake} onChange={(v) => update({ keepScreenAwake: v })} hint="Recommended ON for the dedicated kitchen tablet" />
        <Toggle label="Dark theme" value={settings.theme === 'dark'} onChange={(v) => update({ theme: v ? 'dark' : 'light' })} />
        <Toggle label="Oldest orders first" value={settings.sortOldestFirst} onChange={(v) => update({ sortOldestFirst: v })} hint="Off = newest orders at the top" />
        <Toggle label="Auto-acknowledge on ACCEPT" value={settings.autoAckOnAdvance} onChange={(v) => update({ autoAckOnAdvance: v })} hint="Accepting an order also marks it acknowledged" />
      </View>

      <SectionTitle title="Sync" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.stepperLabel, { color: theme.text }]}>Reconciliation interval</Text>
        <View style={styles.choiceRow}>
          {RECONCILE_CHOICES.map((seconds) => (
            <Pressable
              key={seconds}
              onPress={() => update({ reconcileIntervalSec: seconds })}
              style={[styles.choice, { borderColor: settings.reconcileIntervalSec === seconds ? theme.accent : theme.border }]}
            >
              <Text style={{ color: settings.reconcileIntervalSec === seconds ? theme.accent : theme.textDim, fontWeight: '800' }}>
                {seconds}s
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.hint, { color: theme.textDim }]}>
          The tablet re-checks the backend on this schedule even when realtime is connected —
          this is the safety net that catches missed orders.
        </Text>
      </View>

      <SectionTitle title="Printer agent (restaurant PC)" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <BigInput label="Agent URL" value={settings.agentUrl} onChangeText={(v) => update({ agentUrl: v.trim() })} placeholder="http://192.168.1.20:3777" />
        <BigInput label="Agent token (if set)" value={settings.agentToken} onChangeText={(v) => update({ agentToken: v.trim() })} placeholder="x-vizio-token value" />
        <Text style={[styles.hint, { color: theme.textDim }]}>
          Enable the agent endpoint by setting VIZIO_AGENT_HTTP_PORT in printer-service/.env —
          this powers TEST PRINT and live printer status.
        </Text>
      </View>

      <SectionTitle title="Account" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.stepperLabel, { color: theme.text }]}>{fullName || email || 'Signed in'}</Text>
        <Text style={[styles.stepperHint, { color: theme.textDim }]}>
          {email} · role: {role ?? 'unknown'}
        </Text>
        <BigButton title="SIGN OUT" variant="danger" onPress={() => void signOut()} style={{ marginTop: 12 }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, marginBottom: 4 },
  volumeRow: { paddingVertical: 10 },
  volumeBar: { flexDirection: 'row', height: 40, borderRadius: 10, borderWidth: 2, overflow: 'hidden', marginTop: 8 },
  volumeStep: { flex: 1, borderRightWidth: 1, borderColor: 'rgba(128,128,128,0.3)' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  stepperLabel: { fontSize: 16, fontWeight: '700' },
  stepperHint: { fontSize: 13, marginTop: 2 },
  stepButton: { width: 52, height: 52, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepButtonText: { fontSize: 28, fontWeight: '900' },
  stepValue: { minWidth: 44, textAlign: 'center', fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  testRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  hint: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  choiceRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  choice: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
});
