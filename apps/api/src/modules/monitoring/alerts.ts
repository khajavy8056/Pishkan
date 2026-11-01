/**
 * Operational alerting.
 *
 * Conditions are evaluated against real measurements (database probe, disk,
 * memory, API window counters, payment rows, login events, wallet integrity).
 * Nothing here is simulated: an alert only appears when the underlying query
 * actually crosses the configured threshold.
 */
import fs from 'node:fs';
import { one, q, run, nowIso, jsonStringify } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { env } from '../../env.js';
import { getBool, getNumber } from '../settings/service.js';
import { notifyRole } from '../notifications/service.js';
import { logEvent } from '../logging/service.js';
import { diskSnapshot, dbLatency, memorySnapshot, requestStats } from './metrics.js';
import { providerReadiness } from '../payments/providers.js';
import { walletIntegrity } from '../wallet/service.js';

export type Severity = 'info' | 'warning' | 'critical';

export interface Detection {
  key: string;
  severity: Severity;
  category: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Gather every violated condition right now. */
export async function detectConditions(): Promise<{ detections: Detection[]; checks: Record<string, unknown> }> {
  const detections: Detection[] = [];
  const checks: Record<string, unknown> = {};

  // 1. database
  const db = await dbLatency();
  checks.database = db;
  if (!db.ok) {
    detections.push({
      key: 'database.unavailable', severity: 'critical', category: 'database',
      title: 'قطع ارتباط با پایگاه داده',
      message: 'آزمایش اتصال پایگاه داده ناموفق بود؛ سامانه نمی‌تواند داده‌ها را بخواند.',
      metadata: { latencyMs: db.ms },
    });
  } else if (db.ms > 1000) {
    detections.push({
      key: 'database.slow', severity: 'warning', category: 'database',
      title: 'کندی پایگاه داده',
      message: `زمان پاسخ آزمایشی پایگاه داده ${db.ms} میلی‌ثانیه است.`,
      metadata: { latencyMs: db.ms },
    });
  }

  // 2. API traffic
  const stats = requestStats();
  checks.api = stats.window;
  const errorThreshold = await getNumber('monitoring.alert_error_rate_percent');
  if (stats.window.requests >= 10 && stats.window.errorRatePercent >= errorThreshold) {
    detections.push({
      key: 'api.error_rate', severity: 'critical', category: 'api',
      title: 'افزایش نرخ خطای API',
      message: `نرخ خطا ${stats.window.errorRatePercent}٪ در ${stats.window.requests} درخواست پنج دقیقه اخیر (آستانه ${errorThreshold}٪).`,
      metadata: stats.window,
    });
  }
  const latencyThreshold = await getNumber('monitoring.alert_latency_ms');
  if (stats.window.requests >= 10 && stats.window.p95Ms >= latencyThreshold) {
    detections.push({
      key: 'api.latency', severity: 'warning', category: 'api',
      title: 'کندی پاسخ‌گویی API',
      message: `صدک ۹۵ زمان پاسخ ${stats.window.p95Ms} میلی‌ثانیه است (آستانه ${latencyThreshold}).`,
      metadata: stats.window,
    });
  }

  // 3. disk
  const disk = diskSnapshot(env.uploadDir);
  checks.disk = disk;
  const diskThreshold = await getNumber('monitoring.alert_disk_percent');
  if (disk && disk.usedPercent >= diskThreshold) {
    detections.push({
      key: 'infra.disk', severity: disk.usedPercent >= Math.min(99, diskThreshold + 7) ? 'critical' : 'warning',
      category: 'server', title: 'فضای ذخیره‌سازی در حال اتمام',
      message: `مصرف دیسک ${disk.usedPercent}٪ است (${disk.freeGb} گیگابایت آزاد).`,
      metadata: disk,
    });
  }
  // storage writable
  try {
    fs.accessSync(env.uploadDir, fs.constants.W_OK);
    checks.storageWritable = true;
  } catch {
    checks.storageWritable = false;
    detections.push({
      key: 'storage.unwritable', severity: 'critical', category: 'file',
      title: 'عدم دسترسی نوشتن به پوشه فایل‌ها',
      message: 'پوشه بارگذاری قابل نوشتن نیست؛ آپلود مدارک ناموفق خواهد بود.',
      metadata: { uploadDir: env.uploadDir },
    });
  }

  // 4. memory
  const memory = memorySnapshot();
  checks.memory = memory;
  const memoryThreshold = await getNumber('monitoring.alert_memory_percent');
  if ((memory.system?.usedPercent ?? 0) >= memoryThreshold) {
    detections.push({
      key: 'infra.memory', severity: 'warning', category: 'server',
      title: 'مصرف بالای حافظه',
      message: `حافظه سیستم ${memory.system?.usedPercent}٪ پر است (RSS فرایند ${memory.rssMb} مگابایت، heap ${memory.heapUsedMb}/${memory.heapTotalMb}).`,
      metadata: memory,
    });
  }

  // 5. payments failing
  const failedPayments = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM payments WHERE status='failed' AND updated_at >= ?", [minutesAgo(15)],
  );
  checks.failedPayments15m = Number(failedPayments?.c ?? 0);
  const paymentThreshold = await getNumber('monitoring.alert_payment_failures');
  if (Number(failedPayments?.c ?? 0) >= paymentThreshold) {
    detections.push({
      key: 'payment.failures', severity: 'warning', category: 'payment',
      title: 'شکست متوالی پرداخت‌ها',
      message: `${failedPayments?.c} پرداخت در ۱۵ دقیقه اخیر ناموفق بوده است.`,
      metadata: { count: Number(failedPayments?.c ?? 0) },
    });
  }

  // 6. gateway configuration
  const gateway = await providerReadiness();
  checks.gateway = gateway;
  if (gateway.enabled && !gateway.configured) {
    detections.push({
      key: 'gateway.unconfigured', severity: 'warning', category: 'gateway',
      title: 'درگاه پرداخت آماده نیست',
      message: gateway.reason ?? 'پرداخت آنلاین فعال است اما درگاه پیکربندی نشده است.',
      metadata: gateway,
    });
  }

  // 7. unassigned cases older than an hour
  const unassigned = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM requests WHERE assigned_to IS NULL
     AND status NOT IN ('completed','cancelled','rejected') AND created_at < ?`, [minutesAgo(60)],
  );
  checks.unassignedRequests = Number(unassigned?.c ?? 0);
  if (Number(unassigned?.c ?? 0) > 0) {
    detections.push({
      key: 'requests.unassigned', severity: 'warning', category: 'request',
      title: 'درخواست‌های بدون مسئول',
      message: `${unassigned?.c} درخواست بیش از یک ساعت بدون مسئول مانده است.`,
      metadata: { count: Number(unassigned?.c ?? 0) },
    });
  }

  // 8. failed logins
  const failedLogins = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM login_events WHERE success = 0 AND created_at >= ?', [minutesAgo(5)],
  );
  checks.failedLogins5m = Number(failedLogins?.c ?? 0);
  const loginThreshold = await getNumber('monitoring.alert_failed_logins');
  if (Number(failedLogins?.c ?? 0) >= loginThreshold) {
    detections.push({
      key: 'security.failed_logins', severity: 'critical', category: 'security',
      title: 'تلاش‌های ناموفق ورود',
      message: `${failedLogins?.c} ورود ناموفق در پنج دقیقه اخیر ثبت شده است.`,
      metadata: { count: Number(failedLogins?.c ?? 0), threshold: loginThreshold },
    });
  }

  // 9. wallet custody integrity
  const integrity = await walletIntegrity();
  checks.walletIntegrity = integrity;
  if (!integrity.ok) {
    detections.push({
      key: 'wallet.integrity', severity: 'critical', category: 'wallet',
      title: 'عدم تطابق موجودی کیف پول با دفتر تراکنش‌ها',
      message: `${integrity.mismatchedCount} کیف پول با دفتر تراکنش‌ها اختلاف دارد.`,
      metadata: { mismatchedCount: integrity.mismatchedCount, cachedTotal: integrity.cachedTotal, ledgerTotal: integrity.ledgerTotal },
    });
  }

  // 10. background media queue
  const media = await one<{ failed: number; pending: number }>(
    `SELECT COALESCE(SUM(CASE WHEN processing_status='failed' THEN 1 ELSE 0 END),0) AS failed,
            COALESCE(SUM(CASE WHEN processing_status='pending' THEN 1 ELSE 0 END),0) AS pending FROM files`,
  );
  checks.media = { failed: Number(media?.failed ?? 0), pending: Number(media?.pending ?? 0) };
  if (Number(media?.failed ?? 0) > 0) {
    detections.push({
      key: 'background.media_failed', severity: 'warning', category: 'background',
      title: 'خطا در پردازش پس‌زمینه فایل‌ها',
      message: `${media?.failed} فایل در پردازش ناموفق بوده‌اند.`,
      metadata: { failed: Number(media?.failed ?? 0), pending: Number(media?.pending ?? 0) },
    });
  }

  return { detections, checks };
}

export interface AlertRow {
  id: string; alert_key: string; severity: Severity; category: string; title: string; message: string;
  status: string; occurrences: number; first_seen_at: string; last_seen_at: string;
  acknowledged_at: string | null; acknowledged_by: string | null; resolved_at: string | null;
  resolved_by: string | null; metadata: string | null;
}

export function mapAlert(row: any) {
  let metadata: unknown = null;
  if (row.metadata) { try { metadata = JSON.parse(row.metadata); } catch { metadata = null; } }
  return {
    id: row.id, key: row.alert_key, severity: row.severity, category: row.category,
    title: row.title, message: row.message, status: row.status, occurrences: Number(row.occurrences),
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
    acknowledgedAt: row.acknowledged_at, acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at, resolvedBy: row.resolved_by, metadata,
  };
}

/**
 * Evaluate all conditions, opening/updating alerts and auto-resolving those
 * whose condition disappeared. Returns what changed.
 */
export async function evaluateAlerts(options: { notify?: boolean } = {}) {
  const { detections, checks } = await detectConditions();
  const seen = new Set<string>();
  let opened = 0; let updated = 0; let resolved = 0;
  const ts = nowIso();

  for (const detection of detections) {
    seen.add(detection.key);
    const existing = await one<AlertRow>(
      `SELECT * FROM alerts WHERE alert_key = ? AND status IN ('active','acknowledged') ORDER BY created_at DESC LIMIT 1`,
      [detection.key],
    );
    if (existing) {
      await run(
        'UPDATE alerts SET occurrences = occurrences + 1, last_seen_at = ?, severity = ?, message = ?, title = ?, metadata = ? WHERE id = ?',
        [ts, detection.severity, detection.message, detection.title, jsonStringify(detection.metadata ?? {}), existing.id],
      );
      updated += 1;
      continue;
    }
    const alertId = id('alr');
    await run(
      `INSERT INTO alerts (id, alert_key, severity, category, title, message, status, occurrences,
        first_seen_at, last_seen_at, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
      [alertId, detection.key, detection.severity, detection.category, detection.title, detection.message,
        ts, ts, jsonStringify(detection.metadata ?? {}), ts],
    );
    opened += 1;
    await logEvent({
      level: detection.severity === 'critical' ? 'CRITICAL' : detection.severity === 'warning' ? 'WARNING' : 'INFO',
      category: 'server', action: `alert.open.${detection.key}`, result: 'failure',
      entityType: 'alert', entityId: alertId, message: detection.title,
      details: { message: detection.message, ...((detection.metadata ?? {}) as Record<string, unknown>) },
    });
    if ((options.notify ?? true) && detection.severity === 'critical' && (await getBool('monitoring.notify_critical'))) {
      const hour = ts.slice(0, 13).replace(/[-:T]/g, '');
      await notifyRole(['super_admin', 'manager'], {
        title: `هشدار بحرانی: ${detection.title}`,
        body: detection.message,
        kind: 'error',
        link: '/admin/monitoring?tab=alerts',
        idempotencyKey: `alert:${detection.key}:${hour}`,
      }).catch(() => undefined);
    }
  }

  // Auto-resolve conditions that no longer hold.
  const open = await q<AlertRow>("SELECT * FROM alerts WHERE status IN ('active','acknowledged')");
  for (const alert of open) {
    if (seen.has(alert.alert_key)) continue;
    await run("UPDATE alerts SET status='resolved', resolved_at=?, resolved_by='system' WHERE id=?", [ts, alert.id]);
    resolved += 1;
    await logEvent({
      level: 'INFO', category: 'server', action: `alert.resolve.${alert.alert_key}`, result: 'success',
      entityType: 'alert', entityId: alert.id, message: `هشدار «${alert.title}» رفع شد.`,
    });
  }

  return { evaluatedAt: ts, opened, updated, resolved, activeDetections: detections.length, checks };
}

export async function listAlerts(params: {
  status?: string; severity?: string; category?: string; page?: number; pageSize?: number; search?: string;
}) {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 25) || 25));
  const where: string[] = [];
  const args: any[] = [];
  if (params.status) { where.push('status = ?'); args.push(params.status); }
  if (params.severity) { where.push('severity = ?'); args.push(params.severity); }
  if (params.category) { where.push('category = ?'); args.push(params.category); }
  if (params.search) {
    where.push('(title LIKE ? OR message LIKE ? OR alert_key LIKE ?)');
    const needle = `%${params.search.slice(0, 60)}%`;
    args.push(needle, needle, needle);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM alerts ${clause}`, args);
  const rows = await q<any>(`SELECT * FROM alerts ${clause} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize]);
  return { items: rows.map(mapAlert), total: Number(total?.c ?? 0), page, pageSize };
}

export async function alertSummary() {
  const rows = await q<any>("SELECT severity, status, COUNT(*) AS c FROM alerts GROUP BY severity, status");
  const active = rows.filter((r) => r.status !== 'resolved');
  return {
    active: active.reduce((sum, r) => sum + Number(r.c), 0),
    criticalActive: active.filter((r) => r.severity === 'critical').reduce((sum, r) => sum + Number(r.c), 0),
    warningActive: active.filter((r) => r.severity === 'warning').reduce((sum, r) => sum + Number(r.c), 0),
    resolved: rows.filter((r) => r.status === 'resolved').reduce((sum, r) => sum + Number(r.c), 0),
    bySeverity: Object.fromEntries(['critical', 'warning', 'info'].map((severity) => [
      severity, active.filter((r) => r.severity === severity).reduce((sum, r) => sum + Number(r.c), 0),
    ])),
  };
}

export async function acknowledgeAlert(alertId: string, actor: { id: string; name: string }) {
  const alert = await one<AlertRow>('SELECT * FROM alerts WHERE id = ?', [alertId]);
  if (!alert) return null;
  if (alert.status === 'resolved') return mapAlert(alert);
  await run("UPDATE alerts SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=?",
    [nowIso(), actor.name, alertId]);
  await logEvent({
    level: 'INFO', category: 'admin', action: 'alert.acknowledge', result: 'success',
    actorId: actor.id, actorName: actor.name, entityType: 'alert', entityId: alertId,
    message: 'هشدار توسط مدیر تأیید شد.',
  });
  return mapAlert((await one<any>('SELECT * FROM alerts WHERE id=?', [alertId]))!);
}

export async function resolveAlert(alertId: string, actor: { id: string; name: string }) {
  const alert = await one<AlertRow>('SELECT * FROM alerts WHERE id = ?', [alertId]);
  if (!alert) return null;
  await run("UPDATE alerts SET status='resolved', resolved_at=?, resolved_by=? WHERE id=?",
    [nowIso(), actor.name, alertId]);
  await logEvent({
    level: 'INFO', category: 'admin', action: 'alert.resolve', result: 'success',
    actorId: actor.id, actorName: actor.name, entityType: 'alert', entityId: alertId,
    message: 'هشدار به‌صورت دستی رفع شد.',
  });
  return mapAlert((await one<any>('SELECT * FROM alerts WHERE id=?', [alertId]))!);
}

export { SEVERITY_RANK };
