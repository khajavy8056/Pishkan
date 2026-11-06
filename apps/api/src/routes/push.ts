import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth } from '../http/middleware.js';
import { badRequest } from '../http/errors.js';
import { ok } from '../http/respond.js';
import {
  pushPublicKey, pushSubscriptionCount, subscribePush, unsubscribePush,
} from '../modules/notifications/push.js';

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
