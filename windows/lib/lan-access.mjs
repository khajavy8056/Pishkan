import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const RFC1918 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

export function isPrivateLanIPv4(address) {
  const parts = String(address ?? '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return RFC1918.some((pattern) => pattern.test(address))
    && !address.startsWith('127.')
    && !address.startsWith('169.254.');
}

/** Return only RFC1918 IPv4 addresses; never advertise a public or link-local IP. */
export function privateLanIPv4Addresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = new Set();
  for (const entries of Object.values(networkInterfaces ?? {})) {
    for (const entry of entries ?? []) {
      const family = entry.family;
      if (entry.internal || (family !== 'IPv4' && family !== 4) || !isPrivateLanIPv4(entry.address)) continue;
      addresses.add(entry.address);
    }
  }
  return [...addresses].sort((a, b) => {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < 4; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
    return 0;
  });
}

export function privateLanUrls(port, networkInterfaces = os.networkInterfaces()) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) return [];
  return privateLanIPv4Addresses(networkInterfaces).map((address) => `http://${address}:${safePort}`);
}

/** Installer config is loopback-only by default; only an explicit checkbox/answer enables LAN. */
export function resolveLanAccess(requested, existingEnv = {}) {
  const enabled = typeof requested === 'boolean'
    ? requested
    : String(existingEnv.LAN_ACCESS ?? '').toLowerCase() === 'true';
  return {
    enabled,
    host: enabled ? '0.0.0.0' : '127.0.0.1',
    value: enabled ? 'true' : 'false',
  };
}

export function isSafeWindowsBindConfig(host, lanAccess) {
  const normalizedHost = String(host ?? '').trim().toLowerCase();
  if (lanAccess) return normalizedHost === '0.0.0.0';
  return ['127.0.0.1', 'localhost', '::1'].includes(normalizedHost);
}

/** Stable, filesystem-independent name for this install's two firewall rules. */
export function firewallRuleName(root) {
  const normalized = path.resolve(String(root ?? '.')).replace(/\\/g, '/').toLowerCase();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return `PishkanLAN_${digest}`;
}
