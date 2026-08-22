// Admin UI kit — page scaffolding, stat cards, charts, pills, confirm dialog.
// Everything reflows: cards wrap by available width; charts scale.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { dark } from '../../theme';
import type { DailyPoint } from '../../lib/reports';
import { aud } from '../../lib/money';

export function AdminPage(props: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  offlineBlocked?: boolean;
  onRefresh?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const online = true; // caller passes offlineBlocked for write-ops that must not run offline
  void online;
  return (
    <View style={pageStyles.root}>
      <View style={pageStyles.header}>
        <View style={{ flex: 1 }}>
          <Text style={pageStyles.title}>{props.title}</Text>
          {props.subtitle ? <Text style={pageStyles.subtitle}>{props.subtitle}</Text> : null}
        </View>
        {props.onRefresh ? (
          <Pressable style={pageStyles.refresh} onPress={props.onRefresh} hitSlop={8}>
            <Text style={pageStyles.refreshText}>REFRESH</Text>
          </Pressable>
        ) : null}
        {props.actions}
      </View>
      {props.offlineBlocked ? (
        <View style={pageStyles.offlineBar}>
          <Text style={pageStyles.offlineText}>OFFLINE — editing disabled. Financial and destructive operations need a live connection.</Text>
        </View>
      ) : null}
      {props.error ? (
        <View style={pageStyles.errorBar}>
          <Text style={pageStyles.errorText}>{props.error}</Text>
        </View>
      ) : null}
      {props.loading ? (
        <View style={pageStyles.loading}>
          <ActivityIndicator size="large" color={dark.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={pageStyles.body}>{props.children}</ScrollView>
      )}
    </View>
  );
}

export function Card(props: { children: React.ReactNode; style?: object; title?: string }): React.ReactElement {
  return (
    <View style={[kitStyles.card, props.style]}>
      {props.title ? <Text style={kitStyles.cardTitle}>{props.title.toUpperCase()}</Text> : null}
      {props.children}
    </View>
  );
}

export function StatCard(props: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}): React.ReactElement {
  const toneColor =
    props.tone === 'good' ? dark.success : props.tone === 'warn' ? dark.warning : props.tone === 'bad' ? dark.danger : dark.text;
  return (
    <View style={[kitStyles.card, { flexBasis: '48%', flexGrow: 1 }]}>
      <Text style={kitStyles.statLabel}>{props.label.toUpperCase()}</Text>
      <Text style={[kitStyles.statValue, { color: toneColor }]}>{props.value}</Text>
      {props.caption ? <Text style={kitStyles.statCaption} numberOfLines={2}>{props.caption}</Text> : null}
    </View>
  );
}

export function Pill(props: { label: string; tone?: 'default' | 'good' | 'warn' | 'bad' | 'info' }): React.ReactElement {
  const color =
    props.tone === 'good' ? dark.success
    : props.tone === 'warn' ? dark.warning
    : props.tone === 'bad' ? dark.danger
    : props.tone === 'info' ? dark.info
    : dark.textDim;
  return (
    <View style={[kitStyles.pill, { borderColor: color, backgroundColor: `${color}22` }]}>
      <Text style={[kitStyles.pillText, { color }]}>{props.label}</Text>
    </View>
  );
}

/** Pure-View bar chart — no chart dependency, scales to any width. */
export function BarChart(props: { data: DailyPoint[]; height?: number }): React.ReactElement | null {
  const { width } = useWindowDimensions();
  const chartWidth = Math.min(width - 64, 900);
  const data = props.data ?? [];
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.revenueCents));
  const barWidth = Math.max(6, Math.floor(chartWidth / data.length) - 4);
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <View>
      <View style={[kitStyles.chartRow, { height: props.height ?? 160 }]}>
        {data.map((point, i) => {
          const pct = Math.max(2, Math.round((point.revenueCents / max) * 100));
          const isSel = selected === i;
          return (
            <Pressable key={point.date} onPress={() => setSelected(isSel ? null : i)} style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 2 }}>
              <View style={{ height: `${pct}%`, backgroundColor: isSel ? dark.accent : dark.info, borderRadius: 3, minHeight: 3 }} />
            </Pressable>
          );
        })}
      </View>
      <View style={kitStyles.chartLabels}>
        {data.map((point, i) => (
          <Text key={point.date} style={[kitStyles.chartLabel, { width: barWidth + 4 }]} numberOfLines={1}>
            {data.length <= 1 ? point.date.slice(5) : i % Math.ceil(data.length / 10) === 0 ? point.date.slice(5) : ''}
          </Text>
        ))}
      </View>
      {selected !== null && data[selected] ? (
        <Text style={kitStyles.chartTip}>
          {data[selected].date}: {aud(data[selected].revenueCents)} ({data[selected].orders} orders)
        </Text>
      ) : null}
    </View>
  );
}

export function ConfirmDialog(props: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable style={kitStyles.backdrop} onPress={props.onCancel}>
        <View style={kitStyles.dialog}>
          <Text style={kitStyles.dialogTitle}>{props.title}</Text>
          <Text style={kitStyles.dialogMessage}>{props.message}</Text>
          <View style={kitStyles.dialogRow}>
            <Pressable style={[kitStyles.dialogButton, { backgroundColor: dark.surfaceAlt }]} onPress={props.onCancel}>
              <Text style={[kitStyles.dialogButtonText, { color: dark.text }]}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={[kitStyles.dialogButton, { backgroundColor: props.danger ? dark.danger : dark.accent }]}
              onPress={props.onConfirm}
            >
              <Text style={[kitStyles.dialogButtonText, { color: props.danger ? '#fff' : dark.accentText }]}>
                {props.confirmLabel ?? 'CONFIRM'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

export function EmptyState(props: { text: string }): React.ReactElement {
  return (
    <View style={kitStyles.empty}>
      <Text style={kitStyles.emptyText}>{props.text}</Text>
    </View>
  );
}

const pageStyles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 8 },
  title: { color: dark.text, fontSize: 24, fontWeight: '900' },
  subtitle: { color: dark.textDim, fontSize: 13, marginTop: 2 },
  refresh: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  refreshText: { color: dark.info, fontWeight: '800', fontSize: 12, letterSpacing: 0.8 },
  offlineBar: { backgroundColor: dark.offline, padding: 10, paddingHorizontal: 16 },
  offlineText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  errorBar: { backgroundColor: `${dark.danger}22`, borderWidth: 1, borderColor: dark.danger, borderRadius: 10, marginHorizontal: 16, padding: 10 },
  errorText: { color: dark.danger, fontWeight: '700', fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 60 },
  body: { padding: 16, paddingTop: 8, paddingBottom: 48 },
});

const kitStyles = StyleSheet.create({
  card: { backgroundColor: dark.surface, borderRadius: 14, borderWidth: 1, borderColor: dark.border, padding: 14 },
  cardTitle: { color: dark.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  statLabel: { color: dark.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  statValue: { fontSize: 26, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  statCaption: { color: dark.textDim, fontSize: 12, marginTop: 4 },
  pill: { borderRadius: 6, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 0 },
  chartLabels: { flexDirection: 'row', marginTop: 6 },
  chartLabel: { color: dark.textDim, fontSize: 9, textAlign: 'center', fontVariant: ['tabular-nums'] },
  chartTip: { color: dark.accent, fontSize: 13, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  dialog: { backgroundColor: dark.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, borderWidth: 1, borderColor: dark.border },
  dialogTitle: { color: dark.text, fontSize: 20, fontWeight: '900' },
  dialogMessage: { color: dark.textDim, fontSize: 15, marginTop: 8, lineHeight: 21 },
  dialogRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  dialogButton: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  dialogButtonText: { fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: dark.textDim, fontSize: 15, textAlign: 'center' },
});
