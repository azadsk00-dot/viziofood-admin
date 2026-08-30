// SETTINGS — the ONLY settings screen, printer-only per spec:
// status, printer IP, save, connection test, test print, auto-print toggle,
// retry failed prints (+ the receipt job list and alert test buttons).
// Nothing persists anywhere but AsyncStorage on this device.

import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, type as typeScale } from '../theme';
import type { PrintJob } from '../types';
import { useSettingsStore } from '../state/settingsStore';
import { usePrintQueueStore } from '../state/printQueueStore';
import { identifierFor, validateAddress } from '../printer/identifier';
import { printTestReceipt, testConnection } from '../printer/printerService';
import { printerQueue } from '../services/printerQueue';
import {
  getPermissionState,
  notificationDiagnostics,
  openNotificationSettings,
  requestPermission,
  sendTestNotification,
  type NotificationDiagnostics,
} from '../services/notificationService';
import { testAlertSound } from '../services/soundService';
import { currentPushToken, lastPushRegistrationResult, registerPushToken } from '../services/pushService';
import { formatTime } from '../printer/format';
import { Button, Field } from '../components/ui';

function jobBadge(job: PrintJob): { label: string; color: string; bg: string } {
  switch (job.state) {
    case 'printed':
      return { label: 'PRINTED', color: colors.accent, bg: colors.accentSoft };
    case 'printing':
    case 'queued':
      return { label: job.state.toUpperCase(), color: colors.info, bg: colors.infoSoft };
    case 'retrying':
      return {
        label: `RETRYING ${job.attempts}/${job.maxAttempts}`,
        color: colors.warning,
        bg: colors.warningSoft,
      };
    default:
      return { label: 'FAILED', color: colors.danger, bg: colors.dangerSoft };
  }
}

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const printer = useSettingsStore((state) => state.printer);
  const savePrinter = useSettingsStore((state) => state.savePrinter);

  const jobs = usePrintQueueStore((state) => state.jobs);
  const printerStatus = usePrintQueueStore((state) => state.printerStatus);
  const processing = usePrintQueueStore((state) => state.processing);

  const [address, setAddress] = useState(printer.address);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'connect' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [permission, setPermission] = useState<'granted' | 'undetermined' | 'denied' | null>(null);
  const [diag, setDiag] = useState<NotificationDiagnostics | null>(null);
  // Re-render trigger after registration re-attempts.
  const [, setPushTick] = useState(0);

  const refreshDiagnostics = async () => {
    setPermission(await getPermissionState());
    setDiag(await notificationDiagnostics());
    // Re-attempt registration so the row reflects reality right now, with
    // the exact getExpoPushTokenAsync result logged + displayed.
    if (!currentPushToken()) await registerPushToken();
    setPushTick((n) => n + 1);
  };

  useEffect(() => {
    // Deferred a microtask so state updates land after the effect body
    // returns (react-hooks/set-state-in-effect), not synchronously inside it.
    void (async () => {
      await Promise.resolve();
      await refreshDiagnostics();
    })();
    // Returning from Android system settings should refresh the statuses.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshDiagnostics();
    });
    return () => subscription.remove();
  }, []);

  // Derived Star identifier — what will actually be passed to the SDK.
  const identifier = useMemo(() => {
    const error = address.trim() ? validateAddress(address) : null;
    return error ? null : identifierFor(address);
  }, [address]);

  const jobList = useMemo(
    () =>
      Object.values(jobs)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 30),
    [jobs],
  );
  const failedCount = jobList.filter((job) => job.state === 'failed').length;

  const save = () => {
    const error = address.trim() ? validateAddress(address) : null;
    setAddressError(error);
    if (error) return;
    savePrinter({ address: address.trim() });
    setResult({ ok: true, message: 'Printer settings saved.' });
  };

  const runTest = async (kind: 'test' | 'connect') => {
    const error = validateAddress(address);
    setAddressError(error);
    if (error) return;
    savePrinter({ address: address.trim() });
    setBusy(kind);
    setResult(null);
    const settings = { autoPrint: printer.autoPrint, address: address.trim() };
    const outcome =
      kind === 'test' ? await printTestReceipt(settings) : await testConnection(settings);
    usePrintQueueStore
      .getState()
      .setPrinterStatus(outcome.ok ? 'reachable' : 'unreachable', outcome.ok ? null : outcome.error);
    setBusy(null);
    setResult({
      ok: outcome.ok,
      message: outcome.ok
        ? kind === 'test'
          ? 'Test receipt printed.'
          : 'Printer connection OK.'
        : (outcome.error ?? 'Print failed.'),
    });
  };

  const statusColor =
    printerStatus === 'reachable'
      ? colors.accent
      : printerStatus === 'unreachable'
        ? colors.danger
        : colors.textMuted;

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>VIZIO FOOD</Text>
        <Text style={styles.title}>SETTINGS</Text>

        <Text style={styles.sectionTitle}>PRINTER</Text>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={[styles.statusValue, { color: statusColor }]}>
            {printerStatus === 'reachable'
              ? '● Connected'
              : printerStatus === 'unreachable'
                ? '● Offline'
                : '● Unknown (run a connection test)'}
            {processing ? ' • printing…' : ''}
          </Text>
        </View>

        <Field
          label="Printer IP address"
          value={address}
          onChangeText={(text) => {
            setAddress(text);
            setAddressError(null);
            setResult(null);
          }}
          placeholder="192.168.1.116"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          error={addressError}
          hint={identifier ? `Identifier passed to the Star SDK: ${identifier}` : undefined}
        />

        <View style={styles.buttonRow}>
          <Button label="SAVE" onPress={save} block small disabled={!address.trim()} />
          <Button
            label={busy === 'connect' ? 'Testing…' : 'TEST CONNECTION'}
            variant="secondary"
            block
            small
            onPress={() => void runTest('connect')}
            loading={busy === 'connect'}
            disabled={!address.trim()}
          />
          <Button
            label={busy === 'test' ? 'Printing…' : 'TEST PRINT'}
            variant="secondary"
            block
            small
            onPress={() => void runTest('test')}
            loading={busy === 'test'}
            disabled={!address.trim()}
          />
        </View>

        {result ? (
          <Text style={[styles.result, { color: result.ok ? colors.accent : colors.danger }]}>
            {result.message}
          </Text>
        ) : null}

        <View style={styles.toggleRow}>
          <Text style={styles.toggleTitle}>Auto print</Text>
          <Switch
            value={printer.autoPrint}
            onValueChange={(value) => savePrinter({ autoPrint: value })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Auto print new orders"
          />
        </View>
        <Text style={styles.toggleHint}>
          Print the kitchen receipt automatically the moment a paid order arrives.
        </Text>

        <Text style={styles.sectionTitle}>PRINT JOBS</Text>
        {failedCount > 0 ? (
          <Button
            label={`RETRY FAILED PRINTS (${failedCount})`}
            variant="danger"
            small
            onPress={() => printerQueue.retryAllFailed()}
          />
        ) : null}
        {jobList.length === 0 ? (
          <Text style={styles.muted}>
            No print jobs yet — jobs appear as orders arrive (auto print on) or when you reprint.
          </Text>
        ) : (
          jobList.map((job) => {
            const badge = jobBadge(job);
            return (
              <View key={job.id + job.createdAt} style={styles.job}>
                <View style={styles.jobHead}>
                  <Text style={styles.jobNumber}>#{job.orderNumber.replace('VF-', '')}</Text>
                  <View style={[styles.jobBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.jobBadgeLabel, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                </View>
                <Text style={styles.jobMeta}>
                  {formatTime(job.createdAt)}
                  {job.printedAt ? ` → printed ${formatTime(job.printedAt)}` : ''}
                  {job.origin === 'reprint' ? ' • reprint' : ''}
                </Text>
                {job.lastError ? (
                  <Text style={styles.jobError} numberOfLines={3}>
                    {job.lastError}
                  </Text>
                ) : null}
                {job.state === 'failed' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry this print job"
                    style={styles.retry}
                    onPress={() => printerQueue.retryJob(job.id)}
                  >
                    <Text style={styles.retryLabel}>RETRY</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
        {Object.values(jobs).some((job) => job.state === 'printed') ? (
          <Button
            label="CLEAR PRINTED JOBS"
            variant="ghost"
            small
            onPress={() => printerQueue.clearCompleted()}
          />
        ) : null}

        <Text style={styles.sectionTitle}>ALERTS</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Push permission</Text>
          <Text
            style={[
              styles.statusValue,
              permission === 'granted' ? { color: colors.accent } : { color: colors.danger },
            ]}
          >
            {permission === 'granted' ? '● GRANTED' : `● ${(permission ?? 'unknown').toUpperCase()}`}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Alert channel sound</Text>
          <Text
            style={[
              styles.statusValue,
              diag?.ordersChannelSound ? { color: colors.accent } : { color: colors.danger },
            ]}
          >
            {diag ? (diag.ordersChannelSound ? `● ${diag.ordersChannelSound}` : '● MISSING') : '…'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Push channel (background)</Text>
          <Text
            style={[
              styles.statusValue,
              diag?.pushAliasChannelSound ? { color: colors.accent } : { color: colors.danger },
            ]}
          >
            {diag ? (diag.pushAliasChannelSound ? '● Ready' : '● MISSING') : '…'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Push token</Text>
          <Text
            style={[
              styles.statusValue,
              currentPushToken() ? { color: colors.accent } : { color: colors.danger },
            ]}
          >
            {currentPushToken() ? '● REGISTERED' : '● NOT REGISTERED'}
          </Text>
        </View>
        {!currentPushToken() && lastPushRegistrationResult() ? (
          <Text style={styles.pushDetail}>{lastPushRegistrationResult()?.detail}</Text>
        ) : null}
        <View style={styles.buttonRow}>
          {permission !== 'granted' ? (
            <Button
              label={permission === 'denied' ? 'NOTIFICATIONS BLOCKED — OPEN SETTINGS' : 'ENABLE NOTIFICATIONS'}
              variant="secondary"
              block
              small
              onPress={() => {
                if (permission === 'denied') {
                  openNotificationSettings(); // Android blocks re-prompts after a denial
                } else {
                  void requestPermission().then(async (granted) => {
                    await refreshDiagnostics();
                    if (!granted) {
                      setResult({
                        ok: false,
                        message:
                          'Notification permission denied — enable it in Android Settings → Apps → VIZIO FOOD Orders → Notifications.',
                      });
                    }
                  });
                }
              }}
            />
          ) : null}
          <Button
            label="TEST SOUND"
            variant="secondary"
            block
            small
            onPress={() => void testAlertSound()}
          />
          <Button
            label="TEST NOTIFICATION"
            variant="secondary"
            block
            small
            onPress={async () => {
              // LOCAL ONLY — no Supabase/Realtime/FCM involved. If the
              // permission is missing the post is skipped and we say so,
              // so the on-device result is unambiguous.
              const granted = await requestPermission();
              await refreshDiagnostics();
              if (!granted) {
                setResult({
                  ok: false,
                  message:
                    'NOT posted — notification permission denied. Tap NOTIFICATION PERMISSION above / Android Settings to allow, then test again.',
                });
                return;
              }
              await sendTestNotification();
              setResult({
                ok: true,
                message:
                  'Local notification posted on channel orders_v2 (sound + vibration). Nothing visible? Check Android Settings → Apps → VIZIO FOOD Orders → Notifications.',
              });
            }}
          />
        </View>
        {!currentPushToken() ? (
          <Text style={styles.pushNote}>
            Background alerts need Firebase credentials in the APK (google-services.json — see
            README). In-app alerts are unaffected.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, maxWidth: 720, width: '100%', alignSelf: 'center' },
  brand: { color: colors.textFaint, fontSize: typeScale.tiny, fontWeight: '800', letterSpacing: 2.5 },
  title: { color: colors.text, fontSize: typeScale.title, fontWeight: '900', marginBottom: spacing.sm },
  sectionTitle: {
    color: colors.textFaint,
    fontSize: typeScale.tiny,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  statusLabel: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: '700' },
  statusValue: { fontSize: typeScale.small, fontWeight: '800' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  result: { fontSize: typeScale.small, fontWeight: '700', marginBottom: spacing.md },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  toggleTitle: { color: colors.text, fontSize: typeScale.bodyLarge, fontWeight: '700' },
  toggleHint: { color: colors.textFaint, fontSize: typeScale.small, marginTop: spacing.xs },
  job: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  jobHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobNumber: { color: colors.text, fontSize: typeScale.body, fontWeight: '800' },
  jobBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  jobBadgeLabel: { fontSize: typeScale.tiny, fontWeight: '800', letterSpacing: 0.4 },
  jobMeta: { color: colors.textFaint, fontSize: typeScale.small },
  jobError: { color: colors.danger, fontSize: typeScale.small },
  retry: { alignSelf: 'flex-start', marginTop: spacing.xs },
  retryLabel: { color: colors.danger, fontWeight: '800', fontSize: typeScale.small, letterSpacing: 0.5 },
  muted: { color: colors.textFaint, fontSize: typeScale.small },
  pushDetail: { color: colors.danger, fontSize: typeScale.small, marginBottom: spacing.md, marginTop: -spacing.xs },
  pushNote: { color: colors.textFaint, fontSize: typeScale.small, marginTop: spacing.sm },
});
