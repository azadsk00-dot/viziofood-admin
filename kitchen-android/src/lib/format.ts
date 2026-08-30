// Formatting helpers (pure — mirrors web src/lib/money.ts conventions).

export function formatMoney(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return '$0.00';
  return `$${value.toFixed(2)}`;
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(s / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${minutes}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMinutesAgo(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  return `${minutes} min ago`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month} ${formatClock(iso)}`;
}

export function shortOrderNumber(orderNumber: string): string {
  // VF-12345678 → 12345678 (keep full form when the prefix differs)
  return orderNumber.startsWith('VF-') ? orderNumber.slice(3) : orderNumber;
}

/** RFC-4122 v4 without a dependency — used for the stable device id. */
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function startOfToday(now: number = Date.now()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
