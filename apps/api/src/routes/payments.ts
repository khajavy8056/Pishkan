import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { one, nowIso, run } from '../db/index.js';
import { env } from '../env.js';
import { param } from '../http/params.js';
import {
  gatewayDiagnostics, handleGatewayCallback, listCallbacks, paymentForCustomer,
} from '../modules/payments/service.js';
import { verifySandboxToken } from '../modules/payments/providers.js';
import { writeAudit } from '../modules/audit/service.js';
import { logEvent } from '../modules/logging/service.js';

export const paymentsRouter = Router();

/** Where the browser should land after a gateway round-trip. */
function returnPath(purpose: string, confirmed: boolean) {
  if (purpose === 'wallet') return `/app/wallet?topup=${confirmed ? 'confirmed' : 'failed'}`;
  return `/app/invoices?payment=${confirmed ? 'confirmed' : 'failed'}`;
}

async function intentOf(paymentId: string) {
  const payment = await one<any>('SELECT id, purpose, status FROM payments WHERE id=?', [paymentId]);
  return payment?.purpose === 'wallet_topup' ? 'wallet' : 'invoices';
}

/* ------------------------------ gateway callback --------------------------- */

/**
 * Every provider redirects here with its own parameter names. Only the
 * server-side verify step decides the outcome; a browser claiming success in
 * the query string proves nothing.
 */
paymentsRouter.get('/callback/:provider', asyncRoute(async (req, res) => {
  const provider = param(req, 'provider');
  const paymentId = String(req.query.paymentId ?? req.query.payment_id ?? '');
  if (!paymentId) throw badRequest('شناسه پرداخت در بازگشت از درگاه وجود ندارد.');
  const params: Record<string, string> = {
    authority: String(req.query.Authority ?? req.query.authority ?? ''),
    status: String(req.query.Status ?? req.query.status ?? ''),
    token: String(req.query.token ?? ''),
    decision: String(req.query.decision ?? ''),
    sandbox: String(req.query.sandbox ?? ''),
  };
  const payment = await one<any>('SELECT id, purpose FROM payments WHERE id=?', [paymentId]);
  if (!payment) throw notFound('تراکنش یافت نشد.');
  const result = await handleGatewayCallback({ provider, paymentId, params, ip: req.ip });
  const target = returnPath(payment.purpose === 'wallet_topup' ? 'wallet' : 'invoices', result.confirmed);
  res.redirect(303, target);
}));

/* ------------------------------- sandbox page ----------------------------- */

/**
 * Internal checkout simulator. It exists so that Windows/Linux installs and the
 * automated tests can exercise the full redirect → verify → credit flow without
 * a real PSP account. It is force-disabled in production and only accepts a
 * signed, expiring token that the server itself generated for that payment.
 */
paymentsRouter.get('/sandbox/:paymentId', asyncRoute(async (req, res) => {
  if (env.isProd) throw forbidden('شبیه‌ساز درگاه در محیط عملیاتی غیرفعال است.');
  const paymentId = param(req, 'paymentId');
  const token = String(req.query.token ?? '');
  const payment = await one<any>('SELECT * FROM payments WHERE id=?', [paymentId]);
  if (!payment) throw notFound('تراکنش یافت نشد.');
  if (payment.gateway !== 'sandbox' && payment.gateway !== 'mock' && payment.gateway !== 'test') {
    throw forbidden('این تراکنش متعلق به شبیه‌ساز درگاه نیست.');
  }
  if (!verifySandboxToken(token, payment.id, Number(payment.amount))) {
    throw forbidden('لینک شبیه‌ساز درگاه معتبر یا منقضی نشده است.');
  }
  if (payment.status !== 'pending') {
    return res.redirect(303, returnPath(payment.purpose === 'wallet_topup' ? 'wallet' : 'invoices', payment.status === 'confirmed'));
  }
  await logEvent({
    level: 'INFO', category: 'gateway', action: 'payment.sandbox.opened', result: 'success',
    entityType: 'payment', entityId: payment.id, transactionId: payment.id, ip: req.ip,
    message: 'صفحه شبیه‌ساز درگاه باز شد.', details: { purpose: payment.purpose },
  });
  const amount = Number(payment.amount).toLocaleString('en-US');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>شبیه‌ساز درگاه پرداخت — پیشکان</title>
<style>
 body{font-family:system-ui,Tahoma,sans-serif;background:#0b1f3a;color:#0f172a;margin:0;display:grid;place-items:center;min-height:100vh}
 .card{background:#fff;border-radius:20px;padding:28px;max-width:420px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,.35)}
 h1{font-size:18px;margin:0 0 6px} p{font-size:13px;line-height:2;color:#475569;margin:0 0 16px}
 .amount{font-size:24px;font-weight:800;margin:12px 0;color:#0b1f3a}
 .tag{display:inline-block;background:#fef3c7;color:#92400e;border-radius:999px;padding:4px 10px;font-size:11px;margin-bottom:12px}
 button{width:100%;border:0;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px}
 .pay{background:#1d4ed8;color:#fff} .cancel{background:#f1f5f9;color:#334155}
 form{margin:0}
</style></head><body><div class="card">
<div class="tag">محیط آزمایشی — هیچ پول واقعی جابه‌جا نمی‌شود</div>
<h1>شبیه‌ساز درگاه پرداخت</h1>
<p>این صفحه فقط برای آزمون سامانه است. نتیجه با استعلام سمت سرور تأیید می‌شود.</p>
<div class="amount">${amount} ریال</div>
<p>شناسه پرداخت: ${payment.id}</p>
<form method="post" action="/api/payments/sandbox/${encodeURIComponent(payment.id)}/finish">
  <input type="hidden" name="token" value="${token}">
  <button class="pay" name="decision" value="paid" type="submit">پرداخت موفق (آزمایشی)</button>
  <button class="cancel" name="decision" value="cancelled" type="submit">لغو پرداخت</button>
</form>
</div></body></html>`);
}));

paymentsRouter.post('/sandbox/:paymentId/finish', asyncRoute(async (req, res) => {
  if (env.isProd) throw forbidden('شبیه‌ساز درگاه در محیط عملیاتی غیرفعال است.');
  const body = z.object({
    token: z.string().min(10),
    decision: z.enum(['paid', 'cancelled']),
  }).parse(req.body ?? {});
  const paymentId = param(req, 'paymentId');
  const payment = await one<any>('SELECT id, purpose, amount FROM payments WHERE id=?', [paymentId]);
  if (!payment) throw notFound('تراکنش یافت نشد.');
  if (!verifySandboxToken(body.token, payment.id, Number(payment.amount))) {
    throw forbidden('توکن شبیه‌ساز درگاه معتبر نیست.');
  }
  const result = await handleGatewayCallback({
    provider: 'sandbox', paymentId, params: { token: body.token, decision: body.decision }, ip: req.ip,
  });
  const target = returnPath(payment.purpose === 'wallet_topup' ? 'wallet' : 'invoices', result.confirmed);
  res.redirect(303, target);
}));

/* --------------------------- customer payment status ---------------------- */

paymentsRouter.use(requireAuth);

paymentsRouter.get('/my/:paymentId', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden();
  ok(res, await paymentForCustomer(param(req, 'paymentId'), req.auth!.user.id));
}));

/* ------------------------------- operator -------------------------------- */

// Gateway configuration/health is financial-oversight data: `payments.view`
// alone (granted to every case expert) is not enough.
paymentsRouter.get('/admin/diagnostics', requirePermission('payments.approve'), asyncRoute(async (_req, res) => {
  ok(res, await gatewayDiagnostics());
}));

paymentsRouter.get('/admin/callbacks', requirePermission('payments.view'), asyncRoute(async (req, res) => {
  const result = await listCallbacks({
    paymentId: typeof req.query.paymentId === 'string' ? req.query.paymentId : undefined,
    provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 50),
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

/**
 * Close a legacy pending payment that can no longer be verified (historical
 * cash/POS rows). Cancellation never creates revenue and is fully audited.
 */
paymentsRouter.post('/admin/:paymentId/cancel', requirePermission('payments.cancel'), asyncRoute(async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body ?? {});
  const payment = await one<any>('SELECT * FROM payments WHERE id=?', [param(req, 'paymentId')]);
  if (!payment) throw notFound('تراکنش یافت نشد.');
  if (payment.status !== 'pending') throw badRequest('فقط تراکنش در انتظار قابل لغو است.');
  const changed = await run(
    "UPDATE payments SET status='cancelled', note=?, updated_at=? WHERE id=? AND status='pending'",
    [`${payment.note ?? ''} | لغو: ${body.reason}`.trim(), nowIso(), payment.id],
  );
  if (!changed.changes) throw badRequest('وضعیت تراکنش تغییر کرده است؛ صفحه را تازه کنید.');
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'payment.cancel',
    entityType: 'payment', entityId: payment.id, after: { reason: body.reason }, ip: req.ip,
  });
  await logEvent({
    level: 'WARNING', category: 'payment', action: 'payment.cancel', result: 'success',
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, ip: req.ip,
    entityType: 'payment', entityId: payment.id, transactionId: payment.id,
    message: 'تراکنش در انتظار لغو شد.', details: { reason: body.reason, method: payment.method },
  });
  ok(res, { message: 'تراکنش لغو شد.' });
}));
