// ConnectionBanner — ONLINE / OFFLINE / SYNCING strip plus printer chip.
// Staff should always be able to trust what the tablet claims to know.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOrdersStore } from '../state/ordersStore';
import { usePrintStore, printerQueueDepth } from '../state/printStore';
import { formatClock } from '../lib/format';
import { useTheme } from './ui';

export function ConnectionBanner(): React.ReactElement {
  const theme = useTheme();
  const online = useOrdersStore((s) => s.internetOnline);
  const realtime = useOrdersStore((s) => s.realtimeConnected);
  const syncStatus = useOrdersStore((s) => s.syncStatus);
  const lastSyncAt = useOrdersStore((s) => s.lastSyncAt);

  const label =
    !online ? 'OFFLINE'
    : syncStatus === 'syncing' ? 'SYNCING…'
    : syncStatus === 'error' ? 'RECONNECTING…'
    : realtime ? 'LIVE'
    : 'CONNECTING…';
  const color = !online ? theme.offline : syncStatus === 'error' ? theme.warning : theme.online;

  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
      <Text style={[styles.meta, { color: theme.textDim }]}>
        Last sync {formatClock(lastSyncAt)}
      </Text>
    </View>
  );
}

export function PrinterChip(props: { onPress: () => void }): React.ReactElement {
  const theme = useTheme();
  const agent = usePrintStore((s) => s.agent);
  const printers = usePrintStore((s) => s.printers);
  const depth = usePrintStore((s) => printerQueueDepth());

  const anyError = Object.values(printers).some((p) => p.health === 'error');
  const anyOffline = Object.values(printers).some((p) => p.health === 'offline');
  const color = anyError ? theme.danger : anyOffline ? theme.offline : theme.online;
  const label = anyError ? 'PRINTER ERROR' : depth > 0 ? `PRINTING… (${depth})` : 'PRINTER OK';

  return (
    <Pressable onPress={props.onPress} style={[styles.chip, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  label: { fontSize: 15, fontWeight: '900', letterSpacing: 0.6 },
  meta: { fontSize: 13, fontWeight: '600', marginLeft: 'auto' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
