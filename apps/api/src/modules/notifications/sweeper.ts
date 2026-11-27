/**
 * The delivery sweeper: notices that never got a device's answer.
 *
 * ## The gap this closes
 *
 * Sending once is not the same as notifying somebody. A phone that was off, a
 * Xiaomi that froze the app before FCM landed, a request that died behind a
 * filtered network — all of them look like "sent" from the send call and like
 * "nothing arrived" on the customer's side. Every channel in
 * `modules/notifications` is fire-and-forget by design (a business flow must
 * never wait for a push provider), so without this loop an undelivered notice
 * stays undelivered forever, and the office has no way to know.
 *
 * ## Why it is a timer over the database, not a queue
 *
 * The state a retry needs is already in `notifications`: `delivered_at` (set by
 * the first ack from any device) and `push_attempts`/`push_last_at` (set by each
 * send). A queue would have to be reconciled against exactly those columns
 * anyway, and it would lose its contents on a restart — which on the Windows
 * install means "every pending retry disappeared when the office rebooted the
 * PC". The query is an index scan over `delivered_at IS NULL`, so the durable
 * rows *are* the queue.
 *
 * ## Duplicate protection
 *
 * A retry only happens while no device has answered, and it goes to the two
 * push channels (FCM, relay) — never to the poll or the live stream, which read
 * the same `delivered_at` column and so have nothing left to show. The device
 * dedupes by tag/seen-list regardless, so the same notice can be delivered by
 * several paths but can only be *displayed* once.
 */
import { getBool } from '../settings/service.js';
import { one } from '../../db/index.js';
import { claimEscalation, dueForRetry, escalationCandidates, liveHub, noteEscalationResult, toLiveEvent } from './delivery.js';

const TICK_MS = 60_000;
const BATCH = 25;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startDeliverySweeper(): void {
  if (timer) return;
  timer = setInterval(() => { void sweep().catch(() => undefined); }, TICK_MS);
  // Never hold the process open: a CLI command or a test run must be able to
  // exit even with the sweeper started.
  (timer as any)?.unref?.();
  // One immediate pass: an office that restarts its server should not wait a
  // minute for notices that were waiting before it went down.
  void sweep().catch(() => undefined);
}

export function stopDeliverySweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Only for tests: how many notices this process would retry right now. */
export async function pendingRetryCount(): Promise<number> {
  const rows = await dueForRetry(BATCH);
  return rows.length;
}

export async function sweep(): Promise<{ retried: number; escalated: number }> {
  // One pass at a time. A slow provider (8s timeout × devices) could otherwise
  // overlap with the next tick and send the same notice twice in one minute.
  if (running) return { retried: 0, escalated: 0 };
  running = true;
  try {
    const retried = (await getBool('push.retry_enabled')) ? await retryUnacked() : 0;
    const escalated = await escalateToSms();
    // Hygiene piggyback: expired one-time email tokens older than a week go.
    const { purgeExpiredEmailTokens } = await import('../auth/email-flows.js');
    await purgeExpiredEmailTokens().catch(() => 0);
    return { retried, escalated };
  } finally {
    running = false;
  }
}

/** Push every notice that no device has confirmed, with the backoff in delivery.ts. */
async function retryUnacked(): Promise<number> {
  const rows = await dueForRetry(BATCH);
  if (!rows.length) return 0;
  const { pushToUsers } = await import('./fcm.js');
  const { relayToUsers } = await import('./relay.js');
  let sent = 0;
  for (const row of rows) {
    const payload = {
      title: row.title,
      body: row.body,
      link: row.link,
      notificationId: row.notificationId,
      // Same tag as the original send: on the phone this *replaces* the earlier
      // attempt instead of stacking a second copy of the same notice.
      tag: row.notificationId.slice(0, 120),
      kind: row.kind,
    };
    const result = await pushToUsers([row.userId], payload).catch(() => null);
    if (result && result.sent > 0) sent += 1;
    await relayToUsers([row.userId], {
      title: payload.title,
      body: payload.body,
      link: payload.link,
      notificationId: payload.notificationId,
      tag: payload.tag,
      kind: payload.kind,
    }).catch(() => undefined);
    // A retry also reaches anybody who connected to the live stream *after* the
    // notice was created — the hub only pushes what happens while it is open.
    const db = await one<any>('SELECT * FROM notifications WHERE id = ?', [row.notificationId]).catch(() => null);
    if (db) liveHub.publish(row.userId, toLiveEvent(db));
  }
  return sent;
}

/** The last-resort channel for notices nobody ever saw. */
async function escalateToSms(): Promise<number> {
  const rows = await escalationCandidates();
  if (!rows.length) return 0;
  const { sendNotificationSms } = await import('../sms/provider.js');
  let sent = 0;
  for (const row of rows) {
    const user = await one<{ mobile: string | null }>('SELECT mobile FROM users WHERE id = ?', [row.userId]).catch(() => null);
    if (!user?.mobile) continue;
    if (!(await claimEscalation(row.notificationId))) continue;
    const text = `${row.title}${row.body ? ` — ${row.body}` : ''}`.slice(0, 480);
    const result = await sendNotificationSms(user.mobile, [text], 'push-fallback', row.templateId).catch(() => null);
    await noteEscalationResult(row.notificationId, Boolean(result?.ok));
    if (result?.ok) sent += 1;
  }
  return sent;
}
