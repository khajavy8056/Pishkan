import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden } from '../http/errors.js';
import {
  accrueMonth, closeContract, compensation, contractHistory, createContract, settle,
} from '../modules/payroll/service.js';
import {
  advanceWithdrawal, createWithdrawal, incomeEntries, incomeSummary, listWithdrawals, payWithdrawal,
  payrollOverview, payrollReports, recordSalaryPayment, salaryHistory, staffDashboard, staffFile,
  withdrawalDetail, withdrawableBalance,
} from '../modules/payroll/earnings.js';
import { created, ok } from '../http/respond.js';
import { q } from '../db/index.js';
import { param } from '../http/params.js';
import { hasPermission } from '../lib/permissions.js';
import { todayIso } from '../modules/payroll/compensation.js';

export const payrollRouter = Router();
payrollRouter.use(requireAuth, (req, _res, next) => {
  if (req.auth!.user.kind === 'customer') return next(forbidden());
  next();
});

/* ------------------------------ my own money ------------------------------ */

/** Every employee may read their own compensation summary. */
payrollRouter.get('/me', asyncRoute(async (req, res) => {
  ok(res, await compensation(req.auth!.user.id));
}));

/**
 * The cooperation-aware staff dashboard: performance for everyone, income and
 * withdrawals only for percentage employees, salary history only for monthly
 * employees. The API decides, not the browser.
 */
payrollRouter.get('/me/summary', asyncRoute(async (req, res) => {
  ok(res, await staffDashboard(req.auth!.user.id));
}));

payrollRouter.get('/me/earnings', asyncRoute(async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  ok(res, {
    entries: await incomeEntries(req.auth!.user.id, { from, to }),
    summary: await incomeSummary(req.auth!.user.id),
    balance: await withdrawableBalance(req.auth!.user.id),
    salary: await salaryHistory(req.auth!.user.id).catch(() => null),
  });
}));

payrollRouter.get('/me/withdrawals', asyncRoute(async (req, res) => {
  ok(res, (await listWithdrawals({ userId: req.auth!.user.id, pageSize: 50 })).items);
}));

payrollRouter.post('/me/withdrawals', asyncRoute(async (req, res) => {
  const body = z.object({
    amount: z.number().int().positive().max(1e12),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  const user = req.auth!.user;
  created(res, await createWithdrawal(user.id, body.amount, body.note, { id: user.id, name: user.fullName }));
}));

/** The employee may cancel their own request while it is still undecided. */
payrollRouter.post('/me/withdrawals/:id/cancel', asyncRoute(async (req, res) => {
  const detail = await withdrawalDetail(param(req, 'id'), req.auth!.user.id);
  if (!['submitted', 'reviewing'].includes(detail.status)) throw badRequest('این درخواست دیگر قابل لغو نیست.');
  const body = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
  ok(res, await advanceWithdrawal(detail.id, 'cancel', { id: req.auth!.user.id, name: req.auth!.user.fullName }, body));
}));

payrollRouter.get('/me/salary', asyncRoute(async (req, res) => {
  ok(res, await salaryHistory(req.auth!.user.id));
}));

/* ------------------------------ staff directory --------------------------- */

payrollRouter.get('/staff', requirePermission('payroll.view'), asyncRoute(async (_req, res) => {
  const today = todayIso();
  const rows = await q<any>(
    `SELECT u.id, u.full_name, r.code AS role_code,
            (SELECT kind FROM compensation_contracts c WHERE c.user_id=u.id AND c.is_active=1
               AND c.starts_on<=? AND (c.ends_on IS NULL OR c.ends_on>=?) ORDER BY c.starts_on DESC LIMIT 1) AS contract_kind
     FROM users u LEFT JOIN roles r ON r.id=u.role_id
     WHERE u.kind IN ('staff','admin') ORDER BY u.full_name`,
    [today, today],
  );
  ok(res, rows.map((row) => ({
    id: row.id, fullName: row.full_name, roleCode: row.role_code,
    cooperationType: row.contract_kind === 'commission' ? 'commission' : row.contract_kind === 'monthly' ? 'monthly' : 'none',
  })));
}));

payrollRouter.get('/staff/:id', requirePermission('payroll.view'), asyncRoute(async (req, res) => {
  ok(res, await compensation(String(req.params.id)));
}));

/** Full cooperation-aware file: profile, performance, income, salary, withdrawals. */
payrollRouter.get('/staff/:id/file', requirePermission('payroll.view'), asyncRoute(async (req, res) => {
  ok(res, await staffFile(String(req.params.id)));
}));

payrollRouter.get('/overview', requirePermission('payroll.view'), asyncRoute(async (_req, res) => {
  ok(res, await payrollOverview());
}));

payrollRouter.get('/reports', requirePermission('payroll.reports.view'), asyncRoute(async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  ok(res, await payrollReports({ from, to }));
}));

/* ------------------------------- withdrawals ------------------------------ */

payrollRouter.get('/withdrawals', requirePermission('payroll.view'), asyncRoute(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  ok(res, await listWithdrawals({
    userId: typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined,
    status: typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined,
    from: typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined,
    to: typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined,
    minAmount: req.query.minAmount ? Number(req.query.minAmount) : undefined,
    page: Number.isFinite(page) ? page : 1,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : 25,
  }));
}));

payrollRouter.get('/withdrawals/:id', asyncRoute(async (req, res) => {
  const user = req.auth!.user;
  const isOwner = (await withdrawalDetail(param(req, 'id'))).userId === user.id;
  if (!isOwner && !hasPermission(req.auth!.permissions, 'payroll.view')) throw forbidden();
  ok(res, await withdrawalDetail(param(req, 'id')));
}));

/** review | approve | reject — accounting and the manager. */
payrollRouter.post('/withdrawals/:id/decision', requirePermission('payroll.approve'), asyncRoute(async (req, res) => {
  const body = z.object({
    action: z.enum(['review', 'approve', 'reject', 'paying']),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  const actor = { id: req.auth!.user.id, name: req.auth!.user.fullName };
  ok(res, await advanceWithdrawal(param(req, 'id'), body.action, actor, { note: body.note }));
}));

/** pay — the actual payout; requires the settlement permission. */
payrollRouter.post('/withdrawals/:id/pay', requirePermission('payroll.settle'), asyncRoute(async (req, res) => {
  const body = z.object({
    method: z.string().min(2).max(40),
    trackingCode: z.string().min(3).max(60),
    paidAt: z.string().datetime().optional(),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  const actor = { id: req.auth!.user.id, name: req.auth!.user.fullName };
  ok(res, await payWithdrawal(param(req, 'id'), body, actor));
}));

/* ------------------------------ salary payments --------------------------- */

payrollRouter.get('/salary-payments', requirePermission('payroll.view'), asyncRoute(async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  ok(res, userId ? await salaryHistory(userId) : {
    staff: await q<any>(
      `SELECT DISTINCT ce.user_id AS id, u.full_name FROM compensation_entries ce
       JOIN users u ON u.id=ce.user_id WHERE ce.kind='salary' ORDER BY u.full_name`,
    ),
  });
}));

payrollRouter.post('/salary-payments', requirePermission('payroll.settle'), asyncRoute(async (req, res) => {
  const body = z.object({
    userId: z.string().min(1),
    periodMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    amount: z.number().int().positive().max(1e12),
    method: z.string().min(2).max(40),
    trackingCode: z.string().min(3).max(60),
    paidAt: z.string().datetime().optional(),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  const actor = { id: req.auth!.user.id, name: req.auth!.user.fullName };
  created(res, await recordSalaryPayment(body, actor));
}));

/* -------------------------------- contracts ------------------------------- */

const date = z.string().date();

payrollRouter.get('/contracts/:userId/history', requirePermission('payroll.view'), asyncRoute(async (req, res) => {
  ok(res, await contractHistory(String(req.params.userId)));
}));

payrollRouter.post('/contracts', requirePermission('payroll.contracts.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    userId: z.string(),
    kind: z.enum(['monthly', 'commission']),
    monthlyAmount: z.number().int().min(0).max(1e12).default(0),
    commissionPercent: z.number().int().min(0).max(100).default(0),
    startsOn: date,
    endsOn: date.optional(),
    settlementPeriod: z.enum(['daily', 'weekly', 'monthly', 'custom']).optional(),
    settlementDays: z.number().int().min(0).max(365).optional(),
    minWithdrawal: z.number().int().min(0).max(1e12).optional(),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  created(res, await createContract(body, req.auth!.user.id, req.auth!.user.fullName));
}));

payrollRouter.post('/contracts/:id/close', requirePermission('payroll.contracts.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ endsOn: date }).parse(req.body);
  ok(res, await closeContract(param(req, 'id'), body.endsOn, { id: req.auth!.user.id, name: req.auth!.user.fullName }));
}));

payrollRouter.post('/accrue', requirePermission('payroll.accrue'), asyncRoute(async (req, res) => {
  const body = z.object({ month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/) }).parse(req.body);
  ok(res, await accrueMonth(body.month, req.auth!.user.id));
}));

payrollRouter.post('/settlements', requirePermission('payroll.settle'), asyncRoute(async (req, res) => {
  const body = z.object({
    userId: z.string(), amount: z.number().int().positive().max(1e12),
    idempotencyKey: z.string().min(12).max(120), note: z.string().min(3).max(500),
  }).parse(req.body);
  created(res, await settle(body.userId, body.amount, body.idempotencyKey, body.note, req.auth!.user.id));
}));
