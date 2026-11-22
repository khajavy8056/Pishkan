import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { fetchMock, setAuthUser } from './setup';

import { AdminPayroll } from '../src/pages/admin/PayrollAdmin';
import { StaffEarnings } from '../src/pages/staff/Earnings';
import { EligibleQueue } from '../src/pages/staff/Queue';
import { StaffWorkbench } from '../src/pages/staff/Workbench';

/**
 * Employee-facing payroll screens.
 *
 * The fixtures below copy the shapes the API really returns (see
 * `apps/api/src/modules/payroll/earnings.ts`). The point of these tests is that
 * a fixed-salary employee never sees a percentage income or a withdraw button,
 * a percentage employee sees their own share, and a losing claim surfaces the
 * "somebody else took it" message instead of a generic failure.
 */

const adminUser = {
  id: 'usr_admin', kind: 'admin', fullName: 'مدیر سامانه', mobile: '09120000000', email: null,
  username: 'admin', nationalId: null, mobileVerified: true, status: 'active', mfaEnabled: false,
  mustChangePassword: false, roleCode: 'super_admin', roleName: 'مدیر کل', permissions: '*',
};

const commissionUser = {
  ...adminUser, id: 'usr_commission', kind: 'staff', fullName: 'کارشناس درصدی', roleCode: 'service_expert',
  roleName: 'کارشناس خدمات', permissions: ['requests.view', 'requests.edit'], cooperationType: 'commission',
};

const fixedUser = {
  ...adminUser, id: 'usr_fixed', kind: 'staff', fullName: 'کارمند حقوق ثابت', roleCode: 'operator',
  roleName: 'کارشناس', permissions: ['requests.view', 'requests.edit'], cooperationType: 'monthly',
};

const performance = {
  total: 9, accepted: 9, completed: 6, completedToday: 1, completedWeek: 3, completedMonth: 6,
  cancelled: 1, inProgress: 2, awaitingOrganization: 1, awaitingCustomer: 1, needsAction: 1,
  unclaimed: 0, averageCompletionMinutes: 95, avgMinutesSample: 4,
};

const withdrawal = {
  id: 'wd_1', userId: 'usr_commission', staffName: 'کارشناس درصدی', amount: 2500000,
  status: 'submitted', statusLabel: 'ثبت‌شده', periodStart: '2026-10-20', periodEnd: '2026-10-26',
  requestedAt: '2026-10-27T09:00:00.000Z', note: 'شماره شبا ۱۲۳', decisionNote: null,
  reviewedAt: null, approvedAt: null, rejectedAt: null, paidAt: null, paymentMethod: null,
  trackingCode: null, accountingNote: null, createdAt: '2026-10-27T09:00:00.000Z',
};

const commissionSummary = {
  cooperationType: 'commission' as const,
  cooperationLabel: 'درصدی',
  performance,
  profile: { employeeCode: 'EMP-10', position: 'کارشناس خدمات', hiredAt: '2026-01-01' },
  contract: { commissionPercent: 10, monthlyTarget: 5000000, startsOn: '2026-01-01', endsOn: null },
  goal: { target: 5000000, achieved: 2400000, percent: 48 },
  rank: { position: 1, total: 3 },
  income: {
    today: 300000, week: 900000, month: 2400000, definite: 7500000, pendingEstimate: 450000,
    withdrawable: 5000000, requested: 2500000, withdrawn: 0, paidOut: 0,
  },
  balance: {
    available: 5000000, eligible: 5000000, future: 400000, reserved: 2500000, withdrawn: 0,
    minWithdrawal: 500000, period: 'weekly' as const, periodDays: 7,
    currentWindow: { start: '2026-10-27', end: '2026-11-02' },
    enabled: true, canRequest: true, requested: 2500000,
  },
  withdrawals: [withdrawal],
  openWithdrawal: 1,
  salary: null,
};

const fixedSummary = {
  cooperationType: 'monthly' as const,
  cooperationLabel: 'حقوق ثابت',
  performance,
  profile: { employeeCode: 'EMP-11', position: 'کارشناس', hiredAt: '2026-01-01' },
  contract: null,
  goal: null,
  rank: null,
  income: null,
  balance: null,
  withdrawals: [],
  openWithdrawal: 0,
  salary: {
    contract: { monthlyAmount: 30000000, startsOn: '2026-01-01', endsOn: null },
    months: [
      { period: '2026-09', accrued: 30000000, paid: 30000000, remaining: 0, status: 'paid', statusLabel: 'پرداخت‌شده' },
      { period: '2026-10', accrued: 30000000, paid: 10000000, remaining: 20000000, status: 'overdue', statusLabel: 'معوق' },
    ],
    outstanding: 20000000,
    payments: [{
      id: 'sp_1', periodMonth: '2026-09', amount: 30000000, method: 'bank_transfer',
      trackingCode: 'TRX-9001', paidAt: '2026-10-02T08:00:00.000Z', note: null, status: 'paid',
    }],
    history: [{ id: 'c_1', kind: 'monthly', monthlyAmount: 30000000, commissionPercent: 0, startsOn: '2026-01-01', endsOn: null }],
  },
};

const queueItem = {
  id: 'req_open_1', trackingCode: 'PK-2001', serviceTitle: 'سابقه بیمه تأمین اجتماعی', priority: 'high',
  status: 'new', createdAt: '2026-10-31T08:00:00.000Z',
  estimatedCompletionAt: '2026-10-31T14:00:00.000Z', forceAssignAt: '2026-10-31T12:00:00.000Z',
  remainingMinutes: 45, cooperationType: 'commission' as const,
  earnings: { percent: 10, officeRevenue: 1200000, amount: 120000, estimate: true },
};

const earningsEntries = [{
  id: 'ce_1', kind: 'commission', kindLabel: 'سهم خدمات', amount: 120000, basisAmount: 1200000,
  percent: 10, requestId: 'req_done_1', trackingCode: 'PK-1001', serviceTitle: 'سابقه بیمه تأمین اجتماعی',
  customerName: 'مشتری نمونه', performedAt: '2026-10-28T10:00:00.000Z',
  recordedAt: '2026-10-28T10:05:00.000Z', paymentStatus: 'confirmed', withdrawableAt: '2026-10-30T00:00:00.000Z',
  periodStart: '2026-10-27', periodEnd: '2026-11-02', withdrawalId: null, withdrawalStatus: null,
  status: 'withdrawable', note: null,
}];

const overview = {
  commissionStaff: [{ id: 'usr_commission', fullName: 'کارشناس درصدی', percent: 10 }],
  monthlyStaff: [{ id: 'usr_fixed', fullName: 'کارمند حقوق ثابت', monthlyAmount: 30000000 }],
  pendingWithdrawals: { count: 1, total: 2500000 },
  paidWithdrawals: 4000000,
  salary: [{ userId: 'usr_fixed', fullName: 'کارمند حقوق ثابت', accrued: 60000000, paid: 10000000, outstanding: 50000000 }],
  commission: { earned: 7500000, reversed: 0 },
};

const staffRows = [
  { id: 'usr_commission', fullName: 'کارشناس درصدی', roleCode: 'service_expert', cooperationType: 'commission' },
  { id: 'usr_fixed', fullName: 'کارمند حقوق ثابت', roleCode: 'operator', cooperationType: 'monthly' },
];

const reports = {
  from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z',
  staff: [{ userId: 'usr_commission', fullName: 'کارشناس درصدی', cooperationType: 'commission', income: 7500000, basis: 75000000, services: 12 }],
  withdrawals: [{ status: 'submitted', statusLabel: 'ثبت‌شده', count: 1, total: 2500000 }],
  office: { officeRevenue: 120000000, gross: 132000000, collected: 90000000, staffShare: 7500000 },
};

const staffFile = {
  staff: {
    id: 'usr_commission', fullName: 'کارشناس درصدی', mobile: '09120000001', username: 'expert',
    status: 'active', roleCode: 'service_expert', roleName: 'کارشناس خدمات', employeeCode: 'EMP-1',
    position: 'کارشناس', hiredAt: '2026-01-01', specialties: [], maxActiveCases: 20, acceptsNewCases: true,
    shift: { startTime: '08:00', endTime: '16:00' }, attendance: null,
  },
  cooperationType: 'commission', cooperationLabel: 'درصدی',
  contract: { id: 'c_2', kind: 'commission', monthlyAmount: 0, commissionPercent: 10, startsOn: '2026-01-01', endsOn: null, settlementPeriod: 'weekly', settlementDays: 0, minWithdrawal: 500000 },
  contractHistory: [{ id: 'c_2', kind: 'commission', monthlyAmount: 0, commissionPercent: 10, startsOn: '2026-01-01', endsOn: null }],
  performance,
  recentRequests: [{ id: 'req_done_1', trackingCode: 'PK-1001', serviceTitle: 'سابقه بیمه تأمین اجتماعی', status: 'completed' }],
  income: { today: 300000, week: 900000, month: 2400000, definite: 7500000, pendingEstimate: 0, withdrawable: 5000000, requested: 2500000, withdrawn: 0, paidOut: 0, pendingItems: [] },
  entries: earningsEntries,
  balance: commissionSummary.balance,
  withdrawals: [withdrawal],
  salary: null,
};

type Call = { method: string; url: string; body: any };

function json(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => (status < 400 ? { ok: true, data } : { ok: false, error: data }),
    blob: async () => new Blob(),
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

/** Route table for the payroll screens; every call is recorded for assertions. */
function installApi(options: { summary?: unknown; claimFailure?: string; queue?: unknown[] } = {}) {
  const calls: Call[] = [];
  fetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body ?? null;
    calls.push({ method, url, body });
    const path = url.replace(/^https?:\/\/[^/]+/, '');

    if (path.startsWith('/api/requests/queue/eligible')) return json(options.queue ?? [queueItem]);
    if (path.match(/^\/api\/requests\/[^/]+\/decline$/)) return json({ declined: true });
    if (path.startsWith('/api/dashboard/summary')) return json({
      kind: 'staff', stats: { open: 2, total: 9 },
      recentRequests: [{
        id: 'req_1', trackingCode: 'PK-1001', status: 'new', statusLabel: 'جدید', serviceTitle: 'سابقه بیمه',
        customerName: 'مشتری نمونه', categoryIcon: 'shield', categoryColor: '#1d4ed8', createdAt: '2026-10-30T09:00:00.000Z',
      }],
      notifications: [], unreadNotifications: 0,
    });
    if (path.startsWith('/api/staff/me/workload')) return json({
      acceptsNewCases: true, activeRequests: [], pendingDocuments: [],
      shift: { id: 'sh_1', startTime: '08:00', endTime: '16:00' },
      attendance: { checkIn: '2026-10-31T04:30:00.000Z', checkOut: null },
      completedLast30Days: 4, activeCount: 2,
    });
    if (path.match(/^\/api\/requests\/[^/]+\/claim$/)) {
      if (options.claimFailure) return json({ code: 'conflict', message: options.claimFailure }, 409);
      return json({ id: queueItem.id, assignedTo: 'usr_commission' });
    }
    if (path.startsWith('/api/payroll/me/summary')) return json(options.summary ?? commissionSummary);
    if (path.startsWith('/api/payroll/me/earnings')) return json({ entries: earningsEntries, summary: commissionSummary.income, balance: commissionSummary.balance, salary: null });
    if (path.match(/^\/api\/payroll\/me\/withdrawals\/[^/]+\/cancel$/)) return json({ ...withdrawal, status: 'cancelled', statusLabel: 'لغوشده' });
    if (path.startsWith('/api/payroll/me/withdrawals')) return json({ ...withdrawal, id: 'wd_new' }, 201);
    if (path.startsWith('/api/payroll/overview')) return json(overview);
    if (path.match(/^\/api\/payroll\/staff\/[^/]+\/file$/)) return json(staffFile);
    if (path.startsWith('/api/payroll/staff')) return json(staffRows);
    if (path.startsWith('/api/payroll/reports')) return json(reports);
    if (path.startsWith('/api/payroll/withdrawals')) {
      if (path.match(/\/decision$/)) return json({ ...withdrawal, status: 'approved', statusLabel: 'تأییدشده' });
      if (path.match(/\/pay$/)) return json({ ...withdrawal, status: 'paid', statusLabel: 'پرداخت‌شده', trackingCode: 'TRX-1' });
      return json({ items: [withdrawal], total: 1, page: 1, pageSize: 25 });
    }
    if (path.startsWith('/api/payroll/salary-payments')) return json({ months: fixedSummary.salary.months, payments: fixedSummary.salary.payments, outstanding: fixedSummary.salary.outstanding, history: [], contract: fixedSummary.salary.contract });
    if (path.startsWith('/api/payroll/contracts')) return json({ id: 'c_new' }, 201);
    if (path.startsWith('/api/customers/me/notifications')) return json([], 200);
    if (path.startsWith('/api/auth/me')) return json(null, 401);
    return json({ code: 'not_found', message: 'یافت نشد' }, 404);
  });
  return calls;
}

function renderAt(element: React.ReactElement, user: any = commissionUser) {
  setAuthUser(user);
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={['/staff/finance']}>{element}</MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  setAuthUser(commissionUser);
});

afterEach(() => {
  setAuthUser(null);
  fetchMock.mockReset();
});

describe('free request queue', () => {
  it('shows the exact share of a percentage employee for each open request', async () => {
    installApi();
    renderAt(<EligibleQueue />, commissionUser);

    await waitFor(() => expect(screen.getByText('سابقه بیمه تأمین اجتماعی')).toBeTruthy());
    expect(screen.getByText(/سهم درآمد شما از این خدمت/)).toBeTruthy();
    expect(screen.getByText(/درصد از تعرفهٔ خدمت: ۱۰٪/)).toBeTruthy();
    expect(screen.getAllByText(/۱۲۰٬۰۰۰/).length).toBeGreaterThan(0);
    expect(screen.getByText(/برآوردی؛ پس از پرداخت مشتری قطعی می‌شود/)).toBeTruthy();
    expect(screen.getByText('دریافت درخواست‌ها')).toBeTruthy();
  });

  it('never shows an income line to a fixed-salary employee', async () => {
    const calls = installApi({
      summary: fixedSummary,
      queue: [{ ...queueItem, cooperationType: 'monthly', earnings: null }],
    });
    renderAt(<EligibleQueue />, fixedUser);

    await waitFor(() => expect(screen.getByText('سابقه بیمه تأمین اجتماعی')).toBeTruthy());
    expect(screen.queryByText(/سهم شما/)).toBeNull();
    expect(screen.getByText('نوع همکاری')).toBeTruthy();
    expect(screen.getAllByText('حقوق ثابت').length).toBeGreaterThan(0);
    expect(calls.some((call) => call.url.includes('/api/requests/queue/eligible'))).toBe(true);
  });

  it('claims a request and refreshes the queue', async () => {
    const calls = installApi();
    renderAt(<EligibleQueue />, commissionUser);

    await waitFor(() => expect(screen.getByText('تأیید و قبول انجام')).toBeTruthy());
    fireEvent.click(screen.getByText('تأیید و قبول انجام'));

    await waitFor(() => expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/claim')).length).toBe(1));
    await waitFor(() => expect(calls.filter((call) => call.url.includes('/queue/eligible')).length).toBeGreaterThan(1));
  });

  it('explains that someone else accepted the request instead of a generic error', async () => {
    installApi({ claimFailure: 'این درخواست هم‌اکنون توسط کارشناس دیگری پذیرفته شد.' });
    renderAt(<EligibleQueue />, commissionUser);

    await waitFor(() => expect(screen.getByText('تأیید و قبول انجام')).toBeTruthy());
    fireEvent.click(screen.getByText('تأیید و قبول انجام'));

    await waitFor(() => expect(screen.getByText('پرونده پذیرفته نشد')).toBeTruthy());
    expect(screen.getByText('این درخواست هم‌اکنون توسط کارشناس دیگری پذیرفته شد.')).toBeTruthy();
  });

  it('declining removes the request from my queue through the real endpoint', async () => {
    const calls = installApi();
    renderAt(<EligibleQueue />, commissionUser);

    await waitFor(() => expect(screen.getByText('سابقه بیمه تأمین اجتماعی')).toBeTruthy());
    fireEvent.click(screen.getByText('رد کردن'));

    await waitFor(() => expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/decline')).length).toBe(1));
    await waitFor(() => expect(screen.queryByText('سابقه بیمه تأمین اجتماعی')).toBeNull());
  });
});

describe('staff workbench variants', () => {
  it('percentage employees get the income dashboard with their goal ring and rank', async () => {
    installApi();
    renderAt(<StaffWorkbench />, commissionUser);

    await waitFor(() => expect(screen.getByText('داشبورد درآمد و کمیسیون')).toBeTruthy());
    expect(screen.getByText('جزئیات سهم و کمیسیون')).toBeTruthy();
    expect(screen.getByText('وضعیت کمیسیون')).toBeTruthy();
    expect(screen.getByText('رتبهٔ ۱')).toBeTruthy();
    expect(screen.queryByText('حقوق ماه جاری')).toBeNull();
  });

  it('fixed-salary employees get the salary workbench without any income panel', async () => {
    installApi({ summary: fixedSummary });
    renderAt(<StaffWorkbench />, fixedUser);

    await waitFor(() => expect(screen.getByText('حقوق ماه جاری')).toBeTruthy());
    expect(screen.getByText('وضعیت حضور و غیاب')).toBeTruthy();
    expect(screen.getByText('دسترسی‌های سریع')).toBeTruthy();
    expect(screen.getByText('اطلاعات کاربری')).toBeTruthy();
    expect(screen.queryByText('داشبورد درآمد و کمیسیون')).toBeNull();
    expect(screen.queryByText(/درخواست برداشت درآمد/)).toBeNull();
  });
});

describe('percentage employee earnings page', () => {
  it('renders real performance counters and the withdrawable balance', async () => {
    installApi();
    renderAt(<StaffEarnings />, commissionUser);

    await waitFor(() => expect(screen.getByText('درآمد و تسویه‌حساب من')).toBeTruthy());
    expect(screen.getByText('تکمیل‌شده امروز')).toBeTruthy();
    expect(screen.getByText('نوع همکاری: درصدی')).toBeTruthy();

    fireEvent.click(screen.getByText('درآمد و برداشت'));
    await waitFor(() => expect(screen.getByText('ثبت درخواست برداشت')).toBeTruthy());
    expect(screen.getAllByText('قابل برداشت').length).toBeGreaterThan(0);
    expect(screen.getByText(/دوره تسویه: هفتگی/)).toBeTruthy();
  });

  it('lists income entries with the basis, the percentage and the share', async () => {
    installApi();
    renderAt(<StaffEarnings />, commissionUser);

    fireEvent.click(await screen.findByText('درآمد و برداشت'));
    await waitFor(() => expect(screen.getByText('جزئیات درآمد')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('PK-1001 · مشتری نمونه')).toBeTruthy());
    const row = screen.getByText('PK-1001 · مشتری نمونه').closest('tr')!;
    expect(within(row).getByText('۱۰٪')).toBeTruthy();
    expect(within(row).getByText('قابل برداشت')).toBeTruthy();
  });

  it('submits a withdrawal request with the amount the employee chose', async () => {
    const calls = installApi();
    renderAt(<StaffEarnings />, commissionUser);

    fireEvent.click(await screen.findByText('درآمد و برداشت'));
    fireEvent.click(await screen.findByText('ثبت درخواست برداشت'));
    const amountInput = await screen.findByLabelText(/مبلغ \(ریال\)/);
    fireEvent.change(amountInput, { target: { value: '1200000' } });
    fireEvent.click(screen.getByText('ثبت درخواست'));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/api/payroll/me/withdrawals'))).toBe(true));
    const posted = calls.find((call) => call.method === 'POST' && call.url.endsWith('/api/payroll/me/withdrawals'))!;
    expect(posted.body).toEqual({ amount: 1200000 });
  });

  it('shows the rejection reason and lets the employee cancel a pending request', async () => {
    const calls = installApi({
      summary: {
        ...commissionSummary,
        withdrawals: [{ ...withdrawal, status: 'reviewing', statusLabel: 'در انتظار بررسی', decisionNote: 'اطلاعات حساب ناقص است' }],
      },
    });
    renderAt(<StaffEarnings />, commissionUser);

    fireEvent.click(await screen.findByText('تاریخچه تسویه'));
    await waitFor(() => expect(screen.getByText('درخواست‌های برداشت من')).toBeTruthy());
    expect(screen.getByText('علت: اطلاعات حساب ناقص است')).toBeTruthy();
    fireEvent.click(screen.getByText('لغو'));
    await waitFor(() => expect(calls.some((call) => call.url.includes('/api/payroll/me/withdrawals/wd_1/cancel'))).toBe(true));
  });
});

describe('fixed-salary employee earnings page', () => {
  it('hides percentage income and withdrawals, and shows salary records instead', async () => {
    installApi({ summary: fixedSummary });
    renderAt(<StaffEarnings />, fixedUser);

    await waitFor(() => expect(screen.getByText('عملکرد و حقوق من')).toBeTruthy());
    expect(screen.queryByText('درآمد و برداشت')).toBeNull();
    expect(screen.getByText('تکمیل‌شده این هفته')).toBeTruthy();

    fireEvent.click(screen.getByText('حقوق و پرداخت‌ها'));
    await waitFor(() => expect(screen.getByText('دوره‌های حقوق')).toBeTruthy());
    expect(screen.getByText('حقوق ماهانه قرارداد')).toBeTruthy();
    expect(screen.getByText('مانده حقوق (معوق)')).toBeTruthy();
    expect(screen.getByText('معوق')).toBeTruthy();
    expect(screen.getAllByText(/TRX-9001/).length).toBeGreaterThan(0);
    expect(screen.queryByText('ثبت درخواست برداشت')).toBeNull();
  });
});

describe('management payroll screen', () => {
  it('shows the income obligations and the withdrawal inbox', async () => {
    installApi();
    renderAt(<AdminPayroll />, adminUser);

    await waitFor(() => expect(screen.getByText('حقوق و تسویه کارکنان')).toBeTruthy());
    expect(screen.getByText('کارکنان درصدی')).toBeTruthy();
    expect(screen.getByText('کارکنان حقوق ثابت')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('کارشناس درصدی').length).toBeGreaterThan(0));
    expect(screen.getAllByText('در انتظار بررسی').length).toBeGreaterThan(0);
    expect(screen.getByText('بررسی')).toBeTruthy();
  });

  it('sends an approval decision and refreshes the inbox', async () => {
    const calls = installApi();
    renderAt(<AdminPayroll />, adminUser);

    await waitFor(() => expect(screen.getByText('تأیید')).toBeTruthy());
    fireEvent.click(screen.getByText('تأیید'));
    await waitFor(() => expect(
      calls.some((call) => call.url.includes('/api/payroll/withdrawals/wd_1/decision') && call.body?.action === 'approve'),
    ).toBe(true));
  });

  it('requires a reason before a withdrawal can be rejected', async () => {
    const calls = installApi();
    renderAt(<AdminPayroll />, adminUser);

    await waitFor(() => expect(screen.getByText('رد')).toBeTruthy());
    fireEvent.click(screen.getByText('رد'));
    const submit = await screen.findByText('ثبت رد');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('مثلاً اطلاعات حساب ناقص است'), { target: { value: 'شماره شبا نامعتبر است' } });
    fireEvent.click(submit);
    await waitFor(() => expect(
      calls.some((call) => call.url.includes('/decision') && call.body?.action === 'reject' && call.body?.note === 'شماره شبا نامعتبر است'),
    ).toBe(true));
  });

  it('opens the employee dossier with contract history and performance', async () => {
    installApi();
    renderAt(<AdminPayroll />, adminUser);

    fireEvent.click(await screen.findByText('پروندهٔ کارکنان'));
    await waitFor(() => expect(screen.getByText('کارشناس درصدی')).toBeTruthy());
    fireEvent.click(screen.getAllByText('پرونده')[0]);

    await waitFor(() => expect(screen.getByText('پروندهٔ کارشناس درصدی')).toBeTruthy());
    expect(screen.getByText('تاریخچهٔ قرارداد')).toBeTruthy();
    expect(screen.getByText('درآمد و تسویه')).toBeTruthy();
    expect(screen.getByText('EMP-1')).toBeTruthy();
  });

  it('reports office revenue next to the staff share, and fixed salary obligations', async () => {
    installApi();
    renderAt(<AdminPayroll />, adminUser);

    fireEvent.click(await screen.findByText('گزارش‌ها'));
    await waitFor(() => expect(screen.getByText('درآمد دفتر (بدون مالیات)')).toBeTruthy());
    expect(screen.getByText('سهم پرداختی کارکنان')).toBeTruthy();

    fireEvent.click(screen.getByText('حقوق کارکنان ثابت'));
    await waitFor(() => expect(screen.getByText('مانده')).toBeTruthy());
    expect(screen.getByText('ثبت پرداخت حقوق')).toBeTruthy();
  });
});
