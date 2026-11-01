import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool } from '../settings/service.js';

/**
 * Web Push for staff devices ("a new case just landed in the free queue").
 *
 * Everything here is best-effort by design: a missing push service or a stale
 * subscription must never break the business flow that triggered it. The
 * VAPID key pair is generated once per installation and kept in the database;
 * subscriptions are per device and pruned when the push service says they
 * are gone (404/410).
 */

let webpushCache: any | null = null;
async function webpush() {
  if (!webpushCache) {
    const mod: any = await import('web-push');
    webpushCache = mod.default ?? mod;
  }
  return webpushCache;
}

let keysCache: { publicKey: string; privateKey: string } | null = null;

export async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (keysCache) return keysCache;
  const existing = await one<any>('SELECT public_key, private_key FROM push_config WHERE id = 1');
  if (existing) {
    keysCache = { publicKey: existing.public_key, privateKey: existing.private_key };
    return keysCache;
  }
  const wp = await webpush();
  const generated = wp.generateVAPIDKeys();
  await run(
    'INSERT INTO push_config (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    [generated.publicKey, generated.privateKey, nowIso()],
  );
  const stored = await one<any>('SELECT public_key, private_key FROM push_config WHERE id = 1');
  keysCache = {
    publicKey: stored?.public_key ?? generated.publicKey,
    privateKey: stored?.private_key ?? generated.privateKey,
  };
  return keysCache;
}

export async function pushPublicKey(): Promise<{ enabled: boolean; publicKey: string | null }> {
  const enabled = await getBool('sms.push_enabled');
  if (!enabled) return { enabled: false, publicKey: null };
  const keys = await ensureVapidKeys();
  return { enabled: true, publicKey: keys.publicKey };
}

export async function subscribePush(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  const endpoint = String(subscription.endpoint ?? '').slice(0, 1000);
  const p256dh = String(subscription.keys?.p256dh ?? '').slice(0, 300);
  const auth = String(subscription.keys?.auth ?? '').slice(0, 300);
  if (!endpoint.startsWith('https://') || p256dh.length < 10 || auth.length < 5) {
    throw new Error('اشتراک اعلان نامعتبر است.');
  }
  await run(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    [id('psub'), userId, endpoint, p256dh, auth, nowIso()],
  );
  return { subscribed: true };
}

export async function unsubscribePush(userId: string, endpoint: string) {
  await run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, String(endpoint ?? '')]);
  return { subscribed: false };
}

export async function pushSubscriptionCount(userId: string): Promise<number> {
  const row = await one<{ c: number }>('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?', [userId]);
  return Number(row?.c ?? 0);
}

/** Send one notification to every device of the given users. Never throws. */
export async function sendPushToUsers(
  userIds: string[],
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number }> {
  try {
    if (!userIds.length) return { sent: 0 };
    if (!(await getBool('sms.push_enabled'))) return { sent: 0 };
    const keys = await ensureVapidKeys();
    const wp = await webpush();
    wp.setVapidDetails('mailto:support@pishkan.example', keys.publicKey, keys.privateKey);
    const rows = await q<any>(
      `SELECT * FROM push_subscriptions WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
      userIds,
    );
    let sent = 0;
    for (const row of rows) {
      try {
        await wp.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
          { TTL: 3600 },
        );
        sent += 1;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await run('DELETE FROM push_subscriptions WHERE id = ?', [row.id]).catch(() => undefined);
        }
      }
    }
    return { sent };
  } catch {
    return { sent: 0 };
  }
}
