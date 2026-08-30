// Board routing — the home screen's two columns.
//
//   PREPARING  status New (transient — auto-accept moves it within a
//              second), Accepted or Preparing
//   READY      status Ready
//
// Rules:
//   * future-scheduled orders stay OFF the home board until inside the
//     preparation window (they live on the SCHEDULED tab) — a future order
//     must never be treated as an immediate kitchen order
//   * both columns sort NEWEST FIRST (spec) — the top card is the latest
//   * Completed / Cancelled / Rejected leave the board (HISTORY has them)

import type { Order } from '../types';
import { isFutureScheduled, scheduledCategory, type ScheduledCategory } from './scheduled';

export interface BoardColumns {
  PREPARING: Order[];
  READY: Order[];
}

export function boardColumns(orders: Order[], now: number = Date.now()): BoardColumns {
  const columns: BoardColumns = { PREPARING: [], READY: [] };
  for (const order of orders) {
    // Any order still scheduled beyond the preparation window stays OFF the
    // live board — it is not an immediate kitchen order yet.
    if (isFutureScheduled(order, now)) continue;

    switch (order.status) {
      case 'New': // transient — auto-accept flips it to Preparing
      case 'Accepted':
      case 'Preparing':
        columns.PREPARING.push(order);
        break;
      case 'Ready':
        columns.READY.push(order);
        break;
      default:
        break; // Draft (never here), Completed, Cancelled, Rejected → History
    }
  }
  const newestFirst = (a: Order, b: Order) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  columns.PREPARING.sort(newestFirst);
  columns.READY.sort(newestFirst);
  return columns;
}

export interface ScheduledGroups {
  upcoming: Order[];
  readyToProcess: Order[];
}

/** The SCHEDULED tab: future orders, chronological, in the two groups. */
export function scheduledGroups(orders: Order[], now: number = Date.now()): ScheduledGroups {
  const groups: ScheduledGroups = { upcoming: [], readyToProcess: [] };
  for (const order of orders) {
    if (order.scheduledAt === null) continue;
    if (order.status === 'Completed' || order.status === 'Cancelled' || order.status === 'Rejected') {
      continue; // done or dead — no longer a scheduled commitment
    }
    const category: ScheduledCategory | null = scheduledCategory(order.scheduledAt, now);
    if (category === 'readyToProcess') groups.readyToProcess.push(order);
    else groups.upcoming.push(order);
  }
  const byScheduled = (a: Order, b: Order) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0);
  groups.upcoming.sort(byScheduled);
  groups.readyToProcess.sort(byScheduled);
  return groups;
}
