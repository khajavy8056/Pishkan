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
import { toPersianDigits } from '../lib/text.js';
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

/**
 * The case a thread belongs to, in the shape both clients render.
 *
 * A conversation opened from a case must always say which case it is: without
 * the tracking code and the service title in the payload, the office saw a row
 * called «گفت‌وگو درباره پرونده» that identified nothing, and the customer had
 * no way back to the file the message was about. Every thread response carries
 * this object, so web and Android show the same chip and link.
 */
async function requestRef(requestId: string | null): Promise<Record<string, any> | null> {
  if (!requestId) return null;
  const row = await one<any>(
    `SELECT r.id, r.tracking_code, r.status, r.customer_id, s.title AS service_title
     FROM requests r LEFT JOIN services s ON s.id = r.service_id WHERE r.id = ?`,
    [requestId],
  );
  if (!row) return null;
  return {
    id: row.id,
    trackingCode: row.tracking_code,
    title: row.service_title ?? 'خدمت',
    status: row.status,
    customerId: row.customer_id,
  };
}

/** Subject line that names the case, so a list of threads is self-describing. */
function caseSubject(trackingCode: string, serviceTitle: string): string {
  return `پرونده ${toPersianDigits(trackingCode)} — ${serviceTitle}`;
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
            r.tracking_code AS request_tracking_code, s.title AS request_service_title,
            r.status AS request_status,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.read_at IS NULL
              AND m.sender_role IN ('customer')) AS unread_from_customer,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.read_at IS NULL
              AND m.sender_role IN ('staff','admin','system')) AS unread_from_staff,
            (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
     FROM threads t JOIN users u ON u.id = t.customer_id
     LEFT JOIN requests r ON r.id = t.request_id
     LEFT JOIN services s ON s.id = r.service_id
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
    // Denormalised from the join above on purpose: the clients render the list
    // before any detail request exists, and the case chip has to be there from
    // the first paint.
    request: r.request_id ? {
      id: r.request_id,
      trackingCode: r.request_tracking_code ?? '',
      title: r.request_service_title ?? 'خدمت',
      status: r.request_status ?? null,
      customerId: r.customer_id,
    } : null,
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
  if (auth.user.kind !== 'customer' && !hasPermission(auth.permissions, 'messages.create')) throw forbidden();

  let caseRef: Record<string, any> | null = null;
  let customerId = auth.user.kind === 'customer' ? auth.user.id : body.customerId;

  if (body.requestId) {
    const target = await one<any>(
      `SELECT r.id, r.customer_id, r.assigned_to, r.tracking_code, s.title AS service_title
       FROM requests r LEFT JOIN services s ON s.id = r.service_id WHERE r.id = ?`,
      [body.requestId],
    );
    if (!target) throw notFound('پرونده یافت نشد.');
    if(auth.user.kind!=='customer' && !officeScope(auth) && target.assigned_to!==auth.user.id) throw forbidden();
    // A conversation about a case already knows whose case it is. The office
    // opens chat from the case page — it has no customer picker there — and
    // demanding customerId anyway answered the click with «مشتری را مشخص کنید»,
    // which is the dead end that made the whole feature look broken.
    if (!customerId) customerId = target.customer_id;
    if (target.customer_id !== customerId) throw badRequest('پرونده به این مشتری تعلق ندارد.');
    caseRef = {
      id: target.id, trackingCode: target.tracking_code ?? '', title: target.service_title ?? 'خدمت',
      status: target.status ?? null, customerId: target.customer_id,
    };
    const existing = await one<any>('SELECT * FROM threads WHERE request_id = ? AND customer_id = ?', [target.id, customerId]);
    if (existing) {
      // Find-or-create, and the identity travels on the way back: the caller
      // opened a chat "about this case" and must land in exactly that thread,
      // with the case named, whether it already existed or not.
      return ok(res, { id: existing.id, existing: true, request: await requestRef(existing.request_id) });
    }
  }

  if (!customerId) throw badRequest('برای ایجاد گفت‌وگو، مشتری یا پرونده را مشخص کنید.');
  const customer = await one('SELECT id FROM users WHERE id = ? AND kind = ? AND status = \'active\'', [customerId, 'customer']);
  if (!customer) throw badRequest('مشتری انتخاب‌شده معتبر یا فعال نیست.');

  if(auth.user.kind!=='customer'&&!officeScope(auth)&&!body.requestId) throw forbidden('گفت‌وگو باید به پرونده شما متصل باشد.');
  const threadId = id('thr');
  const ts = nowIso();
  // A case conversation owns a subject that names the case, and a staff member
  // who starts one is its handler: the thread is created assigned to them so
  // the customer's reply lands in their inbox instead of an anonymous pool.
  const subject = body.subject ?? (caseRef ? caseSubject(caseRef.trackingCode, caseRef.title) : 'گفت‌وگو با دفتر');
  const creatorIsStaff = auth.user.kind !== 'customer';
  const assignedTo = creatorIsStaff && auth.user.kind === 'staff' ? auth.user.id : null;
  await run(
    `INSERT INTO threads (id, scope, request_id, customer_id, subject, status, assigned_to, last_message_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [threadId, body.requestId ? 'request' : 'general', body.requestId ?? null, customerId,
      subject, assignedTo, ts, ts],
  );

  if (body.message) {
    await run(
      `INSERT INTO messages (id, thread_id, sender_id, sender_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id('msg'), threadId, auth.user.id, auth.user.kind, body.message.slice(0, 4000), ts],
    );
  }

  // A conversation is never silent on either side. An office-initiated one is
  // an event for the customer; a customer-initiated one is a task for the
  // office. Before this, a chat opened from the customer's side notified
  // nobody at all when no handler had been attached to it yet.
  if (creatorIsStaff) {
    await notifyUser(customerId, {
      title: caseRef ? `پیام جدید دربارهٔ پرونده ${toPersianDigits(caseRef.trackingCode)}` : 'پیام جدید از دفتر',
      body: (body.message ?? 'دفتر گفت‌وگویی دربارهٔ پروندهٔ شما آغاز کرده است.').slice(0, 140),
      kind: 'info',
      link: threadLink('customer', threadId),
      eventType: 'message',
      idempotencyKey: `thread-open:${threadId}`,
    }).catch(() => undefined);
  } else if (body.message) {
    const watchers = await threadWatchers({ assigned_to: assignedTo, request_id: body.requestId ?? null });
    for (const watcher of watchers) {
      await notifyUser(watcher.id, {
        title: caseRef ? `پرسش جدید مشتری — پرونده ${toPersianDigits(caseRef.trackingCode)}` : 'پیام جدید مشتری',
        body: String(body.message).slice(0, 140),
        kind: 'info',
        link: threadLink(watcher.kind, threadId),
        eventType: 'message',
        idempotencyKey: `thread-open:${threadId}:${watcher.id}`,
      }).catch(() => undefined);
    }
  }

  created(res, { id: threadId, subject, request: caseRef });
}));

/**
 * Panel route for one conversation, per recipient.
 *
 * A notice must land inside the chat it is about. The customer panel and the
 * office panel each have their own path, and an admin opening a /staff link
 * would be bounced — so the link is built from who is receiving it.
 */
function threadLink(kind: string, threadId: string): string {
  if (kind === 'customer') return `/app/messages/${threadId}`;
  if (kind === 'admin') return `/admin/messages/${threadId}`;
  return `/staff/messages/${threadId}`;
}

/**
 * Who has to see a customer's message.
 *
 * The thread's handler first, then whoever actually owns the case it belongs
 * to, and only if neither exists the office roles. The middle step is the fix
 * for the reported dead end: a conversation opened from a case was unassigned,
 * so the customer's reply notified nobody at all and sat unseen while the
 * employee who was working the file waited for nothing.
 */
async function threadWatchers(thread: any): Promise<{ id: string; kind: string }[]> {
  const candidates: (string | null | undefined)[] = [thread.assigned_to];
  if (thread.request_id) {
    const request = await one<any>('SELECT assigned_to FROM requests WHERE id = ?', [thread.request_id]).catch(() => null);
    candidates.push(request?.assigned_to ?? null);
  }
  for (const userId of candidates) {
    if (!userId) continue;
    const user = await one<{ id: string; kind: string }>(
      `SELECT id, kind FROM users WHERE id = ? AND status = 'active'`, [userId],
    );
    if (user) return [user];
  }
  return q<{ id: string; kind: string }>(
    `SELECT u.id, u.kind FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.code IN ('super_admin','manager') AND u.status = 'active'`,
  );
}

/** The one message shape every client (web panel, PWA, Android) reads. */
function mapMessage(m: any) {
  return {
    id: m.id, body: m.body, senderId: m.sender_id, senderRole: m.sender_role,
    senderName: m.sender_name, fileId: m.file_id, createdAt: m.created_at, readAt: m.read_at,
    // Attachment metadata so the client can render a preview without an extra request.
    file: m.file_id ? {
      id: m.file_id,
      name: m.file_name ?? 'پیوست',
      mime: m.file_mime ?? null,
      size: m.file_size === null || m.file_size === undefined ? null : Number(m.file_size),
      processingStatus: m.file_processing_status ?? null,
    } : null,
  };
}

/** Rows with the sender name and attachment metadata already joined. */
async function messageRows(threadId: string, after = '') {
  return q<any>(
    `SELECT m.*, u.full_name AS sender_name,
            f.name AS file_name, f.mime AS file_mime, f.size AS file_size,
            f.processing_status AS file_processing_status
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN files f ON f.id = m.file_id
      WHERE m.thread_id = ? ${after ? 'AND m.created_at > ?' : ''}
      ORDER BY m.created_at ASC LIMIT ${after ? 200 : 500}`,
    after ? [threadId, after] : [threadId],
  );
}

/**
 * Typing presence, in memory.
 *
 * Deliberately not a table: presence is a 6-second TTL that nobody queries
 * later, and writing it per keystroke would put a chat animation in front of
 * the conversation table. A multi-process deployment loses it between workers,
 * which degrades to "no typing indicator" — the correct failure direction.
 */
const typingPeers = new Map<string, number>();
const TYPING_TTL_MS = 6_000;

function markTyping(threadId: string, userId: string, typing: boolean) {
  const key = `${threadId}:${userId}`;
  if (typing) typingPeers.set(key, Date.now() + TYPING_TTL_MS);
  else typingPeers.delete(key);
}

function anyoneTyping(threadId: string, exceptUserId: string): boolean {
  const now = Date.now();
  for (const [key, until] of typingPeers) {
    if (until < now) { typingPeers.delete(key); continue; }
    const [thread, user] = key.split(':');
    if (thread === threadId && user !== exceptUserId) return true;
  }
  return false;
}

messagesRouter.get('/threads/:id', asyncRoute(async (req, res) => {
  const thread = await loadThread(param(req, 'id'), req);
  const messages = await messageRows(thread.id);
  await run(
    `UPDATE messages SET read_at = ? WHERE thread_id = ? AND read_at IS NULL AND sender_role <> ?`,
    [nowIso(), thread.id, req.auth!.user.kind === 'customer' ? 'customer' : 'staff'],
  );
  ok(res, {
    thread: {
      id: thread.id, scope: thread.scope, requestId: thread.request_id, subject: thread.subject,
      status: thread.status, customerId: thread.customer_id, customerName: thread.customer_name,
      assignedTo: thread.assigned_to, createdAt: thread.created_at,
      // The chat screen's header chip and its "back to the case" link come from
      // here, so opening the thread from a notice identifies the case just as
      // well as opening it from the case itself did.
      request: await requestRef(thread.request_id),
    },
    messages: messages.map(mapMessage),
  });
}));

/**
 * Incremental refresh for a conversation that is open on screen.
 *
 * Android polls this every few seconds while the thread is visible (the app
 * never holds a socket). It existed on the client for a long time without a
 * matching route here, so every poll was a 404: the thread fell back to its
 * "تلاش برای اتصال…" state and new messages only appeared after a manual
 * refresh, which is what made a case chat feel dead.
 *
 * `after` is the last `createdAt` the client holds — ISO timestamps compare
 * correctly as text, and a client with no cursor passes nothing and gets the
 * same payload shape with an empty list.
 */
messagesRouter.get('/threads/:id/sync', asyncRoute(async (req, res) => {
  const thread = await loadThread(param(req, 'id'), req);
  const after = typeof req.query.after === 'string' ? req.query.after.slice(0, 40) : '';
  const mineRole = req.auth!.user.kind === 'customer' ? 'customer' : 'staff';
  const fresh = await messageRows(thread.id, after);
  if (fresh.length) {
    await run(
      `UPDATE messages SET read_at = ? WHERE thread_id = ? AND read_at IS NULL AND sender_role <> ?`,
      [nowIso(), thread.id, mineRole],
    );
  }
  // When the other side last read one of ours — the double-tick.
  const counterpartRead = await one<{ read_at: string | null }>(
    `SELECT MAX(read_at) AS read_at FROM messages WHERE thread_id = ? AND sender_role = ?`,
    [thread.id, mineRole],
  );
  ok(res, {
    messages: fresh.map(mapMessage),
    counterpartReadAt: counterpartRead?.read_at ?? '',
    typing: anyoneTyping(thread.id, req.auth!.user.id),
    status: thread.status,
  });
}));

messagesRouter.post('/threads/:id/typing', asyncRoute(async (req, res) => {
  const body = z.object({ typing: z.boolean() }).parse(req.body);
  const thread = await loadThread(param(req, 'id'), req);
  markTyping(thread.id, req.auth!.user.id, body.typing === true);
  ok(res, { ok: true });
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

  // Notify the other side. The customer's notice names the case when the
  // conversation belongs to one, because a bare "پاسخ جدید از دفتر" does not
  // tell anyone which of their files moved.
  const caseRef = await requestRef(thread.request_id);
  const caseSuffix = caseRef ? ` — پرونده ${toPersianDigits(caseRef.trackingCode)}` : '';
  if (req.auth!.user.kind === 'customer') {
    const watchers = await threadWatchers(thread);
    if (watchers.length) {
      for (const watcher of watchers) {
        await notifyUser(watcher.id, {
          title: `پیام جدید مشتری${caseSuffix}`,
          body: body.body.slice(0, 120),
          kind: 'info',
          link: threadLink(watcher.kind, thread.id),
          eventType: 'message',
          idempotencyKey: `message:${messageId}:${watcher.id}`,
        }).catch(() => undefined);
      }
    } else {
      await notifyUser(req.auth!.user.id, { title: 'پیام ارسال شد', body: 'پیام شما ثبت شد و به‌زودی پاسخ داده می‌شود.', kind: 'success' }).catch(() => undefined);
    }
  } else {
    await notifyUser(thread.customer_id, {
      title: `پاسخ جدید از دفتر${caseSuffix}`,
      body: body.body.slice(0, 120),
      kind: 'info',
      link: threadLink('customer', thread.id),
      eventType: 'message',
      idempotencyKey: `message:${messageId}:${thread.customer_id}`,
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
