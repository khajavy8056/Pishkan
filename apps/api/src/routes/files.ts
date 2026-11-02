import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { one, q, run } from '../db/index.js';
import { officeScope } from '../lib/scope.js';
import { hasPermission } from '../lib/permissions.js';
import { env } from '../env.js';
import { getNumber } from '../modules/settings/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { param } from '../http/params.js';
import { validateUploadContent } from '../modules/media/validation.js';
import {
  ensureMediaDirs, fileAccessHistory, fileShape, getFile, ingestUpload, loadMediaConfig,
  logFileAccess, mediaStats, pruneOriginals, removeFileArtifacts, reprocessFile,
  resolveStoragePath, type FileRow,
} from '../modules/media/service.js';

export const filesRouter = Router();

ensureMediaDirs();

/* -------------------------------------------------------------------------- */
/*                                   upload                                   */
/* -------------------------------------------------------------------------- */

const incomingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(env.uploadDir, 'incoming');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  // The served name is generated later from the *verified* MIME type. The
  // client filename never touches the filesystem.
  filename: (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}.part`),
});

async function multerMiddleware() {
  const cfg = await loadMediaConfig();
  return multer({
    storage: incomingStorage,
    limits: { fileSize: cfg.maxBytes, files: 1, fields: 8 },
    fileFilter: (_req, file, cb) => {
      const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
      if (!cfg.allowedTypes.includes(ext)) {
        return cb(badRequest(`پسوند .${ext || '—'} مجاز نیست. فرمت‌های مجاز: ${cfg.allowedTypes.join(', ')}`));
      }
      cb(null, true);
    },
  }).single('file');
}

filesRouter.post('/upload', requireAuth, asyncRoute(async (req, res, next) => {
  const middleware = await multerMiddleware();
  middleware(req, res, (err: any) => {
    if (err) return next(err);
    (async () => {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) throw badRequest('فایلی انتخاب نشده است.');
      const cleanup = () => { try { fs.rmSync(file.path, { force: true }); } catch { /* ignore */ } };
      try {
        const purpose = typeof req.query.purpose === 'string' ? req.query.purpose.slice(0, 40) : 'document';
        const isPublic = req.query.public === 'true' && hasPermission(req.auth!.permissions, 'settings.edit');
        const cfg = await loadMediaConfig();
        const validated = await validateUploadContent({
          filePath: file.path,
          originalName: file.originalname,
          size: file.size,
          allowedTypes: cfg.allowedTypes,
          imagePolicy: cfg.policy,
        });

        const result = await ingestUpload({
          tempPath: file.path,
          originalName: file.originalname,
          mime: validated.mime,
          size: file.size,
          ownerId: req.auth!.user.id,
          purpose,
          isPublic,
          actor: { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip },
        });

        res.status(201).json({
          ok: true,
          data: {
            ...fileShape(result.file),
            notes: result.notes,
            // Back-compat aliases used by older clients.
            id: result.file.id,
            name: result.file.name,
            mime: result.file.mime,
            size: Number(result.file.size),
            url: fileShape(result.file).url,
          },
        });
      } catch (error: any) {
        cleanup();
        if (error?.statusCode === 400) throw badRequest(error.message);
        throw error;
      }
    })().catch(next);
  });
}));

/* -------------------------------------------------------------------------- */
/*                              shared access model                           */
/* -------------------------------------------------------------------------- */

interface AuthLike {
  user: { id: string; kind: string; roleCode: string; fullName?: string };
  permissions: string[] | '*';
}

async function loadAuthorizedFile(req: any, fileId: string): Promise<FileRow> {
  const file = await getFile(fileId);
  if (!file) throw notFound('فایل یافت نشد.');
  const auth = req.auth as AuthLike;
  const isSuperAdmin = auth.user.roleCode === 'super_admin' || auth.permissions === '*';

  if (isSuperAdmin) return file;

  if (auth.user.kind === 'customer') {
    const ownRequestDocument = await one(
      `SELECT d.id FROM request_documents d JOIN requests r ON r.id = d.request_id
       WHERE d.file_id = ? AND r.customer_id = ? AND (d.kind <> 'staff' OR d.status = 'approved') LIMIT 1`,
      [file.id, auth.user.id],
    );
    const ownMessage = ownRequestDocument ? null : await one(
      `SELECT m.id FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.file_id = ? AND t.customer_id = ? LIMIT 1`, [file.id, auth.user.id],
    );
    const ownProfileDocument = ownRequestDocument || ownMessage ? null : await one(
      'SELECT id FROM customer_documents WHERE file_id = ? AND customer_id = ? LIMIT 1',
      [file.id, auth.user.id],
    );
    if (ownRequestDocument || ownMessage || ownProfileDocument) return file;
    if (file.owner_id === auth.user.id && !(await isLinkedToCase(file.id))) return file;
    throw forbidden('دسترسی به این فایل مجاز نیست.');
  }

  if (hasPermission(auth.permissions, 'documents.view')) {
    const assignedDocument = await one(
      `SELECT d.id FROM request_documents d JOIN requests r ON r.id = d.request_id
       WHERE d.file_id = ? AND (r.assigned_to = ? OR (? = 1)) LIMIT 1`,
      [file.id, auth.user.id, officeScope(auth) ? 1 : 0],
    );
    if (assignedDocument) return file;
    if (officeScope(auth)) {
      const profileDocument = await one('SELECT id FROM customer_documents WHERE file_id = ? LIMIT 1', [file.id]);
      if (profileDocument) return file;
    } else {
      const scopedProfileDocument = await one(
        `SELECT d.id FROM customer_documents d
         WHERE d.file_id = ? AND EXISTS(
           SELECT 1 FROM requests r WHERE r.customer_id = d.customer_id AND r.assigned_to = ?
         ) LIMIT 1`,
        [file.id, auth.user.id],
      );
      if (scopedProfileDocument) return file;
    }
  }
  const assignedMessage = hasPermission(auth.permissions, 'messages.view') ? await one(
    `SELECT m.id FROM messages m JOIN threads t ON t.id = m.thread_id
     WHERE m.file_id = ? AND (t.assigned_to = ? OR EXISTS(
       SELECT 1 FROM requests r WHERE r.id = t.request_id AND r.assigned_to = ?
     )) LIMIT 1`, [file.id, auth.user.id, auth.user.id],
  ) : null;
  if (assignedMessage) return file;
  if (file.owner_id === auth.user.id && !(await isLinkedToCase(file.id))) return file;
  throw forbidden('دسترسی به این فایل مجاز نیست.');
}

/**
 * Ownership alone never bypasses case scope: once a file is attached to a case
 * or a thread, access is decided by that link, not by who uploaded it.
 */
async function isLinkedToCase(fileId: string): Promise<boolean> {
  const linked = await one(
    `SELECT 1 AS linked FROM request_documents WHERE file_id = ?
     UNION SELECT 1 FROM messages WHERE file_id = ?
     UNION SELECT 1 FROM customer_documents WHERE file_id = ? LIMIT 1`,
    [fileId, fileId, fileId],
  );
  return Boolean(linked);
}

function canReadOriginal(file: FileRow, auth: AuthLike): boolean {
  if (file.owner_id === auth.user.id) return true;
  if (auth.user.roleCode === 'super_admin' || auth.permissions === '*') return true;
  if (officeScope(auth) && hasPermission(auth.permissions, 'documents.view')) return true;
  return hasPermission(auth.permissions, 'documents.approve');
}

/* -------------------------------------------------------------------------- */
/*                                  serving                                   */
/* -------------------------------------------------------------------------- */

filesRouter.get('/media/stats', requirePermission('documents.view'), asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!) && req.auth!.permissions !== '*') throw forbidden('آمار رسانه فقط برای مدیریت است.');
  ok(res, await mediaStats());
}));

filesRouter.get('/media/diagnostics', requirePermission('documents.view'), asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!) && req.auth!.permissions !== '*') throw forbidden();
  ok(res, {
    engine: { sharp: true, webp: true },
    queue: (await mediaStats()).queue,
    config: await loadMediaConfig().then((cfg) => ({ qualityMode: cfg.policy.qualityMode, maxPixels: cfg.policy.maxPixels, maxDimension: cfg.policy.maxDimension, previewMaxWidth: cfg.policy.previewMaxWidth })),
    uploadDirWritable: fs.existsSync(env.uploadDir),
    pending: (await mediaStats()).byStatus,
  });
}));

filesRouter.post('/media/prune-originals', requirePermission('documents.approve'), asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!) && req.auth!.permissions !== '*') throw forbidden();
  const body = z.object({
    dryRun: z.boolean().default(true),
    confirm: z.string().optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  }).parse(req.body ?? {});
  if (!body.dryRun && body.confirm !== 'حذف نسخه اصلی') {
    throw badRequest('برای حذف واقعی، عبارت «حذف نسخه اصلی» را در فیلد confirm وارد کنید.');
  }
  const result = await pruneOriginals({ dryRun: body.dryRun, retentionDays: body.retentionDays });
  if (!body.dryRun && result.deleted > 0) {
    await writeAudit({
      actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'file.prune_originals',
      entityType: 'file', after: result, ip: req.ip,
    });
  }
  ok(res, { ...result, dryRun: body.dryRun });
}));

filesRouter.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const file = await loadAuthorizedFile(req, param(req, 'id'));
  const auth = req.auth as AuthLike & { user: { roleCode: string } };
  const requested = typeof req.query.variant === 'string' ? req.query.variant : 'display';
  if (!['display', 'preview', 'original'].includes(requested)) throw badRequest('نوع نسخه درخواستی معتبر نیست.');

  let storageKey: string;
  let mime: string;
  if (requested === 'preview') {
    if (!file.preview_storage_key) throw notFound('پیش‌نمایشی برای این فایل ساخته نشده است.');
    storageKey = file.preview_storage_key;
    mime = 'image/webp';
  } else if (requested === 'original') {
    if (!canReadOriginal(file, auth)) throw forbidden('دسترسی به نسخه اصلی این مدرک مجاز نیست.');
    storageKey = file.original_storage_key ?? file.storage_key;
    mime = file.original_mime ?? file.mime;
  } else {
    storageKey = file.storage_key;
    mime = file.mime;
  }

  const absolute = resolveStoragePath(storageKey);
  if (!fs.existsSync(absolute)) throw notFound('فایل روی سرور موجود نیست.');

  if (!file.is_public) {
    await logFileAccess({
      fileId: file.id, actorId: auth.user.id, actorRole: auth.user.roleCode,
      action: requested === 'preview' ? 'preview' : requested === 'original' ? 'original' : 'view',
      variant: requested, ip: req.ip, userAgent: req.header('user-agent'),
    });
  }

  const inline = ['image/jpeg', 'image/png', 'image/webp'].includes(mime);
  const download = req.query.download === 'true' || !inline;
  const fileName = requested === 'original' ? file.name : inline ? `${path.parse(file.name).name}.webp` : file.name;
  res.setHeader('content-type', mime || 'application/octet-stream');
  res.setHeader('content-disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('x-content-type-options', 'nosniff');
  if (mime === 'application/pdf') res.setHeader('content-security-policy', "default-src 'none'; object-src 'none'; sandbox");
  if (file.sha256) res.setHeader('etag', `"${file.sha256.slice(0, 32)}-${requested}"`);
  res.setHeader('cache-control', 'private, no-store');
  fs.createReadStream(absolute).on('error', () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
}));

filesRouter.get('/:id/status', requireAuth, asyncRoute(async (req, res) => {
  const file = await loadAuthorizedFile(req, param(req, 'id'));
  ok(res, { id: file.id, processing: fileShape(file).processing, savingsPercent: Number(file.savings_percent ?? 0) });
}));

filesRouter.post('/:id/reprocess', requirePermission('documents.approve'), asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!) && req.auth!.permissions !== '*') throw forbidden('پردازش دوباره فقط توسط مدیریت مجاز است.');
  const file = await loadAuthorizedFile(req, param(req, 'id'));
  const outcome = await reprocessFile(file.id, { id: req.auth!.user.id, name: req.auth!.user.fullName, ip: req.ip });
  ok(res, { ...fileShape(outcome.file), notes: outcome.notes });
}));

filesRouter.get('/:id/history', requirePermission('documents.view'), asyncRoute(async (req, res) => {
  if (!officeScope(req.auth!) && req.auth!.permissions !== '*') throw forbidden();
  const file = await getFile(param(req, 'id'));
  if (!file) throw notFound('فایل یافت نشد.');
  ok(res, await fileAccessHistory(file.id, Number(req.query.limit ?? 50)));
}));

filesRouter.get('/', requireAuth, asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const rows = await q<FileRow>(
    'SELECT * FROM files WHERE owner_id = ? AND is_public = 0 ORDER BY created_at DESC LIMIT 100',
    [auth.user.id],
  );
  ok(res, rows.map(fileShape));
}));

filesRouter.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const auth = req.auth as AuthLike & { user: { id: string } };
  const file = await getFile(param(req, 'id'));
  if (!file) throw notFound('فایل یافت نشد.');
  const isOwner = file.owner_id === auth.user.id;
  const officeDelete = officeScope(auth) && hasPermission(auth.permissions, 'documents.delete');
  if (!isOwner && !officeDelete) throw forbidden();

  const used = await one('SELECT id FROM request_documents WHERE file_id = ? LIMIT 1', [file.id]);
  if (used) throw badRequest('این فایل به یک پرونده متصل است و حذف نمی‌شود.');
  const profileDocument = await one('SELECT id FROM customer_documents WHERE file_id = ? LIMIT 1', [file.id]);
  if (profileDocument) throw badRequest('این فایل در مدارک پروفایل ثبت شده است؛ ابتدا مدرک پروفایل را حذف کنید.');
  const attachedToMessage = await one('SELECT id FROM messages WHERE file_id = ? LIMIT 1', [file.id]);
  if (attachedToMessage) throw badRequest('این فایل در گفت‌وگو استفاده شده و حذف نمی‌شود.');

  await removeFileArtifacts(file);
  await run('DELETE FROM file_access_logs WHERE file_id = ?', [file.id]);
  await run('DELETE FROM files WHERE id = ?', [file.id]);
  await writeAudit({
    actorId: auth.user.id, actorName: auth.user.fullName, action: 'file.delete',
    entityType: 'file', entityId: file.id,
    before: { name: file.name, size: Number(file.size), mode: file.processing_mode }, ip: req.ip,
  });
  ok(res, { message: 'فایل حذف شد.' });
}));

// `/meta/limits` is the current path; `/meta/config` stays for older clients.
const limitsHandler = asyncRoute(async (_req: any, res: any) => {
  const cfg = await loadMediaConfig();
  ok(res, {
    maxSizeMb: Math.round(cfg.maxBytes / 1024 / 1024),
    types: cfg.allowedTypes,
    privateByDefault: true,
    retentionDays: await getNumber('files.retention_days'),
    processing: { images: cfg.processImages, mode: cfg.policy.qualityMode, previewMaxWidth: cfg.policy.previewMaxWidth },
  });
});
filesRouter.get('/meta/limits', requireAuth, limitsHandler);
filesRouter.get('/meta/config', requireAuth, limitsHandler);
