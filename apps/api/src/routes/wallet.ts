import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { one, q, run, nowIso } from '../db/index.js';
import { param } from '../http/params.js';
import { getBool, getNumber } from '../modules/settings/service.js';
import {
  adminCreditWallet, getWalletTransaction, listWalletTransactions, reverseWalletTransaction,
  topUpLimits, walletAdminStats, walletIntegrity, walletSummary, WALLET_TYPE_LABELS,
} from '../modules/wallet/service.js';
import { payInvoiceFromWallet, startWalletTopUp, validateTopUp } from '../modules/payments/service.js';
import { providerReadiness } from '../modules/payments/providers.js';
import { writeAudit } from '../modules/audit/service.js';
import { logEvent } from '../modules/logging/service.js';

export const walletRouter = Router();
walletRouter.use(requireAuth);

const isCustomer = (req: any) => req.auth!.user.kind === 'customer';

/* ----------------------------- customer wallet ---------------------------- */

walletRouter.get('/meta', asyncRoute(async (req, res) => {
  const limits = await topUpLimits();
  const readiness = await providerReadiness();
  ok(res, {
    enabled: await getBool('wallet.enabled'),
    allowPayment: await getBool('wallet.allow_wallet_payment'),
    currency: 'IRR',
    minTopUp: limits.min,
    maxTopUp: limits.max,
    maxBalance: await getNumber('wallet.max_balance'),
    gateway: { code: readiness.code, configured: readiness.configured, sandbox: readiness.sandbox },
    types: Object.entries(WALLET_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    isCustomer: isCustomer(req),
  });
}));

walletRouter.get('/my', asyncRoute(async (req, res) => {
  if (!isCustomer(req)) throw forbidden('این بخش مخصوص مشتریان است.');
  const summary = await walletSummary(req.auth!.user.id);
  const recent = await listWalletTransactions({ customerId: req.auth!.user.id, pageSize: 10 });
  ok(res, { ...summary, recentTransactions: recent.items });
}));

walletRouter.get('/my/transactions', asyncRoute(async (req, res) => {
  if (!isCustomer(req)) throw forbidden('این بخش مخصوص مشتریان است.');
  const { page, pageSize } = pagination(req, { pageSize: 25 });
  const result = await listWalletTransactions({
    customerId: req.auth!.user.id,
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
    direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    page, pageSize,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

walletRouter.post('/my/topup/validate', asyncRoute(async (req, res) => {
  if (!isCustomer(req)) throw forbidden();
  const body = z.object({ amount: z.number() }).parse(req.body ?? {});
  ok(res, await validateTopUp(body.amount, req.auth!.user.id));
}));

walletRouter.post('/my/topup', asyncRoute(async (req, res) => {
  if (!isCustomer(req)) throw forbidden();
  const body = z.object({ amount: z.number() }).parse(req.body ?? {});
  const started = await startWalletTopUp(req.auth!.user.id, body.amount, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip,
  });
  ok(res, {
    ...started,
    message: started.sandbox
      ? 'شارژ در محیط شبیه‌ساز درگاه آغاز شد.'
      : 'برای تکمیل شارژ به درگاه پرداخت منتقل می‌شوید.',
  });
}));

walletRouter.post('/my/invoices/:id/pay', asyncRoute(async (req, res) => {
  if (!isCustomer(req)) throw forbidden();
  const result = await payInvoiceFromWallet(param(req, 'id'), req.auth!.user.id, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip,
  });
  ok(res, {
    payment: result.payment,
    invoice: result.invoice,
    wallet: await walletSummary(req.auth!.user.id),
  });
}));

/* ------------------------------ administration ---------------------------- */

walletRouter.get('/admin/summary', requirePermission('wallet.view'), asyncRoute(async (req, res) => {
  ok(res, {
    totals: await walletAdminStats({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    }),
    integrity: await walletIntegrity(),
    gateway: await providerReadiness(),
  });
}));

walletRouter.get('/admin/transactions', requirePermission('wallet.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 30 });
  const result = await listWalletTransactions({
    customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
    direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
    source: typeof req.query.source === 'string' ? req.query.source : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    page, pageSize,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

walletRouter.get('/admin/customers', requirePermission('wallet.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 25 });
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const where = ["u.kind = 'customer'"];
  const args: any[] = [];
  if (search) {
    where.push('(u.full_name LIKE ? OR u.mobile LIKE ? OR u.national_id LIKE ? OR u.username LIKE ?)');
    const needle = `%${search.slice(0, 60)}%`;
    args.push(needle, needle, needle, needle);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM users u ${clause}`, args);
  const rows = await q<any>(
    `SELECT u.id, u.full_name, u.mobile, u.status, w.id AS wallet_id, COALESCE(w.balance,0) AS balance, w.status AS wallet_status
     FROM users u LEFT JOIN wallets w ON w.customer_id = u.id ${clause}
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  ok(res, rows.map((row: any) => ({
    id: row.id, fullName: row.full_name, mobile: row.mobile, status: row.status,
    walletId: row.wallet_id, balance: Number(row.balance), walletStatus: row.wallet_status ?? 'not_created',
  })), { total: Number(total?.c ?? 0), page, pageSize });
}));

walletRouter.get('/admin/customers/:customerId', requirePermission('wallet.view'), asyncRoute(async (req, res) => {
  const customerId = param(req, 'customerId');
  const customer = await one<any>('SELECT id, full_name, mobile FROM users WHERE id=? AND kind=\'customer\'', [customerId]);
  if (!customer) throw notFound('مشتری یافت نشد.');
  const summary = await walletSummary(customerId);
  const transactions = await listWalletTransactions({ customerId, pageSize: 30 });
  ok(res, {
    customer: { id: customer.id, fullName: customer.full_name, mobile: customer.mobile },
    wallet: summary,
    transactions: transactions.items,
    transactionTotal: transactions.total,
    integrity: (await walletIntegrity()).ok ? 'balanced' : 'mismatch',
  });
}));

walletRouter.post('/admin/credit', requirePermission('wallet.credit'), asyncRoute(async (req, res) => {
  const body = z.object({
    customerId: z.string().min(3),
    amount: z.number(),
    reason: z.string().trim().min(5).max(1000),
    description: z.string().max(500).optional(),
    type: z.enum(['admin_credit', 'gift', 'correction']).optional(),
  }).parse(req.body ?? {});
  const transaction = await adminCreditWallet(body, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, role: req.auth!.user.roleCode ?? undefined, ip: req.ip,
  });
  created(res, { transaction, wallet: await walletSummary(body.customerId) });
}));

walletRouter.post('/admin/transactions/:id/reverse', requirePermission('wallet.adjust'), asyncRoute(async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(req.body ?? {});
  const transaction = await reverseWalletTransaction(param(req, 'id'), body.reason, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, role: req.auth!.user.roleCode ?? undefined, ip: req.ip,
  });
  ok(res, { transaction, message: 'اصلاحیه مالی ثبت شد.' });
}));

walletRouter.post('/admin/customers/:customerId/status', requirePermission('wallet.adjust'), asyncRoute(async (req, res) => {
  const body = z.object({ status: z.enum(['active', 'frozen']), reason: z.string().trim().min(5).max(500) }).parse(req.body ?? {});
  const customerId = param(req, 'customerId');
  const wallet = await one<any>('SELECT * FROM wallets WHERE customer_id=?', [customerId]);
  if (!wallet) throw notFound('کیف پول یافت نشد.');
  await run('UPDATE wallets SET status=?, updated_at=? WHERE id=?', [body.status, nowIso(), wallet.id]);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'wallet.status', entityType: 'wallet',
    entityId: wallet.id, before: { status: wallet.status }, after: { status: body.status, reason: body.reason }, ip: req.ip,
  });
  await logEvent({
    level: 'WARNING', category: 'wallet', action: 'wallet.status', result: 'success',
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, actorRole: req.auth!.user.roleCode, ip: req.ip,
    entityType: 'wallet', entityId: wallet.id, message: 'وضعیت کیف پول توسط مدیر تغییر کرد.',
    details: { status: body.status, reason: body.reason, customerId },
  });
  ok(res, { status: body.status });
}));

/**
 * Sandbox end-to-end test: the administrator can start a real sandbox top-up for
 * a chosen customer and complete it in the simulator. Disabled outside sandbox.
 */
walletRouter.post('/admin/test-topup', requirePermission('wallet.credit'), asyncRoute(async (req, res) => {
  const body = z.object({ customerId: z.string().min(3), amount: z.number() }).parse(req.body ?? {});
  const readiness = await providerReadiness();
  if (readiness.code !== 'sandbox' || !readiness.configured) {
    throw badRequest('آزمون تراکنش فقط در حالت شبیه‌ساز درگاه (Sandbox) ممکن است.');
  }
  if (!(await getBool('accounting.gateway_sandbox'))) throw badRequest('حالت آزمایشی درگاه فعال نیست.');
  const customer = await one<any>('SELECT id, full_name FROM users WHERE id=? AND kind=\'customer\'', [body.customerId]);
  if (!customer) throw notFound('مشتری یافت نشد.');
  if (!Number.isInteger(body.amount) || body.amount <= 0) throw badRequest('مبلغ آزمون باید عدد صحیح ریالی باشد.');
  const started = await startWalletTopUp(body.customerId, body.amount, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip,
  });
  await logEvent({
    level: 'INFO', category: 'gateway', action: 'payment.sandbox.test', result: 'success',
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, actorRole: req.auth!.user.roleCode, ip: req.ip,
    entityType: 'payment', entityId: started.paymentId, transactionId: started.paymentId,
    message: 'تراکنش آزمایشی درگاه آغاز شد.', details: { customerId: body.customerId, amount: body.amount },
  });
  ok(res, { ...started, customer: { id: customer.id, fullName: customer.full_name } });
}));

walletRouter.get('/admin/transactions/:id', requirePermission('wallet.view'), asyncRoute(async (req, res) => {
  const transaction = await getWalletTransaction(param(req, 'id'));
  if (!transaction) throw notFound('تراکنش کیف پول یافت نشد.');
  ok(res, transaction);
}));
