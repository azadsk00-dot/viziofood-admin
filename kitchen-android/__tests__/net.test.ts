// LAN printer address validation — public internet IPs must be rejected,
// private LAN ranges accepted, port defaults to 9100.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_PORT, isLanHost, isPrivateIpv4, parsePrinterAddress } from '../src/lib/net';

describe('isPrivateIpv4', () => {
  it.each([
    ['192.168.1.103', true],
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['127.0.0.1', true],
    ['169.254.9.9', true],
    ['172.32.0.1', false],
    ['8.8.8.8', false],
  ])('%s → %s', (host, expected) => {
    expect(isPrivateIpv4(host)).toBe(expected);
  });

  it('rejects malformed octets', () => {
    expect(isPrivateIpv4('999.1.1.1')).toBeNull();
    expect(isPrivateIpv4('192.168.1')).toBeNull();
  });
});

describe('isLanHost', () => {
  it('accepts localhost, .local and private IPs; rejects public names', () => {
    expect(isLanHost('localhost')).toBe(true);
    expect(isLanHost('printer.local')).toBe(true);
    expect(isLanHost('192.168.1.103')).toBe(true);
    expect(isLanHost('example.com')).toBe(false);
    expect(isLanHost('8.8.8.8')).toBe(false);
  });
});

describe('parsePrinterAddress', () => {
  it('accepts the restaurant printer and defaults the port to 9100', () => {
    expect(parsePrinterAddress('192.168.1.103', undefined)).toEqual({ host: '192.168.1.103', port: 9100 });
    expect(parsePrinterAddress(' 192.168.1.103 ', '9100')).toEqual({ host: '192.168.1.103', port: 9100 });
    expect(parsePrinterAddress('10.0.0.8', 9100)).toEqual({ host: '10.0.0.8', port: 9100 });
  });

  it('defaults an empty port to 9100', () => {
    expect(DEFAULT_PRINTER_PORT).toBe(9100);
    expect(parsePrinterAddress('192.168.1.103', '').port).toBe(9100);
  });

  it('rejects public IPs, IPv6, garbage and bad ports with clear reasons', () => {
    expect(() => parsePrinterAddress('8.8.8.8', 9100)).toThrow(/not a private LAN address/);
    expect(() => parsePrinterAddress('', 9100)).toThrow(/empty/);
    expect(() => parsePrinterAddress('::1', 9100)).toThrow(/IPv6/);
    expect(() => parsePrinterAddress('192.168.1.999', 9100)).toThrow(/not a private LAN address/);
    expect(() => parsePrinterAddress('192.168.1.103', 0)).toThrow(/not valid/);
    expect(() => parsePrinterAddress('192.168.1.103', 70000)).toThrow(/not valid/);
    expect(() => parsePrinterAddress('192.168.1.103', 'abc')).toThrow(/not valid/);
  });
});
