/**
 * Shared payroll primitives: cooperation type, the active contract and the
 * settlement window.
 *
 * Every number shown in a dashboard comes from one of these functions plus a
 * database row — there is no synthetic series anywhere in the payroll module.
 */
import { one } from '../../db/index.js';
import { getNumber, getString } from '../settings/service.js';

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
