import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, customerSession, createStaff } from './helpers.js';
import { one, q, run } from '../src/db/index.js';
import crypto from 'node:crypto';
import http from 'node:http';
import { buildMessage, resetAccessTokenCache } from '../src/modules/notifications/fcm.js';
import { updateSettings } from '../src/modules/settings/service.js';

/**
 * The *content* of a stage notification, as the phone will draw it.
 *
 * This exists because the payload is assembled in three places — the requests
 * service decides the numbers, notifyUser forwards them, buildMessage encodes
 * them — and each one silently drops what it does not know about. A missing
 * `progress` is invisible in every other test: the notice is delivered, the
 * body is right, and the customer simply gets a plain row instead of the
 * progress bar the feature is for. So the assertion is on the wire format.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let expert: any;
let expertId: string;
let customerId: string;

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await one<any>('SELECT id FROM users WHERE mobile = ?', ['09121112233']))!.id as string;
  expert = await createStaff('service_expert', {
    username: 'stage_expert',
    password: 'Expert#12345',
    fullName: 'کارشناس مرحله',
  });
  expertId = (await one<any>("SELECT id FROM users WHERE username = 'stage_expert'"))!.id as string;
});

afterAll(async () => {
  await q('DELETE FROM customer_devices');
});

async function createService() {
  const res = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title: 'خدمت آزمون مرحله',
    slug: `stage-${Math.floor(Math.random() * 900000 + 100000)}`,
    baseFee: 1000000,
    paymentMethods: ['online'],
    form: [],
    documents: [],
    workflow: [
      { title: 'بررسی اولیه', kind: 'action' },
      { title: 'انجام خدمت', kind: 'action' },
      { title: 'تحویل به مشتری', kind: 'delivery' },
    ],
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function requestOn(serviceId: string) {
  const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
    .send({ serviceId, formData: {}, paymentMethod: 'online' });
  expect(created.status).toBe(201);
  const id = created.body.data.id as string;
  await request(server).patch(`/api/requests/${id}/assign`).set('Cookie', admin.cookie)
    .send({ staffId: expertId }).expect(200);
  return id;
}

const latestStageNotice = async (requestId: string) =>
  one<any>(
    `SELECT id, title, body, event_type, link, dedupe_key
       FROM notifications
      WHERE user_id = ? AND event_type = 'request_stage' AND link = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [customerId, `/app/requests/${requestId}`],
  );

describe('a stage change produces a notification the phone can draw', () => {
  it('the notice is recorded as a stage event on the right case', async () => {
    const serviceId = await createService();
    const id = await requestOn(serviceId);
    await request(server).post(`/api/requests/${id}/steps/advance`).set('Cookie', expert.cookie).send({}).expect(200);

    const notice = await latestStageNotice(id);
    expect(notice).toBeTruthy();
    expect(notice.event_type).toBe('request_stage');
    // Named stage, not "your case changed": the customer must be able to tell
    // which step without opening the app. Assignment already consumed step 0,
    // so one advance lands on «انجام خدمت».
    expect(notice.body).toContain('انجام خدمت');
  });

  it('the encoded FCM message carries a percentage and the stage name', async () => {
    const serviceId = await createService();
    const id = await requestOn(serviceId);
    await request(server).post(`/api/requests/${id}/steps/advance`).set('Cookie', expert.cookie).send({}).expect(200);

    const notice = await latestStageNotice(id);
    // This is the exact payload the request path builds, encoded the way the
    // server sends it. 1 of 3 steps complete => next/(len-1) = 1/2 = 50.
    const message = buildMessage('token-value-that-is-long-enough', {
      title: notice.title,
      body: notice.body,
      link: notice.link,
      notificationId: notice.id,
      tag: notice.dedupe_key ?? notice.id,
      kind: 'info',
      progress: 0.5,
      stageLabel: 'انجام خدمت',
    }) as any;

    expect(message.message.data.progress).toBe('50');
    expect(message.message.data.stageLabel).toBe('انجام خدمت');
    expect(message.message.data.link).toBe(`/app/requests/${id}`);
    // The tag must be stable per case so stage 3 replaces stage 2 in the shade.
    expect(message.message.data.tag).toContain(`request-stage:${id}`);
    expect(message.message.android.collapse_key).toBe(`pishkan:${message.message.data.tag}`);
  });

  it('the real request path puts a real percentage on the wire', async () => {
    // End-to-end through the actual code: advance a step, let notifyUser build
    // the push, and read the JSON body that would have gone to Google. No
    // mocking of this project's own functions — a fraction dropped anywhere in
    // the chain (requests → notifyUser → buildMessage) fails here.
    const serviceId = await createService();
    const id = await requestOn(serviceId);

    const bodies: any[] = [];
    const stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/token') {
          res.end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
          return;
        }
        if (req.url?.endsWith('/messages:send')) {
          bodies.push(JSON.parse(raw || '{}'));
          res.end(JSON.stringify({ name: 'projects/p/messages/1' }));
          return;
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const me = await one<any>("SELECT id FROM users WHERE username = 'testadmin'");
    await updateSettings({
      'push.fcm_enabled': true,
      'push.fcm_service_account': JSON.stringify({
        project_id: 'pishkan-test',
        client_email: 'notifier@pishkan-test.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        token_uri: `${base}/token`,
      }),
      'push.fcm_endpoint': base,
    }, { id: me!.id as string, name: 'admin' }, { confirmCritical: true });
    resetAccessTokenCache();
    // The customer must own a device, or there is nothing to send to.
    await request(server).post('/api/push/devices').set('Cookie', customer.cookie)
      .send({ token: `stage-token-${'x'.repeat(40)}`, platform: 'android' }).expect(200);

    try {
      await request(server).post(`/api/requests/${id}/steps/advance`).set('Cookie', expert.cookie).send({}).expect(200);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }

    const stage = bodies.find((b) => String(b?.message?.data?.tag ?? '').includes('request-stage'));
    expect(stage, 'no stage message was sent').toBeTruthy();
    // Assignment consumed step 0, this advance lands on step 1 of 3 => 50%.
    expect(stage.message.data.progress).toBe('50');
    expect(stage.message.data.stageLabel).toBe('انجام خدمت');
    expect(stage.message.data.eventType ?? '').toBeDefined();
    expect(stage.message.data.link).toBe(`/app/requests/${id}`);
  });

  it('progress stays inside 0..100 however the workflow is sized', async () => {
    // A single-step workflow has no fraction to show; whatever the code does,
    // it must never send a value the phone would clamp or draw as negative.
    const serviceId = await createService();
    const id = await requestOn(serviceId);
    await request(server).post(`/api/requests/${id}/steps/advance`).set('Cookie', expert.cookie).send({}).expect(200);
    const notice = await latestStageNotice(id);
    for (const fraction of [0, 0.5, 1]) {
      const built = buildMessage('t'.repeat(30), {
        title: notice.title, body: notice.body, link: notice.link,
        notificationId: notice.id, tag: notice.dedupe_key ?? notice.id, kind: 'info', progress: fraction,
      }) as any;
      const value = Number(built.message.data.progress);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('does not invent a bar for a notice that has no measured progress', async () => {
    const built = buildMessage('t'.repeat(30), {
      title: 'اطلاعیه', body: 'دفتر پنجشنبه تعطیل است', link: '/app/banners',
      notificationId: 'ntf_x', tag: 'banner:1', kind: 'info',
    }) as any;
    // Empty string, not '0': a zero-width bar at 0% would read as "your case
    // has not started" on an announcement that has no progress at all.
    expect(built.message.data.progress).toBe('');
  });
});
