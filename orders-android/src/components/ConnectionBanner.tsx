// Connection + notification banners. The permission banner exists because a
// single dismissal on Android 13+ blocks re-prompting forever — the only way
// back is the system settings, and the kitchen must SEE that alerts are off.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, spacing, type as typeScale } from '../theme';
import { useOrdersStore } from '../state/ordersStore';
import { realtimeOrderService } from '../services/realtimeOrderService';
import {
  getPermissionState,
  openNotificationSettings,
} from '../services/notificationService';

export function ConnectionIndicator() {
  const realtimeConnected = useOrdersStore((state) => state.realtimeConnected);
  const online = useOrdersStore((state) => state.internetOnline);
  const live = realtimeConnected && online;
  return (
    <View style={styles.indicator}>
      <View style={[styles.dot, { backgroundColor: live ? colors.live : colors.offline }]} />
      <Text style={[styles.indicatorLabel, { color: live ? colors.live : colors.offline }]}>
        {live ? 'Live' : 'Reconnecting…'}
      </Text>
    </View>
  );
}

/** Yellow banner when notifications are blocked — tap opens system settings. */
export function NotificationPermissionBanner() {
  const [status, setStatus] = useState<'granted' | 'undetermined' | 'denied' | null>(null);

  useEffect(() => {
    void getPermissionState().then(setStatus);
  }, []);

  if (status === null || status === 'granted') return null;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Notifications are off, tap to open settings"
      style={styles.permBanner}
      onPress={openNotificationSettings}
      activeOpacity={0.8}
    >
      <Text style={styles.permText}>
        {status === 'denied'
          ? 'Order alerts are OFF — notifications blocked. Tap to allow in Android Settings.'
          : 'Order alerts need notification permission. Tap to allow.'}
      </Text>
    </TouchableOpacity>
  );
}

export function OfflineBanner() {
  const status = useOrdersStore((state) => state.syncStatus);
  const error = useOrdersStore((state) => state.lastSyncError);

  if (status !== 'offline' && status !== 'error') return null;

  const offline = status === 'offline';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Connection lost, tap to retry now"
      style={[styles.banner, { backgroundColor: offline ? colors.dangerSoft : colors.warningSoft }]}
      onPress={() => void realtimeOrderService.syncNow()}
      activeOpacity={0.8}
    >
      <Text style={[styles.bannerText, { color: offline ? colors.danger : colors.warning }]}>
        {offline
          ? 'Connection lost — reconnecting…'
          : (error ?? 'Realtime connection lost. Reconnecting…')}
      </Text>
      {!offline ? <Text style={styles.bannerAction}>TAP TO SYNC NOW</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  indicatorLabel: { fontSize: typeScale.small, fontWeight: '800', letterSpacing: 0.5 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  bannerText: { fontSize: typeScale.small, fontWeight: '700', flexShrink: 1 },
  bannerAction: { fontSize: typeScale.tiny, fontWeight: '900', letterSpacing: 0.5 },
  permBanner: {
    backgroundColor: colors.warningSoft,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  permText: { color: colors.warning, fontSize: typeScale.small, fontWeight: '700' },
});
