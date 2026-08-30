// Printers — full printer management (CRUD, station, IP/port/paper/copies,
// enabled/auto-print). The printer SERVICE stays the printing authority;
// this screen only configures and monitors. Retry/reprint run through
// print_jobs (RLS) / kitchen-actions with agent pickup.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminPage, Card, ConfirmDialog, EmptyState, Pill } from '../../components/admin/kit';
import { ModalSheet, NumberField, SelectField, TextField, ToggleField } from '../../components/admin/fields';
import { deleteAdminPrinter, getAdminPrinters, saveAdminPrinter } from '../../services/admin/misc';
import { retryPrintJob } from '../../services/printActions';
import { usePrintStore } from '../../state/printStore';
import { agentTestPrint } from '../../services/printerAgent';
import { syncService } from '../../services/syncService';
import { formatDateTime } from '../../lib/format';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';

const STATIONS = ['kitchen', 'bar', 'coffee', 'dessert', 'pickup', 'receipt'] as const;
const PAPER = ['32', '48', '80'] as const;

interface Draft {
  id?: string;
  name: string;
  station: string;
  connection: string;
  host: string;
  port: string;
  paperWidth: string;
  copies: string;
  enabled: boolean;
  autoPrint: boolean;
}

export default function PrintersScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const printers = usePrintStore((s) => s.printers);
  const jobs = usePrintStore((s) => s.jobs);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await syncService.refreshPrintState();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load printers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    const port = Math.round(Number(draft.port) || 9100);
    if (port < 1 || port > 65535) {
      setError('Port must be 1–65535.');
      return;
    }
    setBusy(true);
    try {
      await saveAdminPrinter({
        id: draft.id,
        name: draft.name,
        station: draft.station,
        connection: draft.connection,
        host: draft.host || 'localhost',
        port,
        paperWidth: Number(draft.paperWidth),
        copies: Math.round(Number(draft.copies) || 1),
        enabled: draft.enabled,
        autoPrint: draft.autoPrint,
      });
      setDraft(null);
      setMessage('Printer saved. Restart the printer agent to pick up changes.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const jobList = Object.values(jobs).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const failedJobs = jobList.filter((j) => j.status === 'FAILED');

  return (
    <AdminPage
      title="Printers"
      subtitle="Printing runs in the local printer service — the tablet only configures and monitors"
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
      actions={
        <Pressable
          style={styles.addButton}
          onPress={() => setDraft({ name: '', station: 'kitchen', connection: 'network', host: '', port: '9100', paperWidth: '80', copies: '1', enabled: true, autoPrint: true })}
        >
          <Text style={styles.addButtonText}>+ PRINTER</Text>
        </Pressable>
      }
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {Object.values(printers).map((printer) => (
        <Card key={printer.id} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={[styles.name, { color: dark.text }]}>{printer.name}</Text>
                <Pill
                  label={
                    printer.health === 'online' || printer.health === 'printing' ? 'ONLINE'
                    : printer.health === 'error' ? 'ERROR'
                    : printer.health === 'offline' ? 'OFFLINE' : 'UNKNOWN'
                  }
                  tone={printer.health === 'online' || printer.health === 'printing' ? 'good' : printer.health === 'error' ? 'bad' : 'warn'}
                />
              </View>
              <Text style={styles.meta}>
                {printer.station.toUpperCase()} · {printer.host}:{printer.port} · {printer.paperWidth}mm · {printer.copies} cop
                {printer.autoPrint ? ' · auto-print' : ''}
              </Text>
              <Text style={styles.meta}>
                Last print {formatDateTime(printer.lastPrintedAt)} · queue {printer.queueCount}
                {printer.failedCount ? ` · failed ${printer.failedCount}` : ''}
              </Text>
              {printer.lastError ? <Text style={[styles.meta, { color: dark.danger }]} numberOfLines={2}>Last error: {printer.lastError}</Text> : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Pressable
              style={styles.miniButton}
              onPress={() =>
                setDraft({
                  id: printer.id, name: printer.name, station: printer.station, connection: 'network',
                  host: printer.host, port: String(printer.port), paperWidth: String(printer.paperWidth),
                  copies: String(printer.copies), enabled: printer.enabled, autoPrint: printer.autoPrint,
                })
              }
            >
              <Text style={styles.miniText}>EDIT</Text>
            </Pressable>
            <Pressable style={styles.miniButton} onPress={() => void agentTestPrint(printer.id).then((r) => setMessage(r.ok ? 'Test ticket sent.' : r.error ?? 'Test print failed (agent not configured?).'))}>
              <Text style={styles.miniText}>TEST PRINT</Text>
            </Pressable>
            <Pressable style={[styles.miniButton, { borderColor: dark.danger }]} disabled={!online} onPress={() => setConfirmDelete({ id: printer.id, name: printer.name })}>
              <Text style={[styles.miniText, { color: dark.danger }]}>DELETE</Text>
            </Pressable>
          </View>
        </Card>
      ))}
      {!Object.keys(printers).length && !loading ? <EmptyState text="No printers configured." /> : null}

      {failedJobs.length ? (
        <Card title={`Failed jobs (${failedJobs.length}) — never auto-deleted`} style={{ marginTop: 14 }}>
          {failedJobs.map((job) => (
            <View key={job.id} style={styles.jobRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: dark.text, fontWeight: '700' }}>#{job.orderNumber.replace('VF-', '')} · {job.attempts}/{job.maxAttempts}</Text>
                <Text style={styles.meta} numberOfLines={2}>{job.lastError || 'Unknown error'}</Text>
              </View>
              <Pressable style={styles.miniButton} disabled={!online} onPress={() => void retryPrintJob(job.id).then(load)}>
                <Text style={styles.miniText}>RETRY</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}

      <Card title="Recent print history" style={{ marginTop: 14 }}>
        {jobList.slice(0, 20).map((job) => (
          <View key={job.id} style={styles.jobRow}>
            <Text style={{ color: dark.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
              #{job.orderNumber.replace('VF-', '')} {job.origin && job.origin !== 'auto' ? `(${job.origin})` : ''}
            </Text>
            <Pill label={job.status} tone={job.status === 'PRINTED' ? 'good' : job.status === 'FAILED' ? 'bad' : job.status === 'RETRYING' ? 'warn' : 'info'} />
            <Text style={styles.meta}>{formatDateTime(job.printedAt ?? job.createdAt)}</Text>
          </View>
        ))}
        {!jobList.length ? <EmptyState text="No print jobs in the last 24 hours." /> : null}
      </Card>

      <ConfirmDialog
        visible={confirmDelete !== null}
        title={`Delete printer ${confirmDelete?.name ?? ''}?`}
        message="Its queued jobs stop printing. Physical printers are unaffected."
        danger
        confirmLabel="DELETE"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void deleteAdminPrinter(target.id).then(load);
        }}
      />

      <ModalSheet
        visible={draft !== null}
        title={draft?.id ? 'Edit printer' : 'New printer'}
        onClose={() => setDraft(null)}
        footer={
          <Pressable style={[styles.saveButton, { opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void save()}>
            <Text style={styles.saveButtonText}>SAVE</Text>
          </Pressable>
        }
      >
        {draft ? (
          <View>
            <TextField label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <SelectField
              label="Station"
              value={draft.station}
              onChange={(station) => setDraft({ ...draft, station })}
              options={STATIONS.map((s) => ({ value: s, label: s }))}
            />
            <TextField label="IP address" value={draft.host} onChangeText={(host) => setDraft({ ...draft, host })} placeholder="192.168.1.50" keyboardType="phone-pad" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><NumberField label="Port" value={draft.port} onChangeText={(port) => setDraft({ ...draft, port })} hint="9100 for ESC/POS" /></View>
              <View style={{ flex: 1 }}>
                <SelectField
                  label="Paper width"
                  value={draft.paperWidth}
                  onChange={(paperWidth) => setDraft({ ...draft, paperWidth })}
                  options={PAPER.map((p) => ({ value: p, label: `${p} mm` }))}
                />
              </View>
            </View>
            <NumberField label="Copies (1–5)" value={draft.copies} onChangeText={(copies) => setDraft({ ...draft, copies })} />
            <ToggleField label="Enabled" value={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
            <ToggleField label="Auto-print new paid orders" value={draft.autoPrint} onChange={(autoPrint) => setDraft({ ...draft, autoPrint })} hint="Off = manual reprint only" />
          </View>
        ) : null}
      </ModalSheet>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  addButton: { backgroundColor: dark.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: dark.accentText, fontWeight: '900' },
  message: { color: dark.info, fontWeight: '700', marginBottom: 8 },
  name: { fontSize: 17, fontWeight: '800' },
  meta: { color: dark.textDim, fontSize: 13, marginTop: 2 },
  miniButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  miniText: { color: dark.info, fontWeight: '800', fontSize: 12 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: dark.border },
  saveButton: { backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: dark.accentText, fontWeight: '900', fontSize: 15 },
});
