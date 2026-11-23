import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { AssistantPage } from '../src/pages/public/Assistant';
import { fetchMock, setAuthUser } from './setup';

/* -------------------------------------------------------------------------- */
/*                              fetch stubbing                                */
/* -------------------------------------------------------------------------- */

type Handler = (init: RequestInit | undefined) => unknown;

function response(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
    blob: async () => new Blob(),
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function ok(data: unknown) {
  return { ok: true, data };
}

/** Route by substring; the first matching handler wins. */
function stub(handlers: Record<string, Handler>) {
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as Request).url);
    for (const [key, handler] of Object.entries(handlers)) {
      if (url.includes(key)) return response(handler(init));
    }
    return original!(input as RequestInfo);
  });
  return () => fetchMock.mockImplementation(original!);
}

const calls: { url: string; init?: RequestInit }[] = [];
function record() {
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as Request).url);
    calls.push({ url, init });
    return original!(input as RequestInfo);
  });
}
const postsTo = (path: string) => calls.filter((call) => call.url.includes(path) && call.init?.method === 'POST');
const bodies = (path: string) => postsTo(path).map((call) => JSON.parse(String(call.init?.body ?? '{}')));

/* -------------------------------------------------------------------------- */
/*                                 fixtures                                   */
/* -------------------------------------------------------------------------- */

const service = {
  id: 'svc_1', slug: 'insurance-history', title: 'سابقه بیمه تأمین اجتماعی', summary: 'دریافت سابقه بیمه',
  categoryTitle: 'بیمه و تأمین اجتماعی', categorySlug: 'insurance', baseFee: 120000, finalFee: 120000,
  estimatedMinutes: 240, estimatedDays: 1, urgentEnabled: true, urgentPercent: 50, urgentMinutes: 120, urgentDays: 1,
  acceptingRequests: true, needsReview: true, hasExternalCosts: false, requiresManagerApproval: false,
  requiredFields: ['کد ملی', 'موبایل'], documents: [{ key: 'document_1', title: 'کارت ملی', required: true, documentType: 'national_card' }],
  paymentMethods: ['online', 'wallet'], tags: ['بیمه'], contactNotice: null,
};

const collectingDraft = {
  id: 'draft_1', serviceId: 'svc_1', serviceSlug: 'insurance-history', serviceTitle: service.title,
  categoryTitle: service.categoryTitle, stage: 'collecting',
  fields: [
    { key: 'national_id', label: 'کد ملی', type: 'national_id', required: true, value: '', fromProfile: false, error: 'کد ملی الزامی است.' },
    { key: 'mobile', label: 'موبایل', type: 'tel', required: true, value: '09120000000', fromProfile: true },
  ],
  missingFields: ['کد ملی'], missingDocuments: ['کارت ملی'],
  documents: [{ key: 'document_1', title: 'کارت ملی', required: true, attachment: null, suggestedProfileDocumentId: 'cdoc_1', suggestedProfileDocumentName: 'کارت ملی تأییدشده' }],
  estimatedMinutes: 240, estimatedDays: 1, urgentEnabled: true, urgentMinutes: 120,
  pricing: { baseFee: 120000, discount: 0, urgentFee: 0, total: 120000, currency: 'rial' },
  paymentMethod: 'online', priority: 'normal', useProfile: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z',
  requestId: null, trackingCode: null, submissionError: null, actions: [],
};

const readyDraft = {
  ...collectingDraft,
  stage: 'awaiting_confirmation',
  fields: collectingDraft.fields.map((field) => ({ ...field, value: field.key === 'national_id' ? '0012345679' : field.value, error: undefined })),
  missingFields: [],
  missingDocuments: [],
  documents: [{ ...collectingDraft.documents[0], attachment: { kind: 'profile', id: 'cdoc_1', name: 'کارت ملی تأییدشده' } }],
};

const submittedDraft = {
  ...readyDraft,
  stage: 'submitted',
  requestId: 'req_1',
  trackingCode: 'PK-1001',
};

function info(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    name: 'دستیار آزمون',
    welcome: 'سلام! چطور کمک کنم؟',
    disclaimer: 'پاسخ‌ها راهنمای اولیه است.',
    catalogOnly: false,
    capabilities: { accountAccess: true, requestSubmission: true, profileAutofill: true, tools: true },
    authenticated: false,
    draft: null,
    ...overrides,
  };
}

function reply(overrides: Record<string, unknown> = {}) {
  return {
    reply: 'پاسخ آزمون',
    suggestions: [], followUpQuestions: [], actions: [], cards: [], draft: null,
    intent: 'find_service', sources: [], provider: 'builtin', handoffSuggested: false,
    disclaimer: '', authenticated: false, usedPersonalContext: false, toolsUsed: [],
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

function renderAssistant() {
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={['/assistant']}>
            <Routes>
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/login" element={<p>صفحه ورود آزمون</p>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

async function send(text: string) {
  const input = await screen.findByLabelText('پیام');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'ارسال' }));
}

afterEach(() => {
  setAuthUser(null);
  calls.length = 0;
});

/* -------------------------------------------------------------------------- */
/*                                   tests                                    */
/* -------------------------------------------------------------------------- */

describe('assistant page — structured reply contract', () => {
  it('loads capabilities and the welcome message from /info', async () => {
    stub({
      '/api/assistant/info': () => ok(info({ name: 'دستیار کاتالوگ', welcome: 'سلام آزمون' })),
    });
    renderAssistant();
    expect(await screen.findByText('دستیار کاتالوگ')).toBeTruthy();
    expect(await screen.findByText('سلام آزمون')).toBeTruthy();
    expect(screen.getByText('حالت مهمان')).toBeTruthy();
  });

  it('renders a service suggestion with fee, duration and a request entry point', async () => {
    stub({
      '/api/assistant/info': () => ok(info()),
      '/api/assistant/chat': () => ok(reply({ reply: 'این خدمت مناسب است.', suggestions: [service] })),
    });
    renderAssistant();
    await screen.findByLabelText('پیام');
    await send('سابقه بیمه');
    expect(await screen.findByText('سابقه بیمه تأمین اجتماعی')).toBeTruthy();
    expect(screen.getByText('زمان تخمینی: ۴ ساعت')).toBeTruthy();
    expect(screen.getByText('در حال پذیرش')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'شروع درخواست' })).toBeTruthy();
  });

  it('renders a case card with the rejection reason of the customer own document', async () => {
    stub({
      '/api/assistant/info': () => ok(info({ authenticated: true })),
      '/api/assistant/chat': () => ok(reply({
        reply: 'پرونده شما در مرحله بررسی است.',
        intent: 'status',
        usedPersonalContext: true,
        authenticated: true,
        cards: [{
          type: 'case',
          case: {
            id: 'req_1', trackingCode: 'PK-1001', serviceTitle: 'سابقه بیمه', serviceSlug: 'insurance-history',
            status: 'needs_correction', statusLabel: 'نیازمند اصلاح', priority: 'normal',
            currentStep: 2, currentStepTitle: 'بررسی مدارک', currentStepKind: 'review', currentStepKindLabel: 'بررسی',
            stepCount: 4, nextStepTitle: 'بارگذاری دوبارهٔ کارت ملی', workBucketLabel: 'در حال بررسی', assigneeName: 'کارشناس نمونه',
            total: 120000, paidAmount: 120000, paymentStatus: 'paid', paymentStatusLabel: 'پرداخت‌شده',
            estimatedCompletionAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
            rejectedReason: null,
            documents: [{ title: 'کارت ملی', status: 'rejected', reviewNote: 'تصویر ناخوانا است', requirementKey: 'document_1' }],
            pendingDocuments: [], rejectedDocuments: [{ title: 'کارت ملی', note: 'تصویر ناخوانا است' }],
            notes: [{ message: 'لطفاً کارت ملی را واضح‌تر بارگذاری کنید.', createdAt: '2026-01-02T00:00:00.000Z' }],
            nextAction: { id: 'upload', kind: 'upload', label: 'بارگذاری دوبارهٔ مدرک', route: '/app/requests/req_1' },
            invoices: [],
          },
        }],
      })),
    });
    renderAssistant();
    await screen.findByLabelText('پیام');
    await send('چرا مدرکم رد شد؟');
    expect(await screen.findByText('مدارک نیازمند اصلاح')).toBeTruthy();
    expect(screen.getAllByText(/تصویر ناخوانا است/).length).toBeGreaterThan(0);
    expect(screen.getByText('بارگذاری دوبارهٔ کارت ملی')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'بارگذاری دوبارهٔ مدرک' })).toBeTruthy();
  });

  it('renders invoice, wallet and profile cards with their own actions', async () => {
    stub({
      '/api/assistant/info': () => ok(info()),
      '/api/assistant/chat': () => ok(reply({
        reply: 'وضعیت مالی شما:',
        intent: 'payment',
        cards: [
          {
            type: 'invoice',
            invoice: {
              id: 'inv_1', number: 'INV-1', title: 'حق‌الزحمهٔ سابقه بیمه', total: 150000, paidAmount: 50000,
              remaining: 100000, status: 'partial', statusLabel: 'پرداخت جزئی', issuedAt: null, dueAt: null,
              requestId: 'req_1', serviceTitle: 'سابقه بیمه', purpose: 'service', external: false,
              action: { id: 'pay', kind: 'link', label: 'پرداخت فاکتور', route: '/app/invoices' },
            },
          },
          {
            type: 'wallet',
            wallet: {
              balance: 75000, status: 'active', statusLabel: 'فعال', enabled: true, currency: 'rial', pendingTopups: 0,
              action: { id: 'wallet', kind: 'link', label: 'شارژ کیف پول', route: '/app/wallet' },
            },
          },
          {
            type: 'profile',
            profile: {
              complete: false, missing: ['شهر', 'تاریخ تولد'], fullName: 'مشتری نمونه', mobile: '09120000000', city: null,
              documentCount: 2, rejectedDocumentCount: 1,
              action: { id: 'profile', kind: 'link', label: 'تکمیل پروفایل', route: '/app/profile' },
            },
          },
        ],
      })),
    });
    renderAssistant();
    await screen.findByLabelText('پیام');
    await send('چقدر باید پرداخت کنم؟');
    expect(await screen.findByText('حق‌الزحمهٔ سابقه بیمه')).toBeTruthy();
    expect(screen.getByText('پرداخت جزئی')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'پرداخت فاکتور' })).toBeTruthy();
    expect(screen.getByText('شارژ کیف پول')).toBeTruthy();
    expect(screen.getByText('تکمیل پروفایل')).toBeTruthy();
    expect(screen.getByText(/موارد ناقص/)).toBeTruthy();
  });

  it('renders quick follow-up questions as sendable chips', async () => {
    stub({
      '/api/assistant/info': () => ok(info()),
      '/api/assistant/chat': () => ok(reply({ reply: 'کدام خدمت؟', followUpQuestions: ['چه خدماتی دارید؟'] })),
    });
    renderAssistant();
    await screen.findByLabelText('پیام');
    await send('سلام');
    const chip = await screen.findByRole('button', { name: 'چه خدماتی دارید؟' });
    expect(chip).toBeTruthy();
  });

  it('offers the login door instead of a draft for a guest', async () => {
    setAuthUser(null);
    stub({
      '/api/assistant/info': () => ok(info({ authenticated: false })),
      '/api/assistant/chat': () => ok(reply({ suggestions: [service] })),
      '/api/assistant/draft': () => ok({ draft: collectingDraft }),
    });
    record();
    renderAssistant();
    await screen.findByLabelText('پیام');
    await send('سابقه بیمه');
    fireEvent.click(await screen.findByRole('button', { name: 'شروع درخواست' }));
    expect(await screen.findByText('صفحه ورود آزمون')).toBeTruthy();
    expect(postsTo('/api/assistant/draft')).toHaveLength(0);
  });

  it('starts a draft for a signed-in customer without creating a request', async () => {
    setAuthUser({ id: 'usr_1', kind: 'customer', roleCode: 'customer', fullName: 'مشتری', permissions: [] });
    stub({
      '/api/assistant/info': () => ok(info({ authenticated: true })),
      '/api/assistant/chat': () => ok(reply({ suggestions: [service] })),
      '/api/assistant/draft': () => ok({ draft: collectingDraft }),
    });
    record();
    renderAssistant();
    await screen.findByLabelText('پیام');
    await send('سابقه بیمه');
    fireEvent.click(await screen.findByRole('button', { name: 'شروع درخواست' }));
    expect(await screen.findByText('پیش‌نویس درخواست')).toBeTruthy();
    expect(screen.getByLabelText(/کد ملی/)).toBeTruthy();
    expect(screen.getByText(/فیلدهای ناقص: کد ملی/)).toBeTruthy();
    expect(postsTo('/api/assistant/draft/confirm')).toHaveLength(0);
    expect(postsTo('/api/assistant/draft')).toHaveLength(1);
    expect(bodies('/api/assistant/draft')[0]).toMatchObject({ serviceSlug: 'insurance-history', useProfile: true });
  });

  it('requires a preview before the explicit confirmation can appear', async () => {
    setAuthUser({ id: 'usr_1', kind: 'customer', roleCode: 'customer', fullName: 'مشتری', permissions: [] });
    stub({
      '/api/assistant/info': () => ok(info({ authenticated: true, draft: collectingDraft })),
      '/api/assistant/draft/preview': () => ok({ draft: readyDraft }),
      '/api/assistant/draft/confirm': () => ok(reply({ reply: 'ثبت شد', intent: 'request_submitted', draft: submittedDraft })),
    });
    record();
    renderAssistant();
    expect(await screen.findByText('پیش‌نویس درخواست')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /تأیید و ثبت نهایی/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /پیش‌نمایش و تأیید نهایی/ }));
    expect(await screen.findByRole('button', { name: /تأیید و ثبت نهایی/ })).toBeTruthy();
    expect(postsTo('/api/assistant/draft/confirm')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /تأیید و ثبت نهایی/ }));
    expect((await screen.findAllByText(/درخواست شما ثبت شد/)).length).toBeGreaterThan(0);
    expect(postsTo('/api/assistant/draft/confirm')).toHaveLength(1);
    expect(bodies('/api/assistant/draft/confirm')[0]).toEqual({ confirm: true });
    expect(await screen.findByText('PK-1001')).toBeTruthy();
  });

  it('cancels the draft without ever confirming it', async () => {
    setAuthUser({ id: 'usr_1', kind: 'customer', roleCode: 'customer', fullName: 'مشتری', permissions: [] });
    stub({
      '/api/assistant/info': () => ok(info({ authenticated: true, draft: collectingDraft })),
      '/api/assistant/draft/cancel': () => ok(reply({ reply: 'پیش‌نویس لغو شد.', intent: 'unknown', draft: null })),
    });
    record();
    renderAssistant();
    await screen.findByText('پیش‌نویس درخواست');
    fireEvent.click(screen.getByRole('button', { name: 'انصراف' }));
    await waitFor(() => expect(screen.queryByText('پیش‌نویس درخواست')).toBeNull());
    expect(postsTo('/api/assistant/draft/cancel')).toHaveLength(1);
    expect(postsTo('/api/assistant/draft/confirm')).toHaveLength(0);
  });

  it('saves an edited field through the draft PATCH endpoint', async () => {
    setAuthUser({ id: 'usr_1', kind: 'customer', roleCode: 'customer', fullName: 'مشتری', permissions: [] });
    stub({
      '/api/assistant/info': () => ok(info({ authenticated: true, draft: collectingDraft })),
      '/api/assistant/draft': () => ok({ draft: readyDraft }),
    });
    record();
    renderAssistant();
    const nationalId = await screen.findByLabelText('کد ملی *');
    fireEvent.change(nationalId, { target: { value: '0012345679' } });
    fireEvent.blur(nationalId);
    await waitFor(() => {
      const patch = calls.find((call) => call.url.includes('/api/assistant/draft') && call.init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch!.init?.body))).toEqual({ key: 'national_id', value: '0012345679' });
    });
  });

  it('renders the disclaimer and the handoff hint when the assistant cannot answer', async () => {
    stub({
      '/api/assistant/info': () => ok(info({ disclaimer: 'جایگزین نظر کارشناس نیست.' })),
      '/api/assistant/chat': () => ok(reply({ reply: 'نمی‌دانم.', intent: 'handoff', handoffSuggested: true })),
    });
    renderAssistant();
    await screen.findByLabelText('پیام');
    expect(screen.getByText('جایگزین نظر کارشناس نیست.')).toBeTruthy();
    await send('قانون مالیات ارث؟');
    expect(await screen.findByText(/تیکت پشتیبانی/)).toBeTruthy();
  });
});
