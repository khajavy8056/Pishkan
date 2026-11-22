import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { setAuthUser } from './setup';
import { AdminAndroidApp } from '../src/pages/admin/AndroidApp';

/**
 * The banner tab of the Android app page.
 *
 * This screen is the office's only way to manage what the customer sees at the
 * top of the home screen, and it replaced a story editor whose shape was
 * nothing like it. The tests below pin the parts that would regress silently:
 * a banner is listed with its destination spelled out, publish/unpublish hits
 * the right endpoint, and the editor refuses to save a service banner with no
 * service chosen — the one mistake that produces a card that goes nowhere.
 */

const adminUser = {
  id: 'usr_admin', kind: 'admin', fullName: 'مدیر سامانه', mobile: '09120000000', email: null,
  username: 'admin', nationalId: null, mobileVerified: true, status: 'active', mfaEnabled: false,
  mustChangePassword: false, roleCode: 'super_admin', roleName: 'مدیر کل', permissions: '*',
};

const banner = (over: Record<string, unknown> = {}) => ({
  id: 'bn_1',
  kind: 'service',
  title: 'تعویض پلاک، بدون صف',
  subtitle: 'نوبت و مدارک را همین‌جا انجام دهید',
  imageUrl: '/images/services/individual/plate-replacement-appointment.webp',
  externalImageUrl: null,
  accentColor: '#0EA5A4',
  destinationKind: 'service',
  destinationSlug: 'plate-replacement-appointment',
  destinationUrl: null,
  actionLabel: 'شروع',
  sortOrder: 1,
  startsAt: null,
  expiresAt: null,
  status: 'published',
  notifyCustomers: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

function json(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ ok: status < 400, data }),
    blob: async () => new Blob(),
    text: async () => JSON.stringify({ ok: status < 400, data }),
  } as unknown as Response;
}

/** Records every mutating request so the test can assert on the payload. */
const calls: { method: string; path: string; body: any }[] = [];

function installApi(banners: any[]) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input.url ?? input);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') calls.push({ method, path, body: init?.body ? JSON.parse(init.body) : null });

    // AuthProvider hydrates the session from /api/auth/me; without it the page
    // renders read-only and the manage buttons never appear.
    if (path === '/api/auth/me') return json(adminUser);

    if (path.startsWith('/api/app/admin/banners/reorder')) return json(banners);
    if (path === '/api/app/admin/banners') return json(banners);
    if (path === '/api/app/admin/banner-targets') {
      return json([{ slug: 'plate-replacement-appointment', title: 'نوبت تعویض پلاک', category: 'خدمات خودرویی' }]);
    }
    if (path === '/api/app/admin/stats') {
      return json({
        devices: { total: 0, users: 0, active7d: 0, active30d: 0, lastSeenAt: null, byVersion: [], recent: [] },
        banners: { published: 1, draft: 0 },
      });
    }
    if (path === '/api/app/admin/connection') return json({ lanEnabled: false, urls: [], mode: 'localhost', note: '', hint: '' });
    if (path === '/api/settings/admin') return json({ settings: [], groups: [] });
    if (path === '/api/public/bootstrap') return json({ settings: {}, categories: [], popularServices: [], newestServices: [], authMethods: {} });
    return json({}, 404);
  }));
}

function renderPage() {
  setAuthUser(adminUser);
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <SiteProvider>
            <AdminAndroidApp />
          </SiteProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

/** Two banners in a known order: the first is bn_1, the second bn_2. */
const pair = () => [
  banner({ id: 'bn_1', title: 'بنر نخست', sortOrder: 1 }),
  banner({ id: 'bn_2', title: 'بنر دوم', sortOrder: 2 }),
];

describe('admin banner management', () => {
  it('lists banners with their destination spelled out in words', async () => {
    installApi([banner()]);
    renderPage();

    expect(await screen.findByText('تعویض پلاک، بدون صف')).toBeTruthy();
    // The destination is resolved through the target list, so the office sees
    // the service's name rather than a slug it cannot read.
    expect(await screen.findByText(/نوبت تعویض پلاک/)).toBeTruthy();
    expect(screen.getByText('منتشرشده')).toBeTruthy();
    expect(screen.getByText('معرفی خدمت')).toBeTruthy();
  });

  it('publishes and unpublishes from the card without opening the editor', async () => {
    installApi([banner({ status: 'draft' })]);
    renderPage();

    const publish = await screen.findByRole('button', { name: /انتشار/ });
    fireEvent.click(publish);

    await waitFor(() => {
      const patch = calls.find((call) => call.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(patch!.path).toBe('/api/app/admin/banners/bn_1');
      expect(patch!.body).toEqual({ status: 'published' });
    });
  });

  it('refuses to save a service banner with no service chosen', async () => {
    installApi([]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /بنر تازه/ }));
    const dialog = await screen.findByRole('dialog');
    // A title alone is not enough — without a picture and a destination this
    // banner would be a blank card on a customer's phone.
    fireEvent.change(within(dialog).getByPlaceholderText(/تعویض پلاک، بدون صف/), {
      target: { value: 'بنر ناقص' },
    });
    const save = within(dialog).getByRole('button', { name: /ذخیره بنر/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the notification switch when it is turned on', async () => {
    installApi([banner({ status: 'draft', notifyCustomers: false })]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /ویرایش/ }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(0));
    const dialog = await screen.findByRole('dialog');

    // The only switch inside the modal is the notify one.
    const toggle = within(dialog).getAllByRole('switch').at(-1)!;
    fireEvent.click(toggle);
    const save = within(dialog).getByRole('button', { name: /ذخیره بنر/ }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => {
      const patch = calls.find((call) => call.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(patch!.body.notifyCustomers).toBe(true);
    }, { timeout: 3000 });
  });

  it('reorders by sending the full list of ids, in the new order', async () => {
    installApi(pair());
    renderPage();

    await screen.findByText('بنر نخست');
    // Three banners' worth of rows would need three clicks to reach the end;
    // with two, moving the second one up is the whole operation and the body
    // has to contain both ids with the order swapped.
    const upButtons = await screen.findAllByRole('button', { name: 'جابه‌جایی به بالا' });
    fireEvent.click(upButtons[1]);

    await waitFor(() => {
      const reorder = calls.find((call) => call.path === '/api/app/admin/banners/reorder');
      expect(reorder).toBeTruthy();
      // A reorder that sent only the moved id (or a dense 1..n renumber) is the
      // mistake this catches: every row has to appear, exactly once.
      expect(reorder!.body.ids).toEqual(['bn_2', 'bn_1']);
    });
  });

  it('deletes only after the office confirms', async () => {
    installApi(pair());
    renderPage();

    await screen.findByText('بنر نخست');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getAllByRole('button', { name: /حذف/ })[0]);
    // Declining the confirmation must not send anything.
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'DELETE')).toBeUndefined();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: /حذف/ })[0]);
    await waitFor(() => {
      const del = calls.find((c) => c.method === 'DELETE');
      expect(del).toBeTruthy();
      expect(del!.path).toBe('/api/app/admin/banners/bn_1');
    });
    confirm.mockRestore();
  });
});
