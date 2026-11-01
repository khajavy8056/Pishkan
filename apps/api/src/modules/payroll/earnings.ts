/**
 * Staff earnings, withdrawal requests and fixed-salary payments.
 *
 * Everything here is derived from rows that already exist:
 *  - income          → `compensation_entries` (append-only ledger)
 *  - performance     → `requests` (real statuses and timestamps)
 *  - withdrawable    → ledger entries whose settlement window has ended
 *  - salary          → monthly salary entries plus real payment records
 *
 * No number is invented for display. A "pending estimate" is explicitly
 * labelled as an estimate and is computed from the open request's invoice.
 */
import { one, q, run, tx, nowIso, jsonParse } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { writeAudit } from '../audit/service.js';
import { logEvent } from '../logging/service.js';
import { notifyUser } from '../notifications/service.js';
import { getBool, getNumber } from '../settings/service.js';
import {
  activeContract, commissionAmount, cooperationType, officeRevenueOf, settlementPolicy,
  settlementWindow, startOfMonthIso, startOfWeekIso, todayIso,
} from './compensation.js';
import { contractHistory } from './service.js';

const OPEN = ['new', 'assigned', 'in_progress', 'waiting_documents', 'waiting_customer', 'under_review', 'ready'];
const ACTIVE = ['assigned', 'in_progress', 'waiting_documents', 'waiting_customer', 'under_review', 'ready'];
const RESERVING = ['submitted', 'reviewing', 'approved', 'paying'];

export const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  submitted: 'ثبت‌شده',
  reviewing: 'در انتظار بررسی حسابداری',
  approved: 'تأییدشده',
  paying: 'در حال پرداخت',
  paid: 'پرداخت‌شده',
  rejected: 'ردشده',
  cancelled: 'لغوشده',
};

export const EARNING_KIND_LABELS: Record<string, string> = {
  commission: 'سهم از خدمت',
  salary: 'حقوق ماهانه',
  reversal: 'برگشت سهم',
  settlement: 'تسویه پرداخت‌شده',
  adjustment: 'اصلاحیه',
};

/* ------------------------------- ledger reads ------------------------------ */

interface LedgerTotals {
  definite: number;        // all commission + reversals + adjustments
  eligible: number;        // unlocked entries whose window has ended
  future: number;          // unlocked entries still inside their window
  reserved: number;        // withdrawal requests waiting for money
  withdrawn: number;       // entries already paid through a withdrawal
  available: number;       // eligible - reserved (never negative)
  salaryAccrued: number;
  salaryPaid: number;
}

async function ledgerTotals(userId: string, at = nowIso()): Promise<LedgerTotals> {
  const row = await one<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN kind IN ('commission','reversal','adjustment') THEN amount ELSE 0 END),0) AS definite,
       COALESCE(SUM(CASE WHEN kind='salary' THEN amount ELSE 0 END),0) AS salary_accrued,
       COALESCE(SUM(CASE WHEN kind IN ('commission','reversal','adjustment')
                          AND withdrawal_id IS NULL AND COALESCE(withdrawable_at, created_at) <= ?
                         THEN amount ELSE 0 END),0) AS eligible,
       COALESCE(SUM(CASE WHEN kind IN ('commission','reversal','adjustment')
                          AND withdrawal_id IS NULL AND COALESCE(withdrawable_at, created_at) > ?
                         THEN amount ELSE 0 END),0) AS future,
       COALESCE(SUM(CASE WHEN kind IN ('commission','reversal','adjustment') AND withdrawal_id IS NOT NULL
                         THEN amount ELSE 0 END),0) AS withdrawn
     FROM compensation_entries WHERE user_id=?`,
    [at, at, userId],
  );
  const reservedRow = await one<any>(
    `SELECT COALESCE(SUM(amount),0) AS reserved FROM staff_withdrawals
     WHERE user_id=? AND status IN (${RESERVING.map(() => '?').join(',')})`,
    [userId, ...RESERVING],
  );
  const paidSalary = await one<any>(
    "SELECT COALESCE(SUM(amount),0) AS paid FROM staff_salary_payments WHERE user_id=? AND status='paid'",
    [userId],
  );
  const eligible = Number(row?.eligible ?? 0);
  const reserved = Number(reservedRow?.reserved ?? 0);
  return {
    definite: Number(row?.definite ?? 0),
    eligible, future: Number(row?.future ?? 0), reserved,
    withdrawn: Number(row?.withdrawn ?? 0),
    available: Math.max(0, eligible - reserved),
    salaryAccrued: Number(row?.salary_accrued ?? 0),
    salaryPaid: Number(paidSalary?.paid ?? 0),
  };
}

export async function withdrawableBalance(userId: string) {
  const policy = await settlementPolicy(userId);
  const totals = await ledgerTotals(userId);
  const pending = await one<any>(
    "SELECT COALESCE(SUM(amount),0) AS total FROM staff_withdrawals WHERE user_id=? AND status IN ('submitted','reviewing')",
    [userId],
  );
  const nextWindow = settlementWindow(policy, nowIso(), (await activeContract(userId))?.starts_on ?? '2024-01-01');
  return {
    ...totals,
    requested: Number(pending?.total ?? 0),
    minWithdrawal: policy.minWithdrawal,
    period: policy.period,
    periodDays: policy.days,
    currentWindow: { start: nextWindow.start, end: nextWindow.end },
    enabled: policy.enabled,
    canRequest: policy.enabled && totals.available >= Math.max(1, policy.minWithdrawal),
  };
}

/* ------------------------------- performance ------------------------------ */

export async function performanceSummary(userId: string) {
  const today = todayIso();
  const weekStart = startOfWeekIso(await getNumber('workforce.week_starts_on'));
  const monthStart = startOfMonthIso();
  const counts = await q<any>('SELECT status, COUNT(*) AS c FROM requests WHERE assigned_to=? GROUP BY status', [userId]);
  const map = new Map(counts.map((row) => [row.status, Number(row.c)]));
  const completed = await one<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN completed_at >= ? THEN 1 ELSE 0 END),0) AS today,
       COALESCE(SUM(CASE WHEN completed_at >= ? THEN 1 ELSE 0 END),0) AS week,
       COALESCE(SUM(CASE WHEN completed_at >= ? THEN 1 ELSE 0 END),0) AS month
     FROM requests WHERE assigned_to=? AND status='completed'`,
    [`${today}T00:00:00.000Z`, weekStart, monthStart, userId],
  );
  // Average completion time is computed in JS from real timestamps; the SQL
  // layer stays dialect-neutral (no vendor date arithmetic).
  const completedRows = await q<any>(
    `SELECT assigned_at, completed_at FROM requests
     WHERE assigned_to=? AND status='completed' AND assigned_at IS NOT NULL AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 200`,
    [userId],
  );
  const durationMinutes = completedRows
    .map((row) => (Date.parse(row.completed_at) - Date.parse(row.assigned_at)) / 60_000)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const averageCompletionMinutes = durationMinutes.length
    ? Math.round(durationMinutes.reduce((sum, value) => sum + value, 0) / durationMinutes.length)
    : 0;
  const accepted = await one<any>('SELECT COUNT(*) AS c FROM requests WHERE assigned_to=?', [userId]);
  const inProgress = ACTIVE.reduce((sum, status) => sum + (map.get(status) ?? 0), 0);
  return {
    total: [...map.values()].reduce((sum, value) => sum + value, 0),
    accepted: Number(accepted?.c ?? 0),
    completed: map.get('completed') ?? 0,
    completedToday: Number(completed?.today ?? 0),
    completedWeek: Number(completed?.week ?? 0),
    completedMonth: Number(completed?.month ?? 0),
    cancelled: (map.get('cancelled') ?? 0) + (map.get('rejected') ?? 0),
    inProgress,
    // Statuses are the source of truth; the mapping is documented rather than
    // invented so the counter can always be traced back to a filter.
    awaitingOrganization: (map.get('under_review') ?? 0),
    awaitingCustomer: (map.get('waiting_documents') ?? 0) + (map.get('waiting_customer') ?? 0),
    needsAction: (map.get('ready') ?? 0) + (map.get('assigned') ?? 0),
    unclaimed: map.get('new') ?? 0,
    averageCompletionMinutes,
    avgMinutesSample: durationMinutes.length,
  };
}

/* --------------------------------- income --------------------------------- */

/**
 * Income rows for the employee, each one traceable to a request and a payment.
 * `status` explains the money state, never a guess.
 */
export async function incomeEntries(userId: string, opts: { from?: string; to?: string; limit?: number } = {}) {
  const where = ["ce.user_id = ?", "ce.kind IN ('commission','reversal','adjustment')"];
  const args: any[] = [userId];
  if (opts.from) { where.push('ce.created_at >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('ce.created_at <= ?'); args.push(opts.to); }
  const rows = await q<any>(
    `SELECT ce.*, r.tracking_code, r.completed_at, s.title AS service_title, c.full_name AS customer_name,
            p.status AS payment_status, w.status AS withdrawal_status
     FROM compensation_entries ce
     LEFT JOIN requests r ON r.id = ce.request_id
     LEFT JOIN services s ON s.id = r.service_id
     LEFT JOIN users c ON c.id = r.customer_id
     LEFT JOIN payments p ON p.id = ce.payment_id
     LEFT JOIN staff_withdrawals w ON w.id = ce.withdrawal_id
     WHERE ${where.join(' AND ')}
     ORDER BY ce.created_at DESC LIMIT ?`,
    [...args, Math.min(500, opts.limit ?? 200)],
  );
  const now = nowIso();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    kindLabel: EARNING_KIND_LABELS[row.kind] ?? row.kind,
    amount: Number(row.amount),
    basisAmount: Number(row.basis_amount ?? 0),
    percent: Number(row.percent ?? 0),
    requestId: row.request_id,
    trackingCode: row.tracking_code,
    serviceTitle: row.service_title,
    customerName: row.customer_name,
    performedAt: row.completed_at,
    recordedAt: row.created_at,
    paymentStatus: row.payment_status,
    withdrawableAt: row.withdrawable_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    withdrawalId: row.withdrawal_id,
    withdrawalStatus: row.withdrawal_status,
    status: row.withdrawal_id
      ? 'withdrawn'
      : row.kind === 'reversal' ? 'reversal'
        : (row.withdrawable_at ?? row.created_at) <= now ? 'withdrawable' : 'pending_settlement',
    note: row.note,
  }));
}

/** Estimate for open, assigned requests. Explicitly an estimate, never booked. */
export async function pendingEstimate(userId: string) {
  const percent = await activeContract(userId);
  if (!percent || percent.kind !== 'commission') return { percent: 0, items: [], total: 0 };
  const rows = await q<any>(
    `SELECT r.id, r.tracking_code, r.total, r.status, s.title AS service_title,
            (SELECT COALESCE(SUM(i.total - i.tax),0) FROM invoices i WHERE i.request_id=r.id) AS net_total
     FROM requests r JOIN services s ON s.id=r.service_id
     WHERE r.assigned_to=? AND r.status IN (${OPEN.map(() => '?').join(',')})`,
    [userId, ...OPEN],
  );
  const items = rows.map((row) => ({
    requestId: row.id, trackingCode: row.tracking_code, serviceTitle: row.service_title,
    status: row.status, officeRevenue: Math.round(Number(row.net_total ?? 0) || Number(row.total ?? 0)),
    estimate: commissionAmount(Math.round(Number(row.net_total ?? 0) || Number(row.total ?? 0)), Number(percent.commission_percent)),
  }));
  return { percent: Number(percent.commission_percent), items, total: items.reduce((sum, item) => sum + item.estimate, 0) };
}

export async function incomeSummary(userId: string) {
  const total = await ledgerTotals(userId);
  const sums = await q<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END),0) AS today,
       COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END),0) AS week,
       COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END),0) AS month
     FROM compensation_entries WHERE user_id=? AND kind IN ('commission','reversal','adjustment')`,
    [`${todayIso()}T00:00:00.000Z`, startOfWeekIso(await getNumber('workforce.week_starts_on')), startOfMonthIso(), userId],
  );
  const pending = await pendingEstimate(userId);
  return {
    today: Number(sums[0]?.today ?? 0),
    week: Number(sums[0]?.week ?? 0),
    month: Number(sums[0]?.month ?? 0),
    definite: total.definite,
    pendingEstimate: pending.total,
    pendingItems: pending.items,
    withdrawable: total.available,
    requested: total.reserved,
    withdrawn: total.withdrawn,
    paidOut: await one<any>(
      "SELECT COALESCE(SUM(-amount),0) AS paid FROM compensation_entries WHERE user_id=? AND kind='settlement'",
      [userId],
    ).then((row) => Number(row?.paid ?? 0)),
  };
}

/* ------------------------------- withdrawals ------------------------------ */

let notifyApproversInFlight: Promise<void> | null = null;

async function notifyApprovers(title: string, body: string, link: string, idempotencyKey: string) {
  const rows = await q<any>(
    `SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.kind IN ('staff','admin') AND u.status='active'
       AND (r.permissions='*' OR r.permissions LIKE '%payroll.approve%' OR r.permissions LIKE '%payroll.settle%')`,
  );
  for (const row of rows) {
    await notifyUser(row.id, { title, body, kind: 'info', link, idempotencyKey: `${idempotencyKey}:${row.id}` });
  }
}

export async function createWithdrawal(userId: string, amount: number, note: string | undefined, actor: { id: string; name: string }) {
  return tx(async () => {
    const type = await cooperationType(userId);
    if (type !== 'commission') throw forbidden('درخواست برداشت فقط برای کارکنان درصدی است.');
    if (!(await getBool('payroll.withdrawal_enabled'))) throw badRequest('درخواست برداشت در تنظیمات سامانه غیرفعال است.');
    if (!Number.isInteger(amount) || amount <= 0) throw badRequest('مبلغ برداشت باید یک عدد صحیح ریالی بزرگ‌تر از صفر باشد.');
    // Serialize concurrent requests of the same employee.
    await run('UPDATE users SET updated_at=updated_at WHERE id=?', [userId]);
    const policy = await settlementPolicy(userId);
    if (amount < policy.minWithdrawal) {
      throw badRequest(`مبلغ برداشت کمتر از حداقل مجاز (${policy.minWithdrawal.toLocaleString('en-US')} ریال) است.`);
    }
    const balance = await withdrawableBalance(userId);
    if (amount > balance.available) {
      throw badRequest('مبلغ درخواستی بیشتر از موجودی قابل برداشت است.', {
        available: balance.available, reserved: balance.reserved, minWithdrawal: policy.minWithdrawal,
      });
    }
    const now = nowIso();
    const window = settlementWindow(policy, now, (await activeContract(userId))?.starts_on ?? '2024-01-01');
    const withdrawalId = id('wdr');
    await run(
      `INSERT INTO staff_withdrawals
         (id,user_id,amount,status,period_start,period_end,requested_at,request_note,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [withdrawalId, userId, amount, 'submitted', window.start, window.end, now, note ?? null, now, now],
    );
    await addWithdrawalEvent({ withdrawalId, action: 'submitted', toStatus: 'submitted', actorId: actor.id, actorName: actor.name, note });
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'payroll.withdrawal.request', entityType: 'staff_withdrawal',
      entityId: withdrawalId, after: { amount, period: window },
    });
    await logEvent({
      level: 'INFO', category: 'staff', action: 'payroll.withdrawal.request', result: 'success',
      actorId: userId, message: 'درخواست برداشت درآمد ثبت شد.', details: { withdrawalId, amount },
    });
    await notifyApprovers(
      'درخواست برداشت جدید', `${actor.name} درخواست برداشت ${amount.toLocaleString('en-US')} ریال ثبت کرد.`,
      '/admin/payroll', `withdrawal-request:${withdrawalId}`,
    );
    return { id: withdrawalId, amount, status: 'submitted' };
  });
}

async function addWithdrawalEvent(input: {
  withdrawalId: string; action: string; fromStatus?: string | null; toStatus?: string | null;
  actorId?: string | null; actorName?: string | null; note?: string | null;
}) {
  await run(
    `INSERT INTO staff_withdrawal_events (id,withdrawal_id,action,from_status,to_status,actor_id,actor_name,note,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id('wde'), input.withdrawalId, input.action, input.fromStatus ?? null, input.toStatus ?? null,
      input.actorId ?? null, input.actorName ?? null, input.note ?? null, nowIso()],
  );
}

function mapWithdrawal(row: any) {
  return {
    id: row.id, userId: row.user_id, staffName: row.staff_name ?? null, amount: Number(row.amount),
    status: row.status, statusLabel: WITHDRAWAL_STATUS_LABELS[row.status] ?? row.status,
    periodStart: row.period_start, periodEnd: row.period_end, requestedAt: row.requested_at,
    note: row.request_note, decisionNote: row.decision_note, reviewedAt: row.reviewed_at,
    approvedAt: row.approved_at, rejectedAt: row.rejected_at, paidAt: row.paid_at,
    paymentMethod: row.payment_method, trackingCode: row.tracking_code, accountingNote: row.accounting_note,
    createdAt: row.created_at,
  };
}

export async function listWithdrawals(opts: {
  userId?: string; status?: string; from?: string; to?: string; minAmount?: number; page?: number; pageSize?: number;
} = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (opts.userId) { where.push('w.user_id = ?'); args.push(opts.userId); }
  if (opts.status) { where.push('w.status = ?'); args.push(opts.status); }
  if (opts.from) { where.push('w.created_at >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('w.created_at <= ?'); args.push(opts.to); }
  if (opts.minAmount) { where.push('w.amount >= ?'); args.push(opts.minAmount); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const total = await one<any>(`SELECT COUNT(*) AS c FROM staff_withdrawals w ${clause}`, args);
  const rows = await q<any>(
    `SELECT w.*, u.full_name AS staff_name FROM staff_withdrawals w JOIN users u ON u.id=w.user_id
     ${clause} ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapWithdrawal), total: Number(total?.c ?? 0), page, pageSize };
}

export async function withdrawalDetail(withdrawalId: string, scopeUserId?: string) {
  const row = await one<any>(
    `SELECT w.*, u.full_name AS staff_name FROM staff_withdrawals w JOIN users u ON u.id=w.user_id WHERE w.id=?`,
    [withdrawalId],
  );
  if (!row) throw notFound('درخواست برداشت یافت نشد.');
  if (scopeUserId && row.user_id !== scopeUserId) throw forbidden();
  const events = await q<any>(
    'SELECT * FROM staff_withdrawal_events WHERE withdrawal_id=? ORDER BY created_at ASC', [withdrawalId],
  );
  const balance = await withdrawableBalance(row.user_id);
  return {
    ...mapWithdrawal(row),
    events: events.map((event) => ({
      id: event.id, action: event.action, fromStatus: event.from_status, toStatus: event.to_status,
      actorName: event.actor_name, note: event.note, createdAt: event.created_at,
    })),
    available: balance.available,
  };
}

const ALLOWED: Record<string, { from: string[]; to: string }> = {
  review: { from: ['submitted'], to: 'reviewing' },
  approve: { from: ['submitted', 'reviewing'], to: 'approved' },
  reject: { from: ['submitted', 'reviewing', 'approved'], to: 'rejected' },
  cancel: { from: ['submitted', 'reviewing'], to: 'cancelled' },
  paying: { from: ['approved'], to: 'paying' },
};

/**
 * Move a withdrawal through its workflow. Every transition needs the actor and
 * is recorded in `staff_withdrawal_events`; a rejected request keeps its reason.
 */
export async function advanceWithdrawal(
  withdrawalId: string, action: keyof typeof ALLOWED, actor: { id: string; name: string }, input: { note?: string } = {},
) {
  return tx(async () => {
    const row = await one<any>('SELECT * FROM staff_withdrawals WHERE id=?', [withdrawalId]);
    if (!row) throw notFound('درخواست برداشت یافت نشد.');
    const rule = ALLOWED[action];
    if (!rule) throw badRequest('اقدام نامعتبر است.');
    if (!rule.from.includes(row.status)) {
      throw conflict(`این درخواست در وضعیت «${WITHDRAWAL_STATUS_LABELS[row.status]}» است و «${action}» برای آن مجاز نیست.`);
    }
    if ((action === 'reject') && !input.note?.trim()) throw badRequest('علت رد درخواست الزامی است.');
    const now = nowIso();
    const fields: Record<string, any> = { status: rule.to, updated_at: now };
    if (action === 'review') { fields.reviewed_by = actor.id; fields.reviewed_at = now; }
    if (action === 'approve') { fields.approved_by = actor.id; fields.approved_at = now; }
    if (action === 'reject') { fields.rejected_by = actor.id; fields.rejected_at = now; fields.decision_note = input.note; }
    if (action === 'cancel') { fields.decision_note = input.note ?? null; }
    const changed = await run(
      `UPDATE staff_withdrawals SET ${Object.keys(fields).map((key) => `${key}=?`).join(', ')}
       WHERE id=? AND status=?`,
      [...Object.values(fields), withdrawalId, row.status],
    );
    if (!changed.changes) throw conflict('وضعیت درخواست هم‌زمان تغییر کرده است؛ صفحه را تازه کنید.');
    await addWithdrawalEvent({
      withdrawalId, action, fromStatus: row.status, toStatus: rule.to,
      actorId: actor.id, actorName: actor.name, note: input.note,
    });
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: `payroll.withdrawal.${action}`,
      entityType: 'staff_withdrawal', entityId: withdrawalId,
      before: { status: row.status }, after: { status: rule.to, note: input.note },
    });
    if (action === 'approve' || action === 'reject') {
      await notifyUser(row.user_id, {
        title: action === 'approve' ? 'درخواست برداشت شما تأیید شد' : 'درخواست برداشت شما رد شد',
        body: action === 'reject' ? `علت: ${input.note}` : `مبلغ ${Number(row.amount).toLocaleString('en-US')} ریال تأیید شد و در انتظار پرداخت است.`,
        kind: action === 'approve' ? 'success' : 'warning', link: '/staff/earnings',
        idempotencyKey: `withdrawal-${action}:${withdrawalId}`,
      });
    }
    return withdrawalDetail(withdrawalId);
  });
}

/**
 * Record the real payout and consume the ledger entries (FIFO).
 * The withdrawal only becomes `paid` if the money is actually available.
 */
export async function payWithdrawal(
  withdrawalId: string,
  input: { method: string; trackingCode: string; paidAt?: string; note?: string },
  actor: { id: string; name: string },
) {
  return tx(async () => {
    const row = await one<any>('SELECT * FROM staff_withdrawals WHERE id=?', [withdrawalId]);
    if (!row) throw notFound('درخواست برداشت یافت نشد.');
    if (row.status === 'paid') throw conflict('این درخواست قبلاً پرداخت شده است.');
    if (!['approved', 'paying'].includes(row.status)) {
      throw conflict('پرداخت فقط پس از تأیید درخواست امکان‌پذیر است.');
    }
    const method = String(input.method ?? '').trim();
    const trackingCode = String(input.trackingCode ?? '').trim();
    if (method.length < 2) throw badRequest('روش پرداخت را مشخص کنید.');
    if (trackingCode.length < 3) throw badRequest('شناسه پیگیری یا شماره سند پرداخت الزامی است.');

    await run('UPDATE users SET updated_at=updated_at WHERE id=?', [row.user_id]);
    const now = nowIso();
    const paidAt = input.paidAt ?? now;
    const amount = Number(row.amount);

    const entries = await q<any>(
      `SELECT * FROM compensation_entries
       WHERE user_id=? AND withdrawal_id IS NULL AND kind IN ('commission','adjustment')
         AND amount > 0 AND COALESCE(withdrawable_at, created_at) <= ?
       ORDER BY COALESCE(withdrawable_at, created_at) ASC, created_at ASC`,
      [row.user_id, paidAt],
    );
    const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
    if (total < amount) {
      throw conflict('موجودی قابل برداشت برای این پرداخت کافی نیست (احتمالاً سهمی برگشت خورده است). ابتدا وضعیت مالی کارمند را بررسی کنید.');
    }
    let remaining = amount;
    for (const entry of entries) {
      if (remaining <= 0) break;
      await run('UPDATE compensation_entries SET withdrawal_id=? WHERE id=? AND withdrawal_id IS NULL', [withdrawalId, entry.id]);
      remaining -= Number(entry.amount);
    }

    await run(
      `INSERT INTO compensation_entries
         (id,operation_key,user_id,kind,amount,note,created_by,created_at,withdrawal_id,basis_amount,percent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(operation_key) DO NOTHING`,
      [id('comp'), `withdraw:${withdrawalId}`, row.user_id, 'settlement', -amount,
        `برداشت درآمد — ${trackingCode}`, actor.id, now, withdrawalId, 0, 0],
    );

    const changed = await run(
      `UPDATE staff_withdrawals
       SET status='paid', paid_at=?, payment_method=?, tracking_code=?, accounting_note=?, updated_at=?
       WHERE id=? AND status IN ('approved','paying')`,
      [paidAt, method, trackingCode, input.note ?? null, now, withdrawalId],
    );
    if (!changed.changes) throw conflict('وضعیت درخواست هم‌زمان تغییر کرده است.');
    await addWithdrawalEvent({
      withdrawalId, action: 'pay', fromStatus: row.status, toStatus: 'paid',
      actorId: actor.id, actorName: actor.name, note: `${method} — ${trackingCode}`,
    });
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'payroll.withdrawal.pay', entityType: 'staff_withdrawal',
      entityId: withdrawalId, before: { status: row.status }, after: { status: 'paid', amount, method, trackingCode },
    });
    await logEvent({
      level: 'INFO', category: 'staff', action: 'payroll.withdrawal.pay', result: 'success',
      actorId: actor.id, message: 'پرداخت درخواست برداشت ثبت شد.', details: { withdrawalId, amount, method },
    });
    await notifyUser(row.user_id, {
      title: 'درخواست برداشت شما پرداخت شد',
      body: `مبلغ ${amount.toLocaleString('en-US')} ریال — پیگیری ${trackingCode}`,
      kind: 'success', link: '/staff/earnings', idempotencyKey: `withdrawal-paid:${withdrawalId}`,
    });
    return withdrawalDetail(withdrawalId);
  });
}

/* ----------------------------- salary payments ---------------------------- */

export async function recordSalaryPayment(input: {
  userId: string; periodMonth: string; amount: number; method: string; trackingCode: string;
  paidAt?: string; note?: string;
}, actor: { id: string; name: string }) {
  return tx(async () => {
    const type = await cooperationType(input.userId);
    if (type !== 'monthly') {
      throw badRequest('ثبت حقوق ثابت فقط برای کارکنان حقوق ثابت مجاز است؛ درآمد کارکنان درصدی از مسیر برداشت پرداخت می‌شود.');
    }
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.periodMonth)) throw badRequest('ماه دوره باید به شکل YYYY-MM باشد.');
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest('مبلغ حقوق باید عدد صحیح مثبت باشد.');
    if (String(input.method ?? '').trim().length < 2) throw badRequest('روش پرداخت را مشخص کنید.');
    if (String(input.trackingCode ?? '').trim().length < 3) throw badRequest('شناسه پیگیری یا شماره سند الزامی است.');

    await run('UPDATE users SET updated_at=updated_at WHERE id=?', [input.userId]);
    const totals = await ledgerTotals(input.userId);
    const outstanding = Math.max(0, totals.salaryAccrued - totals.salaryPaid);
    if (input.amount > outstanding) {
      throw badRequest('مبلغ پرداخت بیشتر از حقوق محاسبه‌شده و پرداخت‌نشده است.', { outstanding });
    }
    const now = nowIso();
    const paymentId = id('salp');
    await run(
      `INSERT INTO staff_salary_payments
         (id,user_id,period_month,amount,status,method,tracking_code,paid_at,recorded_by,recorded_name,note,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [paymentId, input.userId, input.periodMonth, input.amount, 'paid', input.method, input.trackingCode,
        input.paidAt ?? now, actor.id, actor.name, input.note ?? null, now, now],
    );
    await run(
      `INSERT INTO compensation_entries
         (id,operation_key,user_id,kind,amount,period,note,created_by,created_at,salary_payment_id)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(operation_key) DO NOTHING`,
      [id('comp'), `salary-payment:${paymentId}`, input.userId, 'settlement', -input.amount, input.periodMonth,
        `پرداخت حقوق ${input.periodMonth} — ${input.trackingCode}`, actor.id, now, paymentId],
    );
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'payroll.salary.pay', entityType: 'staff_salary_payment',
      entityId: paymentId, after: { ...input },
    });
    await notifyUser(input.userId, {
      title: 'حقوق شما پرداخت شد',
      body: `دوره ${input.periodMonth} — ${input.amount.toLocaleString('en-US')} ریال`,
      kind: 'success', link: '/staff/finance', idempotencyKey: `salary-paid:${paymentId}`,
    });
    return { id: paymentId, amount: input.amount, outstanding: outstanding - input.amount };
  });
}

export async function salaryHistory(userId: string) {
  const contract = await activeContract(userId);
  const entries = await q<any>(
    "SELECT * FROM compensation_entries WHERE user_id=? AND kind='salary' ORDER BY period DESC",
    [userId],
  );
  const payments = await q<any>(
    'SELECT * FROM staff_salary_payments WHERE user_id=? ORDER BY period_month DESC, created_at DESC',
    [userId],
  );
  const paidByMonth = new Map<string, number>();
  for (const payment of payments) {
    paidByMonth.set(payment.period_month, (paidByMonth.get(payment.period_month) ?? 0) + Number(payment.amount));
  }
  const today = todayIso();
  const months = entries.map((entry) => {
    const paid = paidByMonth.get(entry.period) ?? 0;
    const accrued = Number(entry.amount);
    const monthEnd = new Date(Date.UTC(Number(entry.period.slice(0, 4)), Number(entry.period.slice(5, 7)), 0))
      .toISOString().slice(0, 10);
    const status = paid >= accrued ? 'paid' : monthEnd < today ? 'overdue' : 'pending';
    return {
      period: entry.period, accrued, paid, remaining: Math.max(0, accrued - paid),
      status, statusLabel: status === 'paid' ? 'پرداخت‌شده' : status === 'overdue' ? 'معوق' : 'در انتظار پرداخت',
    };
  });
  return {
    contract: contract ? { monthlyAmount: Number(contract.monthly_amount), startsOn: contract.starts_on, endsOn: contract.ends_on } : null,
    months,
    outstanding: months.reduce((sum, month) => sum + month.remaining, 0),
    payments: payments.map((payment) => ({
      id: payment.id, periodMonth: payment.period_month, amount: Number(payment.amount),
      method: payment.method, trackingCode: payment.tracking_code, paidAt: payment.paid_at,
      recordedName: payment.recorded_name, note: payment.note, status: payment.status,
    })),
    history: await contractHistory(userId),
  };
}

/* ---------------------------------- dashboards ---------------------------- */

export async function staffDashboard(userId: string) {
  const type = await cooperationType(userId);
  const performance = await performanceSummary(userId);
  if (type === 'commission') {
    return {
      cooperationType: type,
      cooperationLabel: 'درصدی',
      performance,
      income: await incomeSummary(userId),
      balance: await withdrawableBalance(userId),
      withdrawals: (await listWithdrawals({ userId, pageSize: 10 })).items,
      openWithdrawal: await one<any>(
        "SELECT COUNT(*) AS c FROM staff_withdrawals WHERE user_id=? AND status IN ('submitted','reviewing','approved','paying')",
        [userId],
      ).then((row) => Number(row?.c ?? 0)),
    };
  }
  const salary = await salaryHistory(userId);
  return {
    cooperationType: type,
    cooperationLabel: type === 'monthly' ? 'حقوق ثابت' : 'بدون قرارداد',
    performance,
    salary,
    // Fixed employees never receive a percentage/withdrawal panel.
    income: null,
    balance: null,
    withdrawals: [],
    openWithdrawal: 0,
  };
}

/** Complete, cooperation-aware employee file for the manager and accounting. */
export async function staffFile(userId: string) {
  const user = await one<any>(
    `SELECT u.id,u.full_name,u.mobile,u.username,u.status,u.created_at,r.code AS role_code,r.name AS role_name,
            sp.employee_code,sp.position,sp.hired_at,sp.specialties,sp.max_active_cases,sp.accepts_new_cases
     FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN staff_profiles sp ON sp.user_id=u.id
     WHERE u.id=? AND u.kind IN ('staff','admin')`, [userId],
  );
  if (!user) throw notFound('کارمند یافت نشد.');
  const type = await cooperationType(userId);
  const performance = await performanceSummary(userId);
  const shift = await one<any>(
    "SELECT start_time,end_time FROM shifts WHERE user_id=? AND shift_date=? AND status<>'leave'",
    [userId, todayIso()],
  );
  const attendance = await one<any>(
    'SELECT check_in, check_out, status FROM attendance WHERE user_id=? ORDER BY check_in DESC LIMIT 1', [userId],
  );
  const earnings = await incomeEntries(userId, { limit: 50 });
  const base = {
    staff: {
      id: user.id, fullName: user.full_name, mobile: user.mobile, username: user.username,
      status: user.status, roleCode: user.role_code, roleName: user.role_name,
      employeeCode: user.employee_code, position: user.position, hiredAt: user.hired_at,
      specialties: jsonParse<string[]>(user.specialties, []),
      maxActiveCases: Number(user.max_active_cases ?? 0), acceptsNewCases: Boolean(user.accepts_new_cases),
      shift: shift ? { startTime: shift.start_time, endTime: shift.end_time } : null,
      attendance: attendance ? { checkIn: attendance.check_in, checkOut: attendance.check_out, status: attendance.status } : null,
    },
    cooperationType: type,
    cooperationLabel: type === 'commission' ? 'درصدی' : type === 'monthly' ? 'حقوق ثابت' : 'بدون قرارداد',
    contract: await activeContract(userId).then((contract) => contract ? {
      id: contract.id, kind: contract.kind, monthlyAmount: Number(contract.monthly_amount),
      commissionPercent: Number(contract.commission_percent), startsOn: contract.starts_on,
      endsOn: contract.ends_on, settlementPeriod: contract.settlement_period,
      settlementDays: Number(contract.settlement_days), minWithdrawal: Number(contract.min_withdrawal),
    } : null),
    contractHistory: await contractHistory(userId),
    performance,
    recentRequests: await q<any>(
      `SELECT r.id,r.tracking_code,r.status,r.total,r.created_at,r.completed_at,s.title AS service_title
       FROM requests r JOIN services s ON s.id=r.service_id WHERE r.assigned_to=?
       ORDER BY r.created_at DESC LIMIT 20`, [userId],
    ).then((rows) => rows.map((row) => ({
      id: row.id, trackingCode: row.tracking_code, status: row.status, total: Number(row.total),
      serviceTitle: row.service_title, createdAt: row.created_at, completedAt: row.completed_at,
    }))),
  };
  if (type === 'commission') {
    return {
      ...base,
      income: await incomeSummary(userId),
      entries: earnings,
      balance: await withdrawableBalance(userId),
      withdrawals: (await listWithdrawals({ userId, pageSize: 50 })).items,
      salary: null,
    };
  }
  return {
    ...base,
    income: null,
    entries: [],
    balance: null,
    withdrawals: [],
    salary: await salaryHistory(userId),
  };
}

/* --------------------------------- reporting ------------------------------ */

export async function payrollOverview() {
  const activeContracts = await q<any>(
    `SELECT c.*, u.full_name FROM compensation_contracts c JOIN users u ON u.id=c.user_id
     WHERE c.is_active=1 AND c.starts_on<=? AND (c.ends_on IS NULL OR c.ends_on>=?)`,
    [todayIso(), todayIso()],
  );
  const commissionStaff = activeContracts.filter((row) => row.kind === 'commission');
  const monthlyStaff = activeContracts.filter((row) => row.kind === 'monthly');
  const pendingWithdrawals = await one<any>(
    "SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM staff_withdrawals WHERE status IN ('submitted','reviewing','approved','paying')",
  );
  const paidWithdrawals = await one<any>(
    "SELECT COALESCE(SUM(amount),0) AS total FROM staff_withdrawals WHERE status='paid'",
  );
  const salaryObligation = await q<any>(
    `SELECT ce.user_id, u.full_name,
            SUM(CASE WHEN ce.kind='salary' THEN ce.amount ELSE 0 END) AS accrued,
            (SELECT COALESCE(SUM(p.amount),0) FROM staff_salary_payments p WHERE p.user_id=ce.user_id AND p.status='paid') AS paid
     FROM compensation_entries ce JOIN users u ON u.id=ce.user_id
     GROUP BY ce.user_id, u.full_name`,
  );
  const commissionTotals = await one<any>(
    "SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS earned, COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) AS reversed FROM compensation_entries WHERE kind IN ('commission','reversal','adjustment')",
  );
  return {
    commissionStaff: commissionStaff.map((row) => ({ id: row.user_id, fullName: row.full_name, percent: Number(row.commission_percent) })),
    monthlyStaff: monthlyStaff.map((row) => ({ id: row.user_id, fullName: row.full_name, monthlyAmount: Number(row.monthly_amount) })),
    pendingWithdrawals: { count: Number(pendingWithdrawals?.c ?? 0), total: Number(pendingWithdrawals?.total ?? 0) },
    paidWithdrawals: Number(paidWithdrawals?.total ?? 0),
    salary: salaryObligation.map((row) => ({
      userId: row.user_id, fullName: row.full_name, accrued: Number(row.accrued),
      paid: Number(row.paid), outstanding: Math.max(0, Number(row.accrued) - Number(row.paid)),
    })).filter((row) => row.accrued > 0),
    commission: { earned: Number(commissionTotals?.earned ?? 0), reversed: Number(commissionTotals?.reversed ?? 0) },
  };
}

export async function payrollReports(opts: { from?: string; to?: string } = {}) {
  const from = opts.from ?? `${new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`;
  const to = opts.to ?? nowIso();
  const perStaff = await q<any>(
    `SELECT ce.user_id, u.full_name, c.kind,
            SUM(CASE WHEN ce.kind IN ('commission','reversal','adjustment') THEN ce.amount ELSE 0 END) AS income,
            SUM(CASE WHEN ce.kind IN ('commission','reversal','adjustment') THEN ce.basis_amount ELSE 0 END) AS basis,
            COUNT(CASE WHEN ce.kind='commission' THEN 1 END) AS services
     FROM compensation_entries ce JOIN users u ON u.id=ce.user_id
     LEFT JOIN compensation_contracts c ON c.id=ce.contract_id
     WHERE ce.created_at BETWEEN ? AND ? GROUP BY ce.user_id, u.full_name, c.kind`,
    [from, to],
  );
  const withdrawals = await q<any>(
    `SELECT status, COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM staff_withdrawals
     WHERE created_at BETWEEN ? AND ? GROUP BY status`, [from, to],
  );
  const office = await one<any>(
    `SELECT COALESCE(SUM(i.total - i.tax),0) AS office_revenue,
            COALESCE(SUM(i.total),0) AS gross,
            COALESCE(SUM(i.paid_amount),0) AS collected
     FROM invoices i
     WHERE i.created_at BETWEEN ? AND ? AND i.status <> 'void'`, [from, to],
  );
  return {
    from, to,
    staff: perStaff.map((row) => ({
      userId: row.user_id, fullName: row.full_name, cooperationType: row.kind ?? 'none',
      income: Number(row.income), basis: Number(row.basis), services: Number(row.services),
    })),
    withdrawals: withdrawals.map((row) => ({
      status: row.status, statusLabel: WITHDRAWAL_STATUS_LABELS[row.status] ?? row.status,
      count: Number(row.c), total: Number(row.total),
    })),
    office: {
      officeRevenue: Number(office?.office_revenue ?? 0),
      gross: Number(office?.gross ?? 0),
      collected: Number(office?.collected ?? 0),
      staffShare: perStaff.reduce((sum, row) => sum + Number(row.income), 0),
    },
  };
}
