// Direct raw-TCP printing from the tablet to the LAN printer (Star Line
// bytes to printer_ip:9100). No HTTP, no agent PC — Android's network
// security policy is never involved because this is a raw socket, and the
// address is validated to be private-LAN before connecting.
//
// Print acknowledgement strategy: a job only counts as printed after the
// TCP connect succeeds, all bytes are written, and the socket close
// completes (write callback + end callback = kernel buffer flushed).

import { Buffer } from 'buffer';
import type TcpSocketLibrary from 'react-native-tcp-socket';
import { parsePrinterAddress } from '../lib/net';

type TcpSocket = TcpSocketLibrary.Socket;

function friendlyError(host: string, port: number, error: Error): Error {
  const text = error.message ?? String(error);
  if (/ECONNREFUSED/i.test(text)) {
    return new Error(`Printer at ${host}:${port} refused the connection — check the IP address on the printer's self-test page.`);
  }
  if (/ETIMEDOUT|timeout/i.test(text)) {
    return new Error(`Printer at ${host}:${port} did not respond — it may be off or on a different network.`);
  }
  if (/ENETUNREACH|EHOSTUNREACH|ECONNRESET|ENOTFOUND/i.test(text)) {
    return new Error(`Cannot reach ${host}:${port} — the tablet and the printer must be on the same Wi-Fi network.`);
  }
  return new Error(`Printer ${host}:${port}: ${text}`);
}

/**
 * Send raw bytes to the printer. Resolves only after connect + write + flush
 * (socket close) all succeed; rejects with a staff-readable reason otherwise.
 */
export async function printRaw(
  host: string,
  port: number | string | undefined,
  payload: Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const target = parsePrinterAddress(host, port);
  const timeoutMs = options.timeoutMs ?? 10_000;

  const TcpSocket = (await import('react-native-tcp-socket')).default;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let socket: TcpSocket | null = null;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // already closed
      }
      if (error) reject(friendlyError(target.host, target.port, error));
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error(`Printer at ${target.host}:${target.port} did not respond within ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );

    try {
      socket = TcpSocket.createConnection(
        { host: target.host, port: target.port, connectTimeout: timeoutMs },
        () => {
          // The write callback fires when the native layer confirms the bytes
          // were handed to the socket (this library's end() has no callback).
          socket?.write(Buffer.from(payload), undefined, (writeError?: Error | null) => {
            if (writeError) return finish(writeError);
            try {
              socket?.end();
            } catch {
              // already closing — 'close' finishes us
            }
            finish(null);
          });
        },
      );
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    socket.on('error', (error: Error | string) => finish(error instanceof Error ? error : new Error(String(error))));
    socket.on('close', () => finish(null));
  });
}

/** Quick reachability probe — powers the CONNECTED / OFFLINE status dot. */
export async function probePrinter(host: string, port: number | string | undefined, timeoutMs = 2500): Promise<boolean> {
  let target: { host: string; port: number };
  try {
    target = parsePrinterAddress(host, port);
  } catch {
    return false;
  }
  const TcpSocket = (await import('react-native-tcp-socket')).default;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    let socket: TcpSocket | null = null;
    try {
      socket = TcpSocket.createConnection(
        { host: target.host, port: target.port, connectTimeout: timeoutMs },
        () => done(true),
      );
    } catch {
      done(false);
      return;
    }
    socket.on('error', () => done(false));
    socket.on('close', () => done(false));
  });
}
