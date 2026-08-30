// App root — auth gate + service lifecycle + terminal behaviour.
//
// Signed in: requests notification permission IMMEDIATELY (v1 asked only
// once after login — a single dismissal on Android 13+ silently killed
// every notification), starts the realtime order service, the printer queue
// and push registration, and keeps the screen awake while the terminal is
// in the foreground (kitchen terminal requirement).

import React, { useEffect } from 'react';
import { AppState, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../state/authStore';
import { realtimeOrderService } from '../services/realtimeOrderService';
import { printerQueue } from '../services/printerQueue';
import * as notificationService from '../services/notificationService';
import {
  registerPushToken,
  reRegisterIfMissing,
  unregisterPushToken,
  currentPushToken,
} from '../services/pushService';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoginScreen } from '../screens/LoginScreen';
import { RootNavigator } from './RootNavigator';
import { navigateToOrder } from './navigation';
import { colors, spacing, type as typeScale } from '../theme';

export default function App() {
  const authStatus = useAuthStore((state) => state.status);
  const setSession = useAuthStore((state) => state.setSession);

  // Session bootstrap: restore any persisted session, then follow auth
  // changes (token refresh, sign-out on any device).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.subscription.unsubscribe();
  }, [setSession]);

  // Service lifecycle follows the auth state.
  useEffect(() => {
    if (authStatus !== 'signedIn') return;

    // Channels FIRST (they must exist before any notification posts), then
    // the permission prompt, then push registration.
    void notificationService.ensureChannels().then(() => {
      void notificationService.requestPermission();
    });
    notificationService.registerListeners();
    notificationService.onNotificationResponse(navigateToOrder);
    void realtimeOrderService.start();
    printerQueue.start();
    void registerPushToken();

    return () => {
      realtimeOrderService.stop();
      const token = currentPushToken();
      if (token) void unregisterPushToken(token);
    };
  }, [authStatus]);

  // Kitchen terminal: keep the screen awake while the app is active; normal
  // Android power behaviour resumes whenever it is backgrounded.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void activateKeepAwakeAsync('vizio-orders-terminal');
        void reRegisterIfMissing(); // push may have become available
      } else {
        deactivateKeepAwake('vizio-orders-terminal');
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ErrorBoundary>
        {authStatus === 'loading' ? (
          <View style={styles.boot}>
            <Text style={styles.bootTitle}>VIZIO FOOD</Text>
            <Text style={styles.bootSubtitle}>ORDERS</Text>
          </View>
        ) : authStatus === 'signedIn' ? (
          <RootNavigator />
        ) : (
          <LoginScreen />
        )}
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  bootTitle: { color: colors.text, fontSize: typeScale.title, fontWeight: '900', letterSpacing: 2 },
  bootSubtitle: { color: colors.accent, fontSize: typeScale.heading, fontWeight: '800', letterSpacing: 6 },
});
