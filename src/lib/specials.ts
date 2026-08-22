/**
 * Special-of-the-day scheduling engine. Pure functions, no I/O — shared by
 * the public site (which special to show now), the admin preview, and
 * tests. The server re-runs the same rules when pricing special items.
 *
 * A special is live when ALL of:
 *   active = true, archived = false
 *   date window: startDate ≤ now ≤ endDate (null bounds = unbounded)
 *   time window: startTime ≤ now.time ≤ endTime (null = all day)
 *   day-of-week: daysOfWeek empty (every day) or contains today
 *   stock: stockQuantity null or > 0
 * Among live specials the highest priority wins (lower number = higher
 * priority, like CSS z-index; ties broken by createdAt ascending).
 */

import type { Special } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "HH:MM" → minutes since midnight; null when unparseable. */
export const parseClock = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/** Local calendar date as YYYY-MM-DD. */
export const localDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** True on the end date regardless of time — endDate is inclusive. */
const withinDateWindow = (special: Special, now: Date): boolean => {
  const todayKey = localDateKey(now);
  if (special.startDate && todayKey < special.startDate) return false;
  // endDate is inclusive through the whole final day.
  if (special.endDate) {
    const endPlusOne = localDateKey(new Date(new Date(`${special.endDate}T00:00:00`).getTime() + DAY_MS));
    if (todayKey >= endPlusOne) return false;
  }
  return true;
};

const withinTimeWindow = (special: Special, now: Date): boolean => {
  const start = parseClock(special.startTime);
  const end = parseClock(special.endTime);
  if (start === null && end === null) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start !== null && minutes < start) return false;
  if (end !== null && minutes > end) return false;
  return true;
};

const withinDayOfWeek = (special: Special, now: Date): boolean =>
  special.daysOfWeek.length === 0 || special.daysOfWeek.includes(now.getDay());

export const isSpecialLive = (special: Special, now: Date = new Date()): boolean =>
  special.active &&
  !special.archived &&
  (special.stockQuantity === null || special.stockQuantity > 0) &&
  withinDateWindow(special, now) &&
  withinTimeWindow(special, now) &&
  withinDayOfWeek(special, now);

/**
 * The single special to display, or null. Highest priority first; ties are
 * broken by earliest createdAt so the display is deterministic across
 * clients (web, mobile, printer).
 */
export const resolveActiveSpecial = (
  specials: Special[],
  now: Date = new Date(),
): Special | null => {
  const live = specials
    .filter((s) => isSpecialLive(s, now))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  return live[0] ?? null;
};

/** All specials live now — used by the menu strip (displayLocation menu/both). */
export const resolveLiveSpecials = (
  specials: Special[],
  now: Date = new Date(),
): Special[] =>
  specials
    .filter((s) => isSpecialLive(s, now))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));

/** Human label for the scheduling rule, for admin list views. */
export const describeSchedule = (special: Special): string => {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days =
    special.daysOfWeek.length === 0
      ? 'Every day'
      : special.daysOfWeek.slice().sort().map((d) => dayNames[d]).join(', ');
  const time =
    special.startTime || special.endTime
      ? ` · ${special.startTime ?? '00:00'}–${special.endTime ?? '23:59'}`
      : '';
  const dates = special.startDate || special.endDate
    ? ` · ${special.startDate ?? '…'} → ${special.endDate ?? '…'}`
    : '';
  return `${days}${time}${dates}`;
};

/** Discount percent derived from price/originalPrice, for badges. */
export const discountPercent = (price: number, originalPrice: number | null): number | null => {
  if (originalPrice === null || originalPrice <= price || originalPrice <= 0) return null;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
};
