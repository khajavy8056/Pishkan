/**
 * Where a notice is delivered, and where tapping it lands.
 *
 * Two separate bugs lived here, both reported by the office:
 *  - an event that produced a bell row produced no browser notification, because
 *    the Web Push call sat behind a `push: true` flag only four flows set;
 *  - the notifications that did arrive opened the home page, because the link
 *    was `/`, or a machine pointer (`chat:<id>`) that the browser was handed
 *    verbatim.
 *
 * The push transport is replaced by a recorder, so what is asserted is exactly
 * what would have gone over the wire: the audience and the destination.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { notifyUser } from '../src/modules/notifications/service.js';

const sent = vi.hoisted(() => [] as { userIds: string[]; payload: Record<string, any> }[]);

vi.mock('../src/modules/notifications/push.js', () => ({
  sendPushToUsers: vi.fn(async (userIds: string[], payload: Record<string, any>) => {
    sent.push({ userIds, payload });
    return { sent: userIds.length };
  }),
  pushPublicKey: vi.fn(async () => ({ enabled: true, publicKey: 'test' })),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
  pushSubscriptionCount: vi.fn(async () => 1),
  ensureVapidKeys: vi.fn(async () => ({ publicKey: 'a', privateKey: 'b' })),
}));

let server: Awaited<ReturnType<typeof app>>;
let adminId = '';

async function notify(input: Record<string, any>) {
  sent.length = 0;
  await notifyUser(adminId, { ...input, push: true });
  return { userId: adminId, push: sent[0]?.payload };
}

/** Like a real event: the caller asked for a notice, nothing more. */
async function notifyPlain(input: Record<string, any>) {
  sent.length = 0;
  await notifyUser(adminId, input);
  return { userId: adminId, push: sent[0]?.payload };
}

beforeAll(async () => {
  server = await app();
  const admin = await adminSession();
  const me = await request(server).get('/api/auth/me').set('Cookie', admin.cookie).expect(200);
  adminId = me.body.data.id;
  // The browser channel has its own switch, off by default in a fresh install.
  await updateSettings({ 'sms.push_enabled': true }, { id: 'test', name: 'delivery' });
});

beforeEach(() => {
  sent.length = 0;
});

describe('notification delivery', () => {
  it('sends the browser notification for a notice that never asked for one', async () => {
    const { push } = await notifyPlain({
      title: 'پیام جدید مشتری', body: 'یک پیام تازه دارید.', kind: 'info',
      link: '/staff/messages/thr_one', eventType: 'message',
      idempotencyKey: `delivery-message:${Date.now()}`,
    });
    expect(push, 'a bell row without push:true used to stop at the bell').toBeTruthy();
    expect(push.title).toBe('پیام جدید مشتری');
    // The conversation itself — not `/`, not the queue, not the home page.
    expect(push.url).toBe('/staff/messages/thr_one');
  });

  it('turns a support pointer into the URL that opens that ticket', async () => {
    const { push } = await notifyPlain({
      title: 'پاسخ پشتیبانی', body: 'تیکت شما پاسخ داده شد.', kind: 'success',
      link: 'chat:tk_42', eventType: 'support',
      idempotencyKey: `delivery-chat:${Date.now()}`,
    });
    expect(push.url).toBe('/admin?chat=tk_42');
  });

  it('falls back to the section the event belongs to, never to the landing page', async () => {
    const message = await notifyPlain({ title: 'ت', body: 'ب', link: '', eventType: 'message', idempotencyKey: `delivery-a:${Date.now()}` });
    expect(message.push.url).toBe('/admin/messages');
    // The admin panel has no /admin/documents and no /admin/accounting; sending
    // one there is a 404, which is the other shape of "the destination is wrong".
    const invoice = await notifyPlain({ title: 'ت', body: 'ب', link: '', eventType: 'invoice', idempotencyKey: `delivery-b:${Date.now()}` });
    expect(invoice.push.url).toBe('/admin/finance');
    const document = await notifyPlain({ title: 'ت', body: 'ب', link: '', eventType: 'document_submitted', idempotencyKey: `delivery-d:${Date.now()}` });
    expect(document.push.url).toBe('/admin/requests');
    const bare = await notifyPlain({ title: 'ت', body: 'ب', eventType: 'info', idempotencyKey: `delivery-c:${Date.now()}` });
    // Nothing to point at: the panel of the recipient, which is still a place
    // where the notice can be acted on — not the marketing home page.
    expect(bare.push.url).toBe('/admin');
  });

  it('does not deliver twice for a repeated event', async () => {
    const key = `delivery-dedupe:${Date.now()}`;
    const first = await notifyPlain({ title: 'ت', body: 'ب', link: '/staff/requests/req_1', eventType: 'request', idempotencyKey: key });
    expect(first.push).toBeTruthy();
    const second = await notifyPlain({ title: 'ت', body: 'ب', link: '/staff/requests/req_1', eventType: 'request', idempotencyKey: key });
    expect(second.push, 'a duplicate idempotency key must not buzz the device again').toBeUndefined();
  });
});
