import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { notFound } from '../http/errors.js';
import { created, ok } from '../http/respond.js';
import { param } from '../http/params.js';
import { resolveStoragePath } from '../modules/media/service.js';
import { q } from '../db/index.js';
import { env } from '../env.js';
import { lanAccessInfo } from '../lib/server-bind.js';
import {
  appConfig, bannersForCustomer, bannerImageFile, adminListBanners, createBanner,
  updateBanner, deleteBanner, reorderBanners, registerDevice, appStats,
} from '../modules/mobile/service.js';

/**
 * Endpoints for the native Android customer app (mounted at /api/app).
 * The app itself talks to the ordinary customer APIs for everything else;
 * this router only adds what is app-specific: runtime config, banners and
 * the device registry, plus their admin surface.
 */
export const mobileRouter = Router();

/** Public: the splash screen needs brand/login/version info before sign-in. */
mobileRouter.get('/config', asyncRoute(async (_req, res) => {
  ok(res, await appConfig());
}));

/** Live banners for the signed-in customer's home screen. */
mobileRouter.get('/banners', requireAuth, asyncRoute(async (_req, res) => {
  ok(res, await bannersForCustomer());
}));

/**
 * Stream a banner's image to any signed-in user. Banner artwork is marketing
 * content the office uploads, so case scope does not apply. The response is
 * immutable for a given banner revision: `updated_at` is part of the URL the
 * app requests (`?v=`), and the cache header is long, so a banner whose
 * picture changed is refetched while an unchanged one is never downloaded
 * twice.
 */
mobileRouter.get('/banners/:id/image', requireAuth, asyncRoute(async (req, res) => {
  const { file } = await bannerImageFile(param(req, 'id'));
  const absolute = resolveStoragePath(file.storage_key);
  if (!fs.existsSync(absolute)) throw notFound('فایل روی سرور موجود نیست.');
  const stat = fs.statSync(absolute);
  const mime = file.mime || 'application/octet-stream';
  res.setHeader('content-type', mime);
  res.setHeader('cache-control', 'private, max-age=31536000, immutable');
  if (file.sha256) res.setHeader('etag', `"${file.sha256.slice(0, 32)}"`);
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

const bannerBody = z.object({
  kind: z.enum(['general', 'info', 'ad', 'service']).optional(),
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(300).nullable().optional().or(z.literal('')),
  imageFileId: z.string().max(80).nullable().optional(),
  // Either an uploaded file, an absolute URL, or a same-origin relative path
  // (the bundled catalogue artwork under /images/services/…).
  imageUrl: z.string().max(1000).nullable().optional().or(z.literal('')).refine(
    (value) => !value || value.startsWith('/') || /^https?:\/\//i.test(value),
    { message: 'نشانی تصویر باید http(s) یا مسیر نسبی سرور باشد.' },
  ),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional().or(z.literal('')),
  destinationKind: z.enum(['none', 'service', 'url']).optional(),
  destinationSlug: z.string().trim().max(120).nullable().optional(),
  destinationUrl: z.string().max(1000).nullable().optional(),
  actionLabel: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  startsAt: z.string().max(40).nullable().optional().or(z.literal('')),
  expiresAt: z.string().max(40).nullable().optional().or(z.literal('')),
  status: z.enum(['draft', 'published']).optional(),
  notifyCustomers: z.boolean().optional(),
});

/** '' means "cleared" for every optional field; the service stores NULL. */
function cleanBanner(body: z.infer<typeof bannerBody>) {
  return {
    ...body,
    subtitle: body.subtitle || null,
    imageFileId: body.imageFileId || null,
    imageUrl: body.imageUrl || null,
    accentColor: body.accentColor || null,
    destinationSlug: body.destinationSlug || null,
    destinationUrl: body.destinationUrl || null,
    actionLabel: body.actionLabel || null,
    startsAt: body.startsAt || null,
    expiresAt: body.expiresAt || null,
  };
}

mobileRouter.get('/admin/banners', requirePermission('app.manage'), asyncRoute(async (_req, res) => {
  ok(res, await adminListBanners());
}));

mobileRouter.post('/admin/banners', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  const body = cleanBanner(bannerBody.parse(req.body));
  created(res, await createBanner(body, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

mobileRouter.post('/admin/banners/reorder', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  const body = z.object({ ids: z.array(z.string()).min(1).max(200) }).parse(req.body);
  ok(res, await reorderBanners(body.ids, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

mobileRouter.patch('/admin/banners/:id', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const body = cleanBanner(bannerBody.partial().extend({
    title: z.string().trim().min(2).max(120).optional(),
  }).parse(req.body) as any);
  // PATCH semantics: a key the admin did not send keeps its current value
  // (the service merges), while an explicitly sent empty value clears it.
  for (const key of [
    'subtitle', 'imageFileId', 'imageUrl', 'accentColor', 'destinationSlug',
    'destinationUrl', 'actionLabel', 'startsAt', 'expiresAt',
  ] as const) {
    if (!(key in raw)) delete (body as any)[key];
  }
  ok(res, await updateBanner(param(req, 'id'), body, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

mobileRouter.delete('/admin/banners/:id', requirePermission('app.manage'), asyncRoute(async (req, res) => {
  ok(res, await deleteBanner(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }));
}));

/**
 * The services an admin can point a banner at. Reuses the ordinary catalogue
 * listing, but trimmed to what a picker needs so a 193-service catalogue does
 * not drag its full payload into a modal.
 */
mobileRouter.get('/admin/banner-targets', requirePermission('app.manage'), asyncRoute(async (_req, res) => {
  const rows = await q<{ slug: string; title: string; category_title: string | null }>(
    `SELECT s.slug, s.title, c.title AS category_title
       FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE s.archived_at IS NULL
      ORDER BY c.sort_order ASC, s.sort_order ASC, s.title ASC`,
  );
  ok(res, rows.map((row) => ({ slug: row.slug, title: row.title, category: row.category_title ?? null })));
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
