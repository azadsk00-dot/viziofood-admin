// Root navigator — auth gate, main shell, order-detail modal.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createNavigationContainerRef } from '@react-navigation/native';
import { Text, View } from 'react-native';
import { useAuthStore } from '../state/authStore';
import { dark } from '../theme';
import LoginScreen from '../screens/LoginScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import { AppShell } from '../components/AppShell';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  OrderDetail: { orderId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateToOrder(orderId: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('OrderDetail', { orderId });
  }
}

export default function RootNavigator(): React.ReactElement {
  const authStatus = useAuthStore((s) => s.status);

  if (authStatus === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: dark.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: dark.accent, fontSize: 22, fontWeight: '900', letterSpacing: 2 }}>VIZIO FOOD</Text>
        <Text style={{ color: dark.textDim, marginTop: 8 }}>Starting…</Text>
      </View>
    );
  }

  if (authStatus !== 'signedIn') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: dark.background } }}>
      <Stack.Screen name="Main" component={AppShell} />
      <Stack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
