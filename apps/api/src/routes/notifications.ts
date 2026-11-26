/**
 * Notification delivery endpoints: the live stream, the ack, and the "what is
 * still waiting" read that both clients fall back on.
 *
 * These routes are deliberately about *delivery*, not about the bell. The bell's
 * own list stays where it always was (`/api/customers/me/notifications`) so the
 * hundreds of places that read it are untouched; what is new here is the part a
 * device needs to make several channels behave like one reliable channel:
 *
 *  * `GET  /api/notifications/stream` — SSE; every notice the moment it happens.
 *  * `GET  /api/notifications/pending` — what to replay after a reconnect, and
 *    what the periodic poll should look at (nothing already confirmed).
 *  * `POST /api/notifications/ack` — "a person saw this on channel X".
 *  * `GET  /api/notifications/status` — which channels are switched on, whether
 *    this account has a registered device, and how many notices are still
 *    waiting: the data behind «وضعیت اعلان‌ها» in the app and the panel.
 *
 * All of it is scoped to `req.auth.user.id`; there is no parameter that lets one
 * person ack, read or listen to another's notices.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth } from '../http/middleware.js';
import { tooMany, unavailable } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { nowIso, one } from '../db/index.js';
import { getBool } from '../modules/settings/service.js';
import { deliveryStatus, isChannel, liveHub, markDelivered, pendingUndelivered } from '../modules/notifications/delivery.js';
import { notifyUser } from '../modules/notifications/service.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * The live stream.
 *
 * A browser cannot send a header with `EventSource`, so the panels rely on the
 * session cookie (same-origin, already how every other call works) and the app
 * uses its bearer header. Nothing about the endpoint depends on either: it reads
 * `req.auth` like any other route.
 *
 * On connect the client gets `ready`, then whatever is still undelivered, then
 * live events. A client that reconnects after a drop therefore loses nothing,
 * because the replay and the live path read the same `delivered_at` column.
 */
notificationsRouter.get('/stream', asyncRoute(async (req, res) => {
  if (!(await getBool('push.live_enabled'))) {
    throw unavailable('اتصال زنده در تنظیمات غیرفعال شده است؛ از بررسی دوره‌ای استفاده کنید.');
  }
  const userId = req.auth!.user.id;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    // nginx/Cloudflare buffer responses; this header is the standard way to tell
    // them not to, which is the difference between "instant" and "arrives when the
    // proxy feels like flushing" behind the office's own domain.
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });
  // Needed for some proxies to keep the socket open at all.
  res.flushHeaders?.();

  const release = liveHub.register(userId, res);
  res.write(`event: ready\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);

  // Replay first: anything created while the client was away. Twenty is enough
  // for a lunch break, and a cap keeps one flaky network from turning a
  // reconnect into a burst of banners; older notices stay in the bell.
  const missed = await pendingUndelivered(userId, { limit: 20 });
  for (const event of missed) liveHub.publish(userId, event);

  // Express closes the response when the client goes away; releasing there is what
  // keeps the hub from holding a dead socket (and its heartbeat timer) forever.
  res.on('close', () => { release(); });
}));

/** Notices still waiting for a device to confirm them. */
notificationsRouter.get('/pending', asyncRoute(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
  const items = await pendingUndelivered(req.auth!.user.id, { limit });
  ok(res, { items, liveClients: liveHub.clientCount });
}));

/**
 * Confirm delivery.
 *
 * Accepts the notification ids the client actually rendered. Unknown or
 * somebody-else's ids are dropped by the ownership guard in `markDelivered`,
 * never an error: this is a delivery report, and failing it would only teach the
 * client to stop reporting.
 */
notificationsRouter.post('/ack', asyncRoute(async (req, res) => {
  const body = z.object({
    ids: z.array(z.string().min(1).max(80)).max(200).default([]),
    channel: z.string().max(20).optional(),
    deviceRef: z.string().max(80).optional(),
  }).parse(req.body ?? {});
  if (!body.ids.length) {
    ok(res, { acked: 0 });
    return;
  }
  const channel = isChannel(body.channel) ? body.channel : 'poll';
  const result = await markDelivered(req.auth!.user.id, body.ids, channel, body.deviceRef?.trim() || '*');
  ok(res, result);
}));

/** Channel health for this account — what the app's settings screen shows. */
notificationsRouter.get('/status', asyncRoute(async (req, res) => {
  ok(res, await deliveryStatus(req.auth!.user.id));
}));

/**
 * «چطور مطمئن شوم که ارسال واقعاً انجام می‌شود؟» — the one honest answer is to
 * send something and look at what the ledger says about it, so that is what this
 * endpoint does. It is a self-test, not a broadcast: the notice is created for
 * the calling user alone, and there is no parameter naming anybody else.
 *
 * The reply separates the three things that get confused in practice:
 *  * `attempted` — the server wrote the row and offered it to every channel that
 *    is switched on. This is what a log can prove.
 *  * `confirmed` — a device filed an ack, which is the only thing that means a
 *    person actually saw it. A message can be attempted forever and never
 *    confirmed (no phone registered, browser closed), and that is not a bug in
 *    the sender.
 *  * `channels` — the policy each channel is running under, so an office that
 *    turned Firebase off is not told to look for a push that was never sent.
 *
 * `email` is deliberately absent: there is no SMTP transport in this build, and
 * the settings panel says so on each of its fields. `tests/notification-egress.test.ts`
 * keeps the two facts tied together.
 */
notificationsRouter.post('/test', asyncRoute(async (req, res) => {
  const userId = req.auth!.user.id;
  const stamp = new Date().toISOString().slice(11, 19);
  // A distinct idempotency key per call, so repeated tests are repeated notices
  // (the dedupe index would otherwise swallow the second one in the same second)
  // while still going through the same insert path a real event uses.
  const key = `notification.test:${userId}:${stamp}`;
  // A test that really sends is a test that really costs: an FCM message goes out
  // per device, and an escalation SMS is billed. So the button cannot be mashed —
  // ten seconds is long enough to read the answer and short enough not to feel like
  // a lockout.
  const recent = await one<{ created_at: string }>(
    `SELECT created_at FROM notifications
     WHERE user_id = ? AND event_type = 'notification.test' ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (recent?.created_at && Date.now() - new Date(recent.created_at).getTime() < 10_000) {
    throw tooMany('ده ثانیه پیش آزمونی ارسال شده است؛ نتیجهٔ همان را ببینید یا کمی صبر کنید.');
  }
  // Not a stub: this is the very function the business flows call, so what the
  // reply says about it applies to a real notice.
  await notifyUser(userId, {
    title: 'آزمون رساندن اعلان',
    body: `این پیام برای آزمودن مسیرهای ارسال ساخته شده است — ساعت ${stamp} UTC.`,
    kind: 'info',
    eventType: 'notification.test',
    idempotencyKey: key,
    push: true,
  });

  // Give the live channel its fraction of a second: an open tab confirms on
  // receipt, and a test that reads the ledger before it can answer would always
  // say "unconfirmed".
  await new Promise((resolve) => setTimeout(resolve, 250));
  const row = await one<{ id: string; delivered_at: string | null }>(
    'SELECT id, delivered_at FROM notifications WHERE dedupe_key = ? AND user_id = ?', [key, userId],
  );
  ok(res, {
    notificationId: row?.id ?? null,
    attempted: Boolean(row),
    confirmed: Boolean(row?.delivered_at),
    status: await deliveryStatus(userId),
    note: row?.delivered_at
      ? 'یک دستگاه دریافت را تأیید کرد.'
      : 'پیام ساخته شد و به همهٔ راه‌های روشن داده شد، ولی هنوز هیچ دستگاهی آن را تأیید نکرده است. '
        + 'اگر گوشی ثبت نشده یا تبی باز نیست، همین انتظار می‌رود؛ پس از تأیید، «آخرین تأیید» در همین پاسخ پر می‌شود.',
  });
}));
