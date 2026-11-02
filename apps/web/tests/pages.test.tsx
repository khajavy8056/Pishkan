import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { formatDuration, SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';

import { HomePage } from '../src/pages/public/Home';
import { ServicesPage, ServiceDetailPage } from '../src/pages/public/Services';
import { LoginPage, StaffLoginPage, RegisterPage, LegalPage, StatusPage, AssistantPage } from '../src/pages/public/Auth';
import { NotFoundPage } from '../src/pages/public/Auth';
import { fetchMock, setAuthUser } from './setup';

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

describe('duration formatter', () => {
  it('formats minute-, hour-, and day-precision estimates through the shared site helper', () => {
    expect(formatDuration(30)).toBe('۳۰ دقیقه');
    expect(formatDuration(120)).toBe('۲ ساعت');
    expect(formatDuration(1440)).toBe('۱ روز');
    expect(formatDuration(240)).toBe('۴ ساعت');
    expect(formatDuration(undefined, 2)).toBe('۲ روز');
    expect(formatDuration(0, 2)).toBe('۲ روز');
  });
});

describe('public pages render', () => {
  it('renders the landing page with site name and service catalogue', async () => {
    renderAt('/', <HomePage />);
    await waitFor(() => expect(screen.getAllByText(/دفتر پیشخوان/).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('سابقه بیمه تأمین اجتماعی').length).toBeGreaterThan(0));
    // «ثبت درخواست خدمت» for a guest passes the login door first and returns to the panel afterwards.
    const cta = screen.getByRole('link', { name: /ثبت درخواست خدمت/ });
    expect(cta.getAttribute('href')).toBe('/login?next=%2Fapp%2Fservices');
    // Floating support button is present on public pages too.
    expect(screen.getByRole('button', { name: 'پیام‌ها و پشتیبانی' })).toBeTruthy();
  });

  it('lists services returned by the API', async () => {
    renderAt('/services', <ServicesPage />);
    await waitFor(() => expect(screen.getByText('سابقه بیمه تأمین اجتماعی')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'خدمات پیشخوان' })).toBeTruthy();
  });

  it('keeps the request form behind login for guests on the public service page', async () => {
    renderAt('/services/insurance-history', <ServiceDetailPage />);
    await waitFor(() => expect(screen.getByText('مراحل رسیدگی')).toBeTruthy());
    expect(screen.getAllByText('کارت ملی').length).toBeGreaterThan(0);
    const loginCta = screen.getByRole('link', { name: /ورود و ثبت درخواست/ });
    expect(decodeURIComponent(loginCta.getAttribute('href') ?? '')).toBe('/login?next=/app/services/insurance-history');
    expect(screen.getByRole('link', { name: /حساب ندارم/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ثبت نهایی درخواست' })).toBeNull();
    expect(screen.queryByLabelText(/کد ملی/)).toBeNull();
  });

  it('renders the dynamic request form inside the customer panel', async () => {
    setAuthUser({ id: 'usr_form_test', kind: 'customer', roleCode: 'customer', fullName: 'مشتری آزمون', permissions: [] });
    try {
      renderAt('/app/services/insurance-history', <ServiceDetailPage variant="app" />);
      await waitFor(() => expect(screen.getByText('کد ملی')).toBeTruthy());
      expect(screen.getByRole('button', { name: /ثبت نهایی درخواست/ })).toBeTruthy();
    } finally {
      setAuthUser(null);
    }
  });

  it('shows actionable field errors returned when a request submission fails', async () => {
    const originalFetch = fetchMock.getMockImplementation();
    let createCalls = 0;
    setAuthUser({ id: 'usr_submit_test', kind: 'customer', roleCode: 'customer', fullName: 'مشتری آزمون', permissions: [], profileState: { complete: true } });
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url);
      if (url.includes('/api/files/upload')) {
        const data = { id: 'file_submit_test', name: 'card.png', processing: { status: 'ready' }, savingsPercent: 0 };
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true, data }), blob: async () => new Blob(), text: async () => '' } as unknown as Response;
      }
      if (url === '/api/requests') {
        createCalls += 1;
        const body = { ok: false, error: { code: 'bad_request', message: 'اطلاعات فرم کامل یا معتبر نیست.', details: [{ field: 'national_id', message: 'کد ملی الزامی است.' }] } };
        return { ok: false, status: 400, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, blob: async () => new Blob(), text: async () => JSON.stringify(body) } as unknown as Response;
      }
      return originalFetch!(input);
    });

    try {
      const { container } = renderAt('/app/services/insurance-history', <ServiceDetailPage variant="app" />);
      await screen.findByText('کد ملی');
      // Inside the panel the shell header search is also a textbox; pick the
      // service form's national-id input (rendered LTR) instead of index 0.
      const nationalId = container.querySelector('form input[dir="ltr"]');
      if (!(nationalId instanceof HTMLInputElement)) throw new Error('national-id input was not rendered');
      const fileInput = container.querySelector('input[type="file"]');
      if (!(fileInput instanceof HTMLInputElement)) throw new Error('service-document input was not rendered');
      fireEvent.change(fileInput, { target: { files: [new File(['image'], 'card.png', { type: 'image/png' })] } });
      await screen.findByText('بارگذاری شد: card.png');
      fireEvent.click(screen.getByRole('button', { name: 'ثبت نهایی درخواست' }));
      expect((await screen.findAllByText('«کد ملی» الزامی است.')).length).toBeGreaterThan(0);
      expect(createCalls).toBe(0); // client validation should explain missing input before sending

      fireEvent.change(nationalId, { target: { value: '0012345678' } });
      fireEvent.click(screen.getByRole('button', { name: 'ثبت نهایی درخواست' }));
      expect((await screen.findAllByText('کد ملی الزامی است.')).length).toBeGreaterThan(0);
      expect(createCalls).toBe(1); // server field errors are normalized from `field` to `path`
    } finally {
      fetchMock.mockImplementation(originalFetch!);
      setAuthUser(null);
    }
  });

  it('shows the minute-based quote estimate for a signed-in customer', async () => {
    setAuthUser({ id: 'usr_quote_test', kind: 'customer', roleCode: 'customer', fullName: 'مشتری آزمون', permissions: [] });
    try {
      renderAt('/app/services/insurance-history', <ServiceDetailPage variant="app" />);
      await waitFor(() => expect(screen.getByText('زمان تخمینی خدمت')).toBeTruthy());
      expect(screen.getByText('۴ ساعت')).toBeTruthy();
    } finally {
      setAuthUser(null);
    }
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
      if (url.includes('/api/auth/staff/login')) {
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
      renderAt('/login-admin', <StaffLoginPage />);
      await screen.findByText('نام کاربری و رمز');
      fireEvent.click(screen.getByText('نام کاربری و رمز'));
      await screen.findByLabelText(/نام کاربری یا موبایل/);
      fireEvent.change(screen.getByLabelText(/نام کاربری یا موبایل/), { target: { value: 'preview-admin' } });
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

  it('shows the precise minute-based estimate on assistant suggestions', async () => {
    const originalFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url);
      if (url.includes('/api/assistant/chat')) {
        const data = {
          reply: 'این خدمت برای شما مناسب است.',
          suggestions: [{ id: 'svc_duration', slug: 'duration', title: 'خدمت زمان‌دار', summary: 'آزمون زمان دقیق', estimatedMinutes: 240, estimatedDays: 1 }],
          followUpQuestions: [],
        };
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true, data }), blob: async () => new Blob(), text: async () => '' } as unknown as Response;
      }
      return originalFetch!(input);
    });
    try {
      renderAt('/assistant', <AssistantPage />);
      fireEvent.change(await screen.findByLabelText('پیام'), { target: { value: 'خدمت زمان‌دار' } });
      fireEvent.click(screen.getByRole('button', { name: 'ارسال' }));
      await screen.findByText('زمان تخمینی: ۴ ساعت');
    } finally {
      fetchMock.mockImplementation(originalFetch!);
    }
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
