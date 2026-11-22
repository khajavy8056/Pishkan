import { officeScope } from '../lib/scope.js';
import { Router } from 'express';
import { asyncRoute, requireAuth } from '../http/middleware.js';
import { forbidden } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { one, q, nowIso } from '../db/index.js';
import { hasPermission } from '../lib/permissions.js';
import { financeSummary } from '../modules/accounting/service.js';
import { requestStats, STATUS_LABELS } from '../modules/requests/service.js';
import { listNotifications } from '../modules/notifications/service.js';
import { listServices } from '../modules/catalog/service.js';
import { getBool } from '../modules/settings/service.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/** Role-aware dashboard payload: one endpoint, three experiences. */
dashboardRouter.get('/summary', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  if (auth.user.kind !== 'customer' && !hasPermission(auth.permissions, 'dashboard.view')) throw forbidden();
  const kind = auth.user.kind === 'customer' ? 'customer'
    : officeScope(auth) ? 'admin' : 'staff';

  if (kind === 'customer') {
    const [stats, recent, invoices, notifications, popular] = await Promise.all([
      requestStats({ customerId: auth.user.id }),
      q<any>(
        `SELECT r.id, r.tracking_code, r.status, r.created_at, s.title AS service_title,
                s.icon AS service_icon, s.slug AS service_slug,
                sc.icon AS category_icon, sc.color AS category_color
         FROM requests r JOIN services s ON s.id = r.service_id
         LEFT JOIN service_categories sc ON sc.id = s.category_id
         WHERE r.customer_id = ? ORDER BY r.created_at DESC LIMIT 5`, [auth.user.id],
      ),
      q<any>(
        `SELECT id, number, title, total, paid_amount, status FROM invoices
         WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5`, [auth.user.id],
      ),
      listNotifications(auth.user.id, { limit: 5 }),
      listServices({ onlyPublic: true, pageSize: 6, customerId: auth.user.id }),
    ]);

    return ok(res, {
      kind,
      stats,
      recentRequests: recent.map((r) => ({
        id: r.id, trackingCode: r.tracking_code, status: r.status,
        statusLabel: STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status,
        serviceTitle: r.service_title, createdAt: r.created_at,
        serviceIcon: r.service_icon ?? null, serviceSlug: r.service_slug ?? null,
        categoryIcon: r.category_icon ?? null, categoryColor: r.category_color ?? null,
      })),
      invoices: invoices.map((i) => ({
        id: i.id, number: i.number, title: i.title, total: Number(i.total),
        paidAmount: Number(i.paid_amount), status: i.status,
      })),
      notifications: notifications.items,
      unreadNotifications: notifications.unread,
      popularServices: popular.items.slice(0, 6),
      maintenance: await getBool('maintenance.mode'),
    });
  }

  if(kind==='staff') {
    const recent=await q<any>(
      `SELECT r.id, r.tracking_code, r.status, r.created_at, s.title AS service_title,
              cu.full_name AS customer_name, sc.icon AS category_icon, sc.color AS category_color
       FROM requests r JOIN services s ON s.id=r.service_id
       LEFT JOIN service_categories sc ON sc.id=s.category_id
       LEFT JOIN users cu ON cu.id=r.customer_id
       WHERE r.assigned_to=? ORDER BY r.created_at DESC LIMIT 10`,[auth.user.id]);
    const notes = await listNotifications(auth.user.id, { limit: 8 });
    return ok(res,{kind,stats:await requestStats({assignedTo:auth.user.id}),
      recentRequests: recent.map((r) => ({
        id: r.id, trackingCode: r.tracking_code, status: r.status,
        statusLabel: STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status,
        serviceTitle: r.service_title, customerName: r.customer_name,
        categoryIcon: r.category_icon ?? null, categoryColor: r.category_color ?? null,
        createdAt: r.created_at,
      })),
      notifications: notes.items, unreadNotifications: notes.unread,
      daily:[],byStatus:[],unassigned:0,pendingDocs:0,unreadThreads:0,finance:null});
  }
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const stats = await requestStats({});
  const finance = kind === 'admin' ? await financeSummary({}) : null;

  const daily = await q<{ day: string; c: number }>(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM requests WHERE created_at >= ? GROUP BY substr(created_at, 1, 10) ORDER BY day ASC`,
    [since],
  );
  const byStatus = await q<{ status: string; c: number }>(
    `SELECT status, COUNT(*) AS c FROM requests GROUP BY status`,
  );
  const unassigned = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM requests WHERE assigned_to IS NULL AND status NOT IN ('completed','cancelled','rejected')`,
  );
  const pendingDocs = await one<{ c: number }>(`SELECT
    (SELECT COUNT(*) FROM request_documents WHERE status='pending') +
    (SELECT COUNT(*) FROM customer_documents WHERE status='pending') AS c`);
  const unreadThreads = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM messages WHERE read_at IS NULL AND sender_role = 'customer'`,
  );

  const recentRequests = await q<any>(
    `SELECT r.id, r.tracking_code, r.status, r.priority, r.created_at, r.due_at, r.estimated_completion_at,
            s.title AS service_title, c.full_name AS customer_name, a.full_name AS assignee_name
     FROM requests r JOIN services s ON s.id = r.service_id JOIN users c ON c.id = r.customer_id
     LEFT JOIN users a ON a.id = r.assigned_to

     ORDER BY r.created_at DESC LIMIT 8`,
    [],
  );

  const urgent = await q<any>(
    `SELECT r.id, r.tracking_code, r.status, r.due_at, s.title AS service_title, c.full_name AS customer_name
     FROM requests r JOIN services s ON s.id = r.service_id JOIN users c ON c.id = r.customer_id
     WHERE r.status NOT IN ('completed','cancelled','rejected') AND r.due_at IS NOT NULL AND r.due_at < ?

     ORDER BY r.due_at ASC LIMIT 6`,
    [nowIso()],
  );

  const staffLoad = kind === 'admin'
    ? await q<any>(
      `SELECT u.id, u.full_name,
              (SELECT COUNT(*) FROM requests r WHERE r.assigned_to = u.id AND r.status NOT IN ('completed','cancelled','rejected')) AS active
       FROM users u JOIN staff_profiles sp ON sp.user_id = u.id WHERE u.status = 'active' ORDER BY active DESC LIMIT 8`,
    )
    : [];

  const attendanceToday = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM attendance WHERE check_in >= ?`, [`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`],
  );

  // Live workforce alerts for the manager widget: cases nobody owns yet,
  // cases whose automatic-assignment moment has already passed, cases stuck
  // waiting on customer/organization, and staff seen in the last 10 minutes.
  const workforceAlerts = kind === 'admin' ? {
    unassigned: Number(unassigned?.c ?? 0),
    overdueUnassigned: Number((await one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM requests
       WHERE assigned_to IS NULL AND status IN ('new','under_review')
         AND COALESCE(force_assign_at, estimated_completion_at) IS NOT NULL
         AND COALESCE(force_assign_at, estimated_completion_at) <= ?`,
      [nowIso()],
    ))?.c ?? 0),
    waitingCases: Number((await one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM requests
       WHERE status NOT IN ('completed','cancelled','rejected')
         AND work_bucket IN ('waiting_customer','waiting_organization','followup')`,
    ))?.c ?? 0),
    onlineStaff: Number((await one<{ c: number }>(
      'SELECT COUNT(*) AS c FROM users WHERE kind <> ? AND status = ? AND last_seen_at >= ?',
      ['customer', 'active', new Date(Date.now() - 10 * 60_000).toISOString()],
    ))?.c ?? 0),
  } : null;

  // Panel extras for the super-admin home: system totals with honest
  // 30-day deltas, Staff status, the management approval inbox, the latest
  // audit activity and a minimal system-health probe — all live SQL.
  const DAY_MS = 86_400_000;
  const nowMs = Date.now();
  const t30 = new Date(nowMs - 30 * DAY_MS).toISOString();
  const t60 = new Date(nowMs - 60 * DAY_MS).toISOString();
  const countBetween = async (table: string, from: string, to?: string) => Number((await one<{ c: number }>(
    to ? `SELECT COUNT(*) AS c FROM ${table} WHERE created_at >= ? AND created_at < ?` : `SELECT COUNT(*) AS c FROM ${table} WHERE created_at >= ?`,
    to ? [from, to] : [from],
  ))?.c ?? 0);
  const revenueBetween = async (from: string, to?: string) => Number((await one<{ t: number }>(
    to
      ? "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE status='confirmed' AND created_at >= ? AND created_at < ?"
      : "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE status='confirmed' AND created_at >= ?",
    to ? [from, to] : [from],
  ))?.t ?? 0);
  const pctDelta = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur > 0 ? 100 : 0);
  const [revCur, revPrev, usrCur, usrPrev, reqCur, reqPrev, tixCur, tixPrev] = await Promise.all([
    revenueBetween(t30), revenueBetween(t60, t30),
    countBetween('users', t30), countBetween('users', t60, t30),
    countBetween('requests', t30), countBetween('requests', t60, t30),
    countBetween('support_tickets', t30), countBetween('support_tickets', t60, t30),
  ]);
  const totals = {
    users: Number((await one<{ c: number }>('SELECT COUNT(*) AS c FROM users'))?.c ?? 0),
    openTickets: Number((await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM support_tickets WHERE status NOT IN ('resolved','closed')",
    ))?.c ?? 0),
  };
  const deltas = {
    revenue: pctDelta(revCur, revPrev),
    users: pctDelta(usrCur, usrPrev),
    requests: pctDelta(reqCur, reqPrev),
    tickets: pctDelta(tixCur, tixPrev),
  };
  const todayDate = new Date().toISOString().slice(0, 10);
  const staffStatus = {
    total: Number((await one<{ c: number }>(
      'SELECT COUNT(*) AS c FROM users u JOIN staff_profiles sp ON sp.user_id = u.id',
    ))?.c ?? 0),
    active: Number((await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users u JOIN staff_profiles sp ON sp.user_id = u.id WHERE u.status = 'active'",
    ))?.c ?? 0),
    checkedInToday: Number(attendanceToday?.c ?? 0),
    onLeaveToday: Number((await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM shifts WHERE status = 'leave' AND shift_date = ?", [todayDate],
    ))?.c ?? 0),
  };
  const ACTION_LABELS: Record<string, string> = {
    'payroll.contract.create': 'قرارداد همکاری تازه ثبت شد',
    'payroll.contract.close': 'قرارداد همکاری بسته شد',
    'payroll.service_percents': 'درصد خدمات کارمند به‌روز شد',
    'payroll.withdrawal': 'رویداد برداشت درآمد',
    'payroll.salary': 'ثبت پرداخت حقوق',
    'settings': 'تنظیمات به‌روزرسانی شد',
    'user.create': 'کاربر تازه ساخته شد',
    'user.update': 'مشخصات کاربر ویرایش شد',
    'service.create': 'خدمت تازه تعریف شد',
    'service.update': 'خدمت ویرایش شد',
    'request': 'رویداد پرونده',
    'payment': 'رویداد پرداخت',
    'auth.login': 'ورود به سامانه',
    'backup': 'نسخهٔ پشتیبان',
  };
  const activityRows = await q<any>('SELECT id, actor_name, action, entity_type, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 5')
    .catch(() => [] as any[]);
  const activity = activityRows.map((r) => {
    const key = Object.keys(ACTION_LABELS).find((k) => r.action === k || String(r.action).startsWith(k));
    return {
      id: r.id, actorName: r.actor_name, action: r.action,
      actionLabel: key ? ACTION_LABELS[key] : r.action,
      entityType: r.entity_type, createdAt: r.created_at,
    };
  });
  const pendingApprovalRows = await q<any>(
    `SELECT h.id AS handoff_id, h.created_at AS handed_at, r.id, r.tracking_code, r.status,
            s.title AS service_title, c.full_name AS customer_name,
            cat.icon AS category_icon, cat.color AS category_color
     FROM request_handoffs h JOIN requests r ON r.id = h.request_id
     JOIN services s ON s.id = r.service_id JOIN users c ON c.id = r.customer_id
     LEFT JOIN service_categories cat ON cat.id = s.category_id
     WHERE h.department = 'management' AND h.status = 'pending'
     ORDER BY h.created_at ASC LIMIT 5`,
  ).catch(() => [] as any[]);
  const pendingApprovalsCount = Number((await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM request_handoffs WHERE department = 'management' AND status = 'pending'",
  ).catch(() => null))?.c ?? 0);
  const dbOk = await one('SELECT 1 AS ok').then(() => true).catch(() => false);
  const lastBackup = await one<any>("SELECT MAX(created_at) AS at FROM backups WHERE status = 'ok'").catch(() => null);

  ok(res, {
    kind,
    stats,
    finance,
    totals,
    deltas,
    staffStatus,
    activity,
    pendingApprovals: pendingApprovalRows.map((r) => ({
      handoffId: r.handoff_id, id: r.id, trackingCode: r.tracking_code, status: r.status,
      statusLabel: STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status,
      serviceTitle: r.service_title, customerName: r.customer_name, createdAt: r.handed_at,
      categoryIcon: r.category_icon ?? null, categoryColor: r.category_color ?? null,
    })),
    pendingApprovalsCount,
    system: { dbOk, lastBackupAt: lastBackup?.at ?? null },
    cards: {
      unassigned: Number(unassigned?.c ?? 0),
      pendingDocuments: Number(pendingDocs?.c ?? 0),
      unreadMessages: Number(unreadThreads?.c ?? 0),
      checkedInToday: Number(attendanceToday?.c ?? 0),
    },
    workforceAlerts,
    charts: {
      daily: daily.map((d) => ({ day: d.day, count: Number(d.c) })),
      byStatus: byStatus.map((s) => ({ status: s.status, label: STATUS_LABELS[s.status as keyof typeof STATUS_LABELS] ?? s.status, count: Number(s.c) })),
    },
    recentRequests: recentRequests.map((r) => ({
      id: r.id, trackingCode: r.tracking_code, status: r.status,
      statusLabel: STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status,
      priority: r.priority, serviceTitle: r.service_title, customerName: r.customer_name,
      assigneeName: r.assignee_name, dueAt: r.due_at, deadlineAt: r.due_at, estimatedCompletionAt: r.estimated_completion_at, createdAt: r.created_at,
    })),
    urgent: urgent.map((r) => ({
      id: r.id, trackingCode: r.tracking_code, status: r.status, dueAt: r.due_at, deadlineAt: r.due_at,
      serviceTitle: r.service_title, customerName: r.customer_name,
    })),
    staffLoad: staffLoad.map((s) => ({ id: s.id, fullName: s.full_name, active: Number(s.active) })),
  });
}));
