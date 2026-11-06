import fs from 'node:fs';
import os from 'node:os';

const MAX_FIREWALL_LEASE_AGE_MS = 12_000;

/**
 * Read the short-lived firewall proof written by the Windows launcher watchdog.
 * This is deliberately platform-neutral so the API can fail closed without
 * containing PowerShell or Windows Firewall logic itself.
 */
export function isLanFirewallLeaseValid(
  filePath: string | undefined,
  token: string | undefined,
  port: number,
  now = Date.now(),
  maxAgeMs = MAX_FIREWALL_LEASE_AGE_MS,
): boolean {
  if (!filePath || !token || !Number.isInteger(port) || port < 1 || port > 65535) return false;
  try {
    const lease = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      ok?: unknown; token?: unknown; port?: unknown; checkedAt?: unknown;
    };
    if (lease?.ok !== true || lease.token !== token || Number(lease.port) !== port || typeof lease.checkedAt !== 'string') return false;
    const checkedAt = Date.parse(lease.checkedAt);
    return Number.isFinite(checkedAt) && checkedAt <= now + 2_000 && now - checkedAt <= maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Strict LAN mode (opt-in via PISHKAN_LAN_STRICT=true): the original
 * fail-closed behaviour where a wildcard bind on Windows requires the
 * launcher's continuously refreshed firewall lease. Simple mode (default)
 * trusts the installer's explicit LAN_ACCESS choice and treats the firewall
 * rule as best-effort, so a phone on the office Wi-Fi works regardless of
 * firewall profiles/elevation — authentication is still always required.
 */
export function isLanStrictMode(variables: NodeJS.ProcessEnv = process.env): boolean {
  return variables.PISHKAN_LAN_STRICT?.trim().toLowerCase() === 'true';
}

/**
 * Windows must never bind a wildcard interface by accident. LAN exposure stays
 * an explicit installer opt-in (HOST=0.0.0.0 + LAN_ACCESS=true). In strict mode
 * it only becomes effective while the launcher keeps refreshing a verified
 * firewall lease; in the default simple mode the opt-in alone is enough.
 * Other platforms retain their configured HOST behavior exactly.
 */
export function resolveListenHost(
  configuredHost: string,
  platform: NodeJS.Platform = process.platform,
  variables: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string {
  if (platform !== 'win32') return configuredHost;
  const normalizedHost = configuredHost.trim().toLowerCase();
  const lanOptIn = variables.LAN_ACCESS?.trim().toLowerCase() === 'true' && normalizedHost === '0.0.0.0';
  if (!lanOptIn) return '127.0.0.1';
  if (!isLanStrictMode(variables)) return '0.0.0.0';
  const port = Number(variables.PISHKAN_LAN_FIREWALL_PORT ?? variables.PORT);
  const verifiedLanOptIn = variables.PISHKAN_LAN_FIREWALL_VERIFIED?.trim().toLowerCase() === 'true'
    && isLanFirewallLeaseValid(
      variables.PISHKAN_LAN_FIREWALL_STATUS_FILE,
      variables.PISHKAN_LAN_FIREWALL_TOKEN,
      port,
      now,
    );
  return verifiedLanOptIn ? '0.0.0.0' : '127.0.0.1';
}

const PRIVATE_IPV4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** RFC1918 IPv4 detection; public, loopback and link-local addresses are excluded. */
export function isPrivateIpv4(address: string): boolean {
  const parts = String(address ?? '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return PRIVATE_IPV4.some((pattern) => pattern.test(address))
    && !address.startsWith('127.') && !address.startsWith('169.254.');
}

/** Private LAN addresses of this host, for the copyable mobile URL. */
export function privateLanAddresses(interfaces = os.networkInterfaces()): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && (entry.family as unknown) !== 4) continue;
      if (isPrivateIpv4(entry.address)) found.add(entry.address);
    }
  }
  return [...found].sort();
}

/**
 * What the admin panel may show about LAN access. Only private addresses are
 * advertised and no token/credential is ever part of the URL.
 */
export function lanAccessInfo(options: {
  host: string; port: number; platform?: NodeJS.Platform; interfaces?: Record<string, any>; strict?: boolean;
} = { host: '127.0.0.1', port: 3000 }) {
  const platform = options.platform ?? process.platform;
  const strict = options.strict ?? isLanStrictMode();
  const exposed = String(options.host ?? '').trim().toLowerCase() === '0.0.0.0';
  const urls = exposed && Number.isInteger(options.port) && options.port > 0 && options.port <= 65535
    ? privateLanAddresses(options.interfaces ?? os.networkInterfaces()).map((address) => `http://${address}:${options.port}`)
    : [];
  return {
    platform,
    host: options.host,
    port: options.port,
    lanEnabled: exposed,
    urls,
    mode: strict ? 'strict' : 'simple',
    // Only strict mode requires the verified firewall lease before binding.
    firewallLeaseRequired: strict && platform === 'win32',
    note: exposed
      ? 'این آدرس‌ها فقط در شبکهٔ خصوصی (LAN/Wi‑Fi) همان مکان معتبرند و ورود با نام کاربری الزامی است. اگر گوشی وصل نشد، در Pishkan Manager دکمهٔ «باز کردن فایروال برای موبایل» را بزنید.'
      : 'سرویس فقط روی همین رایانه در دسترس است؛ برای دسترسی موبایل، LAN را از مدیر/نصب‌کننده فعال کنید.',
  };
}
