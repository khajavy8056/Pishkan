import { tehranNow } from '../../lib/tehran-time.js';
import { one, q, run, nowIso, addHours, jsonParse, jsonStringify, tx } from '../../db/index.js';
import { id, hmac } from '../../lib/crypto.js';
import { env } from '../../env.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import { getServiceById, finalFee, type ServiceDTO } from '../catalog/service.js';
import { createInvoice } from '../accounting/service.js';
import { writeAudit } from '../audit/service.js';
import { assertWalletUsable } from '../wallet/service.js';
import { settleInvoiceWithWallet } from '../payments/service.js';
import { logEvent } from '../logging/service.js';
import { archiveRequestDocument, inferDocumentType, reuseDocumentInRequest, reviewCustomerDocument } from '../documents/service.js';
import { toPersianDigits } from '../../lib/text.js';

import { requireCompleteProfile, requireCoverage, validNationalId } from '../profiles/service.js';
import { commissionAmount, commissionPercentFor, cooperationType, earningsByRequest } from '../payroll/compensation.js';
import { accrueCommissionsForRequest } from '../payroll/service.js';
import { notifyUser, notifyRole } from '../notifications/service.js';
import { normalizeCode, previewDiscount, redeemDiscount } from '../discounts/service.js';

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

/** Kind of a workflow step: whose move it is while the case sits on that step. */
export const STEP_KINDS = ['action', 'waiting_customer', 'waiting_organization', 'followup', 'delivery'] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_KIND_LABELS: Record<StepKind, string> = {
  action: 'اقدام کارشناس',
  waiting_customer: 'منتظر مشتری',
  waiting_organization: 'منتظر سازمان',
  followup: 'پیگیری کارشناس',
  delivery: 'تحویل به مشتری',
};

/**
 * Work bucket: the one field staff queues and capacity maths agree on. It is
 * derived from the request status plus the kind of the current workflow step
 * and denormalised into `requests.work_bucket` so lists can filter on it.
 */
export const WORK_BUCKETS = ['action', 'in_progress', 'waiting_customer', 'waiting_organization', 'followup', 'completed', 'cancelled'] as const;
export type WorkBucket = (typeof WORK_BUCKETS)[number];
export const WORK_BUCKET_LABELS: Record<WorkBucket, string> = {
  action: 'نیازمند اقدام',
  in_progress: 'در حال انجام',
  waiting_customer: 'منتظر مشتری',
  waiting_organization: 'منتظر سازمان',
  followup: 'نیازمند پیگیری',
  completed: 'تکمیل‌شده',
  cancelled: 'لغوشده',
};

/** Workflow steps frozen into the request snapshot at creation time. */
export function snapshotSteps(snapshot: unknown): { title: string; kind: StepKind }[] {
  const parsed = jsonParse<any>(snapshot, null);
  const steps = Array.isArray(parsed?.service?.workflow) ? parsed.service.workflow : [];
  return steps.map((step: any) => ({
    title: String(step?.title ?? ''),
    kind: (STEP_KINDS as readonly string[]).includes(step?.kind) ? step.kind as StepKind : 'action',
  }));
}

export function stepKindOf(snapshot: unknown, currentStep: number): StepKind {
  const steps = snapshotSteps(snapshot);
  if (!steps.length) return 'action';
  const index = Math.max(0, Math.min(steps.length - 1, Number(currentStep) || 0));
  return steps[index]?.kind ?? 'action';
}

export function deriveBucket(status: string, stepKind: StepKind): WorkBucket {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled' || status === 'rejected') return 'cancelled';
  if (status === 'waiting_documents' || status === 'waiting_customer' || stepKind === 'waiting_customer') return 'waiting_customer';
  if (stepKind === 'waiting_organization' || status === 'under_review') return 'waiting_organization';
  if (stepKind === 'followup') return 'followup';
  if (status === 'in_progress') return 'in_progress';
  return 'action';
}

/** Recompute and persist `work_bucket` after any status/step mutation. */
export async function refreshWorkBucket(requestId: string): Promise<WorkBucket> {
  const row = await one<any>('SELECT status, current_step, snapshot, work_bucket FROM requests WHERE id = ?', [requestId]);
  if (!row) return 'action';
  const bucket = deriveBucket(row.status, stepKindOf(row.snapshot, Number(row.current_step)));
  if (row.work_bucket !== bucket) {
    await run('UPDATE requests SET work_bucket = ? WHERE id = ?', [bucket, requestId]);
  }
  return bucket;
}

const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ['assigned', 'in_progress', 'under_review', 'cancelled', 'rejected'],
  assigned: ['in_progress', 'waiting_documents', 'waiting_customer', 'under_review', 'cancelled', 'rejected'],
  in_progress: ['waiting_documents', 'waiting_customer', 'under_review', 'ready', 'completed', 'cancelled', 'rejected'],
  waiting_documents: ['in_progress', 'under_review', 'cancelled', 'rejected'],
  waiting_customer: ['in_progress', 'under_review', 'cancelled', 'rejected'],
  under_review: ['in_progress', 'ready', 'completed', 'cancelled', 'rejected'],
  ready: ['completed', 'in_progress', 'under_review'],
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
  estimated_completion_at: string | null;
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
      case 'file':
        if (typeof value !== 'string' || value.trim().length < 3 || value.length > 120) {
          errors.push({ field: field.key, message: `فایل «${field.label}» معتبر نیست.` });
        } else clean[field.key] = value.trim();
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

/**
 * Weighted active load: a case waiting on the customer or an external
 * organization still belongs to the employee (it must be chased later) but
 * does not occupy a full work slot right now. `workforce.waiting_case_weight`
 * is a percentage (default 25 = a quarter of an active case).
 */
async function activeLoad(userId: string): Promise<number> {
  const weightPercent = Math.max(0, Math.min(100, await getNumber('workforce.waiting_case_weight')));
  const weight = weightPercent / 100;
  const row = await one<{ w: number }>(
    `SELECT COALESCE(SUM(CASE WHEN work_bucket IN ('waiting_customer','waiting_organization') THEN ? ELSE 1 END), 0) AS w
     FROM requests WHERE assigned_to = ? AND work_bucket NOT IN ('completed','cancelled')`,
    [weight, userId],
  );
  return Math.round(Number(row?.w ?? 0) * 100) / 100;
}

export { activeLoad as weightedActiveLoad };

/** Candidate staff for a service, ordered by the configured strategy. */
export async function candidatesForService(
  service: ServiceDTO,
  opts: { requireOnline?: boolean } = {},
): Promise<{ id: string; name: string; load: number; onShift: boolean }[]> {
  const rule = await one<any>('SELECT * FROM assignment_rules WHERE service_id = ? AND is_active = 1', [service.id]);
  const explicitIds: string[] = jsonParse<string[]>(rule?.staff_ids, []);
  const strategy: string = rule?.strategy ?? (await getString('services.auto_assign_strategy')) ?? 'least_loaded';
  const maxLoad = Number(rule?.max_load) > 0 ? Number(rule.max_load) : await getNumber('services.max_active_cases_per_staff');

  let staffRows: any[] = [];
  if (strategy === 'fixed') {
    if (!explicitIds.length) return [];
    staffRows = await q<any>(
      `SELECT u.id, u.full_name, u.last_seen_at, sp.max_active_cases, sp.accepts_new_cases, sp.specialties
       FROM users u
       JOIN staff_profiles sp ON sp.user_id = u.id
       JOIN roles r ON r.id = u.role_id
       WHERE u.id IN (${explicitIds.map(() => '?').join(',')})
         AND u.kind = 'staff' AND u.status = 'active' AND sp.accepts_new_cases = 1
         AND r.code IN ('service_expert','operator','manager')`, explicitIds,
    );
  } else {
    staffRows = await q<any>(
      `SELECT u.id, u.full_name, u.last_seen_at, sp.max_active_cases, sp.accepts_new_cases, sp.specialties
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
  // Automatic placement must not hand a case to someone who has not been
  // around for hours. Manual claiming is never gated by presence, and an
  // account that has never been seen (fresh/seed) is not excluded.
  const onlineWindowMinutes = opts.requireOnline ? await getNumber('workforce.online_window_minutes') : 0;
  const onlineCutoff = onlineWindowMinutes > 0 ? Date.now() - onlineWindowMinutes * 60_000 : null;
  const candidates: { id: string; name: string; load: number; onShift: boolean }[] = [];
  for (const row of staffRows) {
    if (onlineCutoff && row.last_seen_at && Date.parse(row.last_seen_at) < onlineCutoff) continue;
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
 const chosenId = await tx(async () => {
  if (!(await getBool('services.auto_assign'))) return null;
  const request = await one<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request || request.assigned_to) return null;
  const service = await getServiceById(request.service_id);
  if (!service) return null;
  const rule = await one<any>('SELECT strategy FROM assignment_rules WHERE service_id = ? AND is_active = 1', [service.id]);
  const strategy = rule?.strategy ?? (await getString('services.auto_assign_strategy')) ?? 'least_loaded';
  if (strategy === 'queue') return null;

  const candidates = await candidatesForService(service, { requireOnline: true });
  const chosen = candidates[0];
  if (!chosen) return null;

  const assignedAt = nowIso();
  const nextStatus = request.status === 'under_review' ? 'under_review' : 'assigned';
  const assignment = await run('UPDATE requests SET assigned_to = ?, assigned_at = ?, status = ?, updated_at = ? WHERE id = ? AND assigned_to IS NULL AND status = ?', [chosen.id, assignedAt, nextStatus, assignedAt, requestId, request.status]);
  if (!assignment.changes) return null;
  await addEvent({
    requestId, type: 'assigned', actorId: 'system', actorName: 'Pishkan auto-assignment',
    message: `پرونده به ${chosen.name} ارجاع شد.`, fromStatus: request.status, toStatus: nextStatus,
  });
  await writeAudit({ actorId: 'system', actorName: 'Pishkan auto-assignment', action: 'request.auto_assign', entityType: 'request', entityId: requestId,
    before: { staffId: null, status: request.status }, after: { staffId: chosen.id, status: nextStatus } });
  // The assignee must learn about the new case immediately; until now only
  // forced assignments produced a notification, so ordinary auto-assigned
  // cases could sit unseen in the workbench.
  await notifyUser(chosen.id, {
    title: 'پروندهٔ جدید برای شما ثبت شد',
    body: `درخواست «${service.title}» (کد پیگیری ${toPersianDigits(request.tracking_code)}) به شما ارجاع شد.`,
    kind: 'info', link: `/staff/requests/${requestId}`,
    idempotencyKey: `auto-assign:${requestId}:${chosen.id}`,
  }).catch(() => undefined);
  await refreshWorkBucket(requestId);
  return chosen.id;
 });
 if (chosenId) {
   await accrueCommissionsForRequest(requestId).catch((error) => {
     logEvent({
       level: 'WARNING', category: 'payment', action: 'commission.sweep_failed', result: 'failure',
       entityType: 'request', entityId: requestId, message: String((error as Error)?.message ?? error),
     }).catch(() => undefined);
   });
 }
 return chosenId;
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

/** Customer payment methods. Everything else is retired from the workflow. */
export const ALLOWED_PAYMENT_METHODS = ['online', 'wallet'] as const;

/* --------------------------------- create ---------------------------------- */

export interface CreateRequestInput {
  serviceId: string;
  customerId: string;
  formData: Record<string, unknown>;
  paymentMethod?: string;
  priority?: string;
  note?: string;
  documentIds?: { fileId?: string; customerDocumentId?: string; confirmReuse?: boolean; title?: string; requirementKey?: string }[];
  existingInvoiceId?: string;
  idempotencyKey?: string;
  discountCode?: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

type RequestDocumentAttachment = { fileId?: string; customerDocumentId?: string; confirmReuse?: boolean; title: string; requirementKey: string | null };

/**
 * The archive type a requirement should be filed under.
 *
 * Seeded requirements only carry a title ("تصویر کارت ملی"); the optional
 * `documentType` field is what an operator can add afterwards. Without a type
 * the archive cannot match the document to a later requirement, so fall back to
 * reading the type out of the title rather than filing nothing — but never
 * invent one when the title says nothing recognisable.
 */
function documentTypeForRequirement(service: ServiceDTO, requirementKey: string | null): string | null {
  if (!requirementKey) return null;
  const requirement = (service.documents ?? []).find((document) => document.key === requirementKey);
  if (!requirement) return null;
  if (requirement.documentType && requirement.documentType !== 'other') return requirement.documentType;
  return inferDocumentType(requirement.title);
}

function documentAttachmentsForSubmission(
  service: ServiceDTO,
  formData: Record<string, unknown>,
  submitted: CreateRequestInput['documentIds'],
): RequestDocumentAttachment[] {
  const attachments: RequestDocumentAttachment[] = [];
  const errors: { field: string; message: string }[] = [];
  const requirements = service.documents ?? [];
  const byKey = new Map(requirements.map((document) => [document.key, document]));
  const seenKeys = new Set<string>();
  const seenFiles = new Set<string>();

  for (const document of submitted ?? []) {
    if (Boolean(document.fileId) === Boolean(document.customerDocumentId)) { errors.push({ field: 'documents', message: 'یک فایل یا مدرک پروفایل انتخاب کنید.' }); continue; }
    const identity = document.fileId ?? `profile:${document.customerDocumentId}`;
    const key = document.requirementKey?.trim();
    if (!key) {
      if (requirements.length) errors.push({ field: 'documents', message: 'برای هر مدرک، شناسهٔ مدرک موردنیاز را انتخاب کنید.' });
      else {
        if (seenFiles.has(identity)) errors.push({ field: 'documents', message: 'یک فایل را نمی‌توان بیش از یک‌بار پیوست کرد.' });
        seenFiles.add(identity);
        attachments.push({ fileId: document.fileId, customerDocumentId: document.customerDocumentId, confirmReuse: document.confirmReuse, title: document.title?.trim() || 'مدرک تکمیلی', requirementKey: null });
      }
      continue;
    }
    const requirement = byKey.get(key);
    if (!requirement) {
      errors.push({ field: `documents.${key}`, message: 'این مدرک در فهرست مدارک خدمت وجود ندارد.' });
      continue;
    }
    if (seenKeys.has(key)) errors.push({ field: `documents.${key}`, message: `مدرک «${requirement.title}» بیش از یک‌بار انتخاب شده است.` });
    if (seenFiles.has(identity)) errors.push({ field: `documents.${key}`, message: 'یک فایل را نمی‌توان برای چند مدرک استفاده کرد.' });
    seenKeys.add(key);
    seenFiles.add(identity);
    attachments.push({ fileId: document.fileId, customerDocumentId: document.customerDocumentId, confirmReuse: document.confirmReuse, title: requirement.title, requirementKey: key });
  }

  for (const requirement of requirements) {
    if (requirement.required && !seenKeys.has(requirement.key)) {
      errors.push({ field: `documents.${requirement.key}`, message: `بارگذاری مدرک «${requirement.title}» الزامی است.` });
    }
  }

  for (const field of service.form.filter((item) => item.type === 'file')) {
    const value = formData[field.key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const fileId = String(value);
    if (seenFiles.has(fileId)) errors.push({ field: field.key, message: 'یک فایل را نمی‌توان برای چند مدرک استفاده کرد.' });
    seenFiles.add(fileId);
    attachments.push({ fileId, title: field.label, requirementKey: `field:${field.key}` });
  }

  if (errors.length) throw badRequest('مدارک پیوست‌شده کامل یا معتبر نیستند.', errors);
  return attachments;
}

async function assertCustomerDocumentFiles(attachments: RequestDocumentAttachment[], customerId: string) {
  for (const [index, attachment] of attachments.entries()) {
    if (attachment.customerDocumentId) continue; // validated under lock when linked inside the request transaction
    const file = await one<any>('SELECT id, owner_id, mime, is_public FROM files WHERE id = ?', [attachment.fileId]);
    const field = attachment.requirementKey?.startsWith('field:')
      ? attachment.requirementKey.slice('field:'.length)
      : attachment.requirementKey ? `documents.${attachment.requirementKey}` : `documents.${index}`;
    if (!file) throw badRequest('یکی از فایل‌های مدرک یافت نشد.', [{ field, message: 'فایل دیگر در دسترس نیست؛ آن را دوباره بارگذاری کنید.' }]);
    if (file.owner_id !== customerId) throw forbidden('فقط فایل بارگذاری‌شده توسط مشتریِ همین درخواست قابل استفاده است.');
    if (Number(file.is_public)) throw badRequest('فایل عمومی نمی‌تواند به‌عنوان مدرک درخواست استفاده شود.');
    if (!String(file.mime).startsWith('image/') && file.mime !== 'application/pdf') {
      throw badRequest('مدارک درخواست باید تصویر یا PDF باشند.', [{ field, message: 'قالب فایل پشتیبانی نمی‌شود.' }]);
    }
  }
}

export async function createRequest(input: CreateRequestInput, actor?: { id: string; name: string; ip?: string }) {
 return tx(async()=>{
  const idempotencyKey = input.idempotencyKey?.trim();
  let submissionHash: string | undefined;
  if (idempotencyKey) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
      throw badRequest('کلید جلوگیری از ثبت تکراری معتبر نیست.');
    }
    submissionHash = hmac(canonicalJson({
      customerId: input.customerId,
      serviceId: input.serviceId,
      formData: input.formData ?? {},
      paymentMethod: input.paymentMethod ?? null,
      existingInvoiceId: input.existingInvoiceId ?? null,
      discountCode: input.discountCode ? normalizeCode(input.discountCode) : null,
      priority: input.priority ?? 'normal',
      documentIds: input.documentIds ?? [],
    }), env.encryptionKey || 'pishkan-development-only-idempotency-secret');
    let prior = await one<any>('SELECT payload_hash, request_id FROM request_submission_keys WHERE customer_id = ? AND idempotency_key = ?', [input.customerId, idempotencyKey]);
    if (!prior) {
      const reserved = await run(`INSERT INTO request_submission_keys (customer_id, idempotency_key, payload_hash, request_id, created_at)
        VALUES (?, ?, ?, NULL, ?) ON CONFLICT (customer_id, idempotency_key) DO NOTHING`,
      [input.customerId, idempotencyKey, submissionHash, nowIso()]);
      if (!reserved.changes) {
        prior = await one<any>('SELECT payload_hash, request_id FROM request_submission_keys WHERE customer_id = ? AND idempotency_key = ?', [input.customerId, idempotencyKey]);
      }
    }
    if (prior) {
      if (prior.payload_hash !== submissionHash) throw conflict('این کلید ثبت قبلاً با اطلاعات دیگری استفاده شده است. فرم را بازبینی و دوباره تلاش کنید.');
      if (!prior.request_id) throw conflict('ثبت درخواست با این کلید هنوز نهایی نشده است؛ کمی بعد دوباره تلاش کنید.');
      const replay = await getRequest(prior.request_id, { actorId: input.customerId, isCustomer: true });
      if (replay) return replay;
      throw conflict('درخواست قبلی این کلید دیگر در دسترس نیست. برای درخواست جدید، فرم را دوباره ارسال کنید.');
    }
  }

  if (!(await getBool('services.accepting_requests'))) {
    throw conflict('پذیرش درخواست جدید در حال حاضر غیرفعال است.');
  }
  const service = await getServiceById(input.serviceId);
  if (!service) throw notFound('خدمت یافت نشد.');
  if (!service.acceptingRequests) throw conflict('این خدمت در حال حاضر درخواست نمی‌پذیرد.');
  if (service.archivedAt) throw conflict('این خدمت بایگانی شده است.');
  if (service.isCustom && service.ownerCustomerId !== input.customerId) throw forbidden('این خدمت اختصاصی برای شما نیست.');

  // Serialize discount eligibility and first-purchase reservations per customer.
  await run("UPDATE users SET id = id WHERE id = ? AND kind = 'customer'", [input.customerId]);
  const customer = await one<any>('SELECT * FROM users WHERE id = ? AND kind = ?', [input.customerId, 'customer']);
  if (!customer) throw notFound('مشتری یافت نشد.');

  const profile = await requireCompleteProfile(input.customerId);
  await requireCoverage(service.id, input.customerId);
  if (input.priority === 'high' && !service.urgentEnabled) throw badRequest('انجام فوری برای این خدمت فعال نیست.');
  if (input.discountCode?.trim() && input.existingInvoiceId) {
    throw badRequest('کد تخفیف روی فاکتورِ از پیش صادرشده قابل اعمال نیست.', [{ field: 'discountCode', message: 'کد تخفیف را بردارید یا فاکتور جدید بگیرید.' }]);
  }
  const pricing = await quoteRequest(service.id,input.customerId,input.priority,input.discountCode);
  const urgentFee = pricing.urgentFee;
  const formData = validateFormData(service, input.formData ?? {});
  const documentAttachments = documentAttachmentsForSubmission(service, formData, input.documentIds);
  await assertCustomerDocumentFiles(documentAttachments, input.customerId);
  const fee = service.baseFee;
  const discount = pricing.discount + (pricing.codeDiscount ?? 0);
  let total = pricing.total;
  let existingInvoice: any = null;
  if (input.existingInvoiceId) {
    existingInvoice = await one<any>('SELECT * FROM invoices WHERE id = ?', [input.existingInvoiceId]);
    if (!existingInvoice || existingInvoice.customer_id !== input.customerId || existingInvoice.service_id !== service.id) {
      throw badRequest('فاکتور پیش‌صدور با این مشتری و خدمت سازگار نیست.');
    }
    if (existingInvoice.request_id || ['void', 'draft'].includes(existingInvoice.status)) {
      throw conflict('فاکتور پیش‌صدور دیگر برای ایجاد درخواست قابل استفاده نیست.');
    }
    total = Number(existingInvoice.total);
  }
  // Only two customer payment paths exist: the online gateway and the wallet.
  // Legacy values (cash/pos/transfer) are rejected explicitly instead of being
  // silently mapped, so no hidden offline path survives in the API.
  const methods = ALLOWED_PAYMENT_METHODS.filter((candidate) => service.paymentMethods.includes(candidate));
  const offered: readonly string[] = methods.length ? methods : [...ALLOWED_PAYMENT_METHODS];
  if (total > 0 && input.paymentMethod && !(ALLOWED_PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) {
    throw badRequest('این روش پرداخت حذف شده است؛ فقط پرداخت آنلاین یا کیف پول مجاز است.', [{
      field: 'paymentMethod', message: 'روش مجاز: درگاه پرداخت آنلاین یا کیف پول.',
    }]);
  }
  if (total > 0 && input.paymentMethod && !offered.includes(input.paymentMethod)) {
    throw badRequest('روش پرداخت انتخاب‌شده برای این خدمت مجاز نیست.', [{ field: 'paymentMethod', message: 'روش دیگری از گزینه‌های مجاز انتخاب کنید.' }]);
  }
  const method = total <= 0 ? 'none' : input.paymentMethod ?? offered[0]!;
  if (method === 'wallet') {
    if (!(await getBool('wallet.enabled')) || !(await getBool('wallet.allow_wallet_payment'))) {
      throw badRequest('پرداخت از کیف پول در حال حاضر غیرفعال است.');
    }
    const wallet = await assertWalletUsable(input.customerId);
    if (Number(wallet.balance) < total) {
      throw conflict('موجودی کیف پول برای این خدمت کافی نیست.', [{
        field: 'wallet',
        message: `موجودی: ${wallet.balance} ریال — مبلغ لازم: ${total} ریال`,
        available: Number(wallet.balance),
        required: total,
        action: 'wallet_topup',
      }]);
    }
  }
  const existingPaid = Number(existingInvoice?.paid_amount ?? 0);
  const paymentStatus = total <= 0 ? 'not_required'
    : existingPaid >= total ? 'paid'
      : existingPaid > 0 ? 'partial'
        : method === 'wallet' ? 'paid' : 'unpaid';

  const trackingCode = await generateTrackingCode();
  const requestId = id('req');
  const ts = nowIso();
  const estimatedMinutes = input.priority === 'high' ? service.urgentMinutes : service.estimatedMinutes;
  const createdAtMs = Date.now();
  const estimatedCompletionAt = new Date(createdAtMs + estimatedMinutes * 60_000).toISOString();
  // The request leaves the open pool when this moment passes. The ratio is
  // frozen here so changing the setting later cannot move an existing request.
  const forceRatio = Math.min(100, Math.max(1, await getNumber('workforce.force_assign_ratio')));
  const forceAssignAt = (await getBool('workforce.force_assign_enabled'))
    ? new Date(createdAtMs + estimatedMinutes * 60_000 * (forceRatio / 100)).toISOString()
    : null;

  // Immutable snapshot: later edits to the profile or service must not silently
  // change what the customer submitted.
  const snapshot = {
    service: {
      id: service.id, title: service.title, slug: service.slug, baseFee: service.baseFee,
      discountPercent: service.discountPercent, discountCode: pricing.discountCode ?? null, estimatedMinutes: service.estimatedMinutes, estimatedDays: service.estimatedDays,
      urgentFee, urgentPercent: service.urgentPercent, urgentMinutes: service.urgentMinutes, urgentDays: service.urgentDays, coverage: service.coverage,
      form: service.form, documents: service.documents, workflow: service.workflow,
      categoryTitle: service.categoryTitle, paymentMethods: methods,
    },
    customer: {
      id: customer.id, fullName: customer.full_name, mobile: customer.mobile,
      nationalId: customer.national_id, email: customer.email, cityId: profile.city_id, city: profile.city,
    },
    submittedAt: ts,
  };

  let createdInvoice: any = null;
  await tx(async (db) => {
    if (input.priority === 'high') {
      const lock = await db.run('UPDATE services SET updated_at=updated_at WHERE id=?',[service.id]);
      const active = await db.one<any>("SELECT COUNT(*) AS c FROM requests WHERE service_id=? AND priority='high' AND status NOT IN ('completed','cancelled','rejected')",[service.id]);
      if (service.urgentCapacity <= Number(active?.c)) throw conflict('ظرفیت انجام فوری تکمیل است.');
    }
    await db.run(
      `INSERT INTO requests (id, tracking_code, customer_id, service_id, assigned_to, status, priority, form_data, snapshot,
        fee, discount, total, payment_method, payment_status, current_step, due_at, estimated_completion_at, force_assign_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'new', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
      [requestId, trackingCode, input.customerId, service.id, input.priority === 'high' ? 'high' : 'normal',
        jsonStringify(formData), jsonStringify(snapshot), fee, discount, total, method, paymentStatus,
        estimatedCompletionAt, forceAssignAt, ts, ts],
    );
    await db.run(
      `INSERT INTO request_events (id, request_id, actor_id, actor_name, type, message, to_status, metadata, visible_to_customer, created_at)
       VALUES (?, ?, ?, ?, 'created', ?, 'new', ?, 1, ?)`,
      [id('evt'), requestId, actor?.id ?? input.customerId, actor?.name ?? customer.full_name,
        'درخواست شما ثبت شد و در صف بررسی قرار گرفت.', jsonStringify({ trackingCode }), ts],
    );
    if (input.existingInvoiceId) {
      const linked = await db.run(
        `UPDATE invoices SET request_id=?, updated_at=?
         WHERE id=? AND customer_id=? AND service_id=? AND request_id IS NULL AND status NOT IN ('void','draft')`,
        [requestId, ts, input.existingInvoiceId, input.customerId, service.id],
      );
      if (!linked.changes) throw conflict('فاکتور پیشنهاد هم‌زمان به پروندهٔ دیگری پیوند خورد؛ صفحه را تازه کنید و با پشتیبانی تماس بگیرید.');
      await db.run(
        `INSERT INTO request_events (id, request_id, actor_id, actor_name, type, message, metadata, visible_to_customer, created_at)
         VALUES (?, ?, ?, ?, 'invoice', ?, ?, 1, ?)`,
        [id('evt'), requestId, actor?.id ?? input.customerId, actor?.name ?? customer.full_name,
          `فاکتور ${toPersianDigits(existingInvoice.number)} به درخواست پیوند خورد.`,
          jsonStringify({ invoiceId: existingInvoice.id, total: Number(existingInvoice.total) }), ts],
      );
    }

    if (total > 0 && !input.existingInvoiceId) {
      createdInvoice = await createInvoice({
        customerId: input.customerId,
        requestId,
        serviceId: service.id,
        kind: service.isCustom ? 'custom' : 'public',
        title: `هزینه خدمت ${service.title}`,
        items: [{ title: service.title, qty: 1, unitPrice: fee, amount: fee }, ...(urgentFee ? [{title:'هزینه انجام فوری',qty:1,unitPrice:urgentFee,amount:urgentFee}] : [])],
        discount,
        notes: `شماره پیگیری ${trackingCode} — هزینه نمایشی است و پس از بررسی نهایی تأیید می‌شود.`,
      }, actor);
      await db.run(
        `INSERT INTO request_events (id, request_id, actor_id, actor_name, type, message, metadata, visible_to_customer, created_at)
         VALUES (?, ?, ?, ?, 'invoice', ?, ?, 1, ?)`,
        [id('evt'), requestId, actor?.id ?? input.customerId, actor?.name ?? customer.full_name,
          `پیش‌فاکتور ${toPersianDigits(createdInvoice.number)} صادر شد.`,
          jsonStringify({ invoiceId: createdInvoice.id, total: Number(createdInvoice.total) }), ts],
      );
    }

    // Redeem the discount code in the same transaction: if anything below
    // fails, the use is rolled back with the request itself.
    if (pricing.discountCode) {
      const preview = await previewDiscount({
        code: pricing.discountCode.code, customerId: input.customerId,
        serviceId: service.id, categoryId: service.categoryId,
        subtotal: Math.max(0, fee + urgentFee - pricing.discount),
      });
      await redeemDiscount({
        codeId: preview.codeId, customerId: input.customerId,
        requestId, invoiceId: createdInvoice?.id ?? null, amount: preview.amount,
      });
      await db.run(
        `INSERT INTO request_events (id, request_id, actor_id, actor_name, type, message, metadata, visible_to_customer, created_at)
         VALUES (?, ?, ?, ?, 'discount', ?, ?, 1, ?)`,
        [id('evt'), requestId, actor?.id ?? input.customerId, actor?.name ?? customer.full_name,
          `کد تخفیف «${preview.code}» اعمال شد.`,
          jsonStringify({ codeId: preview.codeId, code: preview.code, amount: preview.amount }), ts],
      );
    }

    // Wallet settlement happens in the same transaction as the request. If the
    // balance moved or the invoice could not be paid, the whole request is
    // rolled back: money is never taken without a case (and vice versa).
    if (method === 'wallet' && total > 0) {
      const targetInvoice = createdInvoice ?? existingInvoice;
      if (!targetInvoice) throw conflict('فاکتور قابل پرداخت برای این درخواست یافت نشد.');
      await settleInvoiceWithWallet(targetInvoice.id, input.customerId, {
        id: actor?.id ?? input.customerId,
        name: actor?.name ?? customer.full_name,
        ip: actor?.ip,
      });
    }
  });

  await run('UPDATE requests SET urgent_fee=? WHERE id=?',[urgentFee,requestId]);
  for (const document of documentAttachments.filter(item => !item.customerDocumentId)) {
    await attachDocument(requestId, document.fileId!, document.title,
      { id: actor?.id ?? input.customerId, name: actor?.name ?? customer.full_name }, 'customer',
      { ownerId: input.customerId, requirementKey: document.requirementKey });
    // Mirror the upload into the customer's profile archive, here rather than
    // in each client, so a document sent from the web and the same document
    // sent from the app both come back on the next request. `pending`, never
    // `approved`: the archive records that we hold the document, the reviewer
    // still decides whether it is any good.
    await archiveRequestDocument({
      customerId: input.customerId,
      fileId: document.fileId!,
      docType: documentTypeForRequirement(service, document.requirementKey),
      title: document.title,
      actor: { id: actor?.id ?? input.customerId, name: actor?.name ?? customer.full_name },
    });
  }
  for (const document of documentAttachments.filter(item => item.customerDocumentId)) {
    await reuseDocumentInRequest({ documentId: document.customerDocumentId!, requestId, customerId: input.customerId,
      confirm: document.confirmReuse === true, requirementKey: document.requirementKey,
      actor: { id: input.customerId, name: actor?.name ?? customer.full_name } });
  }

  const assignedTo = await autoAssign(requestId);
  // The customer is notified by the HTTP layer (with SMS). When nobody was
  // auto-assigned, the office roles must hear about the case so it cannot be
  // silently lost in the open pool.
  if (!assignedTo) {
    await notifyRole(['super_admin', 'manager'], {
      title: 'درخواست جدید در صف بررسی',
      body: `درخواست «${service.title}» (کد پیگیری ${toPersianDigits(trackingCode)}) ثبت شده و هنوز مسئولی ندارد.`,
      kind: 'info', link: '/admin/requests',
      idempotencyKey: `request-unassigned:${requestId}`,
    }).catch(() => undefined);
    // Ring the devices of everyone who could pick this case from the free
    // pool right now (Snapp-style): eligible + has free capacity. Best-effort.
    const candidates = await candidatesForService(service).catch(() => []);
    for (const candidate of candidates) {
      await notifyUser(candidate.id, {
        title: 'پروندهٔ تازه در صف آزاد',
        body: `«${service.title}» — کد پیگیری ${toPersianDigits(trackingCode)}`,
        kind: 'info', link: '/staff/queue', push: true,
        idempotencyKey: `queue:${requestId}:${candidate.id}`,
      }).catch(() => undefined);
    }
  }

  await writeAudit({
    actorId: actor?.id ?? input.customerId, actorName: actor?.name ?? customer.full_name,
    action: 'request.create', entityType: 'request', entityId: requestId,
    after: { trackingCode, serviceId: service.id, total, paymentMethod: method, paymentStatus }, ip: actor?.ip,
  });
  await logEvent({
    level: 'INFO', category: 'request', action: 'request.create', actorId: actor?.id ?? input.customerId,
    actorName: actor?.name ?? customer.full_name, ip: actor?.ip,
    entityType: 'request', entityId: requestId, transactionId: createdInvoice?.id ?? undefined,
    message: 'درخواست خدمت ثبت شد.',
    details: { trackingCode, serviceId: service.id, total, method, priority: input.priority ?? 'normal' },
  });
  if (idempotencyKey) {
    await run('UPDATE request_submission_keys SET request_id = ? WHERE customer_id = ? AND idempotency_key = ?',
      [requestId, input.customerId, idempotencyKey]);
  }

  return getRequest(requestId, { actorId: input.customerId, isCustomer: true });
 });
}

/* ---------------------------------- read ----------------------------------- */

export async function getRequest(requestId: string, viewer?: { actorId: string; isCustomer: boolean; canViewDocuments?: boolean }) {
  const row = await one<any>(`
    SELECT r.*, s.title AS service_title, s.slug AS service_slug, s.workflow_steps, s.is_custom,
           s.has_external_costs, s.external_costs_note, s.external_cost_items, s.requires_manager_approval,
           c.full_name AS customer_name, c.mobile AS customer_mobile, c.national_id AS customer_national_id,
           a.full_name AS assignee_name
    FROM requests r
    JOIN services s ON s.id = r.service_id
    JOIN users c ON c.id = r.customer_id
    LEFT JOIN users a ON a.id = r.assigned_to
    WHERE r.id = ?`, [requestId]);
  if (!row) return null;

  if (viewer?.isCustomer && row.customer_id !== viewer.actorId) return null;

  const canViewDocuments = !viewer || viewer.isCustomer || viewer.canViewDocuments !== false;
  const snapshot = jsonParse<any>(row.snapshot, {});
  const formData = jsonParse<Record<string, unknown>>(row.form_data, {});
  if (!canViewDocuments) {
    for (const field of Array.isArray(snapshot?.service?.form) ? snapshot.service.form : []) {
      if (field?.type === 'file' && typeof field.key === 'string') delete formData[field.key];
    }
  }
  const events = await q<any>(
    `SELECT id, actor_id, actor_name, type, message, from_status, to_status, metadata, created_at
     FROM request_events WHERE request_id = ? ${viewer?.isCustomer ? 'AND visible_to_customer = 1' : ''}
     ${!canViewDocuments ? "AND type <> 'document'" : ''}
     ORDER BY created_at ASC`,
    [requestId],
  );
  const documents = canViewDocuments ? await q<any>(
    `SELECT d.*, f.name AS file_name, f.mime AS mime, f.size AS size, f.storage_key,
            f.processing_status, f.processing_mode, f.preview_storage_key, f.original_storage_key,
            f.original_mime, f.original_size, f.savings_percent, f.width, f.height, f.processing_error
     FROM request_documents d JOIN files f ON f.id = d.file_id WHERE d.request_id = ? ORDER BY d.created_at ASC`,
    [requestId],
  ) : [];
  const documentReviews = documents.length
    ? await q<any>(`SELECT * FROM document_reviews WHERE request_document_id IN (${documents.map(() => '?').join(',')}) ORDER BY created_at ASC`, documents.map((document) => document.id))
    : [];
  const invoices = await q<any>('SELECT * FROM invoices WHERE request_id = ? ORDER BY created_at ASC', [requestId]);
  // "Your share from this case" for percentage staff; null for customers,
  // fixed-salary staff and anyone without a stake in this request.
  const earningPreview = viewer && !viewer.isCustomer
    ? (await earningsByRequest(viewer.actorId, [row]).catch(() => new Map())).get(row.id) ?? null
    : null;

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
    serviceRequiresApproval: Boolean(row.requires_manager_approval),
    assignedTo: row.assigned_to,
    assigneeName: row.assignee_name,
    earnings: earningPreview,
    formData,
    snapshot,
    workflow: jsonParse<any>(row.snapshot, {}).service?.workflow ?? jsonParse(row.workflow_steps, []),
    workBucket: row.work_bucket ?? deriveBucket(row.status, stepKindOf(row.snapshot, Number(row.current_step))),
    workBucketLabel: WORK_BUCKET_LABELS[(row.work_bucket as WorkBucket) ?? deriveBucket(row.status, stepKindOf(row.snapshot, Number(row.current_step)))] ?? null,
    currentStepKind: stepKindOf(row.snapshot, Number(row.current_step)),
    currentStepTitle: snapshotSteps(row.snapshot)[Math.max(0, Math.min(snapshotSteps(row.snapshot).length - 1, Number(row.current_step) || 0))]?.title ?? null,
    nextStepTitle: snapshotSteps(row.snapshot)[(Number(row.current_step) || 0) + 1]?.title ?? null,
    assignmentSource: !row.assigned_to ? null : (() => {
      const last = [...events].reverse().find((e) => e.type === 'assigned');
      if (!last) return 'manual';
      const meta = jsonParse<any>(last.metadata, {});
      if (meta?.forced) return 'forced';
      if (last.actor_id === row.assigned_to) return 'claimed';
      if (last.actor_id === 'system') return 'auto';
      return 'manual';
    })(),
    fee: Number(row.fee),
    discount: Number(row.discount),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    currentStep: Number(row.current_step),
    dueAt: row.due_at,
    deadlineAt: row.due_at,
    estimatedCompletionAt: row.estimated_completion_at,
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
      requirementKey: d.requirement_key ?? null,
      replacesDocumentId: d.replaces_document_id ?? null,
      reviewHistory: documentReviews.filter((review) => review.request_document_id === d.id).map((review) => ({
        decision: review.decision, note: review.note, reviewerName: review.reviewer_name, createdAt: review.created_at,
      })),
      documentType: d.document_type ?? null,
      customerDocumentId: d.customer_document_id ?? null,
      expiresAt: d.expires_at ?? null,
      file: {
        id: d.file_id, name: d.file_name, mime: d.mime, size: Number(d.size),
        originalSize: d.original_size === null || d.original_size === undefined ? Number(d.size) : Number(d.original_size),
        savingsPercent: Number(d.savings_percent ?? 0),
        width: d.width ?? null, height: d.height ?? null,
        previewUrl: d.preview_storage_key ? `/api/files/${d.file_id}?variant=preview` : null,
        originalUrl: `/api/files/${d.file_id}?variant=original`,
        displayUrl: `/api/files/${d.file_id}`,
        processing: {
          status: d.processing_status ?? 'none', mode: d.processing_mode ?? null, error: d.processing_error ?? null,
        },
      },
      createdAt: d.created_at,
    })),
    invoices: invoices.map((i) => ({
      id: i.id, number: i.number, title: i.title, purpose: i.purpose ?? 'service',
      total: Number(i.total), paidAmount: Number(i.paid_amount),
      status: i.status, issuedAt: i.issued_at,
    })),
    externalCosts: {
      enabled: Boolean(row.has_external_costs),
      note: row.has_external_costs
        ? (row.external_costs_note || 'در حین انجام این خدمت ممکن است مبالغی بابت هزینهٔ سازمان مربوطه لازم باشد که جزو حق‌الزحمهٔ دفتر نیست؛ مبلغ دقیق با فاکتور جداگانه در همین پرونده اعلام می‌شود.')
        : null,
      items: jsonParse<any[]>(row.external_cost_items, []),
    },
  };
}

export interface ListRequestsOptions {
  page?: number; pageSize?: number; customerId?: string; assignedTo?: string;
  status?: string; statusGroup?: 'open' | 'closed' | 'all'; search?: string; urgent?: boolean;
  serviceId?: string; unassigned?: boolean; from?: string; to?: string; bucket?: string;
  /** Staff viewer whose own per-request earnings are attached to each card. */
  viewerId?: string;
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
  if (opts.bucket && (WORK_BUCKETS as readonly string[]).includes(opts.bucket)) { where.push('r.work_bucket = ?'); args.push(opts.bucket); }
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

  const earningsMap = opts.viewerId
    ? await earningsByRequest(opts.viewerId, rows).catch(() => new Map())
    : new Map();

  return {
    items: rows.map((r) => ({
      id: r.id,
      trackingCode: r.tracking_code,
      status: r.status,
      workBucket: r.work_bucket ?? deriveBucket(r.status, stepKindOf(r.snapshot, Number(r.current_step))),
      workBucketLabel: WORK_BUCKET_LABELS[((r.work_bucket ?? deriveBucket(r.status, stepKindOf(r.snapshot, Number(r.current_step)))) as WorkBucket)] ?? null,
      currentStepKind: stepKindOf(r.snapshot, Number(r.current_step)),
      statusLabel: STATUS_LABELS[r.status as RequestStatus] ?? r.status,
      priority: r.priority,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerMobile: r.customer_mobile,
      serviceId: r.service_id,
      serviceTitle: r.service_title,
      assignedTo: r.assigned_to,
      assigneeName: r.assignee_name,
      earnings: earningsMap.get(r.id) ?? null,
      total: Number(r.total),
      paymentStatus: r.payment_status,
      dueAt: r.due_at,
      deadlineAt: r.due_at,
      estimatedCompletionAt: r.estimated_completion_at,
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
    const pending = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM request_documents d
      WHERE d.request_id=? AND d.status='pending'
        AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)`, [requestId]);
    if (Number(pending?.c ?? 0) > 0) throw conflict('مدارک این پرونده هنوز بررسی نشده‌اند.');
    if (!(await requiredDocumentsApproved(requestId, request.snapshot))) {
      throw conflict('هر یک از مدارک الزامی باید جداگانه در آخرین نسخه تأیید شده باشد.');
    }
  }

  if(['ready','completed'].includes(toStatus)){
    if(await one("SELECT id FROM request_handoffs WHERE request_id=? AND status='pending'",[requestId]))throw conflict('ابتدا ارجاع‌های باز مدیریت و حسابداری را بررسی کنید.');
    if(await one(`SELECT d.id FROM request_documents d WHERE d.request_id=? AND d.status='pending'
      AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id) LIMIT 1`,[requestId]))throw conflict('مدارک این پرونده هنوز بررسی نشده‌اند.');
    if(await one(`SELECT d.id FROM request_documents d WHERE d.request_id=? AND d.kind='staff' AND d.status<>'approved'
      AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id) LIMIT 1`,[requestId]))throw conflict('نتیجه کارکنان هنوز تأیید نشده است.');
    if(!(await requiredDocumentsApproved(requestId, request.snapshot)))throw conflict('هر یک از مدارک الزامی باید جداگانه در آخرین نسخه تأیید شده باشد.');
  }
  const ts = nowIso();
  const sets = ['status = ?', 'updated_at = ?'];
  const args: any[] = [toStatus, ts];
  if (toStatus === 'completed') { sets.push('completed_at = ?'); args.push(ts); }
  if (toStatus === 'cancelled') { sets.push('cancelled_at = ?'); args.push(ts); }
  if (toStatus === 'rejected') { sets.push('rejected_reason = ?'); args.push(note ?? ''); }
  if (toStatus === 'in_progress' && Number(request.current_step) === 0) { sets.push('current_step = 1'); }

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
  await refreshWorkBucket(requestId);
  return getRequest(requestId);
  });
}

/**
 * Move a case one workflow step forward (+1) or back (-1).
 *
 * The step list comes from the immutable snapshot, so editing the service
 * later never rewires live cases. Entering a "waiting on customer" step
 * mirrors the request status to `waiting_customer` (and back to
 * `in_progress` when leaving it) whenever the status machine allows it;
 * the work bucket always follows the step kind either way.
 */
export async function moveStep(
  requestId: string,
  direction: 1 | -1,
  actor: { id: string; name: string; ip?: string },
  note?: string,
) {
  return tx(async () => {
    await run('UPDATE requests SET updated_at=updated_at WHERE id=?', [requestId]);
    const request = await one<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId]);
    if (!request) throw notFound('درخواست یافت نشد.');
    if (['completed', 'cancelled', 'rejected'].includes(request.status)) {
      throw conflict('مراحل پروندهٔ بسته‌شده قابل تغییر نیست.');
    }
    const steps = snapshotSteps(request.snapshot);
    if (steps.length < 2) throw badRequest('برای این خدمت گردش‌کار چندمرحله‌ای تعریف نشده است.');
    const current = Math.max(0, Math.min(steps.length - 1, Number(request.current_step) || 0));
    const next = Math.max(0, Math.min(steps.length - 1, current + direction));
    if (next === current) {
      throw badRequest(direction > 0
        ? 'در آخرین مرحله هستید؛ برای پایان کار از تغییر وضعیت استفاده کنید.'
        : 'در اولین مرحله هستید.');
    }
    const fromStatus = request.status as RequestStatus;
    const nextKind = steps[next].kind;
    let toStatus: RequestStatus = fromStatus;
    const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
    if (nextKind === 'waiting_customer' && allowed.includes('waiting_customer')) toStatus = 'waiting_customer';
    else if ((fromStatus === 'waiting_customer' || fromStatus === 'waiting_documents') && allowed.includes('in_progress')) toStatus = 'in_progress';
    else if ((fromStatus === 'new' || fromStatus === 'assigned') && allowed.includes('in_progress')) toStatus = 'in_progress';

    const ts = nowIso();
    await run('UPDATE requests SET current_step = ?, status = ?, updated_at = ? WHERE id = ?',
      [next, toStatus, ts, requestId]);
    await addEvent({
      requestId, type: 'step', actorId: actor.id, actorName: actor.name,
      message: direction > 0
        ? `مرحلهٔ «${steps[current].title}» انجام شد؛ مرحلهٔ فعلی: «${steps[next].title}».`
        : `برگشت به مرحلهٔ «${steps[next].title}».`,
      fromStatus, toStatus, visibleToCustomer: true,
      metadata: { stepIndex: next, stepTitle: steps[next].title, stepKind: nextKind, direction, note: note ?? null },
    });
    if (note?.trim()) {
      await addEvent({
        requestId, type: 'note', actorId: actor.id, actorName: actor.name,
        message: note.trim(), visibleToCustomer: true,
      });
    }
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'request.step', entityType: 'request',
      entityId: requestId,
      before: { step: current, status: fromStatus }, after: { step: next, status: toStatus, kind: nextKind },
      ip: actor.ip,
    });
    await refreshWorkBucket(requestId);
    await notifyUser(request.customer_id, {
      title: 'مرحلهٔ پروندهٔ شما به‌روز شد',
      body: `مرحلهٔ فعلی: «${steps[next].title}»`,
      kind: 'info',
      link: `/app/requests/${requestId}`,
      push: true,
    }).catch(() => undefined);
    return getRequest(requestId);
  });
}

export async function setRequestDeadline(requestId: string, deadlineAt: string | null, actor: { id: string; name: string; ip?: string }) {
  return tx(async () => {
    await run('UPDATE requests SET updated_at=updated_at WHERE id=?', [requestId]);
    const request = await one<RequestRow>('SELECT * FROM requests WHERE id=?', [requestId]);
    if (!request) throw notFound('درخواست یافت نشد.');
    if (['completed', 'cancelled', 'rejected'].includes(request.status)) throw conflict('برای پرونده بسته نمی‌توان مهلت تعیین کرد.');
    const ts = nowIso();
    await run('UPDATE requests SET due_at=?, updated_at=? WHERE id=?', [deadlineAt, ts, requestId]);
    await addEvent({
      requestId, type: 'deadline', actorId: actor.id, actorName: actor.name,
      message: deadlineAt ? `مهلت قطعی پرونده تعیین شد: ${deadlineAt}` : 'مهلت قطعی پرونده برداشته شد.',
      metadata: { previousDeadlineAt: request.due_at, deadlineAt }, visibleToCustomer: true,
    });
    await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'request.deadline', entityType: 'request', entityId: requestId,
      before: { deadlineAt: request.due_at }, after: { deadlineAt }, ip: actor.ip });
    return getRequest(requestId);
  });
}

export async function assignRequest(requestId: string, staffId: string | null, actor: { id: string; name: string; ip?: string }) {
  const result = await tx(async () => {
    await run('UPDATE requests SET updated_at=updated_at WHERE id=?', [requestId]);
    const request = await one<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId]);
    if (!request) throw notFound('درخواست یافت نشد.');
    if (request.assigned_to === staffId) return getRequest(requestId);
    if (staffId) {
      const staff = await one<any>(
        `SELECT u.id FROM users u JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.id = ? AND u.kind = 'staff' AND u.status = 'active'`, [staffId],
      );
      if (!staff) throw badRequest('کارشناس انتخابی معتبر نیست.');
    }
    const newStatus = staffId
      ? request.status === 'new' ? 'assigned' : request.status
      : request.status === 'assigned' ? 'new' : request.status;
    const ts = nowIso();
    await run('UPDATE requests SET assigned_to = ?, assigned_at = ?, status = ?, updated_at = ? WHERE id = ?',
      [staffId, staffId ? ts : null, newStatus, ts, requestId]);
    await addEvent({
      requestId, type: 'assigned', actorId: actor.id, actorName: actor.name,
      message: staffId ? 'پرونده به کارشناس ارجاع شد.' : 'ارجاع پرونده برداشته شد.',
      fromStatus: request.status, toStatus: newStatus,
    });
    await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'request.assign', entityType: 'request', entityId: requestId,
      before: { staffId: request.assigned_to, status: request.status }, after: { staffId, status: newStatus }, ip: actor.ip });
    await refreshWorkBucket(requestId);
    return getRequest(requestId);
  });
  // A case can already hold confirmed payments (the customer paid before an
  // executor took it, or the previous executor was fixed-salary): sweep them
  // now so a percentage executor's income appears the moment they take over.
  if (staffId) {
    await accrueCommissionsForRequest(requestId).catch((error) => {
      logEvent({
        level: 'WARNING', category: 'payment', action: 'commission.sweep_failed', result: 'failure',
        entityType: 'request', entityId: requestId, message: String((error as Error)?.message ?? error),
      }).catch(() => undefined);
    });
  }
  return result;
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
  meta: { customerDocumentId?: string | null; documentType?: string | null; expiresAt?: string | null; requirementKey?: string | null; replacesDocumentId?: string | null; ownerId?: string; delivered?: boolean } = {},
) {
  return tx(async () => {
    await run('UPDATE requests SET updated_at=updated_at WHERE id=?', [requestId]);
    const file = await one<any>('SELECT * FROM files WHERE id = ?', [fileId]);
    if (!file) throw badRequest('فایل ارسالی یافت نشد.');
    const expectedOwner = kind === 'customer' ? meta.ownerId ?? actor.id : actor.id;
    if (file.owner_id !== expectedOwner) throw forbidden('فقط فایل بارگذاری‌شده توسط مالک پرونده قابل پیوست است.');
    if (Number(file.is_public)) throw badRequest('فایل عمومی نمی‌تواند به‌عنوان مدرک پرونده پیوست شود.');
    if (!String(file.mime).startsWith('image/') && file.mime !== 'application/pdf') throw badRequest('مدارک پرونده باید تصویر یا PDF باشند.');

    const request = await one<any>('SELECT status,snapshot FROM requests WHERE id = ?', [requestId]);
    if (!request) throw notFound('درخواست یافت نشد.');
    if (['completed', 'cancelled', 'rejected'].includes(request.status)) throw conflict('به این پرونده بسته‌شده نمی‌توان مدرک جدید افزود.');
    const existing = await one<any>('SELECT id FROM request_documents WHERE request_id = ? AND file_id = ?', [requestId, fileId]);
    if (existing) throw conflict('این فایل قبلاً به همین پرونده پیوست شده است.');

    if (kind === 'customer') {
      const service = jsonParse<any>(request.snapshot, {})?.service ?? {};
      const serviceDocuments = Array.isArray(service.documents) ? service.documents : [];
      const fileFields = Array.isArray(service.form) ? service.form.filter((field: any) => field?.type === 'file') : [];
      const validKeys = new Set<string>([
        ...serviceDocuments.map((document: any, index: number) => String(document?.key || `document_${index + 1}`)),
        ...fileFields.map((field: any) => `field:${String(field.key)}`),
      ]);
      if (validKeys.size && !meta.requirementKey) throw badRequest('برای پیوست‌کردن مدرک، نیازمندی مرتبط را انتخاب کنید.');
      if (meta.requirementKey && !validKeys.has(meta.requirementKey)) throw badRequest('شناسه مدرک با فرم زمان ثبت درخواست سازگار نیست.');
    }

    let replacesDocumentId: string | null = null;
    if (kind === 'customer' && meta.requirementKey) {
      const previous = await one<any>(`SELECT d.id,d.status FROM request_documents d
        WHERE d.request_id=? AND d.kind='customer' AND (d.requirement_key=? OR (d.requirement_key IS NULL AND d.title=?))
          AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)
        ORDER BY d.created_at DESC LIMIT 1`, [requestId, meta.requirementKey, title]);
      if (previous && previous.status !== 'rejected') throw conflict('برای این نیازمندی مدرک فعال وجود دارد؛ فقط پس از رد آن می‌توان نسخه جایگزین فرستاد.');
      replacesDocumentId = previous?.id ?? null;
    } else if (kind === 'staff') {
      let previous: any = null;
      if (meta.replacesDocumentId) {
        previous = await one<any>(`SELECT d.id,d.status,d.kind FROM request_documents d
          WHERE d.id=? AND d.request_id=? AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)`,
        [meta.replacesDocumentId, requestId]);
        if (!previous) throw notFound('نتیجهٔ ردشده برای جایگزینی در این پرونده پیدا نشد.');
      } else {
        const rejected = await q<any>(`SELECT d.id,d.title,d.status,d.kind FROM request_documents d
          WHERE d.request_id=? AND d.kind='staff' AND d.status='rejected'
            AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)
          ORDER BY d.created_at DESC`, [requestId]);
        const exact = rejected.filter((document) => document.title === title);
        if (exact.length === 1) previous = exact[0];
        else if (rejected.length === 1) previous = rejected[0];
        else if (rejected.length > 1) throw conflict('برای جایگزینی نتیجهٔ ردشده، شناسهٔ مدرک قبلی را مشخص کنید.');
      }
      if (previous && (previous.kind !== 'staff' || previous.status !== 'rejected')) {
        throw conflict('فقط نتیجهٔ ردشدهٔ همین پرونده را می‌توان جایگزین کرد.');
      }
      if (previous) replacesDocumentId = previous.id;
    }

    const ts = nowIso();
    const nextStatus = meta.delivered ? request.status : 'under_review';
    await run(
      `INSERT INTO request_documents (id, request_id, file_id, title, kind, status, created_at, customer_document_id, document_type, expires_at, requirement_key, replaces_document_id, reviewed_by, review_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('doc'), requestId, fileId, title, kind, meta.delivered ? 'approved' : 'pending', ts, meta.customerDocumentId ?? null, meta.documentType ?? null,
        meta.expiresAt ?? null, meta.requirementKey ?? null, replacesDocumentId,
        meta.delivered ? actor.id : null, meta.delivered ? 'تحویل مستقیم توسط مجری' : null],
    );
    await run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', [nextStatus, ts, requestId]);
    await addEvent({
      requestId, type: 'document', actorId: actor.id, actorName: actor.name,
      message: `مدرک «${title}» بارگذاری شد.`, metadata: { fileId, requirementKey: meta.requirementKey ?? null, replacesDocumentId },
      visibleToCustomer: kind === 'customer' || Boolean(meta.delivered),
    });
    if (nextStatus !== request.status) {
      await addEvent({ requestId, type: 'status', actorId: actor.id, actorName: actor.name,
        fromStatus: request.status, toStatus: nextStatus,
        message: 'مدارک جدید برای بررسی ارسال شد؛ پرونده دوباره در صف بازبینی قرار گرفت.' });
    }
    await refreshWorkBucket(requestId);
  });
}

async function requiredDocumentsApproved(requestId: string, snapshot: unknown) {
  const serviceSnapshot = jsonParse<any>(snapshot, {})?.service ?? {};
  const documents = Array.isArray(serviceSnapshot.documents) ? serviceSnapshot.documents : [];
  const formFields = Array.isArray(serviceSnapshot.form) ? serviceSnapshot.form : [];
  const requirements = [
    ...documents.flatMap((raw: any, index: number) => raw?.required ? [{
      key: typeof raw.key === 'string' && raw.key ? raw.key : `document_${index + 1}`,
      title: String(raw.title ?? ''),
    }] : []),
    ...formFields.filter((field: any) => field?.type === 'file' && field?.required).map((field: any) => ({
      key: `field:${String(field.key)}`, title: String(field.label ?? ''),
    })),
  ];
  for (const requirement of requirements) {
    const latest = await one<any>(`SELECT d.status FROM request_documents d
      WHERE d.request_id=? AND d.kind='customer' AND (d.requirement_key=? OR (d.requirement_key IS NULL AND d.title=?))
        AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)
      ORDER BY d.created_at DESC LIMIT 1`, [requestId, requirement.key, requirement.title]);
    if (!latest || latest.status !== 'approved') return false;
  }
  return true;
}

export async function reconcileAfterDocumentReview(requestId: string, actor: { id: string; name: string; ip?: string }) {
  const request = await one<RequestRow>('SELECT * FROM requests WHERE id=?', [requestId]);
  if (!request || !['waiting_documents', 'under_review'].includes(request.status)) return;
  const [pendingCustomer, pendingStaff, openHandoff, staffDocuments] = await Promise.all([
    one<any>(`SELECT COUNT(*) AS c FROM request_documents d WHERE d.request_id=? AND d.kind='customer' AND d.status='pending'
      AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)`, [requestId]),
    one<any>(`SELECT COUNT(*) AS c FROM request_documents d WHERE d.request_id=? AND d.kind='staff' AND d.status<>'approved'
      AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)`, [requestId]),
    one<any>("SELECT id FROM request_handoffs WHERE request_id=? AND status='pending' LIMIT 1", [requestId]),
    one<any>(`SELECT COUNT(*) AS c FROM request_documents d WHERE d.request_id=? AND d.kind='staff'
      AND NOT EXISTS (SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)`, [requestId]),
  ]);
  if (Number(pendingCustomer?.c ?? 0) > 0 || Number(pendingStaff?.c ?? 0) > 0 || openHandoff) return;
  if (!(await requiredDocumentsApproved(requestId, request.snapshot))) return;
  const nextStatus = Number(staffDocuments?.c ?? 0) > 0 ? 'ready' : 'in_progress';
  if (request.status === nextStatus) return;
  const ts = nowIso();
  await run('UPDATE requests SET status=?, updated_at=? WHERE id=?', [nextStatus, ts, requestId]);
  await addEvent({ requestId, type: 'status', actorId: actor.id, actorName: actor.name,
    fromStatus: request.status, toStatus: nextStatus,
    message: nextStatus === 'ready' ? 'مدارک و نتیجهٔ کار تأیید شد؛ پرونده آماده تحویل است.' : 'مدارک تأیید شد؛ رسیدگی پرونده ادامه می‌یابد.' });
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'request.document_review_reconciled', entityType: 'request', entityId: requestId,
    before: { status: request.status }, after: { status: nextStatus }, ip: actor.ip });
  await refreshWorkBucket(requestId);
}

export async function reviewDocument(
  documentId: string,
  decision: 'approved' | 'rejected',
  note: string | undefined,
  actor: { id: string; name: string; ip?: string },
) {
  return tx(async () => {
    const initialDoc = await one<any>('SELECT * FROM request_documents WHERE id = ?', [documentId]);
    if (!initialDoc) throw notFound('مدرک یافت نشد.');
    await run('UPDATE requests SET updated_at=updated_at WHERE id=?', [initialDoc.request_id]);
    const doc = await one<any>('SELECT * FROM request_documents WHERE id = ?', [documentId]);
    if (!doc) throw notFound('مدرک یافت نشد.');
    if (doc.status !== 'pending') throw conflict('فقط مدرکِ در انتظار بررسی قابل تصمیم‌گیری است.');
    if (decision === 'rejected' && (note ?? '').trim().length < 3) throw badRequest('برای رد مدرک، دلیل حداقل سه‌حرفی لازم است.');
    const request = await one<RequestRow>('SELECT * FROM requests WHERE id=?', [doc.request_id]);
    if (!request) throw notFound('درخواست یافت نشد.');
    const ts = nowIso();
    const cleanNote = note?.trim().slice(0, 1000) || null;
    const changed = await run("UPDATE request_documents SET status=?, reviewed_by=?, review_note=? WHERE id=? AND status='pending'",
      [decision, actor.id, cleanNote, documentId]);
    if (!changed.changes) throw conflict('این مدرک هم‌زمان توسط کاربر دیگری بررسی شد.');
    await run(`INSERT INTO document_reviews (id, request_document_id, customer_document_id, decision, note, reviewer_id, reviewer_name, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`, [id('drev'), documentId, decision, cleanNote, actor.id, actor.name, ts]);
    // If this exact customer file was saved under the explicitly configured
    // profile type, the expert's decision applies to that same copy as well.
    if (doc.kind === 'customer' && doc.requirement_key && !doc.customer_document_id) {
      const snapshot = jsonParse<any>(request.snapshot, {});
      const requirement = (snapshot?.service?.documents ?? []).find((item: any) => item.key === doc.requirement_key);
      if (requirement?.documentType && requirement.documentType !== 'other') {
        const archive = await one<any>(`SELECT id FROM customer_documents WHERE customer_id=? AND file_id=? AND doc_type=? AND status='pending'`,
          [request.customer_id, doc.file_id, requirement.documentType]);
        if (archive) await reviewCustomerDocument(archive.id, decision, cleanNote ?? undefined, actor);
      }
    }
    const eventId = await addEvent({
      requestId: doc.request_id, type: 'document', actorId: actor.id, actorName: actor.name,
      message: decision === 'approved' ? 'مدرک تأیید شد.' : `مدرک رد شد: ${cleanNote}`,
      metadata: { documentId, decision, note: cleanNote }, visibleToCustomer: doc.kind === 'customer',
    });

    if (decision === 'rejected' && doc.kind === 'customer') {
      const nextStatus = 'waiting_documents';
      if (!['completed', 'cancelled', 'rejected'].includes(request.status) && request.status !== nextStatus) {
        await run('UPDATE requests SET status=?, updated_at=? WHERE id=?', [nextStatus, ts, request.id]);
        await addEvent({ requestId: request.id, type: 'status', actorId: actor.id, actorName: actor.name,
          fromStatus: request.status, toStatus: nextStatus, message: 'مدرک نیازمند اصلاح است؛ پرونده تا بارگذاری مدرک جایگزین متوقف شد.' });
      }
    } else if (decision === 'rejected' && doc.kind === 'staff') {
      if (!['completed', 'cancelled', 'rejected'].includes(request.status) && request.status !== 'in_progress') {
        await run('UPDATE requests SET status=?, updated_at=? WHERE id=?', ['in_progress', ts, request.id]);
        await addEvent({ requestId: request.id, type: 'status', actorId: actor.id, actorName: actor.name,
          fromStatus: request.status, toStatus: 'in_progress', message: 'نتیجهٔ کار برای اصلاح برگشت داده شد.' });
      }
    } else {
      await reconcileAfterDocumentReview(request.id, actor);
    }
    await writeAudit({ actorId: actor.id, actorName: actor.name, action: `document.${decision}`, entityType: 'document', entityId: documentId,
      before: { status: doc.status }, after: { status: decision, note: cleanNote }, ip: actor.ip });
    await refreshWorkBucket(doc.request_id);
    return { eventId, requestId: doc.request_id, previousStatus: doc.status, kind: doc.kind };
  });
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

  const invoiceWhere = ["i.status IN ('issued','partially_paid')"];
  const invoiceArgs: string[] = [];
  if (scope.customerId) { invoiceWhere.push('r.customer_id = ?'); invoiceArgs.push(scope.customerId); }
  if (scope.assignedTo) { invoiceWhere.push('r.assigned_to = ?'); invoiceArgs.push(scope.assignedTo); }
  const unpaid = await one<{ total: number }>(
    `SELECT COALESCE(SUM(i.total - i.paid_amount),0) AS total FROM invoices i
     JOIN requests r ON r.id = i.request_id
     WHERE ${invoiceWhere.join(' AND ')}`,
    invoiceArgs,
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
export async function quoteRequest(serviceId: string, customerId: string, priority = 'normal', discountCode?: string) {
 const service = await getServiceById(serviceId);
 if (!service || (!service.isPublished && !service.isCustom) || !service.acceptingRequests || (service.isCustom && service.ownerCustomerId !== customerId)) throw notFound('این خدمت قابل درخواست نیست.');
 await requireCompleteProfile(customerId);
 await requireCoverage(serviceId,customerId);
 if (priority === 'high' && !service.urgentEnabled) throw badRequest('انجام فوری برای این خدمت فعال نیست.');
 const urgentFee = priority === 'high' ? Math.round(service.baseFee * service.urgentPercent / 100) : 0;
 const discount = Math.round(service.baseFee * service.discountPercent / 100);
 const subtotal = service.baseFee + urgentFee;
 // A discount code applies to what remains after the service's own discount;
 // previewing throws a customer-readable reason when the code cannot be used.
 const afterServiceDiscount = Math.max(0, subtotal - discount);
 const codePreview = discountCode?.trim()
   ? await previewDiscount({ code: discountCode, customerId, serviceId: service.id, categoryId: service.categoryId, subtotal: afterServiceDiscount })
   : null;
 const codeDiscount = codePreview?.amount ?? 0;
 const tax = Math.round((afterServiceDiscount - codeDiscount) * await getNumber('accounting.tax_percent') / 100);
 const active = await one<any>("SELECT COUNT(*) AS c FROM requests WHERE service_id=? AND priority='high' AND status NOT IN ('completed','cancelled','rejected')",[serviceId]);
 const estimatedMinutes=priority==='high'?service.urgentMinutes:service.estimatedMinutes;
 return {baseFee:service.baseFee,discount,codeDiscount,discountCode:codePreview ? {code:codePreview.code,title:codePreview.title,amount:codePreview.amount} : null,urgentFee,tax,total:afterServiceDiscount-codeDiscount+tax,currency:'IRR',estimatedMinutes,estimatedDays:Math.ceil(estimatedMinutes/1440),urgentAvailable:service.urgentEnabled && service.urgentCapacity>Number(active?.c),quotedAt:nowIso()};
}

/**
 * Queue for the open request pool.
 *
 * Privacy contract kept from before: customer identity, documents and phone
 * numbers never appear. Added in 1.4.0:
 *  - the remaining time until the request is forcibly assigned
 *  - the employee's own share, only for commission employees (a salaried
 *    employee must never see a percentage they do not earn)
 *  - the claim that somebody else already accepted it (server-side truth)
 */
export async function eligibleQueue(staffId: string) {
  const rows = await q<any>(
    `SELECT r.id, r.tracking_code, r.service_id, r.created_at, r.priority, r.status, r.total,
            r.estimated_completion_at, r.force_assign_at, s.title,
            (SELECT COALESCE(SUM(i.total - i.tax), 0) FROM invoices i WHERE i.request_id = r.id AND i.status <> 'void' AND i.purpose = 'service') AS net_total,
            (SELECT COUNT(*) FROM request_documents d WHERE d.request_id = r.id) AS docs_attached,
            cat.icon AS category_icon, cat.color AS category_color, cat.title AS category_title
     FROM requests r JOIN services s ON s.id = r.service_id
     LEFT JOIN service_categories cat ON cat.id = s.category_id
     WHERE r.assigned_to IS NULL AND r.status IN ('new','under_review')
       AND NOT EXISTS (SELECT 1 FROM request_declines dc WHERE dc.request_id = r.id AND dc.user_id = ?)
     ORDER BY CASE r.priority WHEN 'high' THEN 0 ELSE 1 END, r.created_at ASC LIMIT 200`,
    [staffId],
  );
  const type = await cooperationType(staffId);
  const result: any[] = [];
  for (const r of rows) {
    const service = await getServiceById(r.service_id);
    if (!service) continue;
    const eligible = (await candidatesForService(service)).some((candidate) => candidate.id === staffId);
    if (!eligible) continue;
    const officeRevenue = Number(r.net_total ?? 0) > 0 ? Number(r.net_total) : Math.max(0, Number(r.total ?? 0));
    const percent = type === 'commission' ? await commissionPercentFor(staffId, r.service_id) : 0;
    result.push({
      id: r.id,
      trackingCode: r.tracking_code,
      serviceTitle: r.title,
      categoryIcon: r.category_icon ?? null,
      categoryColor: r.category_color ?? null,
      categoryTitle: r.category_title ?? null,
      priority: r.priority,
      status: r.status,
      createdAt: r.created_at,
      estimatedCompletionAt: r.estimated_completion_at,
      // The moment this request leaves the open pool and is assigned by force.
      forceAssignAt: r.force_assign_at,
      remainingMinutes: r.estimated_completion_at
        ? Math.max(0, Math.round((Date.parse(r.estimated_completion_at) - Date.now()) / 60_000))
        : null,
      serviceEstimatedMinutes: service.estimatedMinutes,
      documentsRequired: (service.documents ?? []).filter((d: any) => d.required).length,
      documentsTotal: (service.documents ?? []).length,
      documentsAttached: Number(r.docs_attached ?? 0),
      cooperationType: type,
      // Only commission employees get an income preview; there is no number
      // to show for a fixed-salary employee (their pay is a monthly contract).
      earnings: type === 'commission'
        ? { percent, officeRevenue, amount: commissionAmount(officeRevenue, percent), estimate: true }
        : null,
    });
  }
  return result;
}

/**
 * Accept a request from the open pool.
 *
 * Concurrency safety is the conditional UPDATE at the end: two employees who
 * press the button at the same moment both run the check, but only one row
 * update can match `assigned_to IS NULL`. The loser gets a precise 409 message
 * naming who took it, and the attempt is recorded in `request_claim_attempts`.
 */
/**
 * Issue a mid-process organization-fee invoice on a case (e.g. the social
 * security premium the expert just looked up). The money is pass-through: it
 * never becomes office revenue and never feeds commissions. The case moves
 * to "waiting for customer" (when the state machine allows) and the customer
 * is told in-app + by SMS that a payable invoice is waiting on the case.
 */
/**
 * Daily nudge for cases parked in others' courts: when a case has been
 * waiting on the customer / an organization (or flagged follow-up) without
 * any change for longer than the configured threshold, remind the owner —
 * and, for customer-waiting cases, gently remind the customer too. One
 * reminder per case per Tehran day via notification idempotency keys.
 */
/** Decline a case in the open pool: it leaves only the decliner's queue.
 * Colleagues still see it and automatic assignment may still pick it up,
 * so declining can never starve a request of an owner. */
export async function declineRequest(requestId: string, staffId: string) {
  const row = await one<any>(
    "SELECT id FROM requests WHERE id=? AND assigned_to IS NULL AND status IN ('new','under_review')",
    [requestId],
  );
  if (!row) throw notFound('این درخواست دیگر در صف آزاد نیست.');
  const existing = await one<any>('SELECT request_id FROM request_declines WHERE request_id=? AND user_id=?', [requestId, staffId]);
  if (!existing) {
    await run('INSERT INTO request_declines (request_id, user_id, created_at) VALUES (?,?,?)', [requestId, staffId, nowIso()]);
  }
  return { declined: true };
}

export async function followUpReminderSweep() {
  if (!(await getBool('workforce.followup_reminder_enabled'))) return { reminded: 0, checked: 0 };
  const hours = Math.max(1, await getNumber('workforce.followup_after_hours'));
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = await q<any>(
    `SELECT r.id, r.tracking_code, r.assigned_to, r.customer_id, r.work_bucket, s.title AS service_title
     FROM requests r JOIN services s ON s.id = r.service_id
     WHERE r.assigned_to IS NOT NULL
       AND r.status NOT IN ('completed','cancelled','rejected')
       AND r.work_bucket IN ('waiting_customer','waiting_organization','followup')
       AND r.updated_at <= ?
     ORDER BY r.updated_at ASC LIMIT 100`,
    [cutoff],
  );
  let reminded = 0;
  for (const row of rows) {
    const day = tehranNow().date;
    const waitingLabel = row.work_bucket === 'waiting_customer' ? 'منتظر اقدام مشتری'
      : row.work_bucket === 'waiting_organization' ? 'منتظر پاسخ سازمان' : 'نیازمند پیگیری';
    await notifyUser(row.assigned_to, {
      title: 'یادآوری پیگیری پرونده',
      body: `پروندهٔ «${row.service_title}» (${toPersianDigits(row.tracking_code)}) بیش از ${toPersianDigits(String(hours))} ساعت است که ${waitingLabel} مانده و تغییری نکرده است.`,
      kind: 'warning',
      link: `/staff/requests/${row.id}`,
      idempotencyKey: `followup:${row.id}:${day}`,
    }).catch(() => undefined);
    if (row.work_bucket === 'waiting_customer') {
      await notifyUser(row.customer_id, {
        title: 'پروندهٔ شما منتظر اقدام شماست',
        body: `برای ادامهٔ «${row.service_title}» (کد پیگیری ${toPersianDigits(row.tracking_code)}) اقدامی از طرف شما لازم است؛ جزئیات در صفحهٔ پرونده آمده است.`,
        kind: 'info',
        link: `/app/requests/${row.id}`,
        idempotencyKey: `followup-customer:${row.id}:${day}`,
      }).catch(() => undefined);
    }
    reminded += 1;
  }
  return { reminded, checked: rows.length };
}

export async function createExternalCostInvoice(
  requestId: string,
  input: { title: string; amount: number; note?: string | null },
  actor: { id: string; name: string; ip?: string },
) {
  const request = await one<any>(
    `SELECT r.*, s.title AS service_title, s.is_custom FROM requests r
     JOIN services s ON s.id = r.service_id WHERE r.id = ?`,
    [requestId],
  );
  if (!request) throw notFound('درخواست یافت نشد.');
  if (['completed', 'cancelled', 'rejected'].includes(request.status)) {
    throw conflict('برای پروندهٔ بسته‌شده نمی‌توان فاکتور صادر کرد.');
  }
  const title = String(input.title ?? '').trim();
  const amount = Math.round(Number(input.amount ?? 0));
  if (title.length < 3) throw badRequest('عنوان هزینهٔ سازمانی را مشخص کنید (مثلاً «حق بیمه تأمین اجتماعی»).');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000_000) {
    throw badRequest('مبلغ هزینهٔ سازمانی نامعتبر است.');
  }

  const invoice: any = await createInvoice({
    customerId: request.customer_id,
    requestId,
    serviceId: request.service_id,
    kind: request.is_custom ? 'custom' : 'public',
    purpose: 'external_cost',
    title,
    items: [{ title, qty: 1, unitPrice: amount, amount }],
    notes: input.note?.trim() || 'هزینهٔ سازمانی مربوط به این پرونده؛ جزو حق‌الزحمهٔ دفتر نیست.',
  }, actor);

  await addEvent({
    requestId, type: 'invoice', actorId: actor.id, actorName: actor.name,
    message: `فاکتور هزینهٔ سازمانی صادر شد: «${title}» به مبلغ ${amount.toLocaleString('fa-IR')} ریال — منتظر پرداخت مشتری.`,
    metadata: { invoiceId: invoice.id, purpose: 'external_cost', amount },
  });

  // Park the case on the customer while this is unpaid, when allowed.
  if (request.status !== 'waiting_customer'
    && (ALLOWED_TRANSITIONS[request.status as RequestStatus] ?? []).includes('waiting_customer')) {
    await changeStatus(requestId, 'waiting_customer', actor,
      `در انتظار پرداخت هزینهٔ سازمانی توسط مشتری: «${title}»`).catch(() => undefined);
  }

  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'request.external_invoice',
    entityType: 'request', entityId: requestId,
    after: { invoiceId: invoice.id, title, amount }, ip: actor.ip,
  });

  const { notifyUser } = await import('../notifications/service.js');
  await notifyUser(request.customer_id, {
    title: 'فاکتور هزینهٔ سازمانی پروندهٔ شما صادر شد',
    body: `«${title}» به مبلغ ${amount.toLocaleString('fa-IR')} ریال — این مبلغ هزینهٔ سازمان مربوطه است و جزو حق‌الزحمه نیست. از صفحهٔ پرونده می‌توانید آن را پرداخت کنید تا کارتان ادامه پیدا کند.`,
    kind: 'warning',
    link: `/app/requests/${requestId}`,
    idempotencyKey: `external-invoice:${invoice.id}`,
    sms: { eventCode: 'invoice_created', variables: { invoice_number: String(invoice.number ?? ''), amount: String(amount) } },
  }).catch(() => undefined);

  return getRequest(requestId);
}

export async function claimRequest(requestId: string, staffId: string, name: string) {
  // The attempt log lives outside the transaction on purpose: a losing claim
  // is rolled back, but the evidence of "somebody else took it" must survive.
  let outcome: { result: string; reason?: string } = { result: 'invalid', reason: 'unexpected failure' };
  try {
    return await tx(async () => {
      await run('UPDATE users SET updated_at=updated_at WHERE id=?', [staffId]);
      const r = await one<any>('SELECT * FROM requests WHERE id=?', [requestId]);
      if (!r) {
        outcome = { result: 'invalid', reason: 'request not found' };
        throw notFound('پرونده یافت نشد.');
      }
      if (r.assigned_to) {
        const other = await one<any>('SELECT full_name FROM users WHERE id=?', [r.assigned_to]);
        outcome = { result: 'conflict', reason: `already assigned to ${other?.full_name ?? r.assigned_to}` };
        throw conflict(
          `این پرونده پیش‌تر${other?.full_name ? ` توسط ${other.full_name}` : ' توسط کارمند دیگری'} پذیرفته شده است.`,
          { assignedTo: r.assigned_to, assignedToName: other?.full_name ?? null, assignedAt: r.assigned_at ?? null },
        );
      }
      if (!['new', 'under_review'].includes(r.status)) {
        outcome = { result: 'invalid', reason: `status ${r.status}` };
        throw conflict('این پرونده در وضعیت قابل پذیرش نیست.');
      }
      const service = await getServiceById(r.service_id);
      const eligible = service ? (await candidatesForService(service)).some((candidate) => candidate.id === staffId) : false;
      if (!eligible) {
        outcome = { result: 'ineligible', reason: 'skill, shift or capacity' };
        throw forbidden('مهارت، شیفت یا ظرفیت لازم برای این خدمت را ندارید.');
      }
      const assignedAt = nowIso();
      const nextStatus = r.status === 'under_review' ? 'under_review' : 'assigned';
      const changed = await run(
        'UPDATE requests SET assigned_to=?,assigned_at=?,status=?,updated_at=?,force_assign_at=NULL WHERE id=? AND assigned_to IS NULL AND status=?',
        [staffId, assignedAt, nextStatus, assignedAt, requestId, r.status],
      );
      if (!changed.changes) {
        const winner = await one<any>('SELECT u.full_name FROM requests r JOIN users u ON u.id=r.assigned_to WHERE r.id=?', [requestId]);
        outcome = { result: 'conflict', reason: 'lost the race' };
        throw conflict(
          `این پرونده همین لحظه${winner?.full_name ? ` توسط ${winner.full_name}` : ' توسط کارمند دیگری'} پذیرفته شد و از صف شما حذف می‌شود.`,
          { assignedToName: winner?.full_name ?? null },
        );
      }
      await addEvent({
        requestId, type: 'assigned', actorId: staffId, actorName: name,
        message: `پرونده توسط ${name} پذیرفته شد.`, fromStatus: r.status, toStatus: nextStatus,
      });
      await writeAudit({
        actorId: staffId, actorName: name, action: 'request.claim', entityType: 'request', entityId: requestId,
        before: { staffId: null, status: r.status }, after: { staffId, status: nextStatus },
      });
      await logEvent({
        level: 'INFO', category: 'request', action: 'request.claim', result: 'success',
        actorId: staffId, actorName: name, entityType: 'request', entityId: requestId,
        message: 'پرونده از صف پذیرش برداشته شد.', details: { trackingCode: r.tracking_code },
      });
      outcome = { result: 'won' };
      await refreshWorkBucket(requestId);
      return { id: requestId, assignedAt, status: nextStatus };
    });
  } catch (error) {
    await run(
      `INSERT INTO request_claim_attempts (id,request_id,staff_id,staff_name,result,reason,created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [id('clm'), requestId, staffId, name, outcome.result, outcome.reason ?? null, nowIso()],
    ).catch(() => undefined);
    throw error;
  } finally {
    if (outcome.result === 'won') {
      await run(
        `INSERT INTO request_claim_attempts (id,request_id,staff_id,staff_name,result,reason,created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [id('clm'), requestId, staffId, name, 'won', null, nowIso()],
      ).catch(() => undefined);
      // The customer may have paid before anyone took the case: turn those
      // confirmed payments into this executor's income right away.
      await accrueCommissionsForRequest(requestId).catch((error) => {
        logEvent({
          level: 'WARNING', category: 'payment', action: 'commission.sweep_failed', result: 'failure',
          entityType: 'request', entityId: requestId, message: String((error as Error)?.message ?? error),
        }).catch(() => undefined);
      });
    }
  }
}

/** Failed claim attempts for a request — evidence for "who took it first". */
export async function claimAttempts(requestId: string) {
  return q<any>(
    'SELECT * FROM request_claim_attempts WHERE request_id=? ORDER BY created_at DESC LIMIT 50', [requestId],
  );
}

/**
 * Forced assignment of requests nobody accepted.
 *
 * Trigger: `force_assign_at` (2/3 of the service estimate by default, frozen on
 * the request when it was created). Prefers employees on a fixed salary, then
 * employees earning a percentage, then anyone eligible. Only employees who are
 * available are considered: acceptable capacity (`accepts_new_cases`), below
 * their active-case limit and — when `workforce.auto_assign_on_shift` is on —
 * checked in on today's shift.
 */
export async function forceAssignSweep(options: { now?: Date; limit?: number } = {}) {
  const enabled = await getBool('workforce.force_assign_enabled');
  if (!enabled) return { enabled: false, checked: 0, assigned: [], skipped: [] };
  const now = options.now ?? new Date();
  const at = now.toISOString();
  const rows = await q<any>(
    `SELECT * FROM requests
     WHERE assigned_to IS NULL AND status IN ('new','under_review')
       AND COALESCE(force_assign_at, estimated_completion_at) IS NOT NULL
       AND COALESCE(force_assign_at, estimated_completion_at) <= ?
     ORDER BY COALESCE(force_assign_at, estimated_completion_at) ASC LIMIT ?`,
    [at, options.limit ?? 25],
  );
  const assigned: any[] = [];
  const skipped: any[] = [];
  for (const request of rows) {
    const service = await getServiceById(request.service_id);
    if (!service) { skipped.push({ requestId: request.id, reason: 'service-missing' }); continue; }
    const candidates = await candidatesForService(service, { requireOnline: true });
    if (!candidates.length) {
      skipped.push({ requestId: request.id, reason: 'no-available-staff' });
      // The case must not silently rot in the pool: tell the managers (at most
      // once per Tehran day per case) so a human can place it manually.
      await notifyRole(['super_admin', 'manager'], {
        title: 'پروندهٔ بدون کارشناس از موعد واگذاری گذشته است',
        body: `درخواست «${service.title}» (کد پیگیری ${toPersianDigits(request.tracking_code)}) کارشناس واجد شرایط و آزاد ندارد و در صف مانده است.`,
        kind: 'warning', link: '/admin/requests?unassigned=true',
        idempotencyKey: `unassigned-overdue:${request.id}:${tehranNow().date}`,
      }).catch(() => undefined);
      continue;
    }
    const ranked: { id: string; name: string; load: number; onShift: boolean; type: string }[] = [];
    for (const candidate of candidates) {
      ranked.push({ ...candidate, type: await cooperationType(candidate.id) });
    }
    const priority = (type: string) => (type === 'monthly' ? 0 : type === 'commission' ? 1 : 2);
    // Fixed-salary staff first, but only those actually on shift/online; the
    // least loaded of them wins, then the same rule for percentage staff.
    ranked.sort((a, b) => priority(a.type) - priority(b.type)
      || Number(b.onShift) - Number(a.onShift)
      || a.load - b.load
      || a.id.localeCompare(b.id));
    const chosen = ranked[0];
    const assignedAt = nowIso();
    const nextStatus = request.status === 'under_review' ? 'under_review' : 'assigned';
    const changed = await run(
      `UPDATE requests SET assigned_to=?, assigned_at=?, status=?, updated_at=?,
              force_assigned_at=?, force_assign_reason=?, force_assign_at=NULL
       WHERE id=? AND assigned_to IS NULL AND status=?`,
      [chosen.id, assignedAt, nextStatus, assignedAt, assignedAt,
        `forced:${chosen.type}`, request.id, request.status],
    );
    if (!changed.changes) { skipped.push({ requestId: request.id, reason: 'claimed-concurrently' }); continue; }
    await addEvent({
      requestId: request.id, type: 'assigned', actorId: 'system', actorName: getSystemName(),
      message: `زمان پذیرش آزاد تمام شد؛ پرونده به‌صورت خودکار به ${chosen.name} واگذار شد.`,
      fromStatus: request.status, toStatus: nextStatus,
      metadata: { forced: true, cooperationType: chosen.type, load: chosen.load },
    });
    await writeAudit({
      actorId: 'system', actorName: getSystemName(), action: 'request.force_assign', entityType: 'request',
      entityId: request.id, before: { staffId: null }, after: { staffId: chosen.id, cooperationType: chosen.type },
    });
    await notifyUser(chosen.id, {
      title: 'پروندهٔ واگذارشدهٔ خودکار',
      body: `پروندهٔ «${service.title}» چون در زمان مقرر پذیرفته نشد به شما واگذار شد.`,
      kind: 'warning', link: '/staff/requests', idempotencyKey: `force-assign:${request.id}`,
    });
    await logEvent({
      level: 'INFO', category: 'staff', action: 'request.force_assign', result: 'success',
      message: 'واگذاری اجباری پرونده انجام شد.',
      entityType: 'request', entityId: request.id,
      details: { staffId: chosen.id, cooperationType: chosen.type, reason: 'deadline' },
    });
    await refreshWorkBucket(request.id);
    assigned.push({ requestId: request.id, staffId: chosen.id, staffName: chosen.name, cooperationType: chosen.type });
  }
  return { enabled: true, checked: rows.length, assigned, skipped };
}

function getSystemName() { return 'واگذاری خودکار پشکان'; }

export function nextStatuses(status:RequestStatus){return ALLOWED_TRANSITIONS[status]??[];}
