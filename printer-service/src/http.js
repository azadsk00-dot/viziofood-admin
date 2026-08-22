/**
 * Optional LAN HTTP endpoint for the kitchen tablets.
 *
 * Enabled ONLY when VIZIO_AGENT_HTTP_PORT is set (e.g. 3777). The tablet
 * cannot reach a cloud Edge Function to print — printers live on the LAN —
 * so the agent (which shares the LAN with the printers) exposes two tiny
 * endpoints:
 *
 *   GET  /health                 → agent liveness + printer list + queue depth
 *   POST /test-print {printerId?|host,port?,width?} → ESC/POS test ticket
 *
 * Security: bind is 0.0.0.0 (LAN). When VIZIO_AGENT_HTTP_TOKEN is set every
 * request must carry it (x-vizio-token header or ?token=). Restaurant LAN
 * only — never port-forward this to the internet.
 */

import http from 'node:http';
import { printRaw, probe } from './printer.js';
import { renderTestTicket } from './escpos.js';

const log = (level, message, data) => {
  const line = `[vizio-print:${level}] ${message}`;
  if (data === undefined) console.log(line);
  else console.log(line, typeof data === 'string' ? data : JSON.stringify(data));
};

/**
 * @param {import('./agent.js').PrintAgent} agent
 * @param {{ port: number, token?: string }} options
 * @returns {Promise<import('node:http').Server>}
 */
export function startHttpServer(agent, options) {
  const startedAt = Date.now();

  const authorized = (request, url) => {
    if (!options.token) return true; // no token configured → LAN open (small trusted network)
    const header = request.headers['x-vizio-token'];
    const query = url.searchParams.get('token');
    return header === options.token || query === options.token;
  };

  const readJson = (request) =>
    new Promise((resolve, reject) => {
      let raw = '';
      request.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 10_000) reject(new Error('body too large'));
      });
      request.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error('invalid JSON'));
        }
      });
      request.on('error', reject);
    });

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    if (!authorized(request, url)) return send(401, { error: 'unauthorized' });

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return send(200, {
          ok: true,
          agent: 'vizio-print-agent',
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          printers: agent.printers.map((p) => ({
            id: p.id,
            name: p.name,
            station: p.station,
            host: p.host,
            port: p.port,
            paperWidth: p.paper_width,
          })),
          localRetryQueue: agent.localQueue.size,
        });
      }

      if (request.method === 'POST' && url.pathname === '/test-print') {
        const body = await readJson(request);
        const printer =
          (body.printerId && agent.printers.find((p) => p.id === body.printerId)) ||
          (body.host && {
            name: body.host,
            host: body.host,
            port: Number(body.port) || 9100,
            paper_width: Number(body.width) || 48,
          }) ||
          agent.printers[0];
        if (!printer) return send(404, { error: 'no printer configured on this agent' });

        const ticket = renderTestTicket(printer.name, printer.paper_width ?? 48);
        await printRaw(printer.host, printer.port ?? 9100, ticket, { timeoutMs: 10_000 });
        log('info', `test print sent to ${printer.name} (${printer.host}:${printer.port})`);
        return send(200, { ok: true, printer: printer.name, host: printer.host });
      }

      if (request.method === 'GET' && url.pathname === '/probe') {
        const host = url.searchParams.get('host');
        const port = Number(url.searchParams.get('port') || 9100);
        if (!host) return send(400, { error: 'host query param required' });
        const reachable = await probe(host, port, 3000);
        return send(200, { ok: reachable, host, port });
      }

      return send(404, { error: 'not found' });
    } catch (error) {
      log('warn', `http ${request.method} ${url.pathname} failed`, error?.message ?? String(error));
      return send(500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '0.0.0.0', () => {
      log('info', `LAN HTTP endpoint listening on port ${options.port} (for kitchen tablets)`);
      resolve(server);
    });
  });
}
