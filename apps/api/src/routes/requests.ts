import { handoff,deliver,handoffsForCase } from '../modules/automation/service.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { created, dateRange, ok, pagination } from '../http/respond.js';
import { hasPermission } from '../lib/permissions.js';
import {
  nextStatuses,STATUSES, STATUS_LABELS, addNote, assignRequest, attachDocument, autoAssign, candidatesForService,
  eligibleQueue,claimRequest,quoteRequest, changeStatus, createRequest, customerCancel, getRequest, listRequests, requestStats, reviewDocument,
} from '../modules/requests/service.js';
import { getServiceById } from '../modules/catalog/service.js';
import { one, q } from '../db/index.js';
import { reuseDocumentInRequest } from '../modules/documents/service.js';
import { notifyUser } from '../modules/notifications/service.js';
import { param } from '../http/params.js';

export const requestsRouter = Router();
requestsRouter.use(requireAuth);
requestsRouter.post('/quote',asyncRoute(async(req,res)=>{
 if(req.auth!.user.kind!=='customer') throw forbidden();
 const body=z.object({serviceId:z.string(),priority:z.enum(['normal','high']).default('normal')}).parse(req.body);
 ok(res,await quoteRequest(body.serviceId,req.auth!.user.id,body.priority));
}));
const officeScope = (auth: any) => auth.permissions === '*' || ['super_admin', 'manager', 'accountant'].includes(auth.user.roleCode);
const safeRequest = (req: any, requestId: string) => getRequest(requestId, { actorId: req.auth.user.id, isCustomer: req.auth.user.kind === 'customer' });

/** Load a request and enforce object-level access control. */
async function loadAuthorized(reqId: string, req: any) {
  const request = await getRequest(reqId, { actorId: req.auth.user.id, isCustomer: req.auth.user.kind === 'customer' });
  if (!request) throw notFound('درخواست یافت نشد.');
  const auth = req.auth;
  if (auth.user.kind === 'customer') {
    if (request.customerId !== auth.user.id) throw notFound('درخواست یافت نشد.');
    return request;
  }
  if (!hasPermission(auth.permissions, 'requests.view')) throw forbidden();
  if (!officeScope(auth) && request.assignedTo !== auth.user.id) throw forbidden('این پرونده در محدوده مسئولیت شما نیست.');
  return request;
}

requestsRouter.get('/meta/statuses', asyncRoute(async (_req, res) => {
  ok(res, STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })));
}));

requestsRouter.get('/', asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req);
  const auth = req.auth!;
  const isCustomer = auth.user.kind === 'customer';

  if (!isCustomer && !hasPermission(auth.permissions, 'requests.view')) throw forbidden();

  const result = await listRequests({
    page, pageSize,
    customerId: isCustomer ? auth.user.id : (typeof req.query.customerId === 'string' ? req.query.customerId : undefined),
    assignedTo: !isCustomer && !officeScope(auth) ? auth.user.id : typeof req.query.assignedTo === 'string'
      ? req.query.assignedTo
      : (req.query.mine === 'true' ? auth.user.id : undefined),
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    statusGroup: (req.query.group as 'open' | 'closed' | 'all' | undefined) ?? undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    unassigned: req.query.unassigned === 'true',
    ...dateRange(req),
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

requestsRouter.get('/queue/eligible',requirePermission('requests.view'),asyncRoute(async(req,res)=>{ok(res,await eligibleQueue(req.auth!.user.id))}));
requestsRouter.post('/:id/claim',requirePermission('requests.edit'),asyncRoute(async(req,res)=>{ok(res,await claimRequest(param(req,'id'),req.auth!.user.id,req.auth!.user.fullName))}));

requestsRouter.get('/stats', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const scope = auth.user.kind === 'customer'
    ? { customerId: auth.user.id }
    : { assignedTo: !officeScope(auth) || req.query.mine === 'true' ? auth.user.id : undefined };
  ok(res, await requestStats(scope));
}));

/** Review queue: every document still waiting for a decision. */
requestsRouter.get('/pending-documents', requirePermission('documents.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 30 });
  const where: string[] = [`d.status = 'pending'`];
  const args: any[] = [];
  if (!officeScope(req.auth!) || req.query.mine === 'true') {
    where.push('r.assigned_to = ?');
    args.push(req.auth!.user.id);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM request_documents d JOIN requests r ON r.id = d.request_id ${clause}`, args,
  );
  const rows = await q<any>(
    `SELECT d.id, d.title, d.kind, d.created_at, d.file_id, f.name AS file_name, f.mime, f.size,
            f.processing_status, f.processing_mode, f.savings_percent, f.preview_storage_key,
            f.width, f.height, f.processing_error,
            r.id AS request_id, r.tracking_code, r.status AS request_status,
            s.title AS service_title, u.full_name AS customer_name
     FROM request_documents d
     JOIN requests r ON r.id = d.request_id
     JOIN services s ON s.id = r.service_id
     JOIN users u ON u.id = r.customer_id
     JOIN files f ON f.id = d.file_id
     ${clause} ORDER BY d.created_at ASC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  ok(res, rows.map((r: any) => ({
    id: r.id, title: r.title, kind: r.kind, createdAt: r.created_at,
    file: {
      id: r.file_id, name: r.file_name, mime: r.mime, size: Number(r.size),
      width: r.width ?? null, height: r.height ?? null,
      savingsPercent: Number(r.savings_percent ?? 0),
      previewUrl: r.preview_storage_key ? `/api/files/${r.file_id}?variant=preview` : null,
      originalUrl: `/api/files/${r.file_id}?variant=original`,
      displayUrl: `/api/files/${r.file_id}`,
      processing: { status: r.processing_status ?? 'none', mode: r.processing_mode ?? null, error: r.processing_error ?? null },
    },
    requestId: r.request_id, trackingCode: r.tracking_code, requestStatus: r.request_status,
    serviceTitle: r.service_title, customerName: r.customer_name,
  })), { total: Number(total?.c ?? 0), page, pageSize });
}));

requestsRouter.get('/:id', asyncRoute(async (req, res) => {
  const request = await loadAuthorized(param(req, 'id'), req);
  ok(res, {
    ...request,
    canManage: req.auth!.user.kind !== 'customer' && hasPermission(req.auth!.permissions, 'requests.edit'),
    canApprove: officeScope(req.auth!) && hasPermission(req.auth!.permissions, 'requests.approve'),
    allowedStatuses:nextStatuses(request.status).filter(s=>!['completed','ready'].includes(s)||(officeScope(req.auth!)&&hasPermission(req.auth!.permissions,'requests.approve'))),
  });
}));

requestsRouter.post('/',
  asyncRoute(async (req, res) => {
    const body = z.object({
      serviceId: z.string().min(3),
      customerId: z.string().optional(),
      formData: z.record(z.string(), z.any()).default({}),
      paymentMethod: z.string().optional(),
      priority: z.enum(['normal', 'high']).optional(),
      documentIds: z.array(z.object({ fileId: z.string(), title: z.string().optional() })).optional(),
    }).parse(req.body);

    const auth = req.auth!;
    const idempotencyKey = req.get('Idempotency-Key')?.trim();
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))) {
      throw badRequest('کلید جلوگیری از ثبت تکراری معتبر نیست.');
    }
    let customerId = auth.user.id;
    if (auth.user.kind !== 'customer') {
      if (!hasPermission(auth.permissions, 'requests.create')) throw forbidden();
      if (!body.customerId) throw badRequest('برای ثبت درخواست از طرف مشتری، شناسه مشتری را مشخص کنید.');
      customerId = body.customerId;
    }

    const request = await createRequest({
      serviceId: body.serviceId,
      customerId,
      formData: body.formData,
      paymentMethod: body.paymentMethod,
      priority: body.priority,
      documentIds: body.documentIds,
      idempotencyKey,
    }, { id: auth.user.id, name: auth.user.fullName, ip: req.ip });

    if (request) {
      await notifyUser(customerId, {
        title: 'درخواست شما ثبت شد',
        body: `شماره پیگیری ${request.trackingCode} — ${request.serviceTitle}`,
        kind: 'success',
        link: `/app/requests/${request.id}`,
        idempotencyKey: `request:${request.id}:created`,
        sms: { eventCode: 'request_created', variables: { tracking_code: request.trackingCode, service_title: request.serviceTitle } },
      }).catch(() => undefined);
    }
    created(res, request);
  }));

requestsRouter.get('/:id/handoffs',asyncRoute(async(req,res)=>{ok(res,await handoffsForCase(param(req,'id'),req.auth!))}));
requestsRouter.post('/:id/handoffs',asyncRoute(async(req,res)=>{const b=z.object({department:z.enum(['management','accounting']),reason:z.string().trim().min(5).max(2000)}).parse(req.body);created(res,await handoff(param(req,'id'),b.department,b.reason,req.auth!))}));
requestsRouter.post('/:id/deliver',asyncRoute(async(req,res)=>{const b=z.object({files:z.array(z.object({fileId:z.string(),title:z.string().trim().min(2).max(200)})).min(1).max(10),summary:z.string().trim().min(5).max(2000)}).parse(req.body);ok(res,await deliver(param(req,'id'),b.files,b.summary,req.auth!))}));

requestsRouter.patch('/:id/status', requirePermission('requests.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    status: z.enum(STATUSES),
    note: z.string().max(2000).optional(),
  }).parse(req.body);
  const request = await loadAuthorized(param(req, 'id'), req);
  if (['completed', 'ready'].includes(body.status) && (!officeScope(req.auth!) || !hasPermission(req.auth!.permissions, 'requests.approve'))) {
    throw forbidden('برای این تغییر وضعیت دسترسی تأیید لازم است.');
  }
  const updated = await changeStatus(param(req, 'id'), body.status, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip }, body.note);
  if (request.status !== body.status) {
    await notifyUser(request.customerId, {
      title: 'وضعیت درخواست شما تغییر کرد',
      body: `${request.serviceTitle}: ${STATUS_LABELS[body.status]}`,
      kind: 'info',
      link: `/app/requests/${request.id}`,
      idempotencyKey: `request:${request.id}:status:${updated?.updatedAt ?? body.status}`,
      sms: { eventCode: 'request_status', variables: { tracking_code: request.trackingCode, status: STATUS_LABELS[body.status] } },
    }).catch(() => undefined);
  }
  ok(res, await safeRequest(req, param(req, 'id')));
}));

requestsRouter.patch('/:id/assign', requirePermission('requests.edit'), asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!)) throw forbidden('ارجاع مدیریتی برای شما مجاز نیست؛ از پذیرش پرونده استفاده کنید.');
  const body = z.object({ staffId: z.string().nullable() }).parse(req.body);
  const previous = await loadAuthorized(param(req, 'id'), req);
  const updated = await assignRequest(param(req, 'id'), body.staffId, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  if (body.staffId && previous.assignedTo !== body.staffId) {
    await notifyUser(body.staffId, {
      title: 'پرونده جدید به شما ارجاع شد',
      body: `${updated?.serviceTitle} — ${updated?.trackingCode}`,
      kind: 'info',
      link: `/staff/requests/${param(req, 'id')}`,
      idempotencyKey: `request:${param(req, 'id')}:assigned:${updated?.updatedAt ?? Date.now()}`,
      sms: { eventCode: 'request_assigned', variables: { tracking_code: updated?.trackingCode ?? '', service_title: updated?.serviceTitle ?? '' } },
    }).catch(() => undefined);
  }
  ok(res, await safeRequest(req, param(req, 'id')));
}));

requestsRouter.post('/:id/auto-assign', requirePermission('requests.edit'), asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!)) throw forbidden();
  const assigned = await autoAssign(param(req, 'id'));
  if (!assigned) throw badRequest('کارشناس واجد شرایطی برای ارجاع خودکار پیدا نشد. پرونده در صف انتظار ماند.');
  ok(res, await safeRequest(req, param(req, 'id')));
}));

requestsRouter.get('/:id/candidates', requirePermission('requests.edit'), asyncRoute(async (req, res) => {
  if(!officeScope(req.auth!)) throw forbidden();
  const request = await loadAuthorized(param(req, 'id'), req);
  const service = await getServiceById(request!.serviceId);
  if (!service) throw notFound();
  ok(res, await candidatesForService(service));
}));

requestsRouter.post('/:id/notes', asyncRoute(async (req, res) => {
  const body = z.object({
    message: z.string().min(1).max(4000),
    visibleToCustomer: z.boolean().optional(),
  }).parse(req.body);
  const request = await loadAuthorized(param(req, 'id'), req);
  const isCustomer = req.auth!.user.kind === 'customer';
  await addNote(param(req, 'id'), body.message, { id: req.auth!.user.id, name: req.auth!.user.fullName }, isCustomer ? true : body.visibleToCustomer !== false);
  if (!isCustomer && body.visibleToCustomer !== false) {
    await notifyUser(request.customerId, {
      title: 'یادداشت جدید روی پرونده',
      body: body.message.slice(0, 120),
      kind: 'info',
      link: `/app/requests/${request.id}`,
    }).catch(() => undefined);
  }
  ok(res, await safeRequest(req, param(req, 'id')));
}));

requestsRouter.post('/:id/documents', asyncRoute(async (req, res) => {
  const body = z.object({
    fileId: z.string().min(3).optional(),
    customerDocumentId: z.string().min(3).optional(),
    title: z.string().max(200).optional(),
    kind: z.enum(['customer', 'staff']).optional(),
    confirmReuse: z.boolean().optional(),
  }).parse(req.body);
  if (!body.fileId && !body.customerDocumentId) throw badRequest('شناسه فایل یا مدرک پروفایل لازم است.');
  const request = await loadAuthorized(param(req, 'id'), req);
  const isCustomer = req.auth!.user.kind === 'customer';
  if (!isCustomer && !hasPermission(req.auth!.permissions, 'requests.edit')) throw forbidden();

  if (body.customerDocumentId) {
    // Profile-document reuse is a customer decision and requires confirmation.
    if (!isCustomer) throw forbidden('استفاده دوباره از مدارک پروفایل فقط با تأیید مشتری انجام می‌شود.');
    await reuseDocumentInRequest({
      documentId: body.customerDocumentId,
      requestId: request!.id,
      customerId: req.auth!.user.id,
      confirm: body.confirmReuse === true,
      actor: { id: req.auth!.user.id, name: req.auth!.user.fullName },
    });
    return ok(res, await safeRequest(req, param(req, 'id')));
  }

  await attachDocument(param(req, 'id'), body.fileId!, body.title ?? 'مدرک ارسالی',
    { id: req.auth!.user.id, name: req.auth!.user.fullName }, isCustomer ? 'customer' : 'staff');
  ok(res, await safeRequest(req, param(req, 'id')));
}));

requestsRouter.post('/:id/documents/:docId/review', requirePermission('documents.approve'), asyncRoute(async (req, res) => {
  const body = z.object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(1000).optional(),
  }).parse(req.body);
  const request = await loadAuthorized(param(req, 'id'), req);
  const doc = await one<{ request_id: string; kind: string; status: string }>('SELECT request_id, kind, status FROM request_documents WHERE id = ? AND request_id = ?', [param(req, 'docId'), param(req, 'id')]);
  if (!doc) throw notFound('مدرک یافت نشد.');
  if(doc.kind==='staff'&&!officeScope(req.auth!))throw forbidden('تأیید فایل نتیجه فقط توسط مدیریت مجاز است.');
  const review = await reviewDocument(param(req, 'docId'), body.decision, body.note, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  if (doc.kind === 'customer' && doc.status !== body.decision) {
    await notifyUser(request.customerId, {
      title: 'مدرک شما بررسی شد',
      body: `مدرک پرونده ${request.trackingCode}: ${body.decision === 'approved' ? 'تأیید شد' : 'نیازمند اصلاح است'}`,
      kind: body.decision === 'approved' ? 'success' : 'warning',
      link: `/app/requests/${request.id}`,
      idempotencyKey: `document-review:${review.eventId}`,
      sms: { eventCode: 'document_status', variables: { tracking_code: request.trackingCode, document_status: body.decision === 'approved' ? 'تأیید شد' : 'نیازمند اصلاح است' } },
    }).catch(() => undefined);
  }
  ok(res, await safeRequest(req, param(req, 'id')));
}));

requestsRouter.post('/:id/cancel', asyncRoute(async (req, res) => {
  const body = z.object({ reason: z.string().max(1000).optional() }).parse(req.body);
  const request = await loadAuthorized(param(req, 'id'), req);
  if (req.auth!.user.kind !== 'customer') throw badRequest('لغو توسط کارشناس از مسیر تغییر وضعیت انجام می‌شود.');
  const updated = await customerCancel(param(req, 'id'), req.auth!.user.id, body.reason ?? '', { id: req.auth!.user.id, name: req.auth!.user.fullName });
  ok(res, await safeRequest(req, param(req, 'id')));
}));

requestsRouter.get('/:id/timeline', asyncRoute(async (req, res) => {
  const request = await loadAuthorized(param(req, 'id'), req);
  ok(res, request!.events);
}));
