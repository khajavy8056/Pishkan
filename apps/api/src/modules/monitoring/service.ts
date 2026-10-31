/**
 * Monitoring read model.
 *
 * Every number returned here is calculated from the database, the process, or
 * the OS at request time. There is no placeholder value and no random series:
 * when a measurement is unavailable the field is `null` and the card shows
 * "نامشخص" instead of a fabricated zero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { one, q, nowIso } from '../../db/index.js';
import { env } from '../../env.js';
import { getBool, getString } from '../settings/service.js';
import { providerReadiness } from '../payments/providers.js';
import { walletIntegrity } from '../wallet/service.js';
import { alertSummary, detectConditions, evaluateAlerts, listAlerts } from './alerts.js';
import {
  bucketKey, collectorState, diskSnapshot, dbLatency, latestMetrics, memorySnapshot,
  requestStats, series, type Bucket,
} from './metrics.js';

export type ComponentStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export interface Component {
  key: string;
  label: string;
  status: ComponentStatus;
  value: string;
  detail?: string;
  updatedAt: string;
}

function classify(value: number | null, warning: number, critical: number): ComponentStatus {
  if (value === null) return 'unknown';
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'ok';
}

export async function uploadStorageUsage() {
  const root = env.uploadDir;
  let bytes = 0;
  let files = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try { const stat = fs.statSync(full); bytes += stat.size; files += 1; } catch { /* ignore */ }
      }
    }
  };
  walk(root);
  return { bytes, files, mb: Math.round((bytes / 1024 / 1024) * 10) / 10, path: root };
}

/** Full health snapshot for the monitoring centre. */
export async function healthSnapshot() {
  const now = nowIso();
  const db = await dbLatency();
  const memory = memorySnapshot();
  const disk = diskSnapshot(env.uploadDir);
  const requests = requestStats();
  const gateway = await providerReadiness();
  const alerts = await alertSummary();
  const metrics = await latestMetrics(['cpu_percent_x100', 'api_p95_ms', 'disk_used_percent_x100', 'db_latency_ms', 'memory_heap_percent_x100']);
  const integrity = await walletIntegrity();
  const { detections } = await detectConditions();

  const [sessions, online, migrations, reqCounts, pendingDocs] = await Promise.all([
    one<{ c: number }>('SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL AND expires_at > ?', [now]),
    one<{ c: number }>('SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL AND expires_at > ? AND last_seen_at >= ?',
      [now, new Date(Date.now() - 15 * 60_000).toISOString()]),
    one<{ c: number; last: string | null }>('SELECT COUNT(*) AS c, MAX(applied_at) AS last FROM schema_migrations'),
    q<any>("SELECT status, COUNT(*) AS c FROM requests WHERE status NOT IN ('completed','cancelled','rejected') GROUP BY status"),
    one<{ c: number }>(`SELECT (SELECT COUNT(*) FROM request_documents WHERE status='pending') +
      (SELECT COUNT(*) FROM customer_documents WHERE status='pending') AS c`),
  ]);

  const since24 = new Date(Date.now() - 86_400_000).toISOString();
  const finance = await one<any>(
    `SELECT
      (SELECT COUNT(*) FROM payments WHERE status='confirmed' AND purpose='invoice' AND paid_at >= ?) AS paid_count,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='confirmed' AND purpose='invoice' AND paid_at >= ?) AS paid_amount,
      (SELECT COUNT(*) FROM payments WHERE status='failed' AND updated_at >= ?) AS failed_count,
      (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type='topup' AND direction='credit' AND created_at >= ?) AS topup_amount,
      (SELECT COUNT(*) FROM wallet_transactions WHERE type='topup' AND created_at >= ?) AS topup_count,
      (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type='purchase' AND direction='debit' AND created_at >= ?) AS wallet_spend,
      (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type='admin_credit' AND direction='credit' AND created_at >= ?) AS admin_credit,
      (SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE type='refund' AND direction='credit' AND created_at >= ?) AS refunded,
      (SELECT COALESCE(SUM(balance),0) FROM wallets) AS custody,
      (SELECT COUNT(*) FROM wallets) AS wallets,
      (SELECT COUNT(*) FROM payments WHERE status='pending') AS pending_payments`,
    [since24, since24, since24, since24, since24, since24, since24, since24],
  );

  const logs = await one<any>(
    `SELECT
      (SELECT COUNT(*) FROM system_logs WHERE level IN ('ERROR','CRITICAL') AND created_at >= ?) AS errors24h,
      (SELECT COUNT(*) FROM system_logs WHERE level='SECURITY' AND created_at >= ?) AS security24h,
      (SELECT COUNT(*) FROM system_logs WHERE created_at >= ?) AS total24h`,
    [since24, since24, since24],
  );
  const recentErrors = await q<any>(
    `SELECT id, created_at, level, category, action, message, request_id FROM system_logs
     WHERE level IN ('ERROR','CRITICAL','SECURITY') ORDER BY created_at DESC LIMIT 8`,
  );

  const media = await one<any>(
    `SELECT COALESCE(SUM(CASE WHEN processing_status='pending' THEN 1 ELSE 0 END),0) AS pending,
            COALESCE(SUM(CASE WHEN processing_status='failed' THEN 1 ELSE 0 END),0) AS failed FROM files`,
  );
  const sms = await one<any>(
    `SELECT COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed,
            COALESCE(SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END),0) AS sent
     FROM sms_logs WHERE created_at >= ?`, [since24],
  );
  const smsConfigured = (await getBool('sms.enabled')) && (await getString('sms.provider')) !== 'console';
  const storage = await uploadStorageUsage();

  const components: Component[] = [
    { key: 'database', label: 'پایگاه داده', status: db.ok ? 'ok' : 'critical', value: db.ok ? `${db.ms} ms` : 'قطع', detail: `${migrations?.c ?? 0} مهاجرت اعمال‌شده`, updatedAt: now },
    { key: 'api', label: 'API سامانه', status: requests.window.errorRatePercent >= 5 ? 'warning' : 'ok', value: `${requests.window.requests} درخواست/۵دقیقه`, detail: `p95 ${requests.window.p95Ms} ms`, updatedAt: now },
    { key: 'gateway', label: 'درگاه پرداخت', status: gateway.configured ? 'ok' : gateway.enabled ? 'warning' : 'unknown', value: gateway.configured ? (gateway.sandbox ? `${gateway.code} (Sandbox)` : gateway.code) : 'غیرفعال', detail: gateway.reason, updatedAt: now },
    { key: 'wallet', label: 'کیف پول', status: integrity.ok ? 'ok' : 'critical', value: `${finance.wallets} کیف پول`, detail: integrity.ok ? 'دفتر و موجودی هم‌خوان است' : `${integrity.mismatchedCount} اختلاف`, updatedAt: now },
    { key: 'storage', label: 'ذخیره‌سازی فایل', status: (() => { try { fs.accessSync(env.uploadDir, fs.constants.W_OK); return 'ok'; } catch { return 'critical'; } })(), value: `${storage.mb} MB`, detail: `${storage.files} فایل`, updatedAt: now },
    { key: 'disk', label: 'فضای دیسک', status: classify(disk?.usedPercent ?? null, 80, 90), value: disk ? `${disk.usedPercent}٪` : 'نامشخص', detail: disk ? `${disk.freeGb} GB آزاد` : undefined, updatedAt: now },
    // Machine memory pressure, not V8 heap occupancy: a healthy process keeps
    // its heap near the allocated ceiling, so heap ratio is a misleading alarm.
    { key: 'memory', label: 'حافظه', status: classify(memory.system?.usedPercent ?? null, 85, 95), value: `${memory.rssMb} MB`, detail: `حافظه سیستم ${memory.system?.usedPercent ?? '—'}٪ • heap ${memory.heapPercent}٪`, updatedAt: now },
    { key: 'cpu', label: 'پردازنده', status: classify(metrics.cpu_percent_x100 ? metrics.cpu_percent_x100.value / 100 : null, 70, 90), value: metrics.cpu_percent_x100 ? `${(metrics.cpu_percent_x100.value / 100).toFixed(1)}٪` : 'نامشخص', updatedAt: metrics.cpu_percent_x100?.capturedAt ?? now },
    { key: 'notifications', label: 'سرویس اعلان و پیامک', status: smsConfigured ? 'ok' : 'warning', value: smsConfigured ? 'متصل' : 'کنسول/آزمایشی', detail: `${Number(sms?.sent ?? 0)} موفق، ${Number(sms?.failed ?? 0)} ناموفق (۲۴ ساعت)`, updatedAt: now },
    { key: 'queue', label: 'صف پردازش پس‌زمینه', status: Number(media?.failed ?? 0) > 0 ? 'warning' : 'ok', value: `${Number(media?.pending ?? 0)} در انتظار`, detail: `${Number(media?.failed ?? 0)} ناموفق`, updatedAt: now },
    { key: 'alerts', label: 'هشدارها', status: alerts.criticalActive ? 'critical' : alerts.warningActive ? 'warning' : 'ok', value: `${alerts.active} فعال`, detail: `${alerts.criticalActive} بحرانی`, updatedAt: now },
  ];

  const critical = components.filter((c) => c.status === 'critical' || (!db.ok)).length;
  const warning = components.filter((c) => c.status === 'warning').length;
  const status: ComponentStatus = critical ? 'critical' : warning ? 'warning' : 'ok';

  return {
    status,
    generatedAt: now,
    version: env.version,
    environment: env.nodeEnv,
    driver: env.dbDriver,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    platform: process.platform,
    components,
    database: { ok: db.ok, latencyMs: db.ms, migrations: Number(migrations?.c ?? 0), lastMigrationAt: migrations?.last ?? null },
    api: {
      requests: requests.window,
      totals: { total: requests.total, serverErrors: requests.serverErrors, clientErrors: requests.clientErrors },
      recentErrors: recentErrors.map((row) => ({
        id: row.id, createdAt: row.created_at, level: row.level, category: row.category,
        action: row.action, message: row.message, requestId: row.request_id,
      })),
      collector: collectorState(),
    },
    resources: { memory, disk, cpuPercent: metrics.cpu_percent_x100 ? metrics.cpu_percent_x100.value / 100 : null },
    sessions: { active: Number(sessions?.c ?? 0), online15m: Number(online?.c ?? 0) },
    requests: {
      byStatus: reqCounts.map((row) => ({ status: row.status, count: Number(row.c) })),
      open: reqCounts.reduce((sum, row) => sum + Number(row.c), 0),
      pendingDocuments: Number(pendingDocs?.c ?? 0),
      unassigned: detections.find((d) => d.key === 'requests.unassigned')?.metadata?.count ?? 0,
    },
    finance: {
      paidCount24h: Number(finance?.paid_count ?? 0),
      paidAmount24h: Number(finance?.paid_amount ?? 0),
      failedCount24h: Number(finance?.failed_count ?? 0),
      topUpAmount24h: Number(finance?.topup_amount ?? 0),
      topUpCount24h: Number(finance?.topup_count ?? 0),
      walletSpend24h: Number(finance?.wallet_spend ?? 0),
      adminCredit24h: Number(finance?.admin_credit ?? 0),
      refunded24h: Number(finance?.refunded ?? 0),
      walletCustody: Number(finance?.custody ?? 0),
      pendingPayments: Number(finance?.pending_payments ?? 0),
      walletIntegrity: integrity.ok ? 'balanced' : 'mismatch',
    },
    notifications: { smsConfigured, failed24h: Number(sms?.failed ?? 0), sent24h: Number(sms?.sent ?? 0) },
    queue: { mediaPending: Number(media?.pending ?? 0), mediaFailed: Number(media?.failed ?? 0) },
    logs: {
      total24h: Number(logs?.total24h ?? 0),
      errors24h: Number(logs?.errors24h ?? 0),
      security24h: Number(logs?.security24h ?? 0),
    },
    gateway: { ...gateway, checkedAt: now },
    alerts,
    storage,
  };
}

/* --------------------------------- charts --------------------------------- */

interface SeriesPoint { key: string; value: number }

function fillBuckets(points: SeriesPoint[], from: Date, to: Date, bucket: Bucket): SeriesPoint[] {
  const keys: string[] = [];
  const cursor = new Date(from.getTime());
  const stepMs = bucket === 'hour' ? 3_600_000 : bucket === 'day' ? 86_400_000 : bucket === 'week' ? 7 * 86_400_000 : 30 * 86_400_000;
  while (cursor.getTime() <= to.getTime() && keys.length < 800) {
    keys.push(bucketKey(cursor.toISOString(), bucket));
    cursor.setTime(cursor.getTime() + stepMs);
  }
  const map = new Map(points.map((p) => [p.key, p.value]));
  const deduped = [...new Set(keys)];
  return deduped.map((key) => ({ key, value: map.get(key) ?? 0 }));
}

async function dbSeries(sql: string, args: any[], bucket: Bucket) {
  const rows = await q<{ k: string; v: number }>(sql, args);
  return rows.map((row) => ({ key: row.k, value: Number(row.v) }));
}

function sqlBucket(bucket: Bucket, column = 'created_at') {
  if (bucket === 'hour') return `substr(${column}, 1, 13)`;
  if (bucket === 'month') return `substr(${column}, 1, 7)`;
  return `substr(${column}, 1, 10)`;
}

/** Combine stored samples with database aggregates for the dashboard charts. */
export async function chartData(params: { from?: string; to?: string; bucket?: Bucket }) {
  const bucket: Bucket = params.bucket ?? 'day';
  const toDate = params.to ? new Date(params.to) : new Date();
  const defaultDays = bucket === 'hour' ? 2 : bucket === 'day' ? 30 : bucket === 'week' ? 180 : 730;
  const fromDate = params.from ? new Date(params.from) : new Date(Date.now() - defaultDays * 86_400_000);
  const from = fromDate.toISOString();
  const to = toDate.toISOString();
  const sqlBucketExpr = sqlBucket(bucket);

  const [cpu, memory, disk, dbLatencySeries, apiRequests, apiErrors, apiLatency] = await Promise.all([
    series({ metric: 'cpu_percent_x100', from, to, bucket }),
    series({ metric: 'memory_rss_mb', from, to, bucket }),
    series({ metric: 'disk_used_percent_x100', from, to, bucket }),
    series({ metric: 'db_latency_ms', from, to, bucket }),
    series({ metric: 'api_requests_5m', from, to, bucket }),
    series({ metric: 'api_errors_5m', from, to, bucket }),
    series({ metric: 'api_p95_ms', from, to, bucket }),
  ]);

  const [
    requestsCreated, requestsCompleted, requestsFailed, requestsUnassigned,
    paymentsConfirmed, paymentsFailed, walletTopup, walletSpend, adminCredit, refunds,
    loginsSuccess, loginsFailed, unauthorized, settingsChanges,
  ] = await Promise.all([
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM requests WHERE created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM requests WHERE status='completed' AND updated_at >= ? AND updated_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM requests WHERE status IN ('cancelled','rejected') AND updated_at >= ? AND updated_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM requests WHERE assigned_to IS NULL AND status NOT IN ('completed','cancelled','rejected') AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COALESCE(SUM(amount),0) AS v FROM payments WHERE status='confirmed' AND purpose='invoice' AND COALESCE(paid_at, created_at) >= ? AND COALESCE(paid_at, created_at) <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM payments WHERE status='failed' AND COALESCE(updated_at, created_at) >= ? AND COALESCE(updated_at, created_at) <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COALESCE(SUM(amount),0) AS v FROM wallet_transactions WHERE type='topup' AND direction='credit' AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COALESCE(SUM(amount),0) AS v FROM wallet_transactions WHERE type='purchase' AND direction='debit' AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COALESCE(SUM(amount),0) AS v FROM wallet_transactions WHERE type='admin_credit' AND direction='credit' AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COALESCE(SUM(amount),0) AS v FROM wallet_transactions WHERE type='refund' AND direction='credit' AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM login_events WHERE success=1 AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM login_events WHERE success=0 AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM system_logs WHERE result='denied' AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
    dbSeries(`SELECT ${sqlBucketExpr} AS k, COUNT(*) AS v FROM system_logs WHERE category='settings' AND action LIKE 'setting.%' AND created_at >= ? AND created_at <= ? GROUP BY k ORDER BY k`,
      [from, to], bucket),
  ]);

  const fill = (points: SeriesPoint[]) => fillBuckets(points, fromDate, toDate, bucket);
  return {
    range: { from, to, bucket },
    infrastructure: {
      cpuPercent: cpu.points.map((point) => ({ key: point.key, value: point.avg / 100 })),
      memoryMb: memory.points.map((point) => ({ key: point.key, value: point.avg })),
      diskPercent: disk.points.map((point) => ({ key: point.key, value: point.avg / 100 })),
      dbLatencyMs: dbLatencySeries.points.map((point) => ({ key: point.key, value: point.avg })),
      apiRequests: apiRequests.points.map((point) => ({ key: point.key, value: point.avg })),
      apiErrors: apiErrors.points.map((point) => ({ key: point.key, value: point.avg })),
      apiP95Ms: apiLatency.points.map((point) => ({ key: point.key, value: point.avg })),
    },
    activity: {
      requestsCreated: fill(requestsCreated),
      requestsCompleted: fill(requestsCompleted),
      requestsFailed: fill(requestsFailed),
      requestsUnassigned: fill(requestsUnassigned),
    },
    finance: {
      paymentsConfirmed: fill(paymentsConfirmed),
      paymentsFailed: fill(paymentsFailed),
      walletTopUp: fill(walletTopup),
      walletSpend: fill(walletSpend),
      adminCredit: fill(adminCredit),
      refunds: fill(refunds),
    },
    security: {
      loginsSuccess: fill(loginsSuccess),
      loginsFailed: fill(loginsFailed),
      unauthorized: fill(unauthorized),
      settingsChanges: fill(settingsChanges),
    },
  };
}

/** Small payload for the admin dashboard card. */
export async function monitoringOverview() {
  const snapshot = await healthSnapshot();
  return {
    status: snapshot.status,
    generatedAt: snapshot.generatedAt,
    components: snapshot.components,
    alerts: snapshot.alerts,
    sessions: snapshot.sessions,
    requests: snapshot.requests,
    finance: snapshot.finance,
    api: snapshot.api.requests,
    logs: snapshot.logs,
    gateway: snapshot.gateway,
    database: snapshot.database,
    resources: {
      cpuPercent: snapshot.resources.cpuPercent,
      memoryRssMb: snapshot.resources.memory?.rssMb ?? null,
      diskPercent: snapshot.resources.disk?.usedPercent ?? null,
    },
  };
}

export { evaluateAlerts, listAlerts, detectConditions };
