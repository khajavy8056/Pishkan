import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { fetchMock, setAuthUser } from './setup';
import { AdminGuard } from '../src/pages/admin/Guard';

const adminUser = {
  id: 'usr_admin', kind: 'admin', fullName: 'مدیر سامانه', mobile: '09120000000', email: null,
  username: 'admin', nationalId: null, mobileVerified: true, status: 'active', mfaEnabled: false,
  mustChangePassword: false, roleCode: 'super_admin', roleName: 'مدیر کل', permissions: '*',
};

const overview = {
  generatedAt: '2026-11-26T10:00:00.000Z', enabled: true,
  events24h: { info: 1, warning: 2, critical: 1 }, failedLogins24h: 14, activeBlocks: 1, openCritical: 1,
  posture: [
    { key: 'tls', title: 'HTTPS و کوکی امن', status: 'ok', detail: 'امن است.' },
    { key: 'backup_external', title: 'پشتیبان خارج از سرور', status: 'warning', detail: 'تنظیم نشده.' },
  ],
  recentEvents: [{
    id: 'gev_1', created_at: '2026-11-26T09:00:00.000Z', severity: 'critical', kind: 'auth_bruteforce',
    source_ip: '203.0.113.77', user_id: null, method: 'POST', path: '/api/auth/staff/login',
    message: '۳ تلاش ورود ناموفق از 203.0.113.77', details: {}, action_taken: 'blocked', acknowledged_at: null, acknowledged_by: null,
  }],
  lastScans: { integrity: null, uploads: null, deps: null },
};

const events = [overview.recentEvents[0]];
const blocks = [{ id: 'gbl_1', ip: '203.0.113.77', reason: 'حملهٔ رمز', created_at: '2026-11-26T09:00:00.000Z', expires_at: '2026-11-26T09:30:00.000Z', created_by: 'guard', revoked_at: null }];
const quarantine = [{ id: 'gq_1', original_path: 'rogue.bin', sha256: 'abc123', size: 1024, reason: 'امضای ELF', created_at: '2026-11-26T08:00:00.000Z', created_by: 'scheduler', restored_at: null }];
const deps = {
  checkedAt: '2026-11-26T07:00:00.000Z', ok: true, total: 1, counts: { high: 1 },
  vulnerabilities: [{ name: 'adm-zip', severity: 'high', isDirect: true, range: '<0.6.1', advisories: [{ title: 'Zip bomb', url: 'https://github.com/advisories/GHSA-x' }], fixAvailable: { name: 'adm-zip', version: '0.6.1', isSemVerMajor: false } }],
};

function json(data: unknown) {
  return {
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ ok: true, data }),
  } as unknown as Response;
}

let calls: { url: string; method: string; body?: any }[] = [];

beforeEach(() => {
  calls = [];
  setAuthUser(adminUser);
  fetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input.url);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/api/auth/me')) return json(adminUser);
    if (url.includes('/api/public/bootstrap')) return json({ version: 't', settings: { 'site.name': 'تک پیشخوان' }, categories: [], popularServices: [], newestServices: [], authMethods: {}, maintenance: false, assistant: { enabled: false } });
    if (url.includes('/api/guard/overview')) return json(overview);
    if (url.includes('/api/guard/events')) return json(events);
    if (url.includes('/api/guard/blocks') && method === 'DELETE') return json({ id: 'gbl_1', revoked: true });
    if (url.includes('/api/guard/blocks')) return json(blocks);
    if (url.includes('/api/guard/scans')) return json([]);
    if (url.includes('/api/guard/quarantine')) return json(quarantine);
    if (url.includes('/api/guard/deps')) return json(deps);
    if (url.includes('/api/guard/scan')) return json({ id: 'gsc_1', status: 'ok', summary: { findings: 0 } });
    if (url.includes('/api/notifications')) return json([]);
    return json({});
  });
});

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/admin/guard']}>
      <AuthProvider>
        <SiteProvider>
          <ToastProvider>
            <AdminGuard />
          </ToastProvider>
        </SiteProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Admin Guard page', () => {
  it('renders the security dashboard with posture and real counters', async () => {
    renderGuard();
    await waitFor(() => expect(screen.getAllByText('گارد تک پیشخوان')[0]).toBeTruthy());
    await waitFor(() => expect(screen.getByText('HTTPS و کوکی امن')).toBeTruthy());
    expect(screen.getByText('پشتیبان خارج از سرور')).toBeTruthy();
    expect(screen.getByText('ورود ناموفق ۲۴ ساعت')).toBeTruthy();
    expect(screen.getByText('IP مسدود فعال')).toBeTruthy();
  });

  it('lists events and acknowledges one through the API', async () => {
    renderGuard();
    await waitFor(() => expect(screen.getAllByText('گارد تک پیشخوان')[0]).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /رویدادها/ }));
    await waitFor(() => expect(screen.getByText('حملهٔ رمز (Brute Force)')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /بررسی شد/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/guard/events/gev_1/ack') && c.method === 'POST')).toBe(true));
  });

  it('shows active blocks and revokes one', async () => {
    renderGuard();
    await waitFor(() => expect(screen.getAllByText('گارد تک پیشخوان')[0]).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /مسدودسازی IP/ }));
    await waitFor(() => expect(screen.getByText('203.0.113.77')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /لغو مسدودسازی/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/guard/blocks/gbl_1') && c.method === 'DELETE')).toBe(true));
  });

  it('runs a scan and shows the dependency report with a safe fix version', async () => {
    renderGuard();
    await waitFor(() => expect(screen.getAllByText('گارد تک پیشخوان')[0]).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /اسکن‌ها و وابستگی‌ها/ }));
    await waitFor(() => expect(screen.getByText('adm-zip')).toBeTruthy());
    expect(screen.getByText('0.6.1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /اسکن یکپارچگی فایل‌ها/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/guard/scan') && c.body?.kind === 'integrity')).toBe(true));
  });

  it('restores a quarantined file with the confirmation phrase', async () => {
    renderGuard();
    await waitFor(() => expect(screen.getAllByText('گارد تک پیشخوان')[0]).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /قرنطینه/ }));
    await waitFor(() => expect(screen.getByText('rogue.bin')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /بازگردانی/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/guard/quarantine/gq_1/restore') && c.body?.confirm === 'بازگردانی فایل')).toBe(true));
  });
});
