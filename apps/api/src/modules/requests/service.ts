import { tehranNow } from '../../lib/tehran-time.js';
import { one, q, run, nowIso, addHours, jsonParse, jsonStringify, tx } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import { getServiceById, finalFee, type ServiceDTO } from '../catalog/service.js';
import { createInvoice } from '../accounting/service.js';
import { writeAudit } from '../audit/service.js';
import { toPersianDigits } from '../../lib/text.js';

import { requireCompleteProfile, requireCoverage, validNationalId } from '../profiles/service.js';

export const STATUSES = [
  'new', 'assigned', 'in_progress', 'waiting_documents', 'waiting_customer',
  'under_review', 'ready', 'completed', 'cancelled', 'rejected',
] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  new: 'جدید',
  assigned: 'ارجاع‌شده',
  in_progress: 'در حال انجام',
  waiting_documents: 'در انتظار مدارک',
  waiting_customer: 'در انتظار پاسخ مشتری',
  under_review: 'در حال بررسی',
  ready: 'آماده تحویل',
  completed: 'تکمیل‌شده',
  cancelled: 'لغو‌شده',
  rejected: 'رد‌شده',
};

const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ['assigned', 'in_progress', 'cancelled', 'rejected'],
  assigned: ['in_progress', 'waiting_documents', 'waiting_customer', 'cancelled', 'rejected'],
  in_progress: ['waiting_documents', 'waiting_customer', 'under_review', 'ready', 'completed', 'cancelled', 'rejected'],
  waiting_documents: ['in_progress', 'under_review', 'cancelled', 'rejected'],
  waiting_customer: ['in_progress', 'under_review', 'cancelled', 'rejected'],
  under_review: ['in_progress', 'ready', 'completed', 'cancelled', 'rejected'],
  ready: ['completed', 'in_progress'],
  completed: [],
  cancelled: [],
  rejected: [],
};

export interface RequestRow {
  id: string;
  tracking_code: string;
  customer_id: string;
  service_id: string;
  assigned_to: string | null;
  status: RequestStatus;
  priority: string;
  form_data: string;
  snapshot: string;
  fee: number;
  discount: number;
  total: number;
  payment_method: string;
  payment_status: string;
  current_step: number;
  due_at: string | null;
  rejected_reason: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/* -------------------------------- helpers --------------------------------- */

async function generateTrackingCode(): Promise<string> {
  const prefix = (await getString('services.request_number_prefix')) || 'PK';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = `${prefix}-${new Date().getFullYear()}${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await one('SELECT id FROM requests WHERE tracking_code = ?', [code]);
    if (!exists) return code;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const index = '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(digit);
    return String(index % 10);
  });
}

/** Validate submitted form data against the service's dynamic schema. */
export function validateFormData(service: ServiceDTO, raw: Record<string, unknown>) {
  const errors: { field: string; message: string }[] = [];
  const clean: Record<string, unknown> = {};
  for (const field of service.form) {
    const value = raw?.[field.key];
    const isEmpty = value === undefined || value === null || String(value).trim() === '';
    if ((field.required ?? false) && isEmpty) {
      errors.push({ field: field.key, message: `«${field.label}» الزامی است.` });
      continue;
    }
    if (isEmpty) continue;
    if (field.type === 'checkbox' && (field.required ?? false) && !(value === true || value === 'true' || value === 'on' || value === 1)) {
      errors.push({ field: field.key, message: `«${field.label}» باید تأیید شود.` });
      continue;
    }

    switch (field.type) {
      case 'national_id': {
        const normalized = normalizeDigits(String(value));
        const digits = normalized.replace(/\D/g, '');
        if (!/^[0-9\s-]+$/.test(normalized) || !validNationalId(digits)) errors.push({ field: field.key, message: 'کد ملی معتبر نیست.' });
        else clean[field.key] = digits;
        break;
      }
      case 'tel': {
        const normalized = normalizeDigits(String(value));
        const digits = normalized.replace(/\D/g, '');
        if (!/^[0-9+()\s-]+$/.test(normalized) || digits.length < 8 || digits.length > 15) errors.push({ field: field.key, message: 'شماره تماس معتبر نیست.' });
        else clean[field.key] = digits;
        break;
      }
      case 'number':
      case 'money': {
        const numeric = String(value)
          .replace(/[۰-۹٠-٩]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d) % 10))
          .replace(/[٬,،\s]/g, '')
          .replace('٫', '.');
        if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(numeric)) {
          errors.push({ field: field.key, message: 'مقدار عددی معتبر نیست.' });
        } else {
          const n = Number(numeric);
          if (!Number.isFinite(n)) errors.push({ field: field.key, message: 'مقدار عددی معتبر نیست.' });
          else clean[field.key] = n;
        }
        break;
      }
      case 'iban': {
        const iban = String(value).toUpperCase().replace(/\s/g, '');
        const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
        let remainder = 0;
        for (const character of rearranged) {
          const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
          for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
        }
        if (!/^IR\d{24}$/.test(iban) || remainder !== 1) errors.push({ field: field.key, message: 'شماره شبای واردشده معتبر نیست.' });
        else clean[field.key] = iban;
        break;
      }
      case 'postal_code': {
        const normalized = normalizeDigits(String(value));
        const code = normalized.replace(/\D/g, '');
        if (!/^[0-9\s-]+$/.test(normalized) || code.length !== 10) errors.push({ field: field.key, message: 'کد پستی باید ۱۰ رقم باشد.' });
        else clean[field.key] = code;
        break;
      }
      case 'checkbox':
        clean[field.key] = value === true || value === 'true' || value === 'on' || value === 1;
        break;
      case 'select':
      case 'radio':
        if (field.options?.length && !field.options.includes(String(value))) {
          errors.push({ field: field.key, message: 'گزینه انتخابی معتبر نیست.' });
        } else clean[field.key] = String(value);
        break;
      default:
        clean[field.key] = String(value).slice(0, 5000);
    }
  }
  if (errors.length) throw badRequest('اطلاعات فرم کامل یا معتبر نیست.', errors);
  return clean;
}

/* ------------------------------- assignment -------------------------------- */

async function onShiftToday(userId: string): Promise<boolean> {
  const clock=tehranNow();
  const row=await one(`SELECT s.id FROM shifts s JOIN attendance a ON a.shift_id=s.id AND a.user_id=s.user_id WHERE s.user_id=? AND s.shift_date=? AND s.status='scheduled' AND s.start_time<=? AND s.end_time>? AND a.check_in IS NOT NULL AND a.check_out IS NULL LIMIT 1`,[userId,clock.date,clock.time,clock.time]);
  return Boolean(row);
}

async function activeLoad(userId: string): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM requests WHERE assigned_to = ? AND status NOT IN ('completed','cancelled','rejected')`,
    [userId],
  );
  return Number(row?.c ?? 0);
}

/** Candidate staff for a service, ordered by the configured strategy. */
export async function candidatesForService(service: ServiceDTO): Promise<{ id: string; name: string; load: number; onShift: boolean }[]> {
  const rule = await one<any>('SELECT * FROM assignment_rules WHERE service_id = ? AND is_active = 1', [service.id]);
  const explicitIds: string[] = jsonParse<string[]>(rule?.staff_ids, []);
  const strategy: string = rule?.strategy ?? (await getString('services.auto_assign_strategy')) ?? 'least_loaded';
  const maxLoad = Number(rule?.max_load) > 0 ? Number(rule.max_load) : await getNumber('services.max_active_cases_per_staff');

  let staffRows: any[] = [];
  if (strategy === 'fixed') {
    if (!explicitIds.length) return [];
    staffRows = await q<any>(
      `SELECT u.id, u.full_name, sp.max_active_cases, sp.accepts_new_cases, sp.specialties
       FROM users u
       JOIN staff_profiles sp ON sp.user_id = u.id
       JOIN roles r ON r.id = u.role_id
       WHERE u.id IN (${explicitIds.map(() => '?').join(',')})
         AND u.kind = 'staff' AND u.status = 'active' AND sp.accepts_new_cases = 1
         AND r.code IN ('service_expert','operator','manager')`, explicitIds,
    );
  } else {
    staffRows = await q<any>(
      `SELECT u.id, u.full_name, sp.max_active_cases, sp.accepts_new_cases, sp.specialties
       FROM users u
       JOIN staff_profiles sp ON sp.user_id = u.id
       JOIN roles r ON r.id = u.role_id
       WHERE u.kind = 'staff' AND u.status = 'active' AND sp.accepts_new_cases = 1
         AND r.code IN ('service_expert','operator','manager')`,
    );
    const linked = await q<{ user_id: string }>('SELECT user_id FROM service_staff WHERE service_id = ?', [service.id]);
    if (linked.length) {
      const linkedIds = new Set(linked.map((l) => l.user_id));
      staffRows = staffRows.filter((s) => linkedIds.has(s.id));
    } else if (service.categorySlug) {
      const specialists = staffRows.filter((s) => {
        const specialties = jsonParse<string[]>(s.specialties, []);
        return specialties.length === 0 || specialties.includes(service.categorySlug!) || specialties.includes(service.categoryId ?? '');
      });
      if (specialists.length) staffRows = specialists;
    }
  }

  const requireShift = await getBool('workforce.auto_assign_on_shift');
  const candidates: { id: string; name: string; load: number; onShift: boolean }[] = [];
  for (const row of staffRows) {
    const load = await activeLoad(row.id);
    const limit = Number(row.max_active_cases) > 0 ? Math.min(Number(row.max_active_cases), maxLoad) : maxLoad;
    if (load >= limit) continue;
    const onShift = await onShiftToday(row.id);
    if (requireShift && !onShift) continue;
    candidates.push({ id: row.id, name: row.full_name, load, onShift });
  }

  if (strategy === 'least_loaded') candidates.sort((a, b) => a.load - b.load || Number(b.onShift) - Number(a.onShift));
  else if (strategy === 'round_robin' && candidates.length) {
    const assigned = await q<any>(
      `SELECT assigned_to, MAX(assigned_at) AS last_assigned_at FROM requests
       WHERE service_id = ? AND assigned_to IN (${candidates.map(() => '?').join(',')})
       GROUP BY assigned_to`, [service.id, ...candidates.map((candidate) => candidate.id)],
    );
    const lastAssigned = new Map(assigned.map((row) => [row.assigned_to, row.last_assigned_at ?? '']));
    candidates.sort((a, b) => String(lastAssigned.get(a.id) ?? '').localeCompare(String(lastAssigned.get(b.id) ?? '')) || a.id.localeCompare(b.id));
  } else if (strategy === 'fixed') candidates.sort((a, b) => explicitIds.indexOf(a.id) - explicitIds.indexOf(b.id));

  return candidates;
}

export async function autoAssign(requestId: string): Promise<string | null> {
  if (!(await getBool('services.auto_assign'))) return null;
  const request = await one<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request || request.assigned_to) return null;
  const service = await getServiceById(request.service_id);
  if (!service) return null;
  const rule = await one<any>('SELECT strategy FROM assignment_rules WHERE service_id = ? AND is_active = 1', [service.id]);
  const strategy = rule?.strategy ?? (await getString('services.auto_assign_strategy')) ?? 'least_loaded';
  if (strategy === 'queue') return null;

  const candidates = await candidatesForService(service);
  const chosen = candidates[0];
  if (!chosen) return null;

  const assignedAt = nowIso();
  await run('UPDATE requests SET assigned_to = ?, assigned_at = ?, status = ?, updated_at = ? WHERE id = ?', [chosen.id, assignedAt, 'assigned', assignedAt, requestId]);
  await addEvent({
    requestId, type: 'assigned', message: `پرونده به ${chosen.name} ارجاع شد.`,
    fromStatus: request.status, toStatus: 'assigned',
  });
  return chosen.id;
}

/* --------------------------------- events ---------------------------------- */

export async function addEvent(input: {
  requestId: string; type: string; message?: string; actorId?: string; actorName?: string;
  fromStatus?: string; toStatus?: string; metadata?: unknown; visibleToCustomer?: boolean;
}) {
  const eventId = id('evt');
  await run(
    `INSERT INTO request_events (id, request_id, actor_id, actor_name, type, message, from_status, to_status, metadata, visible_to_customer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId, input.requestId, input.actorId ?? null, input.actorName ?? null, input.type,
      input.message ?? null, input.fromStatus ?? null, input.toStatus ?? null,
      jsonStringify(input.metadata ?? {}), input.visibleToCustomer === false ? 0 : 1, nowIso(),
    ],
  );
  return eventId;
}

/* --------------------------------- create ---------------------------------- */

export interface CreateRequestInput {
  serviceId: string;
  customerId: string;
  formData: Record<string, unknown>;
  paymentMethod?: string;
  priority?: string;
  note?: string;
  documentIds?: { fileId: string; title?: string }[];
  existingInvoiceId?: string;
}

export async function createRequest(input: CreateRequestInput, actor?: { id: string; name: string; ip?: string }) {
 return tx(async()=>{
  if (!(await getBool('services.accepting_requests'))) {
    throw conflict('پذیرش درخواست جدید در حال حاضر غیرفعال است.');
  }
  const service = await getServiceById(input.serviceId);
  if (!service) throw notFound('خدمت یافت نشد.');
  if (!service.acceptingRequests) throw conflict('این خدمت در حال حاضر درخواست نمی‌پذیرد.');
  if (service.archivedAt) throw conflict('این خدمت بایگانی شده است.');
  if (service.isCustom && service.ownerCustomerId !== input.customerId) throw forbidden('این خدمت اختصاصی برای شما نیست.');

  const customer = await one<any>('SELECT * FROM users WHERE id = ? AND kind = ?', [input.customerId, 'customer']);
  if (!customer) throw notFound('مشتری یافت نشد.');

  const profile = await requireCompleteProfile(input.customerId);
  await requireCoverage(service.id, input.customerId);
  if (input.priority === 'high' && !service.urgentEnabled) throw badRequest('انجام فوری برای این خدمت فعال نیست.');
  const pricing = await quoteRequest(service.id,input.customerId,input.priority);
  const urgentFee = pricing.urgentFee;
  const formData = validateFormData(service, input.formData ?? {});
  const fee = service.baseFee;
  const discount = pricing.discount;
  let total = pricing.total;
  if (input.existingInvoiceId) {
    const existingInvoice = await one<any>('SELECT * FROM invoices WHERE id = ?', [input.existingInvoiceId]);
    if (!existingInvoice || existingInvoice.customer_id !== input.customerId || existingInvoice.service_id !== service.id) {
      throw badRequest('فاکتور پیش‌صدور با این مشتری و خدمت سازگار نیست.');
    }
    if (existingInvoice.request_id || ['void', 'draft'].includes(existingInvoice.status)) {
      throw conflict('فاکتور پیش‌صدور دیگر برای ایجاد درخواست قابل استفاده نیست.');
    }
    total = Number(existingInvoice.total);
  }
  const methods = service.paymentMethods.length ? service.paymentMethods : ['online', 'cash'];
  const method = input.paymentMethod && methods.includes(input.paymentMethod) ? input.paymentMethod : methods[0];

  const trackingCode = await generateTrackingCode();
  const requestId = id('req');
  const ts = nowIso();
  const estimated = new Date();
  estimated.setDate(estimated.getDate() + (input.priority === 'high' ? service.urgentDays : service.estimatedDays));
  const dueAt = estimated.toISOString();

  // Immutable snapshot: later edits to the profile or service must not silently
  // change what the customer submitted.
  const snapshot = {
    service: {
      id: service.id, title: service.title, slug: service.slug, baseFee: service.baseFee,
      discountPercent: service.discountPercent, estimatedDays: service.estimatedDays, urgentFee, urgentPercent: service.urgentPercent, urgentDays: service.urgentDays, coverage: service.coverage,
      form: service.form, documents: service.documents, workflow: service.workflow,
      categoryTitle: service.categoryTitle, paymentMethods: methods,
    },
    customer: {
      id: customer.id, fullName: customer.full_name, mobile: customer.mobile,
      nationalId: customer.national_id, email: customer.email, cityId: profile.city_id, city: profile.city,
    },
    submittedAt: ts,
  };

  await tx(async (db) => {
    if (input.priority === 'high') {
      const lock = await db.run('UPDATE services SET updated_at=updated_at WHERE id=?',[service.id]);
      const active = await db.one<any>("SELECT COUNT(*) AS c FROM requests WHERE service_id=? AND priority='high' AND status NOT IN ('completed','cancelled','rejected')",[service.id]);
      if (service.urgentCapacity <= Number(active?.c)) throw conflict('ظرفیت انجام فوری تکمیل است.');
    }
    await db.run(
      `INSERT INTO requests (id, tracking_code, customer_id, service_id, assigned_to, status, priority, form_data, snapshot,
        fee, discount, total, payment_method, payment_status, current_step, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'new', ?, ?, ?, ?, ?, ?, ?, 'unpaid', 0, ?, ?, ?)`,
      [requestId, trackingCode, input.customerId, service.id, input.priority === 'high' ? 'high' : 'normal',
        jsonStringify(formData), jsonStringify(snapshot), fee, discount, total, method, dueAt, ts, ts],
    );
    await db.run(
      `INSERT INTO request_events (id, request_id, actor_id, actor_name, type, message, to_status, metadata, visible_to_customer, created_at)
       VALUES (?, ?, ?, ?, 'created', ?, 'new', ?, 1, ?)`,
      [id('evt'), requestId, actor?.id ?? input.customerId, actor?.name ?? customer.full_name,
        'درخواست شما ثبت شد و در صف بررسی قرار گرفت.', jsonStringify({ trackingCode }), ts],
    );
  });

  await run('UPDATE requests SET urgent_fee=? WHERE id=?',[urgentFee,requestId]);
  if (Array.isArray(input.documentIds)) {
    for (const doc of input.documentIds) {
      await attachDocument(requestId, doc.fileId, doc.title ?? 'مدرک ارسالی', { id: input.customerId, name: customer.full_name }, 'customer');
    }
  }

  if (total > 0 && !input.existingInvoiceId) {
    const invoice = await createInvoice({
      customerId: input.customerId,
      requestId,
      serviceId: service.id,
      kind: service.isCustom ? 'custom' : 'public',
      title: `هزینه خدمت ${service.title}`,
      items: [{ title: service.title, qty: 1, unitPrice: fee, amount: fee }, ...(urgentFee ? [{title:'هزینه انجام فوری',qty:1,unitPrice:urgentFee,amount:urgentFee}] : [])],
      discount,
      notes: `شماره پیگیری ${trackingCode} — هزینه نمایشی است و پس از بررسی نهایی تأیید می‌شود.`,
    }, actor);
    await addEvent({
      requestId, type: 'invoice', message: `پیش‌فاکتور ${toPersianDigits(invoice!.number)} صادر شد.`,
      metadata: { invoiceId: invoice!.id, total: invoice!.total }, actorId: actor?.id, actorName: actor?.name,
    });
    await run('UPDATE requests SET updated_at = ? WHERE id = ?', [nowIso(), requestId]);
  }

  await autoAssign(requestId);

  await writeAudit({
    actorId: actor?.id ?? input.customerId, actorName: actor?.name ?? customer.full_name,
    action: 'request.create', entityType: 'request', entityId: requestId,
    after: { trackingCode, serviceId: service.id, total }, ip: actor?.ip,
  });

  return getRequest(requestId, { actorId: input.customerId, isCustomer: true });
 });
}

/* ---------------------------------- read ----------------------------------- */

export async function getRequest(requestId: string, viewer?: { actorId: string; isCustomer: boolean }) {
  const row = await one<any>(`
    SELECT r.*, s.title AS service_title, s.slug AS service_slug, s.workflow_steps, s.is_custom,
           c.full_name AS customer_name, c.mobile AS customer_mobile, c.national_id AS customer_national_id,
           a.full_name AS assignee_name
    FROM requests r
    JOIN services s ON s.id = r.service_id
    JOIN users c ON c.id = r.customer_id
    LEFT JOIN users a ON a.id = r.assigned_to
    WHERE r.id = ?`, [requestId]);
  if (!row) return null;

  if (viewer?.isCustomer && row.customer_id !== viewer.actorId) return null;

  const events = await q<any>(
    `SELECT id, actor_id, actor_name, type, message, from_status, to_status, metadata, created_at
     FROM request_events WHERE request_id = ? ${viewer?.isCustomer ? 'AND visible_to_customer = 1' : ''}
     ORDER BY created_at ASC`,
    [requestId],
  );
  const documents = await q<any>(
    `SELECT d.*, f.name AS file_name, f.mime AS mime, f.size AS size, f.storage_key
     FROM request_documents d JOIN files f ON f.id = d.file_id WHERE d.request_id = ? ORDER BY d.created_at ASC`,
    [requestId],
  );
  const invoices = await q<any>('SELECT * FROM invoices WHERE request_id = ? ORDER BY created_at ASC', [requestId]);

  return {
    id: row.id,
    trackingCode: row.tracking_code,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status as RequestStatus] ?? row.status,
    priority: row.priority,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
    customerNationalId: row.customer_national_id,
    serviceId: row.service_id,
    serviceTitle: row.service_title,
    serviceSlug: row.service_slug,
    isCustom: Boolean(row.is_custom),
    assignedTo: row.assigned_to,
    assigneeName: row.assignee_name,
    formData: jsonParse(row.form_data, {}),
    snapshot: jsonParse(row.snapshot, {}),
    workflow: jsonParse<any>(row.snapshot, {}).service?.workflow ?? jsonParse(row.workflow_steps, []),
    fee: Number(row.fee),
    discount: Number(row.discount),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    currentStep: Number(row.current_step),
    dueAt: row.due_at,
    rejectedReason: row.rejected_reason,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: events.map((e) => ({
      id: e.id, actorId: e.actor_id, actorName: e.actor_name, type: e.type, message: e.message,
      fromStatus: e.from_status, toStatus: e.to_status, metadata: jsonParse(e.metadata, {}), createdAt: e.created_at,
    })),
    documents: documents.filter(d=>!viewer?.isCustomer || d.kind!=='staff' || d.status==='approved').map((d) => ({
      id: d.id, title: d.title, kind: d.kind, status: d.status, reviewNote: d.review_note,
      file: { id: d.file_id, name: d.file_name, mime: d.mime, size: Number(d.size) },
      createdAt: d.created_at,
    })),
    invoices: invoices.map((i) => ({
      id: i.id, number: i.number, total: Number(i.total), paidAmount: Number(i.paid_amount),
      status: i.status, issuedAt: i.issued_at,
    })),
  };
}

export interface ListRequestsOptions {
  page?: number; pageSize?: number; customerId?: string; assignedTo?: string;
  status?: string; statusGroup?: 'open' | 'closed' | 'all'; search?: string; urgent?: boolean;
  serviceId?: string; unassigned?: boolean; from?: string; to?: string;
}

export async function listRequests(opts: ListRequestsOptions = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const where: string[] = [];
  const args: any[] = [];

  if (opts.customerId) { where.push('r.customer_id = ?'); args.push(opts.customerId); }
  if (opts.assignedTo) { where.push('r.assigned_to = ?'); args.push(opts.assignedTo); }
  if (opts.unassigned) where.push('r.assigned_to IS NULL');
  if (opts.serviceId) { where.push('r.service_id = ?'); args.push(opts.serviceId); }
  if (opts.status) { where.push('r.status = ?'); args.push(opts.status); }
  if (opts.statusGroup === 'open') where.push(`r.status NOT IN ('completed','cancelled','rejected')`);
  if (opts.statusGroup === 'closed') where.push(`r.status IN ('completed','cancelled','rejected')`);
  if (opts.urgent) where.push(`(r.priority = 'high' OR (r.due_at IS NOT NULL AND r.due_at < ?))`), args.push(nowIso());
  if (opts.from) { where.push('r.created_at >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('r.created_at <= ?'); args.push(opts.to); }
  if (opts.search) {
    where.push('(r.tracking_code LIKE ? OR c.full_name LIKE ? OR s.title LIKE ? OR c.mobile LIKE ?)');
    const s = `%${opts.search}%`;
    args.push(s, s, s, s);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM requests r JOIN services s ON s.id = r.service_id JOIN users c ON c.id = r.customer_id
                LEFT JOIN users a ON a.id = r.assigned_to ${clause}`;

  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c ${base}`, args);
  const rows = await q<any>(
    `SELECT r.*, s.title AS service_title, c.full_name AS customer_name, c.mobile AS customer_mobile,
            a.full_name AS assignee_name ${base}
     ORDER BY CASE r.priority WHEN 'high' THEN 0 ELSE 1 END, r.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      trackingCode: r.tracking_code,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status as RequestStatus] ?? r.status,
      priority: r.priority,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerMobile: r.customer_mobile,
      serviceId: r.service_id,
      serviceTitle: r.service_title,
      assignedTo: r.assigned_to,
      assigneeName: r.assignee_name,
      total: Number(r.total),
      paymentStatus: r.payment_status,
      dueAt: r.due_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total: Number(total?.c ?? 0), page, pageSize,
  };
}

/* --------------------------------- update ---------------------------------- */

export async function changeStatus(
  requestId: string,
  toStatus: RequestStatus,
  actor: { id: string; name: string; ip?: string },
  note?: string,
) {
  return tx(async()=>{
  await run('UPDATE requests SET updated_at=updated_at WHERE id=?',[requestId]);
  const request = await one<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) throw notFound('درخواست یافت نشد.');
  const from = request.status;
  if (from === toStatus) return getRequest(requestId);

  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(toStatus)) {
    throw conflict(`تغییر وضعیت از «${STATUS_LABELS[from]}» به «${STATUS_LABELS[toStatus]}» مجاز نیست.`);
  }
  if (toStatus === 'completed' && (await getBool('services.require_document_approval'))) {
    const pending = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM request_documents WHERE request_id = ? AND status = 'pending'`, [requestId]);
    const requiredDocs = (await getServiceById(request.service_id))?.documents.filter((d) => d.required) ?? [];
    const approved = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM request_documents WHERE request_id = ? AND status = 'approved'`, [requestId]);
    if (Number(pending?.c ?? 0) > 0) throw conflict('مدارک این پرونده هنوز بررسی نشده‌اند.');
    if (requiredDocs.length > 0 && Number(approved?.c ?? 0) === 0) {
      throw conflict('مدارک الزامی این خدمت هنوز تأیید نشده است.');
    }
  }

  if(['ready','completed'].includes(toStatus)){
    if(await one("SELECT id FROM request_handoffs WHERE request_id=? AND status='pending'",[requestId]))throw conflict('ابتدا ارجاع‌های باز مدیریت و حسابداری را بررسی کنید.');
    if(await one("SELECT id FROM request_documents WHERE request_id=? AND kind='staff' AND status<>'approved'",[requestId]))throw conflict('نتیجه کارکنان هنوز تأیید نشده است.');
  }
  const ts = nowIso();
  const sets = ['status = ?', 'updated_at = ?'];
  const args: any[] = [toStatus, ts];
  if (toStatus === 'completed') { sets.push('completed_at = ?'); args.push(ts); }
  if (toStatus === 'cancelled') { sets.push('cancelled_at = ?'); args.push(ts); }
  if (toStatus === 'rejected') { sets.push('rejected_reason = ?'); args.push(note ?? ''); }
  if (toStatus === 'in_progress') { sets.push('current_step = ?'); args.push(Math.max(1, request.current_step + 1)); }

  await run(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`, [...args, requestId]);
  await addEvent({
    requestId, type: 'status', actorId: actor.id, actorName: actor.name,
    message: note ?? `وضعیت از «${STATUS_LABELS[from]}» به «${STATUS_LABELS[toStatus]}» تغییر کرد.`,
    fromStatus: from, toStatus, visibleToCustomer: true,
  });
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'request.status', entityType: 'request',
    entityId: requestId, before: { status: from }, after: { status: toStatus, note }, ip: actor.ip,
  });
  return getRequest(requestId);
  });
}

export async function assignRequest(requestId: string, staffId: string | null, actor: { id: string; name: string; ip?: string }) {
  const request = await one<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) throw notFound('درخواست یافت نشد.');
  if (staffId) {
    const staff = await one<any>(
      `SELECT u.id, u.full_name FROM users u JOIN staff_profiles sp ON sp.user_id = u.id
       WHERE u.id = ? AND u.kind = 'staff' AND u.status = 'active'`, [staffId],
    );
    if (!staff) throw badRequest('کارشناس انتخابی معتبر نیست.');
  }
  const newStatus = staffId && request.status === 'new' ? 'assigned' : request.status;
  const assignedAt = staffId ? nowIso() : null;
  await run('UPDATE requests SET assigned_to = ?, assigned_at = ?, status = ?, updated_at = ? WHERE id = ?', [staffId, assignedAt, newStatus, nowIso(), requestId]);
  await addEvent({
    requestId, type: 'assigned', actorId: actor.id, actorName: actor.name,
    message: staffId ? 'پرونده به کارشناس ارجاع شد.' : 'ارجاع پرونده برداشته شد.',
    fromStatus: request.status, toStatus: newStatus,
  });
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'request.assign', entityType: 'request', entityId: requestId, after: { staffId }, ip: actor.ip });
  return getRequest(requestId);
}

export async function addNote(requestId: string, message: string, actor: { id: string; name: string }, visibleToCustomer = true) {
  const request = await one('SELECT id FROM requests WHERE id = ?', [requestId]);
  if (!request) throw notFound('درخواست یافت نشد.');
  await addEvent({ requestId, type: 'note', message, actorId: actor.id, actorName: actor.name, visibleToCustomer });
  await run('UPDATE requests SET updated_at = ? WHERE id = ?', [nowIso(), requestId]);
}

export async function attachDocument(
  requestId: string,
  fileId: string,
  title: string,
  actor: { id: string; name: string },
  kind: 'customer' | 'staff' = 'staff',
) {
  const file = await one<any>('SELECT * FROM files WHERE id = ?', [fileId]);
  if (!file) throw badRequest('فایل ارسالی یافت نشد.');
  if (file.owner_id !== actor.id) throw forbidden('فقط فایل بارگذاری‌شده توسط خودتان قابل پیوست است.');
  await run(
    `INSERT INTO request_documents (id, request_id, file_id, title, kind, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id('doc'), requestId, fileId, title, kind, nowIso()],
  );
  await addEvent({
    requestId, type: 'document', actorId: actor.id, actorName: actor.name,
    message: `مدرک «${title}» بارگذاری شد.`, metadata: { fileId },
  });
  await run('UPDATE requests SET updated_at = ? WHERE id = ?', [nowIso(), requestId]);
}

export async function reviewDocument(
  documentId: string,
  decision: 'approved' | 'rejected',
  note: string | undefined,
  actor: { id: string; name: string; ip?: string },
) {
  const doc = await one<any>('SELECT * FROM request_documents WHERE id = ?', [documentId]);
  if (!doc) throw notFound('مدرک یافت نشد.');
  await run(
    'UPDATE request_documents SET status = ?, reviewed_by = ?, review_note = ? WHERE id = ?',
    [decision, actor.id, note ?? null, documentId],
  );
  const eventId = await addEvent({
    requestId: doc.request_id, type: 'document', actorId: actor.id, actorName: actor.name,
    message: decision === 'approved' ? 'مدرک تأیید شد.' : `مدرک رد شد. ${note ?? ''}`.trim(),
    metadata: { documentId },
  });
  if (decision === 'rejected') {
    await run(`UPDATE requests SET status = 'waiting_documents', updated_at = ? WHERE id = ? AND status NOT IN ('completed','cancelled','rejected')`, [nowIso(), doc.request_id]);
  }
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: `document.${decision}`, entityType: 'document', entityId: documentId, ip: actor.ip });
  return { eventId, requestId: doc.request_id, previousStatus: doc.status };
}

export async function customerCancel(requestId: string, customerId: string, reason: string, actor: { id: string; name: string }) {
  const request = await one<RequestRow>('SELECT * FROM requests WHERE id = ? AND customer_id = ?', [requestId, customerId]);
  if (!request) throw notFound('درخواست یافت نشد.');
  if (!['new', 'assigned', 'waiting_documents', 'waiting_customer'].includes(request.status)) {
    throw conflict('در این مرحله امکان لغو درخواست وجود ندارد. با دفتر تماس بگیرید.');
  }
  return changeStatus(requestId, 'cancelled', { ...actor, ip: undefined }, reason || 'لغو توسط مشتری');
}

/* ------------------------------- statistics -------------------------------- */

export async function requestStats(scope: { customerId?: string; assignedTo?: string } = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (scope.customerId) { where.push('customer_id = ?'); args.push(scope.customerId); }
  if (scope.assignedTo) { where.push('assigned_to = ?'); args.push(scope.assignedTo); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await q<{ status: string; c: number }>(`SELECT status, COUNT(*) AS c FROM requests ${clause} GROUP BY status`, args);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number(r.c);
  const open = Object.entries(counts).filter(([k]) => !['completed', 'cancelled', 'rejected'].includes(k)).reduce((s, [, v]) => s + v, 0);
  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  const unpaid = await one<{ total: number }>(
    `SELECT COALESCE(SUM(i.total - i.paid_amount),0) AS total FROM invoices i
     JOIN requests r ON r.id = i.request_id
     WHERE i.status IN ('issued','partially_paid') ${scope.customerId ? 'AND r.customer_id = ?' : ''}`,
    scope.customerId ? [scope.customerId] : [],
  );

  return {
    counts,
    open,
    total,
    completed: counts.completed ?? 0,
    overdue: Number((await one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM requests ${clause ? `${clause} AND` : 'WHERE'} due_at IS NOT NULL AND due_at < ? AND status NOT IN ('completed','cancelled','rejected')`,
      [...args, nowIso()],
    ))?.c ?? 0),
    outstandingAmount: Number(unpaid?.total ?? 0),
  };
}

export { addHours };

/** One server pricing path for quote, request snapshot and invoice. All amounts are integer IRR. */
export async function quoteRequest(serviceId: string, customerId: string, priority = 'normal') {
 const service = await getServiceById(serviceId);
 if (!service || (!service.isPublished && !service.isCustom) || !service.acceptingRequests || (service.isCustom && service.ownerCustomerId !== customerId)) throw notFound('این خدمت قابل درخواست نیست.');
 await requireCompleteProfile(customerId);
 await requireCoverage(serviceId,customerId);
 if (priority === 'high' && !service.urgentEnabled) throw badRequest('انجام فوری برای این خدمت فعال نیست.');
 const urgentFee = priority === 'high' ? Math.round(service.baseFee * service.urgentPercent / 100) : 0;
 const discount = Math.round(service.baseFee * service.discountPercent / 100);
 const subtotal = service.baseFee + urgentFee;
 const tax = Math.round((subtotal-discount)*await getNumber('accounting.tax_percent')/100);
 const active = await one<any>("SELECT COUNT(*) AS c FROM requests WHERE service_id=? AND priority='high' AND status NOT IN ('completed','cancelled','rejected')",[serviceId]);
 return {baseFee:service.baseFee,discount,urgentFee,tax,total:subtotal-discount+tax,currency:'IRR',estimatedDays:priority==='high'?service.urgentDays:service.estimatedDays,urgentAvailable:service.urgentEnabled && service.urgentCapacity>Number(active?.c),quotedAt:nowIso()};
}

/** Queue metadata deliberately excludes customer identity, documents and finances. */
export async function eligibleQueue(staffId:string) {
 const rows=await q<any>("SELECT r.id,r.tracking_code,r.service_id,r.created_at,r.priority,s.title FROM requests r JOIN services s ON s.id=r.service_id WHERE r.assigned_to IS NULL AND r.status='new' ORDER BY r.created_at LIMIT 200");
 const result=[];
 for(const r of rows){const service=await getServiceById(r.service_id);if(service&&(await candidatesForService(service)).some(c=>c.id===staffId))result.push({id:r.id,trackingCode:r.tracking_code,serviceTitle:r.title,priority:r.priority,createdAt:r.created_at})}
 return result;
}
export async function claimRequest(requestId:string,staffId:string,name:string){
 return tx(async()=>{
  await run('UPDATE users SET updated_at=updated_at WHERE id=?',[staffId]);
  await run('UPDATE requests SET updated_at=updated_at WHERE id=?',[requestId]);
  const r=await one<any>('SELECT * FROM requests WHERE id=?',[requestId]);
  if(!r || r.assigned_to || r.status!=='new')throw conflict('این پرونده قبلاً پذیرفته شده یا قابل پذیرش نیست.');
  const service=await getServiceById(r.service_id);
  if(!service || !(await candidatesForService(service)).some(c=>c.id===staffId))throw forbidden('مهارت، شیفت یا ظرفیت لازم برای این خدمت را ندارید.');
  const assignedAt=nowIso();
  const changed=await run("UPDATE requests SET assigned_to=?,assigned_at=?,status='assigned',updated_at=? WHERE id=? AND assigned_to IS NULL AND status='new'",[staffId,assignedAt,assignedAt,requestId]);
  if(!changed.changes)throw conflict('کارمند دیگری پرونده را پذیرفته است.');
  await addEvent({requestId,type:'assigned',actorId:staffId,actorName:name,message:`پرونده توسط ${name} پذیرفته شد.`,fromStatus:'new',toStatus:'assigned'});
  return {id:requestId};
 });
}

export function nextStatuses(status:RequestStatus){return ALLOWED_TRANSITIONS[status]??[];}
