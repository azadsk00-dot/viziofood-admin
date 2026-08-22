// Section registry — the single source of truth for app navigation.
// Roles are enforced server-side (RLS); this only gates the UI.

import React from 'react';
import { SectionId } from '../lib/permissions';
import type { UserRole } from '../lib/types';
import { canAccess } from '../lib/permissions';

import KitchenScreen from '../screens/KitchenScreen';
import ShiftScreen from '../screens/ShiftScreen';
import PrintQueueScreen from '../screens/PrintQueueScreen';
import HealthScreen from '../screens/HealthScreen';
import AppSettingsScreen from '../screens/SettingsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import OrdersScreen from '../screens/admin/OrdersScreen';
import ProductsScreen from '../screens/admin/ProductsScreen';
import CategoriesScreen from '../screens/admin/CategoriesScreen';
import ModifiersScreen from '../screens/admin/ModifiersScreen';
import SpecialsScreen from '../screens/admin/SpecialsScreen';
import CouponsScreen from '../screens/admin/CouponsScreen';
import FeaturedScreen from '../screens/admin/FeaturedScreen';
import HomepageScreen from '../screens/admin/HomepageScreen';
import BrandingScreen from '../screens/admin/BrandingScreen';
import CustomersScreen from '../screens/admin/CustomersScreen';
import ReportsScreen from '../screens/admin/ReportsScreen';
import PrintersScreen from '../screens/admin/PrintersScreen';
import RestaurantSettingsScreen from '../screens/admin/RestaurantSettingsScreen';
import UsersScreen from '../screens/admin/UsersScreen';
import SearchScreen from '../screens/admin/SearchScreen';

export interface SectionDef {
  id: SectionId;
  title: string;
  glyph: string;
  group: string;
  component: React.ComponentType;
}

export const SECTIONS: SectionDef[] = [
  { id: 'dashboard', title: 'Dashboard', glyph: '📊', group: 'Operate', component: AdminDashboardScreen },
  { id: 'orders', title: 'Orders', glyph: '🧾', group: 'Operate', component: OrdersScreen },
  { id: 'kitchen', title: 'Kitchen', glyph: '🔥', group: 'Kitchen', component: KitchenScreen },
  { id: 'printQueue', title: 'Print queue', glyph: '🖨️', group: 'Kitchen', component: PrintQueueScreen },
  { id: 'shift', title: 'Shift', glyph: '📋', group: 'Kitchen', component: ShiftScreen },
  { id: 'products', title: 'Products', glyph: '🍔', group: 'Menu', component: ProductsScreen },
  { id: 'categories', title: 'Categories', glyph: '🗂️', group: 'Menu', component: CategoriesScreen },
  { id: 'modifiers', title: 'Modifiers', glyph: '🧩', group: 'Menu', component: ModifiersScreen },
  { id: 'specials', title: 'Specials', glyph: '⭐', group: 'Grow', component: SpecialsScreen },
  { id: 'coupons', title: 'Coupons', glyph: '🎟️', group: 'Grow', component: CouponsScreen },
  { id: 'featured', title: 'Featured', glyph: '🍽️', group: 'Grow', component: FeaturedScreen },
  { id: 'homepage', title: 'Homepage', glyph: '🏠', group: 'Grow', component: HomepageScreen },
  { id: 'branding', title: 'Branding', glyph: '🎨', group: 'Grow', component: BrandingScreen },
  { id: 'customers', title: 'Customers', glyph: '👥', group: 'Grow', component: CustomersScreen },
  { id: 'reports', title: 'Reports', glyph: '📈', group: 'Grow', component: ReportsScreen },
  { id: 'printers', title: 'Printers', glyph: '⚙️', group: 'System', component: PrintersScreen },
  { id: 'users', title: 'Users', glyph: '🔐', group: 'System', component: UsersScreen },
  { id: 'notifications', title: 'Notifications', glyph: '🔔', group: 'System', component: NotificationsScreen },
  { id: 'settings', title: 'App settings', glyph: '🔧', group: 'System', component: AppSettingsScreen },
  { id: 'health', title: 'Device health', glyph: '📶', group: 'System', component: HealthScreen },
  { id: 'search', title: 'Search', glyph: '🔎', group: 'Operate', component: SearchScreen },
];

export const SECTION_GROUPS = ['Operate', 'Kitchen', 'Menu', 'Grow', 'System'];

export function visibleSections(role: UserRole | null): SectionDef[] {
  return SECTIONS.filter((section) => canAccess(section.id, role));
}

export function defaultSectionFor(role: UserRole | null): SectionId {
  return role === 'kitchen' ? 'kitchen' : 'dashboard';
}
