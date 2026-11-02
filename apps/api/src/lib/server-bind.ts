import fs from 'node:fs';

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
 * Windows must never bind a wildcard interface by accident. LAN exposure is
 * opt-in in the installer and only becomes effective while the launcher keeps
 * refreshing a verified firewall lease. Other platforms retain their configured
 * HOST behavior exactly.
 */
export function resolveListenHost(
  configuredHost: string,
  platform: NodeJS.Platform = process.platform,
  variables: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string {
  if (platform !== 'win32') return configuredHost;
  const normalizedHost = configuredHost.trim().toLowerCase();
  const port = Number(variables.PISHKAN_LAN_FIREWALL_PORT ?? variables.PORT);
  const verifiedLanOptIn = variables.LAN_ACCESS?.trim().toLowerCase() === 'true'
    && variables.PISHKAN_LAN_FIREWALL_VERIFIED?.trim().toLowerCase() === 'true'
    && normalizedHost === '0.0.0.0'
    && isLanFirewallLeaseValid(
      variables.PISHKAN_LAN_FIREWALL_STATUS_FILE,
      variables.PISHKAN_LAN_FIREWALL_TOKEN,
      port,
      now,
    );
  return verifiedLanOptIn ? '0.0.0.0' : '127.0.0.1';
}
