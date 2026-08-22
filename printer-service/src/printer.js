/**
 * Raw TCP printing (ESC/POS) — the standard interface for thermal receipt
 * printers: connect to printer_ip:9100, stream bytes, close. No drivers, no
 * OS dependencies. A connect/write timeout keeps offline printers from
 * hanging the queue.
 */

import net from 'node:net';

/**
 * @param {string} host
 * @param {number} port
 * @param {Buffer} payload
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<void>} rejects on connection failure or timeout
 */
export function printRaw(host, port, payload, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(new Error(`Printer ${host}:${port} timed out after ${timeoutMs}ms`)));
    socket.once('error', (error) => finish(error));
    socket.connect(port, host, () => {
      socket.write(payload, (writeError) => {
        if (writeError) return finish(writeError);
        // Give the buffer time to flush before closing.
        socket.end(() => finish(null));
      });
    });
  });
}

/** Quick reachability probe used by the retry loop and status displays. */
export function probe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host, () => done(true));
  });
}
