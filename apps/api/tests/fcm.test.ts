import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { buildMessage, parseServiceAccount, signJwtAssertion } from '../src/modules/notifications/fcm.js';

/**
 * These tests deliberately avoid the network: the parts of the FCM sender that
 * can be wrong silently are the *local* ones (JWT claims, key decoding, message
 * shape). The HTTP exchange is exercised through the real endpoint override in
 * the integration test below when a server is available.
 */
function serviceAccount() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    json: JSON.stringify({
      type: 'service_account',
      project_id: 'pishkan-test',
      client_email: 'notifier@pishkan-test.iam.gserviceaccount.com',
      private_key: pem,
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
    publicKey,
  };
}

const b64uDecode = (part: string) => Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

describe('FCM service account parsing', () => {
  it('accepts the real service-account file shape', () => {
    const { json } = serviceAccount();
    const parsed = parseServiceAccount(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.project_id).toBe('pishkan-test');
    expect(parsed!.client_email).toContain('@pishkan-test.iam.gserviceaccount.com');
    expect(parsed!.private_key).toContain('BEGIN PRIVATE KEY');
  });

  it('repairs a private key that travelled as a single line with escaped newlines', () => {
    // A JSON file pasted into an env var or a one-line settings field keeps the
    // literal backslash-n. Without this the RSA signer throws an opaque error
    // at send time, long after the operator saved the key.
    const { json } = serviceAccount();
    const flattened = JSON.parse(json);
    flattened.private_key = flattened.private_key.replace(/\n/g, '\\n');
    const parsed = parseServiceAccount(JSON.stringify(flattened));
    expect(parsed).not.toBeNull();
    expect(parsed!.private_key).toContain('\n');
  });

  it('rejects junk instead of failing later at send time', () => {
    expect(parseServiceAccount('')).toBeNull();
    expect(parseServiceAccount('not json')).toBeNull();
    expect(parseServiceAccount('{"project_id":"x"}')).toBeNull();
    // A valid JSON object whose key is an SSH key must not look usable.
    expect(parseServiceAccount(JSON.stringify({
      project_id: 'p', client_email: 'a@b.c', private_key: '-----BEGIN RSA PRIVATE KEY-----\nxx\n',
    }))).toBeNull();
  });
});

describe('FCM JWT assertion', () => {
  it('produces a signature that verifies against the service account public key', () => {
    const { json, publicKey } = serviceAccount();
    const account = parseServiceAccount(json)!;
    const jwt = signJwtAssertion(account, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(header && claims && signature).toBeTruthy();

    // The signature must actually validate: a typo in the algorithm, the
    // encoding or the signing input would otherwise only surface as
    // "invalid_grant" from Google with no clue which part was wrong.
    const verified = crypto
      .createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, b64uDecode(signature));
    expect(verified).toBe(true);

    const decoded = JSON.parse(b64uDecode(claims).toString('utf8'));
    expect(decoded.iss).toBe(account.client_email);
    expect(decoded.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(decoded.aud).toBe('https://oauth2.googleapis.com/token');
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  it('uses the token_uri from the file so a proxy endpoint works unchanged', () => {
    const { json } = serviceAccount();
    const account = parseServiceAccount(json)!;
    account.token_uri = 'https://auth.internal.example/token';
    const claims = JSON.parse(b64uDecode(signJwtAssertion(account).split('.')[1]).toString('utf8'));
    expect(claims.aud).toBe('https://auth.internal.example/token');
  });
});

describe('FCM message shape', () => {
  it('sends everything as string-valued data, as the v1 API requires', () => {
    const message: any = buildMessage('device-token-1234567890', {
      title: 'مرحلهٔ پروندهٔ شما به‌روز شد',
      body: 'مرحلهٔ فعلی: «بررسی کارشناس»',
      link: '/app/requests/req_1',
      notificationId: 'ntf_1',
      tag: 'request-stage:req_1:3',
      kind: 'info',
      progress: 0.6,
      stageLabel: 'بررسی کارشناس',
    });
    expect(message.message.token).toBe('device-token-1234567890');
    for (const [key, value] of Object.entries(message.message.data)) {
      expect(typeof value, `data.${key} must be a string`).toBe('string');
    }
    expect(message.message.data.progress).toBe('60');
    expect(message.message.data.link).toBe('/app/requests/req_1');
    // Collapsing is what makes stage 4 replace stage 3 instead of stacking.
    expect(message.message.android.collapse_key).toBe('pishkan:request-stage:req_1:3');
  });

  it('omits progress when there is none instead of sending a fake 0%', () => {
    const message: any = buildMessage('token-abcdefghijklmnop', { title: 't', body: 'b' });
    expect(message.message.data.progress).toBe('');
    expect(message.message.data.kind).toBe('info');
    expect(message.message.android.collapse_key).toBeUndefined();
  });

  it('keeps announcements at normal priority so they do not wake a sleeping phone', () => {
    const message: any = buildMessage('token-abcdefghijklmnop', { title: 'اطلاعیه', body: 'b', kind: 'info' });
    expect(message.message.android.priority).toBe('normal');
    const stage: any = buildMessage('token-abcdefghijklmnop', { title: 't', body: 'b', tag: 'request-stage:r:2' });
    expect(stage.message.android.priority).toBe('high');
  });

  // The test above only exercised `info` *without* a tag, which production
  // never sends: notifications/service.ts always supplies one. That made it
  // pass against a condition (`kind === 'info' && !tag`) whose second half was
  // therefore always false, so every routine notice was actually pushed as
  // `high`. These cases use the shape the server really sends.
  it('keeps a routine notice at normal priority even though it carries a tag', () => {
    const message: any = buildMessage('token-abcdefghijklmnop', {
      title: 'یادآوری', body: 'b', kind: 'info', tag: 'notice:abc',
    });
    expect(message.message.android.priority).toBe('normal');
  });

  it('still wakes the device for time-critical kinds that carry a tag', () => {
    for (const kind of ['stage', 'success', 'warning', 'error', 'action']) {
      const message: any = buildMessage('token-abcdefghijklmnop', {
        title: 't', body: 'b', kind, tag: `k:${kind}`,
      });
      expect(message.message.android.priority).toBe('high');
    }
  });
});
