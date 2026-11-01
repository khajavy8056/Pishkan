/**
 * Support desk ("پشتیبانی"): structured tickets between customers and the
 * office, separate from per-request conversations.
 *
 * Lifecycle: open → answered (staff replied) / waiting_customer (staff asked
 * something) → resolved → closed. Customers can reopen a resolved ticket by
 * replying, and rate the handling once it is resolved/closed. Staff internal
 * notes live in the same message stream but are never exposed to customers.
 */
import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { hasPermission } from '../../lib/permissions.js';
import { notifyRole, notifyUser } from '../notifications/service.js';

export const DEPARTMENTS = ['general', 'technical', 'financial', 'services', 'complaint'] as const;
export const DEPARTMENT_LABELS: Record<string, string> = {
  general: 'پشتیبانی عمومی',
  technical: 'فنی و سامانه',
  financial: 'مالی و پرداخت',
  services: 'پیگیری خدمات',
  complaint: 'شکایت و پیشنهاد',
};
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'answered', 'waiting_customer', 'resolved', 'closed'] as const;

type Actor = { id: string; name: string; kind: string; permissions: string[] | '*' };

function messageDto(row: any) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    senderId: row.sender_id,
    senderName: row.sender_name ?? null,
    senderRole: row.sender_role,
    body: row.body,
    fileId: row.file_id,
    isInternal: Boolean(row.is_internal),
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function ticketDto(row: any, messages?: any[]) {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    customerMobile: row.customer_mobile ?? null,
    requestId: row.request_id,
    requestTrackingCode: row.request_tracking_code ?? null,
    department: row.department,
    departmentLabel: DEPARTMENT_LABELS[row.department] ?? row.department,
    subject: row.subject,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to,
    assigneeName: row.assignee_name ?? null,
    rating: row.rating === null ? null : Number(row.rating),
    ratingNote: row.rating_note,
    lastMessageAt: row.last_message_at,
    lastSender: row.last_sender,
    lastMessage: row.last_message ?? null,
    unreadForStaff: Number(row.unread_for_staff ?? 0),
    unreadForCustomer: Number(row.unread_for_customer ?? 0),
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(messages ? { messages: messages.map(messageDto) } : {}),
  };
}

const TICKET_SELECT = `
  SELECT t.*, c.full_name AS customer_name, c.mobile AS customer_mobile,
         a.full_name AS assignee_name, r.tracking_code AS request_tracking_code,
         (SELECT body FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.is_internal = 0 ORDER BY m.created_at DESC LIMIT 1) AS last_message,
         (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.read_at IS NULL AND m.sender_role = 'customer') AS unread_for_staff,
         (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.read_at IS NULL AND m.sender_role <> 'customer' AND m.is_internal = 0) AS unread_for_customer
  FROM support_tickets t
  JOIN users c ON c.id = t.customer_id
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN requests r ON r.id = t.request_id`;

async function nextTicketNumber(): Promise<string> {
  // Numbers are human-facing; start at 1001. The unique index is the guard —
  // callers retry on conflict.
  const row = await one<{ c: number }>('SELECT COUNT(*) AS c FROM support_tickets');
  return `SUP-${1001 + Number(row?.c ?? 0)}`;
}

async function assertAttachableFile(fileId: string | undefined, ownerId: string) {
  if (!fileId) return;
  const file = await one<any>('SELECT owner_id, is_public FROM files WHERE id = ?', [fileId]);
  if (!file) throw badRequest('فایل پیوست یافت نشد.');
  if (file.owner_id !== ownerId) throw forbidden('فقط فایل بارگذاری‌شده توسط خودتان قابل پیوست است.');
  if (Number(file.is_public)) throw badRequest('فایل عمومی را نمی‌توان به تیکت پیوست کرد.');
}

export async function createTicket(input: {
  customerId: string;
  department: string;
  subject: string;
  body: string;
  priority?: string;
  requestId?: string | null;
  fileId?: string;
}, actor: Actor) {
  if (!DEPARTMENTS.includes(input.department as any)) throw badRequest('بخش پشتیبانی معتبر نیست.');
  const priority = PRIORITIES.includes(input.priority as any) ? input.priority! : 'normal';
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 3) throw badRequest('موضوع تیکت را کامل بنویسید.');
  if (body.length < 5) throw badRequest('متن پیام را کامل بنویسید.');
  if (input.requestId) {
    const request = await one<any>('SELECT customer_id FROM requests WHERE id = ?', [input.requestId]);
    if (!request || request.customer_id !== input.customerId) throw badRequest('درخواست انتخاب‌شده متعلق به شما نیست.');
  }
  await assertAttachableFile(input.fileId, input.customerId);

  const ticketId = id('tkt');
  const ts = nowIso();
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const number = await nextTicketNumber();
      await run(
        `INSERT INTO support_tickets (id, number, customer_id, request_id, department, subject, priority,
           status, last_message_at, last_sender, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 'customer', ?, ?)`,
        [ticketId, number, input.customerId, input.requestId ?? null, input.department, subject, priority, ts, ts, ts],
      );
      await run(
        `INSERT INTO support_ticket_messages (id, ticket_id, sender_id, sender_role, body, file_id, is_internal, created_at)
         VALUES (?, ?, ?, 'customer', ?, ?, 0, ?)`,
        [id('tkm'), ticketId, input.customerId, body, input.fileId ?? null, ts],
      );
      await notifyRole(['super_admin', 'manager'], {
        title: 'تیکت پشتیبانی جدید',
        body: `${number} — ${subject} (${DEPARTMENT_LABELS[input.department] ?? input.department})`,
        kind: priority === 'urgent' || priority === 'high' ? 'warning' : 'info',
        link: '/admin/support',
        idempotencyKey: `support-new:${ticketId}`,
      }).catch(() => undefined);
      return getTicket(ticketId, actor);
    } catch (error) {
      lastError = error;
      if (!String(error instanceof Error ? error.message : error).toLowerCase().includes('unique')) throw error;
      // Number collided with a parallel insert; clean the half-created row set and retry.
      await run('DELETE FROM support_ticket_messages WHERE ticket_id = ?', [ticketId]).catch(() => undefined);
      await run('DELETE FROM support_tickets WHERE id = ?', [ticketId]).catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : conflict('ثبت تیکت ناموفق بود؛ دوباره تلاش کنید.');
}

async function loadTicketRow(ticketId: string, actor: Actor) {
  const row = await one<any>(`${TICKET_SELECT} WHERE t.id = ?`, [ticketId]);
  if (!row) throw notFound('تیکت یافت نشد.');
  if (actor.kind === 'customer') {
    if (row.customer_id !== actor.id) throw notFound('تیکت یافت نشد.');
  } else if (!hasPermission(actor.permissions, 'support.view')) {
    throw forbidden('دسترسی مشاهدهٔ تیکت‌های پشتیبانی ندارید.');
  }
  return row;
}

export async function getTicket(ticketId: string, actor: Actor) {
  const row = await loadTicketRow(ticketId, actor);
  const messages = await q<any>(
    `SELECT m.*, u.full_name AS sender_name FROM support_ticket_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.ticket_id = ? ${actor.kind === 'customer' ? 'AND m.is_internal = 0' : ''}
     ORDER BY m.created_at ASC LIMIT 500`,
    [ticketId],
  );
  // Opening a ticket marks the other side's messages as read.
  if (actor.kind === 'customer') {
    await run(
      "UPDATE support_ticket_messages SET read_at = COALESCE(read_at, ?) WHERE ticket_id = ? AND sender_role <> 'customer'",
      [nowIso(), ticketId],
    );
  } else {
    await run(
      "UPDATE support_ticket_messages SET read_at = COALESCE(read_at, ?) WHERE ticket_id = ? AND sender_role = 'customer'",
      [nowIso(), ticketId],
    );
  }
  const dto = ticketDto(row, messages);
  dto.unreadForStaff = actor.kind === 'customer' ? dto.unreadForStaff : 0;
  dto.unreadForCustomer = actor.kind === 'customer' ? 0 : dto.unreadForCustomer;
  return dto;
}

export async function listTickets(params: {
  actor: Actor;
  status?: string;
  department?: string;
  priority?: string;
  mine?: boolean;
  unassigned?: boolean;
  query?: string;
  page?: number;
  pageSize?: number;
}) {
  const { actor } = params;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));
  const where: string[] = [];
  const args: any[] = [];
  if (actor.kind === 'customer') {
    where.push('t.customer_id = ?');
    args.push(actor.id);
  } else {
    if (!hasPermission(actor.permissions, 'support.view')) throw forbidden('دسترسی مشاهدهٔ تیکت‌های پشتیبانی ندارید.');
    if (params.mine) { where.push('t.assigned_to = ?'); args.push(actor.id); }
    if (params.unassigned) where.push('t.assigned_to IS NULL');
  }
  if (params.status && TICKET_STATUSES.includes(params.status as any)) { where.push('t.status = ?'); args.push(params.status); }
  if (params.department && DEPARTMENTS.includes(params.department as any)) { where.push('t.department = ?'); args.push(params.department); }
  if (params.priority && PRIORITIES.includes(params.priority as any)) { where.push('t.priority = ?'); args.push(params.priority); }
  if (params.query) {
    where.push('(t.subject LIKE ? OR t.number LIKE ? OR c.full_name LIKE ?)');
    args.push(`%${params.query}%`, `%${params.query}%`, `%${params.query}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM support_tickets t JOIN users c ON c.id = t.customer_id ${clause}`, args,
  );
  const rows = await q<any>(
    `${TICKET_SELECT} ${clause}
     ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 WHEN 'waiting_customer' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
              CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              COALESCE(t.last_message_at, t.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map((row) => ticketDto(row)), total: Number(total?.c ?? 0), page, pageSize };
}

export async function replyToTicket(ticketId: string, input: { body: string; fileId?: string; internal?: boolean }, actor: Actor) {
  const ticket = await loadTicketRow(ticketId, actor);
  const body = input.body.trim();
  if (body.length < 2) throw badRequest('متن پاسخ را بنویسید.');
  const isCustomer = actor.kind === 'customer';
  if (!isCustomer && !hasPermission(actor.permissions, 'support.create')) throw forbidden('دسترسی پاسخ‌گویی ندارید.');
  const internal = !isCustomer && Boolean(input.internal);
  if (ticket.status === 'closed' && !internal) {
    throw conflict(isCustomer ? 'این تیکت بسته شده است؛ برای موضوع جدید یک تیکت تازه باز کنید.' : 'این تیکت بسته شده است.');
  }
  await assertAttachableFile(input.fileId, actor.id);
  const ts = nowIso();
  await run(
    `INSERT INTO support_ticket_messages (id, ticket_id, sender_id, sender_role, body, file_id, is_internal, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id('tkm'), ticketId, actor.id, isCustomer ? 'customer' : actor.kind === 'admin' ? 'admin' : 'staff', body, input.fileId ?? null, internal ? 1 : 0, ts],
  );
  if (!internal) {
    // A customer reply reopens a resolved ticket; a staff reply moves it to
    // "answered" so queues can distinguish who owes the next move.
    const nextStatus = isCustomer ? 'open' : 'answered';
    await run(
      `UPDATE support_tickets SET status = ?, last_message_at = ?, last_sender = ?, resolved_at = CASE WHEN ? THEN NULL ELSE resolved_at END, updated_at = ? WHERE id = ?`,
      [nextStatus, ts, isCustomer ? 'customer' : 'staff', isCustomer ? 1 : 0, ts, ticketId],
    );
    if (isCustomer) {
      const target = ticket.assigned_to;
      if (target) {
        await notifyUser(target, {
          title: 'پاسخ جدید در تیکت پشتیبانی',
          body: `${ticket.number} — ${ticket.subject}`,
          kind: 'info', link: '/staff/support',
        }).catch(() => undefined);
      } else {
        await notifyRole(['super_admin', 'manager'], {
          title: 'پاسخ جدید در تیکت بدون مسئول',
          body: `${ticket.number} — ${ticket.subject}`,
          kind: 'info', link: '/admin/support',
        }).catch(() => undefined);
      }
    } else {
      await notifyUser(ticket.customer_id, {
        title: 'پاسخ پشتیبانی دریافت شد',
        body: `تیکت ${ticket.number} پاسخ داده شد: ${ticket.subject}`,
        kind: 'success', link: '/app/support',
      }).catch(() => undefined);
    }
  }
  return getTicket(ticketId, actor);
}

export async function updateTicket(ticketId: string, input: {
  status?: string; priority?: string; assignedTo?: string | null; department?: string;
}, actor: Actor) {
  const ticket = await loadTicketRow(ticketId, actor);
  const isCustomer = actor.kind === 'customer';
  const ts = nowIso();

  if (isCustomer) {
    // Customers may only close their own ticket (problem solved on their side).
    if (input.status && input.status !== 'closed') throw forbidden('این تغییر وضعیت برای مشتری مجاز نیست.');
    if (input.priority || input.assignedTo !== undefined || input.department) throw forbidden('این تغییر برای مشتری مجاز نیست.');
    if (input.status === 'closed') {
      await run("UPDATE support_tickets SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?", [ts, ts, ticketId]);
    }
    return getTicket(ticketId, actor);
  }

  if (!hasPermission(actor.permissions, 'support.edit')) throw forbidden('دسترسی ویرایش تیکت ندارید.');
  const sets: string[] = ['updated_at = ?'];
  const args: any[] = [ts];
  if (input.status) {
    if (!TICKET_STATUSES.includes(input.status as any)) throw badRequest('وضعیت معتبر نیست.');
    sets.push('status = ?'); args.push(input.status);
    if (input.status === 'resolved') { sets.push('resolved_at = ?'); args.push(ts); }
    if (input.status === 'closed') { sets.push('closed_at = ?'); args.push(ts); }
    if (input.status === 'open') { sets.push('resolved_at = NULL', 'closed_at = NULL'); }
  }
  if (input.priority) {
    if (!PRIORITIES.includes(input.priority as any)) throw badRequest('اولویت معتبر نیست.');
    sets.push('priority = ?'); args.push(input.priority);
  }
  if (input.department) {
    if (!DEPARTMENTS.includes(input.department as any)) throw badRequest('بخش پشتیبانی معتبر نیست.');
    sets.push('department = ?'); args.push(input.department);
  }
  if (input.assignedTo !== undefined) {
    if (input.assignedTo) {
      const assignee = await one<any>(
        `SELECT u.id, u.kind, u.status, r.permissions FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        [input.assignedTo],
      );
      let permissions: string[] | '*' = [];
      try { permissions = assignee?.permissions === '*' ? '*' : JSON.parse(assignee?.permissions ?? '[]'); } catch { permissions = []; }
      if (!assignee || assignee.kind === 'customer' || assignee.status !== 'active' || !hasPermission(permissions, 'support.view')) {
        throw badRequest('مسئول تیکت باید کارمند فعال و دارای دسترسی پشتیبانی باشد.');
      }
    }
    sets.push('assigned_to = ?'); args.push(input.assignedTo);
  }
  await run(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`, [...args, ticketId]);

  if (input.status === 'resolved' || input.status === 'closed') {
    await notifyUser(ticket.customer_id, {
      title: input.status === 'resolved' ? 'تیکت شما حل‌شده علامت خورد' : 'تیکت شما بسته شد',
      body: `${ticket.number} — ${ticket.subject}`,
      kind: 'success', link: '/app/support',
      idempotencyKey: `support-${input.status}:${ticketId}:${ts}`,
    }).catch(() => undefined);
  }
  if (input.assignedTo && input.assignedTo !== actor.id) {
    await notifyUser(input.assignedTo, {
      title: 'تیکت پشتیبانی به شما واگذار شد',
      body: `${ticket.number} — ${ticket.subject}`,
      kind: 'info', link: '/staff/support',
      idempotencyKey: `support-assign:${ticketId}:${input.assignedTo}`,
    }).catch(() => undefined);
  }
  return getTicket(ticketId, actor);
}

export async function rateTicket(ticketId: string, input: { rating: number; note?: string }, actor: Actor) {
  const ticket = await loadTicketRow(ticketId, actor);
  if (actor.kind !== 'customer') throw forbidden('فقط صاحب تیکت می‌تواند امتیاز بدهد.');
  if (!['resolved', 'closed'].includes(ticket.status)) throw conflict('پس از حل‌شدن تیکت می‌توانید امتیاز بدهید.');
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw badRequest('امتیاز باید بین ۱ تا ۵ باشد.');
  await run(
    'UPDATE support_tickets SET rating = ?, rating_note = ?, updated_at = ? WHERE id = ?',
    [input.rating, input.note?.trim() || null, nowIso(), ticketId],
  );
  return getTicket(ticketId, actor);
}

/** Queue counters for badges/dashboards. */
export async function supportStats(actor: Actor) {
  if (actor.kind === 'customer') {
    const row = await one<any>(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('open','answered','waiting_customer') THEN 1 ELSE 0 END),0) AS open_count,
              (SELECT COUNT(*) FROM support_ticket_messages m JOIN support_tickets t ON t.id = m.ticket_id
                WHERE t.customer_id = ? AND m.sender_role <> 'customer' AND m.is_internal = 0 AND m.read_at IS NULL) AS unread
       FROM support_tickets WHERE customer_id = ?`,
      [actor.id, actor.id],
    );
    return { open: Number(row?.open_count ?? 0), unread: Number(row?.unread ?? 0) };
  }
  if (!hasPermission(actor.permissions, 'support.view')) throw forbidden('دسترسی مشاهدهٔ تیکت‌های پشتیبانی ندارید.');
  const row = await one<any>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END),0) AS open_count,
            COALESCE(SUM(CASE WHEN status = 'open' AND assigned_to IS NULL THEN 1 ELSE 0 END),0) AS unassigned,
            COALESCE(SUM(CASE WHEN assigned_to = ? AND status IN ('open','answered','waiting_customer') THEN 1 ELSE 0 END),0) AS mine,
            (SELECT COUNT(*) FROM support_ticket_messages WHERE sender_role = 'customer' AND read_at IS NULL) AS unread
     FROM support_tickets`,
    [actor.id],
  );
  return {
    open: Number(row?.open_count ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    mine: Number(row?.mine ?? 0),
    unread: Number(row?.unread ?? 0),
  };
}
