/**
 * Takh Pishkhan Guard — HTTP surface.
 * Read = guard.view, actions = guard.manage. Every mutating action is audited
 * in the service layer; destructive-looking operations are reversible.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requirePermission, rateLimit } from '../http/middleware.js';
import { ok } from '../http/respond.js';
import { badRequest } from '../http/errors.js';
import { param } from '../http/params.js';
import {
  guardOverview, listEvents, acknowledgeEvent, listBlocks, blockIp, unblockIp,
  securityPosture,
} from '../modules/guard/service.js';
import { scanIntegrity, rebuildBaseline } from '../modules/guard/integrity.js';
import { scanUploads, listQuarantine, restoreQuarantine, quarantineRegistered } from '../modules/guard/uploads-scan.js';
import { checkDependencies, lastDepsReport } from '../modules/guard/deps.js';
import { sendGuardTestSms } from '../modules/guard/response.js';
import { q } from '../db/index.js';

export const guardRouter = Router();

guardRouter.get('/overview', requirePermission('guard.view'), asyncRoute(async (_req, res) => {
  ok(res, await guardOverview());
}));

guardRouter.get('/posture', requirePermission('guard.view'), asyncRoute(async (_req, res) => {
  ok(res, await securityPosture());
}));

guardRouter.get('/events', requirePermission('guard.view'), asyncRoute(async (req, res) => {
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    kind: z.string().max(40).optional(),
    severity: z.enum(['info', 'warning', 'critical']).optional(),
    ip: z.string().max(45).optional(),
    unacknowledged: z.enum(['true', 'false']).optional(),
  }).parse(req.query ?? {});
  ok(res, await listEvents({ ...query, unacknowledged: query.unacknowledged === 'true' }));
}));

guardRouter.post('/events/:id/ack', requirePermission('guard.manage'), asyncRoute(async (req, res) => {
  ok(res, await acknowledgeEvent(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

guardRouter.get('/blocks', requirePermission('guard.view'), asyncRoute(async (req, res) => {
  ok(res, await listBlocks(req.query.all === 'true'));
}));

guardRouter.post('/blocks', requirePermission('guard.manage'), asyncRoute(async (req, res) => {
  const body = z.object({
    ip: z.string().min(3).max(45),
    reason: z.string().min(3).max(300),
    minutes: z.number().int().min(1).max(1440).optional(),
  }).parse(req.body ?? {});
  ok(res, await blockIp({ ...body, manual: true, actor: { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip } }));
}));

guardRouter.delete('/blocks/:id', requirePermission('guard.manage'), asyncRoute(async (req, res) => {
  ok(res, await unblockIp(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

guardRouter.get('/scans', requirePermission('guard.view'), asyncRoute(async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind.slice(0, 20) : null;
  const rows = kind
    ? await q('SELECT id, kind, status, started_at, finished_at, triggered_by, summary FROM guard_scans WHERE kind = ? ORDER BY started_at DESC LIMIT 50', [kind])
    : await q('SELECT id, kind, status, started_at, finished_at, triggered_by, summary FROM guard_scans ORDER BY started_at DESC LIMIT 50');
  ok(res, rows.map((r: any) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : {} })));
}));

guardRouter.get('/scans/:id', requirePermission('guard.view'), asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM guard_scans WHERE id = ?', [param(req, 'id')]);
  if (!rows.length) throw badRequest('اسکن یافت نشد.');
  const r: any = rows[0];
  ok(res, { ...r, summary: r.summary ? JSON.parse(r.summary) : {}, findings: r.findings ? JSON.parse(r.findings) : [] });
}));

const scanLimiter = rateLimit({ windowMs: 60_000, max: 6, message: 'اسکن‌ها بیش از حد پشت سر هم درخواست شدند؛ یک دقیقه صبر کنید.' });

guardRouter.post('/scan', scanLimiter, requirePermission('guard.manage'), asyncRoute(async (req, res) => {
  const body = z.object({ kind: z.enum(['integrity', 'uploads', 'deps']) }).parse(req.body ?? {});
  const actor = req.auth!.user.id;
  if (body.kind === 'integrity') return ok(res, await scanIntegrity(actor));
  if (body.kind === 'uploads') return ok(res, await scanUploads(actor));
  return ok(res, await checkDependencies(actor));
}));

guardRouter.post('/baseline/rebuild', requirePermission('guard.manage'), asyncRoute(async (req, res) => {
  const body = z.object({ confirm: z.string() }).parse(req.body ?? {});
  if (body.confirm !== 'بازسازی خط مبنا') throw badRequest('برای بازسازی، عبارت «بازسازی خط مبنا» را در confirm بفرستید.');
  ok(res, await rebuildBaseline({ id: req.auth!.user.id, name: req.auth!.user.fullName }));
}));

guardRouter.get('/quarantine', requirePermission('guard.view'), asyncRoute(async (req, res) => {
  ok(res, await listQuarantine(req.query.all === 'true'));
}));

guardRouter.post('/quarantine/:id/restore', requirePermission('guard.manage'), asyncRoute(async (req, res) => {
  const body = z.object({ confirm: z.string() }).parse(req.body ?? {});
  if (body.confirm !== 'بازگردانی فایل') throw badRequest('برای بازگردانی، عبارت «بازگردانی فایل» را در confirm بفرستید.');
  ok(res, await restoreQuarantine(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

guardRouter.post('/quarantine', requirePermission('guard.manage'), asyncRoute(async (req, res) => {
  const body = z.object({ path: z.string().min(1).max(300), confirm: z.string() }).parse(req.body ?? {});
  if (body.confirm !== 'قرنطینه فایل') throw badRequest('برای قرنطینهٔ فایل ثبت‌شده، عبارت «قرنطینه فایل» را در confirm بفرستید.');
  ok(res, await quarantineRegistered(body.path, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

guardRouter.get('/deps', requirePermission('guard.view'), asyncRoute(async (_req, res) => {
  ok(res, await lastDepsReport());
}));

guardRouter.post('/test-sms', rateLimit({ windowMs: 60_000, max: 2 }), requirePermission('guard.manage'), asyncRoute(async (_req, res) => {
  ok(res, await sendGuardTestSms());
}));
