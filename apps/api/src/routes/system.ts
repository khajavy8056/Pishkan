import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { env } from '../env.js';
import { one, q, run, nowIso } from '../db/index.js';
import { listAudit, pruneAudit } from '../modules/audit/service.js';
import {
  backupStatus, createBackup, deleteBackup, listBackups, restoreBackup, verifyBackup,
  backupDto, backupFilePath,
} from '../modules/system/backup.js';
import {
  PACKAGE_MAX_BYTES, stageRestoreUpload, executeRestore, getRestoreJob, discardRestoreJob,
  restoreJobDto, createBackupPackage,
} from '../modules/system/restore-package.js';
import { invalidateSettingsCache } from '../modules/settings/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { getBool, getNumber, getString } from '../modules/settings/service.js';
import { param } from '../http/params.js';
import { lanAccessInfo } from '../lib/server-bind.js';

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

/** Read-only LAN address discovery for the admin panel (no secrets, no tokens). */
systemRouter.get('/lan', requirePermission('system.view'), asyncRoute(async (_req, res) => {
  ok(res, lanAccessInfo({ host: env.host, port: env.port }));
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
  ok(res, items.map(backupDto), status);
}));

systemRouter.post('/backups', requirePermission('backup.create'), asyncRoute(async (req, res) => {
  const body = z.object({ note: z.string().max(200).optional() }).parse(req.body ?? {});
  const backup = await createBackup({ id: req.auth!.user.id, name: req.auth!.user.fullName }, body.note);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'backup.create',
    entityType: 'backup', entityId: backup.id, after: { filename: backup.filename, size: backup.size }, ip: req.ip,
  });
  ok(res, { ...backupDto(backup), message: 'نسخه پشتیبان با موفقیت ایجاد شد.' });
}));

/**
 * Download one part of a backup so it can be stored off-server. Exporting the
 * whole database is sensitive, hence the dedicated `backup.export` grant and a
 * mandatory audit row per download.
 */
systemRouter.get('/backups/:id/download', requirePermission('backup.export'), asyncRoute(async (req, res) => {
  const rawPart = typeof req.query.part === 'string' ? req.query.part : 'db';
  if (rawPart !== 'db' && rawPart !== 'uploads') throw badRequest('پارامتر part باید db یا uploads باشد.');
  const part = rawPart;
  const file = await backupFilePath(param(req, 'id'), part);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'backup.download',
    entityType: 'backup', entityId: param(req, 'id'), after: { part, filename: file.filename }, ip: req.ip,
  });
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file.path);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
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

/* --------------------- one-file restore from an upload -------------------- */

const restoreUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(env.backupDir, 'restore-staging');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, _file, cb) => cb(null, `incoming-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.bin`),
});
const restoreUploadMiddleware = multer({
  storage: restoreUploadStorage,
  limits: { fileSize: PACKAGE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(zip|sqlite|db)$/i.test(file.originalname)) {
      return cb(badRequest('فقط بسته پشتیبان (.zip) یا فایل پایگاه داده (.sqlite) پذیرفته می‌شود.'));
    }
    cb(null, true);
  },
}).single('file');

/** Upload + inspect a backup package (non-destructive). */
systemRouter.post('/backups/restore-upload', requirePermission('backup.restore'), asyncRoute(async (req, res, next) => {
  restoreUploadMiddleware(req, res, (err: any) => {
    if (err) return next(err);
    (async () => {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) throw badRequest('فایلی انتخاب نشده است.');
      try {
        const staged = await stageRestoreUpload(file.path, { id: req.auth!.user.id, name: req.auth!.user.fullName });
        await writeAudit({
          actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'backup.restore_package_upload',
          entityType: 'backup', entityId: staged.jobId,
          after: { filename: file.originalname, size: staged.inspection.size, migrations: staged.inspection.migrations },
          ip: req.ip,
        });
        res.status(201).json({ ok: true, data: staged });
      } catch (error) {
        try { fs.rmSync(file.path, { force: true }); } catch { /* already moved into staging */ }
        throw error;
      }
    })().catch(next);
  });
}));

systemRouter.get('/backups/restore-upload/:jobId', requirePermission('backup.restore'), asyncRoute(async (req, res) => {
  ok(res, restoreJobDto(getRestoreJob(param(req, 'jobId'))));
}));

systemRouter.delete('/backups/restore-upload/:jobId', requirePermission('backup.restore'), asyncRoute(async (req, res) => {
  discardRestoreJob(param(req, 'jobId'));
  ok(res, { message: 'فایل بارگذاری‌شده کنار گذاشته شد.' });
}));

/** Execute a staged restore (async; poll the job for progress). */
systemRouter.post('/backups/restore-upload/:jobId/execute', requirePermission('backup.restore'), asyncRoute(async (req, res) => {
  const body = z.object({
    confirmation: z.string(),
    password: z.string().min(1),
  }).parse(req.body);
  if (body.confirmation !== 'RESTORE') {
    throw badRequest('برای بازیابی باید عبارت RESTORE را دقیقاً وارد کنید.');
  }
  const { findUserById } = await import('../modules/auth/service.js');
  const { verifyPassword } = await import('../lib/crypto.js');
  const user = await findUserById(req.auth!.user.id);
  if (!user?.password_hash || !(await verifyPassword(body.password, user.password_hash))) {
    throw badRequest('رمز عبور شما صحیح نیست.');
  }
  const job = executeRestore(param(req, 'jobId'));
  res.status(202).json({ ok: true, data: restoreJobDto(job) });
}));

/** Create a fresh single-file package of the current state and download it. */
systemRouter.post('/backups/package', requirePermission('backup.export'), asyncRoute(async (req, res) => {
  const pkg = await createBackupPackage();
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'backup.package_create',
    entityType: 'backup', entityId: pkg.filename, after: { size: pkg.size }, ip: req.ip,
  });
  res.download(pkg.path, pkg.filename, () => {
    fs.rm(pkg.path, { force: true }, () => undefined);
  });
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
  const { backupSchedulerState } = await import('../modules/system/scheduler.js');
  const scheduler = await backupSchedulerState().catch(() => null);
  ok(res, {
    mode: await getBool('maintenance.mode'),
    scheduledTasks: [
      {
        name: 'پشتیبان‌گیری خودکار', schedule: await getString('backup.schedule_cron'),
        enabled: scheduler?.enabled ?? false, running: scheduler?.running ?? false,
        nextRunAt: scheduler?.nextRunAt ?? null, lastSuccessAt: scheduler?.lastSuccessAt ?? null,
        lastError: scheduler?.lastError ?? null,
      },
    ],
  });
}));
