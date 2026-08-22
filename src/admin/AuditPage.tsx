/**
 * Audit log — the immutable trail of staff actions: order status changes,
 * cancellations, refunds, settings changes, prints. Read-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { getAuditLog } from './supabase';
import { Badge, Card, EmptyState, Input, Select, Skeleton } from '../ui';

const ACTION_TONES: Record<string, 'success' | 'danger' | 'info' | 'gold' | 'neutral'> = {
  order_cancelled: 'danger',
  refund_initiated: 'gold',
  orders_paused: 'danger',
  orders_resumed: 'success',
  settings_changed: 'info',
  homepage_content_changed: 'neutral',
};

export default function AuditPage() {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof getAuditLog>> | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => {
    void getAuditLog(200).then(setEntries).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load the audit log.'));
  }, []);

  const actions = useMemo(() => {
    const set = new Set((entries ?? []).map((entry) => entry.action));
    return ['all', ...Array.from(set).sort()];
  }, [entries]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (entries ?? []).filter((entry) => {
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      if (!needle) return true;
      return (
        entry.action.toLowerCase().includes(needle) ||
        entry.userId.toLowerCase().includes(needle) ||
        (entry.orderId ?? '').toLowerCase().includes(needle) ||
        entry.reason.toLowerCase().includes(needle) ||
        JSON.stringify(entry.details).toLowerCase().includes(needle)
      );
    });
  }, [entries, search, actionFilter]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Audit log</h1>
          <p className="admin-head__sub">Every important staff action, newest first.</p>
        </div>
      </div>

      <div className="admin-toolbar">
        <Input placeholder="Search actions, users, orders…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search audit log" />
        <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} aria-label="Filter by action" style={{ width: 'auto' }}>
          {actions.map((action) => (
            <option key={action} value={action}>{action === 'all' ? 'All actions' : action}</option>
          ))}
        </Select>
      </div>

      {error && <p className="vz-error-box" style={{ marginBottom: 14 }}>{error}</p>}

      {entries === null ? (
        <div className="vz-stack"><Skeleton height={52} /><Skeleton height={52} /><Skeleton height={52} /></div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<ScrollText size={34} />} title="No audit entries">Actions appear here as staff work.</EmptyState>
      ) : (
        <div className="vz-stack">
          {visible.map((entry) => (
            <Card key={entry.id} flat className="admin-list__row">
              <div className="admin-list__main">
                <div className="admin-list__title">
                  <Badge tone={ACTION_TONES[entry.action] ?? 'neutral'}>{entry.action.replace(/_/g, ' ')}</Badge>
                  {entry.reason && <span className="vz-muted" style={{ marginLeft: 8 }}>{entry.reason}</span>}
                </div>
                <div className="admin-list__sub">
                  {new Date(entry.createdAt).toLocaleString('en-AU')}
                  {entry.orderId ? ` · order ${entry.orderId.slice(0, 8)}` : ''}
                  {Object.keys(entry.details).length > 0 && (
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer' }}>Details</summary>
                      <pre className="vz-mono" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
