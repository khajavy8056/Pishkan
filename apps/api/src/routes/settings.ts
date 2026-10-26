import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { env } from '../env.js';
import {
  adminSettingsView, getBool, getNumber, getSecret, getString, invalidateSettingsCache,
  resetSetting, updateSettings,
} from '../modules/settings/service.js';
import { sendTestSms, smsConfig, smsLogs, testConnection } from '../modules/sms/provider.js';
import { writeAudit } from '../modules/audit/service.js';
import { one, q } from '../db/index.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

/** Full admin settings view, grouped for the UI. Secrets never leave the server. */
settingsRouter.get('/admin', requirePermission('settings.view'), asyncRoute(async (_req, res) => {
  const view = await adminSettingsView();
  const smsState = await smsConfig();
  ok(res, {
    ...view,
    meta: {
      nodeEnv: env.nodeEnv,
      version: env.version,
      dbDriver: env.dbDriver,
      encryptionConfigured: Boolean(env.encryptionKey),
      smsConfigured: Boolean((smsState.username && (smsState.password || smsState.apiKey)) || smsState.apiKey),
      gatewayConfigured: Boolean(await getString('accounting.gateway_merchant_id')),
    },
  });
}));

settingsRouter.put('/admin', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    confirmCritical: z.boolean().optional(),
  }).parse(req.body);

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.values)) {
    patch[key] = value === null ? '' : value;
  }

  const result = await updateSettings(patch, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }, { confirmCritical: body.confirmCritical });
  invalidateSettingsCache();
  ok(res, { updated: result.updated, message: 'تنظیمات ذخیره شد.' });
}));

settingsRouter.post('/admin/reset', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ key: z.string().min(3) }).parse(req.body);
  await resetSetting(body.key, { id: req.auth!.user.id, name: req.auth!.user.fullName });
  ok(res, { message: 'مقدار پیش‌فرض بازگردانده شد.' });
}));

/* ---------------------------------- SMS ----------------------------------- */

settingsRouter.post('/sms/test-connection', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const result = await testConnection();
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'sms.test_connection',
    entityType: 'settings', entityId: 'sms', after: { ok: result.ok, message: result.message }, ip: req.ip,
  });
  ok(res, result);
}));

settingsRouter.post('/sms/test-send', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ mobile: z.string().min(10).max(20) }).parse(req.body);
  // Explicit destination is required; the panel never sends without user action.
  const result = await sendTestSms(body.mobile);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'sms.test_send',
    entityType: 'settings', entityId: 'sms', after: { ok: result.ok, error: result.error }, ip: req.ip,
  });
  ok(res, {
    ok: result.ok,
    message: result.ok ? 'پیامک آزمایشی ارسال شد.' : result.error,
    checkedAt: result.checkedAt,
    messageId: result.messageId,
  });
}));

settingsRouter.get('/sms/logs', requirePermission('settings.view'), asyncRoute(async (req, res) => {
  const logs = await smsLogs(Number(req.query.limit ?? 50));
  ok(res, logs.items, { total: logs.total });
}));

/** Redacted view of SMS credentials for the panel. */
settingsRouter.get('/sms/credentials', requirePermission('settings.view'), asyncRoute(async (_req, res) => {
  const cfg = await smsConfig();
  ok(res, {
    provider: cfg.provider,
    authMode: cfg.authMode,
    username: cfg.username,
    senderLine: cfg.senderLine,
    hasPassword: Boolean(await getSecret('sms.password')),
    hasApiKey: Boolean(await getSecret('sms.api_key')),
    enabled: await getBool('sms.enabled'),
    otpTemplate: await getString('sms.otp_template_id'),
    dailyLimit: await getNumber('sms.daily_limit'),
  });
}));

/* --------------------------------- domain --------------------------------- */

/**
 * Domain self-check. This does NOT buy a domain or configure DNS automatically;
 * it validates configuration consistency and reachability and returns precise
 * manual steps when something is missing.
 */
settingsRouter.get('/domain-check', requirePermission('settings.view'), asyncRoute(async (req, res) => {
  const primary = (await getString('domain.primary')).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const api = (await getString('domain.api')).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const publicUrl = await getString('domain.public_url');
  const sslMode = await getString('domain.ssl_mode');
  const proxy = await getString('domain.proxy_provider');
  const targetIp = await getString('domain.dns_target_ip');

  const checks: { key: string; label: string; status: 'ok' | 'warning' | 'error'; message: string }[] = [];

  checks.push(primary
    ? { key: 'domain.primary', label: 'دامنه اصلی', status: 'ok', message: primary }
    : { key: 'domain.primary', label: 'دامنه اصلی', status: 'warning', message: 'دامنه اصلی تنظیم نشده است؛ سامانه با IP یا دامنه موقت در دسترس است.' });

  if (publicUrl && !/^https:\/\//.test(publicUrl)) {
    checks.push({ key: 'domain.public_url', label: 'نشانی عمومی', status: 'error', message: 'نشانی عمومی باید با https شروع شود.' });
  } else if (publicUrl) {
    checks.push({ key: 'domain.public_url', label: 'نشانی عمومی', status: 'ok', message: publicUrl });
  }

  if (sslMode === 'flexible') {
    checks.push({ key: 'domain.ssl_mode', label: 'حالت SSL', status: 'error', message: 'حالت Flexible امن نیست. Full (strict) را انتخاب کنید.' });
  } else {
    checks.push({ key: 'domain.ssl_mode', label: 'حالت SSL', status: 'ok', message: sslMode });
  }

  if (proxy === 'cloudflare' && !targetIp) {
    checks.push({ key: 'dns', label: 'رکورد DNS', status: 'warning', message: 'IP سرور ثبت نشده است؛ رکورد A را در Cloudflare به IP سرور اشاره دهید.' });
  }

  // Reachability check of the configured public URL (non-fatal).
  if (publicUrl && /^https:\/\//.test(publicUrl)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(`${publicUrl.replace(/\/$/, '')}/api/health/live`, { signal: controller.signal });
      clearTimeout(timer);
      checks.push({
        key: 'https', label: 'دسترسی HTTPS', status: response.ok ? 'ok' : 'error',
        message: response.ok ? 'سامانه از طریق دامنه عمومی پاسخ می‌دهد.' : `پاسخ نامعتبر از دامنه: HTTP ${response.status}`,
      });
    } catch {
      checks.push({ key: 'https', label: 'دسترسی HTTPS', status: 'warning', message: 'بررسی از داخل سرور انجام شد و پاسخ نگرفت؛ ممکن است DNS یا فایروال هنوز آماده نباشد.' });
    }
  }

  ok(res, {
    checks,
    expected: {
      aRecord: primary ? [{ type: 'A', name: '@', value: targetIp || '<IP سرور>' }] : [],
      apiRecord: api ? [{ type: 'A', name: api, value: targetIp || '<IP سرور>' }] : [],
      acme: 'گواهی Let\'s Encrypt روی سرور با certbot نصب می‌شود؛ Cloudflare را روی Full (strict) نگه دارید.',
    },
    steps: [
      'دامنه را از یک ثبت‌کننده معتبر تهیه کنید و Nameserverهای Cloudflare را در پنل ثبت‌کننده تنظیم کنید.',
      'در Cloudflare رکورد A با نام @ به IP سرور و در صورت نیاز رکورد A برای زیردامنه API بسازید.',
      'برای رکوردهای وب و API وضعیت Proxy را روشن نگه دارید (نارنجی).',
      'SSL/TLS را روی Full (strict) تنظیم کنید و گواهی مبدأ را با certbot نصب کنید.',
      'در Nginx، server_name را به دامنه تغییر دهید و سرویس را ری‌استارت کنید.',
      'نشانی عمومی و دامنه API را در همین صفحه ذخیره کنید و دوباره بررسی کنید.',
    ],
  });
}));

/* --------------------------------- health --------------------------------- */

/** Technical status shown inside the admin panel. */
settingsRouter.get('/system-health', requirePermission('system.view'), asyncRoute(async (_req, res) => {
  const migrations = await one<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations');
  const lastMigration = await one<{ name: string; applied_at: string }>(
    'SELECT name, applied_at FROM schema_migrations ORDER BY name DESC LIMIT 1',
  );
  const counts = await q<{ name: string; c: number }>(`SELECT 'services' AS name, COUNT(*) AS c FROM services
    UNION ALL SELECT 'requests', COUNT(*) FROM requests
    UNION ALL SELECT 'customers', COUNT(*) FROM users WHERE kind = 'customer'
    UNION ALL SELECT 'staff', COUNT(*) FROM users WHERE kind <> 'customer'
    UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
    UNION ALL SELECT 'payments', COUNT(*) FROM payments`).catch(() => [] as any);

  const { backupStatus } = await import('../modules/system/backup.js');
  ok(res, {
    version: env.version,
    environment: env.nodeEnv,
    driver: env.dbDriver,
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    migrations: { count: Number(migrations?.c ?? 0), last: lastMigration },
    records: Object.fromEntries(counts.map((r: { name: string; c: number }) => [r.name, Number(r.c)])),
    backup: await backupStatus(),
    sms: { enabled: await getBool('sms.enabled'), provider: await getString('sms.provider') },
    payment: {
      online: await getBool('accounting.online_payment_enabled'),
      gateway: await getString('accounting.gateway'),
    },
    settingsLastUpdated: (await adminSettingsView()).lastUpdated,
  });
}));

/** Export settings without secrets (safe for backups and migration). */
settingsRouter.get('/export', requirePermission('settings.view'), asyncRoute(async (_req, res) => {
  const view = await adminSettingsView();
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="pishkan-settings-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: env.version,
    values: Object.fromEntries(view.settings.filter((s) => !s.isSecret).map((s) => [s.key, s.value])),
    secretsOmitted: view.settings.filter((s) => s.isSecret).map((s) => s.key),
  }, null, 2));
}));

settingsRouter.post('/import', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    confirmCritical: z.boolean().optional(),
  }).parse(req.body);
  const result = await updateSettings(body.values as Record<string, unknown>, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }, { confirmCritical: body.confirmCritical });
  ok(res, { updated: result.updated });
}));

/** Public legal texts edited from the admin panel. */
settingsRouter.get('/legal', asyncRoute(async (_req, res) => {
  ok(res, {
    terms: await getString('site.terms'),
    privacy: await getString('site.privacy'),
    supportPhone: await getString('maintenance.support_phone'),
    officeName: await getString('office.name'),
  });
}));

settingsRouter.post('/maintenance-mode', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ enabled: z.boolean(), message: z.string().max(500).optional() }).parse(req.body);
  if (body.enabled && req.auth!.user.kind !== 'admin') throw forbidden('فقط مدیر کل می‌تواند حالت تعمیرات را فعال کند.');
  await updateSettings(
    { 'maintenance.mode': body.enabled, ...(body.message ? { 'maintenance.message': body.message } : {}) },
    { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip },
  );
  ok(res, { message: body.enabled ? 'حالت تعمیرات فعال شد.' : 'حالت تعمیرات غیرفعال شد.' });
}));
