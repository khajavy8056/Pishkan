import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth } from '../http/middleware.js';
import { forbidden } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { param } from '../http/params.js';
import { writeAudit } from '../modules/audit/service.js';
import { getBool } from '../modules/settings/service.js';
import {
  DEPARTMENTS, DEPARTMENT_LABELS, PRIORITIES, TICKET_STATUSES,
  createTicket, getTicket, listTickets, rateTicket, replyToTicket, supportStats, updateTicket,
} from '../modules/support/service.js';

export const supportRouter = Router();
supportRouter.use(requireAuth);

/**
 * Every support route authorises inside the service (customers only ever see
 * their own tickets; staff need the `support.*` grants), so this router only
 * shapes input and writes audit rows.
 */
const actorOf = (req: any) => ({
  id: req.auth.user.id,
  name: req.auth.user.fullName,
  kind: req.auth.user.kind,
  permissions: req.auth.permissions,
});

async function assertSupportEnabled() {
  if (!(await getBool('support.enabled'))) throw forbidden('بخش پشتیبانی در حال حاضر غیرفعال است.');
}

supportRouter.get('/meta', asyncRoute(async (_req, res) => {
  ok(res, {
    departments: DEPARTMENTS.map((value) => ({ value, label: DEPARTMENT_LABELS[value] })),
    priorities: PRIORITIES.map((value) => ({
      value,
      label: value === 'low' ? 'کم' : value === 'normal' ? 'معمولی' : value === 'high' ? 'زیاد' : 'فوری',
    })),
    statuses: TICKET_STATUSES.map((value) => ({
      value,
      label: value === 'open' ? 'باز' : value === 'answered' ? 'پاسخ داده‌شده' : value === 'waiting_customer' ? 'در انتظار پاسخ شما' : value === 'resolved' ? 'حل‌شده' : 'بسته‌شده',
    })),
    enabled: await getBool('support.enabled'),
  });
}));

supportRouter.get('/stats', asyncRoute(async (req, res) => {
  ok(res, await supportStats(actorOf(req)));
}));

supportRouter.get('/tickets', asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req);
  const result = await listTickets({
    actor: actorOf(req),
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    department: typeof req.query.department === 'string' ? req.query.department : undefined,
    priority: typeof req.query.priority === 'string' ? req.query.priority : undefined,
    mine: req.query.mine === 'true',
    unassigned: req.query.unassigned === 'true',
    query: typeof req.query.q === 'string' ? req.query.q : undefined,
    page, pageSize,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

supportRouter.post('/tickets', asyncRoute(async (req, res) => {
  await assertSupportEnabled();
  if (req.auth!.user.kind !== 'customer') throw forbidden('ثبت تیکت از این مسیر برای مشتریان است.');
  const body = z.object({
    department: z.enum(DEPARTMENTS),
    subject: z.string().min(3).max(160),
    body: z.string().min(5).max(5000),
    priority: z.enum(PRIORITIES).optional(),
    requestId: z.string().nullable().optional(),
    fileId: z.string().optional(),
  }).parse(req.body);
  const ticket = await createTicket({ customerId: req.auth!.user.id, ...body }, actorOf(req));
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'support.create',
    entityType: 'support_ticket', entityId: ticket.id, after: { number: ticket.number, department: ticket.department }, ip: req.ip,
  });
  created(res, ticket);
}));

supportRouter.get('/tickets/:id', asyncRoute(async (req, res) => {
  ok(res, await getTicket(param(req, 'id'), actorOf(req)));
}));

supportRouter.post('/tickets/:id/reply', asyncRoute(async (req, res) => {
  const body = z.object({
    body: z.string().min(2).max(5000),
    fileId: z.string().optional(),
    internal: z.boolean().optional(),
  }).parse(req.body);
  const ticket = await replyToTicket(param(req, 'id'), body, actorOf(req));
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: body.internal ? 'support.note' : 'support.reply',
    entityType: 'support_ticket', entityId: ticket.id, ip: req.ip,
  });
  ok(res, ticket);
}));

supportRouter.patch('/tickets/:id', asyncRoute(async (req, res) => {
  const body = z.object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    department: z.enum(DEPARTMENTS).optional(),
    assignedTo: z.string().nullable().optional(),
  }).parse(req.body);
  const ticket = await updateTicket(param(req, 'id'), body, actorOf(req));
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'support.update',
    entityType: 'support_ticket', entityId: ticket.id, after: body, ip: req.ip,
  });
  ok(res, ticket);
}));

supportRouter.post('/tickets/:id/rate', asyncRoute(async (req, res) => {
  const body = z.object({
    rating: z.number().int().min(1).max(5),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  ok(res, await rateTicket(param(req, 'id'), body, actorOf(req)));
}));
