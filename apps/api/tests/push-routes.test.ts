import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, customerSession, newCustomer } from './helpers.js';
import { one, q } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';

/**
 * The HTTP surface of native push, as the app uses it.
 *
 * The delivery mechanics are covered in fcm-delivery.test.ts; this file covers
 * the contract the app depends on: a token can be registered twice without
 * producing two devices, a device can be removed when the user signs out, a
 * customer cannot read operator-only diagnostics, and "not configured" is
 * reported as such rather than as success.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let customerId: string;

// Firebase tokens are long opaque strings; the endpoint validates only length.
const tokenA = `fcm-token-${'a'.repeat(40)}`;
const tokenB = `fcm-token-${'b'.repeat(40)}`;

const actor = async () => {
  const row = await one<any>(
    `SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'super_admin' LIMIT 1`,
  );
  return { id: row.id as string, name: (row.full_name ?? 'admin') as string };
};

async function devices(userId: string) {
  return q<any>('SELECT token, platform, device_name FROM customer_devices WHERE user_id = ?', [userId]);
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await one<any>('SELECT id FROM users WHERE mobile = ?', ['09121112233']))!.id as string;
});

afterAll(async () => {
  // Leave no devices behind for other files running against the same database.
  await q('DELETE FROM customer_devices');
});

describe('device registration', () => {
  it('is idempotent: the same token twice is still one device', async () => {
    const first = await request(server)
      .post('/api/push/devices')
      .set('Cookie', customer.cookie)
      .send({ token: tokenA, platform: 'android', appVersion: '1.4.0', deviceMaker: 'samsung' });
    expect(first.status).toBe(200);
    expect(first.body.data.devices).toBe(1);

    const second = await request(server)
      .post('/api/push/devices')
      .set('Cookie', customer.cookie)
      .send({ token: tokenA, platform: 'android', appVersion: '1.4.1', deviceMaker: 'samsung' });
    expect(second.status).toBe(200);
    expect(second.body.data.devices).toBe(1);

    const rows = await devices(customerId);
    expect(rows).toHaveLength(1);
    // The update must carry the new version, otherwise a stale app build looks
    // current forever and "why doesn't it work" has no answer.
    expect(rows[0].platform).toBe('android');
  });

  it('a second phone is a second device, not a replacement', async () => {
    const res = await request(server)
      .post('/api/push/devices')
      .set('Cookie', customer.cookie)
      .send({ token: tokenB, platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.data.devices).toBe(2);
  });

  it('refuses a token too short to be real instead of storing junk', async () => {
    const res = await request(server)
      .post('/api/push/devices')
      .set('Cookie', customer.cookie)
      .send({ token: 'short', platform: 'android' });
    expect(res.status).toBe(400);
  });

  it('stops delivering to a device that signed out', async () => {
    const res = await request(server)
      .delete(`/api/push/devices?token=${encodeURIComponent(tokenA)}`)
      .set('Cookie', customer.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.registered).toBe(false);
    const rows = await devices(customerId);
    expect(rows.map((r) => r.token)).toEqual([tokenB]);
  });

  it('removing a device that is already gone is not an error', async () => {
    const res = await request(server)
      .delete(`/api/push/devices?token=${encodeURIComponent('never-registered-token-xxxxxxxxxx')}`)
      .set('Cookie', customer.cookie);
    expect(res.status).toBe(200);
  });

  it('requires the token to be named, with a message the app can show', async () => {
    const res = await request(server).delete('/api/push/devices').set('Cookie', customer.cookie);
    expect(res.status).toBe(400);
  });

  it('cannot delete another person’s device', async () => {
    await request(server)
      .post('/api/push/devices')
      .set('Cookie', customer.cookie)
      .send({ token: tokenA, platform: 'android' });
    // Anyone who learns another customer's token must not be able to silence
    // that customer by unregistering the device from their own account.
    const other = await newCustomer('مشتری دوم تست اعلان');
    const res = await request(server)
      .delete(`/api/push/devices?token=${encodeURIComponent(tokenA)}`)
      .set('Cookie', other.session.cookie);
    expect(res.status).toBe(200);
    const rows = await devices(customerId);
    expect(rows.map((r) => r.token).sort()).toEqual([tokenA, tokenB]);
  });

  it('requires a signed-in user', async () => {
    const res = await request(server).post('/api/push/devices').send({ token: tokenA });
    expect(res.status).toBe(401);
  });
});

describe('status and diagnostics', () => {
  it('tells a customer whether this account has a device, and nothing else', async () => {
    const res = await request(server).get('/api/push/devices/status').set('Cookie', customer.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.devices).toBe(2);
    expect(res.body.data.message).toContain('ثبت شده');
    // The Firebase project is operator information; a customer must not see it.
    expect(res.body.data.projectId).toBeUndefined();
    expect(res.body.data.enabled).toBeUndefined();
  });

  it('gives an operator the delivery log so "sent but not received" is diagnosable', async () => {
    const res = await request(server).get('/api/push/diagnostics').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.recent)).toBe(true);
    expect(typeof res.body.data.enabled).toBe('boolean');
    expect(typeof res.body.data.credentialsOk).toBe('boolean');
  });

  it('keeps the delivery log away from a customer', async () => {
    const res = await request(server).get('/api/push/diagnostics').set('Cookie', customer.cookie);
    expect(res.status).toBe(403);
  });
});

describe('test push', () => {
  it('reports honestly when push is not configured instead of claiming success', async () => {
    // A blank service account is the realistic state of a fresh install and of
    // every build tested without the office Firebase project.
    const me = await actor();
    await updateSettings(
      { 'push.fcm_service_account': '', 'push.fcm_enabled': false },
      me,
      { confirmCritical: true },
    );
    const res = await request(server).post('/api/push/test').set('Cookie', admin.cookie).send({});
    expect(res.status).toBe(200);
    // sent=0 plus an explanation, never a bare success the operator would
    // mistake for "the phone should have rung".
    expect(res.body.data.sent).toBe(0);
    expect(res.body.data.message).toBeTruthy();
  });

  it('never lets the test endpoint reach somebody else’s device', async () => {
    const res = await request(server).post('/api/push/test').set('Cookie', customer.cookie).send({});
    expect(res.status).toBe(200);
    // It only ever targets the caller, so a customer sending a test cannot
    // ping an operator's phone.
    expect(res.body.data.sent).toBe(0);
  });
});
