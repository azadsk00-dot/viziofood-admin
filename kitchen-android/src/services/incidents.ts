// Incident log — append-only operational audit (kitchen_incidents table,
// migration 20260827000000). Best-effort: logging never blocks operations.

import { supabase } from '../lib/supabase';
import type { IncidentKind, IncidentSeverity } from '../lib/types';
import { getDeviceId } from '../lib/device';

const recentMessages = new Map<string, number>();
const DEDUPE_MS = 5 * 60_000;

export async function recordIncident(input: {
  kind: IncidentKind;
  severity?: IncidentSeverity;
  orderId?: string | null;
  message: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    // Same kind+message inside 5 minutes → one entry, not a flood.
    const key = `${input.kind}:${input.message}`;
    const last = recentMessages.get(key) ?? 0;
    if (Date.now() - last < DEDUPE_MS) return;
    recentMessages.set(key, Date.now());

    const deviceId = await getDeviceId();
    await supabase.from('kitchen_incidents').insert({
      kind: input.kind,
      severity: input.severity ?? 'info',
      order_id: input.orderId ?? null,
      device_id: deviceId,
      message: input.message.slice(0, 300),
      details: input.details ?? {},
    });
  } catch {
    // Never let audit logging break the operational path.
  }
}

export interface RecentIncident {
  id: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  orderId: string | null;
  message: string;
  createdAt: string;
}

export async function fetchRecentIncidents(limit = 50): Promise<RecentIncident[]> {
  const { data, error } = await supabase
    .from('kitchen_incidents')
    .select('id,kind,severity,order_id,message,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const rows = data as Array<{
    id: string;
    kind: IncidentKind;
    severity: IncidentSeverity;
    order_id: string | null;
    message: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    orderId: row.order_id,
    message: row.message,
    createdAt: row.created_at,
  }));
}
