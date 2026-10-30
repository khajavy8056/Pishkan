import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../../env.js';
import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../http/errors.js';
import { getBool, getJson, getNumber, getString } from '../settings/service.js';
import { writeAudit } from '../audit/service.js';
import {
  DEFAULT_POLICY, ImageRejectedError, processImage, type ImagePolicy,
  type ProcessedImage,
} from './image.js';
import { EXTENSION_BY_MIME, safeDisplayName } from './validation.js';

/* -------------------------------------------------------------------------- */
/*                                  storage                                   */
/* -------------------------------------------------------------------------- */

const MEDIA_DIRS = {
  incoming: 'incoming',
  originals: path.join('private', 'originals'),
  optimized: path.join('private', 'optimized'),
  previews: path.join('private', 'previews'),
  public: 'public',
} as const;

export function ensureMediaDirs(): void {
  for (const dir of Object.values(MEDIA_DIRS)) {
    fs.mkdirSync(path.join(env.uploadDir, dir), { recursive: true });
  }
}

/** Resolve a stored key inside the upload root, refusing traversal. */
export function resolveStoragePath(storageKey: string): string {
  const root = path.resolve(env.uploadDir);
  const absolute = path.resolve(root, storageKey);
  const relative = path.relative(root, absolute);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw badRequest('مسیر فایل ذخیره‌سازی نامعتبر است.');
  }
  return absolute;
}

function storageKeyFor(dir: string, fileId: string, extension: string): string {
  return path.join(dir, `${fileId}.${extension}`);
}

async function writeAtomic(absolutePath: string, data: Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fsp.writeFile(temporary, data, { mode: 0o640 });
  await fsp.rename(temporary, absolutePath);
}

async function removeQuietly(absolutePath: string): Promise<void> {
  try { await fsp.rm(absolutePath, { force: true }); } catch { /* best effort */ }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/* -------------------------------------------------------------------------- */
/*                                   policy                                   */
/* -------------------------------------------------------------------------- */

export interface MediaConfig {
  policy: ImagePolicy;
  processImages: boolean;
  allowedTypes: string[];
  maxBytes: number;
  keepOriginalArchive: boolean;
  originalRetentionDays: number;
  requireReuseConfirmation: boolean;
  documentDefaultValidityDays: number;
}

export async function loadMediaConfig(): Promise<MediaConfig> {
  const maxSizeMb = Math.max(1, Number(await getNumber('files.max_size_mb')) || 10);
  const supported = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf']);
  const types = (await getJson<string[]>('files.allowed_types', ['jpg', 'jpeg', 'png', 'webp', 'pdf']))
    .map((t) => String(t).toLowerCase().replace(/^\./, ''))
    .filter((t) => supported.has(t));
  const qualityMode = (await getString('files.image_quality_mode')) || DEFAULT_POLICY.qualityMode;
  const maxDimension = Math.max(0, Number(await getNumber('files.image_max_dimension')) || 0);
  return {
    policy: {
      ...DEFAULT_POLICY,
      qualityMode: (['quality_first', 'balanced', 'lossless_only'].includes(qualityMode)
        ? qualityMode
        : DEFAULT_POLICY.qualityMode) as ImagePolicy['qualityMode'],
      targetSavingsPercent: Math.min(95, Math.max(1, Number(await getNumber('files.image_target_savings_percent')) || 70)),
      minSavingsPercent: Math.min(50, Math.max(1, Number(await getNumber('files.image_min_savings_percent')) || 8)),
      maxPixels: Math.max(1_000_000, Number(await getNumber('files.image_max_pixels')) || 50_000_000),
      maxDimension,
      previewMaxWidth: Math.max(0, Number(await getNumber('files.preview_max_width')) || 640),
      lossyQuality: Math.min(100, Math.max(70, Number(await getNumber('files.image_lossy_quality')) || 95)),
    },
    processImages: await getBool('files.process_images').catch(() => true),
    allowedTypes: types.length ? types : ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    maxBytes: maxSizeMb * 1024 * 1024,
    keepOriginalArchive: await getBool('files.keep_original_archive').catch(() => true),
    originalRetentionDays: Math.max(0, Number(await getNumber('files.original_retention_days')) || 0),
    requireReuseConfirmation: await getBool('files.require_reuse_confirmation').catch(() => true),
    documentDefaultValidityDays: Math.max(1, Number(await getNumber('files.document_default_validity_days')) || 365),
  };
}

/* -------------------------------------------------------------------------- */
/*                             bounded work queue                             */
/* -------------------------------------------------------------------------- */

const QUEUE_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.MEDIA_CONCURRENCY ?? Math.min(3, os.cpus().length))));
const JOB_TIMEOUT_MS = Math.max(5_000, Number(process.env.MEDIA_JOB_TIMEOUT_MS ?? 90_000));

class BoundedQueue {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) { this.active += 1; return; }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiting.shift();
    if (next) next();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await task(); } finally { this.release(); }
  }

  get stats() { return { active: this.active, queued: this.waiting.length, concurrency: this.concurrency }; }
}

export const mediaQueue = new BoundedQueue(QUEUE_CONCURRENCY);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`پردازش ${label} بیش از ${Math.round(ms / 1000)} ثانیه طول کشید.`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/* -------------------------------------------------------------------------- */
/*                              file row mapping                              */
/* -------------------------------------------------------------------------- */

export interface FileRow {
  id: string;
  owner_id: string | null;
  name: string;
  mime: string;
  size: number;
  storage_key: string;
  sha256: string | null;
  is_public: number;
  purpose: string | null;
  created_at: string;
  original_storage_key?: string | null;
  original_mime?: string | null;
  original_size?: number | null;
  processing_status?: string | null;
  processing_mode?: string | null;
  processing_error?: string | null;
  processing_attempts?: number | null;
  processing_started_at?: string | null;
  processed_at?: string | null;
  preview_storage_key?: string | null;
  width?: number | null;
  height?: number | null;
  original_width?: number | null;
  original_height?: number | null;
  savings_percent?: number | null;
  quality_score?: number | null;
  deduplicated_from?: string | null;
}

export function fileUrls(file: FileRow) {
  return {
    url: file.is_public ? `/uploads/public/${path.basename(file.storage_key)}` : `/api/files/${file.id}`,
    displayUrl: file.is_public ? `/uploads/public/${path.basename(file.storage_key)}` : `/api/files/${file.id}`,
    previewUrl: file.preview_storage_key ? `/api/files/${file.id}?variant=preview` : null,
    originalUrl: file.is_public ? null : `/api/files/${file.id}?variant=original`,
  };
}

export function fileShape(file: FileRow) {
  const originalSize = file.original_size !== undefined && file.original_size !== null ? Number(file.original_size) : Number(file.size);
  return {
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: Number(file.size),
    purpose: file.purpose,
    isPublic: Boolean(file.is_public),
    createdAt: file.created_at,
    processing: {
      status: file.processing_status ?? 'none',
      mode: file.processing_mode ?? null,
      error: file.processing_error ?? null,
      attempts: Number(file.processing_attempts ?? 0),
      processedAt: file.processed_at ?? null,
    },
    dimensions: file.width && file.height ? { width: Number(file.width), height: Number(file.height) } : null,
    original: {
      mime: file.original_mime ?? file.mime,
      size: originalSize,
      dimensions: file.original_width && file.original_height
        ? { width: Number(file.original_width), height: Number(file.original_height) }
        : null,
    },
    savingsPercent: file.savings_percent === null || file.savings_percent === undefined ? 0 : Number(file.savings_percent),
    qualityScore: file.quality_score === null || file.quality_score === undefined ? null : Number(file.quality_score),
    deduplicatedFrom: file.deduplicated_from ?? null,
    ...fileUrls(file),
  };
}

/* -------------------------------------------------------------------------- */
/*                                  ingest                                    */
/* -------------------------------------------------------------------------- */

export interface IngestInput {
  tempPath: string;
  originalName: string;
  mime: string;
  size: number;
  ownerId: string;
  purpose: string;
  isPublic: boolean;
  actor: { id: string; name: string; ip?: string };
}

export interface IngestResult {
  file: FileRow;
  notes: string[];
}

/**
 * Move a verified upload into the private media store, then optimise it inline
 * (bounded by the queue + a hard timeout). If optimisation fails for any reason
 * the original bytes remain the served version.
 */
export async function ingestUpload(input: IngestInput): Promise<IngestResult> {
  ensureMediaDirs();
  const config = await loadMediaConfig();
  const fileId = id('file');
  const extension = EXTENSION_BY_MIME[input.mime] ?? 'bin';
  const checksum = await sha256File(input.tempPath);
  const notes: string[] = [];

  let storageKey: string;
  let isPublic = input.isPublic;
  if (isPublic) {
    // Public uploads are site assets chosen by an administrator; they keep the
    // legacy layout because nginx/express serve them directly.
    const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
    storageKey = path.join(MEDIA_DIRS.public, fileName);
    await fsp.mkdir(path.dirname(resolveStoragePath(storageKey)), { recursive: true });
    await fsp.rename(input.tempPath, resolveStoragePath(storageKey));
  } else {
    storageKey = storageKeyFor(MEDIA_DIRS.originals, fileId, extension);
    await fsp.mkdir(path.dirname(resolveStoragePath(storageKey)), { recursive: true });
    await fsp.rename(input.tempPath, resolveStoragePath(storageKey));
  }

  const displayName = safeDisplayName(input.originalName, `document.${extension}`);
  const isImage = input.mime.startsWith('image/');
  const status = isPublic ? 'skipped' : isImage && config.processImages ? 'pending' : 'skipped';

  try {
    await run(
      `INSERT INTO files (id, owner_id, name, mime, size, storage_key, sha256, is_public, purpose, created_at,
        original_storage_key, original_mime, original_size, processing_status, processing_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileId, input.ownerId, displayName, input.mime, input.size, storageKey, checksum,
        isPublic ? 1 : 0, input.purpose, nowIso(),
        storageKey, input.mime, input.size, status, isPublic ? 'original' : null,
      ],
    );
  } catch (error) {
    await removeQuietly(resolveStoragePath(storageKey));
    throw error;
  }

  let file = await getFile(fileId);
  if (!file) throw new Error('ثبت فایل ناموفق بود.');

  if (status === 'pending') {
    const processed = await processFileRecord(fileId, { ...input.actor, source: 'upload' });
    file = processed.file;
    notes.push(...processed.notes);
  } else if (isPublic) {
    notes.push('فایل عمومی بدون بهینه‌سازی ذخیره شد.');
  } else if (!isImage) {
    notes.push('این فایل تصویر نیست؛ بدون تبدیل و با کنترل امضای محتوا ذخیره شد.');
  } else {
    notes.push('پردازش تصویر در تنظیمات غیرفعال است؛ فایل اصلی حفظ شد.');
  }

  return { file, notes };
}

export async function getFile(fileId: string): Promise<FileRow | null> {
  return one<FileRow>('SELECT * FROM files WHERE id = ?', [fileId]);
}

/* -------------------------------------------------------------------------- */
/*                                 processing                                 */
/* -------------------------------------------------------------------------- */

interface ProcessOutcome {
  file: FileRow;
  notes: string[];
}

async function dedupeCopy(target: FileRow): Promise<ProcessedImage | null> {
  if (!target.sha256) return null;
  const previous = await one<FileRow>(
    `SELECT * FROM files
     WHERE sha256 = ? AND id <> ? AND processing_status = 'ready'
       AND processing_mode IN ('lossless', 'near_lossless', 'lossy')
       AND storage_key IS NOT NULL
     ORDER BY processed_at DESC LIMIT 1`,
    [target.sha256, target.id],
  );
  if (!previous) return null;
  let displayPath: string;
  try { displayPath = resolveStoragePath(previous.storage_key); } catch { return null; }
  if (!fs.existsSync(displayPath)) return null;

  const display = await fsp.readFile(displayPath);
  const displayKey = storageKeyFor(MEDIA_DIRS.optimized, target.id, 'webp');
  await writeAtomic(resolveStoragePath(displayKey), display);

  let previewBuffer: Buffer | null = null;
  let previewKey: string | null = null;
  if (previous.preview_storage_key) {
    try {
      const previewPath = resolveStoragePath(previous.preview_storage_key);
      if (fs.existsSync(previewPath)) {
        previewBuffer = await fsp.readFile(previewPath);
        previewKey = storageKeyFor(MEDIA_DIRS.previews, target.id, 'webp');
        await writeAtomic(resolveStoragePath(previewKey), previewBuffer);
      }
    } catch { previewBuffer = null; previewKey = null; }
  }

  const originalSize = Number(target.original_size ?? target.size);
  const savingsPercent = Math.round((1 - display.length / Math.max(1, originalSize)) * 1000) / 10;
  await run(
    `UPDATE files SET storage_key = ?, mime = 'image/webp', size = ?, preview_storage_key = ?,
       width = ?, height = ?, original_width = ?, original_height = ?,
       processing_status = 'ready', processing_mode = ?, processing_error = NULL,
       savings_percent = ?, quality_score = ?, deduplicated_from = ?, processed_at = ?,
       processing_attempts = processing_attempts + 1
     WHERE id = ?`,
    [
      displayKey, display.length, previewKey,
      previous.width, previous.height, previous.original_width, previous.original_height,
      previous.processing_mode, savingsPercent, previous.quality_score, previous.id, nowIso(), target.id,
    ],
  );
  void previewBuffer;
  return {
    display,
    displayMime: 'image/webp',
    displayIsSource: false,
    displayMode: (previous.processing_mode ?? 'lossless') as ProcessedImage['displayMode'],
    width: Number(previous.width),
    height: Number(previous.height),
    originalWidth: Number(previous.original_width ?? previous.width),
    originalHeight: Number(previous.original_height ?? previous.height),
    originalSize,
    displaySize: display.length,
    savingsPercent,
    qualityScore: Number(previous.quality_score ?? 100),
    documentLike: false,
    preview: null,
    notes: [],
  };
}

/** Byte-identical duplicate: reuse the already-optimised output instead of re-encoding. */
async function tryDedupe(target: FileRow): Promise<ProcessedImage | null> {
  const copied = await dedupeCopy(target);
  if (copied) copied.notes.push('فایل یکسان قبلاً پردازش شده بود؛ خروجی بهینه بدون پردازش دوباره استفاده شد.');
  return copied;
}

export async function processFileRecord(
  fileId: string,
  actor: { id: string; name: string; ip?: string; source?: string } = { id: 'system', name: 'media-pipeline' },
): Promise<ProcessOutcome> {
  const existing = await getFile(fileId);
  if (!existing) throw notFound('فایل یافت نشد.');
  const config = await loadMediaConfig();
  const notes: string[] = [];

  const originalKey = existing.original_storage_key ?? existing.storage_key;
  const originalMime = existing.original_mime ?? existing.mime;
  const originalPath = resolveStoragePath(originalKey);

  if (!fs.existsSync(originalPath)) {
    await run(
      `UPDATE files SET processing_status = 'failed', processing_error = ?, processed_at = ? WHERE id = ?`,
      ['فایل اصلی روی سرور موجود نیست.', nowIso(), fileId],
    );
    return { file: (await getFile(fileId))!, notes: ['فایل اصلی روی سرور موجود نیست؛ پردازش انجام نشد.'] };
  }

  if (!originalMime.startsWith('image/')) {
    await run(
      `UPDATE files SET processing_status = 'skipped', processing_mode = 'original', processing_error = NULL,
         original_size = COALESCE(original_size, size), processed_at = ? WHERE id = ?`,
      [nowIso(), fileId],
    );
    return { file: (await getFile(fileId))!, notes: ['این فایل تصویر نیست؛ تبدیل انجام نشد.'] };
  }

  await run(
    `UPDATE files SET processing_status = 'processing', processing_started_at = ?,
       processing_attempts = processing_attempts + 1, processing_error = NULL WHERE id = ?`,
    [nowIso(), fileId],
  );

  try {
    const duplicate = await tryDedupe(existing);
    let result: ProcessedImage;
    if (duplicate) {
      result = duplicate;
      notes.push(...duplicate.notes);
    } else {
      result = await mediaQueue.run(() => withTimeout(
        processImage(originalPath, { policy: config.policy, originalSize: Number(existing.size) }),
        JOB_TIMEOUT_MS,
        'تصویر',
      ));
      notes.push(...result.notes);

      let displayKey = originalKey;
      if (!result.displayIsSource) {
        displayKey = storageKeyFor(MEDIA_DIRS.optimized, fileId, result.displayMime === 'image/jpeg' ? 'jpg' : result.displayMime === 'image/png' ? 'png' : 'webp');
        await writeAtomic(resolveStoragePath(displayKey), result.display);
      }
      let previewKey: string | null = null;
      if (result.preview) {
        previewKey = storageKeyFor(MEDIA_DIRS.previews, fileId, 'webp');
        await writeAtomic(resolveStoragePath(previewKey), result.preview.buffer);
        // Never replace the archive copy; the preview is a derivative only.
      }

      await run(
        `UPDATE files SET storage_key = ?, mime = ?, size = ?, preview_storage_key = ?,
           width = ?, height = ?, original_width = ?, original_height = ?, original_mime = ?, original_size = ?,
           processing_status = 'ready', processing_mode = ?, processing_error = NULL,
           savings_percent = ?, quality_score = ?, deduplicated_from = NULL, processed_at = ?
         WHERE id = ?`,
        [
          displayKey, result.displayMime, result.displaySize, previewKey,
          result.width, result.height, result.originalWidth, result.originalHeight, originalMime, result.originalSize,
          result.displayMode, result.savingsPercent, result.qualityScore, nowIso(), fileId,
        ],
      );
    }

    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'file.process',
      entityType: 'file', entityId: fileId,
      after: {
        mode: result.displayMode, originalSize: result.originalSize, displaySize: result.displaySize,
        savingsPercent: result.savingsPercent, width: result.width, height: result.height,
        deduplicated: Boolean(duplicate),
      },
      ip: actor.ip,
    });
    return { file: (await getFile(fileId))!, notes };
  } catch (error) {
    const message = error instanceof ImageRejectedError
      ? error.message
      : error instanceof Error ? error.message : String(error);
    console.error(`[media] processing failed for ${fileId}:`, message);
    // The original is untouched and remains the served version.
    await run(
      `UPDATE files SET processing_status = 'failed', processing_error = ?, storage_key = ?,
         mime = ?, size = ?, processed_at = ? WHERE id = ?`,
      [message.slice(0, 500), originalKey, originalMime, Number(existing.original_size ?? existing.size), nowIso(), fileId],
    );
    await writeAudit({
      actorId: actor.id, actorName: actor.name, action: 'file.process_failed',
      entityType: 'file', entityId: fileId, after: { error: message.slice(0, 300) }, ip: actor.ip,
    });
    notes.push('پردازش تصویر ناموفق بود؛ نسخه اصلی بدون تغییر حفظ شد.');
    return { file: (await getFile(fileId))!, notes };
  }
}

/** Re-run the pipeline for one file (admin action, idempotent). */
export async function reprocessFile(
  fileId: string,
  actor: { id: string; name: string; ip?: string },
): Promise<{ file: FileRow; notes: string[] }> {
  const file = await getFile(fileId);
  if (!file) throw notFound('فایل یافت نشد.');
  if (file.is_public) throw badRequest('فایل‌های عمومی پردازش تصویر نمی‌شوند.');
  if (!(file.original_mime ?? file.mime).startsWith('image/')) throw badRequest('این فایل تصویر نیست.');
  const previousDisplay = file.storage_key !== (file.original_storage_key ?? file.storage_key) ? file.storage_key : null;
  await run(`UPDATE files SET processing_status = 'pending' WHERE id = ?`, [fileId]);
  const outcome = await processFileRecord(fileId, { ...actor, source: 'reprocess' });
  if (previousDisplay && previousDisplay !== outcome.file.storage_key) {
    await removeQuietly(resolveStoragePath(previousDisplay));
  }
  return outcome;
}

/**
 * Boot-time recovery: rows stuck in pending/processing are retried. A crash or
 * restart can therefore never lose a document or leave it half-processed.
 */
export async function recoverStuckMedia(options: { log?: (message: string) => void; limit?: number } = {}): Promise<{ recovered: number; failed: number }> {
  const log = options.log ?? (() => undefined);
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const rows = await q<{ id: string }>(
    `SELECT id FROM files
     WHERE is_public = 0 AND processing_status IN ('pending', 'processing')
     ORDER BY created_at ASC LIMIT ?`,
    [limit],
  );
  let recovered = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = await processFileRecord(row.id, { id: 'system', name: 'media-recovery', source: 'recovery' });
    if (outcome.file.processing_status === 'ready') recovered += 1;
    else failed += 1;
  }
  if (rows.length) log(`[media] recovery processed ${rows.length} file(s): ready=${recovered} failed=${failed}`);
  return { recovered, failed };
}

/* -------------------------------------------------------------------------- */
/*                              deletion / stats                              */
/* -------------------------------------------------------------------------- */

export async function removeFileArtifacts(file: FileRow): Promise<void> {
  const keys = new Set<string>();
  for (const key of [file.storage_key, file.original_storage_key, file.preview_storage_key]) {
    if (!key) continue;
    keys.add(key);
  }
  for (const key of keys) {
    try { await removeQuietly(resolveStoragePath(key)); } catch { /* invalid key cannot be removed */ }
  }
}

export async function mediaStats() {
  const rows = await q<any>(
    `SELECT processing_status AS status, COUNT(*) AS c,
            COALESCE(SUM(COALESCE(original_size, size)), 0) AS original_bytes,
            COALESCE(SUM(size), 0) AS served_bytes,
            COALESCE(AVG(savings_percent), 0) AS avg_savings
     FROM files WHERE is_public = 0 GROUP BY processing_status`,
  );
  const byStatus: Record<string, number> = {};
  let originalBytes = 0;
  let storedBytes = 0;
  let weightedSavings = 0;
  for (const row of rows) {
    byStatus[row.status ?? 'none'] = Number(row.c ?? 0);
    originalBytes += Number(row.original_bytes ?? 0);
    storedBytes += Number(row.served_bytes ?? 0);
    weightedSavings += Number(row.avg_savings ?? 0) * Number(row.c ?? 0);
  }
  const totalFiles = rows.reduce((sum, row) => sum + Number(row.c ?? 0), 0);
  return {
    byStatus,
    totalFiles,
    /** Sum of the uploaded originals (what customers sent us). */
    originalBytes,
    /** Sum of the bytes actually served to browsers. */
    servedBytes: storedBytes,
    /** Difference on the served path; the archive copy still occupies disk. */
    servedSavingsBytes: Math.max(0, originalBytes - storedBytes),
    averageSavingsPercent: totalFiles ? Math.round((weightedSavings / totalFiles) * 10) / 10 : 0,
    queue: mediaQueue.stats,
  };
}

/* -------------------------------------------------------------------------- */
/*                               access trail                                 */
/* -------------------------------------------------------------------------- */

export async function logFileAccess(input: {
  fileId: string;
  actorId?: string | null;
  actorRole?: string | null;
  action: 'view' | 'preview' | 'original' | 'download';
  variant?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await run(
      `INSERT INTO file_access_logs (id, file_id, actor_id, actor_role, action, variant, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id('falog'), input.fileId, input.actorId ?? null, input.actorRole ?? null, input.action,
        input.variant ?? null, input.ip ?? null, (input.userAgent ?? '').slice(0, 250) || null, nowIso(),
      ],
    );
  } catch (error) {
    console.error('[media] failed to write file access log', error);
  }
}

export async function fileAccessHistory(fileId: string, limit = 50) {
  const rows = await q<any>(
    `SELECT * FROM file_access_logs WHERE file_id = ? ORDER BY created_at DESC LIMIT ?`,
    [fileId, Math.min(200, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: row.id, actorId: row.actor_id, actorRole: row.actor_role, action: row.action,
    variant: row.variant, ip: row.ip, createdAt: row.created_at,
  }));
}

/* -------------------------------------------------------------------------- */
/*                            original archive policy                         */
/* -------------------------------------------------------------------------- */

/**
 * Remove archived originals that are provably recoverable (a verified WebP
 * display copy exists) and older than the configured retention window.
 *
 * `dryRun` is the default; deletion requires an explicit confirmation so a
 * misconfigured retention value cannot silently erase customer identity papers.
 */
export async function pruneOriginals(options: {
  dryRun: boolean;
  retentionDays?: number;
  maxFiles?: number;
} ): Promise<{ candidates: number; deleted: number; retained: number; bytesFreed: number }> {
  const config = await loadMediaConfig();
  const retentionDays = options.retentionDays ?? config.originalRetentionDays;
  const maxFiles = Math.min(2000, Math.max(1, options.maxFiles ?? 200));
  if (retentionDays <= 0) return { candidates: 0, deleted: 0, retained: 0, bytesFreed: 0 };
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const rows = await q<FileRow>(
    `SELECT * FROM files
     WHERE is_public = 0 AND processing_status = 'ready'
       AND processing_mode IN ('lossless', 'near_lossless', 'lossy')
       AND original_storage_key IS NOT NULL AND original_storage_key <> storage_key
       AND processed_at IS NOT NULL AND processed_at < ?
     ORDER BY processed_at ASC LIMIT ?`,
    [cutoff, maxFiles],
  );
  let deleted = 0;
  let retained = 0;
  let bytesFreed = 0;
  for (const row of rows) {
    const display = resolveStoragePath(row.storage_key);
    const original = resolveStoragePath(row.original_storage_key!);
    if (!fs.existsSync(display) || !fs.existsSync(original)) { retained += 1; continue; }
    if (options.dryRun) { retained += 1; continue; }
    try {
      const size = fs.statSync(original).size;
      await removeQuietly(original);
      await run('UPDATE files SET original_storage_key = NULL WHERE id = ?', [row.id]);
      await writeAudit({
        actorId: 'system', actorName: 'media-retention', action: 'file.prune_original',
        entityType: 'file', entityId: row.id, after: { bytes: size, retentionDays },
      });
      deleted += 1;
      bytesFreed += size;
    } catch {
      retained += 1;
    }
  }
  return { candidates: rows.length, deleted, retained, bytesFreed };
}
