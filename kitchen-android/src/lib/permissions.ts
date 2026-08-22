// Role → section permissions. The UI hides what a role cannot use, but the
// enforcement is ALWAYS server-side (RLS + the order state-machine trigger +
// edge functions). This map only drives navigation.

import type { UserRole } from './types';

export type SectionId =
  | 'kitchen'
  | 'orders'
  | 'dashboard'
  | 'products'
  | 'categories'
  | 'modifiers'
  | 'specials'
  | 'coupons'
  | 'featured'
  | 'homepage'
  | 'branding'
  | 'customers'
  | 'reports'
  | 'printers'
  | 'printQueue'
  | 'notifications'
  | 'settings'
  | 'users'
  | 'health'
  | 'shift'
  | 'search';

const ALL: UserRole[] = ['admin', 'staff', 'kitchen'];
const STAFF: UserRole[] = ['admin', 'staff'];

export const SECTION_ROLES: Record<SectionId, UserRole[]> = {
  kitchen: ALL,
  orders: ALL,
  dashboard: STAFF,
  products: STAFF,
  categories: STAFF,
  modifiers: STAFF,
  specials: STAFF,
  coupons: STAFF,
  featured: STAFF,
  homepage: STAFF,
  branding: STAFF,
  customers: STAFF,
  reports: STAFF,
  printers: STAFF,
  printQueue: ALL,
  notifications: ALL,
  settings: ALL,
  users: ['admin'],
  health: ALL,
  shift: ALL,
  search: STAFF,
};

export function canAccess(section: SectionId, role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return SECTION_ROLES[section].includes(role);
}

/** Admin-only guarded mutations surfaced in UI (server still enforces). */
export function canRefund(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'staff';
}

export function canCancelPaidOrders(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'staff';
}

export function canManageUsers(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}
