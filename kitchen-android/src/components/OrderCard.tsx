// OrderCard — the kitchen workhorse. Big type, live elapsed timer, item
// list with modifiers/notes, escalation highlighting, one-tap actions.

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { KitchenOrder } from '../lib/types';
import {
  ADVANCE_LABEL,
  advanceTarget,
  escalationLevel,
  fulfilmentLabel,
  isUnacknowledged,
  modifierNames,
} from '../lib/orderLogic';
import type { KitchenSettings } from '../lib/settings';
import { orderAgeSeconds } from '../lib/orderLogic';
import { formatElapsed } from '../lib/format';
import { STATUS_COLORS } from '../theme';
import { useTheme } from './ui';

const ESCALATION_COLORS: Record<string, string> = {
  none: 'transparent',
  warning: '#FFB13D',
  urgent: '#FF8A3D',
  manager: '#FF5D5D',
  overdue: '#B18CFF',
};

function TimerChip(props: { order: KitchenOrder; escalation: string }): React.ReactElement {
  const theme = useTheme();
  const color = ESCALATION_COLORS[props.escalation] ?? theme.textDim;
  const seconds = orderAgeSeconds(props.order);
  return (
    <View style={[timerStyles.chip, { borderColor: color || theme.border }]}>
      <Text style={[timerStyles.text, { color: color || theme.textDim }]}>{formatElapsed(seconds)}</Text>
    </View>
  );
}

const timerStyles = StyleSheet.create({
  chip: { borderRadius: 10, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 4 },
  text: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

interface OrderCardProps {
  order: KitchenOrder;
  settings: KitchenSettings;
  now: number;
  onOpen: (orderId: string) => void;
  onAdvance: (order: KitchenOrder) => void;
  onAcknowledge: (orderId: string) => void;
  busy?: boolean;
}

function OrderCardInner(props: OrderCardProps): React.ReactElement {
  const theme = useTheme();
  const { order, settings, now } = props;
  const escalation = escalationLevel(order, settings, now);
  const statusColor = theme[STATUS_COLORS[order.status] ?? 'textDim'];
  const unacked = isUnacknowledged(order);
  const target = advanceTarget(order.status);
  const advanceLabel = target ? ADVANCE_LABEL[order.status] ?? target.toUpperCase() : null;
  const edgeColor = escalation !== 'none' ? ESCALATION_COLORS[escalation] : statusColor;

  return (
    <Pressable
      onPress={() => props.onOpen(order.id)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: edgeColor,
          opacity: pressed ? 0.9 : 1,
          borderWidth: unacked || escalation === 'manager' || escalation === 'urgent' ? 4 : 2,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.orderNumber, { color: theme.text }]}>#{order.orderNumber.replace('VF-', '')}</Text>
            <View style={[styles.badge, { backgroundColor: `${statusColor}22`, borderColor: statusColor }]}>
              <Text style={[styles.badgeText, { color: statusColor }]}>{order.status.toUpperCase()}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: `${theme.info}22`, borderColor: theme.info }]}>
              <Text style={[styles.badgeText, { color: theme.info }]}>{fulfilmentLabel(order.fulfilment)}</Text>
            </View>
          </View>
          <Text style={[styles.meta, { color: theme.textDim }]}>
            {order.customerName || 'Walk-in'} · {order.itemsCount || order.items.length} items
            {order.paymentStatus !== 'paid' ? ` · ${order.paymentStatus.toUpperCase()}` : ''}
          </Text>
        </View>
        <TimerChip order={order} escalation={escalation} />
      </View>

      <View style={[styles.itemsBox, { borderColor: theme.border }]}>
        {order.items.length === 0 ? (
          <Text style={[styles.itemLine, { color: theme.textDim }]}>Loading items…</Text>
        ) : (
          order.items.map((item) => (
            <View key={item.id} style={styles.itemBlock}>
              <Text style={[styles.itemLine, { color: theme.text }]}>
                {item.quantity} × {item.name}
              </Text>
              {modifierNames(item).map((mod, i) => (
                <Text key={i} style={[styles.modLine, { color: theme.textDim }]}>   + {mod}</Text>
              ))}
              {item.notes ? (
                <Text style={[styles.noteLine, { color: theme.warning }]}>   NOTE: {item.notes}</Text>
              ) : null}
            </View>
          ))
        )}
        {order.specialInstructions ? (
          <Text style={[styles.orderNote, { color: theme.warning }]}>ORDER NOTE: {order.specialInstructions}</Text>
        ) : null}
      </View>

      <View style={styles.actionsRow}>
        {unacked ? (
          <Pressable
            onPress={() => props.onAcknowledge(order.id)}
            style={[styles.ackButton, { backgroundColor: theme.accent }]}
          >
            <Text style={[styles.ackButtonText, { color: theme.accentText }]}>ACKNOWLEDGE</Text>
          </Pressable>
        ) : null}
        {advanceLabel ? (
          <Pressable
            onPress={() => props.onAdvance(order)}
            disabled={props.busy}
            style={[styles.advanceButton, { backgroundColor: statusColor, opacity: props.busy ? 0.5 : 1 }]}
          >
            <Text style={styles.advanceButtonText}>{advanceLabel}</Text>
          </Pressable>
        ) : (
          <Text style={[styles.doneText, { color: theme.textDim }]}>
            {order.status === 'Cancelled' ? `CANCELLED — ${order.cancellationReason || ''}` : order.status.toUpperCase()}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export const OrderCard = memo(OrderCardInner, (a, b) =>
  a.order === b.order &&
  a.settings === b.settings &&
  Math.floor(a.now / 1000) === Math.floor(b.now / 1000) &&
  a.busy === b.busy,
);

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 2, padding: 14, marginBottom: 12, flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  orderNumber: { fontSize: 26, fontWeight: '900' },
  badge: { borderRadius: 6, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  meta: { fontSize: 14, marginTop: 4, fontWeight: '600' },
  itemsBox: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 8, marginBottom: 10, minHeight: 60 },
  itemBlock: { marginBottom: 4 },
  itemLine: { fontSize: 18, fontWeight: '700' },
  modLine: { fontSize: 15, fontWeight: '500' },
  noteLine: { fontSize: 15, fontWeight: '700' },
  orderNote: { fontSize: 15, fontWeight: '800', marginTop: 6 },
  actionsRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  ackButton: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 14, minHeight: 56, justifyContent: 'center' },
  ackButtonText: { fontSize: 17, fontWeight: '900', letterSpacing: 0.5 },
  advanceButton: { borderRadius: 12, paddingHorizontal: 22, paddingVertical: 14, minHeight: 56, justifyContent: 'center', flex: 1, alignItems: 'center' },
  advanceButtonText: { color: '#0B0E13', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  doneText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
});
