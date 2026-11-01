/**
 * Persian text utilities: normalisation for search, colloquial synonyms and
 * lightweight similarity scoring. No external service required.
 */

const ARABIC_TO_PERSIAN: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا',
  'ؤ': 'و', 'ئ': 'ی', 'ﻻ': 'لا',
};

const DIGIT_MAP = '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';

export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const idx = DIGIT_MAP.indexOf(d);
    return idx >= 0 ? String(idx % 10) : d;
  });
}

/** Canonical form used for indexing and querying. */
export function normalizePersian(input: string): string {
  if (!input) return '';
  let s = String(input);
  s = toAsciiDigits(s);
  s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, ''); // diacritics + tatweel
  s = s.replace(/[\u200c\u200f\u200e]/g, ' ');        // ZWNJ and direction marks → space
  s = s.split('').map((ch) => ARABIC_TO_PERSIAN[ch] ?? ch).join('');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

/** Colloquial / misspelled words mapped to the catalogue vocabulary. */
const SYNONYMS: Record<string, string[]> = {
  'سابقه': ['سوابق', 'بیمه'],
  'سوابق': ['سابقه'],
  'بیمه': ['تامین', 'اجتماعی', 'سوابق'],
  'تامین': ['تأمین', 'بیمه'],
  'یارانه': ['دهک', 'کالابرگ', 'سهام'],
  'دهک': ['یارانه', 'اعتراض'],
  'سهام': ['عدالت', 'بورس', 'سجام'],
  'کودک': ['نوزاد', 'سهام', 'عدالت'],
  'نوزاد': ['کودک', 'سهام'],
  'شرکت': ['ثبت', 'مسئولیت', 'سهامی'],
  'ثبت': ['شرکت', 'برند', 'لوگو'],
  'برند': ['علامت', 'تجاری', 'لوگو'],
  'لوگو': ['برند', 'علامت', 'تجاری'],
  'کارت': ['بازرگانی'],
  'فیش': ['حقوقی', 'حقوق'],
  'حقوق': ['فیش', 'کسر'],
  'سجام': ['بورس', 'احراز', 'هویت'],
  'قبض': ['بیمه', 'پرداخت'],
  'شبا': ['حساب', 'بانکی', 'یارانه'],
  'مدارک': ['سوابق'],
  'گواهی': ['سوابق', 'بیمه'],
  'انجمن': ['موسسه', 'مؤسسه'],
  'موسسه': ['انجمن', 'مؤسسه'],
};

export function expandQuery(query: string): string[] {
  const normalized = normalizePersian(query);
  const words = normalized.split(' ').filter(Boolean);
  const out = new Set<string>(words);
  for (const w of words) {
    for (const syn of SYNONYMS[w] ?? []) out.add(normalizePersian(syn));
  }
  return [...out];
}

/** Bigram similarity in [0,1] — cheap fuzzy matching for typos. */
export function similarity(a: string, b: string): number {
  const x = normalizePersian(a);
  const y = normalizePersian(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const gram = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    if (s.length === 1) set.add(s);
    return set;
  };
  const gx = gram(x);
  const gy = gram(y);
  let inter = 0;
  for (const g of gx) if (gy.has(g)) inter += 1;
  return (2 * inter) / (gx.size + gy.size);
}

/** Score a document against a query, used by catalog search and the assistant. */
export function scoreDocument(
  query: string,
  doc: { title: string; summary?: string; tags?: string[]; description?: string; searchText?: string },
): number {
  const normalizedQuery = normalizePersian(query);
  if (!normalizedQuery) return 0;
  const terms = expandQuery(query);
  const title = normalizePersian(doc.title);
  const summary = normalizePersian(doc.summary ?? '');
  const tags = normalizePersian((doc.tags ?? []).join(' '));
  const body = normalizePersian(doc.description ?? '');
  const searchText = normalizePersian(doc.searchText ?? '');

  let score = 0;
  if (title === normalizedQuery) score += 100;
  if (title.includes(normalizedQuery)) score += 40;

  for (const term of terms) {
    if (!term) continue;
    const weight = term === normalizedQuery ? 1 : 0.55;
    if (title.includes(term)) score += 18 * weight;
    if (tags.includes(term)) score += 12 * weight;
    if (summary.includes(term)) score += 8 * weight;
    if (searchText.includes(term)) score += 5 * weight;
    if (body.includes(term)) score += 3 * weight;
  }

  // typo tolerance on the whole phrase
  const fuzzy = Math.max(similarity(normalizedQuery, title), similarity(normalizedQuery, summary));
  if (fuzzy > 0.6) score += fuzzy * 25;

  return Math.round(score * 100) / 100;
}

export function slugify(input: string): string {
  const base = normalizePersian(input).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  // Persian slugs are valid; keep letters and digits from any script
  return base || `item-${Date.now().toString(36)}`;
}

/** Simple Persian digit formatting for display strings. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}
