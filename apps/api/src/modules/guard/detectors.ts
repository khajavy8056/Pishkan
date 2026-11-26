/**
 * Sliding-window detectors.
 *
 * Counters live in process memory (the documented deployment is a single API
 * process). Each detector counts events per IP inside guard.window_seconds;
 * crossing the configured threshold raises one alarm and then stays quiet for
 * the same window so a burst cannot flood the event table or SMS budget.
 */
import { getBool, getNumber } from '../settings/service.js';
import { normalizeIp, raiseAlarm, type GuardSeverity } from './service.js';

type CounterKind = 'auth_fail' | 'forbidden' | 'notfound' | 'rate_abuse' | 'upload_reject';

interface Bucket { stamps: number[]; alarmedAt: number }
const counters = new Map<CounterKind, Map<string, Bucket>>();
const MAX_IPS_PER_KIND = 10_000;

export function resetDetectors() { counters.clear(); }

function bucketFor(kind: CounterKind, ip: string): Bucket {
  let byIp = counters.get(kind);
  if (!byIp) { byIp = new Map(); counters.set(kind, byIp); }
  let bucket = byIp.get(ip);
  if (!bucket) {
    if (byIp.size >= MAX_IPS_PER_KIND) {
      const oldest = byIp.keys().next().value as string | undefined;
      if (oldest !== undefined) byIp.delete(oldest);
    }
    bucket = { stamps: [], alarmedAt: 0 };
    byIp.set(ip, bucket);
  }
  return bucket;
}

interface DetectionSpec {
  kind: CounterKind;
  eventKind: string;
  thresholdKey: string;
  severity: GuardSeverity;
  blockable: boolean;
  message: (ip: string, count: number) => string;
}

const SPECS: Record<CounterKind, DetectionSpec> = {
  auth_fail: {
    kind: 'auth_fail', eventKind: 'auth_bruteforce', thresholdKey: 'guard.auth_fail_threshold',
    severity: 'critical', blockable: true,
    message: (ip, n) => `${n} تلاش ورود ناموفق از ${ip} — الگوی حملهٔ جست‌وجوی رمز (Brute Force).`,
  },
  forbidden: {
    kind: 'forbidden', eventKind: 'forbidden_burst', thresholdKey: 'guard.forbidden_threshold',
    severity: 'warning', blockable: true,
    message: (ip, n) => `${n} درخواست غیرمجاز (403) از ${ip} — تلاش برای دسترسی به بخش‌های بدون مجوز.`,
  },
  notfound: {
    kind: 'notfound', eventKind: 'path_scan', thresholdKey: 'guard.notfound_threshold',
    severity: 'warning', blockable: true,
    message: (ip, n) => `${n} درخواست به مسیر ناموجود (404) از ${ip} — الگوی پویشگر/اسکنر آسیب‌پذیری.`,
  },
  rate_abuse: {
    kind: 'rate_abuse', eventKind: 'rate_abuse', thresholdKey: 'guard.rate_abuse_threshold',
    severity: 'warning', blockable: true,
    message: (ip, n) => `${n} بار محدودیت نرخ برای ${ip} شکسته شد — سوءاستفادهٔ پرتعداد از API.`,
  },
  upload_reject: {
    kind: 'upload_reject', eventKind: 'upload_attack', thresholdKey: 'guard.upload_reject_threshold',
    severity: 'critical', blockable: true,
    message: (ip, n) => `${n} آپلود ردشده از ${ip} — تلاش برای بارگذاری فایل غیرمجاز/مخرب.`,
  },
};

async function observe(kind: CounterKind, ipRaw: string | null | undefined, context: Record<string, unknown> = {}): Promise<void> {
  const ip = normalizeIp(ipRaw);
  if (!ip) return;
  if (!(await getBool('guard.enabled'))) return;
  const spec = SPECS[kind];
  const windowMs = (await getNumber('guard.window_seconds')) * 1000;
  const threshold = await getNumber(spec.thresholdKey);
  const now = Date.now();
  const bucket = bucketFor(kind, ip);
  bucket.stamps = bucket.stamps.filter((t) => now - t < windowMs);
  bucket.stamps.push(now);
  if (bucket.stamps.length < threshold) return;
  if (now - bucket.alarmedAt < windowMs) return; // one alarm per window
  bucket.alarmedAt = now;
  bucket.stamps = [];
  await raiseAlarm({
    severity: spec.severity,
    kind: spec.eventKind,
    sourceIp: ip,
    message: spec.message(ip, threshold),
    details: { count: threshold, windowSeconds: Math.round(windowMs / 1000), ...context },
    blockable: spec.blockable,
  });
}

/** Failed password/OTP/MFA attempt — hooked from auth.logLogin. */
export function observeAuthFailure(ip: string | null | undefined, identifier: string, method: string): void {
  void observe('auth_fail', ip, { identifier: String(identifier).slice(0, 60), method });
}

/** HTTP-level signals — hooked from the error handler / rate limiter. */
export function observeHttpStatus(status: number, ip: string | null | undefined, path: string, method: string): void {
  if (status === 403) void observe('forbidden', ip, { path: path.slice(0, 200), method });
  else if (status === 404) void observe('notfound', ip, { path: path.slice(0, 200), method });
  else if (status === 429) void observe('rate_abuse', ip, { path: path.slice(0, 200), method });
}

/** Rejected upload (bad extension/signature/active content). */
export function observeUploadRejection(ip: string | null | undefined, reason: string, filename: string): void {
  void observe('upload_reject', ip, { reason: String(reason).slice(0, 200), filename: String(filename).slice(0, 120) });
}

/** Suspicious single request to a known exploit path — immediate warning. */
const EXPLOIT_PATH = /(\.env($|\.)|\.git\/|wp-login|wp-admin|xmlrpc\.php|phpmyadmin|\/vendor\/phpunit|eval-stdin\.php|\.aws\/|id_rsa|shell\.(php|jsp)|cgi-bin\/|boaform\/|HNAP1\/)/i;

/**
 * True for known-sensitive probe paths. The static/SPA layer uses this to
 * answer 404 instead of masking the probe with a 200 index.html — a built
 * frontend must never make `/.env` or `/.git/config` look like a valid page.
 */
export function isExploitPath(path: string): boolean {
  return EXPLOIT_PATH.test(path);
}

export function observeRequestPath(ip: string | null | undefined, path: string, method: string): void {
  if (!EXPLOIT_PATH.test(path)) return;
  void (async () => {
    if (!(await getBool('guard.enabled'))) return;
    await raiseAlarm({
      severity: 'warning', kind: 'exploit_probe', sourceIp: normalizeIp(ip),
      method, path: path.slice(0, 300),
      message: `درخواست به مسیر شناخته‌شدهٔ حمله (${path.slice(0, 120)}) رد شد.`,
      details: { path: path.slice(0, 300) },
      blockable: false,
    });
  })();
}
