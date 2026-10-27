import { officeScope } from '../lib/scope.js';
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { asyncRoute, requireAuth } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { ok } from '../http/respond.js';
import { one, q, run, nowIso, jsonParse } from '../db/index.js';
import { id } from '../lib/crypto.js';
import { getJson, getNumber, getBool } from '../modules/settings/service.js';
import { hasPermission } from '../lib/permissions.js';
import { env } from '../env.js';
import { writeAudit } from '../modules/audit/service.js';
import { param } from '../http/params.js';

export const filesRouter = Router();

const DEFAULT_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];

async function uploadConfig() {
  const maxSizeMb = await getNumber('files.max_size_mb');
  const types = await getJson<string[]>('files.allowed_types', DEFAULT_TYPES);
  return { maxBytes: Math.max(1, maxSizeMb) * 1024 * 1024, types: types.map((t) => t.toLowerCase().replace(/^\./, '')) };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(env.uploadDir, 'private');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

async function multerMiddleware() {
  const cfg = await uploadConfig();
  return multer({
    storage,
    limits: { fileSize: cfg.maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      if (!cfg.types.includes(ext)) {
        return cb(new Error(`پسوند .${ext} مجاز نیست. فرمت‌های مجاز: ${cfg.types.join(', ')}`));
      }
      cb(null, true);
    },
  }).single('file');
}

const sanitizeName = (name: string) => path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180);

filesRouter.post('/upload', requireAuth, asyncRoute(async (req, res, next) => {
  const middleware = await multerMiddleware();
  middleware(req, res, (err: any) => {
    if (err) return next(err);
    (async () => {
      const file = (req as any).file;
      if (!file) throw badRequest('فایلی انتخاب نشده است.');
      const purpose = typeof req.query.purpose === 'string' ? req.query.purpose.slice(0, 40) : 'document';
      const isPublic = req.query.public === 'true' && hasPermission(req.auth!.permissions, 'settings.edit');

      const buffer = fs.readFileSync(file.path);
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      const fileId = id('file');
      const storageKey = path.join('private', file.filename);

      if (isPublic) {
        const publicDir = path.join(env.uploadDir, 'public');
        fs.mkdirSync(publicDir, { recursive: true });
        fs.renameSync(file.path, path.join(publicDir, file.filename));
      }

      await run(
        `INSERT INTO files (id, owner_id, name, mime, size, storage_key, sha256, is_public, purpose, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fileId, req.auth!.user.id, sanitizeName(file.originalname), file.mimetype, file.size,
          isPublic ? path.join('public', file.filename) : storageKey, checksum, isPublic ? 1 : 0, purpose, nowIso()],
      );

      res.status(201).json({
        ok: true,
        data: {
          id: fileId,
          name: sanitizeName(file.originalname),
          mime: file.mimetype,
          size: file.size,
          url: isPublic ? `/uploads/public/${file.filename}` : `/api/files/${fileId}`,
        },
      });
    })().catch(next);
  });
}));

/** Authenticated download — customers may only read their own documents. */
filesRouter.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const file = await one<any>('SELECT * FROM files WHERE id = ?', [param(req, 'id')]);
  if (!file) throw notFound('فایل یافت نشد.');

  const auth = req.auth!;
  let allowed = file.owner_id === auth.user.id || officeScope(auth);
  if (!allowed && auth.user.kind !== 'customer') {
    allowed = hasPermission(auth.permissions, 'documents.view') && Boolean(await one('SELECT d.id FROM request_documents d JOIN requests r ON r.id=d.request_id WHERE d.file_id=? AND r.assigned_to=?',[file.id,auth.user.id]));
  }
  if (!allowed) {
    const linked = await one(
      `SELECT d.id FROM request_documents d JOIN requests r ON r.id = d.request_id
       WHERE d.file_id = ? AND r.customer_id = ? AND (d.kind<>'staff' OR d.status='approved')`, [file.id, auth.user.id],
    );
    allowed = Boolean(linked);
  }
  if (!allowed) throw forbidden('دسترسی به این فایل مجاز نیست.');

  const absolute = path.join(env.uploadDir, file.storage_key);
  if (!absolute.startsWith(path.resolve(env.uploadDir))) throw forbidden();
  if (!fs.existsSync(absolute)) throw notFound('فایل روی سرور موجود نیست.');

  res.setHeader('content-type', file.mime || 'application/octet-stream');
  res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
  res.setHeader('x-content-type-options', 'nosniff');
  fs.createReadStream(absolute).pipe(res);
}));

filesRouter.get('/', requireAuth, asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const rows = await q<any>(
    `SELECT * FROM files WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100`, [auth.user.id],
  );
  ok(res, rows.map((f) => ({
    id: f.id, name: f.name, mime: f.mime, size: Number(f.size), purpose: f.purpose,
    isPublic: Boolean(f.is_public), createdAt: f.created_at,
    url: f.is_public ? `/uploads/public/${path.basename(f.storage_key)}` : `/api/files/${f.id}`,
  })));
}));

filesRouter.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const file = await one<any>('SELECT * FROM files WHERE id = ?', [param(req, 'id')]);
  if (!file) throw notFound('فایل یافت نشد.');
  if (file.owner_id !== req.auth!.user.id && !(officeScope(req.auth!) && hasPermission(req.auth!.permissions, 'documents.delete'))) {
    throw forbidden();
  }
  const used = await one('SELECT id FROM request_documents WHERE file_id = ? LIMIT 1', [file.id]);
  if (used) throw badRequest('این فایل به یک پرونده متصل است و حذف نمی‌شود.');

  try {
    const absolute = path.join(env.uploadDir, file.storage_key);
    if (absolute.startsWith(path.resolve(env.uploadDir)) && fs.existsSync(absolute)) fs.unlinkSync(absolute);
  } catch { /* file already gone */ }

  await run('DELETE FROM files WHERE id = ?', [file.id]);
  await writeAudit({
    actorId: req.auth!.user.id, actorName: req.auth!.user.fullName, action: 'file.delete',
    entityType: 'file', entityId: file.id, ip: req.ip,
  });
  ok(res, { message: 'فایل حذف شد.' });
}));

filesRouter.get('/meta/config', requireAuth, asyncRoute(async (_req, res) => {
  const cfg = await uploadConfig();
  ok(res, {
    maxSizeMb: Math.round(cfg.maxBytes / 1024 / 1024),
    types: cfg.types,
    privateByDefault: !(await getBool('files.retention_days')),
  });
}));
