// App root — auth bootstrap, service lifecycle, alert overlay.

import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { supabase } from './lib/supabase';
import { useAuthStore } from './state/authStore';
import { useSettingsStore } from './state/settingsStore';
import { useOrdersStore } from './state/ordersStore';
import { syncService } from './services/syncService';
import { printEngine } from './services/printEngine';
import { startHeartbeat, stopHeartbeat, disableDevice } from './services/heartbeat';
import { ensureChannels, onNotificationResponse, registerForPush, registerListeners, unregisterPush } from './services/notifications';
import { recordIncident } from './services/incidents';
import RootNavigator, { navigationRef, navigateToOrder } from './navigation/RootNavigator';
import ErrorBoundary from './components/ErrorBoundary';

const KEEP_AWAKE_TAG = 'vizio-kitchen';

export default function App(): React.ReactElement {
  const authStatus = useAuthStore((s) => s.status);
  const theme = useSettingsStore((s) => s.settings.theme);
  const keepAwake = useSettingsStore((s) => s.settings.keepScreenAwake);
  const startedRef = useRef(false);

  // Auth bootstrap + session lifecycle.
  useEffect(() => {
    void (async () => {
      registerListeners();
      await ensureChannels();
      const { data } = await supabase.auth.getSession();
      useAuthStore.getState().setSession(data.session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      useAuthStore.getState().setSession(session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Service lifecycle follows the signed-in state.
  useEffect(() => {
    if (authStatus === 'signedIn' && !startedRef.current) {
      startedRef.current = true;
      void syncService.start();
      void printEngine.start();
      startHeartbeat();
      void registerForPush();
      void recordIncident({ kind: 'app_recovery', message: 'Kitchen tablet app started' });
    } else if (authStatus !== 'signedIn' && startedRef.current) {
      startedRef.current = false;
      printEngine.stop();
      syncService.stop();
      stopHeartbeat();
      void disableDevice();
    }
  }, [authStatus]);

  // Keep the kitchen screen awake while the app is the active display.
  useEffect(() => {
    if (keepAwake) {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } else {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [keepAwake]);

  // Push notification tap → open that order (non-blocking; the app is fully
  // usable whether or not the notification is touched).
  useEffect(() => {
    onNotificationResponse((orderId) => {
      const order = useOrdersStore.getState().orders[orderId];
      if (order) navigateToOrder(orderId);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style={theme === 'light' ? 'dark' : 'light'} />
        <ErrorBoundary>
          <RootNavigator />
        </ErrorBoundary>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
