/**
 * What the office is told about.
 *
 * Staff notifications were incomplete in two different ways, and both were
 * reported as «نوتیفیکیشن‌ها کامل نیستند»: some events produced no notice at all
 * (a case released back to the free pool, a document a customer uploaded onto a
 * case under review), and the notices that did exist were delivered to the bell
 * only — the browser channel was gated behind a `push: true` flag that had been
 * written for one feature and never extended. These tests pin both halves: the
 * event reaches the right human, with a link that opens the thing itself.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';
import { one } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let customerId = '';
let expert: any;
let expertId = '';
let serviceId = '';
let requestId = '';
let trackingCode = '';

async function notificationsOf(session: { cookie: string[] }) {
  const res = await request(server).get('/api/customers/me/notifications?limit=80').set('Cookie', session.cookie);
  expect(res.status).toBe(200);
  return res.body.data as { id: string; title: string; link: string | null; eventType: string | null }[];
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  expert = await createStaff('service_expert', { username: 'notify_expert', password: 'Notify#Exp1', fullName: 'کارشناس اعلان' });
  expertId = (await request(server).get('/api/auth/me').set('Cookie', expert.cookie)).body.data.id;
  // Deterministic pool: nobody is auto-assigned, presence is not required, and
  // this one service is offered to exactly one employee.
  await updateSettings({
    'services.auto_assign': false,
    'workforce.auto_assign_on_shift': false,
    'sms.notify_enabled': false,
  }, { id: 'test', name: 'staff-notifications' });
  const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie)
    .send({ title: 'خدمت اعلان کارکنان', baseFee: 30000, form: [] });
  expect(service.status).toBe(201);
  serviceId = service.body.data.id;
  await request(server).put(`/api/staff/meta/service-assignments/${serviceId}`).set('Cookie', admin.cookie)
    .send({ staffIds: [expertId], strategy: 'queue' }).expect(200);
  const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
    .send({ serviceId, formData: {}, paymentMethod: 'online' });
  expect(created.status).toBe(201);
  requestId = created.body.data.id;
  trackingCode = created.body.data.trackingCode;
});

describe('staff notifications', () => {
  it('tells an employee when a case is handed to them', async () => {
    const before = await notificationsOf(expert);
    await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie)
      .send({ staffId: expertId }).expect(200);
    const after = await notificationsOf(expert);
    const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
    const notice = fresh.find((n) => n.title.includes('ارجاع شد'));
    expect(notice, 'assignment must reach the assignee').toBeTruthy();
    // Not the queue, not the home page: the case itself.
    expect(notice.link).toBe(`/staff/requests/${requestId}`);
  });

  it('announces a case that comes back to the free pool, and not to the actor', async () => {
    const beforeExpert = await notificationsOf(expert);
    const beforeAdmin = await notificationsOf(admin);
    await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie)
      .send({ staffId: null }).expect(200);

    const expertNotices = (await notificationsOf(expert)).filter((n) => !beforeExpert.some((b) => b.id === n.id));
    const pool = expertNotices.find((n) => n.title.includes('صف آزاد'));
    expect(pool, 'whoever can claim the case must be told it is free').toBeTruthy();
    expect(pool.link).toBe('/staff/queue');
    expect(pool.eventType).toBe('assignment');

    // The manager who released it does not get a copy of their own action.
    const adminNotices = (await notificationsOf(admin)).filter((n) => !beforeAdmin.some((b) => b.id === n.id));
    expect(adminNotices.some((n) => n.title.includes('ارجاع شد'))).toBe(false);
    expect(adminNotices.some((n) => n.title.includes('بدون مسئول'))).toBe(false);
  });

  it('notifies the assignee when someone else moves their case', async () => {
    await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie)
      .send({ staffId: expertId }).expect(200);
    const before = await notificationsOf(expert);
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie)
      .send({ status: 'waiting_documents' }).expect(200);
    const fresh = (await notificationsOf(expert)).filter((n) => !before.some((b) => b.id === n.id));
    const notice = fresh.find((n) => n.title.includes('وضعیت پروندهٔ شما تغییر کرد'));
    expect(notice, 'the person holding the case must hear about a move they did not make').toBeTruthy();
    expect(notice.link).toBe(`/staff/requests/${requestId}`);
  });

  it('never repeats the same event for one person', async () => {
    const before = await one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND dedupe_key LIKE 'request-status:%'`, [expertId],
    );
    // Re-sending the identical transition (the office double-clicks, a client
    // retries) must not stack a second notice.
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie)
      .send({ status: 'waiting_documents' }).expect(200);
    const after = await one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND dedupe_key LIKE 'request-status:%'`, [expertId],
    );
    expect(Number(after?.c ?? 0)).toBe(Number(before?.c ?? 0));
  });

  it('points a customer message at the conversation, not at a panel home page', async () => {
    const opened = await request(server).post('/api/messages/threads').set('Cookie', expert.cookie)
      .send({ requestId }).expect(201);
    const threadId = opened.body.data.id;
    await request(server).post(`/api/messages/threads/${threadId}/messages`).set('Cookie', customer.cookie)
      .send({ body: 'یک سؤال دیگر دارم.' }).expect(201);
    const notice = (await notificationsOf(expert)).find((n) => n.link === `/staff/messages/${threadId}`);
    expect(notice, 'the reply must carry a link to that very conversation').toBeTruthy();
    // `/staff/messages/<id>` is a route the panel really registers (asserted in
    // apps/web/tests/notification-routes.test.tsx, where the router lives), and
    // the API can read the same conversation back at that id.
    const read = await request(server).get(`/api/messages/threads/${threadId}`).set('Cookie', expert.cookie);
    expect(read.status).toBe(200);
    expect(read.body.data.thread.id).toBe(threadId);
    expect(read.body.data.thread.request.id).toBe(requestId);
  });
});

