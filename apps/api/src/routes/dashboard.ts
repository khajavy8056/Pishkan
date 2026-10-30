import { officeScope } from '../lib/scope.js';
import { Router } from 'express';
import { asyncRoute, requireAuth } from '../http/middleware.js';
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
  const kind = auth.user.kind === 'customer' ? 'customer'
    : officeScope(auth) ? 'admin' : 'staff';

  if (kind === 'customer') {
    const [stats, recent, invoices, notifications, popular] = await Promise.all([
      requestStats({ customerId: auth.user.id }),
      q<any>(
        `SELECT r.id, r.tracking_code, r.status, r.created_at, s.title AS service_title
         FROM requests r JOIN services s ON s.id = r.service_id
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
    const recent=await q<any>('SELECT r.id,r.tracking_code,r.status,s.title AS service_title FROM requests r JOIN services s ON s.id=r.service_id WHERE r.assigned_to=? ORDER BY r.created_at DESC LIMIT 10',[auth.user.id]);
    return ok(res,{kind,stats:await requestStats({assignedTo:auth.user.id}),recentRequests:recent,daily:[],byStatus:[],unassigned:0,pendingDocs:0,unreadThreads:0,finance:null});
  }
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
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
  const pendingDocs = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM request_documents WHERE status = 'pending'`);
  const unreadThreads = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM messages WHERE read_at IS NULL AND sender_role = 'customer'`,
  );

  const recentRequests = await q<any>(
    `SELECT r.id, r.tracking_code, r.status, r.priority, r.created_at, r.due_at,
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

  ok(res, {
    kind,
    stats,
    finance,
    cards: {
      unassigned: Number(unassigned?.c ?? 0),
      pendingDocuments: Number(pendingDocs?.c ?? 0),
      unreadMessages: Number(unreadThreads?.c ?? 0),
      checkedInToday: Number(attendanceToday?.c ?? 0),
    },
    charts: {
      daily: daily.map((d) => ({ day: d.day, count: Number(d.c) })),
      byStatus: byStatus.map((s) => ({ status: s.status, label: STATUS_LABELS[s.status as keyof typeof STATUS_LABELS] ?? s.status, count: Number(s.c) })),
    },
    recentRequests: recentRequests.map((r) => ({
      id: r.id, trackingCode: r.tracking_code, status: r.status,
      statusLabel: STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status,
      priority: r.priority, serviceTitle: r.service_title, customerName: r.customer_name,
      assigneeName: r.assignee_name, dueAt: r.due_at, createdAt: r.created_at,
    })),
    urgent: urgent.map((r) => ({
      id: r.id, trackingCode: r.tracking_code, status: r.status, dueAt: r.due_at,
      serviceTitle: r.service_title, customerName: r.customer_name,
    })),
    staffLoad: staffLoad.map((s) => ({ id: s.id, fullName: s.full_name, active: Number(s.active) })),
  });
}));
