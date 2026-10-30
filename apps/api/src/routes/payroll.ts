import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { forbidden } from '../http/errors.js';
import { compensation, createContract, accrueMonth, settle } from '../modules/payroll/service.js';
import { created, ok } from '../http/respond.js';
import { q } from '../db/index.js';

export const payrollRouter = Router();
payrollRouter.use(requireAuth, (req, _res, next) => {
  if (req.auth!.user.kind === 'customer') return next(forbidden());
  next();
});

// Every employee may read their own compensation summary, but access to other
// employees is separately granted by payroll.view.
payrollRouter.get('/me', asyncRoute(async (req, res) => {
  ok(res, await compensation(req.auth!.user.id));
}));

payrollRouter.get('/staff', requirePermission('payroll.view'), asyncRoute(async (_req, res) => {
  ok(res, await q("SELECT id,full_name FROM users WHERE kind='staff' ORDER BY full_name"));
}));
payrollRouter.get('/staff/:id', requirePermission('payroll.view', 'payroll.reports.view'), asyncRoute(async (req, res) => {
  ok(res, await compensation(String(req.params.id)));
}));

const date = z.string().date();
payrollRouter.post('/contracts', requirePermission('payroll.contracts.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    userId: z.string(), kind: z.enum(['monthly', 'commission']),
    monthlyAmount: z.number().int().min(0).max(1e12).default(0),
    commissionPercent: z.number().int().min(0).max(100).default(0),
    startsOn: date, endsOn: date.optional(),
  }).parse(req.body);
  created(res, await createContract(body, req.auth!.user.id));
}));
payrollRouter.post('/accrue', requirePermission('payroll.accrue'), asyncRoute(async (req, res) => {
  const body = z.object({ month: z.string().regex(/^20\\d{2}-(0[1-9]|1[0-2])$/) }).parse(req.body);
  ok(res, await accrueMonth(body.month, req.auth!.user.id));
}));
payrollRouter.post('/settlements', requirePermission('payroll.settle'), asyncRoute(async (req, res) => {
  const body = z.object({
    userId: z.string(), amount: z.number().int().positive().max(1e12),
    idempotencyKey: z.string().min(12).max(120), note: z.string().min(3).max(500),
  }).parse(req.body);
  created(res, await settle(body.userId, body.amount, body.idempotencyKey, body.note, req.auth!.user.id));
}));
