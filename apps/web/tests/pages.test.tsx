import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';

import { HomePage } from '../src/pages/public/Home';
import { ServicesPage, ServiceDetailPage } from '../src/pages/public/Services';
import { LoginPage, RegisterPage, LegalPage, StatusPage, AssistantPage } from '../src/pages/public/Auth';
import { NotFoundPage } from '../src/pages/public/Auth';

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
