/**
 * Structured tools the assistant can call.
 *
 * The same tools back both engines: the built-in engine calls them directly,
 * and the language model calls them through OpenAI-style function calling.
 * That symmetry is deliberate — whatever a model can discover, the fallback
 * can discover too, and the catalogue answers never depend on a provider.
 *
 * Tool outputs are compact and factual. Personal data is only produced for a
 * signed-in customer, from queries scoped to that customer's server-side id.
 */
import type { ServiceDTO } from '../catalog/service.js';
import { listCategories } from '../catalog/service.js';
import { toServiceCard, rankServices, compactService } from './catalog.js';
import type { AssistantCatalog, CatalogSearchResult } from './catalog.js';
import {
  caseCard, findOwnCase, invoiceCard, loadCustomerSnapshot, profileCard, ticketCard, walletCard,
  type CustomerSnapshot,
} from './customer.js';
import {
  attachDraftDocument, clearDraft, confirmDraft, hasDraft, loadDraftState, refresh, saveDraftState,
  setDraftField, startDraft, type DraftState,
} from './drafts.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import type { AssistantCard, AssistantServiceCard } from './types.js';

export interface AssistantContext {
  customerId?: string;
  customerName?: string;
  catalog: AssistantCatalog;
  snapshot: CustomerSnapshot | null;
  draftState: DraftState | null;
  draftService: ServiceDTO | null;
  accountAccess: boolean;
  requestSubmission: boolean;
  toolsUsed: string[];
  /** Cards accumulated by tools, appended to the final reply. */
  cards: AssistantCard[];
}

export interface ToolResult {
  ok: boolean;
  data: unknown;
  error?: string;
}

function compactCase(card: any) {
  return {
    id: card.id,
    trackingCode: card.trackingCode,
    serviceTitle: card.serviceTitle,
    status: card.status,
    statusLabel: card.statusLabel,
    currentStepTitle: card.currentStepTitle,
    currentStepKindLabel: card.currentStepKindLabel,
    nextStepTitle: card.nextStepTitle,
    assigneeName: card.assigneeName,
    paymentStatusLabel: card.paymentStatusLabel,
    total: card.total,
    estimatedCompletionAt: card.estimatedCompletionAt,
    pendingDocuments: card.pendingDocuments,
    rejectedDocuments: card.rejectedDocuments,
    rejectedReason: card.rejectedReason,
    notes: card.notes,
    invoices: card.invoices.map((invoice: any) => ({
      number: invoice.number, title: invoice.title, remaining: invoice.remaining,
      status: invoice.status, statusLabel: invoice.statusLabel, external: invoice.external,
    })),
    nextAction: card.nextAction?.label ?? null,
  };
}

async function requireSnapshot(ctx: AssistantContext): Promise<CustomerSnapshot | null> {
  if (!ctx.customerId || !ctx.accountAccess) return null;
  if (!ctx.snapshot) ctx.snapshot = await loadCustomerSnapshot(ctx.customerId);
  return ctx.snapshot;
}

async function requireDraft(ctx: AssistantContext): Promise<{ state: DraftState; service: ServiceDTO } | null> {
  if (!ctx.customerId || !ctx.requestSubmission) return null;
  if (!ctx.draftState) ctx.draftState = await loadDraftState(ctx.customerId);
  if (!ctx.draftState) return null;
  if (!ctx.draftService) ctx.draftService = await (await import('./drafts.js')).draftService(ctx.draftState);
  if (!ctx.draftService) return null;
  return { state: ctx.draftState, service: ctx.draftService };
}

/* ------------------------------ catalogue tools --------------------------- */

export function searchCatalogue(ctx: AssistantContext, query: string, limit = 5): CatalogSearchResult[] {
  return rankServices(query, ctx.catalog.services, Math.min(10, Math.max(1, limit)));
}

export function listCatalogue(
  ctx: AssistantContext,
  options: { categorySlug?: string; acceptingOnly?: boolean; limit?: number; sort?: 'newest' | 'fee_asc' | 'fee_desc' } = {},
): AssistantServiceCard[] {
  let services = ctx.catalog.services;
  if (options.categorySlug) services = services.filter((service) => service.categorySlug === options.categorySlug);
  if (options.acceptingOnly) services = services.filter((service) => service.acceptingRequests);
  if (options.sort === 'fee_asc') services = [...services].sort((a, b) => a.finalFee - b.finalFee);
  else if (options.sort === 'fee_desc') services = [...services].sort((a, b) => b.finalFee - a.finalFee);
  else if (options.sort === 'newest') {
    // `publishedCatalogue` is ordered by sort_order; the DTO carries createdAt,
    // but cards do not. Sort by id order is meaningless, so use the catalogue
    // detail map's createdAt.
    services = [...services].sort((a, b) => {
      const left = ctx.catalog.details.get(a.slug)?.createdAt ?? '';
      const right = ctx.catalog.details.get(b.slug)?.createdAt ?? '';
      return right.localeCompare(left);
    });
  }
  return services.slice(0, Math.min(50, Math.max(1, options.limit ?? 10)));
}

export function compareCatalogue(ctx: AssistantContext, slugs: string[]): AssistantServiceCard[] {
  const unique = [...new Set(slugs)].slice(0, 4);
  return unique
    .map((slug) => ctx.catalog.services.find((service) => service.slug === slug))
    .filter((service): service is AssistantServiceCard => Boolean(service));
}

export function serviceDetail(ctx: AssistantContext, slug: string) {
  const dto = ctx.catalog.details.get(slug);
  if (!dto) return null;
  return {
    ...compactService(toServiceCard(dto)),
    description: dto.description,
    contactNotice: dto.contactNotice,
    documents: dto.documents.map((document) => ({
      title: document.title, required: document.required, note: document.note ?? null, documentType: document.documentType ?? null,
    })),
    form: dto.form.map((field) => ({
      key: field.key, label: field.label, type: field.type, required: Boolean(field.required),
      ...(field.options ? { options: field.options } : {}), ...(field.help ? { help: field.help } : {}),
    })),
    workflow: dto.workflow.map((step) => ({ title: step.title, kind: step.kind })),
    externalCostsNote: dto.hasExternalCosts ? dto.externalCostsNote : null,
    externalCostItems: dto.externalCostItems,
    paymentMethods: dto.paymentMethods,
    urgentDays: dto.urgentDays,
  };
}

export async function categoriesTool() {
  return (await listCategories()).filter((category) => category.isActive).map((category) => ({
    slug: category.slug, title: category.title, serviceCount: category.serviceCount,
  }));
}

/* ------------------------------ account tools ----------------------------- */

export async function myRequestsTool(ctx: AssistantContext, statusGroup: 'open' | 'closed' | 'all' = 'all') {
  const snapshot = await requireSnapshot(ctx);
  if (!snapshot) return { error: 'authentication_required' };
  const items = snapshot.requests
    .filter((item) => statusGroup === 'all'
      ? true
      : statusGroup === 'open'
        ? !['completed', 'cancelled', 'rejected'].includes(item.status)
        : ['completed', 'cancelled', 'rejected'].includes(item.status))
    .slice(0, 10);
  return { total: snapshot.requests.length, items: items.map((item) => ({
    id: item.id, trackingCode: item.trackingCode, serviceTitle: item.serviceTitle,
    status: item.status, statusLabel: item.statusLabel, currentStepTitle: item.currentStepTitle,
    updatedAt: item.updatedAt, total: item.total, paymentStatus: item.paymentStatus,
  })) };
}

export async function requestStatusTool(ctx: AssistantContext, needle?: string) {
  const snapshot = await requireSnapshot(ctx);
  if (!snapshot) return { error: 'authentication_required' };
  const found = await findOwnCase(ctx.customerId!, snapshot, needle);
  if (!found.card) return { error: 'not_found' };
  ctx.cards.push({ type: 'case', case: found.card });
  return { match: found.match, case: compactCase(found.card) };
}

export async function myInvoicesTool(ctx: AssistantContext, status?: string) {
  const snapshot = await requireSnapshot(ctx);
  if (!snapshot) return { error: 'authentication_required' };
  const invoices = snapshot.invoices
    .filter((invoice) => !status || invoice.status === status)
    .slice(0, 10)
    .map((invoice) => invoiceCard(invoice, snapshot.serviceTitles.get(invoice.serviceId) ?? null));
  for (const invoice of invoices.slice(0, 3)) ctx.cards.push({ type: 'invoice', invoice });
  const open = invoices.filter((invoice) => invoice.remaining > 0 && !['void', 'draft'].includes(invoice.status));
  return {
    total: snapshot.invoices.length,
    payable: open.reduce((sum, invoice) => sum + invoice.remaining, 0),
    externalPayable: open.filter((invoice) => invoice.external).reduce((sum, invoice) => sum + invoice.remaining, 0),
    items: invoices.map((invoice) => ({
      id: invoice.id, number: invoice.number, title: invoice.title, total: invoice.total,
      paidAmount: invoice.paidAmount, remaining: invoice.remaining, status: invoice.status,
      statusLabel: invoice.statusLabel, external: invoice.external, requestId: invoice.requestId,
    })),
  };
}

export async function walletTool(ctx: AssistantContext) {
  const snapshot = await requireSnapshot(ctx);
  if (!snapshot) return { error: 'authentication_required' };
  if (!snapshot.wallet) return { error: 'wallet_unavailable' };
  const card = walletCard(snapshot.wallet);
  ctx.cards.push({ type: 'wallet', wallet: card });
  return { balance: card.balance, currency: card.currency, status: card.statusLabel, enabled: card.enabled, pendingTopups: card.pendingTopups };
}

export async function profileTool(ctx: AssistantContext) {
  const snapshot = await requireSnapshot(ctx);
  if (!snapshot) return { error: 'authentication_required' };
  if (!snapshot.profile) return { error: 'profile_unavailable' };
  const card = profileCard(snapshot.profile, snapshot.documents);
  ctx.cards.push({ type: 'profile', profile: card });
  const rejected = snapshot.documents.filter((document) => document.status === 'rejected')
    .map((document) => ({ title: document.title, note: document.reviewNote ?? null, type: document.docTypeLabel }));
  return {
    complete: card.complete,
    missing: card.missing,
    fullName: card.fullName,
    mobile: card.mobile,
    city: card.city,
    documentCount: card.documentCount,
    rejectedDocuments: rejected,
    documentTypes: [...new Set(snapshot.documents.map((document) => document.docTypeLabel))],
  };
}

export async function myDocumentsTool(ctx: AssistantContext) {
  const snapshot = await requireSnapshot(ctx);
  if (!snapshot) return { error: 'authentication_required' };
  return {
    total: snapshot.documents.length,
    items: snapshot.documents.slice(0, 20).map((document) => ({
      title: document.title, type: document.docTypeLabel, status: document.status,
      reviewNote: document.reviewNote ?? null, validity: document.validity,
    })),
  };
}

export async function myTicketsTool(ctx: AssistantContext) {
  const snapshot = await requireSnapshot(ctx);
  if (!snapshot) return { error: 'authentication_required' };
  const tickets = snapshot.tickets.slice(0, 10).map(ticketCard);
  for (const ticket of tickets.slice(0, 3)) ctx.cards.push({ type: 'ticket', ticket });
  return { total: snapshot.tickets.length, items: tickets.map((ticket) => ({
    id: ticket.id, number: ticket.number, subject: ticket.subject, statusLabel: ticket.statusLabel,
    departmentLabel: ticket.departmentLabel, unreadForCustomer: ticket.unreadForCustomer,
  })) };
}

/* ------------------------------- draft tools ------------------------------ */

export async function startDraftTool(ctx: AssistantContext, serviceSlug: string, useProfile = true) {
  if (!ctx.customerId) return { error: 'authentication_required' };
  if (!ctx.requestSubmission) return { error: 'request_submission_disabled' };
  const result = await startDraft(ctx.customerId, serviceSlug, { useProfile });
  ctx.draftState = result.state;
  ctx.draftService = result.service;
  return {
    ok: true,
    draftId: result.state.draft.id,
    serviceTitle: result.service.title,
    stage: result.state.draft.stage,
    missingFields: result.state.draft.missingFields,
    missingDocuments: result.state.draft.missingDocuments,
    useProfile: result.state.draft.useProfile,
  };
}

export async function setDraftFieldTool(ctx: AssistantContext, key: string, value: unknown) {
  const draft = await requireDraft(ctx);
  if (!draft) return { error: 'no_active_draft' };
  ctx.draftState = await setDraftField(ctx.customerId!, draft.state, draft.service, key, value);
  ctx.draftService = draft.service;
  return {
    ok: true,
    missingFields: ctx.draftState.draft.missingFields,
    missingDocuments: ctx.draftState.draft.missingDocuments,
    stage: ctx.draftState.draft.stage,
  };
}

export async function attachDraftDocumentTool(
  ctx: AssistantContext,
  requirementKey: string,
  payload: { fileId?: string; customerDocumentId?: string },
) {
  const draft = await requireDraft(ctx);
  if (!draft) return { error: 'no_active_draft' };
  ctx.draftState = await attachDraftDocument(ctx.customerId!, draft.state, draft.service, {
    requirementKey, ...payload,
  });
  ctx.draftService = draft.service;
  return {
    ok: true,
    missingFields: ctx.draftState.draft.missingFields,
    missingDocuments: ctx.draftState.draft.missingDocuments,
    stage: ctx.draftState.draft.stage,
  };
}

export async function previewDraftTool(ctx: AssistantContext) {
  const draft = await requireDraft(ctx);
  if (!draft) return { error: 'no_active_draft' };
  ctx.draftState = await refresh(ctx.customerId!, draft.state, draft.service);
  await saveDraftState(ctx.customerId!, ctx.draftState);
  return {
    ok: true,
    stage: ctx.draftState.draft.stage,
    missingFields: ctx.draftState.draft.missingFields,
    missingDocuments: ctx.draftState.draft.missingDocuments,
    pricing: ctx.draftState.draft.pricing,
    submissionError: ctx.draftState.draft.submissionError,
  };
}

export async function cancelDraftTool(ctx: AssistantContext) {
  if (!ctx.customerId) return { error: 'authentication_required' };
  if (!ctx.draftState) ctx.draftState = await loadDraftState(ctx.customerId);
  if (!hasDraft(ctx.draftState)) return { ok: true, cancelled: false };
  await clearDraft(ctx.customerId);
  ctx.draftState = null;
  ctx.draftService = null;
  return { ok: true, cancelled: true };
}

/** Only the request handler may call this — never exposed as a model tool. */
export async function confirmDraftTool(ctx: AssistantContext, actor: { id: string; name: string; ip?: string }) {
  const draft = await requireDraft(ctx);
  if (!draft) return { error: 'no_active_draft' };
  const result = await confirmDraft(ctx.customerId!, draft.state, draft.service, actor);
  ctx.draftState = result.state;
  return {
    ok: true,
    requestId: result.request.id,
    trackingCode: result.request.trackingCode,
    serviceTitle: result.request.serviceTitle,
    total: result.request.total,
    paymentStatus: result.request.paymentStatus,
    documents: result.request.documents?.length ?? 0,
    invoices: result.request.invoices?.map((invoice: any) => ({
      number: invoice.number, remaining: invoice.total - invoice.paidAmount, status: invoice.status,
    })) ?? [],
  };
}

/* ---------------------------- model-facing schema ------------------------- */

export function toolDefinitions(accountAccess: boolean, requestSubmission: boolean) {
  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'search_services',
        description: 'Search the entire live service catalogue with natural language. Returns ranked service cards. Use this for any question about services, fees, documents, timing or requirements.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The customer question or the service phrase to look for, in Persian.' },
            limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum results, default 5.' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_services',
        description: 'List services by category or newest/cheapest, optionally only those accepting requests. Use for "what services do you have?" style questions.',
        parameters: {
          type: 'object',
          properties: {
            categorySlug: { type: 'string' },
            acceptingOnly: { type: 'boolean' },
            limit: { type: 'integer', minimum: 1, maximum: 30 },
            sort: { type: 'string', enum: ['newest', 'fee_asc', 'fee_desc'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_categories',
        description: 'List service categories with the number of services in each.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_service',
        description: 'Full details of one service by slug: description, conditions notice, documents, form fields, workflow, fees, urgent option.',
        parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'compare_services',
        description: 'Side-by-side comparison of up to four services by slug. Use when the customer asks which one is better, faster or cheaper.',
        parameters: {
          type: 'object',
          properties: { slugs: { type: 'array', items: { type: 'string' }, maxItems: 4 } },
          required: ['slugs'],
        },
      },
    },
  ];
  if (accountAccess) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'get_my_requests',
          description: "The signed-in customer's own requests. Use for 'where is my case', 'what is the next step', progress and history.",
          parameters: {
            type: 'object',
            properties: { statusGroup: { type: 'string', enum: ['open', 'closed', 'all'] } },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_request_status',
          description: "One of the customer's own cases, found by tracking code or request id; when omitted, the most relevant open case.",
          parameters: { type: 'object', properties: { trackingCode: { type: 'string' } } },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_my_invoices',
          description: "The customer's own invoices and the amount payable, including separate organisation fees.",
          parameters: { type: 'object', properties: { status: { type: 'string' } } },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_wallet',
          description: "The customer's own wallet balance and status.",
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_my_profile',
          description: "The customer's profile completeness, missing fields and document archive summary, including rejected documents.",
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_my_documents',
          description: "The customer's archived profile documents with review status and rejection notes.",
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_my_tickets',
          description: "The customer's support tickets and their status.",
          parameters: { type: 'object', properties: {} },
        },
      },
    );
  }
  if (requestSubmission) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'start_request_draft',
          description: 'Start a guided request draft for a service. The customer must still review a full preview and explicitly confirm; this never creates a request.',
          parameters: {
            type: 'object',
            properties: {
              serviceSlug: { type: 'string' },
              useProfile: { type: 'boolean', description: 'Whether the customer allowed proposing values from their own profile.' },
            },
            required: ['serviceSlug'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'set_request_field',
          description: 'Fill one form field of the active request draft.',
          parameters: {
            type: 'object',
            properties: { key: { type: 'string' }, value: {} },
            required: ['key', 'value'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'attach_request_document',
          description: 'Attach an already-uploaded file or an approved profile document to a required document of the draft.',
          parameters: {
            type: 'object',
            properties: {
              requirementKey: { type: 'string' },
              fileId: { type: 'string' },
              customerDocumentId: { type: 'string' },
            },
            required: ['requirementKey'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'preview_request_draft',
          description: 'Re-validate the draft and return its current preview, missing fields and missing documents. Does not submit anything.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cancel_request_draft',
          description: 'Discard the active draft.',
          parameters: { type: 'object', properties: {} },
        },
      },
    );
  }
  return tools;
}

export async function executeTool(ctx: AssistantContext, name: string, args: Record<string, any> = {}): Promise<ToolResult> {
  ctx.toolsUsed.push(name);
  try {
    switch (name) {
      case 'search_services': {
        const found = searchCatalogue(ctx, String(args.query ?? ''), Number(args.limit ?? 5));
        for (const item of found.slice(0, 5)) ctx.cards.push({ type: 'service', service: item.service });
        return { ok: true, data: { total: found.length, items: found.map((item) => ({ ...compactService(item.service), score: item.score })) } };
      }
      case 'list_services': {
        const services = listCatalogue(ctx, args);
        for (const service of services.slice(0, 8)) ctx.cards.push({ type: 'service', service });
        return { ok: true, data: { total: services.length, items: services.map(compactService) } };
      }
      case 'list_categories':
        return { ok: true, data: await categoriesTool() };
      case 'get_service': {
        const detail = serviceDetail(ctx, String(args.slug ?? ''));
        if (!detail) return { ok: false, error: 'not_found', data: null };
        const card = ctx.catalog.services.find((service) => service.slug === args.slug);
        if (card) ctx.cards.push({ type: 'service', service: card });
        return { ok: true, data: detail };
      }
      case 'compare_services': {
        const services = compareCatalogue(ctx, Array.isArray(args.slugs) ? args.slugs.map(String) : []);
        for (const service of services) ctx.cards.push({ type: 'service', service });
        return { ok: true, data: { items: services.map(compactService) } };
      }
      case 'get_my_requests':
        return { ok: true, data: await myRequestsTool(ctx, args.statusGroup) };
      case 'get_request_status':
        return { ok: true, data: await requestStatusTool(ctx, args.trackingCode ? String(args.trackingCode) : undefined) };
      case 'get_my_invoices':
        return { ok: true, data: await myInvoicesTool(ctx, args.status ? String(args.status) : undefined) };
      case 'get_wallet':
        return { ok: true, data: await walletTool(ctx) };
      case 'get_my_profile':
        return { ok: true, data: await profileTool(ctx) };
      case 'get_my_documents':
        return { ok: true, data: await myDocumentsTool(ctx) };
      case 'get_my_tickets':
        return { ok: true, data: await myTicketsTool(ctx) };
      case 'start_request_draft':
        return { ok: true, data: await startDraftTool(ctx, String(args.serviceSlug ?? ''), args.useProfile !== false) };
      case 'set_request_field':
        return { ok: true, data: await setDraftFieldTool(ctx, String(args.key ?? ''), args.value) };
      case 'attach_request_document':
        return { ok: true, data: await attachDraftDocumentTool(ctx, String(args.requirementKey ?? ''), {
          fileId: args.fileId ? String(args.fileId) : undefined,
          customerDocumentId: args.customerDocumentId ? String(args.customerDocumentId) : undefined,
        }) };
      case 'preview_request_draft':
        return { ok: true, data: await previewDraftTool(ctx) };
      case 'cancel_request_draft':
        return { ok: true, data: await cancelDraftTool(ctx) };
      default:
        return { ok: false, error: 'unknown_tool', data: null };
    }
  } catch (error: any) {
    return { ok: false, error: error?.code ?? 'tool_error', data: { message: error?.message ?? 'خطا در اجرای ابزار.' } };
  }
}

/** A short, non-personal summary of what the assistant may do this turn. */
export async function capabilityFlags(customerId?: string) {
  const [accountAccess, requestSubmission] = await Promise.all([
    customerId ? getBool('assistant.account_access') : Promise.resolve(false),
    customerId ? getBool('assistant.request_submission') : Promise.resolve(false),
  ]);
  return { accountAccess, requestSubmission };
}

export async function maxSuggestions(): Promise<number> {
  return Math.min(8, Math.max(1, await getNumber('assistant.max_suggestions')));
}

export async function assistantName(): Promise<string> {
  return getString('assistant.name');
}
