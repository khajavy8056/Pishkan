/**
 * Shared payroll primitives: cooperation type, the active contract and the
 * settlement window.
 *
 * Every number shown in a dashboard comes from one of these functions plus a
 * database row — there is no synthetic series anywhere in the payroll module.
 */
import { one, q, run, tx, nowIso } from '../../db/index.js';
import { getNumber, getString } from '../settings/service.js';
import { badRequest, notFound } from '../../http/errors.js';

export type CooperationType = 'commission' | 'monthly' | 'none';
export type SettlementPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface Contract {
  id: string;
  user_id: string;
  kind: 'monthly' | 'commission';
  monthly_amount: number;
  commission_percent: number;
  starts_on: string;
  ends_on: string | null;
  settlement_period: SettlementPeriod;
  settlement_days: number;
  min_withdrawal: number;
  rules: string;
  is_active: number;
  created_by: string;
  created_at: string;
  note?: string | null;
}

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const atMidnight = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * The contract that applies to an employee on a given calendar day.
 * `is_active = 0` retires a contract without deleting its history.
 */
export async function activeContract(userId: string, date = iso(new Date())): Promise<Contract | null> {
  const row = await one<Contract>(
    `SELECT * FROM compensation_contracts
     WHERE user_id = ? AND is_active = 1 AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?)
     ORDER BY starts_on DESC LIMIT 1`,
    [userId, date, date],
  );
  return row ?? null;
}

/**
 * Cooperation type of an employee today. Derived from the contract on purpose:
 * there is exactly one place that says "this person earns a percentage".
 */
export async function cooperationType(userId: string, date = iso(new Date())): Promise<CooperationType> {
  const contract = await activeContract(userId, date);
  if (!contract) return 'none';
  return contract.kind === 'commission' ? 'commission' : 'monthly';
}

/** Percentage of office revenue that belongs to this employee, 0 when salaried. */
export async function commissionPercent(userId: string, date = iso(new Date())): Promise<number> {
  const contract = await activeContract(userId, date);
  if (!contract || contract.kind !== 'commission') return 0;
  return Math.max(0, Math.min(100, Number(contract.commission_percent)));
}

/** Per-service commission percent override for one employee, null when unset. */
export async function serviceCommissionOverride(userId: string, serviceId: string): Promise<number | null> {
  const row = await one<{ percent: number }>(
    'SELECT percent FROM staff_service_commissions WHERE user_id = ? AND service_id = ?',
    [userId, serviceId],
  );
  return row ? Math.max(0, Math.min(100, Number(row.percent))) : null;
}

/**
 * Effective commission percent of an employee for a specific service:
 * an explicit per-service override wins over the contract-wide percent.
 * Returns 0 for salaried employees (an override never turns a fixed salary
 * into a percentage contract on its own).
 */
export async function commissionPercentFor(userId: string, serviceId?: string | null, date = iso(new Date())): Promise<number> {
  const contract = await activeContract(userId, date);
  if (!contract || contract.kind !== 'commission') return 0;
  if (serviceId) {
    const override = await serviceCommissionOverride(userId, serviceId);
    if (override !== null) return override;
  }
  return Math.max(0, Math.min(100, Number(contract.commission_percent)));
}

export async function listServicePercents(userId: string) {
  const rows = await q<any>(
    `SELECT sp.service_id, sp.percent, sp.note, sp.updated_at, s.title AS service_title
     FROM staff_service_commissions sp JOIN services s ON s.id = sp.service_id
     WHERE sp.user_id = ? ORDER BY s.title`,
    [userId],
  );
  return rows.map((row) => ({
    serviceId: row.service_id, serviceTitle: row.service_title,
    percent: Number(row.percent), note: row.note ?? null, updatedAt: row.updated_at,
  }));
}

/** Replace the whole override set of one employee (empty array clears it). */
export async function setServicePercents(
  userId: string,
  items: { serviceId: string; percent: number; note?: string | null }[],
  actor: { id: string; name: string },
) {
  return tx(async () => {
    const user = await one<any>("SELECT id FROM users WHERE id = ? AND kind IN ('staff','admin')", [userId]);
    if (!user) throw notFound('کارمند یافت نشد.');
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.serviceId)) throw badRequest('برای هر خدمت فقط یک درصد می‌توانید تعیین کنید.');
      seen.add(item.serviceId);
      if (!Number.isInteger(item.percent) || item.percent < 0 || item.percent > 100) {
        throw badRequest('درصد خدمت باید عدد صحیح بین ۰ تا ۱۰۰ باشد.');
      }
      const service = await one<any>('SELECT id FROM services WHERE id = ?', [item.serviceId]);
      if (!service) throw badRequest('خدمت انتخابی یافت نشد.');
    }
    const ts = nowIso();
    await run('DELETE FROM staff_service_commissions WHERE user_id = ?', [userId]);
    for (const item of items) {
      await run(
        `INSERT INTO staff_service_commissions (user_id, service_id, percent, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, item.serviceId, item.percent, item.note ?? null, actor.id, ts, ts],
      );
    }
    return listServicePercents(userId);
  });
}

export interface RequestEarningPreview {
  /** برآوردی = before any confirmed payment; قطعی = recorded in the ledger. */
  state: 'estimated' | 'finalized';
  /** The viewer's own money in rials — never anybody else's. */
  amount: number;
  /** Effective percent of the office revenue (pool percent when split). */
  percent: number;
  /** Viewer's slice of the pool when a manager-approved split exists. */
  splitSharePercent: number | null;
  officeRevenue: number;
}

/** Floor every slice; the rounding remainder goes to the largest share. */
function allocatePreview(pool: number, shares: { userId: string; sharePercent: number }[]): Map<string, number> {
  const result = new Map<string, number>();
  let allocated = 0;
  let largest: { userId: string; sharePercent: number } | null = null;
  for (const share of shares) {
    const part = Math.floor((pool * share.sharePercent) / 100);
    result.set(share.userId, part);
    allocated += part;
    if (!largest || share.sharePercent > largest.sharePercent) largest = share;
  }
  if (largest && pool - allocated !== 0) {
    result.set(largest.userId, (result.get(largest.userId) ?? 0) + (pool - allocated));
  }
  return result;
}

/**
 * Per-request earnings for ONE viewer, used to print "your share" on staff
 * request cards and the case page. Privacy rules are absolute: fixed-salary
 * staff get an empty map (no money figures anywhere), and a viewer only ever
 * sees their own slice — as assignee, or as a member of an approved split.
 * Recorded ledger rows (finalized) always win over estimates; estimated and
 * finalized are never blended into one number.
 */
export async function earningsByRequest(
  userId: string,
  rows: { id: string; service_id: string; assigned_to: string | null; status: string }[],
): Promise<Map<string, RequestEarningPreview>> {
  const result = new Map<string, RequestEarningPreview>();
  if (!rows.length) return result;
  const contract: any = await activeContract(userId);
  if (!contract || contract.kind !== 'commission') return result;

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const [finalizedRows, shareRows, basisRows] = await Promise.all([
    q<any>(
      `SELECT request_id, COALESCE(SUM(amount),0) AS net, COUNT(*) AS c,
              MAX(CASE WHEN kind='commission' THEN percent END) AS pct,
              MAX(CASE WHEN kind='commission' THEN basis_amount END) AS basis
       FROM compensation_entries
       WHERE user_id = ? AND request_id IN (${placeholders}) AND kind IN ('commission','reversal','adjustment')
       GROUP BY request_id`,
      [userId, ...ids],
    ),
    q<any>(
      `SELECT request_id, user_id, share_percent FROM request_commission_shares WHERE request_id IN (${placeholders})`,
      ids,
    ),
    q<any>(
      `SELECT r.id, r.total, (SELECT COALESCE(SUM(i.total - i.tax),0) FROM invoices i WHERE i.request_id = r.id) AS net_total
       FROM requests r WHERE r.id IN (${placeholders})`,
      ids,
    ),
  ]);
  const finalizedBy = new Map(finalizedRows.map((row) => [row.request_id as string, row]));
  const basisBy = new Map(basisRows.map((row) => [row.id as string, Math.round(Number(row.net_total ?? 0) || Number(row.total ?? 0))]));
  const sharesBy = new Map<string, { userId: string; sharePercent: number }[]>();
  for (const row of shareRows) {
    const list = sharesBy.get(row.request_id) ?? [];
    list.push({ userId: row.user_id, sharePercent: Number(row.share_percent) });
    sharesBy.set(row.request_id, list);
  }

  const percentCache = new Map<string, Promise<number>>();
  const percentFor = (uid: string, serviceId: string) => {
    const key = `${uid}:${serviceId}`;
    if (!percentCache.has(key)) percentCache.set(key, commissionPercentFor(uid, serviceId));
    return percentCache.get(key)!;
  };

  for (const row of rows) {
    const shares = sharesBy.get(row.id) ?? [];
    const ownShare = shares.find((share) => share.userId === userId) ?? null;
    const recorded = finalizedBy.get(row.id);
    if (recorded && Number(recorded.c) > 0) {
      result.set(row.id, {
        state: 'finalized',
        amount: Number(recorded.net),
        percent: Number(recorded.pct ?? 0),
        splitSharePercent: ownShare ? ownShare.sharePercent : null,
        officeRevenue: Number(recorded.basis ?? basisBy.get(row.id) ?? 0),
      });
      continue;
    }
    if (row.status === 'cancelled' || row.status === 'rejected') continue;
    const officeRevenue = basisBy.get(row.id) ?? 0;
    if (officeRevenue <= 0) continue;

    if (shares.length) {
      // Split pool: only members see a figure, sized by the same allocation
      // rule the ledger will use when the payment lands.
      if (!ownShare || !row.assigned_to) continue;
      const poolPercent = await percentFor(row.assigned_to, row.service_id);
      const pool = commissionAmount(officeRevenue, poolPercent);
      if (pool <= 0) continue;
      result.set(row.id, {
        state: 'estimated',
        amount: allocatePreview(pool, shares).get(userId) ?? 0,
        percent: poolPercent,
        splitSharePercent: ownShare.sharePercent,
        officeRevenue,
      });
      continue;
    }

    if (row.assigned_to !== userId) continue;
    const percent = await percentFor(userId, row.service_id);
    if (percent <= 0) continue;
    result.set(row.id, {
      state: 'estimated',
      amount: commissionAmount(officeRevenue, percent),
      percent,
      splitSharePercent: null,
      officeRevenue,
    });
  }
  return result;
}

export interface SettlementPolicy {
  period: SettlementPeriod;
  days: number;
  minWithdrawal: number;
  enabled: boolean;
}

/** Effective withdrawal policy: contract override first, then global settings. */
export async function settlementPolicy(userId?: string): Promise<SettlementPolicy> {
  const contract = userId ? await activeContract(userId) : null;
  const globalPeriod = (await getString('payroll.settlement_period')) as SettlementPeriod;
  const period = (contract?.settlement_period ?? globalPeriod ?? 'weekly') as SettlementPeriod;
  const days = period === 'custom'
    ? Number(contract?.settlement_days || (await getNumber('payroll.settlement_days')) || 7)
    : period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
  const minWithdrawal = Number(contract?.min_withdrawal || (await getNumber('payroll.min_withdrawal')) || 0);
  const enabled = await getString('payroll.withdrawal_enabled') !== 'false';
  return { period, days: Math.max(1, Math.min(365, days)), minWithdrawal: Math.max(0, minWithdrawal), enabled };
}

export interface Window {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD (exclusive)
  /** ISO timestamp from which earnings of this window become withdrawable */
  withdrawableAt: string;
}

/**
 * The settlement window that contains `at`.
 *
 * - daily: calendar day
 * - weekly: 7-day blocks anchored on the contract start date
 * - monthly: calendar month
 * - custom: N-day blocks anchored on the contract start date
 *
 * Anchoring on the contract (not "today") keeps every past window reproducible
 * from data; changing the policy tomorrow cannot move money that was already
 * classified.
 */
export function settlementWindow(policy: SettlementPolicy, at: Date | string, anchor = '2024-01-01'): Window {
  const when = typeof at === 'string' ? new Date(at) : at;
  const date = iso(when);
  if (policy.period === 'monthly') {
    const start = `${date.slice(0, 7)}-01`;
    const endDate = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1));
    return { start, end: iso(endDate), withdrawableAt: `${iso(endDate)}T00:00:00.000Z` };
  }
  if (policy.period === 'daily') {
    const endDate = new Date(atMidnight(date).getTime() + DAY);
    return { start: date, end: iso(endDate), withdrawableAt: `${iso(endDate)}T00:00:00.000Z` };
  }
  const size = Math.max(1, policy.days);
  const anchorMs = atMidnight(anchor).getTime();
  const dayMs = atMidnight(date).getTime();
  const blocks = Math.floor((dayMs - anchorMs) / (size * DAY));
  const startDate = new Date(anchorMs + blocks * size * DAY);
  const endDate = new Date(startDate.getTime() + size * DAY);
  return { start: iso(startDate), end: iso(endDate), withdrawableAt: `${iso(endDate)}T00:00:00.000Z` };
}

/** Office revenue of an invoice: gross, or gross minus the tax the office only collects. */
export function officeRevenueOf(invoice: { total: number; tax: number } | null, paidAmount: number, basis: string): number {
  if (!invoice) return paidAmount;
  const total = Number(invoice.total) || 0;
  const tax = Number(invoice.tax) || 0;
  if (total <= 0) return paidAmount;
  const share = basis === 'gross' ? total : Math.max(0, total - tax);
  // Payments are capped by the invoice; a partial payment earns a proportional share.
  return Math.round((paidAmount * share) / total);
}

/** Commission amount in IRR, rounded once at the end (never per step). */
export function commissionAmount(officeRevenue: number, percent: number): number {
  if (officeRevenue <= 0 || percent <= 0) return 0;
  return Math.round((officeRevenue * percent) / 100);
}

export const todayIso = () => iso(new Date());
export function daysAgoIso(days: number) {
  return new Date(Date.now() - days * DAY).toISOString();
}
export function startOfWeekIso(weekStartsOn = 0) {
  // weekStartsOn uses the same convention as `workforce.week_starts_on` (0 = Saturday).
  const now = new Date();
  const tehran = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', weekday: 'short' }).format(now);
  const map: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };
  const current = map[tehran] ?? 0;
  const delta = (current - weekStartsOn + 7) % 7;
  return new Date(Date.now() - delta * DAY).toISOString();
}
export function startOfMonthIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
