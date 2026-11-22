/**
 * Customer wallet — an append-only ledger of wallet movements.
 *
 * `wallets.balance` is a cached running total; every change is written together
 * with a `wallet_transactions` row that records the balance before and after the
 * movement. Both rows are written inside one database transaction, so a crash
 * cannot leave money without a receipt (or a receipt without money).
 *
 * Amounts are integer IRR everywhere. There is no floating point arithmetic and
 * no route accepts a balance from the client.
 */
import { one, q, run, nowIso, tx } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { getBool, getNumber } from '../settings/service.js';
import { writeAudit } from '../audit/service.js';
import { logEvent } from '../logging/service.js';

export const WALLET_TYPES = ['topup', 'purchase', 'refund', 'admin_credit', 'gift', 'correction'] as const;
export type WalletType = (typeof WALLET_TYPES)[number];
export type WalletDirection = 'credit' | 'debit';

export const WALLET_TYPE_LABELS: Record<WalletType, string> = {
  topup: 'شارژ از درگاه',
  purchase: 'پرداخت هزینه خدمت',
  refund: 'بازگشت وجه',
  admin_credit: 'شارژ توسط مدیر',
  gift: 'اعتبار هدیه',
  correction: 'اصلاحیه مالی',
};

export interface WalletRow {
  id: string;
  customer_id: string;
  currency: string;
  balance: number;
  status: 'active' | 'frozen';
  created_at: string;
  updated_at: string;
}

function money(value: unknown, field = 'مبلغ'): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) throw badRequest(`${field} باید عدد صحیح ریالی باشد.`);
  if (amount <= 0) throw badRequest(`${field} باید بزرگ‌تر از صفر باشد.`);
  return amount;
}

function mapTransaction(row: any) {
  return {
    id: row.id,
    walletId: row.wallet_id,
    customerId: row.customer_id,
    type: row.type,
    typeLabel: WALLET_TYPE_LABELS[row.type as WalletType] ?? row.type,
    direction: row.direction,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    source: row.source,
    status: row.status,
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    requestId: row.request_id,
    adminId: row.admin_id,
    adminName: row.admin_name,
    reason: row.reason,
    description: row.description,
    trackingCode: row.tracking_code,
    reversesTransactionId: row.reverses_transaction_id,
    createdAt: row.created_at,
  };
}

export async function ensureWallet(customerId: string): Promise<WalletRow> {
  const existing = await one<WalletRow>('SELECT * FROM wallets WHERE customer_id = ?', [customerId]);
  if (existing) return existing;
  const customer = await one('SELECT id, kind FROM users WHERE id = ?', [customerId]);
  if (!customer || customer.kind !== 'customer') throw notFound('مشتری یافت نشد.');
  const ts = nowIso();
  await run(
    `INSERT INTO wallets (id, customer_id, currency, balance, status, created_at, updated_at)
     VALUES (?, ?, 'IRR', 0, 'active', ?, ?)
     ON CONFLICT(customer_id) DO NOTHING`,
    [id('wal'), customerId, ts, ts],
  );
  return (await one<WalletRow>('SELECT * FROM wallets WHERE customer_id = ?', [customerId]))!;
}

export async function walletFor(customerId: string): Promise<WalletRow> {
  return ensureWallet(customerId);
}

export interface WalletSummary {
  id: string;
  customerId: string;
  currency: string;
  balance: number;
  status: string;
  totals: { topup: number; adminCredit: number; gift: number; spent: number; refunded: number; corrections: number };
  counts: { transactions: number; pendingTopups: number };
  enabled: boolean;
  updatedAt: string;
}

export async function walletSummary(customerId: string): Promise<WalletSummary> {
  const wallet = await ensureWallet(customerId);
  const totals = await one<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN type='topup'        AND direction='credit' THEN amount ELSE 0 END),0) AS topup,
       COALESCE(SUM(CASE WHEN type='admin_credit' AND direction='credit' THEN amount ELSE 0 END),0) AS admin_credit,
       COALESCE(SUM(CASE WHEN type='gift'         AND direction='credit' THEN amount ELSE 0 END),0) AS gift,
       COALESCE(SUM(CASE WHEN type='purchase'     AND direction='debit'  THEN amount ELSE 0 END),0) AS spent,
       COALESCE(SUM(CASE WHEN type='refund'       AND direction='credit' THEN amount ELSE 0 END),0) AS refunded,
       COALESCE(SUM(CASE WHEN type='correction' THEN amount ELSE 0 END),0) AS corrections,
       COUNT(*) AS c
     FROM wallet_transactions WHERE wallet_id = ? AND status <> 'reversed'`,
    [wallet.id],
  );
  const pending = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM payments WHERE wallet_id = ? AND purpose='wallet_topup' AND status='pending'",
    [wallet.id],
  );
  return {
    id: wallet.id,
    customerId: wallet.customer_id,
    currency: wallet.currency,
    balance: Number(wallet.balance),
    status: wallet.status,
    totals: {
      topup: Number(totals?.topup ?? 0),
      adminCredit: Number(totals?.admin_credit ?? 0),
      gift: Number(totals?.gift ?? 0),
      spent: Number(totals?.spent ?? 0),
      refunded: Number(totals?.refunded ?? 0),
      corrections: Number(totals?.corrections ?? 0),
    },
    counts: { transactions: Number(totals?.c ?? 0), pendingTopups: Number(pending?.c ?? 0) },
    enabled: await getBool('wallet.enabled'),
    updatedAt: wallet.updated_at,
  };
}

export async function listWalletTransactions(params: {
  customerId?: string; walletId?: string; type?: string; direction?: string; source?: string;
  from?: string; to?: string; search?: string; page?: number; pageSize?: number;
}) {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 25) || 25));
  const where: string[] = [];
  const args: any[] = [];
  if (params.customerId) { where.push('wt.customer_id = ?'); args.push(params.customerId); }
  if (params.walletId) { where.push('wt.wallet_id = ?'); args.push(params.walletId); }
  if (params.type) { where.push('wt.type = ?'); args.push(params.type); }
  if (params.direction) { where.push('wt.direction = ?'); args.push(params.direction); }
  if (params.source) { where.push('wt.source = ?'); args.push(params.source); }
  if (params.from) { where.push('wt.created_at >= ?'); args.push(params.from); }
  if (params.to) {
    where.push('wt.created_at <= ?');
    args.push(/^\d{4}-\d{2}-\d{2}$/.test(String(params.to)) ? `${params.to}T23:59:59.999Z` : params.to);
  }
  if (params.search) {
    where.push('(wt.tracking_code LIKE ? OR wt.description LIKE ? OR wt.reason LIKE ?)');
    const needle = `%${params.search.slice(0, 60)}%`;
    args.push(needle, needle, needle);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM wallet_transactions wt ${clause}`, args);
  const rows = await q<any>(
    `SELECT wt.*, u.full_name AS customer_name FROM wallet_transactions wt
     JOIN users u ON u.id = wt.customer_id
     ${clause} ORDER BY wt.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((row) => ({ ...mapTransaction(row), customerName: row.customer_name })),
    total: Number(total?.c ?? 0), page, pageSize,
  };
}

export async function getWalletTransaction(transactionId: string) {
  const row = await one<any>('SELECT * FROM wallet_transactions WHERE id = ?', [transactionId]);
  return row ? mapTransaction(row) : null;
}

export interface MoveInput {
  customerId: string;
  amount: number;
  direction: WalletDirection;
  type: WalletType;
  source: 'gateway' | 'wallet' | 'admin' | 'system';
  paymentId?: string | null;
  invoiceId?: string | null;
  requestId?: string | null;
  adminId?: string | null;
  adminName?: string | null;
  reason?: string | null;
  description?: string | null;
  idempotencyKey?: string | null;
  reversesTransactionId?: string | null;
  requireActive?: boolean;
}

/**
 * The only way money moves. Must be called inside `tx(...)` together with the
 * business operation it belongs to; the exported helpers below wrap it for the
 * standalone flows (top-up confirmation, admin credit, refunds).
 */
export async function moveMoney(input: MoveInput) {
  const amount = money(input.amount);
  if (input.idempotencyKey) {
    const prior = await one<any>('SELECT * FROM wallet_transactions WHERE idempotency_key = ?', [input.idempotencyKey]);
    if (prior) return { transaction: mapTransaction(prior), applied: false as const };
  }
  const initialWallet = await ensureWallet(input.customerId);
  // Lock and reread before recording before/after balances or enforcing caps.
  await run('UPDATE wallets SET balance=balance WHERE id=?', [initialWallet.id]);
  const wallet = (await one<WalletRow>('SELECT * FROM wallets WHERE id=?', [initialWallet.id]))!;
  if (input.requireActive !== false && wallet.status !== 'active') throw conflict('کیف پول این مشتری مسدود است.');

  const before = Number(wallet.balance);
  let updated: { changes: number };
  if (input.direction === 'credit') {
    const maxBalance = await getNumber('wallet.max_balance');
    if (maxBalance > 0 && before + amount > maxBalance) {
      throw conflict(`موجودی کیف پول از سقف مجاز (${maxBalance.toLocaleString('en-US')} ریال) بیشتر می‌شود.`);
    }
    updated = await run(
      'UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
      [amount, nowIso(), wallet.id],
    );
  } else {
    updated = await run(
      'UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?',
      [amount, nowIso(), wallet.id, amount],
    );
    if (!updated.changes) {
      throw conflict('موجودی کیف پول کافی نیست.', [{
        field: 'wallet', message: `موجودی قابل استفاده: ${before} ریال — مبلغ لازم: ${amount} ریال`,
      }]);
    }
  }
  if (!updated.changes) throw conflict('به‌روزرسانی کیف پول انجام نشد.');

  const after = input.direction === 'credit' ? before + amount : before - amount;
  const transactionId = id('wtx');
  const trackingCode = `WLT-${transactionId.slice(-10).toUpperCase()}`;
  await run(
    `INSERT INTO wallet_transactions (id, wallet_id, customer_id, type, direction, amount, balance_before, balance_after,
       source, status, payment_id, invoice_id, request_id, admin_id, admin_name, reason, description, tracking_code,
       idempotency_key, reverses_transaction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transactionId, wallet.id, input.customerId, input.type, input.direction, amount, before, after,
      input.source, input.paymentId ?? null, input.invoiceId ?? null, input.requestId ?? null,
      input.adminId ?? null, input.adminName ?? null,
      input.reason ? String(input.reason).slice(0, 1000) : null,
      input.description ? String(input.description).slice(0, 500) : null,
      trackingCode, input.idempotencyKey ?? null, input.reversesTransactionId ?? null, nowIso(),
    ],
  );
  if (input.reversesTransactionId) {
    await run("UPDATE wallet_transactions SET status='reversed' WHERE id = ?", [input.reversesTransactionId]);
  }
  const row = await one<any>('SELECT * FROM wallet_transactions WHERE id = ?', [transactionId]);
  return { transaction: mapTransaction(row), applied: true as const };
}

/** Credit the wallet from a verified gateway payment (idempotent per payment). */
export async function creditFromGateway(payment: { id: string; customer_id: string; amount: number }) {
  return tx(async () => {
    const result = await moveMoney({
      customerId: payment.customer_id,
      amount: Number(payment.amount),
      direction: 'credit',
      type: 'topup',
      source: 'gateway',
      paymentId: payment.id,
      idempotencyKey: `topup:${payment.id}`,
      description: 'شارژ کیف پول از درگاه پرداخت',
    });
    if (result.applied) {
      await logEvent({
        level: 'INFO', category: 'wallet', action: 'wallet.topup', result: 'success',
        actorId: payment.customer_id, entityType: 'wallet_transaction', entityId: result.transaction.id,
        transactionId: payment.id, message: 'کیف پول از درگاه شارژ شد.',
        details: { amount: Number(payment.amount), balanceAfter: result.transaction.balanceAfter },
      });
    }
    return result;
  });
}

/** Refund a wallet-funded payment back to the wallet (idempotent per payment). */
export async function refundToWallet(payment: { id: string; customer_id: string; amount: number }) {
  return tx(async () => {
    const result = await moveMoney({
      customerId: payment.customer_id,
      amount: Number(payment.amount),
      direction: 'credit',
      type: 'refund',
      source: 'system',
      paymentId: payment.id,
      idempotencyKey: `refund:${payment.id}`,
      description: 'بازگشت وجه پرداخت کیف پولی',
    });
    if (result.applied) {
      await logEvent({
        level: 'INFO', category: 'wallet', action: 'wallet.refund', result: 'success',
        actorId: payment.customer_id, entityType: 'wallet_transaction', entityId: result.transaction.id,
        transactionId: payment.id, message: 'بازگشت وجه به کیف پول انجام شد.',
        details: { amount: Number(payment.amount) },
      });
    }
    return result;
  });
}

const ADMIN_CREDIT_TYPES: WalletType[] = ['admin_credit', 'gift', 'correction'];

/** Admin credit / gift / correction. Reason is mandatory and audited. */
export async function adminCreditWallet(input: {
  customerId: string;
  amount: number;
  reason: string;
  description?: string;
  type?: WalletType;
  direction?: WalletDirection;
}, actor: { id: string; name: string; role?: string; ip?: string }) {
  const type = input.type ?? 'admin_credit';
  if (!ADMIN_CREDIT_TYPES.includes(type)) throw badRequest('نوع عملیات مدیریتی معتبر نیست.');
  const reason = String(input.reason ?? '').trim();
  if ((await getBool('wallet.admin_credit_requires_reason')) && reason.length < 5) {
    throw badRequest('ثبت دلیل برای شارژ مدیریتی الزامی است (حداقل ۵ نویسه).', [{ field: 'reason', message: 'دلیل عملیات را کامل بنویسید.' }]);
  }
  const amount = money(input.amount);
  const maxCredit = await getNumber('wallet.admin_credit_max');
  if (maxCredit > 0 && type !== 'correction' && amount > maxCredit) {
    throw badRequest(`مبلغ شارژ مدیریتی بیش از سقف مجاز (${maxCredit} ریال) است.`);
  }
  const direction: WalletDirection = input.direction ?? 'credit';
  return tx(async () => {
    const result = await moveMoney({
      customerId: input.customerId,
      amount,
      direction,
      type,
      source: 'admin',
      adminId: actor.id,
      adminName: actor.name,
      reason,
      description: input.description ? String(input.description).slice(0, 500) : null,
    });
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: `wallet.${type}`, entityType: 'wallet',
      entityId: result.transaction.walletId, ip: actor.ip,
      after: {
        transactionId: result.transaction.id, customerId: input.customerId, amount,
        direction, reason, balanceAfter: result.transaction.balanceAfter,
      },
    });
    await logEvent({
      level: 'INFO', category: 'wallet', action: `wallet.${type}`, result: 'success',
      actorId: actor.id, actorName: actor.name, actorRole: actor.role, ip: actor.ip,
      entityType: 'wallet_transaction', entityId: result.transaction.id,
      transactionId: result.transaction.id,
      message: direction === 'credit' ? 'کیف پول مشتری توسط مدیر شارژ شد.' : 'اصلاحیه بدهکار روی کیف پول ثبت شد.',
      details: { customerId: input.customerId, amount, reason, type },
    });
    return result.transaction;
  });
}

/** Corrective entry that reverses a transaction without deleting history. */
export async function reverseWalletTransaction(
  transactionId: string,
  reason: string,
  actor: { id: string; name: string; role?: string; ip?: string },
) {
  if (String(reason ?? '').trim().length < 5) throw badRequest('ثبت دلیل برای اصلاحیه الزامی است.');
  return tx(async () => {
    const original = await one<any>('SELECT * FROM wallet_transactions WHERE id = ?', [transactionId]);
    if (!original) throw notFound('تراکنش کیف پول یافت نشد.');
    if (original.status === 'reversed') throw conflict('این تراکنش قبلاً اصلاح شده است.');
    if (original.type === 'correction') throw badRequest('اصلاحیه را نمی‌توان با اصلاحیه برگرداند.');
    const direction: WalletDirection = original.direction === 'credit' ? 'debit' : 'credit';
    const result = await moveMoney({
      customerId: original.customer_id,
      amount: Number(original.amount),
      direction,
      type: 'correction',
      source: 'admin',
      adminId: actor.id,
      adminName: actor.name,
      reason,
      description: `اصلاحیه تراکنش ${original.tracking_code}`,
      reversesTransactionId: original.id,
      idempotencyKey: `reverse:${original.id}`,
    });
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'wallet.correction', entityType: 'wallet_transaction',
      entityId: original.id, ip: actor.ip,
      after: { correctionId: result.transaction.id, amount: Number(original.amount), direction, reason },
    });
    await logEvent({
      level: 'WARNING', category: 'wallet', action: 'wallet.correction', result: 'success',
      actorId: actor.id, actorName: actor.name, actorRole: actor.role, ip: actor.ip,
      entityType: 'wallet_transaction', entityId: original.id, transactionId: result.transaction.id,
      message: 'اصلاحیه مالی روی تراکنش کیف پول ثبت شد.', details: { reason, amount: Number(original.amount) },
    });
    return result.transaction;
  });
}

/** Wallet custody check: cached balances must equal the immutable ledger. */
export async function walletIntegrity() {
  const rows = await q<any>(
    `SELECT w.id, w.customer_id, w.balance,
            COALESCE((SELECT SUM(CASE WHEN wt.direction='credit' THEN wt.amount ELSE -wt.amount END)
                      FROM wallet_transactions wt WHERE wt.wallet_id = w.id AND wt.status <> 'reversed'), 0) AS ledger
     FROM wallets w`,
  );
  const mismatched = rows
    .filter((r) => Number(r.balance) !== Number(r.ledger))
    .map((r) => ({ walletId: r.id, customerId: r.customer_id, balance: Number(r.balance), ledger: Number(r.ledger) }));
  return {
    ok: mismatched.length === 0,
    wallets: rows.length,
    cachedTotal: rows.reduce((sum, r) => sum + Number(r.balance), 0),
    ledgerTotal: rows.reduce((sum, r) => sum + Number(r.ledger), 0),
    mismatched: mismatched.slice(0, 20),
    mismatchedCount: mismatched.length,
  };
}

export async function walletAdminStats(range: { from?: string; to?: string } = {}) {
  const from = range.from ?? '1970-01-01';
  const to = range.to ? (/^\d{4}-\d{2}-\d{2}$/.test(range.to) ? `${range.to}T23:59:59.999Z` : range.to) : '2999-12-31';
  const totals = await one<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN type='topup'        AND direction='credit' THEN amount ELSE 0 END),0) AS topup,
       COALESCE(SUM(CASE WHEN type='admin_credit' AND direction='credit' THEN amount ELSE 0 END),0) AS admin_credit,
       COALESCE(SUM(CASE WHEN type='gift'         AND direction='credit' THEN amount ELSE 0 END),0) AS gift,
       COALESCE(SUM(CASE WHEN type='purchase'     AND direction='debit'  THEN amount ELSE 0 END),0) AS spent,
       COALESCE(SUM(CASE WHEN type='refund'       AND direction='credit' THEN amount ELSE 0 END),0) AS refunded,
       COALESCE(SUM(CASE WHEN type='correction'   AND direction='credit' THEN amount ELSE 0 END),0) AS correction_credit,
       COALESCE(SUM(CASE WHEN type='correction'   AND direction='debit'  THEN amount ELSE 0 END),0) AS correction_debit,
       COUNT(*) AS c
     FROM wallet_transactions WHERE created_at >= ? AND created_at <= ? AND status <> 'reversed'`,
    [from, to],
  );
  const wallets = await one<any>(
    'SELECT COUNT(*) AS c, COALESCE(SUM(balance),0) AS total, COALESCE(SUM(CASE WHEN balance>0 THEN 1 ELSE 0 END),0) AS funded FROM wallets',
  );
  return {
    topup: Number(totals?.topup ?? 0),
    adminCredit: Number(totals?.admin_credit ?? 0),
    gift: Number(totals?.gift ?? 0),
    spent: Number(totals?.spent ?? 0),
    refunded: Number(totals?.refunded ?? 0),
    corrections: { credit: Number(totals?.correction_credit ?? 0), debit: Number(totals?.correction_debit ?? 0) },
    transactionCount: Number(totals?.c ?? 0),
    wallets: { count: Number(wallets?.c ?? 0), withBalance: Number(wallets?.funded ?? 0), custody: Number(wallets?.total ?? 0) },
  };
}

/** Guard used by customer-facing payment endpoints. */
export async function assertWalletUsable(customerId: string) {
  if (!(await getBool('wallet.enabled'))) throw forbidden('کیف پول در حال حاضر غیرفعال است.');
  const wallet = await ensureWallet(customerId);
  if (wallet.status !== 'active') throw forbidden('کیف پول شما مسدود است؛ با پشتیبانی تماس بگیرید.');
  return wallet;
}

/** Top-up limits read from settings. */
export async function topUpLimits() {
  const min = await getNumber('wallet.min_topup');
  const max = await getNumber('wallet.max_topup');
  return { min, max };
}
