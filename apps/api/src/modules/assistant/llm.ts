/**
 * Optional language-model engine (OpenAI-compatible, tool calling).
 *
 * The model never becomes the source of truth:
 *   * every fact about services comes from a tool result built from the live
 *     catalogue;
 *   * every fact about the customer comes from a tool scoped to the signed-in
 *     customer's id;
 *   * submission is not a tool. The model may start a draft, fill fields and
 *     describe a preview, but the request is created only by the request
 *     handler after an explicit confirmation.
 *
 * Any failure (no key, timeout, malformed JSON, provider error) returns null
 * so the caller falls back to the built-in engine instead of failing the turn.
 */
import { getBool, getNumber, getSecret, getString } from '../settings/service.js';
import { compactService } from './catalog.js';
import { publicDraft } from './drafts.js';
import { executeTool, toolDefinitions, type AssistantContext } from './tools.js';
import type {
  AssistantCard, AssistantIntent, AssistantReply, AssistantServiceCard,
} from './types.js';

const INTENTS: AssistantIntent[] = [
  'greeting', 'smalltalk', 'find_service', 'compare_services', 'service_details', 'fee', 'documents',
  'duration', 'status', 'invoice', 'payment', 'wallet', 'profile', 'support', 'start_request',
  'collect_field', 'preview_request', 'request_submitted', 'handoff', 'unknown',
];

export interface LlmInput {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  ctx: AssistantContext;
  customerName?: string;
  disclaimer: string;
}

function parseJsonReply(content: string): any | null {
  const text = String(content ?? '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeIntent(value: unknown): AssistantIntent {
  return typeof value === 'string' && (INTENTS as string[]).includes(value) ? value as AssistantIntent : 'unknown';
}

function slugOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof (value as any).slug === 'string') return (value as any).slug.trim();
  return null;
}

function dedupeCards(cards: AssistantCard[]): AssistantCard[] {
  const seen = new Set<string>();
  const out: AssistantCard[] = [];
  for (const card of cards) {
    const key = card.type === 'service' ? `service:${card.service.id}`
      : card.type === 'case' ? `case:${card.case.id}`
        : card.type === 'invoice' ? `invoice:${card.invoice.id}`
          : card.type === 'wallet' ? 'wallet'
            : card.type === 'profile' ? 'profile'
              : card.type === 'ticket' ? `ticket:${card.ticket.id}`
                : `catalog:${card.catalog.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

function buildSystemPrompt(input: LlmInput, catalogOnly: boolean): string {
  const { ctx } = input;
  const categories = ctx.catalog.categories.map((category) => `- ${category.slug}: ${category.title} (${category.serviceCount})`).join('\n');
  const recent = ctx.catalog.services.slice(0, 30).map((service) => `- ${service.slug}: ${service.title}`).join('\n');
  const draft = ctx.draftState && ctx.draftService ? publicDraft(ctx.draftState, ctx.draftService) : null;
  return [
    'You are the Persian-language assistant of an Iranian government services office (دفتر پیشخوان دولت).',
    'Answer ONLY from tool results. Never invent official fees, legal conditions, deadlines, documents or rules.',
    'If the tools do not contain the answer, say plainly that you do not know and offer a support ticket or a human expert.',
    'You can only see the signed-in customer\'s own data. Never discuss another customer\'s information.',
    ctx.customerId
      ? `The customer is signed in${input.customerName ? ` as ${input.customerName}` : ''}. Personal-data tools are available; use them for status, invoice, wallet, profile and ticket questions.`
      : 'The visitor is NOT signed in. Do not call personal-data tools. For account questions, tell them to sign in and say the path is preserved.',
    'Request submission rules (strict):',
    '  - To submit a request, call start_request_draft, then set_request_field for each missing field (ask one clear question at a time), then preview_request_draft.',
    '  - You can NEVER submit a request. Only the customer can, by pressing the confirm button or typing an explicit confirmation after seeing the preview.',
    '  - Never claim a request was created unless the server state says stage is "submitted".',
    '  - Do not use profile values unless the customer agreed to use their profile.',
    'Style: warm, concise Persian (max ~140 words), no markdown tables, bullet points are fine. Use Persian digits.',
    'Return STRICT JSON only, no prose outside JSON, matching this shape:',
    '{"reply":"...","intent":"...","suggestions":["service-slug"],"followUpQuestions":["..."],"handoffSuggested":false}',
    `Valid intent values: ${INTENTS.join(', ')}.`,
    'Categories:',
    categories,
    'A sample of service slugs (use search_services / list_services / get_service for anything else):',
    recent,
    draft ? `Active request draft (server state): ${JSON.stringify({
      stage: draft.stage, serviceTitle: draft.serviceTitle, missingFields: draft.missingFields,
      missingDocuments: draft.missingDocuments, fields: draft.fields.map((field) => ({ key: field.key, label: field.label, value: field.value })),
    })}` : 'There is no active request draft.',
    `assistant.catalog_only=${catalogOnly}`,
  ].join('\n');
}

/** Merge the model's JSON with the authoritative server state. */
function finalizeReply(input: LlmInput, content: string): AssistantReply | null {
  const { ctx } = input;
  const parsed = parseJsonReply(content);
  const text = typeof parsed?.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : String(content ?? '').trim();
  if (!text) return null;

  let intent = normalizeIntent(parsed?.intent);
  const requestedSlugs = Array.isArray(parsed?.suggestions) ? parsed.suggestions.map(slugOf).filter(Boolean) as string[] : [];
  const suggestions: AssistantServiceCard[] = [];
  for (const slug of requestedSlugs) {
    const card = ctx.catalog.services.find((service) => service.slug === slug);
    if (card && !suggestions.some((item) => item.id === card.id)) suggestions.push(card);
  }
  for (const card of ctx.cards) {
    if (card.type === 'service' && !suggestions.some((item) => item.id === card.service.id)) suggestions.push(card.service);
  }

  const draft = ctx.draftState && ctx.draftService ? publicDraft(ctx.draftState, ctx.draftService) : null;
  // The model cannot submit. If it claims it did, the server state is the truth.
  if (intent === 'request_submitted' && !draft?.requestId) {
    intent = draft ? 'preview_request' : 'unknown';
    return {
      reply: draft
        ? 'درخواست هنوز ثبت نشده است. پیش‌نمایش را ببینید و در صورت تأیید، دکمهٔ «تأیید و ثبت درخواست» را بزنید.'
        : 'هنوز درخواستی ثبت نشده است. ابتدا خدمت را انتخاب کنید و پیش‌نمایش را تأیید کنید.',
      suggestions,
      followUpQuestions: [],
      actions: draft?.actions ?? [],
      cards: dedupeCards(ctx.cards),
      draft,
      intent,
      sources: suggestions.map((service) => service.title),
      provider: 'llm',
      handoffSuggested: false,
      disclaimer: input.disclaimer,
      authenticated: Boolean(ctx.customerId),
      usedPersonalContext: Boolean(ctx.customerId) && ctx.toolsUsed.some((tool) => tool.startsWith('get_my') || tool === 'get_request_status' || tool === 'get_wallet'),
      toolsUsed: [...ctx.toolsUsed],
      at: new Date().toISOString(),
    };
  }

  const followUpQuestions = Array.isArray(parsed?.followUpQuestions)
    ? parsed.followUpQuestions.filter((item: unknown) => typeof item === 'string' && item.trim()).slice(0, 4)
    : [];
  const actions = [...(draft?.actions ?? [])];
  for (const card of ctx.cards) {
    if (card.type === 'case' && card.case.nextAction) actions.push(card.case.nextAction);
    if (card.type === 'invoice' && card.invoice.action) actions.push(card.invoice.action);
    if (card.type === 'wallet' && card.wallet.action) actions.push(card.wallet.action);
    if (card.type === 'profile' && card.profile.action) actions.push(card.profile.action);
    if (card.type === 'ticket' && card.ticket.action) actions.push(card.ticket.action);
  }

  return {
    reply: text,
    suggestions,
    followUpQuestions,
    actions,
    cards: dedupeCards(ctx.cards),
    draft,
    intent,
    sources: [...new Set([...suggestions.map((service) => service.title), ...ctx.cards.filter((card) => card.type === 'case').map((card) => card.case.trackingCode)])],
    provider: 'llm',
    handoffSuggested: Boolean(parsed?.handoffSuggested),
    disclaimer: input.disclaimer,
    authenticated: Boolean(ctx.customerId),
    usedPersonalContext: Boolean(ctx.customerId) && ctx.toolsUsed.some((tool) => tool.startsWith('get_my') || tool === 'get_request_status' || tool === 'get_wallet'),
    toolsUsed: [...ctx.toolsUsed],
    at: new Date().toISOString(),
  };
}

export async function llmRespond(input: LlmInput): Promise<AssistantReply | null> {
  const provider = await getString('assistant.llm_provider');
  if (provider !== 'openai') return null;
  const apiKey = await getSecret('assistant.llm_api_key');
  if (!apiKey) return null;
  const baseUrl = (await getString('assistant.llm_base_url')) || 'https://api.openai.com/v1';
  const model = await getString('assistant.llm_model');
  if (!model) return null;
  const maxSteps = Math.min(8, Math.max(1, await getNumber('assistant.max_tool_steps')));
  const catalogOnly = await getBool('assistant.catalog_only');

  const messages: any[] = [
    { role: 'system', content: buildSystemPrompt(input, catalogOnly) },
    ...input.history.slice(-10).map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: input.message },
  ];
  const tools = toolDefinitions(input.ctx.accountAccess, input.ctx.requestSubmission);

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 900,
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          messages,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const json: any = await res.json();
      const message = json?.choices?.[0]?.message;
      if (!message) return null;

      if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
        messages.push(message);
        for (const call of message.tool_calls) {
          const name = String(call?.function?.name ?? '');
          let args: Record<string, any> = {};
          try { args = JSON.parse(call?.function?.arguments || '{}'); } catch { args = {}; }
          const result = await executeTool(input.ctx, name, args);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result.ok ? result.data : { error: result.error ?? 'tool_error', ...(result.data ?? {}) }),
          });
        }
        continue;
      }

      const finalized = finalizeReply(input, String(message.content ?? ''));
      return finalized;
    }
    return null;
  } catch {
    return null;
  }
}

export async function llmAvailable(): Promise<boolean> {
  if (await getString('assistant.llm_provider') !== 'openai') return false;
  return Boolean(await getSecret('assistant.llm_api_key')) && Boolean(await getString('assistant.llm_model'));
}

/** Compact context used by tests and diagnostics. */
export function llmCatalogSummary(ctx: AssistantContext) {
  return {
    services: ctx.catalog.services.length,
    categories: ctx.catalog.categories.length,
    sample: ctx.catalog.services.slice(0, 5).map(compactService),
  };
}
