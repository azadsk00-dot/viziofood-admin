// AlertOverlay — impossible-to-miss full-screen takeover when a new paid
// order arrives (and stays until acknowledged or advanced). Designed for a
// noisy commercial kitchen: huge order number, item count, fulfilment type.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOrdersStore } from '../state/ordersStore';
import { acknowledgeOrder } from '../services/orderActions';
import { navigateToOrder } from '../navigation/RootNavigator';
import { dark } from '../theme';
import { fulfilmentLabel } from '../lib/orderLogic';

export default function AlertOverlay(): React.ReactElement | null {
  const activeAlertOrderId = useOrdersStore((s) => s.activeAlertOrderId);
  const order = useOrdersStore((s) => (s.activeAlertOrderId ? s.orders[s.activeAlertOrderId] : undefined));

  if (!activeAlertOrderId || !order) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void acknowledgeOrder(order.id)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.flag}>🔔 NEW PAID ORDER</Text>
          <Text style={styles.orderNumber}>#{order.orderNumber.replace('VF-', '')}</Text>
          <Text style={styles.sub}>
            {fulfilmentLabel(order.fulfilment)} · {order.itemsCount || order.items.length} items ·{' '}
            {order.customerName || 'Customer'}
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={styles.viewButton}
              onPress={() => {
                void acknowledgeOrder(order.id);
                navigateToOrder(order.id);
              }}
            >
              <Text style={styles.viewButtonText}>VIEW ORDER</Text>
            </Pressable>
            <Pressable style={styles.ackButton} onPress={() => void acknowledgeOrder(order.id)}>
              <Text style={styles.ackButtonText}>ACKNOWLEDGE</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(255,93,77,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  card: {
    backgroundColor: '#0B0E13',
    borderRadius: 24,
    borderWidth: 6,
    borderColor: dark.accent,
    paddingVertical: 36,
    paddingHorizontal: 48,
    alignItems: 'center',
    maxWidth: 720,
  },
  flag: { color: dark.accent, fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  orderNumber: { color: '#fff', fontSize: 88, fontWeight: '900', marginVertical: 12 },
  sub: { color: '#9AA6B8', fontSize: 22, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 16, marginTop: 32 },
  viewButton: { backgroundColor: dark.accent, borderRadius: 16, paddingHorizontal: 32, paddingVertical: 20 },
  viewButtonText: { color: '#1A1405', fontSize: 22, fontWeight: '900' },
  ackButton: { backgroundColor: '#1C232F', borderRadius: 16, paddingHorizontal: 32, paddingVertical: 20, borderWidth: 2, borderColor: dark.border },
  ackButtonText: { color: '#fff', fontSize: 22, fontWeight: '900' },
});
