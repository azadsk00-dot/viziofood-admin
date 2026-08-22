// Device health — the one screen staff can read out over the phone:
// Internet / Supabase / Realtime / Printer / Queue / Notifications / Sound /
// Last sync / Last print, plus SYNC NOW and the device identity.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useOrdersStore } from '../state/ordersStore';
import { usePrintStore, printerQueueDepth } from '../state/printStore';
import { useSettingsStore } from '../state/settingsStore';
import { syncService } from '../services/syncService';
import { notificationStatus } from '../services/notifications';
import { printerAgentHealth } from '../services/printerAgent';
import { getDeviceId, getDeviceName, appVersion } from '../lib/device';
import { formatClock } from '../lib/format';
import { BigButton, Screen, SectionTitle, useTheme } from '../components/ui';

type RowState = 'ok' | 'warn' | 'bad' | 'unknown';

export default function HealthScreen(): React.ReactElement {
  const theme = useTheme();
  const internet = useOrdersStore((s) => s.internetOnline);
  const realtime = useOrdersStore((s) => s.realtimeConnected);
  const syncStatus = useOrdersStore((s) => s.syncStatus);
  const syncError = useOrdersStore((s) => s.lastSyncError);
  const lastSyncAt = useOrdersStore((s) => s.lastSyncAt);
  const settings = useSettingsStore((s) => s.settings);
  const agent = usePrintStore((s) => s.agent);
  const printers = usePrintStore((s) => s.printers);
  const depth = usePrintStore((s) => printerQueueDepth());
  const lastPrintAt = usePrintStore((s) => s.lastPrintAt);

  const [notifications, setNotifications] = useState<RowState>('unknown');
  const [deviceInfo, setDeviceInfo] = useState({ id: '', name: '', version: '' });
  const [supabaseOk, setSupabaseOk] = useState<RowState>('unknown');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setNotifications((await notificationStatus()) === 'enabled' ? 'ok' : 'bad');
      setDeviceInfo({ id: (await getDeviceId()).slice(0, 8), name: await getDeviceName(), version: appVersion() });
    })();
  }, []);

  const checkSupabase = async () => {
    try {
      const { error } = await syncService.syncNow();
      setSupabaseOk(error ? 'bad' : 'ok');
    } catch {
      setSupabaseOk('bad');
    }
  };
  useEffect(() => {
    void checkSupabase();
    void printerAgentHealth(true);
  }, []);

  const printerState: RowState = Object.values(printers).some((p) => p.health === 'error')
    ? 'bad'
    : Object.values(printers).some((p) => p.health === 'offline')
      ? 'warn'
      : Object.values(printers).length
        ? 'ok'
        : 'unknown';

  const rows: Array<{ label: string; value: string; state: RowState }> = [
    { label: 'Internet', value: internet ? 'ONLINE' : 'OFFLINE', state: internet ? 'ok' : 'bad' },
    { label: 'Supabase', value: supabaseOk === 'ok' ? 'ONLINE' : supabaseOk === 'bad' ? 'ERROR' : 'CHECKING…', state: supabaseOk },
    { label: 'Realtime', value: realtime ? 'CONNECTED' : syncStatus === 'error' ? `RECONNECTING (${syncError ?? ''})` : 'CONNECTING…', state: realtime ? 'ok' : 'warn' },
    { label: 'Printer', value: printerState === 'ok' ? 'ONLINE' : printerState === 'bad' ? 'ERROR' : printerState === 'warn' ? 'OFFLINE' : 'NO PRINTER CONFIGURED', state: printerState },
    { label: 'Print queue', value: String(depth), state: depth > 3 ? 'warn' : 'ok' },
    { label: 'Notifications', value: notifications === 'ok' ? 'ENABLED' : notifications === 'bad' ? 'DISABLED' : 'UNKNOWN', state: notifications },
    { label: 'Sound', value: settings.soundEnabled ? `ENABLED (${Math.round(settings.volume * 100)}%)` : 'DISABLED', state: settings.soundEnabled ? 'ok' : 'warn' },
    { label: 'Vibration', value: settings.vibrationEnabled ? 'ENABLED' : 'DISABLED', state: 'ok' },
    { label: 'Last sync', value: formatClock(lastSyncAt) || '—', state: 'ok' },
    { label: 'Last print', value: formatClock(lastPrintAt) || '—', state: 'ok' },
    { label: 'App version', value: deviceInfo.version || '—', state: 'ok' },
    { label: 'Device', value: `${deviceInfo.name} (${deviceInfo.id})`, state: 'ok' },
    { label: 'Printer agent', value: agent.online ? 'ONLINE' : 'NOT REACHABLE', state: agent.online ? 'ok' : 'warn' },
  ];

  const color = (state: RowState) => (state === 'ok' ? theme.success : state === 'warn' ? theme.warning : state === 'bad' ? theme.danger : theme.textDim);

  return (
    <Screen scroll>
      <SectionTitle title="Device health" />
      <View style={[styles.grid, { backgroundColor: theme.surface }]}>
        {rows.map((row) => (
          <View key={row.label} style={[styles.cell, { borderColor: theme.border }]}>
            <Text style={[styles.cellLabel, { color: theme.textDim }]}>{row.label.toUpperCase()}</Text>
            <Text style={[styles.cellValue, { color: color(row.state) }]} numberOfLines={2}>{row.value}</Text>
          </View>
        ))}
      </View>
      <BigButton
        title="SYNC NOW"
        busy={busy}
        onPress={() => {
          setBusy(true);
          void (async () => {
            await syncService.syncNow();
            await checkSupabase();
            setBusy(false);
          })();
        }}
        style={{ marginTop: 12 }}
      />
      <Text style={[styles.hint, { color: theme.textDim }]}>
        SYNC NOW forces a full backend reconciliation: any order that arrived while the tablet
        was offline, locked or restarted is fetched immediately.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 14, borderWidth: 0, overflow: 'hidden' },
  cell: { width: '33.33%', borderWidth: 0.5, padding: 14, minHeight: 84, justifyContent: 'center' },
  cellLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  cellValue: { fontSize: 17, fontWeight: '800', marginTop: 4 },
  hint: { fontSize: 13, marginTop: 12, lineHeight: 18 },
});
