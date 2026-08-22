// Notifications — alert configuration (sound/volume/repeat/vibration +
// tests + push registration status) and the per-order notification audit
// history (notified/opened/acknowledged per device).

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminPage, Card, Pill } from '../components/admin/kit';
import { testAlertSound } from '../services/alertPlayer';
import { notificationStatus, registerForPush, sendTestNotification } from '../services/notifications';
import { useSettingsStore } from '../state/settingsStore';
import { useOrdersStore } from '../state/ordersStore';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/format';
import { dark } from '../theme';
import type { NotificationLogEntry } from '../lib/adminTypes';

export default function NotificationsScreen(): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const online = useOrdersStore((s) => s.internetOnline);
  const [permission, setPermission] = useState('unknown');
  const [pushMessage, setPushMessage] = useState('');
  const [history, setHistory] = useState<NotificationLogEntry[]>([]);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    void notificationStatus().then((status) => setPermission(status));
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryError('');
    const { data, error } = await supabase
      .from('kitchen_notification_logs')
      .select('id,order_id,order_number,device_id,source,notified_at,opened_at,acknowledged_at')
      .order('notified_at', { ascending: false })
      .limit(50);
    if (error) {
      setHistoryError('Notification history needs migration 20260827000000 (not deployed yet).');
      setHistory([]);
      return;
    }
    setHistory(
      (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r.id as string,
          orderId: (r.order_id as string) ?? '',
          orderNumber: (r.order_number as string) ?? '',
          deviceId: (r.device_id as string) ?? '',
          source: (r.source as string) ?? '',
          notifiedAt: (r.notified_at as string) ?? '',
          openedAt: (r.opened_at as string | null) ?? null,
          acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
        };
      }),
    );
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <AdminPage
      title="Notifications"
      subtitle="New-order alerts for this device"
      onRefresh={() => void loadHistory()}
      error={historyError || undefined}
    >
      <Card title="Alert setup">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Pill label={`PERMISSION: ${permission.toUpperCase()}`} tone={permission === 'enabled' ? 'good' : 'bad'} />
          <Pill label={`SOUND: ${settings.soundEnabled ? 'ON' : 'OFF'}`} tone={settings.soundEnabled ? 'good' : 'warn'} />
          <Pill label={`VOLUME: ${Math.round(settings.volume * 100)}%`} tone="info" />
          <Pill label={`VIBRATION: ${settings.vibrationEnabled ? 'ON' : 'OFF'}`} tone={settings.vibrationEnabled ? 'good' : 'warn'} />
        </View>
        <Text style={styles.hint}>
          The custom Vizio Food order sound plays even in silent mode. Stand where food is prepared and test —
          real orders use exactly this sound at exactly this volume.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Pressable style={styles.button} onPress={() => void testAlertSound()}>
            <Text style={styles.buttonText}>TEST ORDER SOUND</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => void sendTestNotification()}>
            <Text style={styles.buttonText}>TEST NOTIFICATION</Text>
          </Pressable>
          <Pressable
            style={[styles.button, { borderColor: dark.info }]}
            disabled={!online}
            onPress={() => {
              setPushMessage('Registering…');
              void registerForPush().then((result) => setPushMessage(result.ok ? 'Push token registered.' : result.error ?? 'Failed.'));
            }}
          >
            <Text style={[styles.buttonText, { color: dark.info }]}>RE-REGISTER PUSH</Text>
          </Pressable>
        </View>
        {pushMessage ? <Text style={[styles.hint, { color: dark.info }]}>{pushMessage}</Text> : null}
      </Card>

      <Card title="Alert behaviour" style={{ marginTop: 12 }}>
        <Row label={`Repeat: ${settings.repeatCount === 0 ? 'until acknowledged' : `${settings.repeatCount} times`}`} />
        <Row label={`Repeat interval: ${settings.repeatIntervalSec}s`} />
        <Row label={`Warning at ${settings.warnMinutes} min · urgent ${settings.urgentMinutes} · manager ${settings.managerMinutes}`} />
        <Row label={`Overdue (accepted/preparing) at ${settings.overdueMinutes} min`} />
        <Text style={styles.hint}>Adjust these in App settings → Alerts & escalation.</Text>
      </Card>

      <Card title="Notification history (audit)" style={{ marginTop: 12 }}>
        {history.length ? (
          history.map((entry) => (
            <View key={entry.id} style={styles.historyRow}>
              <Text style={{ color: dark.text, fontWeight: '700' }}>#{entry.orderNumber.replace('VF-', '')}</Text>
              <Text style={styles.hint}>{entry.source}</Text>
              <Text style={styles.hint}>notified {formatDateTime(entry.notifiedAt)}</Text>
              <Pill label={entry.acknowledgedAt ? 'ACKNOWLEDGED' : entry.openedAt ? 'OPENED' : 'UNSEEN'} tone={entry.acknowledgedAt ? 'good' : 'warn'} />
            </View>
          ))
        ) : (
          <Text style={styles.hint}>No notification audit entries yet (appears once the backend migration is deployed).</Text>
        )}
      </Card>
    </AdminPage>
  );
}

function Row(props: { label: string }): React.ReactElement {
  return <Text style={{ color: dark.textDim, fontSize: 14, paddingVertical: 3 }}>• {props.label}</Text>;
}

const styles = StyleSheet.create({
  hint: { color: dark.textDim, fontSize: 13, lineHeight: 18 },
  button: { borderWidth: 2, borderColor: dark.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  buttonText: { color: dark.accent, fontWeight: '900', fontSize: 13 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: dark.border },
});
