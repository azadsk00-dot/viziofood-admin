// Print queue — live print_jobs monitor with retry + test print + printer
// status detail (station, IP, last success/failure, queue length).

import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePrintStore, PrinterWithStatus } from '../state/printStore';
import { retryPrintJob } from '../services/printActions';
import { agentTestPrint, printerAgentHealth } from '../services/printerAgent';
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
  const agent = usePrintStore((s) => s.agent);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void syncService.refreshPrintState();
    void printerAgentHealth(true);
    const timer = setInterval(() => void printerAgentHealth(true), 30_000);
    return () => clearInterval(timer);
  }, []);

  const jobList = Object.values(jobs).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activeJobs = jobList.filter((j) => j.status !== 'PRINTED');
  const failed = jobList.filter((j) => j.status === 'FAILED');

  const retry = async (jobId: string) => {
    setBusy(true);
    const result = await retryPrintJob(jobId);
    setBusy(false);
    setMessage(result.ok ? 'Job requeued — the printer agent will pick it up.' : result.error ?? 'Retry failed.');
    void syncService.refreshPrintState();
  };

  const testPrint = async (printerId?: string) => {
    setBusy(true);
    const result = await agentTestPrint(printerId);
    setBusy(false);
    setMessage(
      result.ok
        ? 'Test ticket sent to the printer — check the kitchen bench.'
        : `${result.error} (Is the printer agent running with VIZIO_AGENT_HTTP_PORT set?)`,
    );
  };

  const healthColor = (p: PrinterWithStatus) =>
    p.health === 'online' || p.health === 'printing' ? theme.success
    : p.health === 'error' ? theme.danger
    : p.health === 'offline' ? theme.offline
    : theme.textDim;

  return (
    <Screen scroll>
      <SectionTitle
        title="Printers"
        right={
          <Pressable onPress={() => void printerAgentHealth(true)}>
            <Text style={{ color: theme.info, fontWeight: '800', fontSize: 13 }}>REFRESH</Text>
          </Pressable>
        }
      />
      {Object.values(printers).length === 0 ? (
        <Text style={[styles.meta, { color: theme.textDim }]}>No printers configured (Admin → Printers).</Text>
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
            <BigButton title="TEST PRINT" small variant="secondary" busy={busy} onPress={() => void testPrint(printer.id)} />
          </View>
        ))
      )}
      <Text style={[styles.meta, { color: theme.textDim, marginBottom: 8 }]}>
        Printer agent (restaurant PC): {agent.online ? `ONLINE — checked ${formatDateTime(agent.checkedAt)}` : 'NOT REACHABLE (configure in Settings)'}
      </Text>

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
