// Navigation ref — lets non-React modules (notification taps) navigate.

import { createNavigationContainerRef } from '@react-navigation/native';

export type RootStackParamList = {
  Tabs: undefined;
  OrderDetail: { orderId: string };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateToOrder(orderId: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('OrderDetail', { orderId });
  }
}
