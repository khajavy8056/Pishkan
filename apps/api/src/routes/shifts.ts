import { tehranNow } from '../lib/tehran-time.js';
import { officeScope } from '../lib/scope.js';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { one, q, run, nowIso, jsonParse, jsonStringify } from '../db/index.js';
import { id } from '../lib/crypto.js';
import { writeAudit } from '../modules/audit/service.js';
import { getBool, getNumber } from '../modules/settings/service.js';
import { notifyUser } from '../modules/notifications/service.js';
import { param } from '../http/params.js';

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mapShift(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    date: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    note: row.note,
    templateId: row.template_id,
    templateTitle: row.template_title,
  };
}

/* ------------------------------- templates -------------------------------- */

shiftsRouter.get('/templates', requirePermission('shifts.view'), asyncRoute(async (_req, res) => {
  const rows = await q<any>('SELECT * FROM shift_templates ORDER BY start_time ASC');
  ok(res, rows.map((r) => ({
    id: r.id, title: r.title, startTime: r.start_time, endTime: r.end_time,
    weekdays: jsonParse<number[]>(r.weekdays, []), capacity: Number(r.capacity),
    color: r.color, isActive: Boolean(r.is_active),
  })));
}));

shiftsRouter.post('/templates', requirePermission('shifts.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    title: z.string().min(2).max(60),
    startTime: z.string().regex(TIME_RE),
    endTime: z.string().regex(TIME_RE),
    weekdays: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
    capacity: z.number().int().min(1).max(200).optional(),
    color: z.string().max(20).optional(),
  }).parse(req.body);
  const templateId = id('shftpl');
  const ts = nowIso();
  await run(
    `INSERT INTO shift_templates (id, title, start_time, end_time, weekdays, capacity, color, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [templateId, body.title, body.startTime, body.endTime, jsonStringify(body.weekdays),
      body.capacity ?? (await getNumber('workforce.default_shift_capacity')), body.color ?? '#1d4ed8', ts, ts],
  );
  created(res, { id: templateId });
}));

shiftsRouter.delete('/templates/:id', requirePermission('shifts.delete'), asyncRoute(async (req, res) => {
  await run('DELETE FROM shift_templates WHERE id = ?', [param(req, 'id')]);
  ok(res, { message: 'الگوی شیفت حذف شد.' });
}));

/* --------------------------------- shifts --------------------------------- */

shiftsRouter.get('/', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const where: string[] = [];
  const args: any[] = [];
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (from) { where.push('s.shift_date >= ?'); args.push(from); }
  if (to) { where.push('s.shift_date <= ?'); args.push(to); }

  if (officeScope(auth) && hasAnyShiftPermission(auth.permissions)) {
    if (typeof req.query.userId === 'string') { where.push('s.user_id = ?'); args.push(req.query.userId); }
    if (req.query.mine === 'true') { where.push('s.user_id = ?'); args.push(auth.user.id); }
  } else {
    where.push('s.user_id = ?');
    args.push(auth.user.id);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await q<any>(
    `SELECT s.*, u.full_name AS user_name, t.title AS template_title
     FROM shifts s JOIN users u ON u.id = s.user_id LEFT JOIN shift_templates t ON t.id = s.template_id
     ${clause} ORDER BY s.shift_date ASC, s.start_time ASC LIMIT 500`, args,
  );
  ok(res, rows.map(mapShift));
}));

function hasAnyShiftPermission(permissions: string[] | '*'): boolean {
  if (permissions === '*') return true;
  return permissions.some((p) => p.startsWith('shifts.'));
}

shiftsRouter.post('/', requirePermission('shifts.create'), asyncRoute(async (req, res) => {
  const body = z.object({
    userId: z.string().min(3),
    date: z.string().regex(DATE_RE),
    startTime: z.string().regex(TIME_RE),
    endTime: z.string().regex(TIME_RE),
    templateId: z.string().optional(),
    note: z.string().max(500).optional(),
    repeat: z.object({
      until: z.string().regex(DATE_RE),
      weekdays: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
    }).optional(),
  }).parse(req.body);

  const staff = await one<any>('SELECT id, full_name FROM users WHERE id = ? AND kind IN (?, ?)', [body.userId, 'staff', 'admin']);
  if (!staff) throw badRequest('کارمند انتخابی معتبر نیست.');

  const ts = nowIso();
  const createdIds: string[] = [];
  const createOne = async (date: string) => {
    const duplicate = await one(
      'SELECT id FROM shifts WHERE user_id = ? AND shift_date = ? AND start_time = ?', [body.userId, date, body.startTime],
    );
    if (duplicate) return;
    const shiftId = id('shf');
    await run(
      `INSERT INTO shifts (id, template_id, user_id, shift_date, start_time, end_time, status, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
      [shiftId, body.templateId ?? null, body.userId, date, body.startTime, body.endTime, body.note ?? null, req.auth!.user.id, ts, ts],
    );
    createdIds.push(shiftId);
  };

  if (body.repeat) {
    const start = new Date(`${body.date}T00:00:00Z`);
    const end = new Date(`${body.repeat.until}T00:00:00Z`);
    if (end < start) throw badRequest('تاریخ پایان تکرار نامعتبر است.');
    if ((end.getTime() - start.getTime()) / 86_400_000 > 120) throw badRequest('بازه تکرار حداکثر ۱۲۰ روز است.');
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      // JS getUTCDay: 0=Sunday; Persian week starts Saturday (6)
      const persianWeekday = (d.getUTCDay() + 1) % 7;
      if (!body.repeat.weekdays.includes(persianWeekday)) continue;
      await createOne(d.toISOString().slice(0, 10));
    }
  } else {
    await createOne(body.date);
  }

  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'shift.create',
    entityType: 'shift', entityId: createdIds.join(','), after: { userId: body.userId, count: createdIds.length }, ip: req.ip,
  });
  await notifyUser(body.userId, {
    title: 'شیفت جدید ثبت شد',
    body: `${body.date} از ${body.startTime} تا ${body.endTime}`,
    kind: 'info',
    link: '/staff/shifts',
  }).catch(() => undefined);
  created(res, { ids: createdIds, count: createdIds.length });
}));

shiftsRouter.patch('/:id', requirePermission('shifts.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    status: z.enum(['scheduled', 'completed', 'absent', 'leave']).optional(),
    startTime: z.string().regex(TIME_RE).optional(),
    endTime: z.string().regex(TIME_RE).optional(),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  const shift = await one<any>('SELECT * FROM shifts WHERE id = ?', [param(req, 'id')]);
  if (!shift) throw notFound('شیفت یافت نشد.');
  await run(
    'UPDATE shifts SET status = ?, start_time = ?, end_time = ?, note = ?, updated_at = ? WHERE id = ?',
    [body.status ?? shift.status, body.startTime ?? shift.start_time, body.endTime ?? shift.end_time, body.note ?? shift.note, nowIso(), shift.id],
  );
  ok(res, { message: 'شیفت به‌روزرسانی شد.' });
}));

shiftsRouter.delete('/:id', requirePermission('shifts.delete'), asyncRoute(async (req, res) => {
  await run('DELETE FROM shifts WHERE id = ?', [param(req, 'id')]);
  ok(res, { message: 'شیفت حذف شد.' });
}));

/** Weekly calendar view grouped by day. */
shiftsRouter.get('/calendar', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const weekStart = typeof req.query.start === 'string' && DATE_RE.test(req.query.start)
    ? req.query.start
    : new Date(new Date().setUTCDate(new Date().getUTCDate() - new Date().getUTCDay())).toISOString().slice(0, 10);
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const where = ['s.shift_date >= ?', 's.shift_date <= ?'];
  const args: any[] = [weekStart, end.toISOString().slice(0, 10)];
  if (!officeScope(auth) || !hasAnyShiftPermission(auth.permissions)) { where.push('s.user_id = ?'); args.push(auth.user.id); }

  const rows = await q<any>(
    `SELECT s.*, u.full_name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id
     WHERE ${where.join(' AND ')} ORDER BY s.shift_date, s.start_time`, args,
  );
  const days: Record<string, any[]> = {};
  for (let i = 0; i < 7; i += 1) {
    days[new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10)] = [];
  }
  for (const row of rows) {
    if (days[row.shift_date]) days[row.shift_date].push(mapShift(row));
  }
  ok(res, { weekStart, weekEnd: end.toISOString().slice(0, 10), days });
}));

/* ------------------------------- attendance ------------------------------- */

shiftsRouter.get('/attendance/list', requirePermission('attendance.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pagination(req, { pageSize: 50 });
  const where: string[] = [];
  const args: any[] = [];
  if(!officeScope(req.auth!)){where.push('a.user_id=?');args.push(req.auth!.user.id)}
  else if (typeof req.query.userId === 'string') { where.push('a.user_id = ?'); args.push(req.query.userId); }
  if (typeof req.query.from === 'string') { where.push('a.check_in >= ?'); args.push(req.query.from); }
  if (typeof req.query.to === 'string') { where.push('a.check_in <= ?'); args.push(`${req.query.to}T23:59:59.999Z`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM attendance a ${clause}`, args);
  const rows = await q<any>(
    `SELECT a.*, u.full_name AS user_name FROM attendance a JOIN users u ON u.id = a.user_id
     ${clause} ORDER BY a.check_in DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize],
  );
  ok(res, rows.map((r) => ({
    id: r.id, userId: r.user_id, userName: r.user_name, checkIn: r.check_in, checkOut: r.check_out,
    status: r.status, minutesLate: Number(r.minutes_late), note: r.note,
  })), { total: Number(total?.c ?? 0), page, pageSize });
}));

shiftsRouter.post('/attendance/check-in', asyncRoute(async (req, res) => {
  if (!(await getBool('workforce.allow_self_checkin')) && !hasAnyShiftPermission(req.auth!.permissions)) {
    throw forbidden('ثبت ورود توسط کارمند غیرفعال است.');
  }
  const userId = req.auth!.user.kind === 'customer' ? null : req.auth!.user.id;
  if (!userId) throw forbidden();
  const today = tehranNow().date;
  const open = await one<any>('SELECT * FROM attendance WHERE user_id = ? AND check_out IS NULL', [userId]);
  if (open) throw conflict('ورود امروز قبلاً ثبت شده است.');

  const shift = await one<any>('SELECT * FROM shifts WHERE user_id = ? AND shift_date = ? ORDER BY start_time ASC LIMIT 1', [userId, today]);
  const now = new Date();
  let minutesLate = 0;
  let status = 'present';
  if (shift) {
    const [h, m] = String(shift.start_time).split(':').map(Number);
    const expected = new Date(`${today}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+03:30`);
    minutesLate = Math.max(0, Math.round((now.getTime() - expected.getTime()) / 60000));
    const grace = await getNumber('workforce.late_grace_minutes');
    if (minutesLate > grace) status = 'late';
  }

  const attendanceId = id('att');
  await run(
    `INSERT INTO attendance (id, user_id, shift_id, check_in, status, minutes_late, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [attendanceId, userId, shift?.id ?? null, now.toISOString(), status, minutesLate, nowIso()],
  );
  ok(res, { id: attendanceId, checkIn: now.toISOString(), status, minutesLate });
}));

shiftsRouter.post('/attendance/check-out', asyncRoute(async (req, res) => {
  const userId = req.auth!.user.id;
  const open = await one<any>('SELECT * FROM attendance WHERE user_id = ? AND check_out IS NULL ORDER BY check_in DESC LIMIT 1', [userId]);
  if (!open) throw badRequest('ورود بازی برای ثبت خروج وجود ندارد.');
  await run('UPDATE attendance SET check_out = ? WHERE id = ?', [nowIso(), open.id]);
  const minutes = Math.round((Date.now() - new Date(open.check_in).getTime()) / 60000);
  ok(res, { checkOut: nowIso(), workedMinutes: minutes });
}));

/* --------------------------- shift change requests ------------------------ */

shiftsRouter.get('/change-requests', asyncRoute(async (req, res) => {
  const canManage = officeScope(req.auth!) && hasAnyShiftPermission(req.auth!.permissions);
  const rows = await q<any>(
    `SELECT c.*, u.full_name AS user_name, s.shift_date, s.start_time, s.end_time
     FROM shift_change_requests c JOIN users u ON u.id = c.user_id LEFT JOIN shifts s ON s.id = c.shift_id
     ${canManage ? '' : 'WHERE c.user_id = ?'} ORDER BY c.created_at DESC LIMIT 200`,
    canManage ? [] : [req.auth!.user.id],
  );
  ok(res, rows.map((r) => ({
    id: r.id, userId: r.user_id, userName: r.user_name, kind: r.kind, requestedDate: r.requested_date,
    reason: r.reason, status: r.status, decisionNote: r.decision_note, createdAt: r.created_at,
    shift: r.shift_date ? { date: r.shift_date, startTime: r.start_time, endTime: r.end_time } : null,
  })));
}));

shiftsRouter.post('/change-requests', asyncRoute(async (req, res) => {
  const body = z.object({
    kind: z.enum(['swap', 'leave', 'add']).default('leave'),
    shiftId: z.string().optional(),
    requestedDate: z.string().regex(DATE_RE).optional(),
    reason: z.string().min(3).max(1000),
  }).parse(req.body);
  const id_ = id('shcr');
  await run(
    `INSERT INTO shift_change_requests (id, user_id, shift_id, kind, requested_date, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id_, req.auth!.user.id, body.shiftId ?? null, body.kind, body.requestedDate ?? null, body.reason, nowIso()],
  );
  await writeAudit({ actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'shift.request', entityType: 'shift_request', entityId: id_, after: body, ip: req.ip });
  created(res, { id: id_ });
}));

shiftsRouter.patch('/change-requests/:id', requirePermission('shifts.approve'), asyncRoute(async (req, res) => {
  const body = z.object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  const request = await one<any>('SELECT * FROM shift_change_requests WHERE id = ?', [param(req, 'id')]);
  if (!request) throw notFound('درخواست یافت نشد.');
  if (request.status !== 'pending') throw conflict('این درخواست قبلاً بررسی شده است.');

  await run(
    'UPDATE shift_change_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?',
    [body.decision, req.auth!.user.id, nowIso(), body.note ?? null, request.id],
  );

  if (body.decision === 'approved') {
    if (request.kind === 'leave' && request.shift_id) {
      await run(`UPDATE shifts SET status = 'leave', updated_at = ? WHERE id = ?`, [nowIso(), request.shift_id]);
    } else if (request.kind === 'swap' && request.shift_id && request.requested_date) {
      await run('UPDATE shifts SET shift_date = ?, updated_at = ? WHERE id = ?', [request.requested_date, nowIso(), request.shift_id]);
    }
  }

  await notifyUser(request.user_id, {
    title: body.decision === 'approved' ? 'درخواست شیفت تأیید شد' : 'درخواست شیفت رد شد',
    body: body.note ?? '',
    kind: body.decision === 'approved' ? 'success' : 'warning',
    link: '/staff/shifts',
  }).catch(() => undefined);

  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: `shift.${body.decision}`,
    entityType: 'shift_request', entityId: request.id, ip: req.ip,
  });
  ok(res, { message: 'درخواست بررسی شد.' });
}));

/** Attendance / working-hours report. */
shiftsRouter.get('/reports/attendance', requirePermission('attendance.view'), asyncRoute(async (req, res) => {
  if(!officeScope(req.auth!))throw forbidden('گزارش حضور دیگران فقط برای مدیریت مجاز است.');
  const from = typeof req.query.from === 'string' ? req.query.from : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString().slice(0, 10);
  const rows = await q<any>(
    `SELECT u.id, u.full_name, a.check_in, a.check_out, a.status, a.minutes_late
     FROM attendance a JOIN users u ON u.id = a.user_id
     WHERE a.check_in >= ? AND a.check_in <= ? ORDER BY a.check_in ASC`,
    [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`],
  );
  const byUser: Record<string, any> = {};
  for (const row of rows) {
    byUser[row.id] ??= { userId: row.id, fullName: row.full_name, days: 0, minutesWorked: 0, lateCount: 0, absentCount: 0 };
    const entry = byUser[row.id];
    entry.days += 1;
    if (row.check_out) entry.minutesWorked += Math.max(0, Math.round((new Date(row.check_out).getTime() - new Date(row.check_in).getTime()) / 60000));
    if (row.status === 'late') entry.lateCount += 1;
    if (row.status === 'absent') entry.absentCount += 1;
  }
  const shutdown = await q<any>(
    `SELECT user_id, COUNT(*) AS c FROM shifts WHERE shift_date >= ? AND shift_date <= ? AND status = 'absent' GROUP BY user_id`,
    [from, to],
  );
  for (const row of shutdown) {
    if (byUser[row.user_id]) byUser[row.user_id].absentCount += Number(row.c);
  }
  ok(res, { from, to, staff: Object.values(byUser) });
}));
