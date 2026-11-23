import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, rateLimit, requireAuth, requireKind } from '../http/middleware.js';
import { forbidden, notFound } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { assistantInfo, assistantRespond } from '../modules/assistant/service.js';
import { loadAssistantCatalog, rankServices } from '../modules/assistant/catalog.js';
import {
  attachDraftDocument, draftService, loadDraftState, publicDraft, refresh, saveDraftState, setDraftField, startDraft,
} from '../modules/assistant/drafts.js';
import { getBool, getNumber } from '../modules/settings/service.js';

export const assistantRouter = Router();

const chatLimiter = rateLimit({ windowMs: 60_000, max: 30, message: 'تعداد پیام‌های شما زیاد است. کمی صبر کنید.' });
const draftLimiter = rateLimit({ windowMs: 60_000, max: 90, message: 'تعداد درخواست‌ها زیاد است. کمی صبر کنید.' });

const chatBody = z.object({
  message: z.string().max(2000).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(24).default([]),
  action: z.enum(['message', 'confirm', 'cancel', 'preview']).default('message'),
  draftId: z.string().max(80).optional(),
}).refine((body) => body.action !== 'message' || Boolean(body.message?.trim()), {
  message: 'متن پیام الزامی است.', path: ['message'],
});

/**
 * One structured endpoint for both clients. `action` drives the guided
 * request lifecycle; a normal message is `action: "message"`.
 */
assistantRouter.post('/chat', chatLimiter, asyncRoute(async (req, res) => {
  const body = chatBody.parse(req.body);
  const reply = await assistantRespond({
    message: body.message,
    history: body.history,
    action: body.action,
    draftId: body.draftId,
    auth: req.auth,
    ip: req.ip,
  });
  ok(res, reply);
}));

assistantRouter.get('/info', asyncRoute(async (req, res) => {
  ok(res, await assistantInfo(req.auth));
}));

/**
 * The live catalogue as the assistant sees it. Used by the clients to render
 * "browse everything" and to show the customer that a newly published service
 * is already here. Reads are fresh: no cache sits between the admin panel and
 * this response.
 */
assistantRouter.get('/catalog', asyncRoute(async (req, res) => {
  const customerId = req.auth?.user.kind === 'customer' ? req.auth.user.id : undefined;
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.slice(0, 80) : '';
  const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 24) || 24));
  const catalog = await loadAssistantCatalog(customerId);
  let services = category ? catalog.services.filter((service) => service.categorySlug === category) : catalog.services;
  if (query.trim()) {
    services = rankServices(query, services, limit).map((item) => item.service);
  } else {
    services = services.slice(0, limit);
  }
  ok(res, {
    services,
    categories: catalog.categories,
    total: catalog.services.length,
    query,
    loadedAt: catalog.loadedAt,
  });
}));

/* ------------------------------- draft lifecycle --------------------------- */
/* Every draft route is customer-only. Staff sessions are guests for the
 * assistant, exactly like an anonymous visitor. */

const customerOnly = [requireAuth, requireKind('customer')];

assistantRouter.get('/draft', ...customerOnly, asyncRoute(async (req, res) => {
  const state = await loadDraftState(req.auth!.user.id);
  if (!state) return ok(res, { draft: null });
  const service = await draftService(state);
  if (!service) return ok(res, { draft: null });
  ok(res, { draft: publicDraft(state, service) });
}));

assistantRouter.post('/draft', ...customerOnly, draftLimiter, asyncRoute(async (req, res) => {
  if (!(await getBool('assistant.request_submission'))) {
    throw forbidden('ثبت درخواست از طریق دستیار توسط مدیر سامانه غیرفعال شده است.');
  }
  const body = z.object({
    serviceSlug: z.string().min(2).max(120),
    useProfile: z.boolean().optional(),
  }).parse(req.body);
  const result = await startDraft(req.auth!.user.id, body.serviceSlug, { useProfile: body.useProfile });
  ok(res, { draft: publicDraft(result.state, result.service) });
}));

assistantRouter.patch('/draft', ...customerOnly, draftLimiter, asyncRoute(async (req, res) => {
  const body = z.object({ key: z.string().min(1).max(60), value: z.union([z.string().max(5000), z.number(), z.boolean()]) }).parse(req.body);
  const state = await loadDraftState(req.auth!.user.id);
  if (!state) throw notFound('پیش‌نویس فعالی وجود ندارد.');
  const service = await draftService(state);
  if (!service) throw notFound('خدمت این پیش‌نویس در دسترس نیست.');
  const updated = await setDraftField(req.auth!.user.id, state, service, body.key, body.value);
  ok(res, { draft: publicDraft(updated, service) });
}));

assistantRouter.post('/draft/documents', ...customerOnly, draftLimiter, asyncRoute(async (req, res) => {
  const body = z.object({
    requirementKey: z.string().min(2).max(80),
    fileId: z.string().min(3).max(80).optional(),
    customerDocumentId: z.string().min(3).max(80).optional(),
  }).refine((value) => Boolean(value.fileId) !== Boolean(value.customerDocumentId), {
    message: 'فایل یا مدرک پروفایل را مشخص کنید.', path: ['fileId'],
  }).parse(req.body);
  const state = await loadDraftState(req.auth!.user.id);
  if (!state) throw notFound('پیش‌نویس فعالی وجود ندارد.');
  const service = await draftService(state);
  if (!service) throw notFound('خدمت این پیش‌نویس در دسترس نیست.');
  const updated = await attachDraftDocument(req.auth!.user.id, state, service, body);
  ok(res, { draft: publicDraft(updated, service) });
}));

assistantRouter.post('/draft/preview', ...customerOnly, draftLimiter, asyncRoute(async (req, res) => {
  const state = await loadDraftState(req.auth!.user.id);
  if (!state) throw notFound('پیش‌نویس فعالی وجود ندارد.');
  const service = await draftService(state);
  if (!service) throw notFound('خدمت این پیش‌نویس در دسترس نیست.');
  const refreshed = await refresh(req.auth!.user.id, state, service);
  await saveDraftState(req.auth!.user.id, refreshed);
  ok(res, { draft: publicDraft(refreshed, service) });
}));

/**
 * The only submission path from the assistant. `confirm: true` is a second,
 * explicit flag on top of the stored stage, so a stale UI or a replayed call
 * cannot turn an unreviewed draft into a request.
 */
assistantRouter.post('/draft/confirm', ...customerOnly, draftLimiter, asyncRoute(async (req, res) => {
  z.object({ confirm: z.boolean() })
    .refine((value) => value.confirm === true, { message: 'برای ثبت، تأیید صریح لازم است.', path: ['confirm'] })
    .parse(req.body);
  const reply = await assistantRespond({ action: 'confirm', auth: req.auth, ip: req.ip });
  ok(res, reply);
}));

assistantRouter.post('/draft/cancel', ...customerOnly, draftLimiter, asyncRoute(async (req, res) => {
  const reply = await assistantRespond({ action: 'cancel', auth: req.auth, ip: req.ip });
  ok(res, reply);
}));

assistantRouter.get('/capabilities', asyncRoute(async (req, res) => {
  const customerId = req.auth?.user.kind === 'customer' ? req.auth.user.id : undefined;
  ok(res, {
    authenticated: Boolean(customerId),
    accountAccess: customerId ? await getBool('assistant.account_access') : false,
    requestSubmission: customerId ? await getBool('assistant.request_submission') : false,
    profileAutofill: customerId ? await getBool('assistant.profile_autofill') : false,
    maxSuggestions: await getNumber('assistant.max_suggestions'),
    catalogSize: (await loadAssistantCatalog(customerId)).services.length,
  });
}));
