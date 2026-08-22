// Order detail — everything the kitchen needs about one order, including
// per-printer print status, reprint, acknowledge, advance and cancel.

import React, { useEffect, useState } from 'react';
import { Linking, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useOrdersStore } from '../state/ordersStore';
import { usePrintStore } from '../state/printStore';
import { useAuthStore } from '../state/authStore';
import { acknowledgeOrder, cancelOrder, updateOrderStatus } from '../services/orderActions';
import { reprintOrder } from '../services/printActions';
import { ADVANCE_LABEL, advanceTarget, canTransition, modifierNames } from '../lib/orderLogic';
import { formatDateTime, formatMoney } from '../lib/format';
import { BigButton, Field, Screen, SectionTitle, useTheme } from '../components/ui';

export default function OrderDetailScreen(): React.ReactElement {
  const theme = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'OrderDetail'>>();
  const orderId = route.params.orderId;
  const order = useOrdersStore((s) => s.orders[orderId]);
  const jobs = usePrintStore((s) =>
    Object.values(s.jobs).filter((j) => j.orderId === orderId),
  );
  const printers = usePrintStore((s) => s.printers);
  const role = useAuthStore((s) => s.role);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!order) {
    return (
      <Screen>
        <Text style={{ color: theme.textDim, fontSize: 18 }}>Order not found — it may have been removed.</Text>
      </Screen>
    );
  }
  void now; // re-render hook for print statuses

  const target = advanceTarget(order.status);
  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(true);
    setMessage('');
    const result = await action();
    setBusy(false);
    setMessage(result.ok ? success : result.error ?? 'Action failed');
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={[styles.orderNumber, { color: theme.text }]}>#{order.orderNumber.replace('VF-', '')}</Text>
        <Text style={[styles.status, { color: theme[order.status === 'New' ? 'statusNew' : 'text'] }]}>
          {order.status.toUpperCase()} · {order.fulfilment.toUpperCase()} · {formatMoney(order.total)}
        </Text>
        <Text style={[styles.meta, { color: theme.textDim }]}>
          Placed {formatDateTime(order.createdAt)}
          {order.acknowledgedAt ? ` · Acknowledged ${formatDateTime(order.acknowledgedAt)}` : ' · NOT ACKNOWLEDGED'}
        </Text>
      </View>

      {(message ? <Text style={[styles.message, { color: theme.info }]}>{message}</Text> : null)}

      <SectionTitle title="Customer" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Field label="Name" value={order.customerName || '—'} />
        {order.customerPhone ? (
          <Field label="Phone" value={order.customerPhone} />
        ) : null}
        {order.fulfilment === 'Delivery' ? (
          <>
            <Field label="Address" value={`${order.address}${order.suburb ? `, ${order.suburb}` : ''} ${order.postcode}`} />
            {order.deliveryInstructions ? <Field label="Delivery instructions" value={order.deliveryInstructions} /> : null}
          </>
        ) : null}
        <Field label="Payment" value={order.paymentStatus.toUpperCase()} danger={order.paymentStatus !== 'paid'} />
        {order.couponCode ? <Field label="Coupon" value={order.couponCode} /> : null}
        {order.customerPhone ? (
          <BigButton
            title="CALL CUSTOMER"
            variant="secondary"
            small
            onPress={() => void Linking.openURL(`tel:${order.customerPhone.replace(/\s+/g, '')}`)}
            style={{ marginTop: 8, alignSelf: 'flex-start' }}
          />
        ) : null}
      </View>

      <SectionTitle title="Items" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {order.items.map((item) => (
          <View key={item.id} style={styles.itemBlock}>
            <Text style={[styles.itemLine, { color: theme.text }]}>
              {item.quantity} × {item.name} — {formatMoney(item.unitPrice)}
            </Text>
            {modifierNames(item).map((mod, i) => (
              <Text key={i} style={[styles.modLine, { color: theme.textDim }]}>+ {mod}</Text>
            ))}
            {item.notes ? <Text style={[styles.noteLine, { color: theme.warning }]}>NOTE: {item.notes}</Text> : null}
          </View>
        ))}
        {order.specialInstructions ? (
          <Text style={[styles.orderNote, { color: theme.warning }]}>ORDER NOTE: {order.specialInstructions}</Text>
        ) : null}
      </View>

      <SectionTitle title="Printing" />
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        {jobs.length === 0 ? (
          <Text style={[styles.meta, { color: theme.textDim }]}>No print jobs recorded today for this order.</Text>
        ) : (
          jobs.map((job) => {
            const printer = printers[job.printerId];
            const color =
              job.status === 'PRINTED' ? theme.success
              : job.status === 'FAILED' ? theme.danger
              : job.status === 'RETRYING' ? theme.warning
              : theme.info;
            return (
              <View key={job.id} style={styles.printRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.printLine, { color: theme.text }]}>
                    {printer?.name ?? job.printerId.slice(0, 8)} — {job.status}
                    {job.attempts > 1 ? ` (attempt ${job.attempts}/${job.maxAttempts})` : ''}
                  </Text>
                  <Text style={[styles.meta, { color: theme.textDim }]}>
                    {job.status === 'PRINTED' && job.printedAt ? `Printed ${formatDateTime(job.printedAt)}` : job.lastError || 'Queued for printing'}
                    {job.origin && job.origin !== 'auto' ? ` · ${job.origin}` : ''}
                  </Text>
                </View>
                {job.status === 'PRINTED' || job.status === 'FAILED' ? (
                  <BigButton
                    title={job.status === 'FAILED' ? 'RETRY' : 'REPRINT'}
                    small
                    variant="secondary"
                    onPress={() => void run(() => reprintOrder(order.id, job.printerId), 'Print job requeued — the printer agent will print it.')}
                  />
                ) : null}
              </View>
            );
          })
        )}
        <BigButton
          title="REPRINT ALL"
          variant="secondary"
          small
          busy={busy}
          onPress={() => void run(() => reprintOrder(order.id), 'Reprint requested.')}
          style={{ marginTop: 8, alignSelf: 'flex-start' }}
        />
      </View>

      <SectionTitle title="Actions" />
      <View style={styles.actions}>
        {!order.acknowledgedAt ? (
          <BigButton
            title="ACKNOWLEDGE"
            busy={busy}
            onPress={() => void run(() => acknowledgeOrder(order.id), 'Acknowledged.')}
            style={{ flex: 1 }}
          />
        ) : null}
        {target && canTransition(order.status, target) ? (
          <BigButton
            title={ADVANCE_LABEL[order.status] ?? `→ ${target.toUpperCase()}`}
            busy={busy}
            onPress={() => void run(() => updateOrderStatus(order, target), `Order is now ${target}.`)}
            style={{ flex: 1 }}
          />
        ) : null}
        {['New', 'Accepted', 'Preparing', 'Ready'].includes(order.status) && role !== 'kitchen' ? (
          <BigButton title="CANCEL" variant="danger" busy={busy} onPress={() => setCancelOpen(true)} style={{ flex: 1 }} />
        ) : null}
      </View>
      {['New', 'Accepted', 'Preparing', 'Ready'].includes(order.status) && role === 'kitchen' ? (
        <Text style={[styles.meta, { color: theme.textDim, marginTop: 8 }]}>
          Cancelling paid orders is admin/staff only — ask a manager.
        </Text>
      ) : null}

      <Modal visible={cancelOpen} transparent animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Cancel order #{order.orderNumber.replace('VF-', '')}?</Text>
            <Text style={[styles.meta, { color: theme.textDim, marginBottom: 12 }]}>
              The state machine records who cancelled and why. Refunds are handled separately by admin.
            </Text>
            <BigInput2 label="Reason" value={cancelReason} onChange={setCancelReason} placeholder="Customer changed their mind…" />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <BigButton title="BACK" variant="secondary" onPress={() => setCancelOpen(false)} style={{ flex: 1 }} />
              <BigButton
                title="CONFIRM CANCEL"
                variant="danger"
                busy={busy}
                onPress={() => {
                  setCancelOpen(false);
                  void run(() => cancelOrder(order.id, cancelReason || 'Cancelled from kitchen tablet'), 'Order cancelled.');
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function BigInput2(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: theme.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>
        {props.label}
      </Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={theme.textDim}
        multiline
        style={{
          borderWidth: 1.5,
          borderColor: theme.border,
          backgroundColor: theme.surfaceAlt,
          color: theme.text,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          fontSize: 17,
          minHeight: 80,
          textAlignVertical: 'top',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 8 },
  orderNumber: { fontSize: 40, fontWeight: '900' },
  status: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  meta: { fontSize: 14, fontWeight: '600' },
  message: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  card: { borderRadius: 14, padding: 14, marginBottom: 4 },
  itemBlock: { marginBottom: 8 },
  itemLine: { fontSize: 18, fontWeight: '700' },
  modLine: { fontSize: 15 },
  noteLine: { fontSize: 15, fontWeight: '700' },
  orderNote: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  printRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  printLine: { fontSize: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 24, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  modalCard: { borderRadius: 18, padding: 20, width: '100%', maxWidth: 560 },
  modalTitle: { fontSize: 22, fontWeight: '900', marginBottom: 6 },
});
