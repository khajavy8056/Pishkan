import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { setAuthUser, fetchMock } from './setup';

import { CustomerDashboard } from '../src/pages/customer/CustomerPages';
import { StaffWorkbench } from '../src/pages/staff/StaffPages';
import { AdminDashboard } from '../src/pages/admin/AdminDashboard';
import { AdminServices } from '../src/pages/admin/CatalogAdmin';
import { SettingsCenter } from '../src/pages/admin/SettingsCenter';

const adminUser = {
  id: 'usr_admin', kind: 'admin', fullName: 'مدیر سامانه', mobile: '09120000000', email: null,
  username: 'admin', nationalId: null, mobileVerified: true, status: 'active', mfaEnabled: false,
  mustChangePassword: false, roleCode: 'super_admin', roleName: 'مدیر کل', permissions: '*',
};

const customerUser = {
  ...adminUser, id: 'usr_customer', kind: 'customer', fullName: 'مشتری نمونه', roleCode: null,
  roleName: null, permissions: [],
};

const summary = {
  kind: 'admin',
  stats: { counts: { new: 2, in_progress: 3 }, open: 5, total: 9, completed: 4, overdue: 1, outstandingAmount: 250000 },
  finance: { revenue: 1000000, receivable: 250000, operatingProfit: 600000, margin: 60, paymentsCount: 4, invoiced: 1250000 },
  cards: { unassigned: 2, pendingDocuments: 3, unreadMessages: 1, checkedInToday: 4 },
  charts: {
    daily: [{ day: '2026-01-01', count: 3 }, { day: '2026-01-02', count: 5 }],
    byStatus: [{ status: 'new', label: 'جدید', count: 2 }, { status: 'completed', label: 'تکمیل‌شده', count: 4 }],
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
  popularServices: [],
};

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

function renderAs(user: any, element: React.ReactElement) {
  setAuthUser(user);
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={['/']}>{element}</MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

afterEach(() => {
  setAuthUser(null);
  fetchMock.mockClear();
});

describe('authenticated panels render', () => {
  it('renders the customer dashboard with stats', async () => {
    renderAs(customerUser, <CustomerDashboard />);
    await waitFor(() => expect(screen.getByText('سلام مشتری 👋')).toBeTruthy());
    expect(screen.getByText('پرونده‌های در جریان')).toBeTruthy();
  });

  it('renders the staff workbench with the assignment queue', async () => {
    renderAs({ ...adminUser, kind: 'staff', roleCode: 'service_expert', permissions: ['requests.view', 'requests.edit'] }, <StaffWorkbench />);
    await waitFor(() => expect(screen.getAllByText(/میز کار/).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('پرونده‌های در دست من')).toBeTruthy());
  });

  it('renders the admin dashboard with finance cards', async () => {
    renderAs(adminUser, <AdminDashboard />);
    await waitFor(() => expect(screen.getByRole('heading',{name:'داشبورد مدیریت'})).toBeTruthy());
    expect(screen.getByText('پرونده‌های در جریان')).toBeTruthy();
    expect(screen.getByText('روند ثبت درخواست (۱۴ روز)')).toBeTruthy();
  });

  it('renders the services catalogue admin with both acceptance flags', async () => {
    renderAs(adminUser, <AdminServices />);
    await waitFor(() => expect(screen.getByText('خدمات و دسته‌ها')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('سابقه بیمه تأمین اجتماعی')).toBeTruthy());
  });

  it('renders the settings centre from the server-defined catalogue', async () => {
    renderAs(adminUser, <SettingsCenter />);
    await waitFor(() => expect(screen.getAllByText('تنظیمات سامانه').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('نام سامانه')).toBeTruthy());
    expect(screen.getByText('نام سامانه')).toBeTruthy();
  });
});
