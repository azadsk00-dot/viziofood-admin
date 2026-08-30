// Printer address validation and Star identifier construction.

import { describe, expect, it } from 'vitest';
import { classifyAddress, describeAddress, identifierFor, validateAddress } from '../src/printer/identifier';

describe('classifyAddress', () => {
  it('accepts normal LAN IPv4 addresses', () => {
    expect(classifyAddress('192.168.1.116')).toBe('ipv4');
    expect(classifyAddress('10.0.0.5')).toBe('ipv4');
    expect(classifyAddress('172.16.254.254')).toBe('ipv4');
    expect(classifyAddress(' 192.168.1.116 ')).toBe('ipv4');
  });

  it('rejects malformed IPv4', () => {
    expect(classifyAddress('192.168.1.999')).toBe('invalid');
    expect(classifyAddress('192.168.1')).toBe('invalid');
    expect(classifyAddress('999.1.1.1')).toBe('invalid');
    expect(classifyAddress('not-an-ip')).toBe('invalid');
    expect(classifyAddress('192.168.1.116.5')).toBe('invalid');
  });

  it('accepts Star MAC addresses and TCP: forms', () => {
    expect(classifyAddress('00:11:62:3d:6f:1a')).toBe('mac');
    expect(classifyAddress('TCP:192.168.1.116')).toBe('tcp');
  });
});

describe('identifierFor', () => {
  it('builds TCP:<ip> for IPv4 (the working StarXpand LAN form)', () => {
    expect(identifierFor('192.168.1.116')).toBe('TCP:192.168.1.116');
    expect(identifierFor(' 10.0.0.5 ')).toBe('TCP:10.0.0.5');
  });

  it('passes MAC and explicit TCP forms through untouched', () => {
    expect(identifierFor('00:11:62:3d:6f:1a')).toBe('00:11:62:3d:6f:1a');
    expect(identifierFor('TCP:192.168.1.116')).toBe('TCP:192.168.1.116');
  });
});

describe('validateAddress (friendly errors)', () => {
  it('empty → actionable message', () => {
    expect(validateAddress('')).toContain('Enter the printer IP address');
  });

  it('invalid → quotes the bad value and shows examples', () => {
    const message = validateAddress(' printer! ');
    expect(message).toContain('not a valid printer address');
    expect(message).toContain('192.168.1.116');
  });

  it('valid addresses pass', () => {
    expect(validateAddress('192.168.1.116')).toBeNull();
    expect(validateAddress('00:11:62:3d:6f:1a')).toBeNull();
  });
});

describe('describeAddress', () => {
  it('shows IPs as-is, masks MACs', () => {
    expect(describeAddress('192.168.1.116')).toBe('192.168.1.116');
    expect(describeAddress('00:11:62:3d:6f:1a')).toBe('00:…:1a');
  });
});
