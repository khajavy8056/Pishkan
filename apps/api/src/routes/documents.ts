import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { forbidden, notFound } from '../http/errors.js';
import { created, ok } from '../http/respond.js';
import { param } from '../http/params.js';
import { one } from '../db/index.js';
import { officeScope } from '../lib/scope.js';
import { notifyUser } from '../modules/notifications/service.js';
import {
  DOCUMENT_TYPES, DOCUMENT_TYPE_CODES, addCustomerDocument, deleteCustomerDocument,
  documentTypeLabel, documentTypesWithStats, getCustomerDocument, listCustomerDocuments,
  reuseDocumentInRequest, reviewCustomerDocument,
} from '../modules/documents/service.js';

/**
 * Customer document archive endpoints.
 *
 * Mounted at /api/documents (and /api/v1/documents). Customers only ever reach
 * their own records; staff access is permission *and* case-scope bound.
 */
export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.get('/types', asyncRoute(async (_req, res) => {
  ok(res, DOCUMENT_TYPES);
}));

/* ------------------------------- customer -------------------------------- */

documentsRouter.get('/mine', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden('این بخش مخصوص مشتریان است.');
  const [documents, types] = await Promise.all([
    listCustomerDocuments(req.auth!.user.id),
    documentTypesWithStats(req.auth!.user.id),
  ]);
  ok(res, documents, { types });
}));

documentsRouter.post('/mine', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden('این بخش مخصوص مشتریان است.');
  const body = z.object({
    fileId: z.string().min(3).max(80),
    docType: z.enum(DOCUMENT_TYPE_CODES),
    title: z.string().max(200).optional(),
    issuedAt: z.string().max(40).optional().or(z.literal('')),
    expiresAt: z.string().max(40).optional().or(z.literal('')),
  }).parse(req.body);
  const document = await addCustomerDocument({
    customerId: req.auth!.user.id,
    fileId: body.fileId,
    docType: body.docType,
    title: body.title || documentTypeLabel(body.docType),
    issuedAt: body.issuedAt || null,
    expiresAt: body.expiresAt || null,
  }, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  created(res, document);
}));

documentsRouter.post('/mine/:docId/reuse', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden('استفاده دوباره از مدرک فقط توسط مشتری انجام می‌شود.');
  const body = z.object({
    requestId: z.string().min(3).max(80),
    confirm: z.boolean(),
  }).parse(req.body);
  const result = await reuseDocumentInRequest({
    documentId: param(req, 'docId'),
    requestId: body.requestId,
    customerId: req.auth!.user.id,
    confirm: body.confirm,
    actor: { id: req.auth!.user.id, name: req.auth!.user.fullName },
  });
  ok(res, result);
}));

documentsRouter.delete('/mine/:docId', asyncRoute(async (req, res) => {
  if (req.auth!.user.kind !== 'customer') throw forbidden('این بخش مخصوص مشتریان است.');
  await deleteCustomerDocument(param(req, 'docId'), req.auth!.user.id, {
    id: req.auth!.user.id, name: req.auth!.user.fullName,
  });
  ok(res, { message: 'مدرک از پروفایل حذف شد.' });
}));

/* --------------------------------- staff --------------------------------- */

/** Staff view of a customer's archive, gated by permission and case assignment. */
documentsRouter.get('/customer/:customerId', requirePermission('documents.view'), asyncRoute(async (req, res) => {
  const customerId = param(req, 'customerId');
  const customer = await one<any>('SELECT id, full_name, mobile FROM users WHERE id = ? AND kind = ?', [customerId, 'customer']);
  if (!customer) throw notFound('مشتری یافت نشد.');
  if (!officeScope(req.auth!) && req.auth!.permissions !== '*') {
    const assigned = await one('SELECT id FROM requests WHERE customer_id = ? AND assigned_to = ? LIMIT 1', [customerId, req.auth!.user.id]);
    if (!assigned) throw forbidden('این مشتری در محدوده مسئولیت شما نیست.');
  }
  const documents = await listCustomerDocuments(customerId);
  ok(res, documents, { customer: { id: customer.id, fullName: customer.full_name, mobile: customer.mobile } });
}));

documentsRouter.post('/:docId/review', requirePermission('documents.approve'), asyncRoute(async (req, res) => {
  const body = z.object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(1000).optional(),
  }).parse(req.body);
  const existing = await one<any>('SELECT * FROM customer_documents WHERE id = ?', [param(req, 'docId')]);
  if (!existing) throw notFound('مدرک پروفایل یافت نشد.');
  if (!officeScope(req.auth!) && req.auth!.permissions !== '*') {
    const assigned = await one('SELECT id FROM requests WHERE customer_id = ? AND assigned_to = ? LIMIT 1', [existing.customer_id, req.auth!.user.id]);
    if (!assigned) throw forbidden('این مدرک در محدوده مسئولیت شما نیست.');
  }
  const document = await reviewCustomerDocument(param(req, 'docId'), body.decision, body.note, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip,
  });
  await notifyUser(existing.customer_id, {
    title: 'وضعیت مدرک پروفایل بررسی شد',
    body: `${documentTypeLabel(existing.doc_type)}: ${body.decision === 'approved' ? 'تأیید شد' : 'نیازمند اصلاح است'}`,
    kind: body.decision === 'approved' ? 'success' : 'warning',
    link: '/app/documents',
    idempotencyKey: `customer-document:${document.id}:${body.decision}:${document.updatedAt}`,
  }).catch(() => undefined);
  ok(res, document);
}));

documentsRouter.get('/:docId', asyncRoute(async (req, res) => {
  const document = await getCustomerDocument(param(req, 'docId'));
  if (!document) throw notFound('مدرک پروفایل یافت نشد.');
  const auth = req.auth!;
  if (auth.user.kind === 'customer') {
    if (document.customerId !== auth.user.id) throw forbidden();
    return ok(res, document);
  }
  if (!officeScope(auth) && auth.permissions !== '*') {
    const assigned = await one('SELECT id FROM requests WHERE customer_id = ? AND assigned_to = ? LIMIT 1', [document.customerId, auth.user.id]);
    if (!assigned) throw forbidden('این مدرک در محدوده مسئولیت شما نیست.');
  }
  ok(res, document);
}));
