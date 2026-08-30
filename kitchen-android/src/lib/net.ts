// LAN address validation — printers are private-LAN devices only. The app
// must never open printer connections to public internet addresses, and
// Supabase/Stripe/Edge Function traffic stays on the HTTPS stack.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Octets(host: string): number[] | null {
  const match = IPV4.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** true = private/loopback/link-local IPv4, false = public IPv4, null = not an IPv4 literal. */
export function isPrivateIpv4(host: string): boolean | null {
  const octets = ipv4Octets(host);
  if (!octets) return null;
  const [a, b] = octets;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** LAN-reachable printer hosts (public IPs and public DNS names rejected). */
export function isLanHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost') return true;
  if (['.local', '.lan', '.internal', '.home'].some((suffix) => h.endsWith(suffix))) return true;
  return isPrivateIpv4(h) === true;
}

export interface PrinterAddress {
  host: string;
  port: number;
}

/** Default raw-printing port (Star and Epson LAN printers). */
export const DEFAULT_PRINTER_PORT = 9100;

/**
 * Validate a configured printer address. Rejects public hosts and invalid
 * ports with staff-readable errors; 9100 is the expected printer port.
 */
export function parsePrinterAddress(host: string, port: number | string | undefined): PrinterAddress {
  const h = String(host ?? '').trim().toLowerCase();
  if (!h) throw new Error('Printer IP address is empty.');
  if (h.includes(':')) throw new Error('IPv6 printer addresses are not supported — use the printer\'s IPv4 address.');
  if (!isLanHost(h)) {
    throw new Error(`"${h}" is not a private LAN address — the printer must be on the restaurant network (e.g. 192.168.1.103).`);
  }
  const p = port === undefined || port === '' ? DEFAULT_PRINTER_PORT : Math.round(Number(port));
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Printer port "${port}" is not valid (1–65535).`);
  return { host: h, port: p };
}
