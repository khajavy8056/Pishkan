import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import { one, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import {
  accessToken, devicesFor, pushToUsers, pushDiagnostics, resetAccessTokenCache, sendToToken,
} from '../src/modules/notifications/fcm.js';
import { adminSession, app } from './helpers.js';

/**
 * End-to-end proof of the push path against a *local stub* of Google.
 *
 * Why a stub and not the real service:
 *  - the real one needs a Firebase project and a network that is filtered from
 *    Iran, which is the very problem this feature exists to work around;
 *  - the interesting behaviour is not "does Google accept JSON" but what this
 *    code does with each *answer*: cache the token, prune a dead device, count
 *    repeated failures, never throw into the business flow.
 *
 * The stub implements the two documented endpoints (OAuth token exchange and
 * messages:send) and can be told to answer in the specific ways that matter.
 */
let server: http.Server;
let base = '';
const calls = { token: 0, send: 0 };
type SendBehaviour = { status: number; body: unknown };
let sendBehaviour: SendBehaviour = { status: 200, body: { name: 'projects/p/messages/1' } };
let tokenBehaviour: { status: number; body: unknown } = { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } };
const sentBodies: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token' && req.method === 'POST') {
        calls.token += 1;
        res.statusCode = tokenBehaviour.status;
        res.end(JSON.stringify(tokenBehaviour.body));
        return;
      }
      if (req.url?.endsWith('/messages:send') && req.method === 'POST') {
        calls.send += 1;
        sentBodies.push(JSON.parse(raw || '{}'));
        res.statusCode = sendBehaviour.status;
        res.end(JSON.stringify(sendBehaviour.body));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function credentials() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    project_id: 'pishkan-test',
    client_email: 'notifier@pishkan-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: `${base}/token`,
  });
}

async function configure() {
  await adminSession();
  await app();
  await updateSettings({
    'push.fcm_enabled': true,
    'push.fcm_service_account': credentials(),
    'push.fcm_endpoint': base,
  }, { id: 'test-admin', name: 'مدیر آزمون' });
  resetAccessTokenCache();
}

describe('FCM delivery behaviour', () => {
  it('exchanges the assertion for a token and reuses it instead of asking Google every time', async () => {
    await configure();
    tokenBehaviour = { status: 200, body: { access_token: 'ya29.cached', expires_in: 3600 } };
    const account = JSON.parse(await (await import('../src/modules/settings/service.js')).getSecret('push.fcm_service_account'));
    const before = calls.token;
    const first = await accessToken(account);
    const second = await accessToken(account);
    expect(first).toBe('ya29.cached');
    expect(second).toBe('ya29.cached');
    expect(calls.token).toBe(before + 1);
  });

  it('a failing token exchange surfaces as an error the diagnostic screen can show', async () => {
    await configure();
    tokenBehaviour = { status: 400, body: { error: 'invalid_grant' } };
    resetAccessTokenCache();
    const account = JSON.parse(await (await import('../src/modules/settings/service.js')).getSecret('push.fcm_service_account'));
    await expect(accessToken(account, { force: true })).rejects.toThrow(/invalid_grant|token exchange/i);
    tokenBehaviour = { status: 200, body: { access_token: 'ya29.back', expires_in: 3600 } };
    resetAccessTokenCache();
  });

  it('stores a device, sends to it, and records a successful delivery', async () => {
    await configure();
    const admin = await one<{ id: string }>("SELECT id FROM users WHERE username = 'testadmin'");
    const token = `fcm-token-${Date.now()}-aaaaaaaaaaaaaaaa`;
    const { registerDevice } = await import('../src/modules/notifications/fcm.js');
    await registerDevice(admin!.id, { token, platform: 'android', deviceName: 'Galaxy' });

    sendBehaviour = { status: 200, body: { name: 'projects/p/messages/42' } };
    const result = await pushToUsers([admin!.id], {
      title: 'مرحلهٔ پروندهٔ شما به‌روز شد',
      body: 'مرحلهٔ فعلی: «بررسی کارشناس»',
      link: '/app/requests/req_1',
      tag: 'request-stage:req_1:3',
      kind: 'info',
      progress: 0.4,
      stageLabel: 'بررسی کارشناس',
    });
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const delivered = sentBodies.at(-1);
    expect(delivered.message.token).toBe(token);
    expect(delivered.message.data.stageLabel).toBe('بررسی کارشناس');
    expect(delivered.message.android.collapse_key).toBe('pishkan:request-stage:req_1:3');
    const log = await one<any>(
      "SELECT * FROM push_delivery_log WHERE device_token_tail = ? ORDER BY created_at DESC LIMIT 1",
      [token.slice(-6)],
    );
    expect(log.ok).toBe(1);
    expect(log.channel).toBe('fcm');
  });

  it('deletes the device when Google says the token is gone, instead of retrying forever', async () => {
    await configure();
    const admin = await one<{ id: string }>("SELECT id FROM users WHERE username = 'testadmin'");
    const token = `fcm-token-gone-${Date.now()}-bbbbbbbb`;
    const { registerDevice } = await import('../src/modules/notifications/fcm.js');
    await registerDevice(admin!.id, { token });

    sendBehaviour = {
      status: 404,
      body: { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } },
    };
    const result = await pushToUsers([admin!.id], { title: 't', body: 'b' });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const left = await devicesFor(admin!.id);
    expect(left.some((d) => d.token === token)).toBe(false);
  });

  it('keeps a device through a transient failure but drops it after three in a row', async () => {
    await configure();
    const admin = await one<{ id: string }>("SELECT id FROM users WHERE username = 'testadmin'");
    const token = `fcm-token-flaky-${Date.now()}-cccccccc`;
    const { registerDevice } = await import('../src/modules/notifications/fcm.js');
    await registerDevice(admin!.id, { token });

    // A 503 is the push service being temporarily unavailable: the phone is
    // fine and must not be unregistered over it.
    sendBehaviour = { status: 503, body: { error: { status: 'UNAVAILABLE', message: 'try again' } } };
    await pushToUsers([admin!.id], { title: 't', body: 'b' });
    let devices = await devicesFor(admin!.id);
    const afterFirst = devices.find((d) => d.token === token);
    expect(afterFirst).toBeTruthy();
    expect(Number(afterFirst!.failure_count)).toBe(1);

    // Third consecutive failure: the token is dead in practice (app removed,
    // Google rotated it) and keeping it only burns quota.
    await pushToUsers([admin!.id], { title: 't', body: 'b' });
    await pushToUsers([admin!.id], { title: 't', body: 'b' });
    devices = await devicesFor(admin!.id);
    expect(devices.some((d) => d.token === token)).toBe(false);
    sendBehaviour = { status: 200, body: { name: 'ok' } };
  });

  it('never throws into the caller when push is misconfigured', async () => {
    await adminSession();
    await app();
    // No credentials at all: the business flow that calls this must still pass.
    await updateSettings({ 'push.fcm_enabled': false, 'push.fcm_service_account': '' }, { id: 'test-admin', name: 'مدیر آزمون' });
    const admin = await one<{ id: string }>("SELECT id FROM users WHERE username = 'testadmin'");
    const result = await pushToUsers([admin!.id], { title: 't', body: 'b' });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBeTruthy();
  });

  it('reports credentials as unusable on the diagnostics screen instead of pretending', async () => {
    await adminSession();
    await app();
    await updateSettings({
      'push.fcm_enabled': true,
      'push.fcm_service_account': credentials(),
      'push.fcm_endpoint': base,
    }, { id: 'test-admin', name: 'مدیر آزمون' });
    tokenBehaviour = { status: 401, body: { error: 'unauthorized_client' } };
    resetAccessTokenCache();
    const diagnostics = await pushDiagnostics();
    expect(diagnostics.enabled).toBe(true);
    expect(diagnostics.credentialsOk).toBe(false);
    expect(String(diagnostics.credentialsError)).toContain('token exchange');
    tokenBehaviour = { status: 200, body: { access_token: 'ya29.ok', expires_in: 3600 } };
    resetAccessTokenCache();
  });

  it('does not leak the access token into the delivery log', async () => {
    const rows = await (await import('../src/db/index.js')).q<any>('SELECT * FROM push_delivery_log');
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain('ya29.');
    }
    await run('DELETE FROM push_delivery_log WHERE error_code = ?', ['NETWORK']).catch(() => undefined);
  });
});

describe('sendToToken contract', () => {
  it('maps an unknown endpoint failure to a code instead of throwing', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const account = {
      project_id: 'p',
      client_email: 'a@b.c',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `${base}/token`,
    };
    tokenBehaviour = { status: 200, body: { access_token: 'ya29.x', expires_in: 3600 } };
    resetAccessTokenCache();
    // Nothing is listening on this port.
    const result = await sendToToken(account, 'tok-abcdefghijklmnop', { title: 't', body: 'b' }, { endpoint: 'http://127.0.0.1:1' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBeTruthy();
  });
});
