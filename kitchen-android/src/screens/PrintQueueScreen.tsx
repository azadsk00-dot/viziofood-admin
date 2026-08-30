// Print queue — live print_jobs monitor with retry + test print. This
// tablet prints the jobs itself (direct Star Line over TCP), so the queue
// here is the tablet's own work list.

import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { usePrintStore, PrinterWithStatus } from '../state/printStore';
import { retryPrintJob } from '../services/printActions';
import { printRaw, probePrinter } from '../services/printerTcp';
import { renderTestTicket } from '../lib/starline';
import { syncService } from '../services/syncService';
import { formatDateTime } from '../lib/format';
import { BigButton, Screen, SectionTitle, useTheme } from '../components/ui';
import type { PrintJob } from '../lib/types';

const STATUS_COLORS: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'textDim'> = {
  PRINTED: 'success',
  FAILED: 'danger',
  RETRYING: 'warning',
  PRINTING: 'info',
  QUEUED: 'textDim',
};

export default function PrintQueueScreen(): React.ReactElement {
  const theme = useTheme();
  const printers = usePrintStore((s) => s.printers);
  const jobs = usePrintStore((s) => s.jobs);
  const setProbe = usePrintStore((s) => s.setProbe);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void syncService.refreshPrintState();
    const timer = setInterval(() => {
      for (const printer of Object.values(usePrintStore.getState().printers)) {
        void probePrinter(printer.host, printer.port).then((online) => setProbe(printer.id, online));
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [setProbe]);

  const jobList = Object.values(jobs).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activeJobs = jobList.filter((j) => j.status !== 'PRINTED');
  const failed = jobList.filter((j) => j.status === 'FAILED');

  const retry = async (jobId: string) => {
    setBusy(true);
    const result = await retryPrintJob(jobId);
    setBusy(false);
    setMessage(result.ok ? 'Job requeued — the tablet will print it automatically.' : result.error ?? 'Retry failed.');
    void syncService.refreshPrintState();
  };

  const testPrint = async (printer: PrinterWithStatus) => {
    setBusy(true);
    try {
      await printRaw(printer.host, printer.port, renderTestTicket(printer.name, printer.paperWidth ?? 80));
      setProbe(printer.id, true);
      setMessage('Test receipt sent — check the kitchen bench.');
    } catch (error) {
      setProbe(printer.id, false);
      setMessage(error instanceof Error ? error.message : 'Test print failed.');
    } finally {
      setBusy(false);
    }
  };

  const healthColor = (p: PrinterWithStatus) =>
    p.health === 'online' || p.health === 'printing' ? theme.success
    : p.health === 'error' ? theme.danger
    : p.health === 'offline' ? theme.offline
    : theme.textDim;

  return (
    <Screen scroll>
      <SectionTitle title="Printers" />
      {Object.values(printers).length === 0 ? (
        <Text style={[styles.meta, { color: theme.textDim }]}>No printers configured — set one up under Printer in the side menu.</Text>
      ) : (
        Object.values(printers).map((printer) => (
          <View key={printer.id} style={[styles.printerCard, { backgroundColor: theme.surface, borderColor: healthColor(printer) }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.printerName, { color: theme.text }]}>{printer.name}</Text>
                <Text style={[styles.badge, { color: healthColor(printer), borderColor: healthColor(printer) }]}>
                  {printer.health.toUpperCase()}
                </Text>
                {!printer.enabled ? <Text style={[styles.badge, { color: theme.textDim, borderColor: theme.border }]}>DISABLED</Text> : null}
              </View>
              <Text style={[styles.meta, { color: theme.textDim }]}>
                {printer.station.toUpperCase()} · {printer.host}:{printer.port} · {printer.paperWidth}mm
                {printer.autoPrint ? ' · auto-print' : ''}
              </Text>
              <Text style={[styles.meta, { color: theme.textDim }]}>
                Last print: {formatDateTime(printer.lastPrintedAt)} · Queue: {printer.queueCount}
                {printer.retryingCount ? ` · Retrying: ${printer.retryingCount}` : ''}
                {printer.failedCount ? ` · Failed: ${printer.failedCount}` : ''}
              </Text>
              {printer.lastError ? (
                <Text style={[styles.error, { color: theme.danger }]} numberOfLines={2}>Last error: {printer.lastError}</Text>
              ) : null}
            </View>
            <BigButton title="TEST PRINT" small variant="secondary" busy={busy} onPress={() => void testPrint(printer)} />
          </View>
        ))
      )}

      <SectionTitle title={`Failed jobs (${failed.length})`} />
      {failed.length === 0 ? (
        <Text style={[styles.meta, { color: theme.textDim }]}>No failed jobs. Failed jobs are never deleted automatically.</Text>
      ) : (
        failed.map((job) => <JobRow key={job.id} job={job} theme={theme} onRetry={() => void retry(job.id)} busy={busy} />)
      )}

      <SectionTitle title={`Queue & recent (${activeJobs.length} active)`} />
      <FlatList
        data={jobList.slice(0, 40)}
        keyExtractor={(job) => job.id}
        scrollEnabled={false}
        renderItem={({ item }) => <JobRow key={item.id} job={item} theme={theme} onRetry={item.status === 'FAILED' ? () => void retry(item.id) : undefined} busy={busy} />}
        ListEmptyComponent={<Text style={[styles.meta, { color: theme.textDim }]}>No print jobs in the last 24 hours.</Text>}
      />

      {message ? <Text style={[styles.message, { color: theme.info }]}>{message}</Text> : null}
    </Screen>
  );
}

function JobRow(props: { job: PrintJob; theme: ReturnType<typeof useTheme>; onRetry?: () => void; busy?: boolean }): React.ReactElement {
  const color = props.theme[STATUS_COLORS[props.job.status] ?? 'textDim'];
  return (
    <View style={[styles.jobRow, { backgroundColor: props.theme.surface }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.jobLine, { color: props.theme.text }]}>
          #{props.job.orderNumber.replace('VF-', '')} — {props.job.status}
          {props.job.attempts > 1 ? ` (${props.job.attempts}/${props.job.maxAttempts})` : ''}
          {props.job.origin && props.job.origin !== 'auto' ? ` · ${props.job.origin}` : ''}
        </Text>
        <Text style={[styles.meta, { color: props.theme.textDim }]} numberOfLines={2}>
          {props.job.lastError || formatDateTime(props.job.printedAt ?? props.job.createdAt)}
        </Text>
      </View>
      {props.onRetry ? (
        <BigButton title="RETRY" small variant="secondary" onPress={props.onRetry} busy={props.busy} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  printerCard: { borderRadius: 14, borderWidth: 2, padding: 14, marginBottom: 10, flexDirection: 'row', gap: 12, alignItems: 'center' },
  printerName: { fontSize: 20, fontWeight: '800' },
  badge: { fontSize: 12, fontWeight: '800', borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, textTransform: 'uppercase' },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  error: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  jobRow: { borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', gap: 12, alignItems: 'center' },
  jobLine: { fontSize: 16, fontWeight: '700' },
  message: { fontSize: 15, fontWeight: '700', marginTop: 12 },
});
