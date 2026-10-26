import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, rateLimit, requireAuth } from '../http/middleware.js';
import { ok } from '../http/respond.js';
import { assistantRespond } from '../modules/assistant/service.js';
import { getBool, getString } from '../modules/settings/service.js';

export const assistantRouter = Router();

const chatLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'تعداد پیام‌های شما زیاد است. کمی صبر کنید.' });

assistantRouter.post('/chat', chatLimiter, asyncRoute(async (req, res) => {
  const body = z.object({
    message: z.string().min(1).max(1000),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(2000),
    })).max(20).default([]),
  }).parse(req.body);

  const reply = await assistantRespond(body.message, body.history, { customerId: req.auth?.user.id });
  ok(res, reply);
}));

assistantRouter.get('/info', asyncRoute(async (_req, res) => {
  ok(res, {
    enabled: await getBool('assistant.enabled'),
    name: await getString('assistant.name'),
    welcome: await getString('assistant.welcome'),
    disclaimer: await getString('assistant.disclaimer'),
    catalogOnly: await getBool('assistant.catalog_only'),
  });
}));
