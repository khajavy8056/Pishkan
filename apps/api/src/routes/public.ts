import { Router } from 'express';
import { asyncRoute } from '../http/middleware.js';
import { getBool, getString, publicSettings } from '../modules/settings/service.js';
import { getServiceBySlug, listCategories, listServices, searchServices } from '../modules/catalog/service.js';
import { env } from '../env.js';
import { one } from '../db/index.js';
import { toPersianDigits } from '../lib/text.js';
import { param } from '../http/params.js';
import { hasPermission } from '../lib/permissions.js';
import { officeScope } from '../lib/scope.js';

export const publicRouter = Router();
publicRouter.get('/cities', asyncRoute(async (_req, res) => {
  res.json({ ok: true, data: await (await import('../db/index.js')).q('SELECT id, name, province FROM cities WHERE is_active=1 ORDER BY province,name') });
}));

/** Everything the web app needs before the user logs in. */
publicRouter.get('/bootstrap', asyncRoute(async (req, res) => {
  const settings = await publicSettings();
  const categories = await listCategories();
  const [popular, newest] = await Promise.all([
    listServices({ onlyPublic: true, pageSize: 8, customerId: req.auth?.user.id }),
    listServices({ onlyPublic: true, pageSize: 6, sort: 'newest', customerId: req.auth?.user.id }),
  ]);

  const authMethods = {
    staffOtp:await getBool('auth.staff_otp_enabled'),
    otp: await getBool('auth.customer_otp_enabled'),
    password: await getBool('auth.customer_password_enabled'),
    registrationOpen: await getBool('auth.customer_registration_open'),
    passwordReset: await getBool('auth.allow_customer_password_reset'),
  };

  res.json({
    ok: true,
    data: {
      version: env.version,
      settings,
      categories,
      popularServices: popular.items,
      newestServices: newest.items,
      authMethods,
      maintenance: await getBool('maintenance.mode'),
      assistant: {
        enabled: await getBool('assistant.enabled'),
        name: await getString('assistant.name'),
        welcome: await getString('assistant.welcome'),
        disclaimer: await getString('assistant.disclaimer'),
      },
    },
  });
}));

publicRouter.get('/settings', asyncRoute(async (_req, res) => {
  res.json({ ok: true, data: await publicSettings() });
}));

publicRouter.get('/categories', asyncRoute(async (_req, res) => {
  res.json({ ok: true, data: await listCategories() });
}));

publicRouter.get('/services', asyncRoute(async (req, res) => {
  const result = await listServices({
    onlyPublic: true,
    categorySlug: typeof req.query.category === 'string' ? req.query.category : undefined,
    search: typeof req.query.q === 'string' ? req.query.q : undefined,
    sort: ['order', 'newest', 'price_asc', 'price_desc'].includes(String(req.query.sort))
      ? (req.query.sort as 'order' | 'newest' | 'price_asc' | 'price_desc')
      : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 24),
    customerId: req.auth?.user.id,
  });
  res.json({ ok: true, data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize } });
}));

publicRouter.get('/services/:slug', asyncRoute(async (req, res) => {
  const service = await getServiceBySlug(param(req, 'slug'));
  const canViewAdmin = Boolean(req.auth && req.auth.user.kind !== 'customer' && hasPermission(req.auth.permissions, 'services.view'));
  const isCustomOwner = Boolean(req.auth?.user.kind === 'customer' && service?.ownerCustomerId === req.auth.user.id);
  const canViewPrivateCustom = Boolean(req.auth && officeScope(req.auth) && canViewAdmin);
  if (!service || (!service.isPublished && !canViewAdmin && !isCustomOwner)) {
    return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'خدمت یافت نشد.' } });
  }
  // Custom services are private to their owner and authorized office staff.
  if (service.isCustom && !isCustomOwner && !canViewPrivateCustom) {
    return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'خدمت یافت نشد.' } });
  }
  res.json({
    ok: true,
    data: {
      ...service,
      acceptingRequests: service.acceptingRequests && (await getBool('services.accepting_requests')),
      showPrices: await getBool('services.show_prices_publicly'),
    },
  });
}));

publicRouter.get('/search', asyncRoute(async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  if (query.length < 2) return res.json({ ok: true, data: [], meta: { query } });
  const results = await searchServices(query, { limit: Number(req.query.limit ?? 8), customerId: req.auth?.user.id });
  res.json({ ok: true, data: results, meta: { query, count: results.length } });
}));

/** Public status page (no sensitive information). */
publicRouter.get('/status', asyncRoute(async (_req, res) => {
  const showPublic = await getBool('maintenance.healthcheck_public');
  if (!showPublic) return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'صفحه وضعیت غیرفعال است.' } });
  const row = await one<{ c: number }>('SELECT COUNT(*) AS c FROM services WHERE is_published = 1');
  res.json({
    ok: true,
    data: {
      status: 'operational',
      version: env.version,
      services: Number(row?.c ?? 0),
      office: {
        name: await getString('office.name'),
        phone: await getString('office.phone'),
        workingHours: await getString('office.working_hours'),
        supportPhone: toPersianDigits(await getString('maintenance.support_phone')),
      },
      maintenance: await getBool('maintenance.mode'),
      message: await getString('maintenance.message'),
      checkedAt: new Date().toISOString(),
    },
  });
}));
