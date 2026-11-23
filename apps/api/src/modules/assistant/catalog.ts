/**
 * Live catalogue access for the assistant.
 *
 * Two properties matter and are easy to lose:
 *
 *  1. **Freshness** — every turn re-reads the published services from the
 *     database. Nothing is cached across turns, so the moment an operator
 *     publishes or edits a service it is searchable, comparable and
 *     describable here. There is no "assistant index" to rebuild.
 *  2. **Coverage** — the whole catalogue is loaded, not a keyword-LIKE top-N.
 *     Ranking happens in process over every visible service, so a colloquial
 *     query ("ماشینمو میخوام بفروشم چی لازم دارم") can still reach the right
 *     card even when no single word matches its title.
 */
import { publishedCatalogue, listCategories, type ServiceDTO } from '../catalog/service.js';
import { expandQuery, normalizePersian, similarity } from '../../lib/text.js';
import type {
  AssistantCatalogCard, AssistantCategorySummary, AssistantServiceCard, AssistantServiceDocument,
} from './types.js';

const STOPWORDS = new Set([
  'و', 'در', 'به', 'از', 'با', 'برای', 'تا', 'را', 'رو', 'این', 'آن', 'یک', 'هم', 'همه',
  'من', 'ما', 'شما', 'او', 'میخواهم', 'میخوام', 'میخواهیم', 'میخوای', 'میخواهید', 'میخوام',
  'بگیرم', 'بگیرید', 'بگیر', 'کنم', 'کنید', 'کن', 'کارت', 'کار', 'شود', 'شوم', 'شوید',
  'دارم', 'دارد', 'دارید', 'باید', 'لطفا', 'خواهش', 'میشه', 'می' + 'شود', 'است', 'هست',
  'بود', 'بودن', 'چطور', 'چگونه', 'آیا', 'اگر', 'یا', 'همین', 'الان', 'الآن', 'بعد', 'قبل',
  'بابت', 'درباره', 'مورد', 'نسبت', 'میکنم', 'میکنید', 'بده', 'بدهید', 'ثبت', 'درخواست',
  'سامانه', 'پیشخوان', 'دفتر', 'خدمت', 'خدمات', 'لیست', 'فهرست', 'نمایش', 'بگو', 'بگویید',
]);

const SERVICE_WORD_RE = /[a-z0-9\u0600-\u06FF]+/g;

function tokensOf(text: string): string[] {
  return (normalizePersian(text).match(SERVICE_WORD_RE) ?? []).filter((token) => token.length > 1);
}

/** Content words of the query, with catalogue synonyms expanded. */
export function queryTerms(query: string): string[] {
  const normalized = normalizePersian(query);
  const base = tokensOf(normalized).filter((token) => !STOPWORDS.has(token));
  const expanded = expandQuery(query).filter((term) => term.length > 1 && !STOPWORDS.has(term));
  return [...new Set([...base, ...expanded])];
}

export interface CatalogSearchResult {
  service: AssistantServiceCard;
  score: number;
  matched: string[];
}

/**
 * Rank the whole live catalogue against a natural-language query.
 *
 * Title/tag matches dominate; category and description fill the gaps; token
 * coverage stops one lucky word from outranking a service that matches the
 * whole question. Typo tolerance is applied per token so a misspelled word
 * does not zero out an otherwise perfect match.
 */
export function rankServices(query: string, services: AssistantServiceCard[], limit = 5): CatalogSearchResult[] {
  const normalized = normalizePersian(query);
  if (normalized.length < 2) return [];
  const terms = queryTerms(query);
  if (!terms.length) return [];

  const scored = services.map((service) => {
    const title = normalizePersian(service.title);
    const summary = normalizePersian(service.summary);
    const tags = normalizePersian(service.tags.join(' '));
    const category = normalizePersian(service.categoryTitle ?? '');
    const body = normalizePersian(`${service.summary} ${service.tags.join(' ')}`);
    let score = 0;
    const matched: string[] = [];

    if (title === normalized) score += 160;
    else if (title.includes(normalized)) score += 70;

    for (const term of terms) {
      let hit = 0;
      if (title.includes(term)) hit = 26;
      else if (tags.includes(term)) hit = 20;
      else if (summary.includes(term)) hit = 14;
      else if (category.includes(term)) hit = 12;
      else if (body.includes(term)) hit = 8;
      else {
        // Typo tolerance: compare against title words and tags only, so a
        // loose match in a long description cannot outrank a real title hit.
        const candidates = [...tokensOf(service.title), ...service.tags.map((tag) => normalizePersian(tag))];
        const fuzzy = Math.max(0, ...candidates.map((candidate) => similarity(term, candidate)));
        if (fuzzy >= 0.78) hit = 6 * fuzzy;
      }
      if (hit > 0) {
        score += hit;
        matched.push(term);
      }
    }

    const coverage = terms.length ? matched.length / terms.length : 0;
    score *= 0.45 + 0.55 * coverage;
    if (service.acceptingRequests) score *= 1.06;
    return { service, score: Math.round(score * 100) / 100, matched: [...new Set(matched)] };
  });

  return scored
    .filter((item) => item.score >= 7)
    .sort((a, b) => b.score - a.score || a.service.title.localeCompare(b.service.title, 'fa'))
    .slice(0, Math.max(1, limit));
}

export function toServiceCard(service: ServiceDTO): AssistantServiceCard {
  return {
    id: service.id,
    slug: service.slug,
    title: service.title,
    summary: service.summary,
    categoryTitle: service.categoryTitle ?? null,
    categorySlug: service.categorySlug ?? null,
    baseFee: service.baseFee,
    finalFee: service.finalFee,
    estimatedMinutes: service.estimatedMinutes,
    estimatedDays: service.estimatedDays,
    urgentEnabled: service.urgentEnabled,
    urgentPercent: service.urgentPercent,
    urgentMinutes: service.urgentMinutes,
    urgentDays: service.urgentDays,
    acceptingRequests: service.acceptingRequests,
    needsReview: service.needsReview,
    hasExternalCosts: service.hasExternalCosts,
    requiresManagerApproval: service.requiresManagerApproval,
    requiredFields: service.form.filter((field) => field.required).map((field) => field.label),
    documents: service.documents.map((document): AssistantServiceDocument => ({
      key: document.key,
      title: document.title,
      required: document.required,
      ...(document.note ? { note: document.note } : {}),
      ...(document.documentType ? { documentType: document.documentType } : {}),
    })),
    paymentMethods: service.paymentMethods,
    tags: service.tags,
    contactNotice: service.contactNotice,
  };
}

export interface AssistantCatalog {
  services: AssistantServiceCard[];
  categories: AssistantCategorySummary[];
  /** Full DTOs kept for the assistant's own reasoning (documents, forms). */
  details: Map<string, ServiceDTO>;
  loadedAt: string;
}

/** Read the whole live catalogue. Called once per assistant turn. */
export async function loadAssistantCatalog(customerId?: string): Promise<AssistantCatalog> {
  const [services, categories] = await Promise.all([
    publishedCatalogue({ customerId }),
    listCategories(),
  ]);
  const activeCategories = new Map(categories.filter((category) => category.isActive).map((category) => [category.slug, category]));
  const visible = services.filter((service) => {
    if (!service.categorySlug) return true;
    return activeCategories.has(service.categorySlug);
  });
  const details = new Map(visible.map((service) => [service.slug, service]));
  return {
    services: visible.map(toServiceCard),
    categories: categories
      .filter((category) => category.isActive)
      .map((category) => ({ slug: category.slug, title: category.title, serviceCount: category.serviceCount })),
    details,
    loadedAt: new Date().toISOString(),
  };
}

export function catalogDetails(catalog: AssistantCatalog, slug: string): ServiceDTO | undefined {
  return catalog.details.get(slug);
}

/** Compact shape handed to a language model as tool output. */
export function compactService(card: AssistantServiceCard) {
  return {
    slug: card.slug,
    title: card.title,
    category: card.categoryTitle,
    summary: card.summary,
    fee: card.finalFee,
    estimatedMinutes: card.estimatedMinutes,
    estimatedDays: card.estimatedDays,
    urgent: card.urgentEnabled ? { percent: card.urgentPercent, minutes: card.urgentMinutes } : null,
    acceptingRequests: card.acceptingRequests,
    needsReview: card.needsReview,
    externalCosts: card.hasExternalCosts,
    requiredFields: card.requiredFields,
    documents: card.documents.map((document) => ({ title: document.title, required: document.required })),
    tags: card.tags,
  };
}

export function makeCatalogCard(
  catalog: AssistantCatalog,
  query: string,
  services: AssistantServiceCard[],
  title = 'خدمات مرتبط',
): AssistantCatalogCard {
  return {
    title,
    query,
    categories: catalog.categories,
    services,
    total: services.length,
    action: { id: 'open-catalog', label: 'مشاهده همه خدمات', kind: 'link', route: '/app/services', href: '/services' },
  };
}
