import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { ok, created } from '../http/respond.js';
import { param } from '../http/params.js';
import {
  createMailbox, deleteMailbox, gmailConnectionInfo, listBoxboxes,
  mailServerStatus, setMailboxActive, setMailboxPassword,
} from '../modules/mailboxes/service.js';

export const mailboxesRouter = Router();
mailboxesRouter.use(requireAuth);

/** Server status + the configured organizational domain + Gmail connection info. */
mailboxesRouter.get('/status', requirePermission('settings.view'), asyncRoute(async (_req, res) => {
  const status = await mailServerStatus();
  const gmail = await gmailConnectionInfo();
  ok(res, { status, gmail });
}));

mailboxesRouter.get('/', requirePermission('settings.view'), asyncRoute(async (_req, res) => {
  ok(res, await listBoxboxes());
}));

mailboxesRouter.post('/', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({
    localPart: z.string().min(1).max(31),
    password: z.string().min(8).max(128),
    displayName: z.string().max(80).optional(),
  }).parse(req.body);
  const row = await createMailbox({
    localPart: body.localPart,
    password: body.password,
    displayName: body.displayName,
    actorId: req.auth!.user.id,
    actorName: req.auth!.user.fullName,
    ip: req.ip,
  });
  created(res, row);
}));

mailboxesRouter.put('/:address/password', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ password: z.string().min(8).max(128) }).parse(req.body);
  await setMailboxPassword(param(req, 'address'), body.password, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip,
  });
  ok(res, { message: 'رمز صندوق تغییر کرد.' });
}));

mailboxesRouter.put('/:address/active', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  const body = z.object({ active: z.boolean() }).parse(req.body);
  const row = await setMailboxActive(param(req, 'address'), body.active, {
    id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip,
  });
  ok(res, row);
}));

mailboxesRouter.delete('/:address', requirePermission('settings.edit'), asyncRoute(async (req, res) => {
  await deleteMailbox(param(req, 'address'), { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  ok(res, { message: 'صندوق حذف شد.' });
}));
