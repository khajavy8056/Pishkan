/**
 * Takh Pishkhan Guard — core.
 *
 * Records security events, keeps reversible temporary IP blocks, and answers
 * the admin dashboard. Hard safety rules (mission §5.4):
 *   - loopback and configured trusted IPs are NEVER auto-blocked;
 *   - private/LAN IPs are not blocked unless explicitly allowed;
 *   - authenticated staff/admin sessions bypass IP blocks by default, so the
 *     main administrator can never be locked out by the guard itself;
 *   - every action is time-limited, audited and reversible; nothing is deleted.
 */
import { isIP } from 'node:net';
import { q, one, run, nowIso, jsonStringify, jsonParse } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { env } from '../../env.js';
import { badRequest, notFound } from '../../http/errors.js';
import { getBool, getNumber, getString, getJson } from '../settings/service.js';
import { logEvent } from '../logging/service.js';
import { writeAudit } from '../audit/service.js';
import type { AuthContext } from '../auth/types.js';

export type GuardSeverity = 'info' | 'warning' | 'critical';

export interface GuardEventInput {
  severity: GuardSeverity;
  kind: string;
  message: string;
  sourceIp?: string | null;
  userId?: string | null;
  method?: string | null;
  path?: string | null;
  details?: Record<string, unknown>;
  actionTaken?: string | null;
}

export interface GuardEventRow {
  id: string;
  created_at: string;
  severity: GuardSeverity;
  kind: string;
  source_ip: string | null;
  user_id: string | null;
  method: string | null;
  path: string | null;
  message: string;
  details: string | null;
  action_taken: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export interface GuardBlockRow {
  id: string;
  ip: string;
  reason: string;
  event_id: string | null;
  created_at: string;
  expires_at: string;
  created_by: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

const SEVERITY_RANK: Record<GuardSeverity, number> = { info: 1, warning: 2, critical: 3 };
export function severityAtLeast(a: GuardSeverity, b: GuardSeverity): boolean {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b];
}

/* ------------------------------- IP helpers ------------------------------- */

export function normalizeIp(ip: string | null | undefined): string {
  const value = String(ip ?? '').trim();
  // Express reports IPv4 through the IPv6 stack as ::ffff:a.b.c.d
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

export function isLoopbackIp(ip: string): boolean {
  const v = normalizeIp(ip).toLowerCase();
  return v === '127.0.0.1' || v === '::1' || v.startsWith('127.') || v === 'localhost';
}

export function isPrivateIp(ip: string): boolean {
  const v = normalizeIp(ip).toLowerCase();
  if (isLoopbackIp(v)) return true;
  if (v.includes(':')) {
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v === '::';
  }
  const parts = v.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

async function trustedIpSet(): Promise<Set<string>> {
  const configured = await getString('guard.trusted_ips');
  return new Set(configured.split(',').map((s) => normalizeIp(s)).filter(Boolean));
}

/** Auto-block may never target loopback, trusted, or (by default) LAN IPs. */
export async function canAutoBlock(ip: string): Promise<boolean> {
  const v = normalizeIp(ip);
  if (!v || !isIP(v)) return false;
  if (isLoopbackIp(v)) return false;
  if ((await trustedIpSet()).has(v)) return false;
  if (isPrivateIp(v) && !(await getBool('guard.block_private_ips'))) return false;
  return true;
}

/* --------------------------------- events --------------------------------- */

export async function recordEvent(input: GuardEventInput): Promise<GuardEventRow> {
  const eventId = id('gev');
  const ts = nowIso();
  await run(
    `INSERT INTO guard_events (id, created_at, severity, kind, source_ip, user_id, method, path, message, details, action_taken)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId, ts, input.severity, input.kind,
      input.sourceIp ? normalizeIp(input.sourceIp) : null,
      input.userId ?? null, input.method ?? null,
      input.path ? String(input.path).slice(0, 300) : null,
      input.message.slice(0, 1000),
      input.details ? jsonStringify(input.details) : null,
      input.actionTaken ?? null,
    ],
  );
  void logEvent({
    level: 'SECURITY', category: 'security', action: `guard.${input.kind}`,
    result: input.severity === 'info' ? 'success' : 'denied',
    ip: input.sourceIp ?? undefined, requestId: undefined,
    message: input.message, details: { eventId, kind: input.kind, severity: input.severity, ...(input.details ?? {}) },
  });
  return (await one<GuardEventRow>('SELECT * FROM guard_events WHERE id = ?', [eventId]))!;
}

export async function listEvents(options: { limit?: number; kind?: string; severity?: string; ip?: string; unacknowledged?: boolean } = {}) {
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 500);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.kind) { clauses.push('kind = ?'); params.push(options.kind); }
  if (options.severity) { clauses.push('severity = ?'); params.push(options.severity); }
  if (options.ip) { clauses.push('source_ip = ?'); params.push(normalizeIp(options.ip)); }
  if (options.unacknowledged) clauses.push('acknowledged_at IS NULL');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await q<GuardEventRow>(`SELECT * FROM guard_events ${where} ORDER BY created_at DESC LIMIT ?`, [...params, limit]);
  return rows.map((r) => ({ ...r, details: r.details ? jsonParse(r.details, {}) : {} }));
}

export async function acknowledgeEvent(eventId: string, actor: { id: string; name: string; ip?: string }) {
  const row = await one<GuardEventRow>('SELECT * FROM guard_events WHERE id = ?', [eventId]);
  if (!row) throw notFound('رویداد یافت نشد.');
  await run('UPDATE guard_events SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?', [nowIso(), actor.id, eventId]);
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'guard.event.ack', entityType: 'guard_event', entityId: eventId, ip: actor.ip });
  return { id: eventId, acknowledged: true };
}

/* --------------------------------- blocks --------------------------------- */

let blockCache: { at: number; ips: Map<string, string> } | null = null;
const BLOCK_CACHE_MS = 5_000;

export function invalidateBlockCache() { blockCache = null; }

async function activeBlockMap(): Promise<Map<string, string>> {
  if (blockCache && Date.now() - blockCache.at < BLOCK_CACHE_MS) return blockCache.ips;
  const rows = await q<{ ip: string; expires_at: string }>(
    'SELECT ip, expires_at FROM guard_blocks WHERE revoked_at IS NULL AND expires_at > ?', [nowIso()],
  );
  const ips = new Map(rows.map((r) => [normalizeIp(r.ip), r.expires_at]));
  blockCache = { at: Date.now(), ips };
  return ips;
}

/** Hot path: is this IP currently blocked? Returns expiry ISO or null. */
export async function blockedUntil(ip: string | null | undefined): Promise<string | null> {
  const v = normalizeIp(ip);
  if (!v || isLoopbackIp(v)) return null;
  if (!(await getBool('guard.enabled'))) return null;
  return (await activeBlockMap()).get(v) ?? null;
}

export async function blockIp(input: { ip: string; reason: string; minutes?: number; actor: { id: string; name: string; ip?: string }; eventId?: string; manual?: boolean }) {
  const ip = normalizeIp(input.ip);
  if (!isIP(ip)) throw badRequest('IP معتبر نیست.');
  if (isLoopbackIp(ip)) throw badRequest('مسدودسازی loopback مجاز نیست.');
  if (!input.manual && !(await canAutoBlock(ip))) throw badRequest('این IP در فهرست مورد اعتماد است و مسدود نمی‌شود.');
  const minutes = Math.min(Math.max(Number(input.minutes ?? await getNumber('guard.block_minutes')), 1), 1440);
  const existing = await one<GuardBlockRow>(
    'SELECT * FROM guard_blocks WHERE ip = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1', [ip, nowIso()],
  );
  if (existing) {
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    await run('UPDATE guard_blocks SET expires_at = ? WHERE id = ?', [expiresAt, existing.id]);
    invalidateBlockCache();
    return { ...existing, expires_at: expiresAt, extended: true };
  }
  const blockId = id('gbl');
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  await run(
    `INSERT INTO guard_blocks (id, ip, reason, event_id, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [blockId, ip, input.reason.slice(0, 300), input.eventId ?? null, ts, expiresAt, input.actor.id],
  );
  invalidateBlockCache();
  await writeAudit({
    actorId: input.actor.id, actorName: input.actor.name, action: 'guard.ip.block',
    entityType: 'guard_block', entityId: blockId,
    after: { ip, reason: input.reason, expiresAt }, ip: input.actor.ip,
  });
  return (await one<GuardBlockRow>('SELECT * FROM guard_blocks WHERE id = ?', [blockId]))!;
}

export async function unblockIp(blockId: string, actor: { id: string; name: string; ip?: string }) {
  const row = await one<GuardBlockRow>('SELECT * FROM guard_blocks WHERE id = ?', [blockId]);
  if (!row) throw notFound('مسدودسازی یافت نشد.');
  await run('UPDATE guard_blocks SET revoked_at = ?, revoked_by = ? WHERE id = ?', [nowIso(), actor.id, blockId]);
  invalidateBlockCache();
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'guard.ip.unblock', entityType: 'guard_block', entityId: blockId, before: { ip: row.ip }, ip: actor.ip });
  return { id: blockId, revoked: true };
}

export async function listBlocks(includeExpired = false) {
  const where = includeExpired ? '' : 'WHERE revoked_at IS NULL AND expires_at > ?';
  const rows = await q<GuardBlockRow>(`SELECT * FROM guard_blocks ${where} ORDER BY created_at DESC LIMIT 200`, includeExpired ? [] : [nowIso()]);
  return rows;
}

/* ------------------------------ auto response ------------------------------ */

/**
 * Called by detectors when a threshold fires. Records the event, optionally
 * blocks the source IP (reversible, time-limited) and hands the event to the
 * notification layer. Never throws into the request path.
 */
export async function raiseAlarm(input: GuardEventInput & { blockable?: boolean }): Promise<void> {
  try {
    if (!(await getBool('guard.enabled'))) return;
    let actionTaken: string | null = null;
    let event = await recordEvent(input);
    if (input.blockable && input.sourceIp && (await getBool('guard.auto_block_enabled')) && (await canAutoBlock(input.sourceIp))) {
      const block = await blockIp({
        ip: input.sourceIp,
        reason: input.message,
        actor: { id: 'guard', name: 'گارد تک پیشخوان' },
        eventId: event.id,
      });
      actionTaken = 'blocked';
      await run('UPDATE guard_events SET action_taken = ? WHERE id = ?', [actionTaken, event.id]);
      event = { ...event, action_taken: actionTaken };
      void logEvent({
        level: 'SECURITY', category: 'security', action: 'guard.ip.auto_blocked', result: 'denied',
        ip: input.sourceIp, message: `IP ${normalizeIp(input.sourceIp)} تا ${block.expires_at} مسدود شد.`,
        details: { eventId: event.id, blockId: block.id },
      });
    }
    const { notifyGuardEvent } = await import('./response.js');
    await notifyGuardEvent(event);
  } catch (error) {
    void logEvent({
      level: 'WARNING', category: 'security', action: 'guard.alarm_failed', result: 'failure',
      message: 'ثبت/واکنش رویداد امنیتی ناموفق بود.',
      details: { error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) },
    });
  }
}

/* --------------------------------- posture --------------------------------- */

export interface PostureItem {
  key: string;
  title: string;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
  detail: string;
}

export async function securityPosture(): Promise<PostureItem[]> {
  const items: PostureItem[] = [];
  const appUrl = env.appUrl;
  const https = appUrl.startsWith('https://');
  items.push({
    key: 'tls', title: 'HTTPS و کوکی امن',
    status: env.isProd ? (https && env.cookieSecure ? 'ok' : 'critical') : 'unknown',
    detail: env.isProd
      ? (https && env.cookieSecure ? 'APP_URL روی HTTPS و کوکی‌ها Secure هستند.' : 'در تولید، APP_URL باید https و COOKIE_SECURE=true باشد.')
      : 'محیط توسعه/آزمون؛ وضعیت TLS سرور واقعی از اینجا قابل تعیین نیست.',
  });
  items.push({
    key: 'database', title: 'موتور پایگاه داده',
    status: env.isProd ? (env.dbDriver === 'postgres' ? 'ok' : 'critical') : 'ok',
    detail: env.dbDriver === 'postgres' ? 'PostgreSQL (موتور عملیاتی).' : 'SQLite — فقط توسعه/آزمون؛ تولید باید PostgreSQL باشد.',
  });
  items.push({
    key: 'encryption', title: 'کلید رمزنگاری اسرار',
    status: env.encryptionKey && env.encryptionKey.length >= 32 ? 'ok' : (env.isProd ? 'critical' : 'warning'),
    detail: env.encryptionKey && env.encryptionKey.length >= 32
      ? 'APP_ENCRYPTION_KEY تنظیم شده است (۳۲+ کاراکتر).'
      : 'کلید رمزنگاری تنظیم نشده؛ اعتبارنامه‌های اتصال با کلید ناامن توسعه رمز می‌شوند.',
  });
  items.push({
    key: 'demo', title: 'حالت نمایشی',
    status: env.demoMode ? 'warning' : 'ok',
    detail: env.demoMode ? 'DEMO_MODE روشن است؛ برای بهره‌برداری خاموش کنید.' : 'DEMO_MODE خاموش است.',
  });
  const guardOn = await getBool('guard.enabled');
  items.push({
    key: 'guard', title: 'گارد تک پیشخوان',
    status: guardOn ? 'ok' : 'warning',
    detail: guardOn ? 'تشخیص و واکنش فعال است.' : 'گارد خاموش است؛ تشخیص حمله انجام نمی‌شود.',
  });
  const ipBind = await getBool('security.bind_session_to_ip');
  items.push({
    key: 'session_bind', title: 'اتصال نشست به IP',
    status: ipBind ? 'ok' : 'warning',
    detail: ipBind ? 'نشست‌ها به IP ورود مقید هستند.' : 'اختیاری: security.bind_session_to_ip ربایش نشست را سخت‌تر می‌کند (با موبایل‌های در حال تغییر IP سازگار نیست).',
  });
  // .env permissions (production hardening)
  try {
    const fs = await import('node:fs');
    const envFile = process.env.PISHKAN_ENV_FILE || '.env';
    if (fs.existsSync(envFile)) {
      const mode = fs.statSync(envFile).mode & 0o777;
      const worldReadable = (mode & 0o004) !== 0;
      items.push({
        key: 'env_file', title: 'دسترسی فایل تنظیمات',
        status: worldReadable ? 'critical' : 'ok',
        detail: worldReadable ? `فایل ${envFile} برای همه قابل خواندن است (mode ${mode.toString(8)}). باید 0640 یا سخت‌تر باشد.` : `دسترسی فایل تنظیمات محدود است (mode ${mode.toString(8)}).`,
      });
    } else {
      items.push({ key: 'env_file', title: 'دسترسی فایل تنظیمات', status: 'unknown', detail: 'فایل .env در مسیر کاری پیدا نشد (ممکن است از environment سرویس تزریق شود).' });
    }
  } catch {
    items.push({ key: 'env_file', title: 'دسترسی فایل تنظیمات', status: 'unknown', detail: 'بررسی دسترسی فایل ممکن نشد.' });
  }
  // backup freshness
  const lastBackup = await one<{ created_at: string }>("SELECT created_at FROM backups WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1");
  const maxAgeHours = await getNumber('monitoring.alert_backup_age_hours');
  if (!lastBackup) {
    items.push({ key: 'backup', title: 'تازگی پشتیبان', status: 'warning', detail: 'هنوز بکاپ موفقی ثبت نشده است.' });
  } else {
    const ageHours = (Date.now() - new Date(lastBackup.created_at).getTime()) / 3_600_000;
    items.push({
      key: 'backup', title: 'تازگی پشتیبان',
      status: ageHours <= maxAgeHours ? 'ok' : 'warning',
      detail: `آخرین بکاپ موفق ${Math.round(ageHours)} ساعت پیش (${lastBackup.created_at}).`,
    });
  }
  const externalOn = await getBool('backup.external_enabled');
  items.push({
    key: 'backup_external', title: 'پشتیبان خارج از سرور',
    status: externalOn ? 'ok' : 'warning',
    detail: externalOn ? 'انتقال به مقصد خارجی فعال است.' : 'بکاپ فقط روی همین سرور است؛ مقصد خارجی (SFTP/FTP/Google Drive) تنظیم کنید.',
  });
  // last scans
  for (const kind of ['integrity', 'uploads', 'deps'] as const) {
    const scan = await one<{ status: string; started_at: string; summary: string | null }>(
      'SELECT status, started_at, summary FROM guard_scans WHERE kind = ? ORDER BY started_at DESC LIMIT 1', [kind],
    );
    const titles: Record<string, string> = { integrity: 'اسکن یکپارچگی فایل‌ها', uploads: 'اسکن آپلودها', deps: 'بررسی وابستگی‌ها' };
    if (!scan) {
      items.push({ key: `scan_${kind}`, title: titles[kind], status: 'unknown', detail: 'هنوز اجرایی نشده است.' });
    } else {
      const summary = scan.summary ? jsonParse<Record<string, unknown>>(scan.summary, {}) : {};
      const problems = Number(summary.findings ?? summary.vulnerable ?? 0);
      items.push({
        key: `scan_${kind}`, title: titles[kind],
        status: scan.status === 'failed' ? 'warning' : problems > 0 ? 'warning' : 'ok',
        detail: `آخرین اجرا ${scan.started_at} — وضعیت ${scan.status}${problems ? `، ${problems} یافته` : ''}.`,
      });
    }
  }
  return items;
}

export async function guardOverview() {
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const counts = await q<{ severity: string; c: number }>(
    'SELECT severity, COUNT(*) AS c FROM guard_events WHERE created_at >= ? GROUP BY severity', [dayAgo],
  );
  const bySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 };
  for (const row of counts) bySeverity[row.severity] = Number(row.c);
  const failedLogins = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM login_events WHERE success = 0 AND created_at >= ?', [dayAgo],
  );
  const blocks = await listBlocks();
  const openCritical = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM guard_events WHERE severity = 'critical' AND acknowledged_at IS NULL",
  );
  const lastScans: Record<string, unknown> = {};
  for (const kind of ['integrity', 'uploads', 'deps']) {
    lastScans[kind] = await one('SELECT id, status, started_at, finished_at, summary FROM guard_scans WHERE kind = ? ORDER BY started_at DESC LIMIT 1', [kind]);
  }
  return {
    generatedAt: nowIso(),
    enabled: await getBool('guard.enabled'),
    events24h: bySeverity,
    failedLogins24h: Number(failedLogins?.c ?? 0),
    activeBlocks: blocks.length,
    openCritical: Number(openCritical?.c ?? 0),
    posture: await securityPosture(),
    recentEvents: await listEvents({ limit: 12 }),
    lastScans,
  };
}

/* --------------------------------- state ---------------------------------- */

export async function getState<T>(key: string, fallback: T): Promise<T> {
  const row = await one<{ value: string }>('SELECT value FROM guard_state WHERE key = ?', [key]);
  if (!row) return fallback;
  return jsonParse<T>(row.value, fallback);
}

export async function setState(key: string, value: unknown): Promise<void> {
  await run(
    `INSERT INTO guard_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, jsonStringify(value), nowIso()],
  );
}

export async function pruneGuardData(): Promise<{ events: number; blocks: number }> {
  const days = await getNumber('guard.event_retention_days');
  const cutoff = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
  const events = await run('DELETE FROM guard_events WHERE created_at < ?', [cutoff]);
  const blocks = await run('DELETE FROM guard_blocks WHERE expires_at < ? AND revoked_at IS NOT NULL', [cutoff]);
  return { events: events.changes, blocks: blocks.changes };
}

/** Staff/admin exemption used by the block middleware. */
export async function isExemptAuth(auth: AuthContext | undefined): Promise<boolean> {
  if (!auth) return false;
  if (!(await getBool('guard.never_block_staff'))) return false;
  return auth.user.kind === 'staff' || auth.user.kind === 'admin';
}
