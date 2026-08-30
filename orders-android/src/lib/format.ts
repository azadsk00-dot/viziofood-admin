// Pure formatting helpers — no React Native imports so they are unit-testable.

/** AUD money display, A$-prefixed (the Orders app shows totals as A$28.50). */
export function formatMoney(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return 'A$0.00';
  const sign = value < 0 ? '-' : '';
  return `${sign}A$${Math.abs(value).toFixed(2)}`;
}

export function formatClock(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatDate(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return `${formatDate(t)} ${formatClock(t)}`;
}

/** "2 min ago" style relative time for order cards. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const seconds = Math.max(0, Math.floor((now - t) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** "in 25 min" style countdown for scheduled orders. */
export function timeUntil(target: number | null | undefined, now: number = Date.now()): string {
  if (target === null || target === undefined) return '—';
  const ms = target - now;
  const past = ms < 0;
  const minutes = Math.floor(Math.abs(ms) / 60000);
  let text: string;
  if (minutes < 1) text = 'now';
  else if (minutes < 60) text = `${minutes} min`;
  else {
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    text = rem ? `${hours}h ${rem}m` : `${hours}h`;
  }
  if (text === 'now') return 'now';
  return past ? `${text} overdue` : `in ${text}`;
}

/** VF-12345678 → 12345678 (keeps the full form when the prefix differs). */
export function shortOrderNumber(orderNumber: string): string {
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

/** Local-midnight ISO string for "today's orders" queries. */
export function startOfToday(now: number = Date.now()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
