/**
 * Delivery bookkeeping and the live channel for notifications.
 *
 * ## Why the system needs a ledger at all
 *
 * A notice is deliberately sent over several channels at once (FCM, Web Push,
 * the live stream, and periodic polling as the floor) because in Iran none of
 * them alone is dependable. That only works if "already delivered" is a fact the
 * server knows, and the only honest source of that fact is the device: Google
 * accepting a message says nothing about whether a phone showed it, and a
 * vendor ROM that silently discards a broadcast is indistinguishable from a
 * success. So every channel that reaches the person ends with an ack on this
 * table, and everything else — the retry sweeper, the live stream's replay, the
 * poll — reads that answer instead of guessing.
 *
 * ## What the live stream is
 *
 * `GET /api/notifications/stream` is a Server-Sent Events connection. It is not
 * here to be the primary channel (FCM is, and it costs no battery) but to be the
 * one channel that works with **no third party in the middle at all**: it is a
 * plain HTTPS request to the office's own server, so it survives a Google
 * geo-restriction, a phone with no Play services, a LAN-only deployment, and a
 * browser whose push permission was never granted. While it is open, delivery is
 * immediate even with the app minimised; when it drops, everything else still
 * works exactly as before.
 *
 * The hub is per-process and in-memory on purpose. The durable copy of every
 * notice is the `notifications` row itself, so a reconnect replays from the
 * table and a server restart loses nothing — a client that reconnects gets its
 * undelivered notices back.
 */
import type { Response } from 'express';
import { nowIso, one, q, run } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool, getNumber, getString } from '../settings/service.js';

/** Every channel a notice can travel on. Written to `notification_acks.channel`. */
export const CHANNELS = ['fcm', 'web', 'live', 'poll', 'sms', 'relay', 'email'] as const;
export type DeliveryChannel = (typeof CHANNELS)[number];

export function isChannel(value: unknown): value is DeliveryChannel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

export interface LiveEvent {
  id: string;
  title: string;
  body: string;
  kind: string;
  link: string;
  eventType: string | null;
  revision: number;
  createdAt: string;
  /**
   * The operating system's collapse key: every channel that renders this notice
   * must hand Android the same `tag`, or the same event shows up as two rows in
   * the shade — one posted by FCM, one by the phone's own live connection.
   *
   * It is the row's `dedupe_key` (what the sender used as its idempotency key),
   * which is exactly the value `notifyUser` passes as `tag` to FCM and the relay,
   * so all three agree by construction instead of by remembering to.
   */
  tag: string;
}

/* -------------------------------------------------------------------------- */
/*  acks — "a device received this"                                           */
/* -------------------------------------------------------------------------- */

/**
 * Record that a device showed (or at least fetched) these notices.
 *
 * Idempotent by the unique index, so every channel can ack without coordinating:
 * the push handler acks, the poll acks, the browser acks, and the second and
 * later ones are no-ops. `delivered_at` is stamped in the same call, which is
 * what the retry sweeper and the live replay both read.
 *
 * A notice belonging to somebody else is silently skipped by the `user_id = ?`
 * guard rather than answered with an error: an ack is a delivery report, and a
 * device reporting a row it should not know about must not be able to mark it
 * read for its owner.
 */
export async function markDelivered(
  userId: string,
  notificationIds: (string | null | undefined)[],
  channel: DeliveryChannel,
  deviceRef = '*',
): Promise<{ acked: number }> {
  const ids = [...new Set(notificationIds.filter(Boolean) as string[])];
  if (!ids.length) return { acked: 0 };
  const ref = String(deviceRef || '*').slice(0, 80) || '*';
  const now = nowIso();
  let acked = 0;
  for (const notificationId of ids.slice(0, 200)) {
    // Ownership first. An ack is a delivery report about a row the caller must
    // actually have: without this guard, anybody who guesses an id could mark
    // somebody else's notice as delivered and silence its retries.
    const owned = await one<{ id: string }>('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [notificationId, userId]);
    if (!owned) continue;
    // "Newly confirmed" is per notice, not per row. Every channel that answers
    // gets its own line in the log — that is what tells an operator which paths
    // reach this phone — but only the first one counts as a delivery, and only
    // the first one stamps the time the person was reached.
    const before = await one<{ c: number }>('SELECT COUNT(*) AS c FROM notification_acks WHERE notification_id = ?', [notificationId]);
    const firstForNotice = Number(before?.c ?? 0) === 0;
    await run(
      `INSERT INTO notification_acks (id, notification_id, user_id, channel, device_ref, acked_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (notification_id, channel, device_ref) DO NOTHING`,
      [id('ack'), notificationId, userId, channel, ref, now],
    );
    if (firstForNotice) {
      acked += 1;
      // The first ack from any installation wins for the whole person: that is
      // the rule that keeps four channels from becoming four notifications.
      await run('UPDATE notifications SET delivered_at = ? WHERE id = ? AND user_id = ? AND delivered_at IS NULL', [now, notificationId, userId]);
    }
  }
  return { acked };
}

/** Notices this person has that no device has confirmed yet. */
export async function pendingUndelivered(userId: string, options: { limit?: number; excludeIds?: string[] } = {}): Promise<LiveEvent[]> {
  const limit = Math.min(100, options.limit ?? 20);
  const skip = (options.excludeIds ?? []).filter(Boolean);
  const clause = skip.length ? `AND n.id NOT IN (${skip.map(() => '?').join(',')})` : '';
  const rows = await q<any>(
    `SELECT n.* FROM notifications n
     WHERE n.user_id = ? AND n.delivered_at IS NULL AND n.read_at IS NULL ${clause}
     ORDER BY n.created_at ASC LIMIT ?`,
    skip.length ? [userId, ...skip, limit] : [userId, limit],
  );
  return rows.map(toLiveEvent);
}

export function toLiveEvent(row: any): LiveEvent {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    kind: row.kind ?? 'info',
    link: row.link ?? '',
    eventType: row.event_type ?? null,
    revision: Number(row.revision ?? 1),
    createdAt: row.created_at,
    tag: String(row.dedupe_key ?? row.id).slice(0, 120),
  };
}

/* -------------------------------------------------------------------------- */
/*  retry bookkeeping                                                         */
/* -------------------------------------------------------------------------- */

/** How long to wait before re-sending, by attempt. Deliberately short first: the
 *  common reason for no ack is that the phone was asleep, not that it is gone. */
const BACKOFF_MINUTES = [2, 6, 15];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;
/** Past this age a notice is not worth waking a phone for; it is still in the
 *  bell and the app shows it there. */
const HORIZON_MINUTES = 180;

/**
 * Notices that were sent, never confirmed, and are due for another try.
 *
 * `push_attempts` is bumped by the caller (`noteAttempt`) after a send, so this
 * query never returns the same row twice while a send is in flight — and a device
 * that has been uninstalled reports `UNREGISTERED`, which deletes the row
 * entirely, so nothing retries forever.
 */
export async function dueForRetry(limit = 25): Promise<{ userId: string; notificationId: string; attempts: number; title: string; body: string; link: string; kind: string; eventType: string | null; createdAt: string }[]> {
  const maxAge = new Date(Date.now() - HORIZON_MINUTES * 60_000).toISOString();
  const rows = await q<any>(
    `SELECT n.user_id, n.id, n.push_attempts, n.push_last_at, n.title, n.body, n.link, n.kind, n.event_type, n.created_at
     FROM notifications n
     WHERE n.delivered_at IS NULL AND n.read_at IS NULL AND n.push_attempts < ? AND n.created_at > ?
     ORDER BY n.created_at ASC LIMIT ?`,
    [MAX_ATTEMPTS, maxAge, Math.min(100, limit)],
  );
  const now = Date.now();
  // Filter the backoff in code rather than SQL: `created_at`/`push_last_at` are
  // ISO strings and the grace is derived from the attempt count, which reads far
  // better here than as a portable interval expression.
  return rows.filter((row) => {
    const attempts = Number(row.push_attempts ?? 0);
    const waited = Date.now() - new Date(String(row.push_last_at ?? row.created_at)).getTime();
    return waited >= (BACKOFF_MINUTES[Math.min(attempts, MAX_ATTEMPTS - 1)] ?? 5) * 60_000;
  }).map((row) => ({
    userId: String(row.user_id),
    notificationId: String(row.id),
    attempts: Number(row.push_attempts ?? 0),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    link: String(row.link ?? ''),
    kind: String(row.kind ?? 'info'),
    eventType: row.event_type ?? null,
    createdAt: String(row.created_at ?? ''),
  }));
}

export async function noteAttempt(notificationIds: string[]): Promise<void> {
  const ids = [...new Set(notificationIds.filter(Boolean))];
  if (!ids.length) return;
  const now = nowIso();
  for (const notificationId of ids) {
    await run('UPDATE notifications SET push_attempts = push_attempts + 1, push_last_at = ? WHERE id = ?', [now, notificationId]);
  }
}

/**
 * Notices that never reached a device and are worth one SMS.
 *
 * Escalation is opt-in and narrow on purpose: the office pays per message, so
 * this is for the kinds where "I did not know my case moved" is worse than a
 * text message. Age and attempt count gate it, so an SMS is a last resort after
 * the push channels had their chance, not a fourth simultaneous copy.
 */
export async function escalationCandidates(): Promise<{ userId: string; notificationId: string; title: string; body: string; templateId: string }[]> {
  if (!(await getBool('push.sms_fallback_enabled'))) return [];
  // No pattern, no escalation: sending office text through whatever pattern
  // happens to be configured for notifications is how an SMS arrives as
  // "your verification code is …" with a case update in the middle of it.
  const templateId = (await getString('push.sms_fallback_template_id').catch(() => '')).trim();
  if (!templateId) return [];
  const afterMinutes = Math.max(5, await getNumber('push.sms_fallback_after_min').catch(() => 45));
  const before = new Date(Date.now() - afterMinutes * 60_000).toISOString();
  const kinds = (await getString('push.sms_fallback_kinds').catch(() => 'error,warning'))
    .split(',').map((k) => k.trim()).filter(Boolean);
  if (!kinds.length) return [];
  const rows = await q<any>(
    `SELECT n.id, n.user_id, n.title, n.body FROM notifications n
     WHERE n.delivered_at IS NULL AND n.read_at IS NULL AND n.created_at < ? AND n.created_at > ?
       AND n.kind IN (${kinds.map(() => '?').join(',')})
       AND NOT EXISTS (SELECT 1 FROM notification_acks a WHERE a.notification_id = n.id AND a.channel = 'sms')
     ORDER BY n.created_at ASC LIMIT 10`,
    [before, new Date(Date.now() - 24 * 3600_000).toISOString(), ...kinds],
  );
  return rows.map((row: any) => ({
    userId: String(row.user_id),
    notificationId: String(row.id),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    templateId,
  }));
}

/**
 * Take ownership of this notice's one SMS escalation.
 *
 * The claim is the insert itself, so two server processes (or a sweep that
 * overlaps its own next tick) cannot both text the same person: only the caller
 * whose insert actually changed a row is allowed to send.
 */
export async function claimEscalation(notificationId: string): Promise<boolean> {
  const inserted = await run(
    `INSERT INTO notification_acks (id, notification_id, user_id, channel, device_ref, acked_at)
     VALUES (?, ?, (SELECT user_id FROM notifications WHERE id = ?), 'sms', 'escalated', ?)
     ON CONFLICT (notification_id, channel, device_ref) DO NOTHING`,
    [id('ack'), notificationId, notificationId, nowIso()],
  );
  return inserted.changes > 0;
}

/**
 * Close out an escalation.
 *
 * A sent SMS stops the push retries (the person has been told, by the one channel
 * that cannot be filtered), while a failed one leaves them alone: the notice is
 * still worth reaching, and the 'sms' ack row above is what keeps it to exactly
 * one text message.
 */
export async function noteEscalationResult(notificationId: string, ok: boolean): Promise<void> {
  if (!ok) return;
  await run('UPDATE notifications SET push_attempts = 99 WHERE id = ? AND delivered_at IS NULL', [notificationId]);
}

/* -------------------------------------------------------------------------- */
/*  live stream hub                                                           */
/* -------------------------------------------------------------------------- */

interface LiveClient {
  res: Response;
  /** Dedupe on the client's side is by tag; this is the server's own guard
   *  against a replay racing a fresh publish. */
  sent: Set<string>;
}

class LiveHub {
  private clients = new Map<string, Set<LiveClient>>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  register(userId: string, res: Response): () => void {
    const client: LiveClient = { res, sent: new Set() };
    const set = this.clients.get(userId) ?? new Set<LiveClient>();
    set.add(client);
    this.clients.set(userId, set);
    this.ensureHeartbeat();
    return () => {
      set.delete(client);
      if (!set.size) this.clients.delete(userId);
      if (!this.clients.size && this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    };
  }

  publish(userId: string, event: LiveEvent): number {
    const set = this.clients.get(userId);
    if (!set || !set.size) return 0;
    const data = `id: ${event.id}\nevent: notification\ndata: ${JSON.stringify(event)}\n\n`;
    let delivered = 0;
    for (const client of set) {
      if (client.sent.has(`${event.id}:${event.revision}`)) continue;
      client.sent.add(`${event.id}:${event.revision}`);
      try {
        client.res.write(data);
        delivered += 1;
      } catch {
        // A dead socket is removed by its own close handler; a write that threw
        // must never be allowed to reach the business flow that published.
      }
    }
    return delivered;
  }

  /**
   * One comment line every 25 seconds.
   *
   * Two reasons it is not optional: a proxy or an office router drops an idle
   * TCP connection long before that (which would look exactly like "push does
   * not work"), and Android stops treating a network request as foreground work
   * once it goes quiet.
   */
  private ensureHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const set of this.clients.values()) {
        for (const client of set) {
          try {
            client.res.write(': ping\n\n');
          } catch {
            /* dropped below on the next close */
          }
        }
      }
    }, 25_000);
    // The timer must never hold the process open (tests, CLI, shutdown).
    (this.heartbeat as any)?.unref?.();
  }

  get clientCount(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }

  /**
   * Shut every stream down politely.
   *
   * A deploy restarts the process; ending the responses with a short `retry`
   * tells each client to come straight back instead of waiting out its own
   * backoff, so a restart costs a second of delivery rather than half a minute.
   */
  closeAll() {
    for (const set of this.clients.values()) {
      for (const client of set) {
        try {
          client.res.write('retry: 1000\nevent: shutdown\ndata: {}\n\n');
          client.res.end();
        } catch {
          /* already gone */
        }
      }
    }
    this.clear();
  }

  /** Only for tests and clean shutdown: forget every socket. */
  clear() {
    this.clients.clear();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}

export const liveHub = new LiveHub();

/* -------------------------------------------------------------------------- */
/*  status — what a client (or an operator) needs to know                    */
/* -------------------------------------------------------------------------- */

export interface DeliveryPolicy {
  liveEnabled: boolean;
  retryEnabled: boolean;
  relayEnabled: boolean;
  smsFallbackEnabled: boolean;
  fcmEnabled: boolean;
  fcmProblem: string;
  webPushEnabled: boolean;
  emailEnabled: boolean;
  liveClients: number;
}

/**
 * The channel switches, resolved. Clients read this to decide what to offer;
 * the admin panel reads it to explain itself.
 */
export async function deliveryPolicy(): Promise<DeliveryPolicy> {
  const [{ pushConfig }, { pushPublicKey }] = await Promise.all([
    import('./fcm.js'),
    import('./push.js'),
  ]);
  const fcm = await pushConfig();
  const web = await pushPublicKey().catch(() => ({ enabled: false, publicKey: null }));
  return {
    liveEnabled: await getBool('push.live_enabled'),
    retryEnabled: await getBool('push.retry_enabled'),
    relayEnabled: await getBool('push.relay_enabled'),
    smsFallbackEnabled: await getBool('push.sms_fallback_enabled'),
    fcmEnabled: fcm.enabled,
    fcmProblem: fcm.problem,
    webPushEnabled: (await getBool('sms.push_enabled')) && Boolean(web.enabled && web.publicKey),
    emailEnabled: await getBool('email.enabled'),
    liveClients: liveHub.clientCount,
  };
}

/** Per-person view of the same thing, for the app's «وضعیت اعلان‌ها» card. */
export async function deliveryStatus(userId: string) {
  const policy = await deliveryPolicy();
  const counts = await one<{ total: number; waiting: number; lastAck: string | null }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN delivered_at IS NULL AND read_at IS NULL THEN 1 ELSE 0 END) AS waiting,
            (SELECT MAX(acked_at) FROM notification_acks a WHERE a.user_id = ?) AS lastAck
     FROM notifications WHERE user_id = ?`,
    [userId, userId],
  );
  const devices = await q<{ platform: string; last_seen_at: string | null; failure_count: number }>(
    `SELECT platform, last_seen_at, failure_count FROM customer_devices WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 6`,
    [userId],
  ).catch(() => []);
  return {
    ...policy,
    waiting: Number(counts?.waiting ?? 0),
    total: Number(counts?.total ?? 0),
    lastAckAt: counts?.lastAck ?? null,
    // How many installations the server can reach for this person, and how
    // recently each one checked in — the difference between «no phone is
    // registered» and «the phone is registered but asleep».
    devices: devices.map((d) => ({
      platform: d.platform,
      lastSeenAt: d.last_seen_at,
      failing: Number(d.failure_count ?? 0) > 0,
      seenRecently: Boolean(d.last_seen_at) && Date.now() - new Date(String(d.last_seen_at)).getTime() < 30 * 864e5,
    })),
  };
}
