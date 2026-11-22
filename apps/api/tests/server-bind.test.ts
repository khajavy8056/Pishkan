import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLanFirewallLeaseValid, isLanStrictMode, lanAccessInfo, privateLanAddresses, resolveListenHost } from '../src/lib/server-bind.js';
import { isPublicHttpsUrl } from '../src/lib/public-url.js';
import { sanitizeLogText, safeErrorText } from '../src/lib/safe-log.js';

describe('Windows interface binding', () => {
  it('defaults wildcard configuration to loopback on Windows', () => {
    expect(resolveListenHost('0.0.0.0', 'win32', {})).toBe('127.0.0.1');
  });

  it('simple mode (default): an explicit LAN opt-in binds the wildcard interface with no lease at all', () => {
    expect(isLanStrictMode({})).toBe(false);
    expect(isLanStrictMode({ PISHKAN_LAN_STRICT: 'true' })).toBe(true);
    // The installer's explicit choice is enough, whatever the firewall state.
    expect(resolveListenHost('0.0.0.0', 'win32', { LAN_ACCESS: 'true' })).toBe('0.0.0.0');
    // Still loopback without the explicit opt-in (no accidental exposure).
    expect(resolveListenHost('0.0.0.0', 'win32', {})).toBe('127.0.0.1');
    expect(resolveListenHost('0.0.0.0', 'win32', { LAN_ACCESS: 'false' })).toBe('127.0.0.1');
  });

  it('strict mode does not expose LAN when opt-in, firewall verification, or a fresh lease is absent', () => {
    expect(resolveListenHost('0.0.0.0', 'win32', { PISHKAN_LAN_STRICT: 'true', LAN_ACCESS: 'true' })).toBe('127.0.0.1');
    expect(resolveListenHost('0.0.0.0', 'win32', { PISHKAN_LAN_STRICT: 'true', PISHKAN_LAN_FIREWALL_VERIFIED: 'true' })).toBe('127.0.0.1');
    expect(resolveListenHost('0.0.0.0', 'win32', {
      PISHKAN_LAN_STRICT: 'true',
      LAN_ACCESS: 'true', PISHKAN_LAN_FIREWALL_VERIFIED: 'true', PORT: '3000',
      PISHKAN_LAN_FIREWALL_TOKEN: 'token', PISHKAN_LAN_FIREWALL_STATUS_FILE: path.join(os.tmpdir(), 'missing-lease.json'),
    })).toBe('127.0.0.1');
  });

  it('strict mode permits wildcard binding only with an explicit opt-in and a current matching firewall lease', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-firewall-lease-'));
    const leaseFile = path.join(dir, 'lease.json');
    const now = Date.now();
    fs.writeFileSync(leaseFile, JSON.stringify({ ok: true, token: 'lease-token', port: 3000, checkedAt: new Date(now).toISOString() }));
    try {
      const variables = {
        LAN_ACCESS: 'TRUE', PISHKAN_LAN_FIREWALL_VERIFIED: 'true', PORT: '3000',
        PISHKAN_LAN_FIREWALL_PORT: '3000', PISHKAN_LAN_FIREWALL_TOKEN: 'lease-token',
        PISHKAN_LAN_FIREWALL_STATUS_FILE: leaseFile,
      };
      expect(isLanFirewallLeaseValid(leaseFile, 'lease-token', 3000, now)).toBe(true);
      expect(resolveListenHost('0.0.0.0', 'win32', variables, now)).toBe('0.0.0.0');
      expect(resolveListenHost('0.0.0.0', 'win32', { ...variables, LAN_ACCESS: 'false' }, now)).toBe('127.0.0.1');
      expect(isLanFirewallLeaseValid(leaseFile, 'wrong-token', 3000, now)).toBe(false);
      expect(isLanFirewallLeaseValid(leaseFile, 'lease-token', 3001, now)).toBe(false);
      expect(isLanFirewallLeaseValid(leaseFile, 'lease-token', 3000, now + 13_000)).toBe(false);
      fs.writeFileSync(leaseFile, JSON.stringify({ ok: false, token: 'lease-token', port: 3000, checkedAt: new Date(now).toISOString() }));
      expect(isLanFirewallLeaseValid(leaseFile, 'lease-token', 3000, now)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves configured binding behavior on non-Windows platforms', () => {
    expect(resolveListenHost('0.0.0.0', 'linux', {})).toBe('0.0.0.0');
  });
});

describe('safe diagnostics', () => {
  it('redacts connection credentials, callback query values and personal identifiers', () => {
    const output = sanitizeLogText('DATABASE_URL=postgres://operator:db-pass@localhost/pishkan https://gw.example/pay?Authority=secret-authority&paymentId=receipt-123 username=alice full_name=AliceExample mobile=09123456789 id=1234567890 email=user@example.com C:\\Users\\Alice\\Pishkan\\app.log');
    for (const secret of ['db-pass', 'secret-authority', 'receipt-123', 'alice', 'AliceExample', '09123456789', '1234567890', 'user@example.com', 'Alice']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[redacted-mobile]');
    expect(output).toContain('[redacted-id]');
    expect(output).toContain('[redacted-email]');
    expect(output).toContain('[redacted-home]');
  });

  it('sanitizes exception details before they are written to persistent logs', () => {
    const error = new Error('request failed password=super-secret\ncontact=user@example.com');
    const output = safeErrorText(error);
    expect(output).not.toContain('super-secret');
    expect(output).not.toContain('user@example.com');
    expect(output).not.toContain('\n');
  });
});

describe('external payment callback URL validation', () => {
  it('accepts HTTPS public origins and rejects loopback, private networks and non-HTTPS schemes', () => {
    expect(isPublicHttpsUrl('https://payments.office-example.ir')).toBe(true);
    expect(isPublicHttpsUrl('https://8.8.8.8/callback')).toBe(true);
    expect(isPublicHttpsUrl('https://[2001:4860:4860::8888]/callback')).toBe(true);
    expect(isPublicHttpsUrl('https://[2606:4700::1111]/callback')).toBe(true);
    for (const url of [
      'https://[2::1]',
      'https://[4000::1]',
      'https://[ffff::1]',
      'https://[2001::1]',
      'https://[2001:1::1]',
      'https://[2001:2::1]',
      'https://[2001:20::1]',
      'https://[2001:db8::1]',
      'https://[3fff::1]',

      'http://payments.office-example.ir',
      'https://localhost:3000',
      'https://127.0.0.1:3000',
      'https://192.168.1.20:3000',
      'https://10.0.0.20',
      'https://192.0.2.10',
      'https://198.51.100.10',
      'https://203.0.113.10',
      'https://[::1]:3000',
      'https://[::ffff:192.168.1.20]',
      'https://[::ffff:8.8.8.8]',
      'https://[0:0:0:0:0:ffff:808:808]',
      'https://service.local',
      'https://example.com',
      'https://preview.example.com',
      'https://service.onion',
    ]) expect(isPublicHttpsUrl(url), url).toBe(false);
  });
});

describe('LAN address discovery', () => {
  const interfaces = {
    Ethernet: [
      { address: '192.168.1.24', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    WiFi: [
      { address: '10.0.0.7', family: 4 as const, internal: false },
      { address: '8.8.8.8', family: 'IPv4', internal: false },
      { address: '127.0.0.1', family: 'IPv4', internal: true },
    ],
  } as any;

  it('advertises only RFC1918 IPv4 addresses', () => {
    expect(privateLanAddresses(interfaces)).toEqual(['10.0.0.7', '192.168.1.24']);
  });

  it('returns copyable URLs only while the server binds a LAN interface', () => {
    const lan = lanAccessInfo({ host: '0.0.0.0', port: 3000, platform: 'linux', interfaces });
    expect(lan.lanEnabled).toBe(true);
    expect(lan.urls).toEqual(['http://10.0.0.7:3000', 'http://192.168.1.24:3000']);
    expect(lan.urls.every((url) => url.startsWith('http://') && !url.includes('@'))).toBe(true);

    const loopback = lanAccessInfo({ host: '127.0.0.1', port: 3000, platform: 'linux', interfaces });
    expect(loopback.lanEnabled).toBe(false);
    expect(loopback.urls).toEqual([]);
    expect(loopback.note).toContain('همین رایانه');

    const windows = lanAccessInfo({ host: '0.0.0.0', port: 3000, platform: 'win32', interfaces });
    expect(windows.mode).toBe('simple');
    expect(windows.firewallLeaseRequired).toBe(false);
    const windowsStrict = lanAccessInfo({ host: '0.0.0.0', port: 3000, platform: 'win32', interfaces, strict: true });
    expect(windowsStrict.mode).toBe('strict');
    expect(windowsStrict.firewallLeaseRequired).toBe(true);
  });
});
