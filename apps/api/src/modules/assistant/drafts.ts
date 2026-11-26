/**
 * Guided request drafts.
 *
 * A draft is the assistant's proposal, not a request. It becomes a real
 * `requests` row only when the customer confirms it explicitly:
 *
 *   collecting → (all fields + all required documents present) → awaiting_confirmation
 *             → confirm → createRequest()
 *             → cancel  → deleted
 *
 * The server is the only authority for the transition. The language model may
 * fill fields and describe the preview, but it has no tool that can confirm;
 * a confirmation is only honoured when the client sends `action: "confirm"`
 * (or the customer types an unambiguous confirmation phrase) *and* the stored
 * draft is already in `awaiting_confirmation`. That makes "create a request"
 * impossible without the preview having been shown first.
 */
import { one, run, nowIso, jsonStringify, jsonParse } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { getBool, getNumber } from '../settings/service.js';
import { getServiceById, publishedCatalogue, type ServiceDTO } from '../catalog/service.js';
import { createRequest, previewRequestSubmission, quoteRequest } from '../requests/service.js';
import { profileAutofill } from '../profiles/autofill.js';
import { notifyUser } from '../notifications/service.js';
import { approvedDocumentsByType } from './customer.js';
import { listCustomerDocuments } from '../documents/service.js';
import type {
  AssistantDraft, AssistantDraftAttachment, AssistantDraftDocument, AssistantDraftField, AssistantDraftPricing,
} from './types.js';

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface DraftAttachmentInput {
  requirementKey: string;
  fileId?: string;
  customerDocumentId?: string;
  confirmReuse?: boolean;
}

export interface DraftState {
  draft: AssistantDraft;
  formData: Record<string, unknown>;
  /** Field keys whose value came from the profile (with the customer's consent). */
  profileFields: Record<string, boolean>;
  attachments: DraftAttachmentInput[];
  /** Slugs discussed recently, so "این یکی" can resolve after a suggestion. */
  recentServiceSlugs: string[];
  lastIntent: string;
  updatedAt: string;
}

interface CustomerActor { id: string; name: string; ip?: string }

export function emptyState(): DraftState {
  return {
    draft: {
      id: '',
      serviceId: '',
      serviceSlug: '',
      serviceTitle: '',
      categoryTitle: null,
      stage: 'collecting',
      fields: [],
      missingFields: [],
      documents: [],
      missingDocuments: [],
      estimatedMinutes: 0,
      estimatedDays: 0,
      urgentEnabled: false,
      urgentMinutes: 0,
      pricing: null,
      paymentMethod: 'online',
      priority: 'normal',
      useProfile: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
      requestId: null,
      trackingCode: null,
      submissionError: null,
      actions: [],
    },
    formData: {},
    profileFields: {},
    attachments: [],
    recentServiceSlugs: [],
    lastIntent: 'unknown',
    updatedAt: nowIso(),
  };
}

export async function loadDraftState(customerId: string): Promise<DraftState | null> {
  const row = await one<{ state: string; updated_at: string }>(
    'SELECT state, updated_at FROM assistant_drafts WHERE customer_id = ?', [customerId],
  );
  if (!row) return null;
  const parsed = jsonParse<any>(row.state, null) as Partial<DraftState> | null;
  if (!parsed?.draft) return null;
  const state: DraftState = {
    ...emptyState(),
    ...parsed,
    formData: parsed.formData ?? {},
    profileFields: parsed.profileFields ?? {},
    attachments: parsed.attachments ?? [],
    recentServiceSlugs: parsed.recentServiceSlugs ?? [],
  } as DraftState;
  if (new Date(state.draft.expiresAt).getTime() < Date.now()) {
    await clearDraft(customerId);
    return null;
  }
  return state;
}

export async function saveDraftState(customerId: string, state: DraftState): Promise<DraftState> {
  state.updatedAt = nowIso();
  state.draft.updatedAt = state.updatedAt;
  state.draft.expiresAt = new Date(Date.now() + DRAFT_TTL_MS).toISOString();
  await run(
    `INSERT INTO assistant_drafts (id, customer_id, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (customer_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    [state.draft.id || id('drf'), customerId, jsonStringify(state), state.draft.createdAt, state.updatedAt],
  );
  return state;
}

export async function clearDraft(customerId: string): Promise<void> {
  await run('DELETE FROM assistant_drafts WHERE customer_id = ?', [customerId]);
}

export function hasDraft(state: DraftState | null): state is DraftState {
  return Boolean(state?.draft?.serviceId);
}

/* ------------------------------- public shape ------------------------------ */

function fieldValue(state: DraftState, service: ServiceDTO, key: string): string {
  const value = state.formData[key];
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function publicPricing(state: DraftState, service: ServiceDTO): AssistantDraftPricing {
  const quoted = (state.draft.pricing ?? null) as AssistantDraftPricing | null;
  if (quoted) return quoted;
  return {
    baseFee: service.baseFee,
    discount: Math.round(service.baseFee * service.discountPercent / 100),
    urgentFee: state.draft.priority === 'high' ? Math.round(service.baseFee * service.urgentPercent / 100) : 0,
    total: service.finalFee + (state.draft.priority === 'high' ? Math.round(service.baseFee * service.urgentPercent / 100) : 0),
    currency: 'IRR',
  };
}

export function publicDraft(state: DraftState, service: ServiceDTO | null): AssistantDraft {
  const draft = state.draft;
  const fields: AssistantDraftField[] = (service?.form ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    value: fieldValue(state, service!, field.key),
    fromProfile: Boolean(state.profileFields[field.key]),
    ...(field.options ? { options: field.options } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.help ? { help: field.help } : {}),
  }));
  const documents: AssistantDraftDocument[] = (service?.documents ?? []).map((requirement) => {
    const attachment = state.attachments.find((item) => item.requirementKey === requirement.key);
    let mapped: AssistantDraftAttachment | null = null;
    if (attachment?.customerDocumentId) {
      mapped = { kind: 'profile', id: attachment.customerDocumentId, name: requirement.title };
    } else if (attachment?.fileId) {
      mapped = { kind: 'file', id: attachment.fileId, name: requirement.title };
    }
    return {
      key: requirement.key,
      title: requirement.title,
      required: requirement.required,
      ...(requirement.note ? { note: requirement.note } : {}),
      ...(requirement.documentType ? { documentType: requirement.documentType } : {}),
      attachment: mapped,
      suggestedProfileDocumentId: null,
      suggestedProfileDocumentName: null,
    };
  });
  const missingFields = fields.filter((field) => field.required && !field.value.trim()).map((field) => field.label);
  const missingDocuments = documents.filter((document) => document.required && !document.attachment).map((document) => document.title);
  return {
    ...draft,
    serviceTitle: service?.title ?? draft.serviceTitle,
    fields,
    documents,
    missingFields,
    missingDocuments,
    pricing: service ? publicPricing(state, service) : draft.pricing,
    actions: [
      ...(missingFields.length === 0 && missingDocuments.length === 0
        ? [{ id: 'confirm-draft', label: 'تأیید و ثبت درخواست', kind: 'confirm' as const, draftId: draft.id }]
        : []),
      { id: 'edit-draft', label: 'ویرایش اطلاعات', kind: 'edit' as const, draftId: draft.id },
      { id: 'cancel-draft', label: 'انصراف', kind: 'cancel' as const, draftId: draft.id },
    ],
  };
}

/* --------------------------------- lifecycle ------------------------------- */

async function visibleService(customerId: string, slugOrId: string): Promise<ServiceDTO> {
  const services = await publishedCatalogue({ customerId });
  const service = services.find((item) => item.slug === slugOrId || item.id === slugOrId);
  if (!service) throw notFound('این خدمت در کاتالوگ شما یافت نشد.');
  return service;
}

export async function startDraft(
  customerId: string,
  slugOrId: string,
  options: { useProfile?: boolean; priority?: 'normal' | 'high' } = {},
): Promise<{ state: DraftState; service: ServiceDTO }> {
  if (!(await getBool('assistant.request_submission'))) {
    throw badRequest('ثبت درخواست از طریق دستیار در تنظیمات غیرفعال است.');
  }
  const service = await visibleService(customerId, slugOrId);
  if (!service.acceptingRequests) throw conflict('این خدمت در حال حاضر درخواست نمی‌پذیرد.');
  const useProfile = Boolean(options.useProfile) && await getBool('assistant.profile_autofill');
  const base = emptyState();
  base.draft.id = id('drf');
  base.draft.serviceId = service.id;
  base.draft.serviceSlug = service.slug;
  base.draft.serviceTitle = service.title;
  base.draft.categoryTitle = service.categoryTitle ?? null;
  base.draft.priority = options.priority === 'high' && service.urgentEnabled ? 'high' : 'normal';
  base.draft.urgentEnabled = service.urgentEnabled;
  base.draft.urgentMinutes = service.urgentMinutes;
  base.draft.useProfile = useProfile;
  base.recentServiceSlugs = [service.slug];

  if (useProfile) {
    const autofill = await profileAutofill(customerId).catch(() => ({ values: {} as Record<string, string> }));
    const fromProfile: Record<string, boolean> = {};
    for (const field of service.form) {
      const value = autofill.values[field.key];
      if (value && !['file', 'checkbox'].includes(field.type)) {
        base.formData[field.key] = value;
        fromProfile[field.key] = true;
      }
    }
    base.profileFields = fromProfile;
    // Approved profile documents may satisfy matching requirements — but only
    // because the customer explicitly allowed using their profile data.
    const documents = await listCustomerDocuments(customerId).catch(() => []);
    const byType = approvedDocumentsByType(documents);
    for (const requirement of service.documents) {
      if (!requirement.required || !requirement.documentType) continue;
      const candidate = (byType.get(requirement.documentType) ?? [])[0];
      if (candidate) {
        base.attachments.push({
          requirementKey: requirement.key,
          customerDocumentId: candidate.id,
          confirmReuse: true,
        });
      }
    }
  }
  const state = await refresh(customerId, base, service);
  return { state: await saveDraftState(customerId, state), service };
}

export async function setDraftField(
  customerId: string,
  state: DraftState,
  service: ServiceDTO,
  key: string,
  value: unknown,
): Promise<DraftState> {
  const field = service.form.find((item) => item.key === key);
  if (!field) throw badRequest(`فیلدی با کلید «${key}» در این خدمت وجود ندارد.`);
  if (field.type === 'checkbox') {
    state.formData[key] = value === true || value === 'true' || value === 1 || value === '1';
  } else if (field.type === 'number' || field.type === 'money') {
    const numeric = Number(String(value).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^0-9.-]/g, ''));
    state.formData[key] = Number.isFinite(numeric) ? numeric : value;
  } else {
    state.formData[key] = String(value).slice(0, 5000);
  }
  delete state.profileFields[key];
  return saveDraftState(customerId, await refresh(customerId, state, service));
}

export async function attachDraftDocument(
  customerId: string,
  state: DraftState,
  service: ServiceDTO,
  input: { requirementKey: string; fileId?: string; customerDocumentId?: string },
): Promise<DraftState> {
  const requirement = service.documents.find((item) => item.key === input.requirementKey);
  if (!requirement) throw badRequest('این مدرک در فهرست مدارک خدمت وجود ندارد.');
  if (Boolean(input.fileId) === Boolean(input.customerDocumentId)) {
    throw badRequest('برای پیوست مدرک، فایل یا مدرک پروفایل را مشخص کنید.');
  }
  if (input.fileId) {
    const file = await one<any>('SELECT id, owner_id, mime, is_public FROM files WHERE id = ?', [input.fileId]);
    if (!file) throw badRequest('فایل بارگذاری‌شده یافت نشد.');
    if (file.owner_id !== customerId) throw badRequest('فقط فایل بارگذاری‌شده با حساب خودتان قابل استفاده است.');
    if (Number(file.is_public)) throw badRequest('فایل عمومی نمی‌تواند مدرک درخواست باشد.');
    if (!String(file.mime).startsWith('image/') && file.mime !== 'application/pdf') {
      throw badRequest('مدارک درخواست باید تصویر یا PDF باشند.');
    }
  } else {
    const document = await one<any>('SELECT id, customer_id, status, expires_at FROM customer_documents WHERE id = ?', [input.customerDocumentId]);
    if (!document || document.customer_id !== customerId) throw badRequest('مدرک پروفایل یافت نشد.');
    if (document.status !== 'approved') throw badRequest('فقط مدارک تأییدشدهٔ پروفایل قابل استفاده هستند.');
  }
  const next = state.attachments.filter((item) => item.requirementKey !== input.requirementKey);
  next.push({
    requirementKey: input.requirementKey,
    ...(input.fileId ? { fileId: input.fileId } : {}),
    ...(input.customerDocumentId ? { customerDocumentId: input.customerDocumentId, confirmReuse: true } : {}),
  });
  state.attachments = next;
  return saveDraftState(customerId, await refresh(customerId, state, service));
}

export async function refresh(customerId: string, state: DraftState, service: ServiceDTO): Promise<DraftState> {
  const draft = publicDraft(state, service);
  state.draft.fields = draft.fields;
  state.draft.documents = draft.documents;
  state.draft.missingFields = draft.missingFields;
  state.draft.missingDocuments = draft.missingDocuments;
  state.draft.estimatedMinutes = state.draft.priority === 'high' ? service.urgentMinutes : service.estimatedMinutes;
  state.draft.estimatedDays = Math.max(1, Math.ceil(state.draft.estimatedMinutes / 1440));
  try {
    const quote = await quoteRequest(service.id, customerId, state.draft.priority);
    state.draft.pricing = {
      baseFee: quote.baseFee, discount: quote.discount, urgentFee: quote.urgentFee,
      total: quote.total, currency: quote.currency,
    };
  } catch {
    state.draft.pricing = null;
  }
  const submission = await previewRequestSubmission(service, state.formData, state.attachments, customerId);
  state.draft.submissionError = submission.errors.length
    ? submission.errors.map((error) => error.message).join('؛ ')
    : null;
  const complete = draft.missingFields.length === 0 && draft.missingDocuments.length === 0 && submission.errors.length === 0;
  state.draft.stage = complete ? 'awaiting_confirmation' : 'collecting';
  state.draft.actions = draft.actions;
  return state;
}

export async function confirmDraft(
  customerId: string,
  state: DraftState,
  service: ServiceDTO,
  actor: CustomerActor,
): Promise<{ state: DraftState; request: any }> {
  if (state.draft.stage !== 'awaiting_confirmation') {
    throw badRequest('پیش از ثبت درخواست، پیش‌نمایش کامل را ببینید و سپس تأیید کنید.');
  }
  const submission = await previewRequestSubmission(service, state.formData, state.attachments, customerId);
  if (submission.errors.length) {
    state.draft.submissionError = submission.errors.map((error) => error.message).join('؛ ');
    state.draft.stage = 'collecting';
    await saveDraftState(customerId, state);
    throw badRequest('اطلاعات درخواست کامل یا معتبر نیست.', submission.errors);
  }
  const request = await createRequest({
    serviceId: service.id,
    customerId,
    formData: state.formData,
    paymentMethod: state.draft.paymentMethod,
    priority: state.draft.priority,
    documentIds: state.attachments.map((item) => ({
      ...(item.fileId ? { fileId: item.fileId } : {}),
      ...(item.customerDocumentId ? { customerDocumentId: item.customerDocumentId } : {}),
      confirmReuse: item.confirmReuse === true,
      requirementKey: item.requirementKey,
    })),
    idempotencyKey: `assistant-${state.draft.id}`,
  }, actor);
  if (!request) throw badRequest('ثبت درخواست انجام نشد؛ دوباره تلاش کنید.');

  state.draft.stage = 'submitted';
  state.draft.requestId = request.id;
  state.draft.trackingCode = request.trackingCode;
  state.draft.submissionError = null;
  state.draft.actions = [
    { id: 'open-request', label: 'مشاهده پرونده', kind: 'link', route: `/app/requests/${request.id}`, href: `/app/requests/${request.id}` },
  ];
  await clearDraft(customerId);
  await notifyUser(customerId, {
    title: 'درخواست شما ثبت شد',
    body: `شماره پیگیری ${request.trackingCode} — ${request.serviceTitle}`,
    kind: 'success',
    link: `/app/requests/${request.id}`,
    idempotencyKey: `request:${request.id}:created`,
    sms: { eventCode: 'request_created', variables: { tracking_code: request.trackingCode, service_title: request.serviceTitle } },
  }).catch(() => undefined);
  return { state, request };
}

/* --------------------------------- helpers --------------------------------- */

export async function draftService(state: DraftState): Promise<ServiceDTO | null> {
  if (!state.draft.serviceId) return null;
  return getServiceById(state.draft.serviceId);
}
