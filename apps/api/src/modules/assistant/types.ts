/**
 * The assistant's wire contract.
 *
 * Both clients (the React website and the Flutter app) render this same shape,
 * so every capability the server can produce must be expressible here: service
 * suggestions, live case/invoice/wallet cards, quick actions, and the guided
 * request draft with its confirm/cancel/edit affordances.
 *
 * Everything is additive: older clients keep reading `reply`, `suggestions`,
 * `followUpQuestions` and ignore the rest.
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
  /** Labels only — enough for the UI to say "3 fields, 2 documents". */
  requiredFields: string[];
  documents: AssistantServiceDocument[];
  paymentMethods: string[];
  tags: string[];
  contactNotice: string | null;
}

export type AssistantActionKind =
  | 'link' | 'login' | 'register' | 'send' | 'confirm' | 'cancel' | 'edit' | 'upload';

export interface AssistantAction {
  id: string;
  label: string;
  kind: AssistantActionKind;
  /** In-app canonical route (`/app/requests/<id>`, `/app/wallet`, …). */
  route?: string;
  /** Message to send when the action is tapped as a chat shortcut. */
  message?: string;
  draftId?: string;
  requirementKey?: string;
  /** Server-relative URL for the web client when it differs from `route`. */
  href?: string;
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
  /** Customer-visible document statuses, including rejection reasons. */
  documents: {
    title: string;
    status: string;
    reviewNote: string | null;
    requirementKey: string | null;
  }[];
  pendingDocuments: string[];
  rejectedDocuments: { title: string; note: string | null }[];
  notes: { message: string; createdAt: string }[];
  nextAction: AssistantAction | null;
  invoices: AssistantInvoiceCard[];
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
  /** The value was proposed from the customer's own profile (with consent). */
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
  /** Suggested from the customer's approved profile documents. */
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
  /** True while the customer allowed profile values to be proposed. */
  useProfile: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  requestId: string | null;
  trackingCode: string | null;
  /** Set when `createRequest` refused the submission, so the UI can show it. */
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
  /** True when the caller is a signed-in customer whose own data was read. */
  authenticated: boolean;
  /** True when the customer's account/cases were actually consulted. */
  usedPersonalContext: boolean;
  /** Tool names executed this turn (never arguments or personal data). */
  toolsUsed: string[];
  /** Server time, so clients can show "as of now". */
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
  /** A pending draft is advertised so a reload can restore the preview. */
  draft: AssistantDraft | null;
}

/** Normalize an internal draft state into the public, client-safe shape. */
export function emptyReply(partial: Partial<AssistantReply> = {}): AssistantReply {
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
