/**
 * Discount codes ("کد تخفیف").
 *
 * A code can be previewed while a request is being priced (no state change)
 * and is only redeemed inside the transaction that creates the request, so a
 * rolled-back submission never consumes a use. All amounts are integer IRR.
 *
 * Pricing order (single source of truth in `requests/service.ts`):
 *   base fee + urgent fee − service discount − code discount, then tax.
 * A percentage code applies to the amount after the service discount, is
 * capped by `max_discount` when set, and can never make the total negative.
 */
import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { normalizeDigits } from '../sms/provider.js';

export interface DiscountCodeRow {
  id: string;
  code: string;
  title: string;
  type: 'percent' | 'fixed';
  value: number;
  max_discount: number | null;
  min_amount: number;
  usage_limit: number | null;
  per_customer_limit: number;
  used_count: number;
  service_id: string | null;
  category_id: string | null;
  starts_at: string | null;
  expires_at: string | null;
  is_active: number;
  audience: 'code' | 'all' | 'first_purchase' | 'assigned';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeCode(raw: unknown): string {
  return normalizeDigits(String(raw ?? '')).trim().toUpperCase().replace(/\s+/g, '');
}

export function discountDto(row: DiscountCodeRow & { service_title?: string | null; category_title?: string | null }) {
  const now = nowIso();
  const expired = row.expires_at ? row.expires_at < now : false;
  const exhausted = row.usage_limit !== null && row.used_count >= row.usage_limit;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    type: row.type,
    value: Number(row.value),
    maxDiscount: row.max_discount === null ? null : Number(row.max_discount),
    minAmount: Number(row.min_amount),
    usageLimit: row.usage_limit === null ? null : Number(row.usage_limit),
    perCustomerLimit: Number(row.per_customer_limit),
    usedCount: Number(row.used_count),
    serviceId: row.service_id,
    serviceTitle: row.service_title ?? null,
    categoryId: row.category_id,
    categoryTitle: row.category_title ?? null,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    isActive: Boolean(row.is_active),
    audience: row.audience,
    expired,
    exhausted,
    usable: Boolean(row.is_active) && !expired && !exhausted && (!row.starts_at || row.starts_at <= now),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findByCode(code: string): Promise<DiscountCodeRow | null> {
  return one<DiscountCodeRow>('SELECT * FROM discount_codes WHERE code = ?', [code]);
}

export interface DiscountPreview {
  codeId: string;
  code: string;
  title: string;
  type: 'percent' | 'fixed';
  value: number;
  /** IRR this code takes off the given subtotal. */
  amount: number;
}

/**
 * Validate a code for a customer/service/subtotal and compute the discount.
 * Throws with a customer-readable message for every rejection reason so the
 * checkout can show *why* instead of a generic failure.
 */
export async function previewDiscount(input: {
  code: string;
  customerId: string;
  serviceId: string;
  categoryId?: string | null;
  subtotal: number; // amount after the service discount, before tax
}): Promise<DiscountPreview> {
  const code = normalizeCode(input.code);
  if (!code) throw badRequest('کد تخفیف را وارد کنید.', [{ field: 'discountCode', message: 'کد تخفیف خالی است.' }]);
  const row = await findByCode(code);
  if (!row) throw badRequest('کد تخفیف معتبر نیست.', [{ field: 'discountCode', message: 'این کد یافت نشد.' }]);
  const invalid = (message: string) => badRequest(message, [{ field: 'discountCode', message }]);
  if (!row.is_active) throw invalid('این کد تخفیف غیرفعال است.');
  const now = nowIso();
  if (row.starts_at && row.starts_at > now) throw invalid('زمان استفاده از این کد تخفیف هنوز نرسیده است.');
  if (row.expires_at && row.expires_at < now) throw invalid('مهلت استفاده از این کد تخفیف تمام شده است.');
  if (row.usage_limit !== null && Number(row.used_count) >= Number(row.usage_limit)) {
    throw invalid('ظرفیت استفاده از این کد تخفیف تکمیل شده است.');
  }
  if (row.service_id && row.service_id !== input.serviceId) throw invalid('این کد تخفیف برای خدمت دیگری تعریف شده است.');
  if (row.category_id && row.category_id !== input.categoryId) {
    throw invalid('این کد تخفیف برای دستهٔ دیگری از خدمات تعریف شده است.');
  }
  if (row.audience === 'assigned' && !(await one('SELECT code_id FROM discount_assignments WHERE code_id = ? AND customer_id = ?', [row.id, input.customerId]))) {
    throw invalid('این تخفیف به حساب شما اختصاص داده نشده است.');
  }
  if (row.audience === 'first_purchase' && !(await eligibleForFirstPurchase(input.customerId))) {
    throw invalid('این تخفیف فقط برای اولین خرید است یا قبلاً برای یک درخواست فعال استفاده شده است.');
  }
  if (input.subtotal < Number(row.min_amount)) {
    throw invalid(`برای استفاده از این کد، مبلغ خدمت باید دست‌کم ${Number(row.min_amount)} ریال باشد.`);
  }
  const perCustomer = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM discount_code_usages WHERE code_id = ? AND customer_id = ?',
    [row.id, input.customerId],
  );
  if (Number(perCustomer?.c ?? 0) >= Number(row.per_customer_limit)) {
    throw invalid('شما قبلاً از این کد تخفیف استفاده کرده‌اید.');
  }

  let amount = row.type === 'percent'
    ? Math.floor((input.subtotal * Number(row.value)) / 100)
    : Number(row.value);
  if (row.type === 'percent' && row.max_discount !== null) amount = Math.min(amount, Number(row.max_discount));
  amount = Math.max(0, Math.min(amount, input.subtotal));
  if (amount <= 0) throw invalid('این کد برای مبلغ فعلی تخفیفی ندارد.');
  return { codeId: row.id, code: row.code, title: row.title, type: row.type, value: Number(row.value), amount };
}

/**
 * Consume one use of a code. Must run inside the caller's transaction: the
 * conditional UPDATE re-checks the global limit atomically, so two parallel
 * checkouts can never both take the last use.
 */
export async function redeemDiscount(input: {
  codeId: string;
  customerId: string;
  requestId?: string | null;
  invoiceId?: string | null;
  amount: number;
}): Promise<void> {
  const claimed = await run(
    `UPDATE discount_codes SET used_count = used_count + 1, updated_at = ?
     WHERE id = ? AND is_active = 1 AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [nowIso(), input.codeId],
  );
  if (!claimed.changes) throw conflict('ظرفیت کد تخفیف هم‌زمان تکمیل شد؛ بدون کد دوباره تلاش کنید.');
  await run(
    `INSERT INTO discount_code_usages (id, code_id, customer_id, request_id, invoice_id, amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id('dcu'), input.codeId, input.customerId, input.requestId ?? null, input.invoiceId ?? null, input.amount, nowIso()],
  );
}

/* ---------------------------------- admin --------------------------------- */

export interface DiscountCodeInput {
  code: string;
  title: string;
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount?: number | null;
  minAmount?: number;
  usageLimit?: number | null;
  perCustomerLimit?: number;
  serviceId?: string | null;
  categoryId?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  isActive?: boolean;
  audience?: 'code' | 'all' | 'first_purchase' | 'assigned';
}

function assertValid(input: DiscountCodeInput) {
  const code = normalizeCode(input.code);
  if (code.length < 3 || code.length > 40 || !/^[A-Z0-9._-]+$/.test(code)) {
    throw badRequest('کد باید ۳ تا ۴۰ حرف/عدد لاتین باشد (مثل WELCOME10).');
  }
  if (!input.title?.trim()) throw badRequest('عنوان کد الزامی است.');
  if (input.type === 'percent') {
    if (!Number.isInteger(input.value) || input.value < 1 || input.value > 100) {
      throw badRequest('درصد تخفیف باید بین ۱ تا ۱۰۰ باشد.');
    }
  } else if (!Number.isInteger(input.value) || input.value <= 0) {
    throw badRequest('مبلغ تخفیف ثابت باید عدد صحیح مثبت ریالی باشد.');
  }
  if (input.startsAt && input.expiresAt && input.expiresAt <= input.startsAt) {
    throw badRequest('تاریخ پایان باید بعد از تاریخ شروع باشد.');
  }
  return code;
}

export async function listDiscountCodes(params: { query?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));
  const where: string[] = [];
  const args: any[] = [];
  if (params.query) {
    where.push('(d.code LIKE ? OR d.title LIKE ?)');
    args.push(`%${params.query}%`, `%${params.query}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM discount_codes d ${clause}`, args);
  const rows = await q<any>(
    `SELECT d.*, s.title AS service_title, c.title AS category_title
     FROM discount_codes d
     LEFT JOIN services s ON s.id = d.service_id
     LEFT JOIN service_categories c ON c.id = d.category_id
     ${clause} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(discountDto), total: Number(total?.c ?? 0), page, pageSize };
}

export async function createDiscountCode(input: DiscountCodeInput, actor: { id: string; name: string }) {
  const code = assertValid(input);
  if (await findByCode(code)) throw conflict(`کد «${code}» قبلاً ثبت شده است.`);
  const codeId = id('dsc');
  const ts = nowIso();
  await run(
    `INSERT INTO discount_codes (id, code, title, type, value, max_discount, min_amount, usage_limit,
       per_customer_limit, used_count, service_id, category_id, starts_at, expires_at, is_active, created_by, created_at, updated_at, audience)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      codeId, code, input.title.trim(), input.type, input.value,
      input.type === 'percent' ? (input.maxDiscount ?? null) : null,
      Math.max(0, Math.round(input.minAmount ?? 0)),
      input.usageLimit ?? null,
      Math.max(1, Math.round(input.perCustomerLimit ?? 1)),
      input.serviceId ?? null, input.categoryId ?? null,
      input.startsAt ?? null, input.expiresAt ?? null,
      input.isActive === false ? 0 : 1, actor.name, ts, ts, input.audience ?? 'code',
    ],
  );
  const row = await one<DiscountCodeRow>('SELECT * FROM discount_codes WHERE id = ?', [codeId]);
  return discountDto(row!);
}

export async function updateDiscountCode(codeId: string, input: Partial<DiscountCodeInput>) {
  const existing = await one<DiscountCodeRow>('SELECT * FROM discount_codes WHERE id = ?', [codeId]);
  if (!existing) throw notFound('کد تخفیف یافت نشد.');
  const merged: DiscountCodeInput = {
    code: input.code ?? existing.code,
    title: input.title ?? existing.title,
    type: input.type ?? existing.type,
    value: input.value ?? Number(existing.value),
    maxDiscount: input.maxDiscount !== undefined ? input.maxDiscount : existing.max_discount,
    minAmount: input.minAmount ?? Number(existing.min_amount),
    usageLimit: input.usageLimit !== undefined ? input.usageLimit : existing.usage_limit,
    perCustomerLimit: input.perCustomerLimit ?? Number(existing.per_customer_limit),
    serviceId: input.serviceId !== undefined ? input.serviceId : existing.service_id,
    categoryId: input.categoryId !== undefined ? input.categoryId : existing.category_id,
    startsAt: input.startsAt !== undefined ? input.startsAt : existing.starts_at,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expires_at,
    isActive: input.isActive ?? Boolean(existing.is_active),
    audience: input.audience ?? existing.audience,
  };
  const code = assertValid(merged);
  const clash = await one<{ id: string }>('SELECT id FROM discount_codes WHERE code = ? AND id <> ?', [code, codeId]);
  if (clash) throw conflict(`کد «${code}» قبلاً ثبت شده است.`);
  await run(
    `UPDATE discount_codes SET code = ?, title = ?, type = ?, value = ?, max_discount = ?, min_amount = ?,
       usage_limit = ?, per_customer_limit = ?, service_id = ?, category_id = ?, starts_at = ?, expires_at = ?,
       is_active = ?, updated_at = ?, audience = ? WHERE id = ?`,
    [
      code, merged.title.trim(), merged.type, merged.value,
      merged.type === 'percent' ? (merged.maxDiscount ?? null) : null,
      Math.max(0, Math.round(merged.minAmount ?? 0)), merged.usageLimit ?? null,
      Math.max(1, Math.round(merged.perCustomerLimit ?? 1)),
      merged.serviceId ?? null, merged.categoryId ?? null,
      merged.startsAt ?? null, merged.expiresAt ?? null,
      merged.isActive === false ? 0 : 1, nowIso(), merged.audience ?? 'code', codeId,
    ],
  );
  const row = await one<DiscountCodeRow>('SELECT * FROM discount_codes WHERE id = ?', [codeId]);
  return discountDto(row!);
}

export async function deleteDiscountCode(codeId: string) {
  const existing = await one<DiscountCodeRow>('SELECT * FROM discount_codes WHERE id = ?', [codeId]);
  if (!existing) throw notFound('کد تخفیف یافت نشد.');
  const usages = await one<{ c: number }>('SELECT COUNT(*) AS c FROM discount_code_usages WHERE code_id = ?', [codeId]);
  if (Number(usages?.c ?? 0) > 0) {
    // Codes with history are evidence; deactivate instead of erasing them.
    await run('UPDATE discount_codes SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), codeId]);
    return { deactivated: true };
  }
  await run('DELETE FROM discount_codes WHERE id = ?', [codeId]);
  return { deactivated: false };
}

export async function discountCodeUsages(codeId: string, params: { page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));
  const total = await one<{ c: number }>('SELECT COUNT(*) AS c FROM discount_code_usages WHERE code_id = ?', [codeId]);
  const rows = await q<any>(
    `SELECT u.*, c.full_name AS customer_name, r.tracking_code
     FROM discount_code_usages u
     JOIN users c ON c.id = u.customer_id
     LEFT JOIN requests r ON r.id = u.request_id
     WHERE u.code_id = ? ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [codeId, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((row) => ({
      id: row.id, customerId: row.customer_id, customerName: row.customer_name,
      requestId: row.request_id, trackingCode: row.tracking_code ?? null,
      invoiceId: row.invoice_id, amount: Number(row.amount), createdAt: row.created_at,
    })),
    total: Number(total?.c ?? 0), page, pageSize,
  };
}

/** A first-purchase offer is reserved by an active discounted request; a
 * cancelled/rejected request releases the reservation. Any paid request (even
 * if subsequently cancelled) counts as a purchase. Callers creating requests
 * serialize on the customer row before checking this predicate. */
export async function eligibleForFirstPurchase(customerId: string): Promise<boolean> {
  const paid = await one('SELECT id FROM requests WHERE customer_id = ? AND payment_status = ? LIMIT 1', [customerId, 'paid']);
  if (paid) return false;
  const reservation = await one(`SELECT u.id FROM discount_code_usages u JOIN discount_codes d ON d.id = u.code_id
    JOIN requests r ON r.id = u.request_id WHERE u.customer_id = ? AND d.audience = 'first_purchase'
    AND r.status NOT IN ('cancelled', 'canceled', 'rejected') LIMIT 1`, [customerId]);
  return !reservation;
}

export async function myDiscountCodes(customerId: string) {
  const firstEligible = await eligibleForFirstPurchase(customerId);
  const rows = await q<DiscountCodeRow & { my_uses: number }>(`SELECT d.*,
    (SELECT COUNT(*) FROM discount_code_usages u WHERE u.code_id = d.id AND u.customer_id = ?) AS my_uses
    FROM discount_codes d WHERE d.audience = 'all' OR d.audience = 'first_purchase'
      OR (d.audience = 'assigned' AND EXISTS (SELECT 1 FROM discount_assignments a WHERE a.code_id = d.id AND a.customer_id = ?))
    ORDER BY d.created_at DESC`, [customerId, customerId]);
  return rows.map((row) => {
    const dto = discountDto(row);
    const used = Number(row.my_uses);
    return { ...dto, usedCount: undefined, myUses: used, firstPurchaseEligible: row.audience !== 'first_purchase' || firstEligible,
      usable: dto.usable && used < Number(row.per_customer_limit) && (row.audience !== 'first_purchase' || firstEligible) };
  });
}

export async function assignDiscount(codeId: string, customerId: string, actorId: string) {
  const code = await one<DiscountCodeRow>('SELECT * FROM discount_codes WHERE id = ?', [codeId]);
  if (!code) throw notFound('کد تخفیف یافت نشد.');
  if (code.audience !== 'assigned') throw badRequest('برای تخصیص فردی، مخاطب کد باید «مشتریان انتخاب‌شده» باشد.');
  const customer = await one("SELECT id FROM users WHERE id = ? AND kind = 'customer'", [customerId]);
  if (!customer) throw notFound('مشتری یافت نشد.');
  const result = await run(`INSERT INTO discount_assignments (code_id, customer_id, assigned_by, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT (code_id, customer_id) DO NOTHING`, [codeId, customerId, actorId, nowIso()]);
  return { assigned: Boolean(result.changes) };
}
