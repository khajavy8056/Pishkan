/**
 * Assistant wire contract (client side).
 *
 * Mirrors `apps/api/src/modules/assistant/types.ts` exactly: the web app and
 * the Flutter app render the same structured reply, so a capability added on
 * the server appears on both clients without a contract change. The contract is
 * additive — an older client simply ignores `cards`, `actions` and `draft`.
 */

export type AssistantIntent =
  | 'greeting' | 'smalltalk'
  | 'find_service' | 'compare_services' | 'service_details' | 'fee' | 'documents' | 'duration'
  | 'status' | 'invoice' | 'payment' | 'wallet' | 'profile' | 'support'
  | 'start_request' | 'collect_field' | 'preview_request' | 'request_submitted'
  | 'handoff' | 'unknown';

export interface AssistantServiceDocument {
  key: string;
  title: string;
  required: boolean;
  note?: string;
  documentType?: string;
}

export interface AssistantServiceCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  categoryTitle: string | null;
  categorySlug: string | null;
  baseFee: number;
  finalFee: number;
  estimatedMinutes: number;
  estimatedDays: number;
  urgentEnabled: boolean;
  urgentPercent: number;
  urgentMinutes: number;
  urgentDays: number;
  acceptingRequests: boolean;
  needsReview: boolean;
  hasExternalCosts: boolean;
  requiresManagerApproval: boolean;
  requiredFields: string[];
  documents: AssistantServiceDocument[];
  paymentMethods: string[];
  tags: string[];
  contactNotice: string | null;
}

export type AssistantActionKind = 'link' | 'login' | 'register' | 'send' | 'confirm' | 'cancel' | 'edit' | 'upload';

export interface AssistantAction {
  id: string;
  label: string;
  kind: AssistantActionKind;
  route?: string;
  message?: string;
  draftId?: string;
  requirementKey?: string;
  href?: string;
}

export interface AssistantInvoiceCard {
  id: string;
  number: string;
  title: string;
  total: number;
  paidAmount: number;
  remaining: number;
  status: string;
  statusLabel: string;
  issuedAt: string | null;
  dueAt: string | null;
  requestId: string | null;
  serviceTitle: string | null;
  purpose: string;
  /** Organisation fees are invoiced separately and are not office revenue. */
  external: boolean;
  action: AssistantAction | null;
}

export interface AssistantCaseCard {
  id: string;
  trackingCode: string;
  serviceTitle: string;
  serviceSlug: string | null;
  status: string;
  statusLabel: string;
  priority: 'normal' | 'high' | string;
  currentStep: number;
  currentStepTitle: string | null;
  currentStepKind: string | null;
  currentStepKindLabel: string | null;
  stepCount: number;
  nextStepTitle: string | null;
  workBucketLabel: string | null;
  assigneeName: string | null;
  total: number;
  paidAmount: number;
  paymentStatus: string;
  paymentStatusLabel: string;
  estimatedCompletionAt: string | null;
  createdAt: string;
  updatedAt: string;
  rejectedReason: string | null;
  documents: { title: string; status: string; reviewNote: string | null; requirementKey: string | null }[];
  pendingDocuments: string[];
  rejectedDocuments: { title: string; note: string | null }[];
  notes: { message: string; createdAt: string }[];
  nextAction: AssistantAction | null;
  invoices: AssistantInvoiceCard[];
}

export interface AssistantWalletCard {
  balance: number;
  status: string;
  statusLabel: string;
  enabled: boolean;
  currency: string;
  pendingTopups: number;
  action: AssistantAction | null;
}

export interface AssistantProfileCard {
  complete: boolean;
  missing: string[];
  fullName: string;
  mobile: string;
  city: string | null;
  documentCount: number;
  rejectedDocumentCount: number;
  action: AssistantAction | null;
}

export interface AssistantTicketCard {
  id: string;
  number: string;
  subject: string;
  status: string;
  statusLabel: string;
  departmentLabel: string;
  updatedAt: string;
  unreadForCustomer: number;
  action: AssistantAction | null;
}

export interface AssistantCategorySummary {
  slug: string;
  title: string;
  serviceCount: number;
}

export interface AssistantCatalogCard {
  title: string;
  query: string;
  categories: AssistantCategorySummary[];
  services: AssistantServiceCard[];
  total: number;
  action: AssistantAction | null;
}

export type AssistantCard =
  | { type: 'service'; service: AssistantServiceCard }
  | { type: 'case'; case: AssistantCaseCard }
  | { type: 'invoice'; invoice: AssistantInvoiceCard }
  | { type: 'wallet'; wallet: AssistantWalletCard }
  | { type: 'profile'; profile: AssistantProfileCard }
  | { type: 'ticket'; ticket: AssistantTicketCard }
  | { type: 'catalog'; catalog: AssistantCatalogCard };

export interface AssistantDraftField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  value: string;
  fromProfile: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
  error?: string;
}

export interface AssistantDraftAttachment {
  kind: 'file' | 'profile';
  id: string;
  name: string;
}

export interface AssistantDraftDocument {
  key: string;
  title: string;
  required: boolean;
  note?: string;
  documentType?: string;
  attachment: AssistantDraftAttachment | null;
  suggestedProfileDocumentId: string | null;
  suggestedProfileDocumentName: string | null;
  error?: string;
}

export type AssistantDraftStage = 'collecting' | 'awaiting_confirmation' | 'submitted' | 'cancelled';

export interface AssistantDraftPricing {
  baseFee: number;
  discount: number;
  urgentFee: number;
  total: number;
  currency: string;
}

export interface AssistantDraft {
  id: string;
  serviceId: string;
  serviceSlug: string;
  serviceTitle: string;
  categoryTitle: string | null;
  stage: AssistantDraftStage;
  fields: AssistantDraftField[];
  missingFields: string[];
  documents: AssistantDraftDocument[];
  missingDocuments: string[];
  estimatedMinutes: number;
  estimatedDays: number;
  urgentEnabled: boolean;
  urgentMinutes: number;
  pricing: AssistantDraftPricing | null;
  paymentMethod: string;
  priority: 'normal' | 'high';
  useProfile: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  requestId: string | null;
  trackingCode: string | null;
  submissionError: string | null;
  actions: AssistantAction[];
}

export interface AssistantReply {
  reply: string;
  suggestions: AssistantServiceCard[];
  followUpQuestions: string[];
  actions: AssistantAction[];
  cards: AssistantCard[];
  draft: AssistantDraft | null;
  intent: AssistantIntent;
  sources: string[];
  provider: 'builtin' | 'llm';
  handoffSuggested: boolean;
  disclaimer: string;
  authenticated: boolean;
  usedPersonalContext: boolean;
  toolsUsed: string[];
  at: string;
}

export interface AssistantInfo {
  enabled: boolean;
  name: string;
  welcome: string;
  disclaimer: string;
  catalogOnly: boolean;
  capabilities: {
    accountAccess: boolean;
    requestSubmission: boolean;
    profileAutofill: boolean;
    tools: boolean;
  };
  authenticated: boolean;
  draft: AssistantDraft | null;
}

/** One chat entry as rendered by the web client. */
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reply?: AssistantReply;
  error?: boolean;
}

const DRAFT_STAGE_LABEL: Record<AssistantDraftStage, string> = {
  collecting: 'در حال تکمیل اطلاعات',
  awaiting_confirmation: 'آمادهٔ تأیید نهایی',
  submitted: 'ثبت‌شده',
  cancelled: 'لغوشده',
};

const DRAFT_STAGE_TONE: Record<AssistantDraftStage, 'default' | 'info' | 'success' | 'warning'> = {
  collecting: 'info',
  awaiting_confirmation: 'warning',
  submitted: 'success',
  cancelled: 'default',
};

export function draftStageLabel(stage: AssistantDraftStage): string {
  return DRAFT_STAGE_LABEL[stage] ?? stage;
}

export function draftStageTone(stage: AssistantDraftStage): 'default' | 'info' | 'success' | 'warning' {
  return DRAFT_STAGE_TONE[stage] ?? 'default';
}

/** Human label for the payment method a draft will use. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  online: 'پرداخت آنلاین',
  wallet: 'کیف پول',
  cash: 'حضوری / کارت‌خوان',
  bank_transfer: 'انتقال بانکی',
  later: 'پرداخت در دفتر',
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
