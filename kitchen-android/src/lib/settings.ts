// Kitchen tablet settings — persisted locally per device (AsyncStorage via
// zustand persist). All alert thresholds are configurable; defaults are
// sensible for a busy kitchen but nothing is hard-coded at use sites.

import type { OrderFilter } from './orderLogic';

export interface KitchenSettings {
  // Alerts
  soundEnabled: boolean;
  /** 0.0 – 1.0 */
  volume: number;
  /** 0 = repeat until acknowledged; otherwise number of plays per order. */
  repeatCount: number;
  repeatIntervalSec: number;
  vibrationEnabled: boolean;
  /** Escalation thresholds (minutes) — configurable, never hard-coded. */
  warnMinutes: number;
  urgentMinutes: number;
  managerMinutes: number;
  /** Accepted/Preparing orders older than this are OVERDUE. */
  overdueMinutes: number;
  /** Auto-acknowledge the order alert when staff taps ACCEPT. */
  autoAckOnAdvance: boolean;

  // Display
  keepScreenAwake: boolean;
  theme: 'dark' | 'light';
  sortOldestFirst: boolean;
  defaultFilter: OrderFilter;

  // Sync
  /** Periodic reconciliation with the backend (seconds). */
  reconcileIntervalSec: number;

  // Printer agent (LAN)
  agentUrl: string;
  agentToken: string;
}

export const DEFAULT_SETTINGS: KitchenSettings = {
  soundEnabled: true,
  volume: 1,
  repeatCount: 0,
  repeatIntervalSec: 10,
  vibrationEnabled: true,
  warnMinutes: 3,
  urgentMinutes: 5,
  managerMinutes: 10,
  overdueMinutes: 15,
  autoAckOnAdvance: true,
  keepScreenAwake: true,
  theme: 'dark',
  sortOldestFirst: true,
  defaultFilter: 'live',
  reconcileIntervalSec: 60,
  agentUrl: '',
  agentToken: '',
};

export const RECONCILE_CHOICES = [30, 60, 120] as const;

/** Clamp/repair loaded settings so a corrupted store can never break the app. */
export function normalizeSettings(input: Partial<KitchenSettings> | null | undefined): KitchenSettings {
  const raw = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const clamp = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

  return {
    ...raw,
    volume: clamp(Number(raw.volume), 0, 1, DEFAULT_SETTINGS.volume),
    repeatCount: clamp(Math.floor(Number(raw.repeatCount)), 0, 20, DEFAULT_SETTINGS.repeatCount),
    repeatIntervalSec: clamp(Math.floor(Number(raw.repeatIntervalSec)), 3, 300, DEFAULT_SETTINGS.repeatIntervalSec),
    warnMinutes: clamp(Math.floor(Number(raw.warnMinutes)), 1, 120, DEFAULT_SETTINGS.warnMinutes),
    urgentMinutes: clamp(Math.floor(Number(raw.urgentMinutes)), 2, 240, DEFAULT_SETTINGS.urgentMinutes),
    managerMinutes: clamp(Math.floor(Number(raw.managerMinutes)), 3, 480, DEFAULT_SETTINGS.managerMinutes),
    overdueMinutes: clamp(Math.floor(Number(raw.overdueMinutes)), 3, 480, DEFAULT_SETTINGS.overdueMinutes),
    reconcileIntervalSec: clamp(
      Math.floor(Number(raw.reconcileIntervalSec)),
      RECONCILE_CHOICES[0],
      600,
      DEFAULT_SETTINGS.reconcileIntervalSec,
    ),
    theme: raw.theme === 'light' ? 'light' : 'dark',
    keepScreenAwake: Boolean(raw.keepScreenAwake),
    soundEnabled: Boolean(raw.soundEnabled),
    vibrationEnabled: Boolean(raw.vibrationEnabled),
    autoAckOnAdvance: Boolean(raw.autoAckOnAdvance),
    sortOldestFirst: Boolean(raw.sortOldestFirst),
    defaultFilter: raw.defaultFilter || DEFAULT_SETTINGS.defaultFilter,
  };
}

/** Escalation thresholds must be strictly increasing — repair if not. */
export function normalizeThresholds(settings: KitchenSettings): KitchenSettings {
  let { warnMinutes, urgentMinutes, managerMinutes, overdueMinutes } = settings;
  if (urgentMinutes <= warnMinutes) urgentMinutes = warnMinutes + 1;
  if (managerMinutes <= urgentMinutes) managerMinutes = urgentMinutes + 1;
  if (overdueMinutes < urgentMinutes) overdueMinutes = urgentMinutes;
  return { ...settings, warnMinutes, urgentMinutes, managerMinutes, overdueMinutes };
}
