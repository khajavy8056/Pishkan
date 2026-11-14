import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { authUser, fetchMock, setAuthUser } from './setup';

import { PublicLayout } from '../src/components/public-layout';
import { AppShell } from '../src/components/shell';
import { MessageCenter } from '../src/pages/shared/MessageCenter';

/**
 * Mobile experience guards: the public bottom dock, short panel-dock labels
 * with the active page always seated, and one-pane-at-a-time master/detail
 * behaviour in the conversation center. jsdom has no layout engine, so these
 * assert the structural hooks (classes/labels) the responsive CSS keys on.
 */

const adminUser = {
  id: 'usr_admin', kind: 'admin', fullName: 'مدیر سامانه', mobile: '09120000000', email: null,
  username: 'admin', nationalId: null, mobileVerified: true, status: 'active', mfaEnabled: false,
  mustChangePassword: false, roleCode: 'super_admin', roleName: 'مدیر کل', permissions: '*',
};

const contentUser = {
  ...adminUser, id: 'usr_content', kind: 'staff', fullName: 'مدیر محتوا', roleCode: 'content_manager',
  roleName: 'مدیر محتوا (بلاگ)',
  permissions: ['dashboard.view', 'blog.view', 'blog.create', 'blog.edit', 'blog.delete', 'blog.publish', 'blog.comments', 'blog.categories', 'blog.manage', 'messages.view'],
};

const bootstrap = {
  version: '1.0.0-test',
  settings: { 'site.name': 'تک پیشخوان', 'site.short_name': 'تک پیشخوان' },
  categories: [], popularServices: [], newestServices: [],
  authMethods: { staffOtp: false, otp: true, password: true, registrationOpen: true, passwordReset: true },
  maintenance: false,
  assistant: { enabled: false, name: '', welcome: '', disclaimer: '' },
};

const thread = {
  id: 'th_1', subject: 'پیگیری پرونده تعویض پلاک', customerName: 'مشتری نمونه',
  lastMessage: 'ممنون از راهنمایی', scope: 'general', status: 'open', unread: 1,
};

function json(data: unknown, status = 200, meta?: unknown) {
  return {
    ok: status < 400, status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => (status < 400 ? { ok: true, data, ...(meta ? { meta } : {}) } : { ok: false, error: data }),
    blob: async () => new Blob(),
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function installApi() {
  fetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/api/auth/me')) return authUser ? json(authUser) : json({ code: 'unauthorized', message: 'وارد شوید' }, 401);
    if (path.startsWith('/api/public/bootstrap')) return json(bootstrap);
    if (path.startsWith('/api/customers/me/notifications')) return json([], 200, { unread: 0, total: 0 });
    if (method === 'GET' && path.match(/^\/api\/messages\/threads\/[^/]+/)) return json({ ...thread, messages: [] });
    if (path.startsWith('/api/messages/threads')) return json([thread], 200, { total: 1, page: 1, pageSize: 100 });
    return json({ code: 'not_found', message: 'یافت نشد' }, 404);
  });
}

function renderAt(element: React.ReactElement, route = '/') {
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

const dockOf = () => screen.getByRole('navigation', { name: 'دسترسی سریع موبایل' });
/** Exact class-token check (`overflow-hidden` must not count as `hidden`). */
const hasHidden = (el: HTMLElement) => el.className.split(/\s+/).includes('hidden');

beforeEach(() => { setAuthUser(null); });
afterEach(() => { setAuthUser(null); fetchMock.mockReset(); });

describe('public mobile navigation', () => {
  it('gives guests a bottom dock with the five key destinations', async () => {
    installApi();
    renderAt(<PublicLayout><p>محتوا</p></PublicLayout>, '/');

    const dock = await waitFor(() => dockOf());
    const hrefs = within(dock).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/services', '/blog', '/assistant', '/login']);
    expect(within(dock).getByText('خانه')).toBeTruthy();
    expect(within(dock).getByText('ورود')).toBeTruthy();
  });

  it('swaps the dock login cell for «پنل من» once signed in', async () => {
    setAuthUser({ ...contentUser, kind: 'customer', roleCode: null, roleName: null, permissions: [] });
    installApi();
    renderAt(<PublicLayout><p>محتوا</p></PublicLayout>, '/blog');

    const dock = await waitFor(() => dockOf());
    await waitFor(() => expect(within(dock).getByText('پنل من')).toBeTruthy());
  });
});

describe('panel mobile dock', () => {
  it('mirrors the approved phone mock for the admin (داشبورد، درخواست‌ها، خدمات، کیف پول، منو)', async () => {
    setAuthUser(adminUser);
    installApi();
    renderAt(<AppShell variant="admin"><p>محتوا</p></AppShell>, '/admin');

    const dock = await waitFor(() => dockOf());
    const hrefs = within(dock).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/admin', '/admin/requests', '/admin/services', '/admin/wallet']);
    expect(within(dock).getByText('داشبورد')).toBeTruthy();
    expect(within(dock).getByText('خدمات')).toBeTruthy();
    expect(within(dock).getByText('کیف پول')).toBeTruthy();
    expect(within(dock).queryByText('خدمات و دسته‌ها')).toBeNull();
    expect(within(dock).getByRole('button', { name: /منو/ })).toBeTruthy();
  });

  it('mirrors the approved phone mock for the customer', async () => {
    setAuthUser({ ...contentUser, kind: 'customer', roleCode: null, roleName: null, permissions: [] });
    installApi();
    renderAt(<AppShell variant="customer"><p>محتوا</p></AppShell>, '/app');

    const dock = await waitFor(() => dockOf());
    const hrefs = within(dock).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/app', '/app/requests', '/app/services', '/app/wallet']);
    expect(within(dock).getByText('پیگیری')).toBeTruthy();
    expect(within(dock).getByText('کیف پول')).toBeTruthy();
  });

  it('seats the active page in the dock even when it is far down the nav (content manager → blog)', async () => {
    setAuthUser(contentUser);
    installApi();
    renderAt(<AppShell variant="staff"><p>محتوا</p></AppShell>, '/staff/blog');

    const dock = await waitFor(() => dockOf());
    const blogCell = within(dock).getByRole('link', { name: /بلاگ/ });
    expect(blogCell.getAttribute('href')).toBe('/staff/blog');
    expect(within(dock).getByText('بلاگ')).toBeTruthy();
  });
});

describe('conversation center on a phone', () => {
  it('shows one pane at a time with a working back button', async () => {
    setAuthUser(contentUser);
    installApi();
    renderAt(<MessageCenter variant="staff" />, '/staff/messages');

    const row = await screen.findByRole('button', { name: /پیگیری پرونده تعویض پلاک/ });
    const listCard = screen.getByPlaceholderText('جست‌وجو در گفت‌وگوها…').closest('.card') as HTMLElement;
    const threadCard = screen.getByText('یک گفت‌وگو را انتخاب کنید.').closest('.card') as HTMLElement;

    // nothing selected: list visible, thread pane parked for lg only
    expect(hasHidden(listCard)).toBe(false);
    expect(hasHidden(threadCard)).toBe(true);
    expect(threadCard.className).toContain('lg:flex');

    fireEvent.click(row);

    await waitFor(() => expect(screen.getByRole('button', { name: 'بازگشت به فهرست گفت‌وگوها' })).toBeTruthy());
    expect(hasHidden(listCard)).toBe(true);
    expect(listCard.className).toContain('lg:block');
    expect(hasHidden(threadCard)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'بازگشت به فهرست گفت‌وگوها' }));
    await waitFor(() => expect(hasHidden(listCard)).toBe(false));
  });
});
