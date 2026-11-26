/**
 * Built-in assistant engine — no external service required.
 *
 * This is not a keyword router with canned sentences. It:
 *   * ranks the whole live catalogue for every service question (typo and
 *     colloquialism tolerant), so a newly published service is answerable;
 *   * reads the signed-in customer's real cases, invoices, wallet, profile
 *     and tickets, and produces cards with deep links;
 *   * carries a multi-turn request draft: it asks for the next missing field,
 *     validates against the real service schema, shows a full preview and
 *     leaves the actual submission to an explicit confirmation.
 *
 * When it cannot ground an answer it says so and offers a human, because a
 * confident guess about an official fee or rule is worse than no answer.
 */
import { normalizePersian } from '../../lib/text.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import type { ServiceDTO } from '../catalog/service.js';
import { rankServices, toServiceCard, type AssistantCatalog } from './catalog.js';
import {
  action, caseCard, findOwnCase, invoiceCard, loadCustomerSnapshot, profileCard, ticketCard, walletCard,
  type CustomerSnapshot,
} from './customer.js';
import {
  publicDraft, refresh, saveDraftState, setDraftField, startDraft, type DraftState,
} from './drafts.js';
import {
  cancelDraftTool, confirmDraftTool, listCatalogue, myInvoicesTool, myTicketsTool, profileTool, walletTool,
} from './tools.js';
import type {
  AssistantAction, AssistantCard, AssistantDraft, AssistantReply, AssistantServiceCard, AssistantIntent,
} from './types.js';

const GREETINGS = ['سلام', 'درود', 'وقت بخیر', 'صبح بخیر', 'عصر بخیر', 'شب بخیر', 'hello', 'hi', 'سلام علیکم'];
const HUMAN_WORDS = ['کارشناس', 'اپراتور', 'انسانی', 'پشتیبان انسانی', 'تماس بگیر', 'شماره تماس', 'با دفتر صحبت'];
const STATUS_WORDS = ['وضعیت', 'پیگیری', 'کد رهگیری', 'پرونده', 'کارم', 'قدم بعدی', 'کجا رسید', 'چقدر مانده', 'درخواستم', 'پرونده‌ام', 'پرونده من'];
const INVOICE_WORDS = ['فاکتور', 'بدهی', 'قابل پرداخت', 'چقدر باید پرداخت', 'پرداختم', 'مبلغ پرداخت', 'صورتحساب'];
const PAYMENT_WORDS = ['پرداخت', 'پرداخت کنم', 'چطور پرداخت'];
const WALLET_WORDS = ['کیف پول', 'موجودی', 'شارژ'];
const PROFILE_WORDS = ['پروفایل', 'مدارکم', 'مدرک رد', 'رد شده', 'ردشده', 'ناقص', 'کد ملی', 'اطلاعات حساب'];
const TICKET_WORDS = ['تیکت', 'پشتیبانی', 'گفتگو با دفتر', 'شکایت'];
const FEE_WORDS = ['هزینه', 'قیمت', 'تعرفه', 'چقدر', 'مبلغ', 'قیمتش'];
const DOC_WORDS = ['مدرک', 'مدارک', 'چه چیز لازم', 'چه مدارکی', 'چی لازم', 'نیاز دارم', 'چی می‌خواد', 'چی میخواد'];
const DURATION_WORDS = ['چقدر طول', 'چند روز', 'چند وقت', 'زمان انجام', 'چقدر زمان', 'مدت'];
const URGENT_WORDS = ['فوری', 'سریع', 'همین امروز', 'فردا'];
const COMPARE_WORDS = ['مقایسه', 'تفاوت', 'کدوم بهتر', 'کدام بهتر', 'فرقش', 'فرق'];
const LIST_WORDS = ['چه خدماتی', 'لیست خدم', 'فهرست خدم', 'دسته‌بندی', 'دسته بندی', 'چه کارهایی'];
const START_WORDS = ['ثبت کن', 'ثبت درخواست', 'درخواست بده', 'برام ثبت', 'برای من ثبت', 'می‌خوام ثبت', 'میخوام ثبت', 'ثبت نام کن', 'ثبت‌نام کن', 'درخواست جدید'];
const PREVIEW_WORDS = ['پیش‌نمایش', 'پیشنمایش', 'خلاصه درخواست', 'بررسی درخواست', 'مرحله بعد'];
const EDIT_WORDS = ['ویرایش', 'تغییر بده', 'اصلاح', 'عوض کن'];
const PROFILE_FILL_PHRASES = ['از پروفایل پر کن', 'از پروفایل استفاده کن', 'اطلاعات پروفایل', 'پروفایل من', 'پیشنهاد پروفایل'];
const CANCEL_WORDS = ['انصراف', 'بی‌خیال', 'ولش کن', 'کنسل', 'لغو کن', 'نمی‌خوام'];
const CONFIRM_WORDS = ['تأیید می‌کنم', 'تایید می‌کنم', 'تأیید میکنم', 'تایید میکنم', 'ثبت کن', 'ثبتش کن', 'بله تأیید', 'بله تایید', 'قبول', 'اوکی ثبت'];
const QUESTION_MARK = /؟|\?/;
const STOPWORDS = new Set([
  'و', 'در', 'به', 'از', 'با', 'برای', 'تا', 'را', 'رو', 'این', 'آن', 'یک', 'هم', 'همه', 'من', 'ما', 'شما',
  'میخواهم', 'میخوام', 'میخواهیم', 'میخوای', 'میخواهید', 'بگیرم', 'بگیرید', 'بگیر', 'کنم', 'کنید', 'کن',
  'شود', 'شوم', 'شوید', 'دارم', 'دارد', 'دارید', 'باید', 'لطفا', 'خواهش', 'است', 'هست', 'بود', 'بودن',
  'چطور', 'چگونه', 'آیا', 'اگر', 'یا', 'همین', 'الان', 'الآن', 'بعد', 'قبل', 'بابت', 'درباره', 'مورد',
  'نسبت', 'میکنم', 'میکنید', 'بده', 'بدهید', 'ثبت', 'درخواست', 'سامانه', 'پیشخوان', 'دفتر', 'خدمت',
  'خدمات', 'لیست', 'فهرست', 'نمایش', 'بگو', 'بگویید', 'سال', 'چقدر', 'چند', 'است',
]);
const LEGAL_WORDS = ['قانون', 'ماده', 'تبصره', 'ضوابط', 'شرایط قانونی', 'مهلت قانونی', 'جریمه', 'نرخ رسمی', 'مستندات قانونی', 'احکام', 'مصوبه', 'آیین‌نامه'];

function n(value: string): string {
  return normalizePersian(value);
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(n(word)));
}

function startsWithAny(text: string, words: string[]): boolean {
  return words.some((word) => text.startsWith(n(word)));
}

function queryTermsOf(message: string): string[] {
  return (n(message).match(/[a-z0-9\u0600-\u06FF]+/g) ?? [])
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function isConfirmation(message: string): boolean {
  const text = n(message);
  if (!text) return false;
  // "ثبت کن" alone is a confirmation only when a draft is already waiting for
  // confirmation; the caller checks that. Here we just recognise the phrase.
  return CONFIRM_WORDS.some((phrase) => text === n(phrase) || text.includes(n(phrase)));
}

export function isCancellation(message: string): boolean {
  const text = n(message);
  if (!text) return false;
  return CANCEL_WORDS.some((phrase) => text === n(phrase) || text.includes(n(phrase)));
}

export function wantsProfileFill(message: string): boolean {
  const text = n(message);
  return PROFILE_FILL_PHRASES.some((phrase) => text.includes(n(phrase)));
}

export function formatMoney(amount: number): string {
  return `${Number(amount || 0).toLocaleString('fa-IR')} ریال`;
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.trunc(Number(minutes) || 0));
  const fa = (value: number) => value.toLocaleString('fa-IR');
  if (total < 1) return '—';
  if (total % 1440 === 0) return `${fa(total / 1440)} روز`;
  if (total % 60 === 0) return `${fa(total / 60)} ساعت`;
  if (total < 60) return `${fa(total)} دقیقه`;
  return `${fa(Math.floor(total / 60))} ساعت و ${fa(total % 60)} دقیقه`;
}

function formatIranDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export interface BuiltinInput {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  customerId?: string;
  customerName?: string;
  catalog: AssistantCatalog;
  draftState: DraftState | null;
  draftService: ServiceDTO | null;
  accountAccess: boolean;
  requestSubmission: boolean;
}

interface BuiltinResult {
  reply: AssistantReply;
  draftState: DraftState | null;
  draftService: ServiceDTO | null;
}

function baseReply(partial: Partial<AssistantReply>): AssistantReply {
  return {
    reply: '',
    suggestions: [],
    followUpQuestions: [],
    actions: [],
    cards: [],
    draft: null,
    intent: 'unknown',
    sources: [],
    provider: 'builtin',
    handoffSuggested: false,
    disclaimer: '',
    authenticated: false,
    usedPersonalContext: false,
    toolsUsed: [],
    at: new Date().toISOString(),
    ...partial,
  };
}

function topMatch(catalog: AssistantCatalog, message: string): AssistantServiceCard | null {
  const ranked = rankServices(message, catalog.services, 3);
  if (!ranked.length) return null;
  const best = ranked[0];
  if (best.score < 20) return null;
  // A single shared word ("مالیات", "سال") must not be enough to answer a
  // question about a completely different subject. Require the best match to
  // cover a real share of the question, or to contain a distinctive term in
  // its own title.
  const terms = queryTermsOf(message);
  // Coverage is measured against the service's *name and tags* only. A long
  // description may legitimately mention "قانون مالیات" while the service is
  // about something else entirely, and that must not count as a match.
  const hayTokens = n(`${best.service.title} ${best.service.tags.join(' ')}`).split(/\s+/).filter(Boolean);
  const titleTokens = new Set(n(best.service.title).split(/\s+/).filter(Boolean));
  const covered = terms.filter((term) => hayTokens.includes(term)
    || (term.length >= 4 && hayTokens.some((token) => token.includes(term))));
  const coverage = terms.length ? covered.length / terms.length : 0;
  const distinctive = covered.some((term) => term.length >= 4 && titleTokens.has(term));
  return coverage >= 0.5 || (distinctive && coverage >= 0.25) ? best.service : null;
}

function matchesFor(catalog: AssistantCatalog, message: string, limit = 4): AssistantServiceCard[] {
  return rankServices(message, catalog.services, limit).map((item) => item.service);
}

function describeDocuments(service: AssistantServiceCard): string {
  if (!service.documents.length) return 'برای این خدمت مدرک اختصاصی ثبت نشده است.';
  const required = service.documents.filter((document) => document.required);
  const optional = service.documents.filter((document) => !document.required);
  const lines = [
    ...required.map((document) => `• ${document.title}${document.note ? ` — ${document.note}` : ''} (الزامی)`),
    ...optional.map((document) => `• ${document.title} (اختیاری)`),
  ];
  return lines.join('\n');
}

function describeFields(service: AssistantServiceCard): string {
  if (!service.requiredFields.length) return 'فیلد اجباری خاصی ندارد.';
  return service.requiredFields.map((label) => `• ${label}`).join('\n');
}

function serviceSummaryText(service: AssistantServiceCard, options: { urgent?: boolean } = {}): string {
  const lines = [
    `«${service.title}»${service.categoryTitle ? ` — دستهٔ ${service.categoryTitle}` : ''}`,
    service.summary,
    `هزینه: ${formatMoney(service.finalFee)}${service.baseFee !== service.finalFee ? ` (پس از تخفیف از ${formatMoney(service.baseFee)})` : ''}`,
    `زمان تخمینی: ${formatDuration(service.estimatedMinutes)}`,
  ];
  if (service.urgentEnabled) {
    lines.push(`انجام فوری: بله${service.urgentPercent ? ` (٪${service.urgentPercent.toLocaleString('fa-IR')} هزینه بیشتر)` : ''} — تحویل در ${formatDuration(service.urgentMinutes)}`);
  }
  if (options.urgent && !service.urgentEnabled) lines.push('انجام فوری برای این خدمت فعال نیست.');
  if (service.hasExternalCosts) {
    lines.push('هزینهٔ سازمانی: بله — مبالغی مثل حق بیمه یا عوارض جداگانه و پس از بررسی کارشناس اعلام می‌شود.');
  }
  if (!service.acceptingRequests) lines.push('⚠️ این خدمت در حال حاضر درخواست نمی‌پذیرد.');
  return lines.join('\n');
}

/* --------------------------------- drafts --------------------------------- */

function draftPublic(state: DraftState, service: ServiceDTO | null): AssistantDraft {
  return publicDraft(state, service);
}

function previewText(draft: AssistantDraft): string {
  const filled = draft.fields.filter((field) => field.value.trim());
  const lines = [
    'پیش‌نمایش درخواست شما (هنوز ثبت نشده):',
    `• خدمت: ${draft.serviceTitle}`,
    ...filled.map((field) => `• ${field.label}: ${field.value}${field.fromProfile ? ' (از پروفایل)' : ''}`),
    `• هزینهٔ تقریبی: ${draft.pricing ? formatMoney(draft.pricing.total) : 'پس از بررسی'}`,
    `• زمان تخمینی: ${formatDuration(draft.estimatedMinutes)}`,
    `• روش پرداخت: ${draft.paymentMethod === 'wallet' ? 'کیف پول' : 'پرداخت آنلاین'}`,
  ];
  const attached = draft.documents.filter((document) => document.attachment);
  const pending = draft.documents.filter((document) => document.required && !document.attachment);
  if (attached.length) lines.push(`• مدارک پیوست‌شده: ${attached.map((document) => document.title).join('، ')}`);
  if (pending.length) lines.push(`• مدارکی که باید بارگذاری کنید: ${pending.map((document) => document.title).join('، ')}`);
  if (draft.urgentEnabled) lines.push('• انجام فوری: در صورت درخواست، با ٪ هزینه بیشتر امکان‌پذیر است.');
  lines.push('', 'اگر همه‌چیز درست است، دکمهٔ «تأیید و ثبت درخواست» را بزنید یا بنویسید «تأیید می‌کنم». تا آن زمان هیچ درخواستی ثبت نمی‌شود.');
  return lines.join('\n');
}

async function nextQuestion(draft: AssistantDraft): Promise<string> {
  const next = draft.fields.find((field) => field.required && !field.value.trim());
  if (!next) return 'همهٔ فیلدهای اجباری کامل شده‌اند.';
  const options = next.options?.length ? ` (گزینه‌ها: ${next.options.join(' / ')})` : '';
  const remaining = draft.fields.filter((field) => field.required && !field.value.trim()).length;
  return `${next.label} شما چیست؟${options}\n(${remaining} مورد از اطلاعات اجباری باقی مانده است)`;
}

async function fillDraftFromMessage(
  input: BuiltinInput,
  state: DraftState,
  service: ServiceDTO,
  message: string,
): Promise<{ state: DraftState; filled: string[]; invalid: string[] } | null> {
  const draft = publicDraft(state, service);
  const missing = draft.fields.filter((field) => field.required && !field.value.trim());
  if (!missing.length) return null;
  const text = n(message);
  if (!text || text.length > 400) return null;
  // A message that is clearly a new question must never be swallowed as a value.
  if (QUESTION_MARK.test(message) && missing.length > 1) return null;

  const filled: string[] = [];
  const invalid: string[] = [];
  let next = state;
  // 1) "label: value" or "label value" for a named field.
  for (const field of missing) {
    const label = n(field.label);
    const index = text.indexOf(label);
    if (index < 0) continue;
    const raw = message.slice(Math.min(message.length, index + field.label.length)).replace(/^[\s:،\-–—]+/, '').trim();
    if (!raw) continue;
    const value = normalizeFieldValue(service, field.key, raw);
    if (value === null) { invalid.push(field.label); continue; }
    next = await setDraftField(input.customerId!, next, service, field.key, value);
    filled.push(field.label);
    return { state: next, filled, invalid };
  }
  // 2) A short answer to the one field we just asked for.
  if (missing.length === 1 && text.length <= 160 && !startsWithAny(text, [...STATUS_WORDS, ...INVOICE_WORDS, ...LIST_WORDS])) {
    const field = missing[0];
    if (field.type === 'file') return null;
    const value = normalizeFieldValue(service, field.key, message.trim());
    if (value === null) return { state: next, filled, invalid: [field.label] };
    next = await setDraftField(input.customerId!, next, service, field.key, value);
    filled.push(field.label);
    return { state: next, filled, invalid };
  }
  return filled.length ? { state: next, filled, invalid } : null;
}

/** Coerce a chat answer to the field's type, or null when it cannot be valid. */
function normalizeFieldValue(service: ServiceDTO, key: string, raw: string): string | number | boolean | null {
  const field = service.form.find((item) => item.key === key);
  if (!field) return null;
  const value = raw.trim();
  if (!value) return null;
  switch (field.type) {
    case 'select':
    case 'radio': {
      if (!field.options?.length) return value;
      const match = field.options.find((option) => n(option) === n(value) || n(option).includes(n(value)) || n(value).includes(n(option)));
      return match ?? null;
    }
    case 'checkbox':
      return /^(بله|تایید|تأیید|قبول|صحیح|درست|ok|true|1)$/i.test(n(value)) ? true : null;
    case 'number':
    case 'money': {
      const digits = value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^0-9.-]/g, '');
      return digits && Number.isFinite(Number(digits)) ? Number(digits) : null;
    }
    case 'date':
      return value.length >= 6 ? value : null;
    case 'file':
      return null;
    default:
      return value.slice(0, 5000);
  }
}

/* -------------------------------- intents --------------------------------- */

function detectIntent(message: string): AssistantIntent {
  const text = n(message);
  if (!text) return 'unknown';
  if (includesAny(text, HUMAN_WORDS)) return 'handoff';
  if (includesAny(text, WALLET_WORDS)) return 'wallet';
  if (includesAny(text, INVOICE_WORDS) || (includesAny(text, PAYMENT_WORDS) && includesAny(text, ['چقدر', 'مبلغ', 'بدهی']))) return 'invoice';
  if (includesAny(text, STATUS_WORDS)) return 'status';
  if (includesAny(text, TICKET_WORDS)) return 'support';
  if (includesAny(text, PROFILE_WORDS)) return 'profile';
  if (includesAny(text, COMPARE_WORDS)) return 'compare_services';
  if (includesAny(text, START_WORDS)) return 'start_request';
  if (includesAny(text, LIST_WORDS)) return 'find_service';
  if (includesAny(text, DOC_WORDS)) return 'documents';
  if (includesAny(text, FEE_WORDS)) return 'fee';
  if (includesAny(text, DURATION_WORDS) || includesAny(text, URGENT_WORDS)) return 'duration';
  return 'unknown';
}

function greetingAction(input: BuiltinInput): AssistantAction[] {
  if (input.customerId && input.accountAccess) {
    return [
      action('send', 'quick-status', 'وضعیت پرونده‌های من', undefined, 'وضعیت پرونده‌های من را بگو'),
      action('send', 'quick-invoices', 'چقدر باید پرداخت کنم؟', undefined, 'چقدر باید پرداخت کنم؟'),
      action('link', 'quick-services', 'ثبت درخواست جدید', '/app/services', 'می‌خواهم درخواست جدید ثبت کنم'),
    ];
  }
  return [
    action('link', 'quick-login', 'ورود به حساب', '/login', 'ورود'),
    action('link', 'quick-register', 'ثبت‌نام', '/register'),
    action('send', 'quick-services', 'چه خدماتی دارید؟', undefined, 'چه خدماتی دارید؟'),
  ];
}

/* --------------------------------- engine --------------------------------- */

export async function builtinRespond(input: BuiltinInput): Promise<BuiltinResult> {
  const message = input.message.trim();
  const text = n(message);
  const cards: AssistantCard[] = [];
  const actions: AssistantAction[] = [];
  const followUps: string[] = [];
  const suggestions: AssistantServiceCard[] = [];
  const sources: string[] = [];
  let handoff = false;
  let intent: AssistantIntent = 'unknown';
  let reply = '';
  let usedPersonalContext = false;
  let draftState = input.draftState;
  let draftService = input.draftService;
  const draft = () => (draftState && draftService ? draftPublic(draftState, draftService) : null);

  const finish = (partial: Partial<AssistantReply> = {}): BuiltinResult => ({
    reply: baseReply({
      ...(partial as AssistantReply),
      reply: (partial as AssistantReply).reply || reply,
      authenticated: Boolean(input.customerId),
      usedPersonalContext,
      ...(cards.length ? { cards } : {}),
      ...(suggestions.length ? { suggestions } : {}),
      ...(actions.length ? { actions } : {}),
      ...(followUps.length ? { followUpQuestions: followUps } : {}),
      ...(sources.length ? { sources } : {}),
      intent,
      handoffSuggested: handoff,
      draft: draft(),
      ...partial,
    } as AssistantReply),
    draftState,
    draftService,
  });

  /* ------------------------------ active draft ----------------------------- */
  if (draftState && draftService && input.customerId) {
    if (isCancellation(message)) {
      await cancelDraftTool({ ...input, snapshot: null, toolsUsed: [], cards: [] } as any);
      draftState = null;
      draftService = null;
      intent = 'collect_field';
      reply = 'درخواست پیش‌نویس لغو شد و هیچ چیزی ثبت نشد. هر وقت خواستید می‌توانید از نو شروع کنید.';
      followUps.push('ثبت درخواست جدید');
      suggestions.push(...matchesFor(input.catalog, 'درخواست', 3));
      return finish();
    }
    if (wantsProfileFill(message)) {
      const previousForm = { ...draftState.formData };
      const previousAttachments = [...draftState.attachments];
      const restarted = await startDraft(input.customerId, draftService.slug, { useProfile: true });
      draftState = restarted.state;
      draftService = restarted.service;
      // Restarting must not throw away what the customer already typed: an
      // explicit value beats a profile suggestion every time.
      for (const [key, value] of Object.entries(previousForm)) {
        if (draftState.formData[key] === undefined) draftState.formData[key] = value;
      }
      for (const attachment of previousAttachments) {
        if (!draftState.attachments.some((item) => item.requirementKey === attachment.requirementKey)) {
          draftState.attachments.push(attachment);
        }
      }
      draftState = await refresh(input.customerId, draftState, draftService);
      await saveDraftState(input.customerId, draftState);
      const updated = draftPublic(draftState, draftService);
      intent = 'collect_field';
      reply = updated.missingFields.length
        ? `اطلاعات پروفایل شما را در فرم پیشنهاد دادم. این موارد را هم لازم دارم:\n${updated.missingFields.map((label) => `• ${label}`).join('\n')}`
        : 'اطلاعات پروفایل شما را در فرم پیشنهاد دادم. پیش‌نمایش را ببینید و در صورت تأیید، ثبت کنید.';
      if (!updated.missingFields.length) reply = previewText(updated);
      followUps.push(updated.missingFields[0] ? `${updated.missingFields[0]} چیست؟` : 'پیش‌نمایش را نشان بده');
      return finish();
    }
    if (includesAny(text, PREVIEW_WORDS) || text === n('پیش نمایش')) {
      draftState = await refresh(input.customerId, draftState, draftService);
      await saveDraftState(input.customerId, draftState);
      const updated = draftPublic(draftState, draftService);
      intent = 'preview_request';
      reply = updated.missingFields.length || updated.missingDocuments.length
        ? `هنوز این موارد کامل نیست:\n${[
            ...updated.missingFields.map((label) => `• ${label}`),
            ...updated.missingDocuments.map((label) => `• بارگذاری مدرک «${label}»`),
          ].join('\n')}`
        : previewText(updated);
      if (updated.missingDocuments.length) {
        actions.push({
          id: 'upload-docs', label: 'بارگذاری مدارک', kind: 'upload',
          requirementKey: updated.missingDocuments[0],
        });
      }
      return finish();
    }
    if (includesAny(text, EDIT_WORDS)) {
      const updated = draftPublic(draftState, draftService);
      intent = 'collect_field';
      reply = 'این اطلاعات را تا الان دارم. کدام را تغییر بدهم؟\n'
        + updated.fields.filter((field) => field.value.trim()).map((field) => `• ${field.label}: ${field.value}`).join('\n');
      followUps.push(...updated.fields.filter((field) => field.value.trim()).slice(0, 3).map((field) => `${field.label} را تغییر بده`));
      return finish();
    }
    const filled = await fillDraftFromMessage(input, draftState, draftService, message);
    if (filled) {
      draftState = filled.state;
      const updated = draftPublic(draftState, draftService);
      intent = 'collect_field';
      if (filled.invalid.length) {
        reply = `مقدار «${filled.invalid.join('، ')}» با فرم این خدمت سازگار نیست. لطفاً دقیقاً یکی از گزینه‌های مجاز را بنویسید.`;
      } else {
        reply = filled.filled.length
          ? `${filled.filled.join('، ')} ثبت شد. ممنون.`
          : 'متوجه نشدم؛ لطفاً مقدار را واضح‌تر بنویسید.';
      }
      if (updated.missingFields.length) {
        reply += `\n\n${await nextQuestion(updated)}`;
        followUps.push(`${updated.missingFields[0]} را تغییر بده`);
      } else if (updated.missingDocuments.length) {
        reply += `\n\nبرای ادامه، این مدرک را بارگذاری کنید: ${updated.missingDocuments.join('، ')}. می‌توانید از دکمهٔ بارگذاری زیر استفاده کنید.`;
        actions.push(action('upload', `upload-${updated.missingDocuments[0]}`, `بارگذاری ${updated.missingDocuments[0]}`));
      } else {
        reply += `\n\n${previewText(updated)}`;
      }
      return finish();
    }
    if (detectIntent(message) === 'unknown' && text.length <= 120 && !QUESTION_MARK.test(message)) {
      // Could not map the sentence to a field and it is not a question: ask again.
      const updated = draftPublic(draftState, draftService);
      intent = 'collect_field';
      reply = `برای تکمیل درخواست «${updated.serviceTitle}» این را لازم دارم:\n${await nextQuestion(updated)}`;
      return finish();
    }
  }

  /* -------------------------------- greeting ------------------------------- */
  if (startsWithAny(text, GREETINGS) && text.length < 45) {
    intent = 'greeting';
    const name = await getString('assistant.name');
    const categories = input.catalog.categories.slice(0, 6).map((category) => category.title);
    reply = [
      `سلام${input.customerName ? ` ${input.customerName}` : ''} 👋 من ${name} هستم.`,
      input.customerId && input.accountAccess
        ? 'می‌توانم وضعیت پرونده‌های شما، فاکتورها، کیف پول و مدارکتان را ببینم و قدم بعدی را دقیق بگویم. همچنین می‌توانم خدمت مناسب را پیدا کنم و درخواست را با تأیید شما ثبت کنم.'
        : 'می‌توانم خدمت مناسب را از کل کاتالوگ پیدا کنم، هزینه و مدارک را بگویم و شما را برای ثبت درخواست راهنمایی کنم.',
      categories.length ? `دسته‌های اصلی: ${categories.join('، ')}` : '',
    ].filter(Boolean).join('\n\n');
    followUps.push(input.customerId ? 'وضعیت پرونده‌های من را بگو' : 'چه خدماتی دارید؟', 'می‌خواهم درخواست ثبت کنم');
    actions.push(...greetingAction(input));
    return finish();
  }

  /* --------------------------------- handoff ------------------------------- */
  if (includesAny(text, HUMAN_WORDS) && !includesAny(text, ['تیکت', 'تیکت‌ها', 'تیکت ها'])) {
    intent = 'handoff';
    handoff = true;
    reply = 'این موضوع نیاز به بررسی کارشناس دارد. می‌توانید از بخش پشتیبانی یک تیکت ثبت کنید یا در پروندهٔ خود پیام بگذارید؛ من به جای حدس زدن، شما را به همان‌جا می‌برم.';
    actions.push(action('link', 'open-support', 'گفت‌وگو با کارشناس', '/app/support'));
    followUps.push('ثبت تیکت پشتیبانی');
    return finish();
  }

  /* ---------------------------------- wallet ------------------------------- */
  if (intent === 'unknown' && includesAny(text, WALLET_WORDS)) {
    intent = 'wallet';
    if (!input.customerId || !input.accountAccess) {
      reply = 'برای دیدن موجودی کیف پول باید وارد حساب خود شوید. من به اطلاعات مالی هیچ‌کس دیگری دسترسی ندارم.';
      actions.push(action('login', 'login-wallet', 'ورود به حساب', '/app/wallet'));
      return finish();
    }
    usedPersonalContext = true;
    const result = await walletTool({ ...input, snapshot: null, toolsUsed: [], cards } as any);
    if ((result as any).error) {
      reply = 'در حال امروز کیف پول برای حساب شما فعال نیست یا در دسترس نیست.';
    } else {
      const data = result as any;
      reply = `موجودی کیف پول شما ${formatMoney(data.balance)} است (وضعیت: ${data.status}).`
        + (data.pendingTopups > 0 ? `\n${data.pendingTopups.toLocaleString('fa-IR')} درخواست شارژ در انتظار تأیید است.` : '');
    }
    actions.push(action('link', 'open-wallet', 'کیف پول من', '/app/wallet'));
    return finish();
  }

  /* --------------------------------- invoices ------------------------------ */
  if (intent === 'unknown' && includesAny(text, INVOICE_WORDS)) {
    intent = 'invoice';
    if (!input.customerId || !input.accountAccess) {
      reply = 'برای دیدن فاکتورها و مبلغ قابل پرداخت باید وارد حساب خود شوید.';
      actions.push(action('login', 'login-invoices', 'ورود به حساب', '/app/invoices'));
      return finish();
    }
    usedPersonalContext = true;
    const result = await myInvoicesTool({ ...input, snapshot: null, toolsUsed: [], cards } as any) as any;
    if (!result.items.length) {
      reply = 'در حال حاضر فاکتوری به نام شما ثبت نشده است.';
    } else {
      const lines = [`مبلغ قابل پرداخت: ${formatMoney(result.payable)}`];
      if (result.externalPayable > 0) lines.push(`از این مبلغ ${formatMoney(result.externalPayable)} مربوط به هزینه‌های سازمانی است که جداگانه فاکتور شده.`);
      lines.push('فاکتورهای شما:');
      for (const invoice of result.items.slice(0, 5)) {
        lines.push(`• ${invoice.number} — ${invoice.title}: ${formatMoney(invoice.remaining)} باقی‌مانده (${invoice.statusLabel}${invoice.external ? '، هزینهٔ سازمانی' : ''})`);
      }
      reply = lines.join('\n');
    }
    actions.push(action('link', 'open-invoices', 'مشاهده و پرداخت فاکتورها', '/app/invoices'));
    followUps.push('چطور پرداخت کنم؟');
    return finish();
  }

  /* ---------------------------------- status ------------------------------- */
  if (intent === 'unknown' && includesAny(text, STATUS_WORDS)) {
    intent = 'status';
    if (!input.customerId || !input.accountAccess) {
      reply = 'برای پیگیری پرونده باید وارد حساب خود شوید. اطلاعات پرونده‌ها فقط برای همان مشتری قابل مشاهده است.';
      actions.push(action('login', 'login-status', 'ورود و مشاهده پرونده‌ها', '/app/requests'));
      followUps.push('چطور وارد حساب شوم؟');
      return finish();
    }
    usedPersonalContext = true;
    const snapshot = await loadCustomerSnapshot(input.customerId);
    const needle = extractTrackingCode(message);
    const found = await findOwnCase(input.customerId, snapshot, needle);
    if (!found.card) {
      reply = snapshot.requests.length
        ? 'پرونده‌ای با این مشخصات در حساب شما پیدا نکردم. کد رهگیری را از پیامک یا بخش «درخواست‌های من» بردارید.'
        : 'شما هنوز پرونده‌ای ثبت نکرده‌اید. می‌توانم خدمت مناسب را پیدا کنم و درخواست را با تأیید شما ثبت کنم.';
      actions.push(action('link', 'open-requests', 'درخواست‌های من', '/app/requests'));
      if (!snapshot.requests.length) followUps.push('چه خدماتی دارید؟');
      return finish();
    }
    const card = found.card;
    cards.push({ type: 'case', case: card });
    const lines = [
      `پروندهٔ «${card.serviceTitle}» با کد پیگیری ${card.trackingCode}:`,
      `• وضعیت: ${card.statusLabel}${card.currentStepTitle ? ` — مرحلهٔ فعلی: ${card.currentStepTitle}` : ''}`,
      `• کارشناس مسئول: ${card.assigneeName ?? 'هنوز تعیین نشده'}`,
    ];
    if (card.nextStepTitle) lines.push(`• قدم بعدی: ${card.nextStepTitle}`);
    if (card.pendingDocuments.length) lines.push(`• مدارک منتظر شما: ${card.pendingDocuments.join('، ')}`);
    if (card.rejectedDocuments.length) {
      lines.push('• مدارک ردشده:');
      for (const document of card.rejectedDocuments) lines.push(`  - ${document.title}${document.note ? ` — علت: ${document.note}` : ''}`);
    }
    if (card.rejectedReason) lines.push(`• دلیل رد پرونده: ${card.rejectedReason}`);
    const payable = card.invoices.filter((invoice) => invoice.remaining > 0 && !['void', 'draft'].includes(invoice.status));
    if (payable.length) lines.push(`• مبلغ باقی‌مانده: ${formatMoney(payable.reduce((sum, invoice) => sum + invoice.remaining, 0))}`);
    if (card.estimatedCompletionAt) lines.push(`• تخمین تحویل: ${formatIranDate(card.estimatedCompletionAt)}`);
    if (card.nextAction) actions.push(card.nextAction);
    const others = snapshot.requests.filter((item) => item.id !== card.id).slice(0, 3);
    if (others.length) {
      lines.push('', 'سایر پرونده‌های شما:');
      for (const other of others) lines.push(`• ${other.serviceTitle} — ${other.trackingCode} (${other.statusLabel})`);
    }
    reply = lines.join('\n');
    followUps.push('چرا مدرکم رد شده؟', 'چقدر باید پرداخت کنم؟');
    return finish();
  }

  /* --------------------------------- support ------------------------------- */
  if (intent === 'unknown' && includesAny(text, TICKET_WORDS)) {
    intent = 'support';
    if (!input.customerId || !input.accountAccess) {
      reply = 'برای دیدن تیکت‌های پشتیبانی باید وارد حساب خود شوید.';
      actions.push(action('login', 'login-support', 'ورود به حساب', '/app/support'));
      return finish();
    }
    usedPersonalContext = true;
    const result = await myTicketsTool({ ...input, snapshot: null, toolsUsed: [], cards } as any) as any;
    reply = result.items.length
      ? `شما ${result.items.length.toLocaleString('fa-IR')} تیکت پشتیبانی دارید:\n${result.items.slice(0, 5).map((ticket: any) => `• ${ticket.number} — ${ticket.subject} (${ticket.statusLabel})`).join('\n')}`
      : 'تیکت پشتیبانی باز یا بسته‌ای به نام شما ثبت نشده است.';
    actions.push(action('link', 'open-support', 'تیکت‌های پشتیبانی', '/app/support'));
    return finish();
  }

  /* ---------------------------------- profile ------------------------------ */
  if (intent === 'unknown' && includesAny(text, PROFILE_WORDS)) {
    intent = 'profile';
    if (!input.customerId || !input.accountAccess) {
      reply = 'برای دیدن وضعیت پروفایل و مدارک باید وارد حساب خود شوید.';
      actions.push(action('login', 'login-profile', 'ورود به حساب', '/app/profile'));
      return finish();
    }
    usedPersonalContext = true;
    const result = await profileTool({ ...input, snapshot: null, toolsUsed: [], cards } as any) as any;
    const lines: string[] = [];
    if (result.complete) lines.push('پروفایل شما کامل است و برای ثبت درخواست آماده‌اید.');
    else lines.push(`این اطلاعات پروفایل ناقص است: ${result.missing.join('، ')}`);
    if (result.rejectedDocuments.length) {
      lines.push('مدارک ردشده:');
      for (const document of result.rejectedDocuments) {
        lines.push(`• ${document.title}${document.note ? ` — علت: ${document.note}` : ''}`);
      }
    } else {
      lines.push(`${result.documentCount.toLocaleString('fa-IR')} مدرک در پروفایل شما ذخیره شده و همه تأیید شده‌اند.`);
    }
    reply = lines.join('\n');
    actions.push(action('link', 'open-profile', 'تکمیل پروفایل و مدارک', '/app/profile'));
    actions.push(action('link', 'open-documents', 'مدارک من', '/app/documents'));
    return finish();
  }

  /* --------------------------------- compare ------------------------------- */
  if (intent === 'unknown' && includesAny(text, COMPARE_WORDS)) {
    intent = 'compare_services';
    const found = matchesFor(input.catalog, message, 3);
    if (!found.length) {
      reply = 'برای مقایسه، نام دو خدمت را بگویید؛ مثلاً «ثبت شرکت با مسئولیت محدود و سهامی خاص».';
      handoff = false;
      return finish();
    }
    suggestions.push(...found);
    for (const service of found) cards.push({ type: 'service', service });
    const lines = ['مقایسهٔ خدمات:'];
    for (const service of found) {
      lines.push(
        `• ${service.title}: ${formatMoney(service.finalFee)} — ${formatDuration(service.estimatedMinutes)}`
        + ` — ${service.documents.filter((document) => document.required).length.toLocaleString('fa-IR')} مدرک الزامی`
        + (service.urgentEnabled ? ' — امکان فوری' : ''),
      );
    }
    lines.push('', 'اگر بگویید اولویت شما چیست (هزینه، سرعت یا مدارک کمتر)، دقیق‌تر راهنمایی می‌کنم.');
    reply = lines.join('\n');
    followUps.push('کدام برای من مناسب‌تر است؟');
    return finish();
  }

  /* ---------------------------------- start -------------------------------- */
  const wantsStart = intent === 'unknown' && includesAny(text, START_WORDS);
  if (wantsStart) {
    intent = 'start_request';
    if (!input.customerId) {
      const found = topMatch(input.catalog, message);
      if (found) {
        suggestions.push(found);
        cards.push({ type: 'service', service: found });
        reply = `برای ثبت درخواست «${found.title}» ابتدا باید وارد حساب خود شوید یا ثبت‌نام کنید؛ مسیر خدمت حفظ می‌شود و بعد از ورود همان‌جا ادامه می‌دهید.`;
        actions.push(action('login', 'login-to-request', 'ورود / ثبت‌نام', `/app/services/${found.slug}`));
        followUps.push('هزینه و مدارک این خدمت چیست؟');
      } else {
        reply = 'برای ثبت درخواست، ابتدا وارد حساب شوید. اگر هنوز حساب ندارید، ثبت‌نام کنید؛ بعد می‌توانم خدمت را پیدا کنم و فرم را با شما پر کنیم.';
        actions.push(action('login', 'login-to-request', 'ورود / ثبت‌نام', '/app/services'));
      }
      return finish();
    }
    if (!input.requestSubmission) {
      reply = 'ثبت درخواست از طریق دستیار در تنظیمات سامانه غیرفعال است. می‌توانید از صفحهٔ خدمت، فرم را پر کنید.';
      const found = topMatch(input.catalog, message);
      if (found) actions.push(action('link', 'open-service', `صفحهٔ ${found.title}`, `/app/services/${found.slug}`));
      return finish();
    }
    const found = topMatch(input.catalog, message);
    if (!found) {
      reply = 'کدام خدمت را می‌خواهید ثبت کنید؟ عنوان خدمت را بنویسید؛ مثلاً «تعویض پلاک» یا «درخواست خلافی». اگر عنوان دقیق را نمی‌دانید، موضوع را بگویید تا از کاتالوگ پیدا کنم.';
      followUps.push('چه خدماتی دارید؟');
      return finish();
    }
    suggestions.push(found);
    cards.push({ type: 'service', service: found });
    const started = await startDraft(input.customerId, found.slug, { useProfile: false });
    draftState = started.state;
    draftService = started.service;
    const updated = draftPublic(draftState, draftService);
    reply = `بسیار خوب. پیش‌نویس درخواست «${updated.serviceTitle}» را آماده کردم — هنوز چیزی ثبت نشده و تا تأیید صریح شما ثبت نخواهد شد.\n\n`
      + `هزینهٔ تقریبی ${updated.pricing ? formatMoney(updated.pricing.total) : 'پس از بررسی'} و زمان تخمینی ${formatDuration(updated.estimatedMinutes)} است.\n\n`
      + (updated.missingFields.length
        ? `این اطلاعات را از شما می‌خواهم:\n${updated.missingFields.map((label) => `• ${label}`).join('\n')}\n\n${await nextQuestion(updated)}`
        : 'همهٔ فیلدهای اجباری از پروفایل شما قابل پرشدن است؛ پیش‌نمایش را ببینید.');
    if (updated.missingDocuments.length) {
      reply += `\n\nمدارکی که باید بارگذاری کنید: ${updated.missingDocuments.join('، ')}`;
    }
    actions.push(action('send', 'use-profile', 'پرکردن از پروفایل من', undefined, 'از پروفایل پر کن'));
    followUps.push('از پروفایل پر کن', 'پیش‌نمایش را نشان بده');
    return finish();
  }

  /* ---------------------------------- list --------------------------------- */
  if (intent === 'unknown' && includesAny(text, LIST_WORDS)) {
    intent = 'find_service';
    const categories = input.catalog.categories;
    const newest = listCatalogue({ ...input, snapshot: null, draftState: null, draftService: null, toolsUsed: [], cards } as any, { sort: 'newest', limit: 6 });
    reply = `در حال حاضر ${input.catalog.services.length.toLocaleString('fa-IR')} خدمت منتشرشده داریم در ${categories.length.toLocaleString('fa-IR')} دسته:\n`
      + categories.map((category) => `• ${category.title} (${category.serviceCount.toLocaleString('fa-IR')} خدمت)`).join('\n')
      + `\n\nتازه‌ترین خدمات:\n${newest.map((service) => `• ${service.title}`).join('\n')}`;
    suggestions.push(...newest);
    for (const service of newest.slice(0, 3)) cards.push({ type: 'service', service });
    actions.push(action('link', 'open-catalog', 'مشاهده همه خدمات', '/app/services'));
    followUps.push('هزینهٔ کدام خدمت را بپرسم؟');
    return finish();
  }

  /* -------------------------------- service Q ------------------------------ */
  const match = topMatch(input.catalog, message);
  const asksFee = includesAny(text, FEE_WORDS);
  const asksDocs = includesAny(text, DOC_WORDS);
  const asksDuration = includesAny(text, DURATION_WORDS) || includesAny(text, URGENT_WORDS);

  if (match) {
    suggestions.push(match);
    cards.push({ type: 'service', service: match });
    sources.push(match.title);
    const detail = input.catalog.details.get(match.slug);
    if (asksDocs) {
      intent = 'documents';
      reply = `مدارک لازم برای «${match.title}»:\n${describeDocuments(match)}\n\nفیلدهای اجباری فرم:\n${describeFields(match)}`;
      if (detail?.contactNotice) reply += `\n\n${detail.contactNotice}`;
      followUps.push('هزینه‌اش چقدر است؟', 'برای من ثبت کن');
      actions.push(action('link', `open-${match.slug}`, 'صفحهٔ خدمت', `/app/services/${match.slug}`));
      return finish();
    }
    if (asksDuration) {
      intent = 'duration';
      reply = `زمان انجام «${match.title}» حدود ${formatDuration(match.estimatedMinutes)} است.`
        + (match.urgentEnabled ? `\nبا انجام فوری، تحویل در ${formatDuration(match.urgentMinutes)} و با ٪${match.urgentPercent.toLocaleString('fa-IR')} هزینهٔ بیشتر امکان‌پذیر است.` : '\nاین خدمت گزینهٔ انجام فوری ندارد.');
      followUps.push('هزینه‌اش چقدر است؟', 'چه مدارکی لازم دارد؟');
      return finish();
    }
    if (asksFee) {
      intent = 'fee';
      reply = `هزینهٔ «${match.title}» ${formatMoney(match.finalFee)} است`
        + (match.baseFee !== match.finalFee ? ` (پس از تخفیف از ${formatMoney(match.baseFee)})` : '')
        + ` و زمان تخمینی ${formatDuration(match.estimatedMinutes)}.`;
      if (match.hasExternalCosts) {
        reply += '\n\n⚠️ در حین انجام، مبالغی بابت هزینهٔ سازمان (مثل حق بیمه یا عوارض) ممکن است لازم شود که جزو حق‌الزحمهٔ دفتر نیست و جداگانه فاکتور می‌شود.';
      }
      reply += '\n\nاین مبلغ نمونه است و هزینهٔ نهایی پس از بررسی مدارک اعلام می‌شود.';
      followUps.push('چه مدارکی لازم دارد؟', 'برای من ثبت کن');
      actions.push(action('link', `open-${match.slug}`, 'صفحهٔ خدمت', `/app/services/${match.slug}`));
      return finish();
    }
    intent = 'service_details';
    reply = serviceSummaryText(match);
    if (detail?.description) reply += `\n\n${detail.description.slice(0, 700)}`;
    if (detail?.contactNotice) reply += `\n\n${detail.contactNotice}`;
    reply += `\n\nمدارک:\n${describeDocuments(match)}`;
    followUps.push('هزینه‌اش چقدر است؟', 'چه مدارکی لازم دارد؟', 'برای من ثبت کن');
    actions.push(action('link', `open-${match.slug}`, 'صفحهٔ خدمت', `/app/services/${match.slug}`));
    return finish();
  }

  if (asksFee || asksDocs || asksDuration) {
    intent = asksDocs ? 'documents' : asksFee ? 'fee' : 'duration';
    if (includesAny(text, LEGAL_WORDS)) {
      handoff = true;
      reply = 'این پرسش دربارهٔ قانون یا ضوابط رسمی است و در کاتالوگ خدمات دفتر پاسخ ندارد. من نرخ یا شرط قانونی را حدس نمی‌زنم؛ برای پاسخ دقیق یک درخواست اختصاصی یا تیکت پشتیبانی ثبت کنید تا کارشناس بررسی کند.';
      actions.push(action('link', 'open-support', 'ثبت درخواست اختصاصی / تیکت', '/app/support'));
      followUps.push('چه خدماتی دارید؟');
      return finish();
    }
    reply = 'برای پاسخ دقیق باید بدانم کدام خدمت را می‌خواهید. عنوان خدمت را بنویسید؛ مثلاً «تعویض پلاک» یا «سابقه بیمه».';
    followUps.push('چه خدماتی دارید؟');
    return finish();
  }

  /* --------------------------------- unknown ------------------------------- */
  intent = 'unknown';
  handoff = true;
  reply = 'این موضوع در کاتالوگ خدمات دفتر پیدا نکردم و نمی‌خواهم اطلاعات غیررسمی حدس بزنم. اگر مربوط به یکی از خدمات است، عنوان آن را بگویید؛ در غیر این صورت یک درخواست اختصاصی یا تیکت پشتیبانی ثبت کنید تا کارشناس بررسی کند.';
  const near = matchesFor(input.catalog, message, 3);
  if (near.length) {
    suggestions.push(...near);
    for (const service of near.slice(0, 2)) cards.push({ type: 'service', service });
    reply += `\n\nشاید این خدمات مرتبط باشند:\n${near.map((service) => `• ${service.title}`).join('\n')}`;
  }
  actions.push(action('link', 'open-support', 'ثبت درخواست اختصاصی / تیکت', '/app/support'));
  followUps.push('چه خدماتی دارید؟');
  return finish();
}

/** Extract a tracking code like `PK-20261234` from a sentence. */
export function extractTrackingCode(message: string): string | undefined {
  const ascii = message.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  const match = ascii.match(/[A-Za-z]{2,6}-\d{4,12}/i);
  return match?.[0].toUpperCase();
}

export async function builtinConfirm(
  input: BuiltinInput,
  actor: { id: string; name: string; ip?: string },
): Promise<BuiltinResult> {
  const cards: AssistantCard[] = [];
  const ctx: any = { ...input, snapshot: null, toolsUsed: [], cards };
  const result = await confirmDraftTool(ctx, actor) as any;
  const submitted = ctx.draftState && ctx.draftService ? publicDraft(ctx.draftState, ctx.draftService) : null;
  if ((result as any).error) {
    return {
      reply: baseReply({
        authenticated: Boolean(input.customerId),
        usedPersonalContext: true,
        intent: 'preview_request',
        reply: (result as any).message ?? 'ثبت درخواست انجام نشد. پیش‌نمایش را کامل کنید و دوباره تأیید کنید.',
        handoffSuggested: false,
        cards: [],
        draft: input.draftState && input.draftService ? publicDraft(input.draftState, input.draftService) : null,
        actions: [action('link', 'open-support', 'تماس با پشتیبانی', '/app/support')],
      }),
      draftState: input.draftState,
      draftService: input.draftService,
    };
  }
  return {
    reply: baseReply({
      authenticated: Boolean(input.customerId),
      usedPersonalContext: true,
      intent: 'request_submitted',
      reply: [
        `درخواست شما با موفقیت ثبت شد ✅`,
        `کد پیگیری: ${result.trackingCode}`,
        `خدمت: ${result.serviceTitle}`,
        `مبلغ: ${formatMoney(result.total)}${result.paymentStatus === 'paid' ? ' (پرداخت‌شده)' : ''}`,
        '',
        'اکنون می‌توانید در صفحهٔ پرونده، مدارک را بارگذاری یا فاکتور را پرداخت کنید. کارشناس همچنین از طریق پیام و اعلان با شما در تماس است.',
      ].join('\n'),
      actions: [
        action('link', 'open-request', 'مشاهده پرونده', `/app/requests/${result.requestId}`),
        action('link', 'open-invoices', 'پرداخت فاکتور', '/app/invoices'),
      ],
      cards,
      handoffSuggested: false,
      draft: submitted,
    }),
    draftState: ctx.draftState,
    draftService: ctx.draftService,
  };
}
