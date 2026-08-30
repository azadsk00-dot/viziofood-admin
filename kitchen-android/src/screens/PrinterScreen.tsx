// Printer — the ENTIRE printer configuration a restaurant employee needs:
// the printer's IP address, the port, a status dot and a TEST PRINTER
// button. The tablet prints directly to this address over the LAN (Star
// Line, port 9100); there is no agent PC and nothing else to configure.
//
// The address lives in the printers table (Supabase), so moving the printer
// to a new network is just an IP edit here — no rebuild, no PC involved.

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton, BigInput, Screen, SectionTitle, useTheme } from '../components/ui';
import { usePrintStore, type PrinterWithStatus } from '../state/printStore';
import { saveAdminPrinter } from '../services/admin/misc';
import { probePrinter, printRaw } from '../services/printerTcp';
import { parsePrinterAddress, DEFAULT_PRINTER_PORT } from '../lib/net';
import { renderTestTicket } from '../lib/starline';
import { syncService } from '../services/syncService';

export default function PrinterScreen(): React.ReactElement {
  const theme = useTheme();
  const printers = usePrintStore((s) => s.printers);
  const probes = usePrintStore((s) => s.probes);
  const setProbe = usePrintStore((s) => s.setProbe);
  const [hostDrafts, setHostDrafts] = useState<Record<string, string>>({});
  const [portDrafts, setPortDrafts] = useState<Record<string, string>>({});
  const [busyPrinter, setBusyPrinter] = useState<string | null>(null);
  const [status, setStatus] = useState<{ printerId: string; ok: boolean; text: string } | null>(null);
  const [error, setError] = useState('');
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState(String(DEFAULT_PRINTER_PORT));

  const load = useCallback(async () => {
    await syncService.refreshPrintState();
  }, []);

  const probeAll = useCallback(() => {
    for (const printer of Object.values(usePrintStore.getState().printers)) {
      void probePrinter(printer.host, printer.port).then((online) => setProbe(printer.id, online));
    }
  }, [setProbe]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    probeAll();
    const timer = setInterval(probeAll, 30_000);
    return () => clearInterval(timer);
  }, [probeAll, printers]);

  const hostOf = (printer: PrinterWithStatus): string =>
    hostDrafts[printer.id] ?? printer.host;
  const portOf = (printer: PrinterWithStatus): string =>
    portDrafts[printer.id] ?? String(printer.port);

  const save = async (printer: PrinterWithStatus) => {
    setError('');
    try {
      const address = parsePrinterAddress(hostOf(printer), portOf(printer));
      setBusyPrinter(printer.id);
      await saveAdminPrinter({ id: printer.id, host: address.host, port: address.port });
      setHostDrafts((d) => ({ ...d, [printer.id]: address.host }));
      setStatus({ printerId: printer.id, ok: true, text: 'Saved.' });
      await load();
      probeAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the printer.');
    } finally {
      setBusyPrinter(null);
    }
  };

  const testPrinter = async (printer: PrinterWithStatus) => {
    setError('');
    setStatus(null);
    try {
      const address = parsePrinterAddress(hostOf(printer), portOf(printer));
      setBusyPrinter(printer.id);
      const online = await probePrinter(address.host, address.port);
      setProbe(printer.id, online);
      if (!online) {
        setStatus({ printerId: printer.id, ok: false, text: `PRINTER CONNECTION FAILED — cannot reach ${address.host}:${address.port}. Check the printer is on and both devices are on the same Wi-Fi.` });
        return;
      }
      // Star Line test receipt, straight over TCP — same bytes as real orders.
      await printRaw(address.host, address.port, renderTestTicket(printer.name, printer.paperWidth ?? 80));
      setProbe(printer.id, true);
      setStatus({ printerId: printer.id, ok: true, text: `PRINT SUCCESSFUL — test receipt sent to ${address.host}:${address.port}. Check the printer.` });
    } catch (e) {
      setProbe(printer.id, false);
      setStatus({ printerId: printer.id, ok: false, text: `PRINTER CONNECTION FAILED — ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusyPrinter(null);
    }
  };

  const addFirst = async () => {
    setError('');
    try {
      const address = parsePrinterAddress(newHost, newPort);
      setBusyPrinter('new');
      await saveAdminPrinter({
        name: 'Kitchen printer',
        station: 'kitchen',
        connection: 'network',
        host: address.host,
        port: address.port,
        paperWidth: 80,
        copies: 1,
        enabled: true,
        autoPrint: true,
      });
      setNewHost('');
      await load();
      setStatus({ printerId: 'new', ok: true, text: 'Printer added.' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the printer.');
    } finally {
      setBusyPrinter(null);
    }
  };

  const statusColor = (printer: PrinterWithStatus): string => {
    if (printer.health === 'printing' || printer.health === 'online') return theme.success;
    if (printer.health === 'error') return theme.danger;
    if (printer.health === 'offline') return theme.offline;
    return theme.textDim;
  };

  const printerList = Object.values(printers);

  return (
    <Screen scroll>
      <SectionTitle title="Printer" />
      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}

      {printerList.map((printer) => {
        const probe = probes[printer.id];
        const connected = probe ? probe.online : printer.health === 'online' || printer.health === 'printing';
        return (
          <View key={printer.id} style={[styles.card, { backgroundColor: theme.surface }]}>
            <Text style={[styles.name, { color: theme.text }]}>{printer.name}</Text>
            <Text style={[styles.meta, { color: theme.textDim }]}>
              {printer.station.toUpperCase()} · {printer.paperWidth}mm · prints automatically when orders are paid
            </Text>

            <BigInput
              label="Printer IP address"
              value={hostOf(printer)}
              onChangeText={(v) => setHostDrafts((d) => ({ ...d, [printer.id]: v }))}
              placeholder="192.168.1.103"
              keyboardType="phone-pad"
            />
            <BigInput
              label="Port"
              value={portOf(printer)}
              onChangeText={(v) => setPortDrafts((d) => ({ ...d, [printer.id]: v }))}
              placeholder="9100"
              keyboardType="numeric"
            />

            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: connected ? theme.success : theme.offline }]} />
              <Text style={[styles.statusText, { color: connected ? theme.success : theme.offline }]}>
                {connected ? 'CONNECTED' : 'OFFLINE'}
              </Text>
            </View>

            <View style={styles.buttonRow}>
              <BigButton
                title="SAVE"
                small
                variant="secondary"
                busy={busyPrinter === printer.id}
                onPress={() => void save(printer)}
                style={{ flex: 1 }}
              />
              <BigButton
                title="TEST PRINTER"
                small
                busy={busyPrinter === printer.id}
                onPress={() => void testPrinter(printer)}
                style={{ flex: 1.4 }}
              />
            </View>

            {status?.printerId === printer.id ? (
              <Text style={[styles.result, { color: status.ok ? theme.success : theme.danger }]}>{status.text}</Text>
            ) : null}
          </View>
        );
      })}

      {printerList.length === 0 ? (
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.name, { color: theme.text }]}>No printer yet</Text>
          <Text style={[styles.meta, { color: theme.textDim, marginBottom: 12 }]}>
            Enter the printer's IP address (print its self-test page to find it — hold the FEED button while turning it on).
          </Text>
          <BigInput
            label="Printer IP address"
            value={newHost}
            onChangeText={setNewHost}
            placeholder="192.168.1.103"
            keyboardType="phone-pad"
          />
          <BigInput
            label="Port"
            value={newPort}
            onChangeText={setNewPort}
            placeholder="9100"
            keyboardType="numeric"
          />
          <BigButton title="ADD PRINTER" busy={busyPrinter === 'new'} onPress={() => void addFirst()} />
          {status?.printerId === 'new' ? (
            <Text style={[styles.result, { color: status.ok ? theme.success : theme.danger }]}>{status.text}</Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, marginBottom: 10 },
  name: { fontSize: 20, fontWeight: '800' },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 2, marginBottom: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  statusText: { fontSize: 16, fontWeight: '900' },
  buttonRow: { flexDirection: 'row', gap: 10 },
  result: { fontSize: 14, fontWeight: '700', marginTop: 12 },
  error: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
});
