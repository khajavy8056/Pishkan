import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { env } from '../env.js';
import { one, q, run, nowIso } from '../db/index.js';
import { listAudit, pruneAudit } from '../modules/audit/service.js';
import {
  backupStatus, createBackup, deleteBackup, listBackups, restoreBackup, verifyBackup,
} from '../modules/system/backup.js';
import { invalidateSettingsCache } from '../modules/settings/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { getBool, getNumber, getString } from '../modules/settings/service.js';
import { param } from '../http/params.js';

export const systemRouter = Router();
systemRouter.use(requireAuth);

systemRouter.get('/status', requirePermission('system.view'), asyncRoute(async (_req, res) => {
  const migrations = await one<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations');
  const last = await one<{ name: string; applied_at: string }>('SELECT name, applied_at FROM schema_migrations ORDER BY name DESC LIMIT 1');
  const disk = (() => {
    try {
      const stat = fs.statfsSync('/');
      return { freeGb: Math.round((stat.bfree * stat.bsize) / 1e9 * 10) / 10, totalGb: Math.round((stat.blocks * stat.bsize) / 1e9 * 10) / 10 };
    } catch { return null; }
  })();

  ok(res, {
    version: env.version,
    environment: env.nodeEnv,
    driver: env.dbDriver,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    migrations: { count: Number(migrations?.c ?? 0), last },
    disk,
    backups: await backupStatus(),
    appUrl: env.appUrl,
    apiUrl: env.apiUrl,
    maintenance: await getBool('maintenance.mode'),
  });
}));

/* --------------------------------- audit ---------------------------------- */

systemRouter.get('/audit', requirePermission('audit.view'), asyncRoute(async (req, res) => {
  const result = await listAudit({
    page: Number(req.query.page ?? 1),
    pageSize: Math.min(100, Number(req.query.pageSize ?? 30)),
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    entityType: typeof req.query.entityType === 'string' ? req.query.entityType : undefined,
    actorId: typeof req.query.actorId === 'string' ? req.query.actorId : undefined,
  });
  ok(res, result.items, { total: result.total, page: Number(req.query.page ?? 1) });
}));

systemRouter.post('/audit/prune', requirePermission('audit.delete'), asyncRoute(async (_req, res) => {
  const days = await getNumber('security.audit_retention_days');
  const removed = await pruneAudit(days);
  ok(res, { removed, retentionDays: days });
}));

/* -------------------------------- sessions -------------------------------- */

systemRouter.get('/sessions', requirePermission('security.view'), asyncRoute(async (_req, res) => {
  const rows = await q<any>(
    `SELECT s.*, u.full_name, u.kind FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC LIMIT 200`, [nowIso()],
  );
  ok(res, rows.map((r) => ({
    id: r.id, userId: r.user_id, userName: r.full_name, kind: r.kind, ip: r.ip,
    userAgent: r.user_agent, createdAt: r.created_at, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at,
  })));
}));

systemRouter.delete('/sessions/:id', requirePermission('security.edit'), asyncRoute(async (req, res) => {
  await run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), param(req, 'id')]);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'session.revoke',
    entityType: 'session', entityId: param(req, 'id'), ip: req.ip,
  });
  ok(res, { message: 'نشست بسته شد.' });
}));

/* --------------------------------- backups -------------------------------- */

systemRouter.get('/backups', requirePermission('backup.view'), asyncRoute(async (_req, res) => {
  const [items, status] = await Promise.all([listBackups(), backupStatus()]);
  ok(res, items, status);
}));

systemRouter.post('/backups', requirePermission('backup.create'), asyncRoute(async (req, res) => {
  const body = z.object({ note: z.string().max(200).optional() }).parse(req.body ?? {});
  const backup = await createBackup({ id: req.auth!.user.id, name: req.auth!.user.fullName }, body.note);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'backup.create',
    entityType: 'backup', entityId: backup.id, after: { filename: backup.filename, size: backup.size }, ip: req.ip,
  });
  ok(res, { ...backup, message: 'نسخه پشتیبان با موفقیت ایجاد شد.' });
}));

systemRouter.post('/backups/:id/verify', requirePermission('backup.view'), asyncRoute(async (req, res) => {
  ok(res, await verifyBackup(param(req, 'id')));
}));

systemRouter.delete('/backups/:id', requirePermission('backup.delete'), asyncRoute(async (req, res) => {
  z.object({confirmation:z.literal('DELETE')}).parse(req.body);
  await deleteBackup(param(req, 'id'));
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'backup.delete',
    entityType: 'backup', entityId: param(req, 'id'), ip: req.ip,
  });
  ok(res, { message: 'نسخه پشتیبان حذف شد.' });
}));

systemRouter.post('/backups/restore', requirePermission('backup.restore'), asyncRoute(async (req, res) => {
  const body = z.object({
    backupId: z.string(),
    confirmation: z.string(),
    password: z.string().min(1),
  }).parse(req.body);

  // Re-authenticate before a destructive operation.
  const { findUserById } = await import('../modules/auth/service.js');
  const { verifyPassword } = await import('../lib/crypto.js');
  const user = await findUserById(req.auth!.user.id);
  if (!user?.password_hash || !(await verifyPassword(body.password, user.password_hash))) {
    throw badRequest('رمز عبور شما صحیح نیست.');
  }

  const result = await restoreBackup(body.backupId, body.confirmation, { id: req.auth!.user.id, name: req.auth!.user.fullName });
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'backup.restore',
    entityType: 'backup', entityId: body.backupId, after: { safetyBackup: result.safetyBackup }, ip: req.ip,
  });
  ok(res, result);
}));

/* ---------------------------------- logs ---------------------------------- */

const LOG_FILE = process.env.LOG_FILE ?? '/var/log/pishkan/api.log';

/** Tail of the technical log with credentials and tokens redacted. */
systemRouter.get('/logs', requirePermission('system.view'), asyncRoute(async (req, res) => {
  const lines = Math.min(500, Math.max(10, Number(req.query.lines ?? 200)));
  if (!fs.existsSync(LOG_FILE)) {
    const recentErrors = await q<any>(
      `SELECT action, actor_name, entity_type, created_at FROM audit_logs
       WHERE action LIKE '%failed%' OR action LIKE '%error%' ORDER BY created_at DESC LIMIT ?`, [lines],
    ).catch(() => []);
    return ok(res, {
      available: false,
      path: LOG_FILE,
      message: 'فایل لاگ فنی روی این سرور یافت نشد. از تاریخچه عملیات استفاده کنید یا LOG_FILE را در فایل محیطی تنظیم کنید.',
      auditSample: recentErrors,
    });
  }

  const content = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-lines);
  const redacted = content.map((line) => line
    .replace(/("?(password|token|api[_-]?key|secret)"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'));

  ok(res, { available: true, path: LOG_FILE, lines: redacted });
}));

/* -------------------------------- utilities ------------------------------- */

systemRouter.post('/cache/clear', requirePermission('system.edit'), asyncRoute(async (req, res) => {
  invalidateSettingsCache();
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'system.cache_clear',
    entityType: 'system', entityId: 'cache', ip: req.ip,
  });
  ok(res, { message: 'کش تنظیمات پاک شد.' });
}));

/** Installation/version information for the admin "about" panel. */
systemRouter.get('/version', asyncRoute(async (_req, res) => {
  const last = await one<{ name: string; applied_at: string }>('SELECT name, applied_at FROM schema_migrations ORDER BY name DESC LIMIT 1');
  ok(res, { version: env.version, environment: env.nodeEnv, driver: env.dbDriver, lastMigration: last });
}));

systemRouter.get('/maintenance', requirePermission('system.view'), asyncRoute(async (_req, res) => {
  ok(res, {
    mode: await getBool('maintenance.mode'),
    scheduledTasks: [
      { name: 'پشتیبان‌گیری خودکار', schedule: await getString('backup.schedule_cron') },
    ],
  });
}));
