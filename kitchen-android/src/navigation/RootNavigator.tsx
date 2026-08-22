// Root navigator — Login gate, main tabs, order-detail modal.

import React from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuthStore } from '../state/authStore';
import { dark } from '../theme';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import PrintQueueScreen from '../screens/PrintQueueScreen';
import HealthScreen from '../screens/HealthScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ShiftScreen from '../screens/ShiftScreen';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  OrderDetail: { orderId: string };
};

export type MainTabParamList = {
  Dashboard: undefined;
  PrintQueue: undefined;
  Health: undefined;
  Shift: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateToOrder(orderId: string): void {
  navigationRef.current?.navigate('OrderDetail', { orderId });
}

export function navigateToTab(tab: keyof MainTabParamList): void {
  navigationRef.current?.navigate('Main', { screen: tab } as never);
}

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }): React.ReactElement {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>
  );
}

function MainTabs(): React.ReactElement {
  const label = (name: string) => ({ children }: { children: string }) => (
    <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>{children}</Text>
  );
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark.accent,
        tabBarInactiveTintColor: dark.textDim,
        tabBarStyle: { backgroundColor: dark.surface, borderTopColor: dark.border, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelPosition: 'below-icon',
        tabBarLabel: label('tab') as never,
      }}
    >
      <Tabs.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'ORDERS', tabBarIcon: ({ focused }) => <TabIcon glyph="🧾" focused={focused} /> }}
      />
      <Tabs.Screen
        name="PrintQueue"
        component={PrintQueueScreen}
        options={{ title: 'PRINT', tabBarIcon: ({ focused }) => <TabIcon glyph="🖨️" focused={focused} /> }}
      />
      <Tabs.Screen
        name="Health"
        component={HealthScreen}
        options={{ title: 'HEALTH', tabBarIcon: ({ focused }) => <TabIcon glyph="📶" focused={focused} /> }}
      />
      <Tabs.Screen
        name="Shift"
        component={ShiftScreen}
        options={{ title: 'SHIFT', tabBarIcon: ({ focused }) => <TabIcon glyph="📋" focused={focused} /> }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'SETTINGS', tabBarIcon: ({ focused }) => <TabIcon glyph="⚙️" focused={focused} /> }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator(): React.ReactElement {
  const authStatus = useAuthStore((s) => s.status);

  if (authStatus === 'loading') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={() => <Text style={{ color: dark.text, padding: 40 }}>VIZIO KITCHEN — starting…</Text>} />
      </Stack.Navigator>
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
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: dark.background },
      }}
    >
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
