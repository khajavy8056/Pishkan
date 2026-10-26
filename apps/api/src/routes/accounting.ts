import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { created, dateRange, ok, pagination } from '../http/respond.js';
import { one, q, run, nowIso } from '../db/index.js';
import { hasPermission } from '../lib/permissions.js';
import {
  confirmPayment, createExpense, createInvoice, createPayment, expenseCategories, financeSummary,
  getInvoice, listExpenses, listInvoices, listPayments, reconciliation, refundPayment,
  revenueByService, revenueByStaff, voidInvoice,
} from '../modules/accounting/service.js';
import { getBool, getNumber, getString } from '../modules/settings/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { notifyUser } from '../modules/notifications/service.js';
import { param } from '../http/params.js';

import { startZarinpal, verifyZarinpal } from '../modules/accounting/zarinpal.js';
export const accountingRouter = Router();
accountingRouter.get('/gateway/zarinpal', asyncRoute(async (req,res) => {
 const result = await verifyZarinpal(String(req.query.paymentId ?? ''),String(req.query.Authority ?? ''),String(req.query.Status ?? ''));
 res.redirect(303,`/app/invoices?payment=${result.confirmed ? 'confirmed':'unconfirmed'}`);
}));
accountingRouter.use(requireAuth);

/* ------------------------- customer self-service -------------------------- */

accountingRouter.get('/my/invoices', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden('این مسیر مخصوص مشتریان است.');
  const result = await listInvoices({ customerId: req.auth!.user.id, ...pagination(req) });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

accountingRouter.get('/my/payments', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden('این مسیر مخصوص مشتریان است.');
  const result = await listPayments({ customerId: req.auth!.user.id, ...pagination(req) });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

/** Start an online payment for an invoice (amount is always read server-side). */
accountingRouter.post('/my/invoices/:id/pay', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden();
  if (!(await getBool('accounting.online_payment_enabled'))) throw badRequest('پرداخت آنلاین در حال حاضر فعال نیست.');
  const invoice = await getInvoice(param(req, 'id'));
  if (!invoice || invoice.customerId !== req.auth!.user.id) throw notFound('فاکتور یافت نشد.');
  if (invoice.remaining <= 0) throw badRequest('این فاکتور تسویه شده است.');

  const min = await getNumber('accounting.min_online_payment');
  if (invoice.remaining < min) throw badRequest(`حداقل مبلغ پرداخت آنلاین ${min} ریال است.`);

  const gateway = await getString('accounting.gateway');
  if (gateway === 'zarinpal') return ok(res,await startZarinpal(invoice.id,req.auth!.user.id));
  if (gateway !== 'test' || !(await getBool('accounting.gateway_sandbox')) || process.env.NODE_ENV === 'production') throw badRequest('درگاه واقعی انتخاب‌شده پیاده‌سازی یا پیکربندی نشده است.');
  const payment = await createPayment({invoiceId:invoice.id,customerId:invoice.customerId,amount:invoice.remaining,method:'online',gateway:'mock'},{id:req.auth!.user.id,name:req.auth!.user.fullName});
  ok(res,{paymentId:payment.id,paymentUrl:null,message:'پرداخت شبیه‌سازی است؛ لینک بانکی واقعی وجود ندارد.'});
}));

/**
 * Gateway callback endpoint. A payment is only treated as successful after the
 * gateway proves the transaction. The `mock` gateway exists for development and
 * is rejected in production.
 */
accountingRouter.post('/payments/callback/:gateway', asyncRoute(async (req, res) => {
  const gatewayName = param(req, 'gateway');
  const body = z.object({
    paymentId: z.string(),
    success: z.union([z.boolean(), z.string()]).optional(),
    reference: z.string().optional(),
    authority: z.string().optional(),
  }).parse(req.body);

  if (gatewayName === 'mock') {
    if (process.env.NODE_ENV === 'production') throw forbidden('درگاه آزمایشی در محیط عملیاتی غیرفعال است.');
    const payment = await one<any>('SELECT * FROM payments WHERE id = ?', [body.paymentId]);
    if (!payment) throw notFound('تراکنش یافت نشد.');
    if (payment.gateway !== 'mock' || await getString('accounting.gateway') !== 'test' || !(await getBool('accounting.gateway_sandbox'))) throw forbidden('پرداخت متعلق به درگاه آزمایشی نیست.');
    if (body.success === false || body.success === 'false') {
      await run('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?', ['failed', nowIso(), payment.id]);
      return ok(res, { status: 'failed' });
    }
    const confirmed = await confirmPayment(payment.id, { id: 'system', name: 'درگاه آزمایشی', ip: req.ip }, body.reference ?? 'MOCK-REF');
    await notifyUser(payment.customer_id, {
      title: 'پرداخت با موفقیت ثبت شد',
      body: `مبلغ ${Number(payment.amount).toLocaleString('fa-IR')} ریال`,
      kind: 'success',
      link: '/app/payments',
    }).catch(() => undefined);
    return ok(res, confirmed);
  }

  throw badRequest('درگاه پرداخت پشتیبانی نمی‌شود.');
}));

// Office accounting is distinct from personal compensation. A permission to
// work on cases never grants access to the full office ledger.
accountingRouter.use((req, _res, next) => {
  if (req.auth!.permissions === '*' || ['super_admin', 'manager', 'accountant'].includes(req.auth!.user.roleCode ?? '')) return next();
  next(forbidden('حسابداری کل دفتر فقط برای نقش‌های مدیریتی و مالی مجاز است.'));
});

/* -------------------------------- invoices -------------------------------- */

accountingRouter.get('/invoices', requirePermission('invoices.view'), asyncRoute(async (req, res) => {
  const result = await listInvoices({
    ...pagination(req, { pageSize: 25 }),
    customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    ...dateRange(req),
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

accountingRouter.get('/invoices/:id', requirePermission('invoices.view'), asyncRoute(async (req, res) => {
  const invoice = await getInvoice(param(req, 'id'));
  if (!invoice) throw notFound('فاکتور یافت نشد.');
  const customer = await one<any>('SELECT full_name, mobile, national_id FROM users WHERE id = ?', [invoice.customerId]);
  ok(res, { ...invoice, customer });
}));

accountingRouter.post('/invoices', requirePermission('invoices.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    customerId: z.string().min(3),
    requestId: z.string().optional(),
    serviceId: z.string().optional(),
    title: z.string().min(2).max(200),
    items: z.array(z.object({
      title: z.string().min(1).max(200),
      qty: z.number().positive().optional(),
      unitPrice: z.number().min(0),
    })).optional(),
    subtotal: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
    taxPercent: z.number().min(0).max(50).optional(),
    dueAt: z.string().optional(),
    notes: z.string().max(2000).optional(),
    issue: z.boolean().optional(),
  }).parse(req.body);

  const customer = await one('SELECT id FROM users WHERE id = ? AND kind = ?', [body.customerId, 'customer']);
  if (!customer) throw badRequest('مشتری انتخابی معتبر نیست.');

  const invoice = await createInvoice({
    ...body,
    kind: body.requestId ? 'public' : 'custom',
    items: body.items?.map((i) => ({ title: i.title, qty: i.qty ?? 1, unitPrice: i.unitPrice, amount: (i.qty ?? 1) * i.unitPrice })),
  }, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });

  created(res, invoice);
}));

accountingRouter.post('/invoices/:id/void', requirePermission('invoices.cancel'), asyncRoute(async (req, res) => {
  const body = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
  await voidInvoice(param(req, 'id'), body.reason, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  ok(res, { message: 'فاکتور لغو شد.' });
}));

/* -------------------------------- payments -------------------------------- */

accountingRouter.get('/payments', requirePermission('payments.view'), asyncRoute(async (req, res) => {
  const result = await listPayments({
    ...pagination(req, { pageSize: 25 }),
    customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    method: typeof req.query.method === 'string' ? req.query.method : undefined,
    ...dateRange(req),
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

/** Manual (in-person) payment registration by an authorised staff member. */
accountingRouter.post('/payments', requirePermission('payments.create'), asyncRoute(async (req, res) => {
  if (!(await getBool('accounting.cash_payment_enabled'))) throw badRequest('ثبت پرداخت حضوری غیرفعال است.');
  const body = z.object({
    customerId: z.string().min(3),
    invoiceId: z.string().optional(),
    requestId: z.string().optional(),
    amount: z.number().positive(),
    method: z.enum(['cash', 'pos', 'transfer', 'online']),
    reference: z.string().max(120).optional(),
    note: z.string().max(1000).optional(),
  }).parse(req.body);

  if (body.method === 'online') {
    const payment = await createPayment({ ...body, status: 'pending' }, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
    return created(res, payment);
  }

  const payment = await createPayment({ ...body, status: 'confirmed' }, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  await notifyUser(body.customerId, {
    title: 'پرداخت شما ثبت شد',
    body: `مبلغ ${Number(body.amount).toLocaleString('fa-IR')} ریال — ${body.method === 'cash' ? 'نقدی' : body.method === 'pos' ? 'کارتخوان' : 'کارت به کارت'}`,
    kind: 'success',
    link: '/app/payments',
  }).catch(() => undefined);
  created(res, payment);
}));

accountingRouter.post('/payments/:id/confirm', requirePermission('payments.approve'), asyncRoute(async (req, res) => {
  const body = z.object({ reference: z.string().max(120).optional() }).parse(req.body ?? {});
  const pending = await one<any>('SELECT * FROM payments WHERE id=?',[param(req,'id')]);
  if (pending?.method === 'online' && pending.gateway !== 'mock') throw forbidden('پرداخت آنلاین فقط با تأیید سروری درگاه قابل تأیید است.');
  const payment = await confirmPayment(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }, body.reference);
  ok(res, payment);
}));

accountingRouter.post('/payments/:id/refund', requirePermission('payments.cancel'), asyncRoute(async (req, res) => {
  const body = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
  await refundPayment(param(req, 'id'), body.reason, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  ok(res, { message: 'بازپرداخت ثبت شد.' });
}));

/* -------------------------------- expenses -------------------------------- */

accountingRouter.get('/expenses', requirePermission('expenses.view'), asyncRoute(async (req, res) => {
  const result = await listExpenses({
    ...pagination(req, { pageSize: 25 }),
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

accountingRouter.get('/expenses/categories', requirePermission('expenses.view'), asyncRoute(async (_req, res) => {
  ok(res, await expenseCategories());
}));

accountingRouter.post('/expenses', requirePermission('expenses.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    title: z.string().min(2).max(200),
    amount: z.number().positive(),
    categoryId: z.string().optional(),
    spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    method: z.enum(['cash', 'pos', 'transfer']).optional(),
    reference: z.string().max(120).optional(),
    note: z.string().max(1000).optional(),
  }).parse(req.body);
  const expenseId = await createExpense(body, { id: req.auth!.user.id, name: req.auth!.user.fullName });
  created(res, { id: expenseId });
}));

/* --------------------------------- reports -------------------------------- */

accountingRouter.get('/reports/summary', requirePermission('reports.view'), asyncRoute(async (req, res) => {
  const range = dateRange(req);
  const [summary, byService, byStaff] = await Promise.all([
    financeSummary(range),
    revenueByService(range),
    revenueByStaff(range),
  ]);
  const monthly = await q<any>(
    `SELECT substr(created_at, 1, 7) AS month, SUM(amount) AS total, COUNT(*) AS c
     FROM payments WHERE status = 'confirmed' GROUP BY substr(created_at, 1, 7) ORDER BY month DESC LIMIT 12`,
  );
  ok(res, {
    summary,
    byService,
    byStaff,
    monthly: monthly.reverse().map((m) => ({ month: m.month, total: Number(m.total), count: Number(m.c) })),
  });
}));

accountingRouter.get('/reports/reconciliation', requirePermission('reports.view'), asyncRoute(async (_req, res) => {
  ok(res, await reconciliation());
}));

accountingRouter.get('/reports/transactions', requirePermission('reports.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 50 });
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const rows = await q<any>(
    `SELECT l.*, '' AS dummy FROM ledger_entries l ORDER BY l.entry_date DESC LIMIT ? OFFSET ?`, [limit, offset],
  );
  const total = await one<{ c: number }>('SELECT COUNT(*) AS c FROM ledger_entries');
  ok(res, rows.map((r) => ({
    id: r.id, date: r.entry_date, account: r.account, direction: r.direction,
    amount: Number(r.amount), refType: r.ref_type, refId: r.ref_id, description: r.description,
  })), { total: Number(total?.c ?? 0), page, pageSize });
}));

/** CSV export (Excel-friendly, UTF-8 with BOM added by the client if needed). */
accountingRouter.get('/reports/export', requirePermission('reports.export', 'invoices.export'), asyncRoute(async (req, res) => {
  const type = String(req.query.type ?? 'invoices');
  const range = dateRange(req);
  const from = range.from ?? '1970-01-01';
  const to = range.to ?? '2999-12-31';

  let rows: any[] = [];
  let header: string[] = [];
  if (type === 'invoices') {
    header = ['شماره فاکتور', 'مشتری', 'عنوان', 'مبلغ کل', 'پرداخت‌شده', 'وضعیت', 'تاریخ'];
    rows = await q<any>(
      `SELECT i.number, u.full_name, i.title, i.total, i.paid_amount, i.status, i.created_at
       FROM invoices i JOIN users u ON u.id = i.customer_id
       WHERE i.created_at >= ? AND i.created_at <= ? ORDER BY i.created_at DESC`, [from, `${to}T23:59:59.999Z`],
    );
  } else if (type === 'payments') {
    header = ['مشتری', 'مبلغ', 'روش', 'وضعیت', 'شماره پیگیری', 'تاریخ'];
    rows = await q<any>(
      `SELECT u.full_name, p.amount, p.method, p.status, p.reference, p.created_at
       FROM payments p JOIN users u ON u.id = p.customer_id
       WHERE p.created_at >= ? AND p.created_at <= ? ORDER BY p.created_at DESC`, [from, `${to}T23:59:59.999Z`],
    );
  } else if (type === 'expenses') {
    header = ['عنوان', 'دسته', 'مبلغ', 'تاریخ'];
    rows = await q<any>(
      `SELECT e.title, c.title AS category, e.amount, e.spent_on
       FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.spent_on >= ? AND e.spent_on <= ? ORDER BY e.spent_on DESC`, [from, to],
    );
  } else {
    throw badRequest('نوع گزارش پشتیبانی نمی‌شود.');
  }

  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'report.export',
    entityType: 'report', entityId: type, after: { from, to, rows: rows.length }, ip: req.ip,
  });

  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header.map(escape).join(','), ...rows.map((r) => Object.values(r).map(escape).join(','))].join('\r\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="pishkan-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}`);
}));

/** Accounting policy for the UI. */
accountingRouter.get('/meta/settings', asyncRoute(async (req, res) => {
  if (!hasPermission(req.auth!.permissions, 'invoices.view') && req.auth!.user.kind === 'customer') throw forbidden();
  ok(res, {
    onlineEnabled: await getBool('accounting.online_payment_enabled'),
    cashEnabled: await getBool('accounting.cash_payment_enabled'),
    gateway: await getString('accounting.gateway'),
    taxPercent: await getNumber('accounting.tax_percent'),
    allowRefund: await getBool('accounting.allow_refund'),
    invoicePrefix: await getString('accounting.invoice_prefix'),
    currencyLabel: await getString('site.currency_label'),
    revenueRecognition: await getString('accounting.revenue_recognition'),
  });
}));
