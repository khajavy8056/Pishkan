import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { notFound } from '../http/errors.js';
import { created, ok } from '../http/respond.js';
import { param } from '../http/params.js';
import { resolveStoragePath } from '../modules/media/service.js';
import { env } from '../env.js';
import { lanAccessInfo } from '../lib/server-bind.js';
import {
  appConfig, storiesForCustomer, storyMediaFile, adminListStories, createStory,
  updateStory, deleteStory, reorderStories, registerDevice, appStats,
} from '../modules/mobile/service.js';

/**
 * Endpoints for the native Android customer app (mounted at /api/app).
 * The app itself talks to the ordinary customer APIs for everything else;
 * this router only adds what is app-specific: runtime config, stories and
 * the device registry, plus their admin surface.
 */
export const mobileRouter = Router();

/** Public: the splash screen needs brand/login/version info before sign-in. */
mobileRouter.get('/config', asyncRoute(async (_req, res) => {
  ok(res, await appConfig());
}));

/** Grouped stories for the signed-in customer home screen. */
mobileRouter.get('/stories', requireAuth, asyncRoute(async (_req, res) => {
  ok(res, await storiesForCustomer());
}));

/**
 * Stream a story's media file to any signed-in user. Story media is
 * marketing content uploaded by the office, so case scope does not apply;
 * range requests are honoured so videos start instantly.
 */
mobileRouter.get('/stories/:id/media', requireAuth, asyncRoute(async (req, res) => {
  const { file } = await storyMediaFile(param(req, 'id'));
  const absolute = resolveStoragePath(file.storage_key);
  if (!fs.existsSync(absolute)) throw notFound('فایل روی سرور موجود نیست.');
  const stat = fs.statSync(absolute);
  const mime = file.mime || 'application/octet-stream';
  res.setHeader('content-type', mime);
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('cache-control', 'private, max-age=3600');
  if (file.sha256) res.setHeader('etag', `"${file.sha256.slice(0, 32)}"`);

  const range = req.headers.range;
  const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
      res.status(416).setHeader('content-range', `bytes */${stat.size}`).end();
      return;
    }
    res.status(206);
    res.setHeader('content-range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('content-length', String(end - start + 1));
    fs.createReadStream(absolute, { start, end }).on('error', () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
    return;
  }
  res.setHeader('content-length', String(stat.size));
  fs.createReadStream(absolute).on('error', () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
}));

/** Device heartbeat from the app (install + version + last-seen for stats). */
mobileRouter.post('/device', requireAuth, asyncRoute(async (req, res) => {
  const body = z.object({
    deviceId: z.string().min(6).max(120),
    platform: z.string().max(20).optional(),
    appVersion: z.string().max(30).optional(),
    appBuild: z.string().max(30).optional(),
    deviceModel: z.string().max(120).optional(),
    pushToken: z.string().max(500).nullable().optional(),
  }).parse(req.body ?? {});
  ok(res, await registerDevice(req.auth!.user.id, body));
}));

/* --------------------------------- admin ---------------------------------- */

const storyBody = z.object({
  groupTitle: z.string().trim().max(80).nullable().optional(),
  title: z.string().trim().min(2).max(120),
  caption: z.string().trim().max(400).nullable().optional().or(z.literal('')),
  mediaType: z.enum(['image', 'video']),
  fileId: z.string().max(80).nullable().optional(),
  // External URL or a same-origin relative path (e.g. the bundled starter
  // artwork under /app-stories/), so seeded stories stay editable.
  mediaUrl: z.string().max(1000).nullable().optional().or(z.literal('')).refine(
    (value) => !value || value.startsWith('/') || /^https?:\/\//i.test(value),
    { message: 'نشانی رسانه باید http(s) یا مسیر نسبی سرور باشد.' },
  ),
  linkUrl: z.string().max(1000).nullable().optional().or(z.literal('')),
  linkLabel: z.string().trim().max(60).nullable().optional(),
  durationSeconds: z.number().int().min(2).max(60).optional(),
  startsAt: z.string().max(40).nullable().optional().or(z.literal('')),
  expiresAt: z.string().max(40).nullable().optional().or(z.literal('')),
  status: z.enum(['draft', 'published']).optional(),
});

function cleanStory(body: z.infer<typeof storyBody>) {
  return {
    ...body,
    caption: body.caption || null,
    groupTitle: body.groupTitle || null,
    mediaUrl: body.mediaUrl || null,
    linkUrl: body.linkUrl || null,
    startsAt: body.startsAt || null,
    expiresAt: body.expiresAt || null,
  };
}

mobileRouter.get('/admin/stories', requirePermission('app.manage'), asyncRoute(async (_req, res) => {
  ok(res, await adminListStories());
}));

mobileRouter.post('/admin/stories', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  const body = cleanStory(storyBody.parse(req.body));
  created(res, await createStory(body, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

mobileRouter.post('/admin/stories/reorder', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  const body = z.object({ ids: z.array(z.string()).min(1).max(200) }).parse(req.body);
  ok(res, await reorderStories(body.ids, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

mobileRouter.patch('/admin/stories/:id', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const body = cleanStory(storyBody.partial().extend({
    title: z.string().trim().min(2).max(120).optional(),
    mediaType: z.enum(['image', 'video']).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  }).parse(req.body) as any);
  // PATCH semantics: a key the admin did not send must keep its current
  // value (the service merges), while an explicitly sent empty value clears
  // it. cleanStory normalises '' to null, so drop untouched nullable keys.
  for (const key of ['groupTitle', 'caption', 'fileId', 'mediaUrl', 'linkUrl', 'linkLabel', 'startsAt', 'expiresAt'] as const) {
    if (!(key in raw)) delete (body as any)[key];
  }
  ok(res, await updateStory(param(req, 'id'), body, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

mobileRouter.delete('/admin/stories/:id', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  ok(res, await deleteStory(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

mobileRouter.get('/admin/stats', requirePermission('app.manage'), asyncRoute(async (_req, res) => {
  ok(res, await appStats());
}));

/**
 * Connection card for the admin: the LAN addresses a phone on the same
 * Wi-Fi can use, so the panel can show them with a scannable QR code that
 * the app's first-run screen understands. Only RFC1918 addresses are ever
 * advertised and the payload never contains credentials.
 */
mobileRouter.get('/admin/connection', requirePermission('app.manage'), asyncRoute(async (_req, res) => {
  const info = lanAccessInfo({ host: env.host, port: env.port });
  ok(res, {
    lanEnabled: info.lanEnabled,
    mode: info.mode,
    urls: info.urls,
    port: info.port,
    platform: info.platform,
    note: info.note,
    hint: info.lanEnabled
      ? 'در اولین اجرای اپ روی گوشی، همین آدرس را وارد کنید یا QR آن را با دکمهٔ اسکن اپ بخوانید. گوشی و رایانه باید روی یک Wi‑Fi باشند.'
      : 'دسترسی شبکهٔ محلی خاموش است؛ در نصب‌کننده/Manager گزینهٔ LAN را روشن کنید تا گوشی‌های روی Wi‑Fi دفتر وصل شوند.',
  });
}));
