// Kitchen tablet settings — persisted locally per device (AsyncStorage via
// zustand persist). All alert thresholds are configurable; defaults are
// sensible for a busy kitchen but nothing is hard-coded at use sites.

import type { OrderFilter } from './orderLogic';

export interface KitchenSettings {
  // Alerts
  soundEnabled: boolean;
  /** 0.0 – 1.0 */
  volume: number;
  vibrationEnabled: boolean;
  /** Escalation thresholds (minutes) — configurable, never hard-coded. */
  warnMinutes: number;
  urgentMinutes: number;
  managerMinutes: number;
  /** Accepted/Preparing orders older than this are OVERDUE. */
  overdueMinutes: number;
  /** Auto-acknowledge the order alert when staff taps ACCEPT. */
  autoAckOnAdvance: boolean;
  /**
   * Automatically advance genuinely-new orders NEW → ACCEPTED → PREPARING
   * wherever they are discovered (realtime, reconciliation after a
   * disconnect/lock, app restart). Persisted dedupe: one transition set per
   * order, ever, per device; orders older than the eligibility window are
   * never touched.
   */
  autoPrepareNewOrders: boolean;

  // Display
  keepScreenAwake: boolean;
  theme: 'dark' | 'light';
  sortOldestFirst: boolean;
  defaultFilter: OrderFilter;

  // Sync
  /** Periodic reconciliation with the backend (seconds). */
  reconcileIntervalSec: number;
}

export const DEFAULT_SETTINGS: KitchenSettings = {
  soundEnabled: true,
  volume: 1,
  vibrationEnabled: true,
  warnMinutes: 3,
  urgentMinutes: 5,
  managerMinutes: 10,
  overdueMinutes: 15,
  autoAckOnAdvance: true,
  autoPrepareNewOrders: true,
  keepScreenAwake: true,
  theme: 'dark',
  sortOldestFirst: true,
  defaultFilter: 'live',
  reconcileIntervalSec: 60,
};

export const RECONCILE_CHOICES = [30, 60, 120] as const;

/** Clamp/repair loaded settings so a corrupted store can never break the app. */
export function normalizeSettings(input: Partial<KitchenSettings> | null | undefined): KitchenSettings {
  const raw = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const clamp = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

  // Rebuild field-by-field: keys removed from the schema (e.g. the old
  // agentUrl/agentToken) must not leak back in from persisted storage.
  return {
    soundEnabled: Boolean(raw.soundEnabled),
    volume: clamp(Number(raw.volume), 0, 1, DEFAULT_SETTINGS.volume),
    vibrationEnabled: Boolean(raw.vibrationEnabled),
    warnMinutes: clamp(Math.floor(Number(raw.warnMinutes)), 1, 120, DEFAULT_SETTINGS.warnMinutes),
    urgentMinutes: clamp(Math.floor(Number(raw.urgentMinutes)), 2, 240, DEFAULT_SETTINGS.urgentMinutes),
    managerMinutes: clamp(Math.floor(Number(raw.managerMinutes)), 3, 480, DEFAULT_SETTINGS.managerMinutes),
    overdueMinutes: clamp(Math.floor(Number(raw.overdueMinutes)), 3, 480, DEFAULT_SETTINGS.overdueMinutes),
    autoAckOnAdvance: Boolean(raw.autoAckOnAdvance),
    autoPrepareNewOrders: Boolean(raw.autoPrepareNewOrders),
    keepScreenAwake: Boolean(raw.keepScreenAwake),
    theme: raw.theme === 'light' ? 'light' : 'dark',
    sortOldestFirst: Boolean(raw.sortOldestFirst),
    defaultFilter: raw.defaultFilter || DEFAULT_SETTINGS.defaultFilter,
    reconcileIntervalSec: clamp(
      Math.floor(Number(raw.reconcileIntervalSec)),
      RECONCILE_CHOICES[0],
      600,
      DEFAULT_SETTINGS.reconcileIntervalSec,
    ),
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
