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
import { getJson, getNumber } from '../modules/settings/service.js';
import { hasPermission } from '../lib/permissions.js';
import { env } from '../env.js';
import { writeAudit } from '../modules/audit/service.js';
import { param } from '../http/params.js';

export const filesRouter = Router();

const DEFAULT_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const MIME_BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

function sniffMime(filePath: string): string | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const signature = Buffer.alloc(12);
    const size = fs.readSync(fd, signature, 0, signature.length, 0);
    const bytes = signature.subarray(0, size);
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

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
        return cb(badRequest(`پسوند .${ext} مجاز نیست. فرمت‌های مجاز: ${cfg.types.join(', ')}`));
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

      const extension = path.extname(file.originalname).slice(1).toLowerCase();
      const actualMime = sniffMime(file.path);
      if (!actualMime || MIME_BY_EXTENSION[extension] !== actualMime) {
        fs.rmSync(file.path, { force: true });
        throw badRequest('محتوای فایل با قالب مجاز یا پسوند آن مطابقت ندارد.');
      }
      const checksum = await sha256File(file.path);
      const fileId = id('file');
      const storageKey = path.join('private', file.filename);

      const finalPath = isPublic
        ? path.join(env.uploadDir, 'public', file.filename)
        : file.path;
      if (isPublic) {
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        fs.renameSync(file.path, finalPath);
      }

      try {
        await run(
          `INSERT INTO files (id, owner_id, name, mime, size, storage_key, sha256, is_public, purpose, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [fileId, req.auth!.user.id, sanitizeName(file.originalname), actualMime, file.size,
            isPublic ? path.join('public', file.filename) : storageKey, checksum, isPublic ? 1 : 0, purpose, nowIso()],
        );
      } catch (error) {
        fs.rmSync(finalPath, { force: true });
        throw error;
      }

      res.status(201).json({
        ok: true,
        data: {
          id: fileId,
          name: sanitizeName(file.originalname),
          mime: actualMime,
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
  const isSuperAdmin = auth.user.roleCode === 'super_admin' || auth.permissions === '*';
  const hasProtectedLink = Boolean(await one(
    `SELECT id FROM request_documents WHERE file_id = ?
     UNION SELECT id FROM messages WHERE file_id = ? LIMIT 1`, [file.id, file.id],
  ));
  let allowed = isSuperAdmin;
  if (!allowed && auth.user.kind === 'customer') {
    const ownRequestDocument = await one(
      `SELECT d.id FROM request_documents d JOIN requests r ON r.id = d.request_id
       WHERE d.file_id = ? AND r.customer_id = ? AND (d.kind <> 'staff' OR d.status = 'approved') LIMIT 1`,
      [file.id, auth.user.id],
    );
    const ownMessage = ownRequestDocument ? null : await one(
      `SELECT m.id FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.file_id = ? AND t.customer_id = ? LIMIT 1`, [file.id, auth.user.id],
    );
    allowed = Boolean(ownRequestDocument || ownMessage || (!hasProtectedLink && file.owner_id === auth.user.id));
  } else if (!allowed && auth.user.kind !== 'customer') {
    const assignedDocument = hasPermission(auth.permissions, 'documents.view') ? await one(
      `SELECT d.id FROM request_documents d JOIN requests r ON r.id = d.request_id
       WHERE d.file_id = ? AND r.assigned_to = ? LIMIT 1`, [file.id, auth.user.id],
    ) : null;
    const assignedMessage = !assignedDocument && hasPermission(auth.permissions, 'messages.view') ? await one(
      `SELECT m.id FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.file_id = ? AND (t.assigned_to = ? OR EXISTS(
         SELECT 1 FROM requests r WHERE r.id = t.request_id AND r.assigned_to = ?
       )) LIMIT 1`, [file.id, auth.user.id, auth.user.id],
    ) : null;
    // Staff-owned unattached files remain manageable by their uploader, but
    // ownership alone never bypasses case/thread scope for attached content.
    allowed = Boolean(assignedDocument || assignedMessage || (!hasProtectedLink && file.owner_id === auth.user.id));
  }
  if (!allowed) throw forbidden('دسترسی به این فایل مجاز نیست.');

  const absolute = path.resolve(env.uploadDir, file.storage_key);
  const relative = path.relative(path.resolve(env.uploadDir), absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw forbidden();
  if (!fs.existsSync(absolute)) throw notFound('فایل روی سرور موجود نیست.');

  const safeInline = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mime);
  res.setHeader('content-type', file.mime || 'application/octet-stream');
  res.setHeader('content-disposition', `${safeInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`);
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
    const absolute = path.resolve(env.uploadDir, file.storage_key);
    const relative = path.relative(path.resolve(env.uploadDir), absolute);
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && fs.existsSync(absolute)) fs.unlinkSync(absolute);
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
    privateByDefault: true,
    retentionDays: await getNumber('files.retention_days'),
  });
}));
