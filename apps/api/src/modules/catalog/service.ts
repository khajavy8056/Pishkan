import { one, q, run, nowIso, jsonParse, jsonStringify, tx } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { normalizePersian, scoreDocument, slugify } from '../../lib/text.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { getBool, getString } from '../settings/service.js';
import { writeAudit } from '../audit/service.js';
import type { FormField, WorkflowStep } from './seed-data.js';

export interface ServiceRow {
  id: string;
  category_id: string | null;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  image: string | null;
  icon: string | null;
  form_schema: string;
  documents: string;
  workflow_steps: string;
  base_fee: number;
  discount_percent: number;
  estimated_days: number;
  payment_methods: string;
  tags: string;
  search_text: string;
  contact_notice: string | null;
  is_published: number;
  accepting_requests: number;
  is_custom: number;
  owner_customer_id: string | null;
  created_by: string | null;
  sort_order: number;
  needs_review: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceDTO {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  image: string | null;
  icon: string | null;
  categoryId: string | null;
  categoryTitle?: string | null;
  categorySlug?: string | null;
  coverage: string;
  cityIds: string[];
  urgentEnabled: boolean;
  urgentPercent: number;
  urgentDays: number;
  urgentCapacity: number;
  baseFee: number;
  discountPercent: number;
  finalFee: number;
  estimatedDays: number;
  paymentMethods: string[];
  tags: string[];
  form: FormField[];
  documents: { title: string; required: boolean; note?: string }[];
  workflow: WorkflowStep[];
  contactNotice: string | null;
  isPublished: boolean;
  acceptingRequests: boolean;
  isCustom: boolean;
  ownerCustomerId: string | null;
  needsReview: boolean;
  archivedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function finalFee(baseFee: number, discountPercent: number): number {
  const discount = Math.round((Number(baseFee) * Number(discountPercent || 0)) / 100);
  return Math.max(0, Number(baseFee) - discount);
}

export function mapService(row: ServiceRow & { category_title?: string | null; category_slug?: string | null }): ServiceDTO {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? '',
    description: row.description ?? '',
    image: row.image,
    icon: row.icon,
    categoryId: row.category_id,
    categoryTitle: row.category_title ?? null,
    categorySlug: row.category_slug ?? null,
    coverage: (row as any).coverage ?? 'nationwide',
    cityIds: jsonParse((row as any).city_ids, []),
    urgentEnabled: Boolean((row as any).urgent_enabled), urgentPercent: Number((row as any).urgent_percent ?? 0),
    urgentDays: Number((row as any).urgent_days ?? 1), urgentCapacity: Number((row as any).urgent_capacity ?? 0),
    baseFee: Number(row.base_fee),
    discountPercent: Number(row.discount_percent),
    finalFee: finalFee(row.base_fee, row.discount_percent),
    estimatedDays: Number(row.estimated_days),
    paymentMethods: jsonParse<string[]>(row.payment_methods, ['online', 'cash']),
    tags: jsonParse<string[]>(row.tags, []),
    form: jsonParse<FormField[]>(row.form_schema, []),
    documents: jsonParse(row.documents, []),
    workflow: jsonParse<WorkflowStep[]>(row.workflow_steps, []),
    contactNotice: row.contact_notice,
    isPublished: Boolean(row.is_published),
    acceptingRequests: Boolean(row.accepting_requests),
    isCustom: Boolean(row.is_custom),
    ownerCustomerId: row.owner_customer_id,
    needsReview: Boolean(row.needs_review),
    archivedAt: row.archived_at,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_WITH_CATEGORY = `
  SELECT s.*, c.title AS category_title, c.slug AS category_slug
  FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
`;

export async function getServiceById(serviceId: string): Promise<ServiceDTO | null> {
  const row = await one<ServiceRow & { category_title: string | null; category_slug: string | null }>(
    `${SELECT_WITH_CATEGORY} WHERE s.id = ?`, [serviceId],
  );
  if (!row) return null;
  const result = mapService(row);
  result.cityIds = (await q<any>('SELECT city_id FROM service_cities WHERE service_id=?',[row.id])).map(c=>c.city_id);
  return result;
}

export async function getServiceBySlug(slug: string): Promise<ServiceDTO | null> {
  const row = await one<ServiceRow & { category_title: string | null; category_slug: string | null }>(
    `${SELECT_WITH_CATEGORY} WHERE s.slug = ?`, [slug],
  );
  if (!row) return null;
  const result = mapService(row);
  result.cityIds = (await q<any>('SELECT city_id FROM service_cities WHERE service_id=?',[row.id])).map(c=>c.city_id);
  return result;
}

export interface ListServicesOptions {
  categoryId?: string;
  categorySlug?: string;
  includeUnpublished?: boolean;
  onlyPublic?: boolean;
  customerId?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: 'order' | 'newest' | 'price_asc' | 'price_desc';
}

export async function listServices(opts: ListServicesOptions = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 24));
  const where: string[] = [];
  const args: any[] = [];

  if (opts.onlyPublic) {
    where.push('s.is_published = 1', 's.archived_at IS NULL');
    where.push("(s.coverage='nationwide' OR EXISTS(SELECT 1 FROM service_cities sc JOIN customer_profiles cp ON cp.city_id=sc.city_id WHERE sc.service_id=s.id AND cp.user_id=?))");
    args.push(opts.customerId ?? '__none__');
    where.push('(s.is_custom = 0 OR s.owner_customer_id = ?)');
    args.push(opts.customerId ?? '__none__');
  }
  if (opts.categoryId) { where.push('s.category_id = ?'); args.push(opts.categoryId); }
  if (opts.categorySlug) { where.push('c.slug = ?'); args.push(opts.categorySlug); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = opts.sort === 'newest' ? 's.created_at DESC'
    : opts.sort === 'price_asc' ? 's.base_fee ASC'
      : opts.sort === 'price_desc' ? 's.base_fee DESC'
        : 's.sort_order ASC, s.title ASC';

  const totalRow = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM services s LEFT JOIN service_categories c ON c.id = s.category_id ${clause}`, args,
  );
  const rows = await q<ServiceRow & { category_title: string | null; category_slug: string | null }>(
    `${SELECT_WITH_CATEGORY} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );

  let items = rows.map(mapService);
  let total = Number(totalRow?.c ?? 0);

  if (opts.search && opts.search.trim()) {
    // rank in-process so colloquial synonyms and typos work the same everywhere
    const ranked = items
      .map((item) => ({ item, score: scoreDocument(opts.search!, { title: item.title, summary: item.summary, tags: item.tags, description: item.description }) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    items = ranked.map((r) => r.item);
    total = items.length;
  }

  return { items, total, page, pageSize };
}

/** Cross-catalogue search used by the customer portal and the assistant. */
export async function searchServices(query: string, options: { limit?: number; customerId?: string } = {}) {
  const limit = Math.min(20, options.limit ?? 6);
  const normalized = normalizePersian(query);
  if (normalized.length < 2) return [];

  const rows = await q<ServiceRow & { category_title: string | null; category_slug: string | null }>(
    `${SELECT_WITH_CATEGORY}
     WHERE s.is_published = 1 AND s.archived_at IS NULL
       AND (s.is_custom = 0 OR s.owner_customer_id = ?)
       AND (s.coverage='nationwide' OR EXISTS(SELECT 1 FROM service_cities sc JOIN customer_profiles cp ON cp.city_id=sc.city_id WHERE sc.service_id=s.id AND cp.user_id=?))`,
    [options.customerId ?? '__none__', options.customerId ?? '__none__'],
  );

  return rows
    .map(mapService)
    .map((item) => ({
      ...item,
      score: scoreDocument(query, {
        title: item.title, summary: item.summary, tags: item.tags,
        description: item.description, searchText: String((rows.find((r) => r.id === item.id)?.search_text) ?? ''),
      }),
    }))
    .filter((r) => r.score > 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ------------------------------- categories ------------------------------- */

export async function listCategories(options: { includeInactive?: boolean } = {}) {
  const clause = options.includeInactive ? '' : 'WHERE is_active = 1';
  const rows = await q(
    `SELECT * FROM service_categories ${clause} ORDER BY sort_order ASC, title ASC`,
  );
  const counts = await q<{ category_id: string; c: number }>(
    `SELECT category_id, COUNT(*) AS c FROM services WHERE is_published = 1 AND is_custom = 0 AND archived_at IS NULL GROUP BY category_id`,
  );
  const countMap = new Map(counts.map((r) => [r.category_id, Number(r.c)]));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    icon: r.icon,
    color: r.color,
    image: r.image,
    sortOrder: Number(r.sort_order),
    isActive: Boolean(r.is_active),
    serviceCount: countMap.get(r.id) ?? 0,
  }));
}

/* ------------------------------ admin mutation ---------------------------- */

export interface ServiceInput {
  title?: string;
  slug?: string;
  categoryId?: string | null;
  summary?: string;
  description?: string;
  image?: string | null;
  icon?: string | null;
  form?: FormField[];
  documents?: { title: string; required: boolean; note?: string }[];
  workflow?: WorkflowStep[];
  coverage?: 'nationwide' | 'cities'; cityIds?: string[];
  urgentEnabled?: boolean; urgentPercent?: number; urgentDays?: number; urgentCapacity?: number;
  baseFee?: number;
  discountPercent?: number;
  estimatedDays?: number;
  paymentMethods?: string[];
  tags?: string[];
  contactNotice?: string | null;
  isPublished?: boolean;
  acceptingRequests?: boolean;
  needsReview?: boolean;
  sortOrder?: number;
}

const ALLOWED_FIELD_TYPES = new Set([
  'text', 'tel', 'number', 'national_id', 'date', 'textarea', 'select', 'radio', 'checkbox', 'file', 'money', 'iban', 'postal_code',
]);

export function validateFormSchema(form: unknown): FormField[] {
  if (form === undefined) return [];
  if (!Array.isArray(form)) throw badRequest('ساختار فرم خدمت باید آرایه‌ای از فیلدها باشد.');
  const seen = new Set<string>();
  return form.map((raw, index) => {
    const field = raw as FormField;
    if (!field || typeof field !== 'object') throw badRequest(`فیلد شماره ${index + 1} نامعتبر است.`);
    const key = String(field.key ?? '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/.test(key)) {
      throw badRequest(`کلید فیلد شماره ${index + 1} باید با حرف شروع شود و فقط شامل حروف انگلیسی، رقم و _ باشد.`);
    }
    if (seen.has(key)) throw badRequest(`کلید فیلد «${key}» تکراری است.`);
    seen.add(key);
    if (!field.label || String(field.label).trim().length < 2) throw badRequest(`عنوان فیلد «${key}» الزامی است.`);
    if (!ALLOWED_FIELD_TYPES.has(field.type)) throw badRequest(`نوع فیلد «${key}» پشتیبانی نمی‌شود.`);
    if ((field.type === 'select' || field.type === 'radio') && (!Array.isArray(field.options) || field.options.length === 0)) {
      throw badRequest(`فیلد «${field.label}» از نوع انتخابی باید حداقل یک گزینه داشته باشد.`);
    }
    return {
      key,
      label: String(field.label).trim(),
      type: field.type,
      required: Boolean(field.required),
      options: field.options,
      placeholder: field.placeholder,
      help: field.help,
    };
  });
}

function validateWorkflow(steps: unknown): WorkflowStep[] {
  if (steps === undefined) return [];
  if (!Array.isArray(steps)) throw badRequest('مراحل گردش کار باید آرایه باشند.');
  return steps.map((raw, i) => {
    const step = raw as WorkflowStep;
    if (!step?.title || String(step.title).trim().length < 2) throw badRequest(`عنوان مرحله ${i + 1} الزامی است.`);
    return {
      title: String(step.title).trim(),
      description: step.description ? String(step.description) : undefined,
      role: step.role ? String(step.role) : undefined,
      requiresDocument: Boolean(step.requiresDocument),
    };
  });
}

function validateDocuments(docs: unknown) {
  if (docs === undefined) return [];
  if (!Array.isArray(docs)) throw badRequest('فهرست مدارک باید آرایه باشد.');
  return docs.map((raw, i) => {
    const doc = raw as { title?: string; required?: boolean; note?: string };
    if (!doc?.title || String(doc.title).trim().length < 2) throw badRequest(`عنوان مدرک ${i + 1} الزامی است.`);
    return { title: String(doc.title).trim(), required: Boolean(doc.required), note: doc.note ? String(doc.note) : undefined };
  });
}

export async function createService(input: ServiceInput, actor: { id: string; name: string; ip?: string }) {
 return tx(async()=>{
  const title = String(input.title ?? '').trim();
  if (title.length < 3) throw badRequest('عنوان خدمت باید حداقل ۳ کاراکتر باشد.');
  let slug = (input.slug ? slugify(input.slug) : slugify(title));
  if (await one('SELECT id FROM services WHERE slug = ?', [slug])) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  if (input.categoryId) {
    const cat = await one('SELECT id FROM service_categories WHERE id = ?', [input.categoryId]);
    if (!cat) throw badRequest('دسته‌بندی انتخابی وجود ندارد.');
  }

  const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [];
  const searchText = normalizePersian([title, input.summary ?? '', input.description ?? '', ...tags].join(' '));
  const ts = nowIso();
  const serviceId = id('svc');

  await run(
    `INSERT INTO services (id, category_id, slug, title, summary, description, image, icon, form_schema, documents,
      workflow_steps, base_fee, discount_percent, estimated_days, payment_methods, tags, search_text, contact_notice,
      is_published, accepting_requests, is_custom, owner_customer_id, created_by, sort_order, needs_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)`,
    [
      serviceId, input.categoryId ?? null, slug, title, input.summary ?? null, input.description ?? null,
      input.image ?? null, input.icon ?? null, jsonStringify(validateFormSchema(input.form)),
      jsonStringify(validateDocuments(input.documents)), jsonStringify(validateWorkflow(input.workflow)),
      Math.max(0, Math.round(Number(input.baseFee ?? 0))), Math.min(100, Math.max(0, Number(input.discountPercent ?? 0))),
      Math.max(1, Number(input.estimatedDays ?? 3)),
      jsonStringify(input.paymentMethods ?? ['online', 'cash', 'pos']), jsonStringify(tags), searchText,
      input.contactNotice ?? null,
      input.isPublished === false ? 0 : 1, input.acceptingRequests === false ? 0 : 1,
      actor.id, Number(input.sortOrder ?? 1000), input.needsReview === false ? 0 : 1, ts, ts,
    ],
  );

  await run(
    `INSERT INTO assignment_rules (id, service_id, strategy, staff_ids, max_load, fallback, is_active, created_at, updated_at)
     VALUES (?, ?, ?, '[]', 0, 'queue', 1, ?, ?)`,
    [id('rule'), serviceId, (await getString('services.auto_assign_strategy')) || 'least_loaded', ts, ts],
  ).catch(() => undefined);

  await updateServicePolicy(serviceId, input);
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'service.create', entityType: 'service', entityId: serviceId, after: { title, slug }, ip: actor.ip });
  return (await getServiceById(serviceId))!;
 });
}

export async function updateService(serviceId: string, input: ServiceInput, actor: { id: string; name: string; ip?: string }) {
 return tx(async()=>{
  const existing = await getServiceById(serviceId);
  if (!existing) throw notFound('خدمت یافت نشد.');

  if (input.categoryId) {
    const cat = await one('SELECT id FROM service_categories WHERE id = ?', [input.categoryId]);
    if (!cat) throw badRequest('دسته‌بندی انتخابی وجود ندارد.');
  }

  const title = input.title !== undefined ? String(input.title).trim() : existing.title;
  const summary = input.summary !== undefined ? String(input.summary) : existing.summary;
  const description = input.description !== undefined ? String(input.description) : existing.description;
  const tags = input.tags !== undefined ? input.tags.map(String).filter(Boolean) : existing.tags;
  const searchText = normalizePersian([title, summary, description, ...tags].join(' '));

  await run(
    `UPDATE services SET
      category_id = ?, title = ?, summary = ?, description = ?, image = ?, icon = ?,
      form_schema = ?, documents = ?, workflow_steps = ?, base_fee = ?, discount_percent = ?,
      estimated_days = ?, payment_methods = ?, tags = ?, search_text = ?, contact_notice = ?,
      is_published = ?, accepting_requests = ?, sort_order = ?, needs_review = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.categoryId !== undefined ? input.categoryId : existing.categoryId,
      title, summary, description,
      input.image !== undefined ? input.image : existing.image,
      input.icon !== undefined ? input.icon : existing.icon,
      jsonStringify(input.form !== undefined ? validateFormSchema(input.form) : existing.form),
      jsonStringify(input.documents !== undefined ? validateDocuments(input.documents) : existing.documents),
      jsonStringify(input.workflow !== undefined ? validateWorkflow(input.workflow) : existing.workflow),
      input.baseFee !== undefined ? Math.max(0, Math.round(Number(input.baseFee))) : existing.baseFee,
      input.discountPercent !== undefined ? Math.min(100, Math.max(0, Number(input.discountPercent))) : existing.discountPercent,
      input.estimatedDays !== undefined ? Math.max(1, Number(input.estimatedDays)) : existing.estimatedDays,
      jsonStringify(input.paymentMethods ?? existing.paymentMethods),
      jsonStringify(tags), searchText,
      input.contactNotice !== undefined ? input.contactNotice : existing.contactNotice,
      input.isPublished !== undefined ? (input.isPublished ? 1 : 0) : (existing.isPublished ? 1 : 0),
      input.acceptingRequests !== undefined ? (input.acceptingRequests ? 1 : 0) : (existing.acceptingRequests ? 1 : 0),
      input.sortOrder !== undefined ? Number(input.sortOrder) : existing.sortOrder,
      input.needsReview !== undefined ? (input.needsReview ? 1 : 0) : (existing.needsReview ? 1 : 0),
      nowIso(), serviceId,
    ],
  );

  await updateServicePolicy(serviceId, input);
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'service.update', entityType: 'service', entityId: serviceId,
    before: { title: existing.title, baseFee: existing.baseFee, isPublished: existing.isPublished },
    after: { title, baseFee: input.baseFee ?? existing.baseFee, isPublished: input.isPublished ?? existing.isPublished },
    ip: actor.ip,
  });
  return (await getServiceById(serviceId))!;
 });
}

export async function archiveService(serviceId: string, actor: { id: string; name: string }) {
  const existing = await getServiceById(serviceId);
  if (!existing) throw notFound('خدمت یافت نشد.');
  const activeRequests = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM requests WHERE service_id = ? AND status NOT IN ('completed','cancelled','rejected')`, [serviceId],
  );
  if (Number(activeRequests?.c ?? 0) > 0) {
    throw conflict('این خدمت دارای پرونده فعال است. ابتدا پرونده‌ها را تعیین تکلیف کنید.');
  }
  await run('UPDATE services SET archived_at = ?, is_published = 0, accepting_requests = 0, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), serviceId]);
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'service.archive', entityType: 'service', entityId: serviceId });
}

export async function serviceStaffIds(serviceId: string): Promise<string[]> {
  const rows = await q<{ user_id: string }>('SELECT user_id FROM service_staff WHERE service_id = ? ORDER BY priority ASC', [serviceId]);
  return rows.map((r) => r.user_id);
}

/* --------------------------- categories mutation -------------------------- */

export async function createCategory(input: { title: string; description?: string; icon?: string; color?: string; image?: string; sortOrder?: number }, actor: { id: string; name: string }) {
  const title = String(input.title ?? '').trim();
  if (title.length < 2) throw badRequest('عنوان دسته‌بندی الزامی است.');
  let slug = slugify(title);
  if (await one('SELECT id FROM service_categories WHERE slug = ?', [slug])) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const categoryId = id('cat');
  const ts = nowIso();
  await run(
    `INSERT INTO service_categories (id, slug, title, description, icon, color, image, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [categoryId, slug, title, input.description ?? null, input.icon ?? 'folder', input.color ?? '#1d4ed8', input.image ?? null, Number(input.sortOrder ?? 999), ts, ts],
  );
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'category.create', entityType: 'category', entityId: categoryId, after: { title } });
  return categoryId;
}

export async function updateCategory(categoryId: string, input: Record<string, unknown>, actor: { id: string; name: string }) {
  const existing = await one('SELECT * FROM service_categories WHERE id = ?', [categoryId]);
  if (!existing) throw notFound('دسته‌بندی یافت نشد.');
  await run(
    `UPDATE service_categories SET title = ?, description = ?, icon = ?, color = ?, image = ?, sort_order = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.title !== undefined ? String(input.title) : existing.title,
      input.description !== undefined ? String(input.description) : existing.description,
      input.icon !== undefined ? String(input.icon) : existing.icon,
      input.color !== undefined ? String(input.color) : existing.color,
      input.image !== undefined ? String(input.image) : existing.image,
      input.sortOrder !== undefined ? Number(input.sortOrder) : existing.sort_order,
      input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active,
      nowIso(), categoryId,
    ],
  );
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'category.update', entityType: 'category', entityId: categoryId });
}

/* ------------------------------ custom services --------------------------- */

export interface CustomServiceInput {
  customerId: string;
  title: string;
  description: string;
  summary?: string;
  coverage?: string;
  cityIds?: string[];
  urgentEnabled?: boolean;
  urgentPercent?: number;
  urgentDays?: number;
  urgentCapacity?: number;
  baseFee: number;
  discountPercent?: number;
  documents?: { title: string; required: boolean }[];
  workflow?: WorkflowStep[];
  form?: FormField[];
  estimatedDays?: number;
  createInvoice?: boolean;
}

export async function createCustomService(input: CustomServiceInput, actor: { id: string; name: string; ip?: string }) {
  if (!(await getBool('services.allow_custom_services'))) {
    throw badRequest('ایجاد خدمت اختصاصی در تنظیمات سامانه غیرفعال است.');
  }
  const customer = await one('SELECT id, full_name FROM users WHERE id = ? AND kind = ?', [input.customerId, 'customer']);
  if (!customer) throw badRequest('مشتری انتخابی وجود ندارد.');

  const title = String(input.title ?? '').trim();
  if (title.length < 3) throw badRequest('عنوان خدمت اختصاصی الزامی است.');
  if (!input.description || String(input.description).trim().length < 10) {
    throw badRequest('شرح خدمت اختصاصی باید کامل باشد.');
  }
  const fee = Math.max(0, Math.round(Number(input.baseFee ?? 0)));
  const discount = Math.min(100, Math.max(0, Number(input.discountPercent ?? 0)));
  const ts = nowIso();
  const serviceId = id('svc');
  const slug = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  await run(
    `INSERT INTO services (id, category_id, slug, title, summary, description, image, icon, form_schema, documents,
      workflow_steps, base_fee, discount_percent, estimated_days, payment_methods, tags, search_text, contact_notice,
      is_published, accepting_requests, is_custom, owner_customer_id, created_by, sort_order, needs_review, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?, NULL, 'sparkles', ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, 1, 1, ?, ?, 9999, 0, ?, ?)`,
    [
      serviceId, slug, title, input.summary ?? title.slice(0, 120), input.description,
      jsonStringify(validateFormSchema(input.form)), jsonStringify(validateDocuments(input.documents)),
      jsonStringify(validateWorkflow(input.workflow)), fee, discount,
      Math.max(1, Number(input.estimatedDays ?? 3)), jsonStringify(['online', 'cash', 'pos']),
      normalizePersian([title, input.description].join(' ')),
      'این خدمت اختصاصی برای شما تعریف شده است.', input.customerId, actor.id, ts, ts,
    ],
  );

  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'service.create_custom', entityType: 'service',
    entityId: serviceId, after: { title, customerId: input.customerId, fee }, ip: actor.ip,
  });

  return (await getServiceById(serviceId))!;
}

async function updateServicePolicy(serviceId: string, input: ServiceInput) {
 const current = await one<any>('SELECT * FROM services WHERE id=?',[serviceId]);
 const cityIds = input.cityIds ?? (await q<any>('SELECT city_id FROM service_cities WHERE service_id=?',[serviceId])).map(r=>r.city_id);
 if ((input.coverage ?? current.coverage) === 'cities' && !cityIds.length) throw badRequest('حداقل یک شهر مجاز انتخاب کنید.');
 for (const city of cityIds) if (!await one('SELECT id FROM cities WHERE id=? AND is_active=1',[city])) throw badRequest('شهر نامعتبر است.');
 await run('UPDATE services SET coverage=?, urgent_enabled=?,urgent_percent=?,urgent_days=?,urgent_capacity=? WHERE id=?',[
 input.coverage ?? current.coverage,input.urgentEnabled === undefined ? current.urgent_enabled : Number(input.urgentEnabled),input.urgentPercent ?? current.urgent_percent,input.urgentDays ?? current.urgent_days,input.urgentCapacity ?? current.urgent_capacity,serviceId]);
 if(input.cityIds) {
  await run('DELETE FROM service_cities WHERE service_id=?',[serviceId]);
  for(const city of cityIds) await run('INSERT INTO service_cities(service_id,city_id) VALUES(?,?)',[serviceId,city]);
 }
}
