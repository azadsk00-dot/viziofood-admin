// Special liveness — mirrors web src/lib/specials.ts resolution rules:
// active && !archived && stock && date window → time window → day of week.
// Specials are an INDEPENDENT entity: changing the linked product never
// overwrites special fields; product_id only affects ordering modifiers.

import type { AdminSpecial } from './adminTypes';

function parseLocalDate(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

function endOfLocalDate(ymd: string): number {
  return parseLocalDate(ymd) + 86_400_000; // exclusive end = next midnight
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isSpecialLive(special: AdminSpecial, now = Date.now()): boolean {
  if (!special.active || special.archived) return false;
  if (special.stockQuantity !== null && special.stockQuantity <= 0) return false;

  const t = new Date(now);
  const todayYmd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

  if (special.startDate && now < parseLocalDate(special.startDate)) return false;
  if (special.endDate && now >= endOfLocalDate(special.endDate)) return false;
  void todayYmd;

  if (special.startTime && special.endTime) {
    const minutes = t.getHours() * 60 + t.getMinutes();
    if (minutes < minutesOf(special.startTime) || minutes >= minutesOf(special.endTime)) return false;
  }

  if (special.daysOfWeek.length) {
    // JS getDay(): 0=Sunday — matches the stored convention.
    if (!special.daysOfWeek.includes(t.getDay())) return false;
  }

  return true;
}

export type SpecialState = 'live' | 'scheduled' | 'off' | 'archived';

export function specialState(special: AdminSpecial, now = Date.now()): SpecialState {
  if (special.archived) return 'archived';
  if (!special.active) return 'off';
  return isSpecialLive(special, now) ? 'live' : 'scheduled';
}

export function discountPercent(special: AdminSpecial): number | null {
  const { price, originalPrice } = special;
  if (originalPrice === null || !(originalPrice > price) || !(price > 0)) return null;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

export function describeSchedule(special: AdminSpecial): string {
  const parts: string[] = [];
  if (special.startDate || special.endDate) {
    parts.push(`${special.startDate ?? '…'} → ${special.endDate ?? '…'}`);
  }
  if (special.startTime && special.endTime) parts.push(`${special.startTime}–${special.endTime}`);
  if (special.daysOfWeek.length) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    parts.push(special.daysOfWeek.slice().sort().map((d) => names[d]).join(' '));
  }
  if (!parts.length) return 'Always available';
  return parts.join(' · ');
}
