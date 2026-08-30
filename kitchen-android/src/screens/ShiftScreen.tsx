// Shift — handover snapshot (pending/active/overdue + print queue) and a
// daily summary (orders, completed, cancelled, refunds, average prep time).

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useOrdersStore } from '../state/ordersStore';
import { usePrintStore, printerQueueDepth } from '../state/printStore';
import { useSettingsStore } from '../state/settingsStore';
import { escalationLevel, isLive, isUnacknowledged } from '../lib/orderLogic';
import { fetchRecentIncidents, RecentIncident } from '../services/incidents';
import { startOfToday } from '../lib/format';
import { Screen, SectionTitle, useTheme } from '../components/ui';

export default function ShiftScreen(): React.ReactElement {
  const theme = useTheme();
  const orders = useOrdersStore((s) => s.orders);
  const settings = useSettingsStore((s) => s.settings);
  const depth = usePrintStore((s) => printerQueueDepth());
  const [incidents, setIncidents] = useState<RecentIncident[]>([]);

  useEffect(() => {
    void (async () => {
      const loaded = await fetchRecentIncidents(30);
      setIncidents(loaded);
    })();
  }, []);

  const today = Object.values(orders).filter((o) => Date.parse(o.createdAt) >= Date.parse(startOfToday()));
  const now = Date.now();
  const active = today.filter((o) => isLive(o.status));
  const unacked = today.filter(isUnacknowledged);
  const overdue = active.filter((o) => {
    const level = escalationLevel(o, settings, now);
    return level === 'overdue' || level === 'urgent' || level === 'manager';
  });
  const completed = today.filter((o) => o.status === 'Completed');
  const cancelled = today.filter((o) => o.status === 'Cancelled' || o.status === 'Rejected');
  const refunds = today.filter((o) => o.refundStatus && o.refundStatus !== '');
  const prepTimes = completed
    .map((o) => (Date.parse(o.updatedAt) - Date.parse(o.createdAt)) / 60_000)
    .filter((minutes) => minutes > 0 && minutes < 240);
  const avgPrep = prepTimes.length ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length : null;

  const stat = (label: string, value: string | number, danger = false) => (
    <View key={label} style={[styles.stat, { backgroundColor: theme.surface }]}>
      <Text style={[styles.statLabel, { color: theme.textDim }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.statValue, { color: danger ? theme.danger : theme.text }]}>{value}</Text>
    </View>
  );

  return (
    <Screen scroll>
      <SectionTitle title="Shift handover" />
      <View style={styles.statGrid}>
        {stat('Pending (NEW)', today.filter((o) => o.status === 'New').length, unacked.length > 0)}
        {stat('Active', active.length)}
        {stat('Unacknowledged', unacked.length, unacked.length > 0)}
        {stat('Overdue', overdue.length, overdue.length > 0)}
        {stat('Print queue', depth, depth > 3)}
      </View>
      {unacked.length > 0 ? (
        <Text style={[styles.warn, { color: theme.danger }]}>
          ⚠ {unacked.length} order(s) nobody has acknowledged yet.
        </Text>
      ) : null}

      <SectionTitle title="Today" />
      <View style={styles.statGrid}>
        {stat('Orders', today.length)}
        {stat('Completed', completed.length)}
        {stat('Cancelled', cancelled.length)}
        {stat('Refunds', refunds.length)}
        {stat('Avg prep', avgPrep === null ? '—' : `${Math.round(avgPrep)} min`)}
      </View>

      <SectionTitle title="Incident log (recent)" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {incidents.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textDim }]}>
            No incidents recorded{` — `}printer failures, network outages, missed orders and manual
            reprints appear here automatically.
          </Text>
        ) : (
          incidents.map((incident) => (
            <View key={incident.id} style={styles.incidentRow}>
              <Text
                style={[
                  styles.incidentKind,
                  {
                    color:
                      incident.severity === 'critical' ? theme.danger
                      : incident.severity === 'warning' ? theme.warning
                      : theme.textDim,
                  },
                ]}
              >
                {incident.kind.replace(/_/g, ' ').toUpperCase()}
              </Text>
              <Text style={[styles.incidentMessage, { color: theme.textDim }]} numberOfLines={3}>
                {incident.message}
              </Text>
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '31%', flexGrow: 1, borderRadius: 14, padding: 14 },
  statLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  statValue: { fontSize: 30, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  warn: { fontSize: 16, fontWeight: '800', marginTop: 10 },
  card: { borderRadius: 14, padding: 14 },
  empty: { fontSize: 14, lineHeight: 20 },
  incidentRow: { marginBottom: 10 },
  incidentKind: { fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  incidentMessage: { fontSize: 14, marginTop: 2 },
});
