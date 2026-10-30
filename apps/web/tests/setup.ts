import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Minimal, deterministic API stub.
 *
 * The web app only talks to the API through `fetch` and relative URLs, so the
 * smoke tests can replace it wholesale. Each fixture mirrors the real response
 * envelope (`{ ok, data, meta }`) produced by `apps/api`.
 */

/** Tests can log a user in by setting this before rendering. */
export let authUser: any = null;
export function setAuthUser(user: any) {
  authUser = user;
}

const bootstrap = {
  version: '1.0.0-test',
  settings: {
    'site.name': 'دفتر پیشخوان دولت',
    'site.short_name': 'پیشخوان',
    'site.tagline': 'خدمات دولتی، سریع و شفاف',
    'site.description': 'سامانه نمونه برای آزمون',
    'site.support_notice': 'پشتیبانی ۹ تا ۱۷',
    'office.name': 'دفتر پیشخوان مرکزی',
    'office.phone': '02100000000',
    'office.mobile': '09120000000',
    'office.address': 'تهران',
    'office.city': 'تهران',
    'office.working_hours': 'شنبه تا پنجشنبه ۸ تا ۱۷',
    'services.catalog_notice': 'هزینه‌ها نمونه است.',
  },
  categories: [
    { id: 'cat_1', slug: 'insurance', title: 'بیمه و تأمین اجتماعی', description: 'خدمات بیمه', icon: 'shield', color: '#1d4ed8', image: null, serviceCount: 7 },
    { id: 'cat_2', slug: 'companies', title: 'ثبت شرکت و برند', description: 'خدمات ثبتی', icon: 'building', color: '#0f766e', image: null, serviceCount: 11 },
  ],
  popularServices: [
    {
      id: 'svc_1', slug: 'insurance-history', title: 'سابقه بیمه تأمین اجتماعی', summary: 'دریافت سابقه بیمه',
      description: 'شرح خدمت', image: null, icon: 'shield', categoryId: 'cat_1', categoryTitle: 'بیمه و تأمین اجتماعی',
      categorySlug: 'insurance', baseFee: 120000, discountPercent: 0, finalFee: 120000, estimatedDays: 2,
      paymentMethods: ['online', 'cash'], tags: ['بیمه'], form: [], documents: [], workflow: [],
      contactNotice: null, isPublished: true, acceptingRequests: true, isCustom: false, ownerCustomerId: null,
      needsReview: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  newestServices: [],
  authMethods: { staffOtp: false, otp: true, password: true, registrationOpen: true, passwordReset: true },
  maintenance: false,
  assistant: {
    enabled: true,
    name: 'دستیار هوشمند پیشخوان',
    welcome: 'سلام! چطور کمک کنم؟',
    disclaimer: 'پاسخ‌ها بر اساس کاتالوگ خدمات است.',
  },
};

const serviceDetail = {
  ...bootstrap.popularServices[0],
  form: [
    { key: 'national_id', label: 'کد ملی', type: 'national_id', required: true },
    { key: 'note', label: 'توضیح', type: 'textarea', required: false },
  ],
  documents: [{ title: 'کارت ملی', required: true }],
  workflow: [{ title: 'ثبت درخواست' }, { title: 'بررسی کارشناس' }, { title: 'تحویل' }],
};

function jsonBody(data: unknown, meta?: unknown) {
  return { ok: true, data, ...(meta ? { meta } : {}) };
}

const routes: { match: (url: string) => boolean; body: () => unknown }[] = [
  {
    match: (u) => u.includes('/api/auth/me'),
    body: () => (authUser
      ? { ok: true, data: authUser }
      : { ok: false, error: { code: 'unauthorized', message: 'ابتدا وارد شوید.' } }),
  },
  { match: (u) => u.includes('/api/public/bootstrap'), body: () => jsonBody(bootstrap) },
  { match: (u) => u.includes('/api/public/services/'), body: () => jsonBody(serviceDetail) },
  { match: (u) => u.includes('/api/public/services'), body: () => jsonBody([bootstrap.popularServices[0]], { total: 1, page: 1, pageSize: 12 }) },
  { match: (u) => u.includes('/api/public/status'), body: () => jsonBody({ version: '1.0.0-test', services: 30, office: { name: 'دفتر', workingHours: '۸ تا ۱۷' }, checkedAt: '2026-01-01T00:00:00.000Z' }) },
  { match: (u) => u.includes('/api/public/search'), body: () => jsonBody([]) },
  { match: (u) => u.includes('/api/settings/legal'), body: () => jsonBody({ terms: '', privacy: '', officeName: 'دفتر' }) },
  { match: (u) => u.includes('/api/assistant/chat'), body: () => jsonBody({ reply: 'پاسخ آزمایشی', suggestions: [], followUpQuestions: [] }) },
  { match: (u) => u.includes('/api/customers/me/notifications'), body: () => jsonBody([], { unread: 0, total: 0 }) },
  {
    match: (u) => u.includes('/api/documents/mine'),
    body: () => jsonBody([
      {
        id: 'cdoc_1', customerId: 'usr_customer', docType: 'national_card', docTypeLabel: 'کارت ملی',
        title: 'کارت ملی', status: 'pending', issuedAt: null, expiresAt: null, validity: 'none',
        verifiedBy: null, verifiedAt: null, reviewNote: null, requestId: null, reusedFrom: null,
        createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
        file: {
          id: 'file_1', name: 'card.png', mime: 'image/webp', size: 42000, originalSize: 210000,
          savingsPercent: 80, width: 1600, height: 1000, previewUrl: '/api/files/file_1?variant=preview',
          displayUrl: '/api/files/file_1', originalUrl: '/api/files/file_1?variant=original',
          processing: { status: 'ready', mode: 'lossless', error: null },
        },
      },
    ], {
      types: [
        { code: 'national_card', label: 'کارت ملی', validityDays: 0, counts: { total: 1, approved: 0, pending: 1, rejected: 0 } },
        { code: 'birth_certificate', label: 'شناسنامه', validityDays: 0, counts: { total: 0, approved: 0, pending: 0, rejected: 0 } },
      ],
    }),
  },
  { match: (u) => u.includes('/api/requests'), body: () => jsonBody([], { total: 0, page: 1, pageSize: 20 }) },
  { match: (u) => u.includes('/api/dashboard/summary'), body: () => jsonBody(dashboardSummary) },
  {
    match: (u) => u.includes('/api/staff/me/workload'),
    body: () => jsonBody({
      activeRequests: [{
        id: 'req_1', trackingCode: 'PK-1001', status: 'new', priority: 'high', dueAt: null,
        serviceTitle: 'سابقه بیمه', customerName: 'مشتری نمونه',
      }],
      pendingDocuments: [{ id: 'doc_1', title: 'کارت ملی', requestId: 'req_1', trackingCode: 'PK-1001', createdAt: '2026-01-01T00:00:00.000Z' }],
      shift: { id: 'sh_1', startTime: '08:00', endTime: '16:00' },
      attendance: null,
      completedLast30Days: 4,
      activeCount: 1,
    }),
  },
  { match: (u) => u.includes('/api/settings/admin'), body: () => jsonBody(settingsView) },
  {
    match: (u) => u.includes('/api/settings/sms/credentials'),
    body: () => jsonBody({ provider: 'melipayamak', authMode: 'credentials', username: '', senderLine: '', hasPassword: false, hasApiKey: false, enabled: false, otpTemplate: '', dailyLimit: 500 }),
  },
  { match: (u) => u.includes('/api/settings/sms/logs'), body: () => jsonBody([], { total: 0 }) },
  { match: (u) => u.includes('/api/catalog/admin/services'), body: () => jsonBody(adminServices, { total: adminServices.length, page: 1, pageSize: 100 }) },
  {
    match: (u) => u.includes('/api/catalog/admin/categories'),
    body: () => jsonBody([{ id: 'cat_1', slug: 'insurance', title: 'بیمه و تأمین اجتماعی', description: 'خدمات بیمه', isActive: true, sortOrder: 1, serviceCount: 7 }]),
  },
];

const dashboardSummary = {
  kind: 'staff',
  stats: { counts: { new: 2 }, open: 5, total: 9, completed: 4, overdue: 1, outstandingAmount: 250000 },
  finance: { revenue: 1000000, receivable: 250000, operatingProfit: 600000, margin: 60, paymentsCount: 4, invoiced: 1250000 },
  cards: { unassigned: 2, pendingDocuments: 3, unreadMessages: 1, checkedInToday: 4 },
  charts: {
    daily: [{ day: '2026-01-01', count: 3 }],
    byStatus: [{ status: 'new', label: 'جدید', count: 2 }],
  },
  recentRequests: [{
    id: 'req_1', trackingCode: 'PK-1001', status: 'new', statusLabel: 'جدید', priority: 'normal',
    serviceTitle: 'سابقه بیمه', customerName: 'مشتری نمونه', assigneeName: null, dueAt: null,
    createdAt: '2026-01-01T10:00:00.000Z',
  }],
  urgent: [],
  staffLoad: [{ id: 'usr_staff', fullName: 'کارشناس نمونه', active: 3 }],
  invoices: [],
  notifications: [],
  unreadNotifications: 0,
};

const adminServices = [
  {
    id: 'svc_1', slug: 'insurance-history', title: 'سابقه بیمه تأمین اجتماعی', summary: 'دریافت سابقه بیمه',
    description: '', categoryId: 'cat_1', categoryTitle: 'بیمه و تأمین اجتماعی', baseFee: 120000,
    discountPercent: 0, finalFee: 120000, estimatedDays: 2, paymentMethods: ['online', 'cash'],
    tags: [], form: [{ key: 'national_id', label: 'کد ملی', type: 'national_id', required: true }],
    documents: [{ title: 'کارت ملی', required: true }], workflow: [{ title: 'ثبت درخواست' }],
    isPublished: true, acceptingRequests: true, isCustom: false, needsReview: true, sortOrder: 1,
  },
];

const settingsView = {
  groups: [
    { code: 'general', title: 'تنظیمات عمومی سایت', description: 'نام و اطلاعات تماس', icon: 'store', order: 1 },
    { code: 'sms', title: 'پیامک و ملی پیامک', description: 'اتصال پیامک', icon: 'message', order: 4 },
  ],
  settings: [
    { key: 'site.name', group: 'general', type: 'text', label: 'نام سامانه', hint: 'در عنوان صفحه نمایش داده می‌شود.', value: 'دفتر پیشخوان', hasValue: true, isSecret: false },
    { key: 'sms.password', group: 'sms', type: 'password', label: 'رمز پنل پیامک', value: '', hasValue: true, isSecret: true, masked: '12***45' },
  ],
  lastUpdated: '2026-01-01T00:00:00.000Z',
  meta: { nodeEnv: 'test', version: '1.0.0-test', dbDriver: 'sqlite', encryptionConfigured: true },
};

export const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url);
  const route = routes.find((r) => r.match(url));
  const body = route ? route.body() : { ok: false, error: { code: 'not_found', message: 'یافت نشد' } };
  const status = route && (body as any).ok !== false ? 200 : 401;
  return {
    ok: status === 200,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    blob: async () => new Blob(),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
});

vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('scrollTo', () => undefined);

if (!window.matchMedia) {
  // Tailwind/UI components never rely on it, but jsdom lacks the API.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  fetchMock.mockClear();
});
