/**
 * Real SSL certificate expiry probe.
 *
 * Opens a TLS connection to the configured host (or the APP_URL domain) on
 * port 443 and reads the peer certificate's valid_to. No simulation: if the
 * handshake fails or the deployment has no public HTTPS domain yet (local
 * Windows run, bare IP, http APP_URL), the result says "not checkable" with
 * the exact reason instead of pretending a certificate is fine.
 *
 * Results are cached for an hour — the monitoring scheduler ticks every
 * minute and a TLS handshake per tick would be wasteful noise in access logs.
 */
import tls from 'node:tls';
import { env } from '../../env.js';
import { getString } from '../settings/service.js';

export interface SslCheckResult {
  checked: boolean;
  reason?: string;
  host?: string;
  validTo?: string;
  daysLeft?: number;
  /** True only when valid_to is actually in the past (not merely <24h left). */
  expired?: boolean;
  issuer?: string;
  error?: string;
  checkedAt: string;
}

let cache: { at: number; host: string; result: SslCheckResult } | null = null;
const CACHE_MS = 60 * 60_000;

/** Host to probe: explicit setting wins, else the APP_URL hostname. */
export async function sslTargetHost(): Promise<{ host: string | null; reason?: string }> {
  const configured = (await getString('monitoring.ssl_check_host').catch(() => '')).trim();
  if (configured) return { host: configured.replace(/^https?:\/\//, '').replace(/[:/].*$/, '') };
  try {
    const url = new URL(env.appUrl);
    if (url.protocol !== 'https:') {
      return { host: null, reason: 'APP_URL روی http است؛ تا وقتی دامنه و SSL فعال نشده، بررسی گواهی ممکن نیست.' };
    }
    if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      return { host: null, reason: 'نشانی سامانه دامنهٔ عمومی نیست (لوکال/IP)؛ بررسی گواهی پس از اتصال دامنه انجام می‌شود.' };
    }
    return { host: url.hostname };
  } catch {
    return { host: null, reason: 'APP_URL معتبر تنظیم نشده است.' };
  }
}

function probe(host: string, timeoutMs = 8000): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    const checkedAt = new Date().toISOString();
    let settled = false;
    const finish = (result: SslCheckResult) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already closed */ }
      resolve(result);
    };
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) {
          finish({ checked: false, host, checkedAt, error: 'گواهی از سرور دریافت نشد.' });
          return;
        }
        const validTo = new Date(cert.valid_to);
        const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
        finish({
          checked: true, host, checkedAt,
          validTo: validTo.toISOString(), daysLeft,
          expired: validTo.getTime() <= Date.now(),
          issuer: String((cert.issuer as any)?.O ?? (cert.issuer as any)?.CN ?? ''),
        });
      },
    );
    socket.on('timeout', () => finish({ checked: false, host, checkedAt, error: 'اتصال TLS به پورت ۴۴۳ در مهلت مقرر برقرار نشد.' }));
    socket.on('error', (err) => finish({ checked: false, host, checkedAt, error: `خطای اتصال TLS: ${err.message}` }));
  });
}

/** Cached probe; force=true bypasses the cache (manual "check now"). */
export async function checkSslCertificate(force = false): Promise<SslCheckResult> {
  const target = await sslTargetHost();
  if (!target.host) {
    return { checked: false, reason: target.reason, checkedAt: new Date().toISOString() };
  }
  if (!force && cache && cache.host === target.host && Date.now() - cache.at < CACHE_MS) {
    return cache.result;
  }
  const result = await probe(target.host);
  cache = { at: Date.now(), host: target.host, result };
  return result;
}

/** Test seam: drop the cache so a new host/setting is probed immediately. */
export function resetSslCache() { cache = null; }
