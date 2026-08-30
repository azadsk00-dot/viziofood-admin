// OrderCard — the compact board card: order number, customer name, order
// type. ONLY those three (spec) so the home screen stays dense and scannable
// at 10/20/50 orders. Full contents live on the separate detail screen.
//
// Performance: the card subscribes to ITS OWN order slice in the store —
// when one order changes (e.g. PREPARING → READY) only that card re-renders;
// unrelated cards and the scroll position are untouched.

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { Order } from '../types';
import { colors, radius, spacing, type as typeScale } from '../theme';
import { fulfilmentLabel } from '../orders/orderStatus';

function OrderCardInner({ order, onOpen }: { order: Order; onOpen: () => void }) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderNumber}, ${order.customerName}, ${order.fulfilment}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.number}>#{order.orderNumber}</Text>
      <Text style={styles.customer} numberOfLines={1}>
        {order.customerName}
      </Text>
      <Text style={styles.type}>{fulfilmentLabel(order.fulfilment)}</Text>
    </Pressable>
  );
}

export const OrderCard = React.memo(OrderCardInner);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  pressed: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceAlt },
  number: {
    color: colors.text,
    fontSize: typeScale.cardTitle,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  customer: {
    color: colors.textMuted,
    fontSize: typeScale.cardBody,
    fontWeight: '600',
    marginTop: 1,
  },
  type: {
    color: colors.textFaint,
    fontSize: typeScale.small,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 2,
  },
});
