import { officeScope } from '../lib/scope.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { one, q, run, nowIso } from '../db/index.js';
import { id } from '../lib/crypto.js';
import { hasPermission } from '../lib/permissions.js';
import { notifyUser } from '../modules/notifications/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { param } from '../http/params.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

async function validateAssignee(userId: string | null) {
  if (userId === null) return;
  const user = await one<any>(
    `SELECT u.kind, u.status, r.permissions FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [userId],
  );
  let permissions: string[] | '*' = [];
  try { permissions = user?.permissions === '*' ? '*' : JSON.parse(user?.permissions ?? '[]'); } catch { permissions = []; }
  if (!user || !['staff', 'admin'].includes(user.kind) || user.status !== 'active' || !hasPermission(permissions, 'messages.view')) {
    throw badRequest('مسئول گفت‌وگو باید کارمند فعال و دارای دسترسی پیام‌ها باشد.');
  }
}

async function loadThread(threadId: string, req: any) {
  const thread = await one<any>(
    `SELECT t.*, u.full_name AS customer_name FROM threads t JOIN users u ON u.id = t.customer_id WHERE t.id = ?`, [threadId],
  );
  if (!thread) throw notFound('گفت‌وگو یافت نشد.');
  const auth = req.auth;
  if (auth.user.kind === 'customer' && thread.customer_id !== auth.user.id) throw notFound('گفت‌وگو یافت نشد.');
  if (auth.user.kind !== 'customer' && !hasPermission(auth.permissions, 'messages.view')) throw forbidden();
  if(auth.user.kind!=='customer' && !officeScope(auth) && thread.assigned_to!==auth.user.id && !await one('SELECT id FROM requests WHERE id=? AND assigned_to=?',[thread.request_id,auth.user.id])) throw forbidden('گفت‌وگو در محدوده مسئولیت شما نیست.');
  return thread;
}

/** Thread list: general conversations and per-request threads are separate. */
messagesRouter.get('/threads', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const { page, pageSize } = pagination(req, { pageSize: 30 });
  const where: string[] = [];
  const args: any[] = [];
  if (auth.user.kind === 'customer') {
    where.push('t.customer_id = ?');
    args.push(auth.user.id);
  } else {
    if (!hasPermission(auth.permissions, 'messages.view')) throw forbidden();
    if (!officeScope(auth) || req.query.mine === 'true') { where.push('(t.assigned_to = ? OR EXISTS(SELECT 1 FROM requests r WHERE r.id=t.request_id AND r.assigned_to=?))'); args.push(auth.user.id,auth.user.id); }
  }
  if (typeof req.query.scope === 'string') { where.push('t.scope = ?'); args.push(req.query.scope); }
  if (typeof req.query.requestId === 'string') { where.push('t.request_id = ?'); args.push(req.query.requestId); }
  if (req.query.open === 'true') where.push(`t.status = 'open'`);

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM threads t ${clause}`, args);
  const rows = await q<any>(
    `SELECT t.*, u.full_name AS customer_name,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.read_at IS NULL
              AND m.sender_role IN ('customer')) AS unread_from_customer,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.read_at IS NULL
              AND m.sender_role IN ('staff','admin','system')) AS unread_from_staff,
            (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
     FROM threads t JOIN users u ON u.id = t.customer_id
     ${clause} ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );

  ok(res, rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    requestId: r.request_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    subject: r.subject,
    status: r.status,
    assignedTo: r.assigned_to,
    lastMessage: r.last_message,
    lastMessageAt: r.last_message_at,
    unread: auth.user.kind === 'customer' ? Number(r.unread_from_staff) : Number(r.unread_from_customer),
    createdAt: r.created_at,
  })), { total: Number(total?.c ?? 0), page, pageSize });
}));

messagesRouter.post('/threads', asyncRoute(async (req, res) => {
  const body = z.object({
    subject: z.string().max(200).optional(),
    requestId: z.string().optional(),
    customerId: z.string().optional(),
    message: z.string().min(1).max(4000).optional(),
  }).parse(req.body);

  const auth = req.auth!;
  const customerId = auth.user.kind === 'customer' ? auth.user.id : body.customerId;
  if (!customerId) throw badRequest('برای ایجاد گفت‌وگو، مشتری را مشخص کنید.');
  if (auth.user.kind !== 'customer' && !hasPermission(auth.permissions, 'messages.create')) throw forbidden();
  const customer = await one('SELECT id FROM users WHERE id = ? AND kind = ? AND status = \'active\'', [customerId, 'customer']);
  if (!customer) throw badRequest('مشتری انتخاب‌شده معتبر یا فعال نیست.');

  if (body.requestId) {
    const request = await one<any>('SELECT id, customer_id, assigned_to FROM requests WHERE id = ?', [body.requestId]);
    if (!request) throw notFound('پرونده یافت نشد.');
    if(auth.user.kind!=='customer' && !officeScope(auth) && request.assigned_to!==auth.user.id) throw forbidden();
    if (request.customer_id !== customerId) throw badRequest('پرونده به این مشتری تعلق ندارد.');
    const existing = await one<any>('SELECT * FROM threads WHERE request_id = ? AND customer_id = ?', [request.id, customerId]);
    if (existing) return ok(res, { id: existing.id, existing: true });
  }

  if(auth.user.kind!=='customer'&&!officeScope(auth)&&!body.requestId) throw forbidden('گفت‌وگو باید به پرونده شما متصل باشد.');
  const threadId = id('thr');
  const ts = nowIso();
  await run(
    `INSERT INTO threads (id, scope, request_id, customer_id, subject, status, assigned_to, last_message_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?)`,
    [threadId, body.requestId ? 'request' : 'general', body.requestId ?? null, customerId,
      body.subject ?? (body.requestId ? 'گفت‌وگو درباره پرونده' : 'گفت‌وگو با دفتر'), ts, ts],
  );

  if (body.message) {
    await run(
      `INSERT INTO messages (id, thread_id, sender_id, sender_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id('msg'), threadId, auth.user.id, auth.user.kind, body.message.slice(0, 4000), ts],
    );
  }
  created(res, { id: threadId });
}));

messagesRouter.get('/threads/:id', asyncRoute(async (req, res) => {
  const thread = await loadThread(param(req, 'id'), req);
  const messages = await q<any>(
    `SELECT m.*, u.full_name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.thread_id = ? ORDER BY m.created_at ASC LIMIT 500`, [thread.id],
  );
  await run(
    `UPDATE messages SET read_at = ? WHERE thread_id = ? AND read_at IS NULL AND sender_role <> ?`,
    [nowIso(), thread.id, req.auth!.user.kind === 'customer' ? 'customer' : 'staff'],
  );
  ok(res, {
    thread: {
      id: thread.id, scope: thread.scope, requestId: thread.request_id, subject: thread.subject,
      status: thread.status, customerId: thread.customer_id, customerName: thread.customer_name,
      assignedTo: thread.assigned_to, createdAt: thread.created_at,
    },
    messages: messages.map((m) => ({
      id: m.id, body: m.body, senderId: m.sender_id, senderRole: m.sender_role,
      senderName: m.sender_name, fileId: m.file_id, createdAt: m.created_at, readAt: m.read_at,
    })),
  });
}));

messagesRouter.post('/threads/:id/messages', asyncRoute(async (req, res) => {
  const body = z.object({
    body: z.string().min(1).max(4000),
    fileId: z.string().optional(),
  }).parse(req.body);
  const thread = await loadThread(param(req, 'id'), req);
  if (thread.status === 'closed') throw badRequest('این گفت‌وگو بسته شده است.');
  if (body.fileId) {
    const file = await one<any>('SELECT owner_id FROM files WHERE id = ?', [body.fileId]);
    if (!file) throw badRequest('فایل پیوست‌شده یافت نشد.');
    if (file.owner_id !== req.auth!.user.id) throw forbidden('فقط فایل بارگذاری‌شده توسط خودتان قابل ارسال است.');
  }

  const messageId = id('msg');
  const ts = nowIso();
  await run(
    `INSERT INTO messages (id, thread_id, sender_id, sender_role, body, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [messageId, thread.id, req.auth!.user.id, req.auth!.user.kind, body.body, body.fileId ?? null, ts],
  );
  await run('UPDATE threads SET last_message_at = ?, status = ? WHERE id = ?', [ts, 'open', thread.id]);

  // notify the other side
  if (req.auth!.user.kind === 'customer') {
    if (thread.assigned_to) {
      await notifyUser(thread.assigned_to, {
        title: 'پیام جدید مشتری', body: body.body.slice(0, 120), kind: 'info', link: `/staff/messages/${thread.id}`,
      }).catch(() => undefined);
    } else {
      await notifyUser(req.auth!.user.id, { title: 'پیام ارسال شد', body: 'پیام شما ثبت شد و به‌زودی پاسخ داده می‌شود.', kind: 'success' }).catch(() => undefined);
    }
  } else {
    await notifyUser(thread.customer_id, {
      title: 'پاسخ جدید از دفتر', body: body.body.slice(0, 120), kind: 'info', link: `/app/messages/${thread.id}`,
    }).catch(() => undefined);
  }

  created(res, { id: messageId, createdAt: ts });
}));

messagesRouter.patch('/threads/:id', asyncRoute(async (req, res) => {
  const body = z.object({
    status: z.enum(['open', 'closed']).optional(),
    assignedTo: z.string().nullable().optional(),
    subject: z.string().max(200).optional(),
  }).parse(req.body);
  const thread = await loadThread(param(req, 'id'), req);
  const isStaff = req.auth!.user.kind !== 'customer';
  if (!isStaff && body.status !== 'closed') throw forbidden();

  if(body.assignedTo !== undefined && !officeScope(req.auth!)) throw forbidden('تغییر مسئول فقط توسط مدیریت مجاز است.');
  if (body.assignedTo !== undefined) await validateAssignee(body.assignedTo);
  await run(
    'UPDATE threads SET status = ?, assigned_to = ?, subject = ? WHERE id = ?',
    [body.status ?? thread.status, body.assignedTo !== undefined ? body.assignedTo : thread.assigned_to,
      body.subject ?? thread.subject, thread.id],
  );
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'thread.update',
    entityType: 'thread', entityId: thread.id, after: body, ip: req.ip,
  });
  ok(res, { message: 'گفت‌وگو به‌روزرسانی شد.' });
}));

messagesRouter.get('/unread-count', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  if (auth.user.kind === 'customer') {
    const row = await one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE t.customer_id = ? AND m.read_at IS NULL AND m.sender_role <> 'customer'`, [auth.user.id],
    );
    return ok(res, { unread: Number(row?.c ?? 0) });
  }
  if (!hasPermission(auth.permissions, 'messages.view')) throw forbidden();
  const row = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.read_at IS NULL AND m.sender_role='customer' AND (?=1 OR t.assigned_to=? OR EXISTS(SELECT 1 FROM requests r WHERE r.id=t.request_id AND r.assigned_to=?))`,[Number(officeScope(auth)),auth.user.id,auth.user.id],
  );
  ok(res, { unread: Number(row?.c ?? 0) });
}));
