// Printer address validation — friendly, before anything reaches the SDK.

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);
const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const TCP_PREFIX = /^TCP:/i;

export type AddressKind = 'ipv4' | 'mac' | 'tcp' | 'invalid';

export function classifyAddress(address: string): AddressKind {
  const trimmed = address.trim();
  if (TCP_PREFIX.test(trimmed)) return 'tcp';
  if (IPV4.test(trimmed)) return 'ipv4';
  if (MAC.test(trimmed)) return 'mac';
  return 'invalid';
}

/**
 * The identifier passed to the StarXpand SDK: "TCP:<ip>" for IPv4 addresses,
 * MAC addresses and explicit "TCP:…" forms pass through untouched.
 * Callers must run validateAddress() first.
 */
export function identifierFor(address: string): string {
  const trimmed = address.trim();
  if (TCP_PREFIX.test(trimmed) || MAC.test(trimmed)) return trimmed;
  return `TCP:${trimmed}`;
}

/**
 * Validate a user-entered printer address. Returns null when valid, or a
 * friendly, actionable error message.
 */
export function validateAddress(address: string): string | null {
  const trimmed = address.trim();
  if (!trimmed) return 'Enter the printer IP address (for example 192.168.1.116).';
  const kind = classifyAddress(trimmed);
  if (kind === 'invalid') {
    return `"${trimmed}" is not a valid printer address. Use a LAN IP address like 192.168.1.116 or a Star MAC address like 00:11:62:xx:xx:xx.`;
  }
  return null;
}

/** Masked address for logs — keeps full value out of error surfaces. */
export function describeAddress(address: string): string {
  const trimmed = address.trim();
  if (classifyAddress(trimmed) === 'mac') {
    const parts = trimmed.split(':');
    return `${parts[0]}:…:${parts[parts.length - 1]}`;
  }
  return trimmed;
}
