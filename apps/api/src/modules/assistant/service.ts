import { searchServices, listCategories, type ServiceDTO } from '../catalog/service.js';
import { getBool, getNumber, getSecret, getString } from '../settings/service.js';
import { normalizePersian } from '../../lib/text.js';

export interface AssistantReply {
  reply: string;
  suggestions: {
    id: string; slug: string; title: string; summary: string; categoryTitle?: string | null;
    fee: number; estimatedDays: number; needsReview: boolean;
  }[];
  followUpQuestions: string[];
  intent: 'greeting' | 'find_service' | 'fee' | 'status' | 'documents' | 'handoff' | 'smalltalk' | 'unknown';
  sources: string[];
  provider: 'builtin' | 'llm';
  handoffSuggested: boolean;
  disclaimer: string;
}

const GREETINGS = ['سلام', 'درود', 'وقت بخیر', 'hi', 'hello', 'صبح بخیر', 'شب بخیر'];
const STATUS_WORDS = ['وضعیت', 'پیگیری', 'کد رهگیری', 'پرونده من', 'کجاست', 'چقدر مانده'];
const FEE_WORDS = ['هزینه', 'قیمت', 'تعرفه', 'چقدر', 'مبلغ', 'پرداخت'];
const DOC_WORDS = ['مدرک', 'مدارک', 'چه چیز لازم', 'چه مدارکی', 'نیاز دارم'];
const HUMAN_WORDS = ['کارشناس', 'اپراتور', 'انسانی', 'پشتیبان', 'تماس بگیر', 'شکایت'];

function toSuggestion(service: ServiceDTO) {
  return {
    id: service.id,
    slug: service.slug,
    title: service.title,
    summary: service.summary,
    categoryTitle: service.categoryTitle,
    fee: service.finalFee,
    estimatedDays: service.estimatedDays,
    needsReview: service.needsReview,
  };
}

function followUpsFor(service: ServiceDTO | undefined): string[] {
  if (!service) return [];
  const required = service.form.filter((f) => f.required && ['text', 'select', 'national_id', 'tel'].includes(f.type)).slice(0, 3);
  return required.map((f) => `${f.label} شما چیست؟`);
}

/**
 * Built-in assistant: grounded in the service catalogue only.
 * It never invents official conditions; when confidence is low it hands off to a human.
 */
async function builtinReply(message: string, options: { customerId?: string }): Promise<AssistantReply> {
  const normalized = normalizePersian(message);
  const disclaimer = await getString('assistant.disclaimer');
  const maxSuggestions = await getNumber('assistant.max_suggestions');

  const isGreeting = GREETINGS.some((g) => normalized.startsWith(normalizePersian(g))) && normalized.length < 30;
  if (isGreeting) {
    const categories = await listCategories();
    return {
      reply: `سلام 👋 من دستیار هوشمند دفتر هستم. می‌توانم خدمت مناسب را پیدا کنم، مدارک لازم را بگویم و شما را به ثبت درخواست هدایت کنم.\n\nدسته‌های اصلی:\n${categories.map((c) => `• ${c.title}`).join('\n')}`,
      suggestions: [],
      followUpQuestions: ['چه خدمتی نیاز دارید؟', 'درخواست قبلی دارید که بخواهید پیگیری کنید؟'],
      intent: 'greeting',
      sources: [],
      provider: 'builtin',
      handoffSuggested: false,
      disclaimer,
    };
  }

  if (HUMAN_WORDS.some((w) => normalized.includes(normalizePersian(w)))) {
    return {
      reply: 'می‌توانم گفت‌وگوی شما را به کارشناس دفتر ارجاع دهم. از بخش «پیام‌ها» یک گفت‌وگوی جدید با دفتر ایجاد کنید تا همکاران ما پاسخ دهند. اگر پرونده فعال دارید، همان صفحه پرونده را برای پیام مرتبط استفاده کنید.',
      suggestions: [],
      followUpQuestions: ['آیا درخواست فعالی دارید که بخواهید در همان پرونده پیام بدهید؟'],
      intent: 'handoff',
      sources: [],
      provider: 'builtin',
      handoffSuggested: true,
      disclaimer,
    };
  }

  if (STATUS_WORDS.some((w) => normalized.includes(normalizePersian(w)))) {
    return {
      reply: 'وضعیت پرونده‌های شما در بخش «درخواست‌های من» با شماره پیگیری و تاریخچه کامل نمایش داده می‌شود. برای امنیت، دستیار به اطلاعات شخصی پرونده‌ها دسترسی مستقیم ندارد و وضعیت را حدس نمی‌زند.',
      suggestions: [],
      followUpQuestions: ['شماره پیگیری پرونده را دارید؟'],
      intent: 'status',
      sources: [],
      provider: 'builtin',
      handoffSuggested: false,
      disclaimer,
    };
  }

  const results = await searchServices(message, { limit: maxSuggestions + 2, customerId: options.customerId });
  const top = results.slice(0, maxSuggestions);

  if (top.length === 0) {
    return {
      reply: 'خدمت مرتبطی در کاتالوگ پیدا نکردم. اگر عنوان رسمی خدمت را نمی‌دانید، موضوع را با کارشناس دفتر در میان بگذارید تا راهنمایی دقیق بگیرید. من از ارائه اطلاعات تأییدنشده خودداری می‌کنم.',
      suggestions: [],
      followUpQuestions: ['موضوع درخواست شما مربوط به بیمه، شرکت یا یارانه است؟'],
      intent: 'unknown',
      sources: [],
      provider: 'builtin',
      handoffSuggested: true,
      disclaimer,
    };
  }

  const primary = top[0];
  const wantsFee = FEE_WORDS.some((w) => normalized.includes(normalizePersian(w)));
  const wantsDocs = DOC_WORDS.some((w) => normalized.includes(normalizePersian(w)));

  let reply = '';
  if (wantsDocs) {
    const docs = primary.documents.length
      ? primary.documents.map((d) => `• ${d.title}${d.required ? ' (الزامی)' : ''}`).join('\n')
      : 'برای این خدمت مدارک اختصاصی ثبت نشده است.';
    reply = `مدارک خدمت «${primary.title}»:\n${docs}`;
  } else if (wantsFee) {
    reply = `هزینه نمایش‌داده‌شده برای «${primary.title}» حدود ${primary.finalFee.toLocaleString('fa-IR')} ریال و زمان تخمینی ${primary.estimatedDays} روز کاری است. این مقدار نمونه است و هزینه نهایی پس از بررسی مدارک توسط دفتر اعلام می‌شود.`;
  } else {
    reply = `بر اساس درخواست شما، این خدمات را پیشنهاد می‌کنم:\n${top.map((s, i) => `${i + 1}. ${s.title} — ${s.summary}`).join('\n')}\n\nبرای ثبت درخواست، روی خدمت مورد نظر بزنید؛ فرم اختصاصی همان خدمت باز می‌شود.`;
  }

  return {
    reply,
    suggestions: top.map(toSuggestion),
    followUpQuestions: followUpsFor(primary),
    intent: wantsDocs ? 'documents' : wantsFee ? 'fee' : 'find_service',
    sources: top.map((s) => s.title),
    provider: 'builtin',
    handoffSuggested: false,
    disclaimer,
  };
}

/**
 * Optional LLM layer (OpenAI-compatible). It only receives the approved
 * catalogue as context and is instructed not to invent official rules.
 * Any failure falls back to the built-in engine.
 */
async function llmReply(message: string, history: { role: 'user' | 'assistant'; content: string }[], customerId?: string): Promise<AssistantReply | null> {
  const provider = await getString('assistant.llm_provider');
  if (provider !== 'openai') return null;
  const apiKey = await getSecret('assistant.llm_api_key');
  if (!apiKey) return null;

  const baseUrl = (await getString('assistant.llm_base_url')) || 'https://api.openai.com/v1';
  const model = await getString('assistant.llm_model');
  const catalogOnly = await getBool('assistant.catalog_only');

  const matches = await searchServices(message, { limit: 6, customerId });
  const context = matches.map((s) => ({
    title: s.title, summary: s.summary, fee_sample: s.finalFee, days: s.estimatedDays,
    documents: s.documents.map((d) => d.title), required_fields: s.form.filter((f) => f.required).map((f) => f.label),
  }));

  const systemPrompt = [
    'You are the Persian-language assistant of a Iranian government service office (دفتر پیشخوان دولت).',
    'Answer ONLY from the provided catalogue context. Never invent official fees, rules, deadlines or legal conditions.',
    'If the catalogue does not contain the answer, say you do not know and suggest contacting a human expert.',
    'Reply in Persian, concise (max 120 words), and guide the user to submit a request when relevant.',
    catalogOnly ? 'Strict catalogue mode is ON.' : '',
    `Catalogue context: ${JSON.stringify(context)}`,
  ].filter(Boolean).join('\n');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-6),
          { role: 'user', content: message },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string') return null;

    const top = matches.slice(0, await getNumber('assistant.max_suggestions'));
    return {
      reply: text.trim(),
      suggestions: top.map(toSuggestion),
      followUpQuestions: followUpsFor(top[0]),
      intent: 'find_service',
      sources: top.map((s) => s.title),
      provider: 'llm',
      handoffSuggested: false,
      disclaimer: await getString('assistant.disclaimer'),
    };
  } catch {
    return null;
  }
}

export async function assistantRespond(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  options: { customerId?: string } = {},
): Promise<AssistantReply> {
  if (!(await getBool('assistant.enabled'))) {
    return {
      reply: 'دستیار هوشمند در حال حاضر غیرفعال است. می‌توانید از جست‌وجوی خدمات یا ارسال پیام به دفتر استفاده کنید.',
      suggestions: [], followUpQuestions: [], intent: 'unknown', sources: [],
      provider: 'builtin', handoffSuggested: true, disclaimer: '',
    };
  }
  const llm = await llmReply(message, history, options.customerId);
  if (llm) return llm;
  return builtinReply(message, options);
}
