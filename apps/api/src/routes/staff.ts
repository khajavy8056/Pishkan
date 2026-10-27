import { officeScope } from '../lib/scope.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { one, q, run, nowIso, jsonParse, jsonStringify } from '../db/index.js';
import { hashPassword, id } from '../lib/crypto.js';
import {
  ACTIONS, PERMISSION_LABELS, RESOURCES, RESOURCE_LABELS, allPermissions, expandPermissions, hasPermission,
} from '../lib/permissions.js';
import { writeAudit } from '../modules/audit/service.js';
import { validatePasswordAgainstPolicy, revokeAllSessions } from '../modules/auth/service.js';
import { normalizeMobile } from '../modules/sms/provider.js';
import { getBool, getNumber, getString } from '../modules/settings/service.js';
import { param } from '../http/params.js';

export const staffRouter = Router();
staffRouter.use(requireAuth);

function mapStaff(row: any) {
  return {
    id: row.id,
    fullName: row.full_name,
    mobile: row.mobile,
    email: row.email,
    username: row.username,
    status: row.status,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    employeeCode: row.employee_code,
    position: row.position,
    specialties: jsonParse<string[]>(row.specialties, []),
    maxActiveCases: Number(row.max_active_cases ?? 0),
    acceptsNewCases: Boolean(row.accepts_new_cases),
    activeCases: Number(row.active_cases ?? 0),
    mfaEnabled: Boolean(row.mfa_enabled),
    lastLoginAt: row.last_login_at,
    hiredAt: row.hired_at,
    createdAt: row.created_at,
  };
}

const STAFF_SELECT = `
  SELECT u.*, r.code AS role_code, r.name AS role_name, sp.employee_code, sp.position, sp.specialties,
         sp.max_active_cases, sp.accepts_new_cases, sp.hired_at,
         (SELECT COUNT(*) FROM requests rq WHERE rq.assigned_to = u.id AND rq.status NOT IN ('completed','cancelled','rejected')) AS active_cases
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN staff_profiles sp ON sp.user_id = u.id
`;

/** Staff directory — used by assignment pickers, so permission is view-only. */
staffRouter.get('/', requirePermission('staff.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 50 });
  const where = [`u.kind IN ('staff','admin')`];
  const args: any[] = [];
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    where.push('(u.full_name LIKE ? OR u.mobile LIKE ? OR u.username LIKE ? OR sp.employee_code LIKE ?)');
    const s = `%${req.query.search.trim()}%`;
    args.push(s, s, s, s);
  }
  if (req.query.available === 'true') where.push('sp.accepts_new_cases = 1');
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id ${clause}`, args,
  );
  const rows = await q<any>(`${STAFF_SELECT} ${clause} ORDER BY u.created_at ASC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize]);
  ok(res, rows.map(mapStaff), { total: Number(total?.c ?? 0), page, pageSize });
}));

staffRouter.get('/me/workload', asyncRoute(async (req, res) => {
  const userId = req.auth!.user.id;
  const active = await q<any>(
    `SELECT r.id, r.tracking_code, r.status, r.priority, r.due_at, s.title AS service_title, u.full_name AS customer_name
     FROM requests r JOIN services s ON s.id = r.service_id JOIN users u ON u.id = r.customer_id
     WHERE r.assigned_to = ? AND r.status NOT IN ('completed','cancelled','rejected')
     ORDER BY CASE r.priority WHEN 'high' THEN 0 ELSE 1 END, r.due_at ASC LIMIT 50`, [userId],
  );
  const pendingDocs = hasPermission(req.auth!.permissions,'documents.view') ? await q<any>(
    `SELECT d.id, d.title, d.created_at, r.tracking_code, r.id AS request_id
     FROM request_documents d JOIN requests r ON r.id = d.request_id
     WHERE d.status = 'pending' AND (r.assigned_to = ? OR ? = 1) LIMIT 20`,
    [userId, officeScope(req.auth!) && hasPermission(req.auth!.permissions, 'documents.approve') ? 1 : 0],
  ) : [];
  const today = new Date().toISOString().slice(0, 10);
  const shift = await one<any>('SELECT * FROM shifts WHERE user_id = ? AND shift_date = ? AND status <> ?', [userId, today, 'leave']);
  const attendance = await one<any>(
    `SELECT * FROM attendance WHERE user_id = ? AND check_in >= ? ORDER BY check_in DESC LIMIT 1`,
    [userId, `${today}T00:00:00.000Z`],
  );
  const monthly = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM requests WHERE assigned_to = ? AND status = 'completed' AND completed_at >= ?`,
    [userId, new Date(Date.now() - 30 * 86_400_000).toISOString()],
  );

  ok(res, {
    activeRequests: active.map((r) => ({
      id: r.id, trackingCode: r.tracking_code, status: r.status, priority: r.priority,
      dueAt: r.due_at, serviceTitle: r.service_title, customerName: r.customer_name,
    })),
    pendingDocuments: pendingDocs.map((d) => ({ id: d.id, title: d.title, requestId: d.request_id, trackingCode: d.tracking_code, createdAt: d.created_at })),
    shift: shift ? { id: shift.id, startTime: shift.start_time, endTime: shift.end_time } : null,
    attendance: attendance ? { checkIn: attendance.check_in, checkOut: attendance.check_out } : null,
    completedLast30Days: Number(monthly?.c ?? 0),
    activeCount: active.length,
  });
}));

staffRouter.post('/', requirePermission('staff.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    fullName: z.string().min(3).max(120),
    mobile: z.string().min(10).max(20),
    username: z.string().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    email: z.string().email().optional().or(z.literal('')),
    password: z.string().min(8).max(200),
    roleCode: z.string().min(2),
    employeeCode: z.string().max(40).optional(),
    position: z.string().max(120).optional(),
    specialties: z.array(z.string()).optional(),
    maxActiveCases: z.number().int().min(1).max(500).optional(),
    kind: z.enum(['staff', 'admin']).optional(),
  }).parse(req.body);

  await validatePasswordAgainstPolicy(body.password);
  const role = await one<{ id: string; code: string }>('SELECT id, code FROM roles WHERE code = ?', [body.roleCode]);
  if (!role) throw badRequest('نقش انتخابی وجود ندارد.');
  if (role.code === 'super_admin' && !hasPermission(req.auth!.permissions, 'roles.edit')) {
    throw forbidden('برای ایجاد مدیر کل، دسترسی مدیریت نقش‌ها لازم است.');
  }
  const mobile = normalizeMobile(body.mobile);
  if (await one('SELECT id FROM users WHERE mobile = ?', [mobile])) throw conflict('کاربری با این شماره موبایل وجود دارد.');
  if (body.username && await one('SELECT id FROM users WHERE LOWER(username) = ?', [body.username.toLowerCase()])) {
    throw conflict('این نام کاربری قبلاً استفاده شده است.');
  }

  const ts = nowIso();
  const userId = id('usr');
  const kind = role.code === 'super_admin' || role.code === 'manager' ? 'admin' : 'staff';
  if (body.kind && body.kind !== kind) throw badRequest('نوع حساب باید با نقش انتخابی سازگار باشد.');

  await run(
    `INSERT INTO users (id, kind, role_id, mobile, mobile_verified, email, username, password_hash, full_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', ?, ?)`,
    [userId, kind, role.id, mobile, body.email || null, body.username?.toLowerCase() ?? null,
      await hashPassword(body.password), body.fullName, ts, ts],
  );
  await run(
    `INSERT INTO staff_profiles (user_id, employee_code, position, specialties, max_active_cases, accepts_new_cases, hired_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [userId, body.employeeCode ?? null, body.position ?? null, jsonStringify(body.specialties ?? []),
      body.maxActiveCases ?? (await getNumber('services.max_active_cases_per_staff')), ts.slice(0, 10), ts, ts],
  );
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'staff.create',
    entityType: 'user', entityId: userId, after: { fullName: body.fullName, roleCode: role.code }, ip: req.ip,
  });
  const row = await one<any>(`${STAFF_SELECT} WHERE u.id = ?`, [userId]);
  created(res, mapStaff(row));
}));

staffRouter.patch('/:id', requirePermission('staff.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    fullName: z.string().min(3).max(120).optional(),
    email: z.string().email().optional().or(z.literal('')),
    roleCode: z.string().optional(),
    status: z.enum(['active', 'suspended']).optional(),
    employeeCode: z.string().max(40).optional(),
    position: z.string().max(120).optional(),
    specialties: z.array(z.string()).optional(),
    maxActiveCases: z.number().int().min(1).max(500).optional(),
    acceptsNewCases: z.boolean().optional(),
    mfaRequired: z.boolean().optional(),
    newPassword: z.string().min(8).max(200).optional(),
  }).parse(req.body);

  const user = await one<any>(`SELECT * FROM users WHERE id = ? AND kind IN ('staff','admin')`, [param(req, 'id')]);
  if (!user) throw notFound('کارمند یافت نشد.');
  const targetRole = await one<any>('SELECT code FROM roles WHERE id = ?', [user.role_id]);
  if ((targetRole?.code === 'super_admin' || user.kind === 'admin') && req.auth!.user.roleCode !== 'super_admin') throw forbidden('تغییر حساب مدیریتی فقط توسط مدیر کل مجاز است.');
  if (targetRole?.code === 'super_admin' && (body.status === 'suspended' || (body.roleCode && body.roleCode !== 'super_admin'))) {
    const others = await one<any>("SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='super_admin' AND u.status='active' AND u.id<>?", [user.id]);
    if (!Number(others?.c)) throw badRequest('آخرین مدیر کل فعال قابل غیرفعال‌سازی یا تنزل نیست.');
  }
  if (user.id === req.auth!.user.id && body.status === 'suspended') throw badRequest('نمی‌توانید حساب خودتان را غیرفعال کنید.');

  let roleId = user.role_id;
  if (body.roleCode) {
    if (!hasPermission(req.auth!.permissions, 'roles.edit') && !hasPermission(req.auth!.permissions, 'staff.edit')) throw forbidden();
    const role = await one<{ id: string; code: string }>('SELECT id, code FROM roles WHERE code = ?', [body.roleCode]);
    if (!role) throw badRequest('نقش انتخابی وجود ندارد.');
    if (role.code === 'super_admin' && !hasPermission(req.auth!.permissions, 'roles.edit')) throw forbidden();
    roleId = role.id;
  }

  if (body.newPassword) await validatePasswordAgainstPolicy(body.newPassword);

  await run(
    `UPDATE users SET full_name = ?, email = ?, role_id = ?, status = ?, password_hash = ?, mfa_enabled = ?, updated_at = ? WHERE id = ?`,
    [
      body.fullName ?? user.full_name,
      body.email !== undefined ? (body.email || null) : user.email,
      roleId,
      body.status ?? user.status,
      body.newPassword ? await hashPassword(body.newPassword) : user.password_hash,
      body.mfaRequired !== undefined ? (body.mfaRequired ? 1 : 0) : user.mfa_enabled,
      nowIso(), user.id,
    ],
  );

  const profile = await one<any>('SELECT * FROM staff_profiles WHERE user_id = ?', [user.id]);
  if (profile) {
    await run(
      `UPDATE staff_profiles SET employee_code = ?, position = ?, specialties = ?, max_active_cases = ?, accepts_new_cases = ?, updated_at = ? WHERE user_id = ?`,
      [
        body.employeeCode ?? profile.employee_code,
        body.position ?? profile.position,
        jsonStringify(body.specialties ?? jsonParse(profile.specialties, [])),
        body.maxActiveCases ?? profile.max_active_cases,
        body.acceptsNewCases !== undefined ? (body.acceptsNewCases ? 1 : 0) : profile.accepts_new_cases,
        nowIso(), user.id,
      ],
    );
  }

  if (body.newPassword || body.status === 'suspended') await revokeAllSessions(user.id);

  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'staff.update',
    entityType: 'user', entityId: user.id, after: { status: body.status, roleCode: body.roleCode }, ip: req.ip,
  });
  const row = await one<any>(`${STAFF_SELECT} WHERE u.id = ?`, [user.id]);
  ok(res, mapStaff(row));
}));

staffRouter.post('/:id/toggle-availability', asyncRoute(async (req, res) => {
  if (req.auth!.user.id !== param(req, 'id') && !hasPermission(req.auth!.permissions, 'staff.edit')) throw forbidden();
  const profile = await one<any>('SELECT * FROM staff_profiles WHERE user_id = ?', [param(req, 'id')]);
  if (!profile) throw notFound('پروفایل کارمند یافت نشد.');
  const next = profile.accepts_new_cases ? 0 : 1;
  await run('UPDATE staff_profiles SET accepts_new_cases = ?, updated_at = ? WHERE user_id = ?', [next, nowIso(), param(req, 'id')]);
  ok(res, { acceptsNewCases: Boolean(next) });
}));

staffRouter.get('/:id/performance', requireAuth, asyncRoute(async (req, res) => {
  if (req.auth!.user.kind === 'customer') throw forbidden();
  if (req.auth!.user.id !== param(req, 'id') && !hasPermission(req.auth!.permissions, 'reports.view')) throw forbidden();
  const userId = param(req, 'id');
  const from = typeof req.query.from === 'string' ? req.query.from : new Date(Date.now() - 30 * 86_400_000).toISOString();

  const byStatus = await q<any>(
    `SELECT status, COUNT(*) AS c FROM requests WHERE assigned_to = ? AND created_at >= ? GROUP BY status`, [userId, from],
  );
  const completed = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM requests WHERE assigned_to = ? AND status = 'completed' AND completed_at >= ?`, [userId, from],
  );
  // Average completion time is computed in JS so the query stays portable.
  const completedRows = await q<{ created_at: string; completed_at: string }>(
    `SELECT created_at, completed_at FROM requests
     WHERE assigned_to = ? AND completed_at IS NOT NULL AND completed_at >= ? LIMIT 500`,
    [userId, from],
  );
  const durations = completedRows
    .map((r) => (new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  const avgHours = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const attendance = await q<any>(
    `SELECT status, COUNT(*) AS c FROM attendance WHERE user_id = ? AND check_in >= ? GROUP BY status`, [userId, from],
  );
  const revenue = await one<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p JOIN requests r ON r.id = p.request_id
     WHERE p.status = 'confirmed' AND r.assigned_to = ? AND p.created_at >= ?`, [userId, from],
  );

  ok(res, {
    range: { from },
    byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.c) })),
    completed: Number(completed?.c ?? 0),
    averageCompletionHours: avgHours !== null ? Math.round(avgHours * 10) / 10 : null,
    attendance: attendance.map((r) => ({ status: r.status, count: Number(r.c) })),
    revenue: Number((await one<any>("SELECT COALESCE(SUM(amount),0) AS total FROM compensation_entries WHERE user_id=? AND kind<>'settlement'",[req.auth!.user.id]))?.total ?? 0),
  });
}));

/* --------------------------------- roles ---------------------------------- */

staffRouter.get('/meta/roles', asyncRoute(async (_req, res) => {
  const rows = await q<any>('SELECT * FROM roles ORDER BY is_system DESC, name ASC');
  ok(res, rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: Boolean(r.is_system),
    permissions: jsonParse(r.permissions, []),
  })));
}));

staffRouter.get('/meta/permissions', asyncRoute(async (req, res) => {
  if (!hasPermission(req.auth!.permissions, 'staff.view')) throw forbidden();
  ok(res, {
    resources: RESOURCES.map((r) => ({ code: r, label: RESOURCE_LABELS[r] })),
    actions: ACTIONS.map((a) => ({ code: a, label: PERMISSION_LABELS[a] })),
    all: allPermissions(),
  });
}));

staffRouter.post('/meta/roles', requirePermission('roles.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    code: z.string().min(2).max(40).regex(/^[a-z][a-z0-9_]*$/),
    name: z.string().min(2).max(80),
    description: z.string().max(300).optional(),
    permissions: z.array(z.string()).default([]),
  }).parse(req.body);
  if (await one('SELECT id FROM roles WHERE code = ?', [body.code])) throw conflict('این شناسه نقش قبلاً استفاده شده است.');
  const roleId = id('role');
  const ts = nowIso();
  await run(
    'INSERT INTO roles (id, code, name, description, is_system, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
    [roleId, body.code, body.name, body.description ?? null, jsonStringify(expandPermissions(body.permissions)), ts, ts],
  );
  await writeAudit({ actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'role.create', entityType: 'role', entityId: roleId, after: body, ip: req.ip });
  created(res, { id: roleId });
}));

staffRouter.patch('/meta/roles/:id', requirePermission('roles.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).max(80).optional(),
    description: z.string().max(300).optional(),
    permissions: z.array(z.string()).optional(),
  }).parse(req.body);

  const role = await one<any>('SELECT * FROM roles WHERE id = ?', [param(req, 'id')]);
  if (!role) throw notFound('نقش یافت نشد.');
  if (role.code === 'super_admin') throw forbidden('مجوزهای مدیر کل قابل تغییر نیست.');

  const permissions = body.permissions ? expandPermissions(body.permissions) : jsonParse(role.permissions, []);
  await run(
    'UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?',
    [body.name ?? role.name, body.description ?? role.description, jsonStringify(permissions), nowIso(), role.id],
  );
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'role.update',
    entityType: 'role', entityId: role.id, before: { permissions: jsonParse(role.permissions, []) }, after: { permissions }, ip: req.ip,
  });
  ok(res, { id: role.id, permissions });
}));

staffRouter.delete('/meta/roles/:id', requirePermission('roles.delete'), asyncRoute(async (req, res) => {
  const role = await one<any>('SELECT * FROM roles WHERE id = ?', [param(req, 'id')]);
  if (!role) throw notFound('نقش یافت نشد.');
  if (role.is_system) throw forbidden('نقش‌های سیستمی حذف نمی‌شوند.');
  const users = await one<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE role_id = ?', [role.id]);
  if (Number(users?.c ?? 0) > 0) throw conflict('این نقش به کاربر اختصاص یافته است.');
  await run('DELETE FROM roles WHERE id = ?', [role.id]);
  await writeAudit({ actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'role.delete', entityType: 'role', entityId: role.id, ip: req.ip });
  ok(res, { message: 'نقش حذف شد.' });
}));

/* --------------------------- service assignment --------------------------- */

staffRouter.get('/meta/service-assignments/:serviceId', requirePermission('services.edit'), asyncRoute(async (req, res) => {
  const rows = await q<any>(
    `SELECT ss.user_id, ss.priority, u.full_name FROM service_staff ss JOIN users u ON u.id = ss.user_id WHERE ss.service_id = ?`,
    [param(req, 'serviceId')],
  );
  const rule = await one<any>('SELECT * FROM assignment_rules WHERE service_id = ?', [param(req, 'serviceId')]);
  ok(res, {
    staff: rows.map((r) => ({ userId: r.user_id, fullName: r.full_name, priority: Number(r.priority) })),
    rule: rule ? {
      strategy: rule.strategy, maxLoad: Number(rule.max_load), fallback: rule.fallback,
      isActive: Boolean(rule.is_active), staffIds: jsonParse(rule.staff_ids, []),
    } : null,
  });
}));

staffRouter.put('/meta/service-assignments/:serviceId', requirePermission('services.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    staffIds: z.array(z.string()).default([]),
    strategy: z.enum(['round_robin', 'least_loaded', 'fixed', 'queue']).optional(),
    maxLoad: z.number().int().min(0).max(500).optional(),
  }).parse(req.body);

  const service = await one('SELECT id FROM services WHERE id = ?', [param(req, 'serviceId')]);
  if (!service) throw notFound('خدمت یافت نشد.');

  await run('DELETE FROM service_staff WHERE service_id = ?', [param(req, 'serviceId')]);
  for (const [index, staffId] of body.staffIds.entries()) {
    await run('INSERT INTO service_staff (service_id, user_id, priority) VALUES (?, ?, ?)', [param(req, 'serviceId'), staffId, index]);
  }

  const existing = await one<any>('SELECT * FROM assignment_rules WHERE service_id = ?', [param(req, 'serviceId')]);
  const strategy = body.strategy ?? existing?.strategy ?? 'least_loaded';
  const maxLoad = body.maxLoad ?? Number(existing?.max_load ?? 0);
  if (existing) {
    await run('UPDATE assignment_rules SET staff_ids = ?, strategy = ?, max_load = ?, updated_at = ? WHERE id = ?',
      [jsonStringify(body.staffIds), strategy, maxLoad, nowIso(), existing.id]);
  } else {
    await run(
      `INSERT INTO assignment_rules (id, service_id, strategy, staff_ids, max_load, fallback, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queue', 1, ?, ?)`,
      [id('rule'), param(req, 'serviceId'), strategy, jsonStringify(body.staffIds), maxLoad, nowIso(), nowIso()],
    );
  }
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'service.assignment_update',
    entityType: 'service', entityId: param(req, 'serviceId'), after: { ...body, strategy }, ip: req.ip,
  });
  ok(res, { message: 'قواعد ارجاع ذخیره شد.', strategy, maxLoad });
}));

/** Settings the staff panel needs to render policy hints. */
staffRouter.get('/meta/policies', asyncRoute(async (_req, res) => {
  ok(res, {
    attendanceRequired: await getBool('workforce.attendance_required'),
    allowSelfCheckin: await getBool('workforce.allow_self_checkin'),
    shiftSwapRequiresApproval: await getBool('workforce.shift_swap_requires_approval'),
    lateGraceMinutes: await getNumber('workforce.late_grace_minutes'),
    maxWeeklyHours: await getNumber('workforce.max_weekly_hours'),
    requireDocumentApproval: await getBool('services.require_document_approval'),
    officeName: await getString('office.name'),
  });
}));
