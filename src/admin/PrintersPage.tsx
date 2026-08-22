/**
 * Printers admin — configure local network printers (station, host, port,
 * paper width, auto-print, copies), watch the live print queue, retry
 * failed jobs, and reprint orders. The local printer service
 * (printer-service/) reads this table and does the actual printing.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Printer, RotateCcw } from 'lucide-react';
import {
  deletePrinter,
  getPrinters,
  getPrintJobs,
  reprintOrder,
  retryPrintJob,
  savePrinter,
} from '../services/printers';
import { printerConfigSchema } from '../lib/validation';
import type { PrintJob, PrinterConfig } from '../types';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Toggle } from '../ui';

const emptyPrinter = (): Partial<PrinterConfig> & { name: string } => ({
  name: '',
  station: 'kitchen',
  connection: 'network',
  host: '192.168.1.50',
  port: 9100,
  paperWidth: 80,
  enabled: true,
  autoPrint: true,
  copies: 1,
});

function PrinterEditor({ printer, onClose, onSaved }: { printer: Partial<PrinterConfig> & { name: string }; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(printer);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    const parsed = printerConfigSchema.safeParse({ ...form, host: form.host || 'localhost' });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await savePrinter(form);
      toast.show(printer.id ? 'Printer updated' : 'Printer added');
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the printer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={printer.id ? `Edit ${printer.name}` : 'New printer'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save printer'}</Button>
        </>
      }
    >
      {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <Field label="Name" htmlFor="pr-name">
        <Input id="pr-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Kitchen thermal" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Station" htmlFor="pr-station">
          <Select id="pr-station" value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value as PrinterConfig['station'] })}>
            <option value="kitchen">Kitchen</option>
            <option value="bar">Bar</option>
            <option value="coffee">Coffee</option>
            <option value="dessert">Dessert</option>
            <option value="pickup">Pickup</option>
            <option value="receipt">Receipt</option>
          </Select>
        </Field>
        <Field label="Connection" htmlFor="pr-connection">
          <Select id="pr-connection" value={form.connection} onChange={(e) => setForm({ ...form, connection: e.target.value as PrinterConfig['connection'] })}>
            <option value="network">Network (IP)</option>
          </Select>
        </Field>
        <Field label="IP address" htmlFor="pr-host">
          <Input id="pr-host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.50" />
        </Field>
        <Field label="Port" hint="9100 for raw TCP/ESC-POS" htmlFor="pr-port">
          <Input id="pr-port" type="number" min={1} max={65535} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Paper width" htmlFor="pr-paper">
          <Select id="pr-paper" value={form.paperWidth} onChange={(e) => setForm({ ...form, paperWidth: Number(e.target.value) as PrinterConfig['paperWidth'] })}>
            <option value={80}>80 mm</option>
            <option value={48}>48 mm</option>
            <option value={32}>32 mm</option>
          </Select>
        </Field>
        <Field label="Copies" htmlFor="pr-copies">
          <Input id="pr-copies" type="number" min={1} max={5} value={form.copies} onChange={(e) => setForm({ ...form, copies: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="vz-stack" style={{ marginTop: 14 }}>
        <Toggle checked={form.enabled ?? true} onChange={(v) => setForm({ ...form, enabled: v })} label="Enabled" />
        <Toggle checked={form.autoPrint ?? true} onChange={(v) => setForm({ ...form, autoPrint: v })} label="Auto-print new paid orders" />
      </div>
    </Modal>
  );
}

const jobTone = (status: PrintJob['status']) =>
  status === 'PRINTED' ? 'success' : status === 'FAILED' ? 'danger' : status === 'QUEUED' ? 'info' : 'neutral';

export default function PrintersPage() {
  const [printers, setPrinters] = useState<PrinterConfig[] | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [editing, setEditing] = useState<(Partial<PrinterConfig> & { name: string }) | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [printerList, jobList] = await Promise.all([getPrinters(), getPrintJobs(30)]);
      setPrinters(printerList);
      setJobs(jobList);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load printers.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Printers</h1>
          <p className="admin-head__sub">
            Local printer stations and the live print queue. The restaurant's printer service picks jobs up automatically.
          </p>
        </div>
        <Button onClick={() => setEditing(emptyPrinter())}><Plus size={16} /> Add printer</Button>
      </div>

      {error && <p className="vz-error-box" style={{ marginBottom: 14 }}>{error}</p>}
      {error.toLowerCase().includes('relation') && (
        <Card pad flat style={{ marginBottom: 14 }}>
          <p className="vz-muted" style={{ margin: 0 }}>
            The printers tables don't exist yet — apply the 20260826 migration, then set up the local service
            (see printer-service/README.md).
          </p>
        </Card>
      )}

      {printers === null ? (
        <div className="vz-stack"><Skeleton height={60} /><Skeleton height={60} /></div>
      ) : printers.length === 0 ? (
        <EmptyState icon={<Printer size={34} />} title="No printers configured">
          Add your kitchen printer's IP address — the local service handles the rest.
        </EmptyState>
      ) : (
        <div className="admin-list" style={{ marginBottom: 26 }}>
          {printers.map((printer) => (
            <div className="admin-list__row" key={printer.id}>
              <div className="admin-list__main">
                <div className="admin-list__title">
                  {printer.name} {printer.enabled ? <Badge tone="success" dot>Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}
                </div>
                <div className="admin-list__sub printer-status">
                  {printer.station} · {printer.host}:{printer.port} · {printer.paperWidth}mm · {printer.copies} cop{printer.copies === 1 ? 'y' : 'ies'}
                  {printer.autoPrint ? ' · auto-print' : ''}
                </div>
              </div>
              <div className="vz-row">
                <Button size="sm" variant="secondary" onClick={() => setEditing(printer)}>Edit</Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm(`Delete printer ${printer.name}?`)) return;
                    void deletePrinter(printer.id).then(() => {
                      toast.show('Printer deleted');
                      void load();
                    });
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: '1.2rem' }}>Print queue</h2>
      {jobs.length === 0 ? (
        <p className="vz-muted">No print jobs yet.</p>
      ) : (
        <div className="vz-table-wrap">
          <table className="vz-table">
            <thead>
              <tr><th>Order</th><th>Printer</th><th>Status</th><th>Attempts</th><th>When</th><th></th></tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td><strong>{job.orderNumber}</strong></td>
                  <td>{printers?.find((p) => p.id === job.printerId)?.name ?? job.printerId.slice(0, 8)}</td>
                  <td>
                    <Badge tone={jobTone(job.status)} dot>{job.status}</Badge>
                    {job.lastError && <div className="vz-muted" style={{ fontSize: '0.75rem' }}>{job.lastError.slice(0, 60)}</div>}
                  </td>
                  <td>{job.attempts}/{job.maxAttempts}</td>
                  <td className="vz-muted">{new Date(job.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    <div className="vz-row">
                      {(job.status === 'FAILED' || job.status === 'RETRYING') && (
                        <Button size="sm" variant="secondary" onClick={() => void retryPrintJob(job.id).then(() => { toast.show('Job requeued'); void load(); })}>
                          <RotateCcw size={14} /> Retry
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void reprintOrder(job.orderId, job.orderNumber, job.printerId).then(() => { toast.show('Reprint queued'); void load(); })}>
                        Reprint
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <PrinterEditor printer={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </>
  );
}
