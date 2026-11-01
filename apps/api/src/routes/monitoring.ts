import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAnyPermission, requireAuth, requirePermission } from '../http/middleware.js';
import { ok } from '../http/respond.js';
import { badRequest, notFound } from '../http/errors.js';
import { param } from '../http/params.js';
import { getNumber, getString } from '../modules/settings/service.js';
import {
  LOG_CATEGORIES, LOG_LEVELS, getLog, listLogs, logStats, pruneLogs,
} from '../modules/logging/service.js';
import {
  acknowledgeAlert, alertSummary, evaluateAlerts, listAlerts, resolveAlert,
} from '../modules/monitoring/alerts.js';
import { chartData, healthSnapshot, monitoringOverview } from '../modules/monitoring/service.js';
import { sampleMetrics, type Bucket } from '../modules/monitoring/metrics.js';
import { writeAudit } from '../modules/audit/service.js';

export const monitoringRouter = Router();
monitoringRouter.use(requireAuth);

const BUCKETS: Bucket[] = ['hour', 'day', 'week', 'month'];
function bucketOf(value: unknown): Bucket {
  return BUCKETS.includes(value as Bucket) ? (value as Bucket) : 'day';
}

/* -------------------------------- overview -------------------------------- */

monitoringRouter.get('/overview', requirePermission('monitoring.view'), asyncRoute(async (_req, res) => {
  ok(res, await monitoringOverview());
}));

monitoringRouter.get('/health', requirePermission('monitoring.view'), asyncRoute(async (_req, res) => {
  ok(res, await healthSnapshot());
}));

monitoringRouter.get('/charts', requirePermission('monitoring.view'), asyncRoute(async (req, res) => {
  ok(res, await chartData({
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    bucket: bucketOf(req.query.bucket),
  }));
}));

/** Force a metric sample (useful right after boot or before reading charts). */
monitoringRouter.post('/sample', requirePermission('monitoring.view'), asyncRoute(async (_req, res) => {
  ok(res, await sampleMetrics());
}));

monitoringRouter.get('/meta', requireAnyPermission('monitoring.view', 'logs.view', 'alerts.view'), asyncRoute(async (_req, res) => {
  ok(res, {
    levels: LOG_LEVELS,
    categories: LOG_CATEGORIES,
    buckets: BUCKETS,
    retention: {
      logsDays: await getNumber('monitoring.log_retention_days'),
      metricsDays: await getNumber('monitoring.retain_metrics_days'),
    },
    thresholds: {
      errorRatePercent: await getNumber('monitoring.alert_error_rate_percent'),
      latencyMs: await getNumber('monitoring.alert_latency_ms'),
      diskPercent: await getNumber('monitoring.alert_disk_percent'),
      memoryPercent: await getNumber('monitoring.alert_memory_percent'),
      paymentFailures: await getNumber('monitoring.alert_payment_failures'),
      failedLogins: await getNumber('monitoring.alert_failed_logins'),
    },
    alerts: await alertSummary(),
    logLevel: await getString('monitoring.log_level'),
  });
}));

/* ---------------------------------- logs ---------------------------------- */

function filtersOf(req: any) {
  const levels = typeof req.query.levels === 'string'
    ? req.query.levels.split(',')
    : typeof req.query.level === 'string' ? [req.query.level] : undefined;
  return {
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 50),
    level: typeof req.query.level === 'string' ? req.query.level : undefined,
    levels,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    actorId: typeof req.query.actorId === 'string' ? req.query.actorId : undefined,
    actorRole: typeof req.query.actorRole === 'string' ? req.query.actorRole : undefined,
    requestId: typeof req.query.requestId === 'string' ? req.query.requestId : undefined,
    transactionId: typeof req.query.transactionId === 'string' ? req.query.transactionId : undefined,
    entityId: typeof req.query.entityId === 'string' ? req.query.entityId : undefined,
    result: typeof req.query.result === 'string' ? req.query.result : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  };
}

monitoringRouter.get('/logs', requirePermission('logs.view'), asyncRoute(async (req, res) => {
  const result = await listLogs(filtersOf(req));
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

monitoringRouter.get('/logs/stats', requirePermission('logs.view'), asyncRoute(async (req, res) => {
  const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString();
  const from = typeof req.query.from === 'string' ? req.query.from : new Date(Date.now() - 7 * 86_400_000).toISOString();
  ok(res, await logStats({ from, to }));
}));

/** CSV export is a separate permission: it moves data outside the panel. */
monitoringRouter.get('/logs/export', requirePermission('logs.export'), asyncRoute(async (req, res) => {
  const { page: _page, pageSize: _pageSize, ...filter } = filtersOf(req);
  const result = await listLogs({ ...filter, page: 1, pageSize: 200 });
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'logs.export',
    entityType: 'system_log', entityId: 'export', after: { rows: result.items.length, filter }, ip: req.ip,
  });
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['زمان', 'سطح', 'دسته', 'عملیات', 'کاربر', 'نقش', 'IP', 'شناسه درخواست', 'نتیجه', 'پیام', 'کد خطا'];
  const lines = result.items.map((row) => [
    row.createdAt, row.level, row.category, row.action, row.actorName ?? '', row.actorRole ?? '',
    row.ip ?? '', row.requestId ?? '', row.result, row.message ?? '', row.errorCode ?? '',
  ].map(escape).join(','));
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="pishkan-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${[header.map(escape).join(','), ...lines].join('\r\n')}`);
}));

monitoringRouter.delete('/logs/prune', requirePermission('logs.delete'), asyncRoute(async (req, res) => {
  const body = z.object({ confirmation: z.literal('PRUNE') }).parse(req.body ?? {});
  const days = await getNumber('monitoring.log_retention_days');
  const removed = await pruneLogs(days);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'logs.prune',
    entityType: 'system_log', entityId: 'prune', after: { removed, days }, ip: req.ip,
  });
  ok(res, { removed, retentionDays: days, confirmation: body.confirmation });
}));

monitoringRouter.get('/logs/:id', requirePermission('logs.view'), asyncRoute(async (req, res) => {
  const log = await getLog(param(req, 'id'));
  if (!log) throw notFound('لاگ یافت نشد.');
  ok(res, log);
}));

/* --------------------------------- alerts --------------------------------- */

monitoringRouter.get('/alerts', requirePermission('alerts.view'), asyncRoute(async (req, res) => {
  const result = await listAlerts({
    status: typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined,
    severity: typeof req.query.severity === 'string' && req.query.severity ? req.query.severity : undefined,
    category: typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 25),
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize, summary: await alertSummary() });
}));

monitoringRouter.post('/alerts/evaluate', requirePermission('alerts.edit'), asyncRoute(async (_req, res) => {
  ok(res, await evaluateAlerts({ notify: true }));
}));

monitoringRouter.post('/alerts/:id/acknowledge', requirePermission('alerts.edit'), asyncRoute(async (req, res) => {
  const alert = await acknowledgeAlert(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName });
  if (!alert) throw notFound('هشدار یافت نشد.');
  ok(res, alert);
}));

monitoringRouter.post('/alerts/:id/resolve', requirePermission('alerts.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
  const alert = await resolveAlert(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName });
  if (!alert) throw notFound('هشدار یافت نشد.');
  if (body.note) {
    await writeAudit({
      actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'alert.resolve.manual',
      entityType: 'alert', entityId: alert.id, after: { note: body.note }, ip: req.ip,
    });
  }
  ok(res, alert);
}));

monitoringRouter.get('/alerts/summary', requirePermission('alerts.view'), asyncRoute(async (_req, res) => {
  ok(res, await alertSummary());
}));

monitoringRouter.use((_req, _res, next) => next(badRequest('مسیر مانیتورینگ نامعتبر است.')));
