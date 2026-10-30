import { one, q, run, tx, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { writeAudit } from '../audit/service.js';
import { fileShape, getFile, loadMediaConfig, type FileRow } from '../media/service.js';

/**
 * Profile-level document archive.
 *
 * A customer uploads an identity paper once; it is linked to their profile and
 * can be reused in later cases. Reuse is never silent: the customer confirms it
 * and the validity window is checked every single time.
 */

export const DOCUMENT_TYPES = [
  { code: 'national_card', label: 'کارت ملی', validityDays: 0 },
  { code: 'birth_certificate', label: 'شناسنامه', validityDays: 0 },
  { code: 'passport', label: 'گذرنامه', validityDays: 1825 },
  { code: 'residence_permit', label: 'مجوز اقامت', validityDays: 365 },
  { code: 'insurance_card', label: 'کارت بیمه', validityDays: 365 },
  { code: 'business_license', label: 'پروانه کسب', validityDays: 365 },
  { code: 'utility_bill', label: 'قبض خدمات (نشانی)', validityDays: 120 },
  { code: 'personal_photo', label: 'عکس پرسنلی', validityDays: 180 },
  { code: 'bank_card', label: 'کارت بانکی', validityDays: 365 },
  { code: 'other', label: 'سایر مدارک', validityDays: 365 },
] as const;

export type DocumentTypeCode = (typeof DOCUMENT_TYPES)[number]['code'];
export const DOCUMENT_TYPE_CODES = DOCUMENT_TYPES.map((type) => type.code) as unknown as [DocumentTypeCode, ...DocumentTypeCode[]];

export function documentTypeLabel(code: string): string {
  return DOCUMENT_TYPES.find((type) => type.code === code)?.label ?? code;
}

function defaultValidityDays(code: string, fallback: number): number {
  const found = DOCUMENT_TYPES.find((type) => type.code === code);
  if (!found) return fallback;
  return found.validityDays;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export type ValidityState = 'none' | 'valid' | 'expiring' | 'expired';

function validityState(expiresAt: string | null): ValidityState {
  if (!expiresAt) return 'none';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diff)) return 'none';
  if (diff <= 0) return 'expired';
  if (diff <= 30 * 86_400_000) return 'expiring';
  return 'valid';
}

export interface CustomerDocumentRow {
  id: string;
  customer_id: string;
  file_id: string;
  doc_type: string;
  title: string | null;
  status: string;
  issued_at: string | null;
  expires_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_note: string | null;
  request_id: string | null;
  reused_from: string | null;
  created_at: string;
  updated_at: string;
}

const DOC_SELECT = `SELECT d.*, f.name AS file_name, f.mime AS file_mime, f.size AS file_size,
  f.processing_status, f.processing_mode, f.processing_error, f.processing_attempts, f.processed_at,
  f.preview_storage_key, f.original_storage_key, f.original_mime, f.original_size,
  f.width, f.height, f.original_width, f.original_height, f.savings_percent, f.quality_score,
  f.is_public, f.purpose, f.created_at AS file_created_at, f.storage_key, f.sha256
  FROM customer_documents d JOIN files f ON f.id = d.file_id`;

function mapDocument(row: any, options: { includeAccessUrls: boolean }) {
  const file: FileRow = {
    id: row.file_id, owner_id: row.customer_id, name: row.file_name, mime: row.file_mime,
    size: Number(row.file_size), storage_key: row.storage_key, sha256: row.sha256,
    is_public: Number(row.is_public ?? 0), purpose: row.purpose, created_at: row.file_created_at,
    original_storage_key: row.original_storage_key, original_mime: row.original_mime,
    original_size: row.original_size, processing_status: row.processing_status,
    processing_mode: row.processing_mode, processing_error: row.processing_error,
    processing_attempts: row.processing_attempts, processed_at: row.processed_at,
    preview_storage_key: row.preview_storage_key, width: row.width, height: row.height,
    original_width: row.original_width, original_height: row.original_height,
    savings_percent: row.savings_percent, quality_score: row.quality_score,
    deduplicated_from: null,
  };
  const shape = fileShape(file);
  return {
    id: row.id,
    customerId: row.customer_id,
    docType: row.doc_type,
    docTypeLabel: documentTypeLabel(row.doc_type),
    title: row.title,
    status: row.status,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    validity: validityState(row.expires_at ?? null),
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    reviewNote: row.review_note,
    requestId: row.request_id,
    reusedFrom: row.reused_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    file: options.includeAccessUrls ? shape : { ...shape, displayUrl: null, previewUrl: null, originalUrl: null },
  };
}

export async function listCustomerDocuments(customerId: string, options: { includeAccessUrls?: boolean } = {}) {
  const rows = await q<any>(`${DOC_SELECT} WHERE d.customer_id = ? ORDER BY d.created_at DESC`, [customerId]);
  return rows.map((row) => mapDocument(row, { includeAccessUrls: options.includeAccessUrls !== false }));
}

export async function getCustomerDocument(documentId: string): Promise<any | null> {
  const row = await one<any>(`${DOC_SELECT} WHERE d.id = ?`, [documentId]);
  return row ? mapDocument(row, { includeAccessUrls: true }) : null;
}

export async function countCustomerDocumentsByType(customerId: string) {
  const rows = await q<any>(
    'SELECT doc_type, status, COUNT(*) AS c FROM customer_documents WHERE customer_id = ? GROUP BY doc_type, status',
    [customerId],
  );
  const result: Record<string, { total: number; approved: number; pending: number; rejected: number }> = {};
  for (const row of rows) {
    const entry = result[row.doc_type] ?? { total: 0, approved: 0, pending: 0, rejected: 0 };
    entry.total += Number(row.c);
    if (row.status === 'approved') entry.approved += Number(row.c);
    if (row.status === 'pending') entry.pending += Number(row.c);
    if (row.status === 'rejected') entry.rejected += Number(row.c);
    result[row.doc_type] = entry;
  }
  return result;
}

export interface AddDocumentInput {
  customerId: string;
  fileId: string;
  docType: string;
  title?: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
}

export async function addCustomerDocument(input: AddDocumentInput, actor: { id: string; name: string; ip?: string }) {
  const config = await loadMediaConfig();
  const file = await getFile(input.fileId);
  if (!file) throw notFound('فایل ارسالی یافت نشد.');
  if (file.owner_id !== input.customerId) throw forbidden('فقط فایل بارگذاری‌شده توسط خودتان قابل ثبت است.');
  if (file.is_public) throw badRequest('فایل عمومی نمی‌تواند به‌عنوان مدرک پروفایل ثبت شود.');
  if (!file.mime.startsWith('image/') && file.mime !== 'application/pdf') {
    throw badRequest('مدارک پروفایل باید تصویر یا PDF باشند.');
  }
  const existing = await one<any>(
    'SELECT id FROM customer_documents WHERE file_id = ? AND customer_id = ?',
    [file.id, input.customerId],
  );
  if (existing) throw conflict('این فایل قبلاً به مدارک پروفایل اضافه شده است.');

  const now = nowIso();
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : null;
  if (issuedAt && Number.isNaN(issuedAt.getTime())) throw badRequest('تاریخ صدور مدرک معتبر نیست.');
  if (issuedAt && issuedAt.getTime() > Date.now() + 86_400_000) throw badRequest('تاریخ صدور نمی‌تواند در آینده باشد.');
  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) throw badRequest('تاریخ انقضای مدرک معتبر نیست.');
    expiresAt = parsed.toISOString();
  } else {
    const validity = defaultValidityDays(input.docType, config.documentDefaultValidityDays);
    if (validity > 0) expiresAt = addDays(issuedAt ? issuedAt.toISOString() : now, validity);
  }
  if (expiresAt && issuedAt && new Date(expiresAt).getTime() <= issuedAt.getTime()) {
    throw badRequest('تاریخ انقضا باید بعد از تاریخ صدور باشد.');
  }

  const documentId = id('cdoc');
  await run(
    `INSERT INTO customer_documents (id, customer_id, file_id, doc_type, title, status, issued_at, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [documentId, input.customerId, file.id, input.docType,
      input.title?.slice(0, 200) ?? documentTypeLabel(input.docType), issuedAt?.toISOString() ?? null, expiresAt, now, now],
  );
  await run('UPDATE files SET purpose = ? WHERE id = ?', ['profile_document', file.id]);
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'customer_document.create',
    entityType: 'customer_document', entityId: documentId,
    after: { docType: input.docType, fileId: file.id, expiresAt }, ip: actor.ip,
  });
  return (await getCustomerDocument(documentId))!;
}

export async function reviewCustomerDocument(
  documentId: string,
  decision: 'approved' | 'rejected',
  note: string | undefined,
  actor: { id: string; name: string; ip?: string },
) {
  const doc = await one<CustomerDocumentRow>('SELECT * FROM customer_documents WHERE id = ?', [documentId]);
  if (!doc) throw notFound('مدرک پروفایل یافت نشد.');
  await run(
    'UPDATE customer_documents SET status = ?, verified_by = ?, verified_at = ?, review_note = ?, updated_at = ? WHERE id = ?',
    [decision, actor.id, nowIso(), note?.slice(0, 1000) ?? null, nowIso(), documentId],
  );
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'customer_document.review',
    entityType: 'customer_document', entityId: documentId,
    before: { status: doc.status }, after: { status: decision, note: note ?? null }, ip: actor.ip,
  });
  return (await getCustomerDocument(documentId))!;
}

export async function deleteCustomerDocument(documentId: string, customerId: string, actor: { id: string; name: string }) {
  const doc = await one<CustomerDocumentRow>('SELECT * FROM customer_documents WHERE id = ?', [documentId]);
  // Do not disclose whether another customer's document exists.
  if (!doc || doc.customer_id !== customerId) throw notFound('مدرک پروفایل یافت نشد.');
  const used = await one<any>(
    `SELECT d.id FROM request_documents d JOIN requests r ON r.id = d.request_id
     WHERE d.customer_document_id = ? AND r.status NOT IN ('completed','cancelled','rejected') LIMIT 1`,
    [documentId],
  );
  if (used) throw conflict('این مدرک در پرونده در جریان استفاده شده و حذف نمی‌شود.');
  await run('DELETE FROM customer_documents WHERE id = ?', [documentId]);
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'customer_document.delete',
    entityType: 'customer_document', entityId: documentId, before: { docType: doc.doc_type }, ip: undefined,
  });
}

export interface ReuseResult {
  documentId: string;
  requestId: string;
  expiresAt: string | null;
}

/**
 * Attach an archived profile document to one of the customer's own requests.
 * Requires explicit confirmation and refuses expired/rejected documents.
 */
export async function reuseDocumentInRequest(input: {
  documentId: string;
  requestId: string;
  customerId: string;
  confirm: boolean;
  actor: { id: string; name: string };
}): Promise<ReuseResult> {
  const config = await loadMediaConfig();
  if (config.requireReuseConfirmation && !input.confirm) {
    throw badRequest('برای استفاده دوباره از مدرک، تأیید صریح مشتری لازم است.');
  }
  const doc = await one<CustomerDocumentRow>('SELECT * FROM customer_documents WHERE id = ?', [input.documentId]);
  if (!doc) throw notFound('مدرک پروفایل یافت نشد.');
  if (doc.customer_id !== input.customerId) throw forbidden('این مدرک به حساب شما تعلق ندارد.');
  if (doc.status === 'rejected') throw conflict('این مدرک رد شده است و باید مدرک جدید بارگذاری شود.');
  const state = validityState(doc.expires_at);
  if (state === 'expired') {
    throw conflict('اعتبار این مدرک به پایان رسیده است؛ لطفاً مدرک تازه بارگذاری کنید.');
  }
  const request = await one<any>('SELECT id, customer_id, status FROM requests WHERE id = ?', [input.requestId]);
  if (!request) throw notFound('درخواست یافت نشد.');
  if (request.customer_id !== input.customerId) throw forbidden('این درخواست به حساب شما تعلق ندارد.');
  if (['completed', 'cancelled', 'rejected'].includes(request.status)) {
    throw conflict('به این پرونده بسته‌شده نمی‌توان مدرک جدید افزود.');
  }
  const duplicate = await one<any>(
    'SELECT id FROM request_documents WHERE request_id = ? AND customer_document_id = ? LIMIT 1',
    [input.requestId, input.documentId],
  );
  if (duplicate) throw conflict('این مدرک قبلاً به همین پرونده پیوست شده است.');

  const requestDocumentId = id('doc');
  const now = nowIso();
  await tx(async (db) => {
    await db.run(
      `INSERT INTO request_documents (id, request_id, file_id, title, kind, status, created_at, customer_document_id, document_type, expires_at)
       VALUES (?, ?, ?, ?, 'customer', 'pending', ?, ?, ?, ?)`,
      [requestDocumentId, input.requestId, doc.file_id,
        doc.title ?? documentTypeLabel(doc.doc_type), now, doc.id, doc.doc_type, doc.expires_at],
    );
    await db.run(
      `INSERT INTO request_events (id, request_id, actor_id, actor_name, type, message, metadata, visible_to_customer, created_at)
       VALUES (?, ?, ?, ?, 'document', ?, ?, 1, ?)`,
      [id('evt'), input.requestId, input.actor.id, input.actor.name,
        `مدرک «${doc.title ?? documentTypeLabel(doc.doc_type)}» از مدارک پروفایل با تأیید مشتری به پرونده پیوست شد.`,
        JSON.stringify({ fileId: doc.file_id, customerDocumentId: doc.id }), now],
    );
    await db.run('UPDATE requests SET updated_at = ? WHERE id = ?', [now, input.requestId]);
    await db.run('UPDATE customer_documents SET request_id = COALESCE(request_id, ?), updated_at = ? WHERE id = ?', [input.requestId, now, doc.id]);
  });
  await writeAudit({
    actorId: input.actor.id, actorName: input.actor.name, action: 'customer_document.reuse',
    entityType: 'request_document', entityId: requestDocumentId,
    after: { customerDocumentId: doc.id, requestId: input.requestId, expiresAt: doc.expires_at },
  });
  return { documentId: requestDocumentId, requestId: input.requestId, expiresAt: doc.expires_at };
}

/** Documents of one customer that a staff member may see (scope enforced by caller). */
export async function listCustomerDocumentsForStaff(customerId: string) {
  return listCustomerDocuments(customerId);
}

export async function documentTypesWithStats(customerId: string) {
  const counts = await countCustomerDocumentsByType(customerId);
  return DOCUMENT_TYPES.map((type) => ({
    ...type,
    counts: counts[type.code] ?? { total: 0, approved: 0, pending: 0, rejected: 0 },
  }));
}
