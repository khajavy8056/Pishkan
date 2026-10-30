import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProvider } from '../src/modules/sms/provider.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { app } from './helpers.js';

const actor = { id: 'system', name: 'sms-provider-contract-test' };

async function configurePanelSms() {
  await app();
  await updateSettings({
    'sms.enabled': true,
    'sms.provider': 'melipayamak',
    'sms.auth_mode': 'credentials',
    'sms.username': 'test-user',
    'sms.password': 'test-password',
    'sms.api_key': '',
    'sms.base_url': 'https://rest.payamak-panel.com/api',
  }, actor);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MeliPayamak REST contract', () => {
  it('accepts the official plain-text RecId and sends pattern variables as semicolon-delimited text', async () => {
    await configurePanelSms();
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('1234567890123456', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await (await getProvider()).sendPattern({ to: '09121234567', bodyId: '12345', args: ['کد ۱۲۳۴۵', 'تأیید'] });
    expect(result).toEqual({ ok: true, messageId: '1234567890123456', provider: 'melipayamak' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('username')).toBe('test-user');
    expect(body.get('password')).toBe('test-password');
    expect(body.get('to')).toBe('09121234567');
    expect(body.get('bodyId')).toBe('12345');
    expect(body.get('text')).toBe('کد ۱۲۳۴۵;تأیید');
  });

  it('preserves compatibility with the earlier JSON response envelope', async () => {
    await configurePanelSms();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ RetStatus: 1, Value: '123456' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));

    const result = await (await getProvider()).sendPattern({ to: '09121234567', bodyId: '12345', args: ['کد'] });
    expect(result).toEqual({ ok: true, messageId: '123456', provider: 'melipayamak' });
  });

  it('maps official pattern error codes returned as plain text without claiming the message was sent', async () => {
    await configurePanelSms();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('-4', { status: 200 })));

    const result = await (await getProvider()).sendPattern({ to: '09121234567', bodyId: 'bad', args: ['کد'] });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('-4');
    expect(result.error).toContain('تأییدشده نیست');
  });
});
