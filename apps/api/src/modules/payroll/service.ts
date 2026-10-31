import { one, q, run, tx, nowIso, jsonParse } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import { writeAudit } from '../audit/service.js';
import { logEvent } from '../logging/service.js';
import {
  activeContract, commissionAmount, officeRevenueOf, settlementPolicy, settlementWindow,
  type SettlementPeriod,
} from './compensation.js';

/**
 * Contracts and the append-only compensation ledger.
 *
 * Rules kept from the previous version (they were correct and tested):
 *  - commission is computed from the office revenue of the invoice, server side
 *  - the ledger is append-only; refunds add a reversal, never an edit
 *  - salary months are idempotent through `operation_key`
 *  - a settlement can never exceed the current balance
 *
 * Added in 1.4.0:
 *  - commission entries store basis, percent, settlement window and the moment
 *    they become withdrawable, so a later contract change cannot rewrite them
 *  - salary/percentage history is the date-ranged contract list itself
 */
export async function compensation(userId: string) {
  const contracts = await q<any>('SELECT * FROM compensation_contracts WHERE user_id=? ORDER BY starts_on DESC', [userId]);
  const entries = await q<any>('SELECT * FROM compensation_entries WHERE user_id=? ORDER BY created_at DESC LIMIT 500', [userId]);
  const sum = await one<any>(
    `SELECT COALESCE(SUM(amount),0) AS balance,
            COALESCE(SUM(CASE WHEN kind<>'settlement' THEN amount ELSE 0 END),0) AS accrued,
            COALESCE(SUM(CASE WHEN kind='settlement' THEN -amount ELSE 0 END),0) AS settled
     FROM compensation_entries WHERE user_id=?`, [userId],
  );
  return {
    contracts, entries,
    balance: Number(sum.balance), accrued: Number(sum.accrued), settled: Number(sum.settled),
  };
}

/** Contract history in a shape the UI can render as "salary/percentage over time". */
export async function contractHistory(userId: string) {
  const rows = await q<any>('SELECT * FROM compensation_contracts WHERE user_id=? ORDER BY starts_on DESC', [userId]);
  return rows.map((row) => ({
    id: row.id, kind: row.kind, monthlyAmount: Number(row.monthly_amount),
    commissionPercent: Number(row.commission_percent), startsOn: row.starts_on, endsOn: row.ends_on,
    settlementPeriod: row.settlement_period, settlementDays: Number(row.settlement_days),
    minWithdrawal: Number(row.min_withdrawal), isActive: Boolean(row.is_active),
    note: row.note ?? null, createdBy: row.created_by, createdAt: row.created_at,
  }));
}

/**
 * Accrue (or reverse) the commission share of a confirmed payment.
 *
 * The share belongs to the employee the request was assigned to at the moment
 * of payment — moving a request later never moves money that was already
 * accrued, and the snapshot keeps the contract that was in force.
 */
export async function accrueCommission(paymentId: string, reverse = false) {
  return tx(async () => {
    const payment = await one<any>('SELECT * FROM payments WHERE id=?', [paymentId]);
    if (!payment) return null;
    if (reverse) {
      const originals = await q<any>("SELECT * FROM compensation_entries WHERE payment_id=? AND kind='commission'", [paymentId]);
      const reversed: string[] = [];
      for (const e of originals) {
        const already = await one<any>('SELECT id FROM compensation_entries WHERE operation_key=?', [`refund:${e.operation_key}`]);
        if (already) continue;
        await append({
          ...e, id: id('comp'), operation_key: `refund:${e.operation_key}`, kind: 'reversal',
          amount: -Number(e.amount), basis_amount: Number(e.basis_amount), percent: Number(e.percent),
          withdrawable_at: nowIso(), period_start: e.period_start, period_end: e.period_end,
          created_by: 'system', created_at: nowIso(), note: 'برگشت سهم پس از بازپرداخت',
        });
        reversed.push(e.id);
      }
      return reversed.length ? { reversed: reversed.length } : null;
    }
    if (payment.status !== 'confirmed' || !payment.request_id) return null;
    const request = await one<any>('SELECT * FROM requests WHERE id=?', [payment.request_id]);
    if (!request?.assigned_to) return null;
    const paidAt = String(payment.paid_at ?? nowIso());
    const date = paidAt.slice(0, 10);
    const contract = await activeContract(request.assigned_to, date);
    if (!contract || contract.kind !== 'commission') return null;
    const percent = Math.max(0, Math.min(100, Number(contract.commission_percent)));
    if (percent <= 0) return null;

    const invoice = payment.invoice_id
      ? await one<any>('SELECT total,tax FROM invoices WHERE id=?', [payment.invoice_id])
      : null;
    const basisSetting = await getString('payroll.commission_basis');
    const officeRevenue = officeRevenueOf(invoice, Number(payment.amount), basisSetting || 'net_of_tax');
    const amount = commissionAmount(officeRevenue, percent);
    if (amount <= 0) return null;

    const policy = await settlementPolicy(request.assigned_to);
    const window = settlementWindow(policy, paidAt, contract.starts_on);
    await append({
      id: id('comp'), operation_key: `commission:${paymentId}:${request.assigned_to}`,
      user_id: request.assigned_to, contract_id: contract.id, kind: 'commission', amount,
      basis_amount: officeRevenue, percent, withdrawable_at: window.withdrawableAt,
      period_start: window.start, period_end: window.end,
      payment_id: paymentId, request_id: request.id,
      snapshot: JSON.stringify({
        contract: { id: contract.id, percent, kind: contract.kind },
        invoice: invoice ? { total: Number(invoice.total), tax: Number(invoice.tax) } : null,
        paidAmount: Number(payment.amount), basis: basisSetting || 'net_of_tax',
        officeRevenue, percent, period: window,
      }),
      created_by: 'system', created_at: nowIso(),
    });
    return { amount, basis: officeRevenue, percent };
  });
}

async function append(e: any) {
  await run(
    `INSERT INTO compensation_entries
       (id,operation_key,user_id,contract_id,kind,amount,period,payment_id,request_id,snapshot,note,created_by,created_at,
        basis_amount,percent,withdrawable_at,withdrawal_id,period_start,period_end,salary_payment_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(operation_key) DO NOTHING`,
    [
      e.id, e.operation_key, e.user_id, e.contract_id ?? null, e.kind, e.amount, e.period ?? null,
      e.payment_id ?? null, e.request_id ?? null, e.snapshot ?? '{}', e.note ?? null, e.created_by, e.created_at,
      e.basis_amount ?? 0, e.percent ?? 0, e.withdrawable_at ?? null, e.withdrawal_id ?? null,
      e.period_start ?? null, e.period_end ?? null, e.salary_payment_id ?? null,
    ],
  );
}

export interface ContractInput {
  userId: string;
  kind: 'monthly' | 'commission';
  monthlyAmount: number;
  commissionPercent: number;
  startsOn: string;
  endsOn?: string;
  settlementPeriod?: SettlementPeriod;
  settlementDays?: number;
  minWithdrawal?: number;
  note?: string;
}

export async function createContract(input: ContractInput, actorId: string, actorName = 'سیستم') {
  return tx(async () => {
    const user = await one<any>("SELECT * FROM users WHERE id=? AND kind IN ('staff','admin')", [input.userId]);
    if (!user) throw badRequest('کارمند یافت نشد.');
    if (input.endsOn && input.endsOn < input.startsOn) throw badRequest('پایان قرارداد پیش از شروع است.');
    if (input.kind === 'commission' && (input.commissionPercent < 0 || input.commissionPercent > 100)) {
      throw badRequest('درصد همکاری باید بین ۰ تا ۱۰۰ باشد.');
    }
    const overlaps = await one<any>(
      'SELECT id FROM compensation_contracts WHERE user_id=? AND kind=? AND is_active=1 AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)',
      [user.id, input.kind, input.endsOn ?? '9999-12-31', input.startsOn],
    );
    if (overlaps) {
      throw conflict('قرارداد فعال هم‌پوشان وجود دارد. ابتدا قرارداد قبلی را ببندید، سپس قرارداد جدید را ثبت کنید.');
    }
    const contractId = id('contract');
    const now = nowIso();
    await run(
      `INSERT INTO compensation_contracts
         (id,user_id,kind,monthly_amount,commission_percent,starts_on,ends_on,created_by,created_at,
          settlement_period,settlement_days,min_withdrawal,rules,is_active,note,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        contractId, user.id, input.kind, input.monthlyAmount, input.commissionPercent,
        input.startsOn, input.endsOn ?? null, actorId, now,
        input.settlementPeriod ?? 'monthly', input.settlementDays ?? 0, input.minWithdrawal ?? 0,
        '{}', 1, input.note ?? null, now,
      ],
    );
    await writeAudit({
      actorId, actorName, action: 'payroll.contract.create', entityType: 'compensation_contract',
      entityId: contractId, after: { ...input },
    });
    await logEvent({
      level: 'INFO', category: 'staff', action: 'payroll.contract.create', result: 'success',
      actorId, message: `قرارداد ${input.kind === 'commission' ? 'درصدی' : 'حقوق ثابت'} ثبت شد.`,
      details: { userId: user.id, percent: input.commissionPercent, monthlyAmount: input.monthlyAmount },
    });
    return { id: contractId };
  });
}

/** Close an open contract on a date without deleting anything. */
export async function closeContract(contractId: string, endsOn: string, actor: { id: string; name: string }) {
  return tx(async () => {
    const contract = await one<any>('SELECT * FROM compensation_contracts WHERE id=?', [contractId]);
    if (!contract) throw notFound('قرارداد یافت نشد.');
    if (contract.is_active === 0) return { id: contractId, alreadyClosed: true };
    if (endsOn < contract.starts_on) throw badRequest('تاریخ پایان نمی‌تواند پیش از شروع قرارداد باشد.');
    const now = nowIso();
    await run('UPDATE compensation_contracts SET ends_on=?, is_active=0, updated_at=? WHERE id=?', [endsOn, now, contractId]);
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'payroll.contract.close', entityType: 'compensation_contract',
      entityId: contractId, before: { endsOn: contract.ends_on, isActive: contract.is_active }, after: { endsOn },
    });
    return { id: contractId, endsOn };
  });
}

/** Explicit Gregorian month; partial contracts prorated by calendar days. No hidden scheduler. */
export async function accrueMonth(month: string, actorId: string) {
  return tx(async () => {
    const start = `${month}-01`;
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const days = Number(end.slice(8));
    const contracts = await q<any>(
      "SELECT * FROM compensation_contracts WHERE kind='monthly' AND is_active=1 AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)",
      [end, start],
    );
    let created = 0;
    for (const c of contracts) {
      const first = c.starts_on > start ? c.starts_on : start;
      const last = c.ends_on && c.ends_on < end ? c.ends_on : end;
      const covered = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;
      const amount = Math.round((Number(c.monthly_amount) * covered) / days);
      if (amount <= 0) continue;
      const exists = await one<any>('SELECT id FROM compensation_entries WHERE operation_key=?', [`salary:${c.id}:${month}`]);
      if (exists) continue;
      const policy = await settlementPolicy(c.user_id);
      const window = settlementWindow(policy, `${start}T00:00:00.000Z`, c.starts_on);
      await append({
        id: id('comp'), operation_key: `salary:${c.id}:${month}`, user_id: c.user_id, contract_id: c.id,
        kind: 'salary', amount, period: month,
        basis_amount: Number(c.monthly_amount), percent: 0,
        withdrawable_at: `${last}T00:00:00.000Z`, period_start: window.start, period_end: window.end,
        snapshot: JSON.stringify({ contract: c, covered, days, amount }), created_by: actorId, created_at: nowIso(),
      });
      created += 1;
    }
    return { month, contracts: contracts.length, created };
  });
}

/**
 * Record a settlement (money actually paid out) against the current balance.
 * The ledger entry is append-only and idempotent through the caller's key.
 */
export async function settle(userId: string, amount: number, key: string, note: string, actorId: string) {
  return tx(async () => {
    await run('UPDATE users SET updated_at=updated_at WHERE id=?', [userId]);
    const existing = await one<any>('SELECT * FROM compensation_entries WHERE operation_key=?', [`settlement:${key}`]);
    if (existing) {
      if (existing.user_id !== userId || Number(existing.amount) !== -amount) throw conflict('کلید تکرار با مبلغ متفاوت ارسال شده است.');
      return compensation(userId);
    }
    const state = await compensation(userId);
    if (amount > state.balance) throw badRequest('مبلغ تسویه بیشتر از مانده قابل پرداخت است.');
    await append({
      id: id('comp'), operation_key: `settlement:${key}`, user_id: userId, kind: 'settlement',
      amount: -amount, note, created_by: actorId, created_at: nowIso(),
      withdrawal_id: null,
    });
    return compensation(userId);
  });
}

/** Snapshot of the contract used for a request's commission, for the staff file. */
export async function contractForRequest(requestId: string) {
  const entry = await one<any>(
    "SELECT * FROM compensation_entries WHERE request_id=? AND kind='commission' ORDER BY created_at DESC LIMIT 1",
    [requestId],
  );
  return entry ? { entry, snapshot: jsonParse<any>(entry.snapshot, {}) } : null;
}

export { getBool, getNumber, getString };
