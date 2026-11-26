import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, rateLimit, requireAuth } from '../http/middleware.js';
import { notFound } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { recordTourProgress, requestHint, tourDiagnostics, tourPayload, toursForAudience } from '../modules/tours/service.js';
import { hintByKey, tourByCode } from '../modules/tours/catalog.js';
import { officeScope } from '../lib/scope.js';

/**
 * Guided tours and contextual tips, in three endpoints.
 *
 * `GET /` returns the catalogue *and* this person's place in it, in one call: a
 * client must not render a first screen and then discover a second later that a
 * tour was waiting, and it must not fetch nine strings one at a time on a
 * metered connection.
 *
 * The write side is deliberately coarse (start/step/complete/dismiss/replay)
 * and rate limited generously — a tour advances by taps, and anything that makes
 * the interaction cost a request is a reason for clients to stop reporting and
 * start guessing.
 */
export const toursRouter = Router();

// Every route here is per-person by definition, so all of them are signed-in.
toursRouter.use(requireAuth);

const writeLimiter = rateLimit({ windowMs: 60_000, max: 240, message: 'زیاد است؛ کمی صبر کنید.' });

/** The audience decides which tours exist: a customer never sees the office guide. */
function audienceOf(req: any): 'customer' | 'office' {
  return req.auth!.user.kind === 'customer' ? 'customer' : 'office';
}

toursRouter.get('/', asyncRoute(async (req, res) => {
  ok(res, await tourPayload(req.auth!.user.id, audienceOf(req)));
}));

const progressBody = z.object({
  action: z.enum(['start', 'step', 'complete', 'dismiss', 'replay']),
  step: z.number().int().min(0).max(50).optional(),
});

/**
 * «May I interrupt with a tip?» — asked by the client the moment it recognises a
 * repeated wrong action, answered by the server.
 *
 * Unknown keys are rejected rather than counted, so a client cannot accumulate
 * budget for a tip that no screen will ever show.
 */
toursRouter.post('/hint', writeLimiter, asyncRoute(async (req, res) => {
  const body = z.object({ key: z.string().min(2).max(64) }).parse(req.body);
  if (!hintByKey(body.key)) throw notFound('راهنمای کوتاه شناخته‌شده نیست.');
  const result = await requestHint(req.auth!.user.id, body.key);
  ok(res, { key: body.key, show: result.show, reason: result.reason, hint: result.hint ?? null });
}));

toursRouter.post('/:code', writeLimiter, asyncRoute(async (req, res) => {
  const code = String(req.params.code ?? '');
  if (!tourByCode(code)) throw notFound('راهنمایی با این شناسه تعریف نشده است.');
  const body = progressBody.parse(req.body ?? {});
  const state = await recordTourProgress(req.auth!.user.id, code, body.action, body.step ?? 0);
  ok(res, { code, ...state });
}));

/** Catalogue without state — for the admin screen that previews the wording. */
toursRouter.get('/preview', asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!)) throw notFound();
  const audience = req.query.audience === 'office' ? 'office' : 'customer';
  ok(res, await toursForAudience(audience));
}));

/**
 * Counters, so the office can see whether the guide is helping or being skipped.
 *
 * A tour that everybody dismisses on step one is a design smell in the screen it
 * is explaining, and that is exactly the reading this table supports.
 */
toursRouter.get('/diagnostics', asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!)) throw notFound();
  ok(res, await tourDiagnostics());
}));
