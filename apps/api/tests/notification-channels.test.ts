/**
 * Multi-channel delivery: the ledger, the retry rules, and the live stream.
 *
 * The complaint this feature answers is not "the text is wrong" but "nothing
 * arrived" — and the only way to fix that honestly is for the server to know
 * which notices a device actually confirmed. Every test below is about that one
 * fact from a different angle:
 *
 *  - a notice is "waiting" until something acks it, and the ack from any channel
 *    stops the other channels (that is the no-duplicate rule, expressed as data);
 *  - reading the bell counts as a delivery confirmation, or the sweeper would
 *    chase a person who is reading the message right now;
 *  - retries back off and stop, and one escalation to SMS is exactly one;
 *  - an ack can never be filed for somebody else's notice;
 *  - the live stream carries the row as stored, so a device can never see
 *    different words from the two paths;
 *  - the relay channel stays off unless the office configures a gateway, and when
 *    it is on it receives one POST with the ids it needs.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import { adminSession, app, createStaff } from './helpers.js';
import { one, q, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { notifyUser, markRead } from '../src/modules/notifications/service.js';
import {
  claimEscalation, deliveryPolicy, dueForRetry, liveHub, markDelivered,
  noteAttempt, noteEscalationResult, pendingUndelivered, toLiveEvent,
} from '../src/modules/notifications/delivery.js';
import { relayConfig, relayToUsers } from '../src/modules/notifications/relay.js';

let server: Awaited<ReturnType<typeof app>>;
let adminId = '';

/** One notice, unique per call, straight through the real `notifyUser`. */
async function notice(user: string, title = 'پیرونده شما جلو رفت', extra: Record<string, any> = {}) {
  const key = `channels:${title}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  await notifyUser(user, { title, body: 'بدنهٔ آزمون', link: '/app/requests/req_x', kind: 'success', eventType: 'request', idempotencyKey: key, ...extra });
  const row = await one<{ id: string }>('SELECT id FROM notifications WHERE dedupe_key = ?', [key]);
  expect(row?.id, 'the notice must exist after notifyUser').toBeTruthy();
  return String(row!.id);
}

beforeAll(async () => {
  server = await app();
  const admin = await adminSession();
  const me = await request(server).get('/api/auth/me').set('Cookie', admin.cookie).expect(200);
  adminId = me.body.data.id;
});

describe('delivery ledger', () => {
  it('holds a notice as waiting until a device answers, then never again', async () => {
    const id = await notice(adminId, 'منتظر تأیید');
    const waiting = await pendingUndelivered(adminId, { limit: 100 });
    expect(waiting.some((item) => item.id === id), 'a fresh notice must be replayable').toBe(true);

    expect(await markDelivered(adminId, [id], 'fcm')).toEqual({ acked: 1 });
    expect((await pendingUndelivered(adminId, { limit: 100 })).some((item) => item.id === id)).toBe(false);

    // The second ack — the poll answering the same notice minutes later — must be
    // a no-op rather than a second row, or the log stops meaning "who saw it".
    expect(await markDelivered(adminId, [id], 'poll'), 'a repeat ack must not count again').toEqual({ acked: 0 });
    const rows = await q<{ channel: string }>('SELECT channel FROM notification_acks WHERE notification_id = ? ORDER BY channel', [id]);
    // Both channels are recorded — that is how an operator learns which paths
    // actually reach this phone — while the notice itself was delivered once.
    expect(rows.map((r) => r.channel)).toEqual(['fcm', 'poll']);
    const stamped = await one<{ delivered_at: string | null }>('SELECT delivered_at FROM notifications WHERE id = ?', [id]);
    expect(stamped?.delivered_at, 'the notice itself must remember when it landed').toBeTruthy();
  });

  it('ignores an ack filed for somebody else’s notice', async () => {
    const other = await createStaff('manager', { username: 'delivery-other', password: 'Other#12345', fullName: 'گیرندهٔ دیگر' });
    const me = await request(server).get('/api/auth/me').set('Cookie', other.cookie).expect(200);
    const otherId = me.body.data.id;
    const id = await notice(otherId, 'مربوط به دیگری');

    // Same shape of request a curious customer could send: the guard sits on the
    // write, not on the route, so nothing can be marked delivered for another
    // account even when the id is guessed correctly.
    const result = await markDelivered(adminId, [id], 'poll');
    expect(result.acked, 'an ack from the wrong owner must not land').toBe(0);
    const row = await one<{ delivered_at: string | null }>('SELECT delivered_at FROM notifications WHERE id = ?', [id]);
    expect(row?.delivered_at).toBeNull();

    expect((await markDelivered(otherId, [id], 'poll')).acked).toBe(1);
  });

  it('treats opening the bell as a delivery confirmation', async () => {
    const id = await notice(adminId, 'خوانده شد');
    await markRead(adminId, id);
    const row = await one<{ delivered_at: string | null }>('SELECT delivered_at FROM notifications WHERE id = ?', [id]);
    expect(row?.delivered_at, 'a notice the person read must stop being chased').toBeTruthy();
    expect((await pendingUndelivered(adminId, { limit: 100 })).some((item) => item.id === id)).toBe(false);
  });
});

describe('retry sweeper rules', () => {
  it('waits for the backoff, retries a bounded number of times, and stops on an ack', async () => {
    const id = await notice(adminId, 'بازخوانی');
    expect(await dueForRetry(100), 'a notice sent seconds ago is not due yet').toEqual(
      expect.not.arrayContaining([expect.objectContaining({ notificationId: id })]),
    );

    // Simulate "sent two minutes ago, nobody answered".
    await run('UPDATE notifications SET push_last_at = ? WHERE id = ?', [new Date(Date.now() - 5 * 60_000).toISOString(), id]);
    const due = await dueForRetry(100);
    expect(due.some((row) => row.notificationId === id), 'an unconfirmed notice must come back for a retry').toBe(true);

    await noteAttempt([id]);
    await noteAttempt([id]);
    await noteAttempt([id]);
    await run('UPDATE notifications SET push_last_at = ? WHERE id = ?', [new Date(Date.now() - 30 * 60_000).toISOString(), id]);
    expect((await dueForRetry(100)).some((row) => row.notificationId === id), 'attempts must stop at the cap').toBe(false);

    await markDelivered(adminId, [id], 'live');
    expect((await dueForRetry(100)).some((row) => row.notificationId === id)).toBe(false);
  });

  it('escalates to SMS at most once, whether the gateway answered or not', async () => {
    const id = await notice(adminId, 'پیامک پشتیبان', { kind: 'error' });
    expect(await claimEscalation(id)).toBe(true);
    expect(await claimEscalation(id), 'one text message per notice, even after a failed send').toBe(false);
    // A failed gateway must not silence the push channels…
    await noteEscalationResult(id, false);
    expect(Number((await one<{ a: number }>('SELECT push_attempts AS a FROM notifications WHERE id = ?', [id]))?.a)).toBe(0);
    // …while a successful one ends the chase.
    await noteEscalationResult(id, true);
    expect(Number((await one<{ a: number }>('SELECT push_attempts AS a FROM notifications WHERE id = ?', [id]))?.a)).toBe(99);
  });
});

describe('live stream', () => {
  it('carries the stored row to a connected client, and only once per revision', () => {
    const written: string[] = [];
    const fake = { write: (chunk: string) => { written.push(chunk); return true; }, end: () => undefined } as any;
    const release = liveHub.register('user-live', fake);
    const published = liveHub.publish('user-live', {
      id: 'ntf_live_1', title: 'زنده', body: 'متن', kind: 'info', link: '/app', eventType: null, revision: 1, createdAt: new Date().toISOString(),
    });
    expect(published).toBe(1);
    expect(liveHub.publish('user-live', {
      id: 'ntf_live_1', title: 'زنده', body: 'متن', kind: 'info', link: '/app', eventType: null, revision: 1, createdAt: new Date().toISOString(),
    }), 'a replay racing the live publish must not double-notify').toBe(0);
    expect(written.length).toBe(1);
    expect(written[0]).toContain('event: notification');
    // The frame is the row, not a paraphrase of it.
    expect(JSON.parse(written[0].split('data: ')[1].trim()).title).toBe('زنده');
    release();
    expect(liveHub.clientCount).toBe(0);
  });

  it('hands a reconnecting client the rows still unconfirmed, as stored', async () => {
    const id = await notice(adminId, 'جبرانی بعد از قطع');
    const rows = await q<any>('SELECT * FROM notifications WHERE id = ?', [id]);
    const event = toLiveEvent(rows[0]);
    expect(event.id).toBe(id);
    expect(event.link).toBe('/app/requests/req_x');
    const waiting = await pendingUndelivered(adminId, { limit: 100 });
    expect(waiting.map((item) => item.id)).toContain(id);
    await markDelivered(adminId, [id], 'live');
  });
});

describe('relay channel', () => {
  it('stays off, with a reason, until the office points it at a gateway', async () => {
    await updateSettings({ 'push.relay_enabled': false, 'push.relay_url': '' }, { id: 'test', name: 'channels' });
    const config = await relayConfig();
    expect(config.enabled).toBe(false);
    const result = await relayToUsers([adminId], { title: 'ت', body: 'ب' });
    expect(result.sent).toBe(false);
    expect(result.skipped).toMatch(/وب‌هوک|خاموش/);
  });

  it('posts one flat payload per notice when a gateway is configured', async () => {
    const received: any[] = [];
    const gateway = http.createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => { text += chunk; });
      req.on('end', () => {
        received.push({ auth: req.headers.authorization ?? '', body: JSON.parse(text || '{}') });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const port = (gateway.address() as any).port;
    try {
      await updateSettings({
        'push.relay_enabled': true,
        'push.relay_url': `http://127.0.0.1:${port}/push`,
        'push.relay_key': 'relay-test-key',
      }, { id: 'test', name: 'channels' });
      const result = await relayToUsers([adminId], { title: 'درگاه', body: 'متن', link: '/app/requests/req_y', notificationId: 'ntf_relay_1' });
      expect(result).toMatchObject({ sent: true, skipped: '', status: 200 });
      expect(received).toHaveLength(1);
      expect(received[0].auth).toBe('Bearer relay-test-key');
      expect(received[0].body).toMatchObject({ title: 'درگاه', body: 'متن', link: '/app/requests/req_y', notificationId: 'ntf_relay_1' });
      expect(received[0].body.userIds).toEqual([adminId]);
      const logged = await one<{ ok: number }>('SELECT ok FROM push_delivery_log WHERE channel = ? AND notification_id = ?', ['relay', 'ntf_relay_1']);
      expect(logged?.ok, 'the relay attempt belongs in the delivery log the admin panel reads').toBe(1);
    } finally {
      await updateSettings({ 'push.relay_enabled': false, 'push.relay_url': '' }, { id: 'test', name: 'channels' }).catch(() => undefined);
      gateway.close();
    }
  }, 20_000);
});

describe('/api/notifications', () => {
  it('requires a session on every delivery endpoint', async () => {
    await request(server).get('/api/notifications/pending').expect(401);
    await request(server).post('/api/notifications/ack').send({ ids: ['ntf_x'] }).expect(401);
    await request(server).get('/api/notifications/status').expect(401);
    await request(server).get('/api/notifications/stream').expect(401);
  });

  it('acks through the route and answers the client’s status question', async () => {
    const staff = await createStaff('manager', { username: 'delivery-caller', password: 'Caller#12345', fullName: 'فرستندهٔ آزمون' });
    const cookie = staff.cookie;
    const id = await notice(adminId, 'تأیید از مسیر');
    // Another account acking this id must not be able to deliver it.
    const rejected = await request(server).post('/api/notifications/ack').set('Cookie', cookie).send({ ids: [id], channel: 'live' }).expect(200);
    expect(rejected.body.data.acked).toBe(0);
    expect((await one<{ delivered_at: string | null }>('SELECT delivered_at FROM notifications WHERE id = ?', [id]))?.delivered_at).toBeNull();

    const me = await request(server).get('/api/auth/me').set('Cookie', cookie).expect(200);
    const own = await notice(me.body.data.id, 'تأیید خودش');
    const accepted = await request(server).post('/api/notifications/ack').set('Cookie', cookie).send({ ids: [own], channel: 'live' }).expect(200);
    expect(accepted.body.data.acked).toBe(1);

    const status = await request(server).get('/api/notifications/status').set('Cookie', cookie).expect(200);
    expect(status.body.data).toMatchObject({ liveEnabled: true, retryEnabled: true, relayEnabled: false });
    expect(typeof status.body.data.waiting).toBe('number');
    await markDelivered(adminId, [id], 'poll');
  });

  it('refuses the stream while the office has it switched off', async () => {
    const admin = await adminSession();
    await updateSettings({ 'push.live_enabled': false }, { id: 'test', name: 'channels' });
    try {
      const res = await request(server).get('/api/notifications/stream').set('Cookie', admin.cookie);
      expect(res.status).toBe(503);
      // Asserted on the body as a whole: the envelope's shape is the error
      // handler's business, and this test is about the 503 and its reason.
      expect(JSON.stringify(res.body)).toMatch(/اتصال زنده/);
    } finally {
      await updateSettings({ 'push.live_enabled': true }, { id: 'test', name: 'channels' });
    }
  });

  it('reports the channel switches it resolved', async () => {
    const policy = await deliveryPolicy();
    // The live channel is on with no credentials at all — that is the point of it.
    expect(policy.liveEnabled).toBe(true);
    expect(typeof policy.fcmEnabled).toBe('boolean');
    expect(typeof policy.webPushEnabled).toBe('boolean');
    expect(policy.liveClients).toBeGreaterThanOrEqual(0);
  });
});

describe('the collapse tag', () => {
  it('is the sender’s idempotency key, so several channels make one tray row', async () => {
    // A phone with the live connection open can render a notice at the same
    // second as FCM does. Android collapses by (tag, id), so the live event has
    // to carry the very tag `notifyUser` gave the FCM payload — the notice's
    // idempotency key. Drift here is invisible in the ledger and loud on the
    // customer's screen: every case update twice.
    const id = await notice(adminId, 'برچسب تاشو');
    const row = await one<{ dedupe_key: string }>('SELECT dedupe_key FROM notifications WHERE id = ?', [id]);
    const event = (await pendingUndelivered(adminId, { limit: 100 })).find((item) => item.id === id);
    expect(event, 'the notice must be replayable').toBeTruthy();
    expect(event!.tag).toBe(row?.dedupe_key);

    // A keyless notice falls back to its id rather than an empty tag: an empty
    // tag means "do not collapse", which stacks a column of one event.
    const orphan = `ntf-tag-${Math.random().toString(36).slice(2)}`;
    await run(
      'INSERT INTO notifications (id, user_id, title, created_at) VALUES (?, ?, ?, ?)',
      [orphan, adminId, 'بی‌کلید', new Date().toISOString()],
    );
    const bare = await one<any>('SELECT * FROM notifications WHERE id = ?', [orphan]);
    expect(toLiveEvent(bare).tag).toBe(orphan);
    // Bounded, because the tag is also an OS field some vendors dislike long.
    expect(toLiveEvent({ ...bare, dedupe_key: 'x'.repeat(400) }).tag.length).toBeLessThanOrEqual(120);
  });
});
