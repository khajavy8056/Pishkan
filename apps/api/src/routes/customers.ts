import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { one, q, run, nowIso } from '../db/index.js';
import { hashPassword, id } from '../lib/crypto.js';
import { hasPermission } from '../lib/permissions.js';
import { writeAudit } from '../modules/audit/service.js';
import { listRequests, requestStats } from '../modules/requests/service.js';
import { listInvoices } from '../modules/accounting/service.js';
import { normalizeMobile } from '../modules/sms/provider.js';
import { validatePasswordAgainstPolicy } from '../modules/auth/service.js';
import { listNotifications, markRead } from '../modules/notifications/service.js';
import { param } from '../http/params.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

/* --------------------------- customer self service -------------------------- */

/** Notifications for the logged-in user (customer or staff). */
customersRouter.get('/me/notifications', asyncRoute(async (req, res) => {
  const result = await listNotifications(req.auth!.user.id, {
    unreadOnly: req.query.unread === 'true',
    limit: Number(req.query.limit ?? 30),
  });
  ok(res, result.items, { unread: result.unread });
}));

customersRouter.post('/me/notifications/read', asyncRoute(async (req, res) => {
  const body = z.object({ id: z.string().optional() }).parse(req.body ?? {});
  await markRead(req.auth!.user.id, body.id);
  ok(res, { message: 'اعلان‌ها خوانده شد.' });
}));

/** Reusable profile records (kept separately from submitted requests). */
customersRouter.get('/me/records', asyncRoute(async (req, res) => {
  const rows = await q<any>('SELECT * FROM customer_records WHERE customer_id = ? ORDER BY updated_at DESC', [req.auth!.user.id]);
  ok(res, rows.map((r) => ({ id: r.id, key: r.key, label: r.label, value: r.value, updatedAt: r.updated_at })));
}));

customersRouter.put('/me/records', asyncRoute(async (req, res) => {
  const body = z.object({
    records: z.array(z.object({
      key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/),
      label: z.string().max(120).optional(),
      value: z.string().max(2000),
    })).max(50),
  }).parse(req.body);

  for (const record of body.records) {
    const existing = await one<{ id: string }>('SELECT id FROM customer_records WHERE customer_id = ? AND key = ?', [req.auth!.user.id, record.key]);
    if (existing) {
      await run('UPDATE customer_records SET value = ?, label = ?, updated_at = ? WHERE id = ?', [record.value, record.label ?? null, nowIso(), existing.id]);
    } else {
      await run(
        'INSERT INTO customer_records (id, customer_id, key, label, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id('crec'), req.auth!.user.id, record.key, record.label ?? null, record.value, nowIso(), nowIso()],
      );
    }
  }
  ok(res, { message: 'اطلاعات ذخیره شد.' });
}));

/** Customer's own overview: requests, invoices, totals. */
customersRouter.get('/me/overview', asyncRoute(async (req, res) => {
  const customerId = req.auth!.user.id;
  const [requests, invoices, stats, notifications] = await Promise.all([
    listRequests({ customerId, pageSize: 5 }),
    listInvoices({ customerId, pageSize: 5 }),
    requestStats({ customerId }),
    listNotifications(customerId, { limit: 5 }),
  ]);
  const payments = await q<any>(
    `SELECT * FROM payments WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5`, [customerId],
  );
  ok(res, {
    stats,
    recentRequests: requests.items,
    recentInvoices: invoices.items,
    recentPayments: payments.map((p) => ({
      id: p.id, amount: Number(p.amount), method: p.method, status: p.status, createdAt: p.created_at,
    })),
    notifications: notifications.items,
    unreadNotifications: notifications.unread,
  });
}));

/* ------------------------------ staff / admin ----------------------------- */

customersRouter.get('/', requirePermission('customers.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 25 });
  const where: string[] = [`u.kind = 'customer'`];
  const args: any[] = [];
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    where.push('(u.full_name LIKE ? OR u.mobile LIKE ? OR u.national_id LIKE ?)');
    const s = `%${req.query.search.trim()}%`;
    args.push(s, s, s);
  }
  if (req.query.status === 'active' || req.query.status === 'pending' || req.query.status === 'suspended') {
    where.push('u.status = ?'); args.push(req.query.status);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM users u ${clause}`, args);
  const rows = await q<any>(
    `SELECT u.*, p.city, p.province,
       (SELECT COUNT(*) FROM requests r WHERE r.customer_id = u.id) AS request_count,
       (SELECT COALESCE(SUM(i.total - i.paid_amount),0) FROM invoices i WHERE i.customer_id = u.id AND i.status IN ('issued','partially_paid')) AS outstanding
     FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
     ${clause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  ok(res, rows.map((r) => ({
    id: r.id, fullName: r.full_name, mobile: r.mobile, email: r.email, nationalId: r.national_id,
    status: r.status, city: r.city, province: r.province, mobileVerified: Boolean(r.mobile_verified),
    requestCount: Number(r.request_count), outstanding: Number(r.outstanding), createdAt: r.created_at,
  })), { total: Number(total?.c ?? 0), page, pageSize });
}));

customersRouter.post('/', requirePermission('customers.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    fullName: z.string().min(3).max(120),
    mobile: z.string().min(10).max(20),
    email: z.string().email().optional().or(z.literal('')),
    nationalId: z.string().length(10).optional().or(z.literal('')),
    address: z.string().max(500).optional(),
    city: z.string().max(60).optional(),
    province: z.string().max(60).optional(),
    password: z.string().min(8).max(200).optional(),
  }).parse(req.body);

  const mobile = normalizeMobile(body.mobile);
  if (await one('SELECT id FROM users WHERE mobile = ?', [mobile])) throw conflict('کاربری با این شماره موبایل وجود دارد.');
  if (body.password) await validatePasswordAgainstPolicy(body.password);

  const userId = id('usr');
  const ts = nowIso();
  await run(
    `INSERT INTO users (id, kind, mobile, mobile_verified, email, password_hash, full_name, national_id, status, created_at, updated_at)
     VALUES (?, 'customer', ?, 1, ?, ?, ?, ?, 'active', ?, ?)`,
    [userId, mobile, body.email || null, body.password ? await hashPassword(body.password) : null,
      body.fullName, body.nationalId || null, ts, ts],
  );
  await run(
    `INSERT INTO customer_profiles (user_id, address, province, city, extra, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)`,
    [userId, body.address ?? null, body.province ?? null, body.city ?? null, ts, ts],
  );
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'customer.create',
    entityType: 'user', entityId: userId, after: { fullName: body.fullName, mobile }, ip: req.ip,
  });
  created(res, { id: userId, fullName: body.fullName, mobile });
}));

customersRouter.get('/:id', requirePermission('customers.view'), asyncRoute(async (req, res) => {
  const user = await one<any>(`SELECT * FROM users WHERE id = ? AND kind = 'customer'`, [param(req, 'id')]);
  if (!user) throw notFound('مشتری یافت نشد.');
  const profile = await one<any>('SELECT * FROM customer_profiles WHERE user_id = ?', [user.id]);
  const [requests, invoices] = await Promise.all([
    listRequests({ customerId: user.id, pageSize: 10 }),
    listInvoices({ customerId: user.id, pageSize: 10 }),
  ]);
  const documents = await q<any>(
    `SELECT d.id, d.title, d.status, d.created_at, f.name AS file_name, f.mime, f.size FROM request_documents d
     JOIN files f ON f.id = d.file_id JOIN requests r ON r.id = d.request_id
     WHERE r.customer_id = ? ORDER BY d.created_at DESC`, [user.id],
  );
  ok(res, {
    id: user.id,
    fullName: user.full_name,
    mobile: user.mobile,
    email: user.email,
    nationalId: user.national_id,
    status: user.status,
    mobileVerified: Boolean(user.mobile_verified),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    profile: profile ? {
      address: profile.address, postalCode: profile.postal_code, birthDate: profile.birth_date,
      jobTitle: profile.job_title, province: profile.province, city: profile.city,
    } : null,
    stats: await requestStats({ customerId: user.id }),
    requests: requests.items,
    invoices: invoices.items,
    documents: documents.map((d) => ({
      id: d.id, title: d.title, status: d.status, createdAt: d.created_at,
      file: { name: d.file_name, mime: d.mime, size: Number(d.size) },
    })),
  });
}));

customersRouter.patch('/:id', requirePermission('customers.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    fullName: z.string().min(3).max(120).optional(),
    email: z.string().email().optional().or(z.literal('')),
    nationalId: z.string().length(10).optional().or(z.literal('')),
    status: z.enum(['active', 'pending', 'suspended']).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(60).optional(),
    province: z.string().max(60).optional(),
    notes: z.string().max(2000).optional(),
  }).parse(req.body);

  const user = await one<any>('SELECT * FROM users WHERE id = ? AND kind = ?', [param(req, 'id'), 'customer']);
  if (!user) throw notFound('مشتری یافت نشد.');

  await run(
    `UPDATE users SET full_name = ?, email = ?, national_id = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [
      body.fullName ?? user.full_name,
      body.email !== undefined ? (body.email || null) : user.email,
      body.nationalId !== undefined ? (body.nationalId || null) : user.national_id,
      body.status ?? user.status,
      body.notes ?? user.notes,
      nowIso(), user.id,
    ],
  );
  const profile = await one<any>('SELECT * FROM customer_profiles WHERE user_id = ?', [user.id]);
  if (profile) {
    await run(
      'UPDATE customer_profiles SET address = ?, city = ?, province = ?, updated_at = ? WHERE user_id = ?',
      [body.address ?? profile.address, body.city ?? profile.city, body.province ?? profile.province, nowIso(), user.id],
    );
  }

  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'customer.update',
    entityType: 'user', entityId: user.id,
    before: { status: user.status, fullName: user.full_name },
    after: { status: body.status ?? user.status, fullName: body.fullName ?? user.full_name }, ip: req.ip,
  });
  ok(res, { message: 'اطلاعات مشتری ذخیره شد.' });
}));

customersRouter.post('/:id/reset-password', requirePermission('customers.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ password: z.string().min(8).max(200) }).parse(req.body);
  await validatePasswordAgainstPolicy(body.password);
  const user = await one<any>('SELECT id FROM users WHERE id = ? AND kind = ?', [param(req, 'id'), 'customer']);
  if (!user) throw notFound('مشتری یافت نشد.');
  await run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [await hashPassword(body.password), nowIso(), user.id]);
  await run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), user.id]);
  await writeAudit({ actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'customer.reset_password', entityType: 'user', entityId: user.id, ip: req.ip });
  ok(res, { message: 'رمز عبور بازنشانی شد و نشست‌های قبلی بسته شدند.' });
}));

customersRouter.delete('/:id', requirePermission('customers.delete'), asyncRoute(async (req, res) => {
  const user = await one<any>('SELECT id FROM users WHERE id = ? AND kind = ?', [param(req, 'id'), 'customer']);
  if (!user) throw notFound('مشتری یافت نشد.');
  const requests = await one<{ c: number }>('SELECT COUNT(*) AS c FROM requests WHERE customer_id = ?', [user.id]);
  if (Number(requests?.c ?? 0) > 0) {
    throw conflict('این مشتری سابقه درخواست دارد و حذف نمی‌شود؛ به‌جای حذف، حساب را غیرفعال کنید.');
  }
  await run('DELETE FROM users WHERE id = ?', [user.id]);
  await writeAudit({ actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'customer.delete', entityType: 'user', entityId: user.id, ip: req.ip });
  ok(res, { message: 'مشتری حذف شد.' });
}));

/** Access control sanity check used by the UI to hide forbidden actions. */
export async function canCustomerAccess(userId: string, customerId: string) {
  return userId === customerId || hasPermission([], 'customers.view');
}
