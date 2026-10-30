import { accrueCommission } from '../payroll/service.js';
import { one, q, run, nowIso, tx } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import { badRequest, conflict, notFound, forbidden } from '../../http/errors.js';
import { writeAudit } from '../audit/service.js';

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
export type PaymentStatus = 'pending' | 'confirmed' | 'failed' | 'refunded' | 'cancelled';

export interface InvoiceItem { title: string; qty: number; unitPrice: number; amount: number }

/* -------------------------------- numbering -------------------------------- */

async function nextSequence(scope: string): Promise<number> {
  await run('INSERT INTO invoice_sequences(scope,value) VALUES(?,0) ON CONFLICT(scope) DO NOTHING',[scope]);
  const row = await one<{value:number}>('UPDATE invoice_sequences SET value=value+1 WHERE scope=? RETURNING value',[scope]);
  return Number(row!.value);
}

function fiscalYear(date = new Date()): string {
  // Iranian fiscal year starts ~21 March; approximate by month >= 3 (April+)
  const gy = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 2 ? gy : gy - 1;
  return String(start + 1).slice(-2);
}

export async function nextInvoiceNumber(): Promise<string> {
  const prefix = (await getString('accounting.invoice_prefix')) || 'INV';
  const seq = await nextSequence(`invoice-${new Date().getUTCFullYear()}`);
  return `${prefix}-${fiscalYear()}-${String(seq).padStart(5, '0')}`;
}

/* --------------------------------- ledger ---------------------------------- */

async function addLedgerEntry(input: {
  account: string; direction: 'debit' | 'credit'; amount: number;
  refType?: string; refId?: string; description?: string; date?: string;
}) {
  if (!input.amount) return;
  await run(
    `INSERT INTO ledger_entries (id, entry_date, account, direction, amount, ref_type, ref_id, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id('led'), input.date ?? nowIso(), input.account, input.direction, Math.round(input.amount), input.refType ?? null, input.refId ?? null, input.description ?? null, nowIso()],
  );
}

/* -------------------------------- invoices --------------------------------- */

export interface CreateInvoiceInput {
  customerId: string;
  requestId?: string | null;
  serviceId?: string | null;
  customOfferId?: string | null;
  kind?: 'public' | 'custom';
  title: string;
  items?: InvoiceItem[];
  subtotal?: number;
  discount?: number;
  taxPercent?: number;
  dueAt?: string;
  notes?: string;
  status?: 'draft' | 'issued';
  issue?: boolean;
}

export async function createInvoice(input: CreateInvoiceInput, actor?: { id: string; name: string; ip?: string }) {
  return tx(async () => {
  const items: InvoiceItem[] = Array.isArray(input.items) && input.items.length
    ? input.items.map((i) => ({
      title: String(i.title).slice(0, 200),
      qty: Math.max(1, Number(i.qty ?? 1)),
      unitPrice: Math.max(0, Math.round(Number(i.unitPrice ?? 0))),
      amount: Math.max(0, Math.round(Number(i.qty ?? 1) * Number(i.unitPrice ?? 0))),
    }))
    : [{ title: input.title, qty: 1, unitPrice: Math.max(0, Math.round(Number(input.subtotal ?? 0))), amount: Math.max(0, Math.round(Number(input.subtotal ?? 0))) }];

  const subtotal = Math.max(0, Math.round(items.reduce((sum, i) => sum + i.amount, 0)));
  const discount = Math.min(subtotal, Math.max(0, Math.round(Number(input.discount ?? 0))));
  const taxPercent = input.taxPercent ?? (await getNumber('accounting.tax_percent'));
  const tax = Math.round(((subtotal - discount) * taxPercent) / 100);
  const total = subtotal - discount + tax;
  const ts = nowIso();
  const invoiceId = id('inv');
  const number = await nextInvoiceNumber();
  const status = input.status === 'draft' || input.issue === false ? 'draft' : 'issued';

  await run(
    `INSERT INTO invoices (id, number, customer_id, request_id, service_id, custom_offer_id, kind, title, items,
      subtotal, discount, tax, total, paid_amount, status, due_at, notes, issued_by, issued_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invoiceId, number, input.customerId, input.requestId ?? null, input.serviceId ?? null,
      input.customOfferId ?? null, input.kind ?? 'public', input.title, JSON.stringify(items),
      subtotal, discount, tax, total, status, input.dueAt ?? null, input.notes ?? null,
      actor?.id ?? null, ts, ts, ts,
    ],
  );

  if (status === 'issued' && (await getString('accounting.revenue_recognition')) === 'on_invoice') {
    await addLedgerEntry({
      account: `receivable:${input.customerId}`, direction: 'debit', amount: total,
      refType: 'invoice', refId: invoiceId, description: `صدور فاکتور ${number}`,
    });
    await addLedgerEntry({
      account: `revenue:${input.serviceId ?? 'other'}`, direction: 'credit', amount: total,
      refType: 'invoice', refId: invoiceId, description: `درآمد فاکتور ${number}`,
    });
  }

  if (actor) {
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'invoice.create', entityType: 'invoice',
      entityId: invoiceId, after: { number, total }, ip: actor.ip,
    });
  }

  return getInvoice(invoiceId);
  });
}

export async function getInvoice(invoiceId: string) {
  const row = await one<any>('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!row) return null;
  const payments = await q<any>('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC', [invoiceId]);
  return mapInvoice(row, payments);
}

export function mapInvoice(row: any, payments: any[] = []) {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    requestId: row.request_id,
    serviceId: row.service_id,
    customOfferId: row.custom_offer_id,
    kind: row.kind,
    title: row.title,
    items: JSON.parse(row.items || '[]'),
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    tax: Number(row.tax),
    total: Number(row.total),
    paidAmount: Number(row.paid_amount),
    remaining: Math.max(0, Number(row.total) - Number(row.paid_amount)),
    status: row.status,
    dueAt: row.due_at,
    notes: row.notes,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
    payments: payments.map(mapPayment),
  };
}

export async function listInvoices(params: {
  page?: number; pageSize?: number; customerId?: string; status?: string; kind?: string;
  from?: string; to?: string; search?: string;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
  const where: string[] = [];
  const args: any[] = [];
  if (params.customerId) { where.push('i.customer_id = ?'); args.push(params.customerId); }
  if (params.status) { where.push('i.status = ?'); args.push(params.status); }
  if (params.kind) { where.push('i.kind = ?'); args.push(params.kind); }
  if (params.from) { where.push('i.created_at >= ?'); args.push(params.from); }
  if (params.to) { where.push('i.created_at <= ?'); args.push(params.to); }
  if (params.search) { where.push('(i.number LIKE ? OR i.title LIKE ? OR u.full_name LIKE ?)'); const s = `%${params.search}%`; args.push(s, s, s); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM invoices i JOIN users u ON u.id = i.customer_id ${clause}`, args,
  );
  const rows = await q<any>(
    `SELECT i.*, u.full_name AS customer_name FROM invoices i JOIN users u ON u.id = i.customer_id
     ${clause} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((r) => ({ ...mapInvoice(r), customerName: r.customer_name })),
    total: Number(total?.c ?? 0), page, pageSize,
  };
}

export async function voidInvoice(invoiceId: string, reason: string, actor: { id: string; name: string; ip?: string }) {
  return tx(async () => {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw notFound('فاکتور یافت نشد.');
  if (invoice.status === 'void') throw conflict('این فاکتور قبلاً لغو شده است.');
  const pendingPayment = await one('SELECT id FROM payments WHERE invoice_id = ? AND status = \'pending\' LIMIT 1', [invoiceId]);
  if (pendingPayment) throw conflict('برای این فاکتور پرداختی در انتظار تأیید وجود دارد؛ ابتدا آن را تعیین تکلیف کنید.');
  const confirmedPayment = await one('SELECT id FROM payments WHERE invoice_id = ? AND status = \'confirmed\' LIMIT 1', [invoiceId]);
  if (invoice.paidAmount > 0 || confirmedPayment) {
    throw conflict('ابتدا تمام پرداخت‌های این فاکتور را بازپرداخت کنید؛ لغو فاکتور به‌تنهایی وجه را بازنمی‌گرداند.');
  }
  await run('UPDATE invoices SET status = ?, voided_at = ?, updated_at = ? WHERE id = ?', ['void', nowIso(), nowIso(), invoiceId]);
  if (invoice.status !== 'draft' && (await getString('accounting.revenue_recognition')) === 'on_invoice') {
    await addLedgerEntry({
      account: `revenue:${invoice.serviceId ?? 'other'}`, direction: 'debit', amount: invoice.total,
      refType: 'invoice-void', refId: invoiceId, description: `لغو فاکتور ${invoice.number} — ${reason}`,
    });
    await addLedgerEntry({
      account: `receivable:${invoice.customerId}`, direction: 'credit', amount: invoice.total,
      refType: 'invoice-void', refId: invoiceId, description: `برگشت حساب دریافتنی فاکتور ${invoice.number}`,
    });
  }
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'invoice.void', entityType: 'invoice',
    entityId: invoiceId, after: { reason }, ip: actor.ip,
  });
  });
}

/* -------------------------------- payments --------------------------------- */

export function mapPayment(row: any) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    requestId: row.request_id,
    customerId: row.customer_id,
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    reference: row.reference,
    gateway: row.gateway,
    paidAt: row.paid_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * Register a payment. Online payments start as `pending` and only become
 * revenue after a verified gateway callback (see confirmPayment).
 */
export async function createPayment(input: {
  customerId: string; invoiceId?: string | null; requestId?: string | null;
  amount: number; method: 'online' | 'cash' | 'pos' | 'transfer';
  reference?: string; note?: string; gateway?: string; status?: PaymentStatus;
  confirmedBy?: string;
}, actor?: { id: string; name: string; ip?: string }) {
  return tx(async () => {
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('مبلغ پرداخت معتبر نیست.');

  if (input.invoiceId) {
    await run('UPDATE invoices SET updated_at=updated_at WHERE id=?',[input.invoiceId]);
    const invoice = await getInvoice(input.invoiceId);
    if (!invoice) throw notFound('فاکتور یافت نشد.');
    input.requestId = invoice.requestId ?? input.requestId;
    if(amount>invoice.remaining)throw badRequest('مبلغ بیشتر از مانده فاکتور است.');
    const reserved=await one<any>("SELECT COALESCE(SUM(amount),0) AS amount FROM payments WHERE invoice_id=? AND status='pending'",[invoice.id]);
    if(amount+Number(reserved.amount)>invoice.remaining)throw conflict('مبلغ فاکتور توسط پرداخت در انتظار تأیید رزرو شده است.');
    if (invoice.customerId !== input.customerId) throw forbidden('فاکتور متعلق به این مشتری نیست.');
    if (invoice.status === 'void' || invoice.status === 'draft') throw conflict('فاکتور لغو شده است و پرداخت روی آن مجاز نیست.');
    if (invoice.remaining <= 0 || amount > invoice.remaining) {
      throw badRequest(`مبلغ پرداخت از باقیمانده فاکتور (${invoice.remaining} ریال) بیشتر است.`);
    }
  }

  const ts = nowIso();
  const paymentId = id('pay');
  const status: PaymentStatus = input.status ?? (input.method === 'online' ? 'pending' : 'confirmed');
  await run(
    `INSERT INTO payments (id, invoice_id, request_id, customer_id, amount, method, status, reference, gateway, paid_at, confirmed_by, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentId, input.invoiceId ?? null, input.requestId ?? null, input.customerId, amount, input.method,
      status, input.reference ?? null, input.gateway ?? null,
      status === 'confirmed' ? ts : null, status === 'confirmed' ? actor?.id ?? null : null,
      input.note ?? null, ts, ts,
    ],
  );

  if (status === 'confirmed') await applyConfirmedPayment(paymentId);
  if (actor) {
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'payment.create', entityType: 'payment',
      entityId: paymentId, after: { amount, method: input.method, status }, ip: actor.ip,
    });
  }
  return (await one('SELECT * FROM payments WHERE id = ?', [paymentId]))!;
  });
}

async function refreshRequestPaymentStatus(requestId: string, timestamp = nowIso()) {
  const totals = await one<any>(
    "SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid_amount),0) AS paid FROM invoices WHERE request_id=? AND status NOT IN ('void','draft')",
    [requestId],
  );
  const refunds = await one<any>("SELECT COUNT(*) AS c FROM payments WHERE request_id=? AND status='refunded'", [requestId]);
  const total = Number(totals?.total ?? 0);
  const paid = Number(totals?.paid ?? 0);
  const status = total > 0 && paid >= total ? 'paid' : paid > 0 ? 'partial' : Number(refunds?.c ?? 0) > 0 ? 'refunded' : 'unpaid';
  await run('UPDATE requests SET payment_status = ?, updated_at = ? WHERE id = ?', [status, timestamp, requestId]);
}

/** Applies a verified payment to the invoice, ledger and request state. */
async function applyConfirmedPayment(paymentId: string) {
  const payment = await one<any>('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment || payment.status !== 'confirmed') return;
  const amount = Number(payment.amount);
  const ts = nowIso();

  await tx(async (db) => {
    const operation=await db.run('INSERT INTO financial_operations(operation_key,created_at) VALUES(?,?) ON CONFLICT(operation_key) DO NOTHING',[`payment:${paymentId}`,ts]);
    if(!operation.changes)return;
    const mode = await getString('accounting.revenue_recognition');
    await db.run(
      `INSERT INTO ledger_entries (id, entry_date, account, direction, amount, ref_type, ref_id, description, created_at)
       VALUES (?, ?, ?, 'debit', ?, 'payment', ?, ?, ?)`,
      [id('led'), ts, `cash:${payment.method}`, amount, paymentId, `دریافت وجه (${payment.method})`, ts],
    );
    await db.run(
      `INSERT INTO ledger_entries (id, entry_date, account, direction, amount, ref_type, ref_id, description, created_at)
       VALUES (?, ?, ?, 'credit', ?, 'payment', ?, ?, ?)`,
      [id('led'), ts, mode === 'on_invoice' ? 'receivable' : 'revenue', amount, paymentId, 'ثبت درآمد', ts],
    );

    if (payment.invoice_id) {
      await db.run('UPDATE invoices SET updated_at=updated_at WHERE id=?',[payment.invoice_id]);
      const invoice = await db.one<any>('SELECT * FROM invoices WHERE id = ?', [payment.invoice_id]);
      if (invoice) {
        const paid = Number(invoice.paid_amount) + amount;
        const status = paid >= Number(invoice.total) ? 'paid' : 'partially_paid';
        await db.run('UPDATE invoices SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?', [paid, status, ts, invoice.id]);
        if (invoice.request_id) await refreshRequestPaymentStatus(invoice.request_id, ts);
      }
    } else if (payment.request_id) {
      await db.run('UPDATE requests SET payment_status = ?, updated_at = ? WHERE id = ?', ['paid', ts, payment.request_id]);
    }
    await accrueCommission(paymentId);
  });
}

export async function confirmPayment(paymentId: string, actor: { id: string; name: string; ip?: string }, reference?: string) {
  return tx(async () => {
  const payment = await one<any>('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment) throw notFound('تراکنش یافت نشد.');
  if (payment.status === 'confirmed') return mapPayment(payment);
  if (payment.status !== 'pending') throw conflict('این تراکنش قابل تأیید نیست.');
  if (payment.invoice_id) {
    const invoice = await one<any>('SELECT status FROM invoices WHERE id = ?', [payment.invoice_id]);
    if (!invoice || invoice.status === 'void' || invoice.status === 'draft') throw conflict('فاکتور دیگر قابل پرداخت نیست؛ این تراکنش تأیید نشد.');
  }

  const changed = await run("UPDATE payments SET status='confirmed',paid_at=?,confirmed_by=?,reference=?,updated_at=? WHERE id=? AND status='pending'", [nowIso(),actor.id,reference ?? payment.reference,nowIso(),paymentId]);
  if (!changed.changes) return mapPayment((await one<any>('SELECT * FROM payments WHERE id=?',[paymentId]))!);
  await applyConfirmedPayment(paymentId);
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'payment.confirm', entityType: 'payment',
    entityId: paymentId, after: { amount: payment.amount }, ip: actor.ip,
  });
  return mapPayment((await one('SELECT * FROM payments WHERE id = ?', [paymentId]))!);
  });
}

export async function refundPayment(paymentId: string, reason: string, actor: { id: string; name: string; ip?: string }) {
  return tx(async () => {
  if (!(await getBool('accounting.allow_refund'))) throw badRequest('بازپرداخت در تنظیمات سامانه غیرفعال است.');
  const payment = await one<any>('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment) throw notFound('تراکنش یافت نشد.');
  if (payment.status !== 'confirmed') throw conflict('فقط تراکنش تأییدشده قابل بازپرداخت است.');

  const windowDays = await getNumber('accounting.refund_window_days');
  const paidAt = payment.paid_at ? new Date(payment.paid_at).getTime() : 0;
  if (windowDays > 0 && Date.now() - paidAt > windowDays * 86_400_000) {
    throw badRequest(`مهلت بازپرداخت (${windowDays} روز) به پایان رسیده است.`);
  }

  const changed = await run('UPDATE payments SET status = ?, note = ?, updated_at = ? WHERE id = ? AND status = \'confirmed\'', ['refunded', `${payment.note ?? ''} | بازپرداخت: ${reason}`.trim(), nowIso(), paymentId]);

  if (!changed.changes) throw conflict('بازپرداخت قبلاً ثبت شده است.');
  let requestId = payment.request_id as string | null;
  if (payment.invoice_id) {
    const invoice = await one<any>('SELECT * FROM invoices WHERE id = ?', [payment.invoice_id]);
    if (invoice) {
      const paid = Math.max(0, Number(invoice.paid_amount) - Number(payment.amount));
      const status = paid === 0 ? 'issued' : 'partially_paid';
      await run('UPDATE invoices SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?', [paid, status, nowIso(), invoice.id]);
      requestId = invoice.request_id ?? requestId;
    }
  }
  if (requestId) await refreshRequestPaymentStatus(requestId);
  const recognition = await getString('accounting.revenue_recognition');
  await addLedgerEntry({
    account: recognition === 'on_invoice' ? `receivable:${payment.customer_id}` : `revenue:${(payment.invoice_id ? (await one<any>('SELECT service_id FROM invoices WHERE id=?',[payment.invoice_id]))?.service_id : null) ?? 'other'}`,
    direction: 'debit', amount: Number(payment.amount), refType: 'refund', refId: paymentId,
    description: `برگشت دریافت — ${reason}`,
  });
  await addLedgerEntry({
    account: `cash:${payment.method}`, direction: 'credit', amount: Number(payment.amount),
    refType: 'refund', refId: paymentId, description: `بازپرداخت — ${reason}`,
  });
  await accrueCommission(paymentId,true);
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'payment.refund', entityType: 'payment',
    entityId: paymentId, after: { reason }, ip: actor.ip,
  });
  });
}

export async function listPayments(params: { page?: number; pageSize?: number; customerId?: string; status?: string; method?: string; from?: string; to?: string }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
  const where: string[] = [];
  const args: any[] = [];
  if (params.customerId) { where.push('p.customer_id = ?'); args.push(params.customerId); }
  if (params.status) { where.push('p.status = ?'); args.push(params.status); }
  if (params.method) { where.push('p.method = ?'); args.push(params.method); }
  if (params.from) { where.push('p.created_at >= ?'); args.push(params.from); }
  if (params.to) { where.push('p.created_at <= ?'); args.push(params.to); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM payments p ${clause}`, args);
  const rows = await q<any>(
    `SELECT p.*, u.full_name AS customer_name, i.number AS invoice_number
     FROM payments p JOIN users u ON u.id = p.customer_id LEFT JOIN invoices i ON i.id = p.invoice_id
     ${clause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((r) => ({ ...mapPayment(r), customerName: r.customer_name, invoiceNumber: r.invoice_number })),
    total: Number(total?.c ?? 0), page, pageSize,
  };
}

/* -------------------------------- expenses --------------------------------- */

export async function createExpense(input: {
  title: string; amount: number; categoryId?: string; spentOn?: string; method?: string; reference?: string; note?: string;
}, actor: { id: string; name: string }) {
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('مبلغ هزینه معتبر نیست.');
  const expenseId = id('exp');
  const ts = nowIso();
  await run(
    `INSERT INTO expenses (id, category_id, title, amount, spent_on, method, reference, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [expenseId, input.categoryId ?? null, input.title, amount, input.spentOn ?? ts.slice(0, 10), input.method ?? 'cash', input.reference ?? null, input.note ?? null, actor.id, ts],
  );
  await addLedgerEntry({
    account: `expense:${input.categoryId ?? 'other'}`, direction: 'debit', amount,
    refType: 'expense', refId: expenseId, description: input.title,
  });
  await addLedgerEntry({
    account: `cash:${input.method ?? 'cash'}`, direction: 'credit', amount,
    refType: 'expense', refId: expenseId, description: input.title,
  });
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'expense.create', entityType: 'expense', entityId: expenseId, after: { title: input.title, amount } });
  return expenseId;
}

export async function listExpenses(params: { page?: number; pageSize?: number; from?: string; to?: string; categoryId?: string }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
  const where: string[] = [];
  const args: any[] = [];
  if (params.from) { where.push('e.spent_on >= ?'); args.push(params.from); }
  if (params.to) { where.push('e.spent_on <= ?'); args.push(params.to); }
  if (params.categoryId) { where.push('e.category_id = ?'); args.push(params.categoryId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM expenses e ${clause}`, args);
  const rows = await q<any>(
    `SELECT e.*, c.title AS category_title FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
     ${clause} ORDER BY e.spent_on DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((r) => ({
      id: r.id, title: r.title, amount: Number(r.amount), spentOn: r.spent_on, method: r.method,
      reference: r.reference, note: r.note, categoryId: r.category_id, categoryTitle: r.category_title, createdAt: r.created_at,
    })),
    total: Number(total?.c ?? 0), page, pageSize,
  };
}

export async function expenseCategories() {
  return q('SELECT id, title, sort_order FROM expense_categories WHERE is_active = 1 ORDER BY sort_order');
}

/* --------------------------------- reports --------------------------------- */

export interface ReportRange { from?: string; to?: string }

/**
 * Operational finance summary.
 *
 * revenue      = money actually received (confirmed payments), cash basis
 * invoiced     = value of issued invoices in the range (accrual view)
 * receivable   = invoiced − received
 * expenses     = recorded office expenses
 * operatingProfit = received − expenses
 */
export async function financeSummary(range: ReportRange = {}) {
  const from = range.from ?? '1970-01-01';
  const to = range.to ?? '2999-12-31';

  const received = await one<{ total: number; c: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS c FROM payments
     WHERE status = 'confirmed' AND created_at >= ? AND created_at <= ?`, [from, `${to}T23:59:59.999Z`],
  );
  const refunded = await one<{ total: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status = 'refunded' AND created_at >= ? AND created_at <= ?`,
    [from, `${to}T23:59:59.999Z`],
  );
  const invoiced = await one<{ total: number }>(
    `SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE status <> 'void' AND status <> 'draft' AND created_at >= ? AND created_at <= ?`,
    [from, `${to}T23:59:59.999Z`],
  );
  const unpaid = await one<{ total: number }>(
    `SELECT COALESCE(SUM(total - paid_amount),0) AS total FROM invoices WHERE status IN ('issued','partially_paid')`,
  );
  const expenses = await one<{ total: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE spent_on >= ? AND spent_on <= ?`, [from, to],
  );
  const pending = await one<{ total: number; c: number }>(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS c FROM payments WHERE status = 'pending'`,
  );

  const netReceived = Number(received?.total ?? 0);
  const payroll=await one<any>("SELECT COALESCE(SUM(CASE WHEN kind<>'settlement' THEN amount ELSE 0 END),0) AS accrued,COALESCE(SUM(amount),0) AS liability,COALESCE(SUM(CASE WHEN kind='settlement' THEN -amount ELSE 0 END),0) AS settled FROM compensation_entries WHERE created_at>=? AND created_at<=?",[from,`${to}T23:59:59.999Z`]);
  const opProfit = netReceived - Number(expenses?.total ?? 0) - Number(payroll.accrued);

  return {
    range: { from, to },
    revenue: netReceived,
    grossReceived: Number(received?.total ?? 0) + Number(refunded?.total ?? 0),
    refunded: Number(refunded?.total ?? 0),
    paymentsCount: Number(received?.c ?? 0),
    invoiced: Number(invoiced?.total ?? 0),
    receivable: Number(unpaid?.total ?? 0),
    pendingPayments: { amount: Number(pending?.total ?? 0), count: Number(pending?.c ?? 0) },
    expenses: Number(expenses?.total ?? 0),
    payrollAccrued:Number(payroll.accrued),payrollLiability:Number(payroll.liability),payrollSettled:Number(payroll.settled),
    operatingProfit: opProfit,
    margin: netReceived > 0 ? Math.round((opProfit / netReceived) * 1000) / 10 : 0,
  };
}

export async function revenueByService(range: ReportRange = {}) {
  const from = range.from ?? '1970-01-01';
  const to = range.to ?? '2999-12-31';
  return q<any>(
    `SELECT s.title AS title, COUNT(p.id) AS payment_count, COALESCE(SUM(p.amount),0) AS amount
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN services s ON s.id = i.service_id
     WHERE p.status = 'confirmed' AND p.created_at >= ? AND p.created_at <= ?
     GROUP BY s.title ORDER BY amount DESC LIMIT 50`,
    [from, `${to}T23:59:59.999Z`],
  ).then((rows) => rows.map((r) => ({ title: r.title ?? 'سایر', paymentCount: Number(r.payment_count), amount: Number(r.amount) })));
}

export async function revenueByStaff(range: ReportRange = {}) {
  const from = range.from ?? '1970-01-01';
  const to = range.to ?? '2999-12-31';
  return q<any>(
    `SELECT u.full_name AS name, COUNT(r.id) AS request_count,
            COALESCE(SUM(CASE WHEN p.status = 'confirmed' THEN p.amount ELSE 0 END), 0) AS amount
     FROM requests r
     JOIN users u ON u.id = r.assigned_to
     LEFT JOIN payments p ON p.request_id = r.id
     WHERE r.created_at >= ? AND r.created_at <= ?
     GROUP BY u.full_name ORDER BY amount DESC`,
    [from, `${to}T23:59:59.999Z`],
  ).then((rows) => rows.map((r) => ({ name: r.name, requestCount: Number(r.request_count), amount: Number(r.amount) })));
}

/** Payment reconciliation: gateway logs vs. confirmed payments. */
export async function reconciliation() {
  const pending = await q<any>(`SELECT * FROM payments WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`);
  const failed = await q<any>(`SELECT * FROM payments WHERE status = 'failed' ORDER BY created_at DESC LIMIT 50`);
  const mismatched = await q<any>(
    `SELECT i.id, i.number, i.total, i.paid_amount,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed'), 0) AS actual
     FROM invoices i WHERE i.status <> 'void'
       AND COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed'), 0) <> i.paid_amount
     LIMIT 50`,
  );
  return {
    pending: pending.map(mapPayment),
    failed: failed.map(mapPayment),
    mismatched: mismatched.map((r) => ({
      invoiceId: r.id, number: r.number, total: Number(r.total),
      recorded: Number(r.paid_amount), actual: Number(r.actual),
    })),
  };
}
