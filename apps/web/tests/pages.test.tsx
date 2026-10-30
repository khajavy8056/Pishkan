import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';

import { HomePage } from '../src/pages/public/Home';
import { ServicesPage, ServiceDetailPage } from '../src/pages/public/Services';
import { LoginPage, RegisterPage, LegalPage, StatusPage, AssistantPage } from '../src/pages/public/Auth';
import { NotFoundPage } from '../src/pages/public/Auth';
import { fetchMock } from './setup';

function renderAt(path: string, element: React.ReactElement) {
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

describe('public pages render', () => {
  it('renders the landing page with site name and service catalogue', async () => {
    renderAt('/', <HomePage />);
    await waitFor(() => expect(screen.getAllByText(/دفتر پیشخوان/).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('سابقه بیمه تأمین اجتماعی').length).toBeGreaterThan(0));
  });

  it('lists services returned by the API', async () => {
    renderAt('/services', <ServicesPage />);
    await waitFor(() => expect(screen.getByText('سابقه بیمه تأمین اجتماعی')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'خدمات دفتر پیشخوان' })).toBeTruthy();
  });

  it('renders the dynamic request form for a service', async () => {
    renderAt('/services/insurance-history', <ServiceDetailPage />);
    await waitFor(() => expect(screen.getByText('کد ملی')).toBeTruthy());
    expect(screen.getByText('کارت ملی')).toBeTruthy();
    expect(screen.getByText('مراحل رسیدگی')).toBeTruthy();
  });

  it('shows OTP login when it is enabled in settings', async () => {
    renderAt('/login', <LoginPage />);
    await waitFor(() => expect(screen.getByText('کد یک‌بارمصرف')).toBeTruthy());
    expect(screen.getByText('نام کاربری و رمز')).toBeTruthy();
  });

  it('does not enter a protected panel if the browser session cookie cannot be verified', async () => {
    const originalFetch = fetchMock.getMockImplementation();
    let authMeCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url);
      if (url.includes('/api/auth/login')) {
        const data = { user: { id: 'usr_admin', kind: 'admin', fullName: 'مدیر سامانه', roleCode: 'super_admin', permissions: '*' }, token: 'test-session-token' };
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true, data }), blob: async () => new Blob(), text: async () => '' } as unknown as Response;
      }
      if (url.includes('/api/auth/me')) {
        authMeCalls += 1;
        return { ok: false, status: 401, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: false, error: { code: 'unauthorized', message: 'برای دسترسی باید وارد شوید.' } }), blob: async () => new Blob(), text: async () => '' } as unknown as Response;
      }
      return originalFetch!(input);
    });

    try {
      renderAt('/login?account=staff', <LoginPage />);
      await screen.findByText('نام کاربری و رمز');
      fireEvent.click(screen.getByText('نام کاربری و رمز'));
      await screen.findByLabelText(/نام کاربری، موبایل یا ایمیل/);
      fireEvent.change(screen.getByLabelText(/نام کاربری، موبایل یا ایمیل/), { target: { value: 'preview-admin' } });
      fireEvent.change(screen.getByLabelText(/رمز عبور/), { target: { value: 'example-password' } });
      fireEvent.click(screen.getByRole('button', { name: 'ورود' }));
      await waitFor(() => expect(screen.getByText(/نشست مرورگر تأیید نشد/)).toBeTruthy());
      expect(authMeCalls).toBe(3); // initial auth check plus two post-login checks
    } finally {
      fetchMock.mockImplementation(originalFetch!);
    }
  });

  it('renders the registration form when open', async () => {
    renderAt('/register', <RegisterPage />);
    await waitFor(() => expect(screen.getByText('ایجاد حساب مشتری')).toBeTruthy());
  });

  it('renders the assistant conversation shell', async () => {
    renderAt('/assistant', <AssistantPage />);
    await waitFor(() => expect(screen.getByPlaceholderText('سؤال خود را بنویسید…')).toBeTruthy());
  });

  it('renders legal pages and the status page', async () => {
    renderAt('/legal', <LegalPage />);
    await waitFor(() => expect(screen.getByText('شرایط استفاده و حریم خصوصی')).toBeTruthy());
  });

  it('renders the status page data', async () => {
    renderAt('/status', <StatusPage />);
    await waitFor(() => expect(screen.getAllByText('وضعیت سامانه').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('1.0.0-test')).toBeTruthy());
  });

  it('renders a 404 page for unknown routes', async () => {
    renderAt('/nope', <NotFoundPage />);
    await waitFor(() => expect(screen.getByText('صفحه مورد نظر یافت نشد')).toBeTruthy());
  });
});
