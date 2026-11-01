import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { forbidden, notFound } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { param } from '../http/params.js';
import { writeAudit } from '../modules/audit/service.js';
import {
  createDiscountCode, deleteDiscountCode, discountCodeUsages, listDiscountCodes,
  previewDiscount, updateDiscountCode,
} from '../modules/discounts/service.js';
import { getServiceById } from '../modules/catalog/service.js';

export const discountsRouter = Router();
discountsRouter.use(requireAuth);

const codeSchema = z.object({
  code: z.string().min(3).max(40),
  title: z.string().min(2).max(120),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  maxDiscount: z.number().int().positive().nullable().optional(),
  minAmount: z.number().int().min(0).optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().min(1).max(100).optional(),
  serviceId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

discountsRouter.get('/', requirePermission('discounts.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req);
  const result = await listDiscountCodes({
    query: typeof req.query.q === 'string' ? req.query.q : undefined, page, pageSize,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

discountsRouter.post('/', requirePermission('discounts.create'), asyncRoute(async (req, res) => {
  const body = codeSchema.parse(req.body);
  const code = await createDiscountCode(body, { id: req.auth!.user.id, name: req.auth!.user.fullName });
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'discount.create',
    entityType: 'discount_code', entityId: code.id, after: { code: code.code, type: code.type, value: code.value }, ip: req.ip,
  });
  created(res, code);
}));

discountsRouter.patch('/:id', requirePermission('discounts.edit'), asyncRoute(async (req, res) => {
  const body = codeSchema.partial().parse(req.body);
  const code = await updateDiscountCode(param(req, 'id'), body);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'discount.update',
    entityType: 'discount_code', entityId: code.id, after: { code: code.code, isActive: code.isActive }, ip: req.ip,
  });
  ok(res, code);
}));

discountsRouter.delete('/:id', requirePermission('discounts.delete'), asyncRoute(async (req, res) => {
  const result = await deleteDiscountCode(param(req, 'id'));
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'discount.delete',
    entityType: 'discount_code', entityId: param(req, 'id'), after: result, ip: req.ip,
  });
  ok(res, { message: result.deactivated ? 'کد دارای سابقهٔ استفاده است و به‌جای حذف، غیرفعال شد.' : 'کد تخفیف حذف شد.', ...result });
}));

discountsRouter.get('/:id/usages', requirePermission('discounts.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req);
  const result = await discountCodeUsages(param(req, 'id'), { page, pageSize });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

/**
 * Customer checkout preview: validate a code against a service and return how
 * much it would take off. Creating the request re-validates server-side, so
 * this endpoint can never be used to force a price.
 */
discountsRouter.post('/preview', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden('پیش‌نمایش کد تخفیف برای مشتریان است.');
  const body = z.object({
    code: z.string().min(1).max(40),
    serviceId: z.string().min(3),
    priority: z.enum(['normal', 'high']).optional(),
  }).parse(req.body);
  const service = await getServiceById(body.serviceId);
  if (!service) throw notFound('خدمت یافت نشد.');
  const urgentFee = body.priority === 'high' ? Math.round(service.baseFee * service.urgentPercent / 100) : 0;
  const serviceDiscount = Math.round(service.baseFee * service.discountPercent / 100);
  const subtotal = Math.max(0, service.baseFee + urgentFee - serviceDiscount);
  const preview = await previewDiscount({
    code: body.code, customerId: req.auth!.user.id,
    serviceId: service.id, categoryId: service.categoryId, subtotal,
  });
  ok(res, { ...preview, subtotal, payableBeforeTax: subtotal - preview.amount });
}));
