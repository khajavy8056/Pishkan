/**
 * Assistant orchestration.
 *
 * One entry point for both clients. The order of authority is deliberate:
 *   1. Session → the only source of a `customerId` (staff sessions are guests
 *      here, so an employee token can never read a customer's account).
 *   2. Action → an explicit confirm/cancel is handled before any model runs,
 *      because a language model must not be able to accept a confirmation.
 *   3. Live catalogue + scoped account tools → the only facts.
 *   4. Language model (optional) with tool calling → falls back to the
 *      built-in engine on any failure.
 */
import type { AuthContext } from '../auth/types.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import { loadAssistantCatalog } from './catalog.js';
import { loadCustomerSnapshot } from './customer.js';
import { draftService, loadDraftState, publicDraft, refresh, saveDraftState, type DraftState } from './drafts.js';
import { builtinConfirm, builtinRespond, isConfirmation } from './builtin.js';
import { llmRespond } from './llm.js';
import { cancelDraftTool, type AssistantContext } from './tools.js';
import { toServiceCard } from './catalog.js';
import { emptyReply, type AssistantDraft, type AssistantInfo, type AssistantReply } from './types.js';
import type { ServiceDTO } from '../catalog/service.js';

export type AssistantAction = 'message' | 'confirm' | 'cancel' | 'preview';

export interface AssistantRequest {
  message?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  action?: AssistantAction;
  draftId?: string;
  auth?: AuthContext;
  ip?: string;
}

async function buildContext(
  customerId: string | undefined,
  accountAccess: boolean,
  requestSubmission: boolean,
  existingDraft?: DraftState | null,
): Promise<{ ctx: AssistantContext; draftService: ServiceDTO | null }> {
  const catalog = await loadAssistantCatalog(customerId);
  let draftState = existingDraft ?? null;
  if (customerId && !draftState) draftState = await loadDraftState(customerId).catch(() => null);
  let service: ServiceDTO | null = null;
  if (draftState) service = await draftService(draftState).catch(() => null);
  return {
    ctx: {
      customerId,
      customerName: undefined,
      catalog,
      snapshot: null,
      draftState,
      draftService: service,
      accountAccess,
      requestSubmission,
      toolsUsed: [],
      cards: [],
    },
    draftService: service,
  };
}

function withDefaults(reply: AssistantReply, options: { authenticated: boolean; disclaimer: string }): AssistantReply {
  return { ...reply, authenticated: options.authenticated, disclaimer: options.disclaimer };
}

export async function assistantRespond(input: AssistantRequest): Promise<AssistantReply> {
  const disclaimer = await getString('assistant.disclaimer');
  const customerId = input.auth?.user.kind === 'customer' ? input.auth.user.id : undefined;
  const authenticated = Boolean(customerId);

  if (!(await getBool('assistant.enabled'))) {
    return emptyReply({
      reply: 'دستیار هوشمند در حال حاضر غیرفعال است. می‌توانید از جست‌وجوی خدمات یا ارسال پیام به دفتر استفاده کنید.',
      intent: 'unknown',
      handoffSuggested: true,
      disclaimer,
      authenticated,
      actions: [{ id: 'open-support', label: 'گفت‌وگو با دفتر', kind: 'link', route: '/app/support' }],
    });
  }

  const accountAccess = authenticated ? await getBool('assistant.account_access') : false;
  const requestSubmission = authenticated ? await getBool('assistant.request_submission') : false;
  const { ctx, draftService: currentDraftService } = await buildContext(customerId, accountAccess, requestSubmission);

  /* ------------------------- explicit lifecycle actions --------------------- */
  if (input.action === 'cancel') {
    if (!authenticated) {
      return emptyReply({
        reply: 'برای لغو یک پیش‌نویس باید وارد حساب خود شوید.',
        intent: 'collect_field', handoffSuggested: false, disclaimer, authenticated,
      });
    }
    const cancelled = await cancelDraftTool(ctx);
    return emptyReply({
      reply: cancelled?.cancelled
        ? 'پیش‌نویس درخواست لغو شد و هیچ چیزی ثبت نشد.'
        : 'پیش‌نویس فعالی برای لغو وجود نداشت.',
      intent: 'collect_field',
      handoffSuggested: false,
      disclaimer,
      authenticated,
      actions: [{ id: 'open-services', label: 'مشاهده خدمات', kind: 'link', route: '/app/services' }],
      draft: ctx.draftState && currentDraftService ? publicDraft(ctx.draftState, currentDraftService) : null,
    });
  }

  if (input.action === 'confirm') {
    if (!authenticated) {
      return emptyReply({
        reply: 'برای ثبت درخواست باید وارد حساب خود شوید.',
        intent: 'preview_request', handoffSuggested: false, disclaimer, authenticated,
        actions: [{ id: 'login', label: 'ورود / ثبت‌نام', kind: 'login', route: '/login' }],
      });
    }
    if (!ctx.draftState) {
      return emptyReply({
        reply: 'پیش‌نویس فعالی برای تأیید وجود ندارد. ابتدا خدمت را انتخاب کنید و پیش‌نمایش را ببینید.',
        intent: 'preview_request', handoffSuggested: false, disclaimer, authenticated,
        actions: [{ id: 'open-services', label: 'انتخاب خدمت', kind: 'link', route: '/app/services' }],
      });
    }
    const service = await draftService(ctx.draftState);
    if (!service) {
      return emptyReply({
        reply: 'خدمت این پیش‌نویس دیگر در دسترس نیست. از کاتالوگ، خدمت را دوباره انتخاب کنید.',
        intent: 'preview_request', handoffSuggested: false, disclaimer, authenticated,
      });
    }
    const result = await builtinConfirm({
      message: input.message ?? '',
      history: input.history ?? [],
      customerId,
      catalog: ctx.catalog,
      draftState: ctx.draftState,
      draftService: service,
      accountAccess,
      requestSubmission,
    }, { id: input.auth!.user.id, name: input.auth!.user.fullName, ip: input.ip });
    return withDefaults(result.reply, { authenticated, disclaimer });
  }

  if (input.action === 'preview') {
    if (!authenticated || !ctx.draftState) {
      return emptyReply({
        reply: 'پیش‌نویس فعالی وجود ندارد. ابتدا یک خدمت را انتخاب کنید.',
        intent: 'preview_request', handoffSuggested: false, disclaimer, authenticated,
        actions: [{ id: 'open-services', label: 'انتخاب خدمت', kind: 'link', route: '/app/services' }],
      });
    }
    const service = await draftService(ctx.draftState);
    if (!service) {
      return emptyReply({
        reply: 'خدمت این پیش‌نویس دیگر در دسترس نیست. از کاتالوگ دوباره انتخاب کنید.',
        intent: 'preview_request', handoffSuggested: false, disclaimer, authenticated,
      });
    }
    ctx.draftState = await refresh(customerId!, ctx.draftState, service);
    await saveDraftState(customerId!, ctx.draftState);
    const draft = publicDraft(ctx.draftState, service);
    return emptyReply({
      reply: draft.missingFields.length || draft.missingDocuments.length
        ? 'این موارد هنوز کامل نیست:\n'
          + [...draft.missingFields.map((label) => `• ${label}`), ...draft.missingDocuments.map((label) => `• بارگذاری «${label}»`)].join('\n')
        : 'پیش‌نمایش کامل است. در صورت تأیید، دکمهٔ «تأیید و ثبت درخواست» را بزنید.',
      intent: 'preview_request',
      disclaimer,
      authenticated,
      draft,
      actions: draft.actions,
      cards: [{ type: 'service', service: toServiceCard(service) }],
    });
  }

  const message = String(input.message ?? '').trim();
  if (!message) {
    return emptyReply({
      reply: 'چطور می‌توانم کمک کنم؟ می‌توانم خدمت مناسب را پیدا کنم، هزینه و مدارک را بگویم یا وضعیت پرونده‌تان را بررسی کنم.',
      intent: 'greeting', disclaimer, authenticated,
      followUpQuestions: ['چه خدماتی دارید؟', 'وضعیت پرونده‌های من را بگو'],
    });
  }

  /* ------------------------- typed confirmation phrase --------------------- */
  // A typed confirmation is only honoured when the server already has a draft
  // in `awaiting_confirmation`; the preview must have been produced first.
  if (authenticated && ctx.draftState && isConfirmation(message)) {
    const service = await draftService(ctx.draftState);
    if (service && ctx.draftState.draft.stage === 'awaiting_confirmation') {
      const result = await builtinConfirm({
        message, history: input.history ?? [], customerId, catalog: ctx.catalog,
        draftState: ctx.draftState, draftService: service, accountAccess, requestSubmission,
      }, { id: input.auth!.user.id, name: input.auth!.user.fullName, ip: input.ip });
      return withDefaults(result.reply, { authenticated, disclaimer });
    }
    if (service && ctx.draftState.draft.stage !== 'submitted') {
      return emptyReply({
        reply: 'هنوز پیش‌نمایش کامل نشده است، پس چیزی ثبت نمی‌کنم. ابتدا اطلاعات و مدارک ناقص را کامل کنید؛ بعد تأیید کنید.',
        intent: 'preview_request', disclaimer, authenticated,
        draft: publicDraft(ctx.draftState, service),
        actions: [{ id: 'edit-draft', label: 'تکمیل اطلاعات', kind: 'edit', draftId: ctx.draftState.draft.id }],
      });
    }
  }

  /* ------------------------------- model first ----------------------------- */
  const llm = await llmRespond({
    message,
    history: input.history ?? [],
    ctx,
    customerName: input.auth?.user.fullName,
    disclaimer,
  }).catch(() => null);
  if (llm) return withDefaults(llm, { authenticated, disclaimer });

  /* ------------------------------- fallback ------------------------------- */
  const builtin = await builtinRespond({
    message,
    history: input.history ?? [],
    customerId,
    customerName: input.auth?.user.fullName,
    catalog: ctx.catalog,
    draftState: ctx.draftState,
    draftService: currentDraftService,
    accountAccess,
    requestSubmission,
  });
  return withDefaults(builtin.reply, { authenticated, disclaimer });
}

/** Everything the client needs before the first message. */
export async function assistantInfo(auth?: AuthContext): Promise<AssistantInfo> {
  const customerId = auth?.user.kind === 'customer' ? auth.user.id : undefined;
  const [enabled, name, welcome, disclaimer, catalogOnly, accountAccess, requestSubmission, profileAutofill] = await Promise.all([
    getBool('assistant.enabled'),
    getString('assistant.name'),
    getString('assistant.welcome'),
    getString('assistant.disclaimer'),
    getBool('assistant.catalog_only'),
    customerId ? getBool('assistant.account_access') : Promise.resolve(false),
    customerId ? getBool('assistant.request_submission') : Promise.resolve(false),
    customerId ? getBool('assistant.profile_autofill') : Promise.resolve(false),
  ]);
  let draft: AssistantDraft | null = null;
  if (customerId) {
    const state = await loadDraftState(customerId).catch(() => null);
    if (state) {
      const service = await draftService(state).catch(() => null);
      if (service) draft = publicDraft(state, service);
    }
  }
  return {
    enabled,
    name,
    welcome,
    disclaimer,
    catalogOnly,
    capabilities: {
      accountAccess,
      requestSubmission,
      profileAutofill,
      tools: true,
    },
    authenticated: Boolean(customerId),
    draft,
  };
}

