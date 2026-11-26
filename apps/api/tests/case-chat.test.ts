/**
 * A conversation about a case, tied to that case in both directions.
 *
 * Reported failure: the employee who owns a case opened «گفت‌وگو» from it and
 * landed in a chat where nothing identified the case — no tracking code, no way
 * back — and the customer was never told the office had written to them. The
 * tests below pin the whole loop: the thread is found-or-created per case, named
 * after it, owned by whoever opened it, rendered with its case reference, and
 * each side's message notifies the right human with a link that opens the
 * conversation itself (not the panel's home page).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';
import { run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { toPersianDigits } from '../src/lib/text.js';

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let expert: any;
let outsider: any;
let expertId = '';
let outsiderId = '';
let serviceId = '';
let requestId = '';
let trackingCode = '';

async function notificationsFor(session: { cookie: string[] }) {
  const res = await request(server).get('/api/customers/me/notifications?limit=50').set('Cookie', session.cookie);
  expect(res.status).toBe(200);
  return res.body.data as { id: string; title: string; link: string | null; eventType: string | null }[];
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  expert = await createStaff('service_expert', { username: 'chat_expert', password: 'Chat#Expert1', fullName: 'کارشناس گفت‌وگو' });
  outsider = await createStaff('service_expert', { username: 'chat_outsider', password: 'Chat#Outer1', fullName: 'کارشناس دیگر' });
  expertId = (await request(server).get('/api/auth/me').set('Cookie', expert.cookie)).body.data.id;
  outsiderId = (await request(server).get('/api/auth/me').set('Cookie', outsider.cookie)).body.data.id;
  // A dedicated service with no documents and no automatic assignment, so the
  // case is unclaimed until this test claims it.
  await updateSettings({ 'services.auto_assign': false, 'workforce.auto_assign_on_shift': false }, { id: 'test', name: 'case-chat' });
  const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie)
    .send({ title: 'خدمت گفت‌وگوی پرونده', baseFee: 20000, form: [] });
  expect(service.status).toBe(201);
  serviceId = service.body.data.id;
});

describe('case-linked chat', () => {
  it('creates the case, assigns it to the expert', async () => {
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId, formData: {}, paymentMethod: 'online' });
    expect(created.status).toBe(201);
    requestId = created.body.data.id;
    trackingCode = created.body.data.trackingCode;
    await run('UPDATE requests SET assigned_to = ? WHERE id = ?', [expertId, requestId]);
  });

  it('opens the case conversation with the case named and the opener as owner', async () => {
    const opened = await request(server).post('/api/messages/threads').set('Cookie', expert.cookie)
      .send({ requestId });
    expect(opened.status).toBe(201);
    expect(opened.body.data.request).toMatchObject({ id: requestId, trackingCode });
    const threadId = opened.body.data.id;

    const list = await request(server).get('/api/messages/threads').set('Cookie', expert.cookie);
    const thread = list.body.data.find((t: any) => t.id === threadId);
    expect(thread, 'the thread must be in the office list').toBeTruthy();
    // The subject identifies the file instead of saying «درباره پرونده».
    expect(thread.subject).toContain(toPersianDigits(trackingCode));
    expect(thread.request).toMatchObject({ id: requestId, trackingCode, status: expect.any(String) });
    // Opening it again is the same conversation, never a second one.
    const again = await request(server).post('/api/messages/threads').set('Cookie', expert.cookie)
      .send({ requestId });
    expect(again.body.data.id).toBe(threadId);
    expect(again.body.data.existing).toBe(true);
  });

  it('tells the customer the office wrote, with a link that opens the chat', async () => {
    const notices = await notificationsFor(customer);
    const notice = notices.find((n) => n.link?.startsWith('/app/messages/'));
    expect(notice, 'the customer must be notified that the office opened a chat').toBeTruthy();
    expect(notice.link).toContain('/app/messages/');
    expect(notice.title).toContain(toPersianDigits(trackingCode));
    expect(notice.eventType).toBe('message');
  });

  it('routes the customer reply to whoever works the case, not to nobody', async () => {
    const before = await notificationsFor(expert);
    const threadId = (await request(server).get('/api/messages/threads').set('Cookie', expert.cookie))
      .body.data.find((t: any) => t.requestId === requestId).id;
    const sent = await request(server).post(`/api/messages/threads/${threadId}/messages`).set('Cookie', customer.cookie)
      .send({ body: 'مدارک را آپلود کردم؛ چیزی لازم است؟' });
    expect(sent.status).toBe(201);

    const after = await notificationsFor(expert);
    const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
    const notice = fresh.find((n) => n.title.includes('پیام جدید مشتری'));
    expect(notice, 'the assigned expert must hear about the reply').toBeTruthy();
    // The destination is the conversation, in the panel of the person reading it.
    expect(notice.link).toBe(`/staff/messages/${threadId}`);
  });

  it('keeps a case conversation out of the reach of staff who do not own it', async () => {
    const threadId = (await request(server).get('/api/messages/threads').set('Cookie', expert.cookie))
      .body.data.find((t: any) => t.requestId === requestId).id;
    const blocked = await request(server).get(`/api/messages/threads/${threadId}`).set('Cookie', outsider.cookie);
    expect(blocked.status).toBe(403);
    // …while the office manager, who owns the whole office, may read it.
    const allowed = await request(server).get(`/api/messages/threads/${threadId}`).set('Cookie', admin.cookie);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.thread.request.id).toBe(requestId);
  });

  it('serves an incremental sync and typing presence, which the app polls', async () => {
    const threadId = (await request(server).get('/api/messages/threads').set('Cookie', expert.cookie))
      .body.data.find((t: any) => t.requestId === requestId).id;
    const empty = await request(server).get(`/api/messages/threads/${threadId}/sync`).set('Cookie', expert.cookie)
      .query({ after: new Date().toISOString() });
    expect(empty.status).toBe(200);
    expect(empty.body.data.messages).toHaveLength(0);
    expect(empty.body.data.typing).toBe(false);

    const full = await request(server).get(`/api/messages/threads/${threadId}/sync`).set('Cookie', expert.cookie);
    expect(full.status).toBe(200);
    expect(full.body.data.messages.some((m: any) => m.body.includes('مدارک را آپلود'))).toBe(true);

    await request(server).post(`/api/messages/threads/${threadId}/typing`).set('Cookie', customer.cookie)
      .send({ typing: true }).expect(200);
    const withTyping = await request(server).get(`/api/messages/threads/${threadId}/sync`).set('Cookie', expert.cookie);
    expect(withTyping.body.data.typing).toBe(true);
    // The typing party never sees its own indicator.
    const self = await request(server).get(`/api/messages/threads/${threadId}/sync`).set('Cookie', customer.cookie);
    expect(self.body.data.typing).toBe(false);
  });

  it('a reply from an unassigned thread reaches the office roles instead of vanishing', async () => {
    const general = await request(server).post('/api/messages/threads').set('Cookie', customer.cookie)
      .send({ subject: 'سؤال عمومی', message: 'سؤال عمومی' });
    expect(general.status).toBe(201);
    const threadId = general.body.data.id;
    const adminNotices = await notificationsFor(admin);
    expect(adminNotices.some((n) => n.link === `/admin/messages/${threadId}`)).toBe(true);
  });
});
