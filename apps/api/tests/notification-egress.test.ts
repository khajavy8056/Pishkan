import fs from 'node:fs/promises';
import { one, run } from '../src/db/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, adminSession, app } from './helpers.js';
import { CHANNELS } from '../src/modules/notifications/delivery.js';

/**
 * Closure: what is able to leave the server at all.
 *
 * «چطور مطمئن شوم که ارسال انجام می‌شود؟» has two halves. One is proof that the
 * channels we do have really deliver — that is `notification-channels.test.ts`,
 * which drives notices through the real `notifyUser`, the ledger, the retries and
 * the routes. This file is the other half, the one nobody can answer from memory:
 * **is the list complete**, in both directions.
 *
 *  * A seventh sender appearing without the ledger knowing is how a customer gets
 *    the same notice three times, or gets one that is never marked delivered and
 *    so is retried forever.
 *  * A channel that exists only as settings fields — which is exactly what the
 *    eleven `email.*` keys were — is worse than an absent one, because the office
 *    sees «ایمیل هنگام ثبت درخواست جدید: روشن» and stops looking.
 *
 * The scans below are deliberately textual (this is a property of the source
 * tree, and the tree is the thing we want to keep honest). Each one fails with the
 * name of the file to go look at.
 */
const SRC = path.resolve(fileURLToPath(import.meta.url), '../../src');
const NOTIFY_DIR = path.join(SRC, 'modules/notifications');

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await tsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** A call that puts bytes on a socket to somebody else's server. */
const EGRESS = /\bfetch\s*\(|https?\.(request|get)\s*\(|\.sendNotification\s*\(|createConnection|net\.connect|tls\.connect/;

describe('the delivery channel set is closed', () => {
  it('is exactly the six the ledger writes acks for', () => {
    // live (our own socket), fcm, web (VAPID), relay (a purchased gateway),
    // poll (the client pulling its list) and sms — escalation, never a fourth
    // simultaneous copy. Sorted, so a seventh is a decision and not a typo.
    expect([...CHANNELS].sort()).toEqual(['fcm', 'live', 'poll', 'relay', 'sms', 'web']);
  });

  it('adds no sender inside the notifications module beyond those channels', async () => {
    const allowed = new Set(['fcm.ts', 'relay.ts', 'push.ts']);
    const offenders: string[] = [];
    for (const file of await tsFiles(NOTIFY_DIR)) {
      const text = await fs.readFile(file, 'utf8');
      if (EGRESS.test(text) && !allowed.has(path.basename(file))) offenders.push(path.basename(file));
    }
    expect(offenders, `unexpected senders: ${offenders.join(', ')}`).toEqual([]);
  });

  it('sends nothing through a path the ledger cannot see', async () => {
    // `delivered_at` is only ever set from an ack row, so if a sender started
    // marking delivery itself the "reached the person" flag would stop meaning
    // "a device said so". This greps for exactly that shortcut.
    // `delivery.ts` is the single writer on purpose — it stamps `delivered_at` inside
    // the same transaction that records the ack, which is the only thing that makes
    // the flag mean "a device said so". Any other file touching it is the bug.
    const files = (await tsFiles(NOTIFY_DIR)).filter((file) => path.basename(file) !== 'delivery.ts');
    const setters: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(/UPDATE notifications[\s\S]{0,120}?SET[^\n]*/g)) {
        if (/delivered_at\s*=/.test(match[0]) && !/delivered_at\s*=\s*COALESCE/.test(match[0])) {
          setters.push(`${path.basename(file)}: ${match[0].replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(setters, `delivered_at written outside the ack path:\n${setters.join('\n')}`).toEqual([]);
  });

  it('keeps every unwired settings group labelled as unwired', async () => {
    const definitionsPath = path.join(SRC, 'modules/settings/definitions.ts');
    const definitions = await fs.readFile(definitionsPath, 'utf8');
    const readKeys = new Set<string>();
    for (const file of (await tsFiles(SRC)).filter((item) => path.resolve(item) !== definitionsPath)) {
      const text = await fs.readFile(file, 'utf8');
      for (const hit of text.matchAll(/['"](email\.[a-z_]+)['"]/g)) readKeys.add(hit[1]);
    }
    const keys = [...definitions.matchAll(/key: '(email\.[a-z_]+)'/g)].map((match) => match[1]);
    expect(keys.length, 'the email section changed shape; update this check').toBeGreaterThan(5);

    for (const key of keys) {
      const at = definitions.indexOf(`key: '${key}'`);
      const block = definitions.slice(at, at + 700);
      const marked = /EMAIL_UNWIRED|ارسال نمی‌شود|اکنون استفاده نمی‌شود|وصل نیست/.test(block);
      // Two directions, one rule: a key nothing reads has to be labelled as such,
      // and a key that gained a real consumer has to lose the label in the same
      // change (otherwise the panel lies in the other direction).
      if (readKeys.has(key)) {
        expect(marked, `${key} is read by code now — remove the unwired label, and add it to CHANNELS if it delivers`).toBe(false);
      } else {
        expect(marked, `${key} is read by nothing, so the panel has to say so`).toBe(true);
      }
    }
  });

  it('answers the panel with the same list, and with no email half', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).get('/api/notifications/status').set('cookie', admin.cookie).expect(200);
    const policy = res.body.data.policy ?? res.body.data;
    for (const flag of ['liveEnabled', 'fcmEnabled', 'webPushEnabled', 'relayEnabled', 'smsFallbackEnabled']) {
      expect(typeof policy[flag], `${flag} must be reported, not assumed`).toBe('boolean');
    }
    expect(policy).not.toHaveProperty('emailEnabled');
  });
});

describe('the self-test endpoint', () => {
  it('proves a send through the real path, and lets a device confirm it', async () => {
    const server = await app();
    const admin = await adminSession();
    const adminId = await userIdOf(ADMIN.username);
    await clearTestNotices(adminId);

    const res = await request(server).post('/api/notifications/test').set('cookie', admin.cookie).expect(200);
    expect(res.body.data.attempted).toBe(true);
    const notificationId: string = res.body.data.notificationId;
    expect(notificationId).toBeTruthy();
    expect(res.body.data.status).toHaveProperty('waiting');

    // Nothing is claimed as delivered here — no device is registered in the test
    // database, so the honest answer at this point is "unconfirmed".
    expect(res.body.data.confirmed).toBe(false);
    expect(res.body.data.note).toContain('تأیید');

    // A client that receives it files an ack, and the same test then reports the
    // confirmation. That is what makes the endpoint a test rather than a log line.
    await request(server).post('/api/notifications/ack')
      .set('cookie', admin.cookie)
      .send({ ids: [notificationId], channel: 'live' })
      .expect(200);
    const row = await one<{ delivered_at: string | null }>(
      'SELECT delivered_at FROM notifications WHERE id = ?', [notificationId],
    );
    expect(row?.delivered_at).toBeTruthy();
  });

  it('reaches only the caller', async () => {
    const server = await app();
    const admin = await adminSession();
    const adminId = await userIdOf(ADMIN.username);
    await clearTestNotices(adminId);
    const otherId = await one<{ id: string }>(
      "SELECT id FROM users WHERE id <> ? AND kind = 'customer' LIMIT 1", [adminId],
    ).then((row) => row?.id ?? null);
    const before = await countFor(adminId);
    const res = await request(server).post('/api/notifications/test').set('cookie', admin.cookie).expect(200);
    expect(await countFor(adminId)).toBe(before + 1);
    // The notice exists for the caller and for nobody else; there is no user id in
    // the body to aim it at, which is the actual guarantee.
    const target = String(res.body.data.notificationId);
    const seen = await one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE id = ? AND user_id = ?', [target, adminId],
    );
    expect(Number(seen?.n ?? 0)).toBe(1);
    if (otherId) {
      const leaked = await one<{ n: number }>(
        'SELECT COUNT(*) AS n FROM notifications WHERE id = ? AND user_id = ?', [target, otherId],
      );
      expect(Number(leaked?.n ?? 0)).toBe(0);
    }

    // Two presses in the same second would otherwise mint two notices and, with
    // FCM on, two batches of device messages — the endpoint says no instead.
    const throttled = await request(server).post('/api/notifications/test').set('cookie', admin.cookie);
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.message).toContain('ده ثانیه');

    // Unauthenticated callers get nothing at all.
    expect((await request(server).post('/api/notifications/test')).status).toBe(401);
  });
});

async function userIdOf(username: string): Promise<string> {
  const row = await one<{ id: string }>('SELECT id FROM users WHERE username = ?', [username]);
  if (!row) throw new Error(`no such test user: ${username}`);
  return row.id;
}

async function countFor(userId: string): Promise<number> {
  const row = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND event_type = 'notification.test'", [userId],
  );
  return Number(row?.n ?? 0);
}

/**
 * The endpoint is throttled per user to one call per ten seconds (see below), so
 * each test starts from a clean slate instead of depending on when the previous
 * one ran. Acks go first — they reference the notice.
 */
async function clearTestNotices(userId: string): Promise<void> {
  await run(
    `DELETE FROM notification_acks WHERE notification_id IN
       (SELECT id FROM notifications WHERE user_id = ? AND event_type = 'notification.test')`,
    [userId],
  );
  await run("DELETE FROM notifications WHERE user_id = ? AND event_type = 'notification.test'", [userId]);
}
