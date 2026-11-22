import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { hasPermission } from '../lib/permissions.js';
import {
  pushPublicKey, pushSubscriptionCount, subscribePush, unsubscribePush,
} from '../modules/notifications/push.js';
import {
  deviceCount, pushDiagnostics, pushToUsers, recentDeliveries, registerDevice, unregisterDevice,
} from '../modules/notifications/fcm.js';

/**
 * Web Push device management. A staff member opts a device in from the free
 * queue page; from then on, that device rings when a new case lands in the
 * pool they are eligible for.
 */
export const pushRouter = Router();
pushRouter.use(requireAuth);

pushRouter.get('/public-key', asyncRoute(async (req, res) => {
  const state = await pushPublicKey();
  ok(res, { ...state, subscriptions: await pushSubscriptionCount(req.auth!.user.id) });
}));

pushRouter.post('/subscribe', asyncRoute(async (req, res) => {
  const body = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({
      p256dh: z.string().min(10).max(300),
      auth: z.string().min(5).max(300),
    }),
  }).parse(req.body);
  try {
    ok(res, await subscribePush(req.auth!.user.id, body));
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'اشتراک اعلان نامعتبر است.');
  }
}));

pushRouter.post('/unsubscribe', asyncRoute(async (req, res) => {
  const body = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
  ok(res, await unsubscribePush(req.auth!.user.id, body.endpoint));
}));


/* -------------------------------------------------------------------------- */
/*  Native push (FCM) — the customer app                                     */
/* -------------------------------------------------------------------------- */

/**
 * Register this installation's FCM token.
 *
 * Called by the app on every sign-in and on every token refresh. It is
 * idempotent by design: the token is the identity, so calling it repeatedly is
 * the normal path, not an edge case.
 */
pushRouter.post('/devices', asyncRoute(async (req, res) => {
  const body = z.object({
    token: z.string().min(20).max(4096),
    platform: z.string().max(20).optional(),
    appVersion: z.string().max(40).optional(),
    deviceName: z.string().max(80).optional(),
    deviceMaker: z.string().max(40).optional(),
  }).parse(req.body);
  const result = await registerDevice(req.auth!.user.id, body);
  if (!result.ok) throw badRequest('توکن دستگاه معتبر نیست.');
  ok(res, { registered: true, devices: await deviceCount(req.auth!.user.id) });
}));

pushRouter.delete('/devices', asyncRoute(async (req, res) => {
  // The token may arrive in the body or as a query parameter: an HTTP client
  // that cannot attach a body to DELETE (the app's own helper is one) would
  // otherwise silently send "undefined" and leave the device registered.
  const body = z.object({
    token: z.string().min(1).max(4096).optional(),
  }).parse(req.body ?? {});
  const token = body.token ?? String(req.query.token ?? '');
  if (!token) throw badRequest('توکن دستگاه لازم است.');
  await unregisterDevice(req.auth!.user.id, token);
  ok(res, { registered: false });
}));

/**
 * "Are notifications set up on my phone?" — answered from the *server's* side,
 * which is the half the app cannot see: whether the token is stored, whether
 * the Firebase key works, and what was actually delivered.
 *
 * Scoped to the caller on purpose. A customer must not be able to read the
 * delivery history of anybody else, and must not learn the project id of the
 * Firebase account, so the operator-only fields are stripped for them.
 */
pushRouter.get('/devices/status', asyncRoute(async (req, res) => {
  // Anyone who may see settings is an operator here; a customer only ever gets
  // their own device count and never the Firebase project details.
  const isStaff = hasPermission(req.auth!.permissions, 'settings.view');
  const base = {
    devices: await deviceCount(req.auth!.user.id),
  };
  if (!isStaff) {
    ok(res, { ...base, message: base.devices ? 'این گوشی برای دریافت اعلان ثبت شده است.' : 'این گوشی هنوز برای دریافت اعلان ثبت نشده است.' });
    return;
  }
  ok(res, { ...base, ...(await pushDiagnostics()) });
}));

/** Send a test push to my own devices — the button in the admin panel. */
pushRouter.post('/test', asyncRoute(async (req, res) => {
  const body = z.object({ title: z.string().max(120).optional(), body: z.string().max(500).optional() }).parse(req.body ?? {});
  const result = await pushToUsers([req.auth!.user.id], {
    title: body.title || 'اعلان آزمایشی تک پیشخوان',
    body: body.body || 'اگر این پیام را در نوار اعلان می‌بینید، ارسال لحظه‌ای درست کار می‌کند.',
    link: '/app/notifications',
    tag: `test-${Date.now()}`,
    kind: 'success',
  });
  // Report the real reason. The previous message collapsed every non-sent
  // outcome into "no registered device", which is only one of three very
  // different problems: sending is off, the credential is rejected, or there
  // really is no phone. Sending an operator to check the wrong thing is worse
  // than saying nothing.
  let message: string;
  if (result.sent > 0) {
    message = 'اعلان آزمایشی ارسال شد؛ چند ثانیه صبر کنید. اگر روی گوشی نیامد، بخش «اگر اعلان نرسید» در راهنما را ببینید.';
  } else if (result.skipped) {
    message = `ارسال نشد: ${result.skipped}`;
  } else if (result.failed > 0) {
    // Devices exist and the send was attempted: the failure is on the Google
    // side (key, project, blocked network). The delivery log has the code.
    message = 'ارسال به گوشی ناموفق بود. کلید Firebase یا دسترسی شبکه را بررسی کنید؛ کد خطا در گزارش تحویل پایین همین صفحه است.';
  } else if (result.withoutDevice > 0) {
    message = 'این حساب هیچ گوشی ثبت‌شده‌ای ندارد. در اپ با همین حساب وارد شوید و اجازهٔ اعلان را بدهید، سپس دوباره امتحان کنید.';
  } else {
    message = 'ارسال نشد؛ دلیل نامشخص است. گزارش تحویل پایین همین صفحه را ببینید.';
  }
  ok(res, { ...result, message });
}));

/** Delivery log, for diagnosing "it says sent but nothing arrived". */
pushRouter.get('/diagnostics', requirePermission('settings.view'), asyncRoute(async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  ok(res, {
    ...(await pushDiagnostics()),
    recent: (await recentDeliveries(limit)).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      channel: row.channel,
      ok: Boolean(row.ok),
      errorCode: row.error_code,
      errorText: row.error_text,
      tokenTail: row.device_token_tail,
      at: row.created_at,
    })),
  });
}));
