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
import { unavailable } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { nowIso } from '../db/index.js';
import { getBool } from '../modules/settings/service.js';
import { deliveryStatus, isChannel, liveHub, markDelivered, pendingUndelivered } from '../modules/notifications/delivery.js';

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
