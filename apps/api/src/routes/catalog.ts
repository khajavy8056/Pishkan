import { officeScope } from '../lib/scope.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { tx, one, q, run, nowIso } from '../db/index.js';
import {
  archiveService, createCategory, createCustomService, createService, getServiceById,
  listCategories, listServices, updateCategory, updateService,
} from '../modules/catalog/service.js';
import { hasPermission } from '../lib/permissions.js';
import { getBool, getNumber } from '../modules/settings/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { notifyUser } from '../modules/notifications/service.js';
import { createInvoice, getInvoice } from '../modules/accounting/service.js';
import { addEvent, createRequest, getRequest } from '../modules/requests/service.js';
import { id } from '../lib/crypto.js';
import { param } from '../http/params.js';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);
catalogRouter.post('/cities', requirePermission('services.edit'), asyncRoute(async (req,res) => {
  const body=z.object({name:z.string().min(2).max(80),province:z.string().min(2).max(80)}).parse(req.body);
  const cityId=id('city');
  await run('INSERT INTO cities(id,name,province) VALUES(?,?,?)',[cityId,body.name.trim(),body.province.trim()]);
  created(res,{id:cityId,...body});
}));

/* ------------------------------ admin: read ------------------------------- */

catalogRouter.get('/admin/categories', requirePermission('categories.view'), asyncRoute(async (_req, res) => {
  ok(res, await listCategories({ includeInactive: true }));
}));

catalogRouter.get('/admin/services', requirePermission('services.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 30 });
  const result = await listServices({
    page, pageSize,
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    sort: 'order',
  });
  ok(res, result.items, { total: result.total, page, pageSize });
}));

catalogRouter.get('/admin/services/:id', requirePermission('services.view'), asyncRoute(async (req, res) => {
  const service = await getServiceById(param(req, 'id'));
  if (!service) throw notFound('خدمت یافت نشد.');
  const stats = await one<{ total: number; open: number; revenue: number }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status NOT IN ('completed','cancelled','rejected') THEN 1 ELSE 0 END) AS open,
       0 AS revenue
     FROM requests WHERE service_id = ?`, [service.id],
  );
  const revenue = await one<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE i.service_id = ? AND p.status = 'confirmed'`, [service.id],
  );
  ok(res, { ...service, stats: { total: Number(stats?.total ?? 0), open: Number(stats?.open ?? 0), revenue: Number(revenue?.total ?? 0) } });
}));

/* ------------------------------ admin: write ------------------------------ */

const formFieldSchema = z.object({
  key: z.string().min(2).max(41),
  label: z.string().min(2).max(120),
  type: z.enum(['text', 'tel', 'number', 'national_id', 'date', 'textarea', 'select', 'radio', 'checkbox', 'file', 'money', 'iban', 'postal_code']),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().max(120).optional(),
  help: z.string().max(300).optional(),
});

const serviceSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  slug: z.string().max(80).optional(),
  categoryId: z.string().nullable().optional(),
  summary: z.string().max(300).optional(),
  description: z.string().max(8000).optional(),
  image: z.string().max(500).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  form: z.array(formFieldSchema).optional(),
  documents: z.array(z.object({
    title: z.string().min(2).max(200),
    required: z.boolean().default(false),
    note: z.string().max(300).optional(),
  })).optional(),
  workflow: z.array(z.object({
    title: z.string().min(2).max(200),
    description: z.string().max(1000).optional(),
    role: z.string().max(60).optional(),
    requiresDocument: z.boolean().optional(),
  })).optional(),
  coverage: z.enum(['nationwide','cities']).optional(),
  cityIds: z.array(z.string()).max(2000).optional(),
  urgentEnabled: z.boolean().optional(),
  urgentPercent: z.number().int().min(0).max(500).optional(),
  urgentDays: z.number().int().min(1).max(365).optional(),
  urgentCapacity: z.number().int().min(0).max(1000).optional(),
  baseFee: z.number().min(0).max(10_000_000_000).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  estimatedDays: z.number().int().min(1).max(365).optional(),
  paymentMethods: z.array(z.enum(['online', 'cash', 'pos', 'transfer'])).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  contactNotice: z.string().max(500).nullable().optional(),
  isPublished: z.boolean().optional(),
  acceptingRequests: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

catalogRouter.post('/categories', requirePermission('categories.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    title: z.string().min(2).max(120),
    description: z.string().max(500).optional(),
    icon: z.string().max(60).optional(),
    color: z.string().max(20).optional(),
    image: z.string().max(500).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  }).parse(req.body);
  const categoryId = await createCategory(body, { id: req.auth!.user.id, name: req.auth!.user.fullName });
  created(res, { id: categoryId });
}));

catalogRouter.patch('/categories/:id', requirePermission('categories.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    title: z.string().min(2).max(120).optional(),
    description: z.string().max(500).optional(),
    icon: z.string().max(60).optional(),
    color: z.string().max(20).optional(),
    image: z.string().max(500).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  }).parse(req.body);
  await updateCategory(param(req, 'id'), body, { id: req.auth!.user.id, name: req.auth!.user.fullName });
  ok(res, { message: 'دسته‌بندی به‌روزرسانی شد.' });
}));

catalogRouter.post('/services', requirePermission('services.create'), asyncRoute(async (req, res) => {
  const body = serviceSchema.parse(req.body);
  if (!body.title) throw badRequest('عنوان خدمت الزامی است.');
  const service = await createService(body as any, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  created(res, service);
}));

catalogRouter.patch('/services/:id', requirePermission('services.edit'), asyncRoute(async (req, res) => {
  const body = serviceSchema.parse(req.body);
  const service = await updateService(param(req, 'id'), body as any, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  ok(res, service);
}));

catalogRouter.delete('/services/:id', requirePermission('services.delete'), asyncRoute(async (req, res) => {
  await archiveService(param(req, 'id'), { id: req.auth!.user.id, name: req.auth!.user.fullName });
  ok(res, { message: 'خدمت بایگانی شد. پرونده‌های قبلی دست‌نخورده می‌مانند.' });
}));

/* ------------------------------ custom services --------------------------- */

catalogRouter.get('/custom-services', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const isCustomer = auth.user.kind === 'customer';
  if (!isCustomer && !hasPermission(auth.permissions, 'services.view')) throw forbidden();
  const rows = await q<any>(
    `SELECT s.*, o.id AS offer_id, o.status AS offer_status, o.amount AS offer_amount, o.expires_at,
            c.full_name AS customer_name
     FROM services s
     LEFT JOIN custom_service_offers o ON o.service_id = s.id
     LEFT JOIN users c ON c.id = s.owner_customer_id
     WHERE s.is_custom = 1 ${isCustomer ? 'AND s.owner_customer_id = ?' : ''}
     ORDER BY s.created_at DESC LIMIT 200`,
    isCustomer ? [auth.user.id] : [],
  );
  ok(res, rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    customerId: r.owner_customer_id,
    customerName: r.customer_name,
    baseFee: Number(r.base_fee),
    discountPercent: Number(r.discount_percent),
    offerId: r.offer_id,
    offerStatus: r.offer_status,
    offerAmount: r.offer_amount === null ? null : Number(r.offer_amount),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  })));
}));

/** Create a private service + offer + invoice for a specific customer. */
catalogRouter.post('/custom-services', requirePermission('services.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    customerId: z.string().min(3),
    title: z.string().min(3).max(200),
    description: z.string().min(10).max(5000),
    summary: z.string().max(300).optional(),
    coverage: z.enum(['nationwide','cities']).optional(),
  cityIds: z.array(z.string()).max(2000).optional(),
  urgentEnabled: z.boolean().optional(),
  urgentPercent: z.number().int().min(0).max(500).optional(),
  urgentDays: z.number().int().min(1).max(365).optional(),
  urgentCapacity: z.number().int().min(0).max(1000).optional(),
  baseFee: z.number().min(0),
    discountPercent: z.number().min(0).max(100).optional(),
    estimatedDays: z.number().int().min(1).max(365).optional(),
    documents: z.array(z.object({ title: z.string().min(2).max(200), required: z.boolean() })).optional(),
    workflow: z.array(z.object({
      title: z.string().min(2).max(200),
      description: z.string().max(500).optional(),
      role: z.string().max(60).optional(),
      requiresDocument: z.boolean().optional(),
    })).optional(),
    form: z.array(formFieldSchema).optional(),
    message: z.string().max(1000).optional(),
    createInvoice: z.boolean().optional(),
  }).parse(req.body);

  const service = await createCustomService(body, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  const expiryHours = await getNumber('services.custom_offer_expiry_hours');
  const expiresAt = new Date(Date.now() + expiryHours * 3_600_000).toISOString();

  const amount = Math.round(body.baseFee - (body.baseFee * (body.discountPercent ?? 0)) / 100);
  let invoiceId: string | null = null;
  if (body.createInvoice !== false && amount > 0) {
    const invoice = await createInvoice({
      customerId: body.customerId,
      serviceId: service.id,
      kind: 'custom',
      title: `پیشنهاد خدمت اختصاصی: ${body.title}`,
      items: [{ title: body.title, qty: 1, unitPrice: body.baseFee, amount: body.baseFee }],
      discount: Math.round((body.baseFee * (body.discountPercent ?? 0)) / 100),
      notes: 'این فاکتور برای خدمت اختصاصی صادر شده است و پس از تأیید مشتری قابل پرداخت است.',
    }, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
    invoiceId = invoice!.id;
  }

  const offerId = id('off');
  await run(
    `INSERT INTO custom_service_offers (id, service_id, customer_id, invoice_id, amount, status, message, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [offerId, service.id, body.customerId, invoiceId, amount, body.message ?? null, expiresAt, req.auth!.user.id, nowIso()],
  );

  await notifyUser(body.customerId, {
    title: 'پیشنهاد خدمت اختصاصی',
    body: `${body.title} — مبلغ ${amount.toLocaleString('fa-IR')} ریال`,
    kind: 'info',
    link: '/app/custom-offers',
  }).catch(() => undefined);

  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'custom_service.create',
    entityType: 'service', entityId: service.id, after: { customerId: body.customerId, amount, invoiceId }, ip: req.ip,
  });

  created(res, { service, offerId, invoiceId, amount, expiresAt });
}));

catalogRouter.get('/offers', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const rows = await q<any>(
    `SELECT o.*, s.title, s.description, s.slug, u.full_name AS customer_name
     FROM custom_service_offers o JOIN services s ON s.id = o.service_id JOIN users u ON u.id = o.customer_id
     ${auth.user.kind === 'customer' ? 'WHERE o.customer_id = ?' : !officeScope(auth) ? 'WHERE o.created_by = ?' : ''} ORDER BY o.created_at DESC LIMIT 100`,
    auth.user.kind === 'customer' || !officeScope(auth) ? [auth.user.id] : [],
  );
  ok(res, rows.map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    title: r.title,
    description: r.description,
    customerName: r.customer_name,
    amount: Number(r.amount),
    status: r.status,
    message: r.message,
    invoiceId: r.invoice_id,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    expired: r.expires_at ? new Date(r.expires_at).getTime() < Date.now() : false,
  })));
}));

/** Customer accepts the offer: a request is created and the workflow starts. */
catalogRouter.post('/offers/:id/accept', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden();
  await tx(async()=>{
  await run('UPDATE custom_service_offers SET status=status WHERE id=?',[param(req,'id')]);
  const offer = await one<any>('SELECT * FROM custom_service_offers WHERE id = ? AND customer_id = ?', [param(req, 'id'), req.auth!.user.id]);
  if (!offer) throw notFound('پیشنهاد یافت نشد.');
  if (offer.status !== 'pending') throw conflict('این پیشنهاد قبلاً بررسی شده است.');
  if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
    await run('UPDATE custom_service_offers SET status = ? WHERE id = ?', ['expired', offer.id]);
    throw conflict('مهلت این پیشنهاد به پایان رسیده است.');
  }

  const service = await getServiceById(offer.service_id);
  if (!service) throw notFound('خدمت یافت نشد.');

  // A custom service has no public booking form; collect the service's required fields.
  const body = z.object({
    formData: z.record(z.string(), z.any()).default({}),
    paymentMethod: z.string().optional(),
  }).parse(req.body ?? {});

  const request = await createRequest({
    serviceId: service.id,
    existingInvoiceId: offer.invoice_id ?? undefined,
    customerId: req.auth!.user.id,
    formData: body.formData,
    paymentMethod: body.paymentMethod,
  }, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });

  await run('UPDATE custom_service_offers SET status = ?, decided_at = ?, request_id = ? WHERE id = ?', ['accepted', nowIso(), request?.id ?? null, offer.id]);
  if (offer.invoice_id) {
    await run('UPDATE invoices SET request_id = ?, updated_at = ? WHERE id = ?', [request?.id ?? null, nowIso(), offer.invoice_id]);
  }
  if (request) {
    await addEvent({
      requestId: request.id, type: 'system', message: 'مشتری پیشنهاد خدمت اختصاصی را تأیید کرد.',
      actorId: req.auth!.user.id, actorName: req.auth!.user.fullName,
    });
  }
  ok(res, { request, message: 'پیشنهاد تأیید شد و گردش کار آغاز شد.' });
  });
}));

catalogRouter.post('/offers/:id/decline', asyncRoute(async (req, res) => {
  const body = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
  const offer = await one<any>('SELECT * FROM custom_service_offers WHERE id = ?', [param(req, 'id')]);
  if (!offer) throw notFound('پیشنهاد یافت نشد.');
  const isOwner = req.auth!.user.kind === 'customer' && offer.customer_id === req.auth!.user.id;
  if (!isOwner && !hasPermission(req.auth!.permissions, 'services.edit')) throw forbidden();
  if (offer.status !== 'pending') throw conflict('این پیشنهاد قبلاً بررسی شده است.');

  await run('UPDATE custom_service_offers SET status = ?, decided_at = ?, message = ? WHERE id = ?', ['declined', nowIso(), body.reason ?? offer.message, offer.id]);
  if (offer.invoice_id) await run('UPDATE invoices SET status = ?, voided_at = ?, updated_at = ? WHERE id = ?', ['void', nowIso(), nowIso(), offer.invoice_id]);
  await notifyUser(offer.created_by ?? offer.customer_id, {
    title: 'پیشنهاد خدمت اختصاصی رد شد',
    body: body.reason ?? '',
    kind: 'warning',
    link: '/admin/custom-services',
  }).catch(() => undefined);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'custom_offer.decline',
    entityType: 'offer', entityId: offer.id, after: { reason: body.reason }, ip: req.ip,
  });
  ok(res, { message: 'پیشنهاد رد شد.' });
}));

/** Public catalogue for logged-in customers (includes their private services). */
catalogRouter.get('/mine', asyncRoute(async (req, res) => {
  const result = await listServices({ onlyPublic: true, customerId: req.auth!.user.id, pageSize: 100 });
  ok(res, result.items.filter((s) => s.isCustom));
}));

/** Estimated price preview, used by the customer booking form. */
catalogRouter.get('/services/:id/quote', asyncRoute(async (req, res) => {
  const service = await getServiceById(param(req, 'id'));
  if (!service) throw notFound('خدمت یافت نشد.');
  const taxPercent = await getNumber('accounting.tax_percent');
  const tax = Math.round((service.finalFee * taxPercent) / 100);
  ok(res, {
    serviceId: service.id,
    baseFee: service.baseFee,
    discountPercent: service.discountPercent,
    discount: service.baseFee - service.finalFee,
    taxPercent,
    tax,
    total: service.finalFee + tax,
    estimatedDays: service.estimatedDays,
    needsReview: service.needsReview,
    acceptingRequests: service.acceptingRequests && (await getBool('services.accepting_requests')),
    paymentMethods: service.paymentMethods,
  });
}));
