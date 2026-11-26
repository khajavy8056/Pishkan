/**
 * The customer's own account, read strictly through their `customerId`.
 *
 * Every query in this file takes the id from the *server-side session* and
 * filters on it. Nothing here ever accepts a customer id from the request
 * body, so a crafted message ("show me customer X") cannot widen the scope.
 * Reads that already enforce ownership (`getRequest` with `isCustomer`) are
 * reused instead of re-implemented, so the assistant inherits the same
 * isolation as the customer portal.
 */
import { one, q } from '../../db/index.js';
import { getRequest, listRequests, STATUS_LABELS, STEP_KIND_LABELS, type RequestStatus, type StepKind } from '../requests/service.js';
import { listInvoices } from '../accounting/service.js';
import { walletSummary } from '../wallet/service.js';
import { profileState } from '../profiles/service.js';
import { listCustomerDocuments } from '../documents/service.js';
import { listTickets, DEPARTMENT_LABELS } from '../support/service.js';
import type {
  AssistantCaseCard, AssistantInvoiceCard, AssistantProfileCard, AssistantTicketCard, AssistantWalletCard,
  AssistantAction, AssistantActionKind,
} from './types.js';

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'پرداخت‌شده',
  partial: 'پرداخت جزئی',
  unpaid: 'پرداخت‌نشده',
  not_required: 'بدون پرداخت',
  pending: 'در انتظار پرداخت',
  refunded: 'برگشت‌شده',
  cancelled: 'لغوشده',
};

const INVOICE_LABELS: Record<string, string> = {
  draft: 'پیش‌نویس',
  issued: 'صادرشده',
  partially_paid: 'پرداخت جزئی',
  paid: 'پرداخت‌شده',
  void: 'باطل‌شده',
};

const WALLET_LABELS: Record<string, string> = {
  active: 'فعال',
  blocked: 'مسدود',
  closed: 'بسته‌شده',
};

export interface CustomerSnapshot {
  customerId: string;
  requests: any[];
  invoices: any[];
  wallet: any | null;
  profile: any | null;
  documents: any[];
  tickets: any[];
  serviceTitles: Map<string, string>;
}

export function action(kind: AssistantActionKind, id: string, label: string, route?: string, message?: string): AssistantAction {
  return { id, label, kind, ...(route ? { route } : {}), ...(message ? { message } : {}) };
}

/** Read every personal source once; callers pick what the intent needs. */
export async function loadCustomerSnapshot(customerId: string): Promise<CustomerSnapshot> {
  const [requestList, invoiceList, wallet, profile, documents, ticketList] = await Promise.all([
    listRequests({ customerId, pageSize: 30 }).catch(() => ({ items: [] as any[] })),
    listInvoices({ customerId, pageSize: 30 }).catch(() => ({ items: [] as any[] })),
    walletSummary(customerId).catch(() => null),
    profileState(customerId).catch(() => null),
    listCustomerDocuments(customerId).catch(() => [] as any[]),
    listTickets({ actor: { id: customerId, name: '', kind: 'customer', permissions: [] }, pageSize: 20 })
      .catch(() => ({ items: [] as any[] })),
  ]);
  const serviceIds = [...new Set([
    ...requestList.items.map((item) => item.serviceId).filter(Boolean),
    ...invoiceList.items.map((item) => item.serviceId).filter(Boolean),
  ])] as string[];
  const serviceTitles = new Map<string, string>();
  if (serviceIds.length) {
    const rows = await q<{ id: string; title: string }>(
      `SELECT id, title FROM services WHERE id IN (${serviceIds.map(() => '?').join(',')})`, serviceIds,
    );
    for (const row of rows) serviceTitles.set(row.id, row.title);
  }
  return {
    customerId,
    requests: requestList.items,
    invoices: invoiceList.items,
    wallet,
    profile,
    documents,
    tickets: ticketList.items,
    serviceTitles,
  };
}

function paymentLabel(status: string | null | undefined): string {
  return PAYMENT_LABELS[String(status ?? '')] ?? String(status ?? '—');
}

export function invoiceCard(invoice: any, serviceTitle: string | null): AssistantInvoiceCard {
  const remaining = Math.max(0, Number(invoice.total ?? 0) - Number(invoice.paidAmount ?? 0));
  return {
    id: invoice.id,
    number: invoice.number,
    title: invoice.title,
    total: Number(invoice.total ?? 0),
    paidAmount: Number(invoice.paidAmount ?? 0),
    remaining,
    status: invoice.status,
    statusLabel: INVOICE_LABELS[String(invoice.status)] ?? String(invoice.status),
    issuedAt: invoice.issuedAt ?? invoice.createdAt ?? null,
    dueAt: invoice.dueAt ?? null,
    requestId: invoice.requestId ?? null,
    serviceTitle,
    purpose: invoice.purpose ?? 'service',
    external: invoice.purpose === 'external_cost',
    action: remaining > 0 && !['void', 'draft'].includes(invoice.status)
      ? action('link', `pay-${invoice.id}`, 'پرداخت فاکتور', '/app/invoices')
      : action('link', `invoice-${invoice.id}`, 'مشاهده فاکتور', '/app/invoices'),
  };
}

export function walletCard(wallet: any): AssistantWalletCard {
  return {
    balance: Number(wallet?.balance ?? 0),
    status: wallet?.status ?? 'unknown',
    statusLabel: WALLET_LABELS[String(wallet?.status)] ?? String(wallet?.status ?? 'نامشخص'),
    enabled: Boolean(wallet?.enabled),
    currency: wallet?.currency ?? 'IRR',
    pendingTopups: Number(wallet?.counts?.pendingTopups ?? 0),
    action: action('link', 'open-wallet', 'کیف پول من', '/app/wallet'),
  };
}

export function profileCard(profile: any, documents: any[]): AssistantProfileCard {
  const row = profile?.profile ?? {};
  return {
    complete: Boolean(profile?.complete),
    missing: Array.isArray(profile?.missing) ? profile.missing : [],
    fullName: String(row.full_name ?? '').trim(),
    mobile: String(row.mobile ?? ''),
    city: row.city ?? null,
    documentCount: documents.length,
    rejectedDocumentCount: documents.filter((document) => document.status === 'rejected').length,
    action: action('link', 'open-profile', 'تکمیل پروفایل', '/app/profile'),
  };
}

export function ticketCard(ticket: any): AssistantTicketCard {
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    statusLabel: ticket.status === 'open' ? 'باز' : ticket.status === 'answered' ? 'پاسخ داده شده'
      : ticket.status === 'waiting_customer' ? 'منتظر شما' : ticket.status === 'resolved' ? 'حل‌شده' : 'بسته‌شده',
    departmentLabel: ticket.departmentLabel ?? DEPARTMENT_LABELS[ticket.department] ?? ticket.department,
    updatedAt: ticket.updatedAt ?? ticket.createdAt,
    unreadForCustomer: Number(ticket.unreadForCustomer ?? 0),
    action: action('link', `ticket-${ticket.id}`, 'مشاهده تیکت', '/app/support'),
  };
}

export function caseCard(request: any): AssistantCaseCard {
  const pendingDocuments = request.documents
    ?.filter((document: any) => ['pending', 'rejected', 'needs_correction'].includes(document.status))
    .map((document: any) => document.title) ?? [];
  const rejectedDocuments = request.documents
    ?.filter((document: any) => document.status === 'rejected')
    .map((document: any) => ({ title: document.title, note: document.reviewNote ?? null })) ?? [];
  const invoices: AssistantInvoiceCard[] = (request.invoices ?? []).map((invoice: any) => invoiceCard(invoice, request.serviceTitle));
  const waitingOnCustomer = request.currentStepKind === 'waiting_customer'
    || ['waiting_documents', 'waiting_customer'].includes(request.status);
  const nextAction: AssistantAction = waitingOnCustomer
    ? action('link', `upload-${request.id}`, 'بارگذاری مدرک / پاسخ به دفتر', `/app/requests/${request.id}`)
    : invoices.some((invoice) => invoice.remaining > 0 && !['void', 'draft'].includes(invoice.status))
      ? { ...action('link', `pay-${request.id}`, 'پرداخت فاکتور', '/app/invoices') }
      : action('link', `open-${request.id}`, 'مشاهده پرونده', `/app/requests/${request.id}`);
  return {
    id: request.id,
    trackingCode: request.trackingCode,
    serviceTitle: request.serviceTitle,
    serviceSlug: request.serviceSlug ?? null,
    status: request.status,
    statusLabel: STATUS_LABELS[request.status as RequestStatus] ?? request.statusLabel ?? request.status,
    priority: request.priority,
    currentStep: Number(request.currentStep ?? 0),
    currentStepTitle: request.currentStepTitle ?? null,
    currentStepKind: request.currentStepKind ?? null,
    currentStepKindLabel: request.currentStepKind ? STEP_KIND_LABELS[request.currentStepKind as StepKind] ?? null : null,
    stepCount: Array.isArray(request.workflow) ? request.workflow.length : 0,
    nextStepTitle: request.nextStepTitle ?? null,
    workBucketLabel: request.workBucketLabel ?? null,
    assigneeName: request.assigneeName ?? null,
    total: Number(request.total ?? 0),
    paidAmount: Number(request.paidAmount ?? 0),
    paymentStatus: request.paymentStatus,
    paymentStatusLabel: paymentLabel(request.paymentStatus),
    estimatedCompletionAt: request.estimatedCompletionAt ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    rejectedReason: request.rejectedReason ?? null,
    documents: (request.documents ?? []).map((document: any) => ({
      title: document.title, status: document.status, reviewNote: document.reviewNote ?? null, requirementKey: document.requirementKey ?? null,
    })),
    pendingDocuments,
    rejectedDocuments,
    notes: (request.events ?? [])
      .filter((event: any) => ['note', 'status', 'document', 'assigned'].includes(event.type) && event.message)
      .slice(-4)
      .map((event: any) => ({ message: event.message, createdAt: event.createdAt })),
    nextAction,
    invoices,
  };
}

/** Find one of *this customer's* cases by tracking code or id; never anyone else's. */
export async function findOwnCase(
  customerId: string,
  snapshot: CustomerSnapshot,
  needle?: string,
): Promise<{ card: AssistantCaseCard | null; request: any | null; match: 'tracking' | 'id' | 'only' | 'none' }> {
  const normalized = String(needle ?? '').trim();
  if (normalized) {
    const byTracking = snapshot.requests.find(
      (item) => String(item.trackingCode).toLowerCase() === normalized.toLowerCase(),
    );
    if (byTracking) {
      const request = await getRequest(byTracking.id, { actorId: customerId, isCustomer: true });
      return request ? { card: caseCard(request), request, match: 'tracking' } : { card: null, request: null, match: 'none' };
    }
    const byId = snapshot.requests.find((item) => item.id === normalized);
    if (byId) {
      const request = await getRequest(byId.id, { actorId: customerId, isCustomer: true });
      return request ? { card: caseCard(request), request, match: 'id' } : { card: null, request: null, match: 'none' };
    }
    // An id that exists but belongs to somebody else must read as "not found",
    // never as a hint that the case exists.
    if (/^[A-Za-z0-9_-]{6,}$/.test(normalized)) {
      const exists = await one<any>('SELECT id FROM requests WHERE id = ?', [normalized]);
      if (exists) return { card: null, request: null, match: 'none' };
    }
    return { card: null, request: null, match: 'none' };
  }
  const open = snapshot.requests.find((item) => !['completed', 'cancelled', 'rejected'].includes(item.status));
  const target = open ?? snapshot.requests[0];
  if (!target) return { card: null, request: null, match: 'none' };
  const request = await getRequest(target.id, { actorId: customerId, isCustomer: true });
  if (!request) return { card: null, request: null, match: 'none' };
  return { card: caseCard(request), request, match: 'only' };
}

/** Approved profile documents grouped by archive type, for draft suggestions. */
export function approvedDocumentsByType(documents: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const document of documents) {
    if (document.status !== 'approved') continue;
    const type = String(document.docType ?? '');
    if (!type) continue;
    const list = map.get(type) ?? [];
    list.push(document);
    map.set(type, list);
  }
  return map;
}
