// Root navigation — four tabs (ORDERS, SCHEDULED, HISTORY, SETTINGS) plus a
// full-screen order detail. Text-only tab labels (no icons): a serious POS
// terminal, not a consumer app. Back from detail returns to the board in one
// press; back on the board exits the app (default Android behaviour — no
// custom double-back handler).

import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme';
import { navigationRef, type RootStackParamList } from './navigation';
import { LiveOrdersScreen } from '../screens/LiveOrdersScreen';
import { ScheduledScreen } from '../screens/ScheduledScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator();

function TabNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 58,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
        tabBarIconStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="Live" component={LiveOrdersScreen} options={{ tabBarLabel: 'ORDERS' }} />
      <Tabs.Screen
        name="Scheduled"
        component={ScheduledScreen}
        options={{ tabBarLabel: 'SCHEDULED' }}
      />
      <Tabs.Screen name="History" component={HistoryScreen} options={{ tabBarLabel: 'HISTORY' }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'SETTINGS' }} />
    </Tabs.Navigator>
  );
}

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
    primary: colors.accent,
  },
};

export function RootNavigator() {
  return (
    <NavigationContainer ref={navigationRef} theme={theme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="Tabs" component={TabNavigator} />
        <Stack.Screen
          name="OrderDetail"
          component={OrderDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
