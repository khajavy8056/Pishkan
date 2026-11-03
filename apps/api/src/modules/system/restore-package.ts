/**
 * One-file backup packages ("بسته پشتیبان") and in-panel restore.
 *
 * A package is a single `.zip` holding `database.sqlite`, a `uploads/` tree
 * (mirroring UPLOAD_DIR) and `pishkan-manifest.json`. The admin uploads it in
 * the Operations panel, reviews an inspection summary, confirms with the
 * RESTORE phrase + password, and watches staged progress while the server:
 * takes a safety backup, swaps database + uploads in place, runs pending
 * migrations, clears sessions/caches — a soft reboot with no Manager or
 * shell tools involved (the same process already owns its data directory,
 * so the Windows file-lock class of failures cannot happen here).
 *
 * A bare `.sqlite`/`.db` file is accepted too (database-only restore; the
 * uploads folder is left untouched and the inspection says so loudly).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { env } from '../../env.js';
import { closeDb, nowIso, q, run, sqliteSnapshot } from '../../db/index.js';
import { listMigrations, migrate } from '../../db/migrate.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { id } from '../../lib/crypto.js';
import { invalidateSettingsCache } from '../settings/service.js';
import { writeAudit } from '../audit/service.js';
import { createBackup, type BackupRow } from './backup.js';

export const PACKAGE_MAX_BYTES = 512 * 1024 * 1024;
const PACKAGE_MAX_UNCOMPRESSED = 2 * 1024 * 1024 * 1024;
const PACKAGE_MAX_ENTRIES = 20_000;
const JOB_TTL_MS = 60 * 60_000;

export type RestoreStage =
  | 'staged' | 'verifying' | 'safety_backup' | 'swapping' | 'migrating' | 'finalizing' | 'done' | 'failed';

export interface RestoreInspection {
  type: 'package' | 'database';
  createdAt: string | null;
  appVersion: string | null;
  migrations: number;
  appMigrations: number;
  users: number | null;
  includesUploads: boolean;
  uploadsFiles: number;
  size: number;
  warnings: string[];
}

interface RestoreJob {
  id: string;
  stage: RestoreStage;
  message: string;
  error: string | null;
  createdAt: number;
  stagingDir: string;
  packagePath: string;
  dbPath: string;
  inspection: RestoreInspection;
  actor: { id: string; name: string };
  safetyNote: string | null;
}

const jobs = new Map<string, RestoreJob>();
let activeJobId: string | null = null;

function stagingRoot(): string {
  const dir = path.join(env.backupDir, 'restore-staging');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sweepStaging(): void {
  try {
    const root = stagingRoot();
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > JOB_TTL_MS) fs.rmSync(full, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
  } catch { /* staging root may not exist yet */ }
  for (const [jobId, job] of jobs) {
    if (Date.now() - job.createdAt > JOB_TTL_MS && job.stage !== 'swapping' && jobId !== activeJobId) jobs.delete(jobId);
  }
}

function assertSqlitePanelRestore(): void {
  if (env.dbDriver === 'postgres') {
    throw badRequest('بازیابی از فایل در پنل برای PostgreSQL پشتیبانی نمی‌شود؛ این قابلیت مخصوص نسخه SQLite (ویندوزی/محلی) است.');
  }
  if (env.isProd) {
    throw badRequest('بازیابی روی سرویس در حال اجرای production از پنل مجاز نیست.');
  }
}

/* ------------------------------ inspection ------------------------------ */

function sniffKind(file: string): 'zip' | 'sqlite' | null {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    if (read >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
    if (read >= 16 && buf.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000') return 'sqlite';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

async function inspectSqlite(file: string): Promise<{ migrations: string[]; users: number | null }> {
  const { DatabaseSync } = await import('node:sqlite');
  let db: any;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (err: any) {
    throw badRequest(`فایل پایگاه داده قابل باز کردن نیست: ${err?.message ?? ''}`);
  }
  try {
    const row = db.prepare('PRAGMA integrity_check').get() as any;
    const ok = row && (row.integrity_check === 'ok' || Object.values(row)[0] === 'ok');
    if (!ok) throw badRequest('بررسی یکپارچگی پایگاه داده داخل بسته ناموفق بود؛ این فایل سالم نیست.');
    let migrations: string[] = [];
    try {
      migrations = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r: any) => String(r.name));
    } catch {
      throw badRequest('این فایل پایگاه داده پیشخوان نیست (جدول مهاجرت‌ها یافت نشد).');
    }
    if (!migrations.length) throw badRequest('این پایگاه داده هیچ مهاجرتی ندارد و قابل بازیابی نیست.');
    let users: number | null = null;
    try { users = Number(db.prepare('SELECT COUNT(*) AS c FROM users').get().c); } catch { /* optional */ }
    return { migrations, users };
  } finally {
    db.close();
  }
}

function assertMigrationsSupported(found: string[]): string[] {
  const appNames = new Set(listMigrations().map((m) => m.name));
  const unknown = found.filter((name) => !appNames.has(name));
  if (unknown.length) {
    throw badRequest(
      `این نسخه پشتیبان از نسخه جدیدتری از پیشخوان ساخته شده است (${unknown.length} مهاجرت ناشناخته برای این نصب). `
      + 'ابتدا برنامه را به‌روز کنید، سپس بازیابی را دوباره انجام دهید.',
    );
  }
  return [...appNames];
}

function safeZipName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.startsWith('../') || name.includes('/../') || name.endsWith('/..') || /^[a-zA-Z]:/.test(name)) return null;
  return name;
}

export async function stageRestoreUpload(
  uploadedPath: string,
  actor: { id: string; name: string },
): Promise<{ jobId: string; inspection: RestoreInspection }> {
  assertSqlitePanelRestore();
  sweepStaging();
  const kind = sniffKind(uploadedPath);
  if (!kind) {
    fs.rmSync(uploadedPath, { force: true });
    throw badRequest('قالب فایل شناخته نشد؛ یک بسته پشتیبان (.zip) یا فایل پایگاه داده (.sqlite) انتخاب کنید.');
  }

  const jobId = id('rst');
  const stagingDir = path.join(stagingRoot(), jobId);
  fs.mkdirSync(stagingDir, { recursive: true });
  const packagePath = path.join(stagingDir, kind === 'zip' ? 'package.zip' : 'database.sqlite');
  fs.renameSync(uploadedPath, packagePath);
  const size = fs.statSync(packagePath).size;
  const warnings: string[] = [];
  let dbPath = packagePath;
  let includesUploads = false;
  let uploadsFiles = 0;
  let manifest: any = null;

  try {
    if (kind === 'zip') {
      const zip = new AdmZip(packagePath);
      const entries = zip.getEntries();
      if (entries.length > PACKAGE_MAX_ENTRIES) throw badRequest('تعداد فایل‌های داخل بسته بیش از حد مجاز است.');
      let totalUncompressed = 0;
      let dbEntry: AdmZip.IZipEntry | null = null;
      let hasUploadsRoot = false;
      for (const entry of entries) {
        const name = safeZipName(entry.entryName);
        if (name === null) throw badRequest('بسته حاوی مسیر نامعتبر است و به دلایل امنیتی رد شد.');
        if (name === 'uploads/' || name.startsWith('uploads/')) hasUploadsRoot = true;
        if (entry.isDirectory) continue;
        totalUncompressed += Number(entry.header?.size ?? 0);
        if (totalUncompressed > PACKAGE_MAX_UNCOMPRESSED) throw badRequest('حجم بازشده بسته بیش از حد مجاز است.');
        if (name === 'pishkan-manifest.json') {
          try { manifest = JSON.parse(entry.getData().toString('utf8')); } catch { warnings.push('مانیفست بسته خوانا نبود و نادیده گرفته شد.'); }
        } else if (name === 'database.sqlite') {
          dbEntry = entry;
        } else if (!name.includes('/') && /\.(sqlite|db)$/i.test(name) && !dbEntry) {
          dbEntry = entry;
        } else if (name.startsWith('uploads/') && name.length > 'uploads/'.length) {
          uploadsFiles += 1;
        }
      }
      if (manifest?.format && manifest.format !== 'pishkan-backup') {
        throw badRequest('این فایل، بسته پشتیبان پیشخوان نیست.');
      }
      if (!manifest) warnings.push('مانیفست بسته یافت نشد؛ محتوا بر اساس ساختار فایل بررسی شد.');
      if (!dbEntry) throw badRequest('داخل بسته فایل پایگاه داده (database.sqlite) یافت نشد.');
      dbPath = path.join(stagingDir, 'database.sqlite');
      fs.writeFileSync(dbPath, dbEntry.getData());
      includesUploads = hasUploadsRoot || uploadsFiles > 0;
      if (!includesUploads) warnings.push('این بسته پوشه مدارک ندارد؛ مدارک فعلی سرور دست‌نخورده می‌مانند.');
    } else {
      warnings.push('این فایل فقط پایگاه داده است؛ پوشه مدارک فعلی دست‌نخورده می‌ماند و ممکن است برخی مدارکِ نسخه بازیابی‌شده روی این سرور موجود نباشند.');
    }

    const { migrations, users } = await inspectSqlite(dbPath);
    const appNames = assertMigrationsSupported(migrations);
    if (migrations.length < appNames.length) {
      warnings.push('نسخه پشتیبان قدیمی‌تر از برنامه فعلی است؛ مهاجرت‌های باقی‌مانده پس از بازیابی به‌صورت خودکار اجرا می‌شوند.');
    }

    const inspection: RestoreInspection = {
      type: kind === 'zip' ? 'package' : 'database',
      createdAt: manifest?.createdAt ?? null,
      appVersion: manifest?.appVersion ?? null,
      migrations: migrations.length,
      appMigrations: appNames.length,
      users,
      includesUploads,
      uploadsFiles,
      size,
      warnings,
    };
    jobs.set(jobId, {
      id: jobId, stage: 'staged', message: 'فایل دریافت و بررسی شد؛ در انتظار تأیید بازیابی.', error: null,
      createdAt: Date.now(), stagingDir, packagePath, dbPath, inspection, actor, safetyNote: null,
    });
    return { jobId, inspection };
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

/* ------------------------------- execution ------------------------------ */

export function restoreJobDto(job: RestoreJob) {
  return {
    jobId: job.id,
    stage: job.stage,
    message: job.message,
    error: job.error,
    safetyNote: job.safetyNote,
    inspection: job.inspection,
    createdAt: new Date(job.createdAt).toISOString(),
  };
}

export function getRestoreJob(jobId: string): RestoreJob {
  const job = jobs.get(jobId);
  if (!job) throw notFound('عملیات بازیابی یافت نشد یا منقضی شده است؛ فایل را دوباره بارگذاری کنید.');
  return job;
}

export function discardRestoreJob(jobId: string): void {
  const job = getRestoreJob(jobId);
  if (jobId === activeJobId) throw conflict('این بازیابی در حال انجام است و قابل لغو نیست.');
  jobs.delete(jobId);
  fs.rmSync(job.stagingDir, { recursive: true, force: true });
}

function extractPackageUploads(job: RestoreJob, destination: string): void {
  const zip = new AdmZip(job.packagePath);
  const root = path.resolve(destination);
  fs.mkdirSync(root, { recursive: true });
  for (const entry of zip.getEntries()) {
    const name = safeZipName(entry.entryName);
    if (name === null) throw badRequest('بسته حاوی مسیر نامعتبر است و به دلایل امنیتی رد شد.');
    if (!name.startsWith('uploads/')) continue;
    const relative = name.slice('uploads/'.length);
    if (!relative) continue;
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw badRequest('بسته حاوی مسیر نامعتبر است و به دلایل امنیتی رد شد.');
    }
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
  }
}

async function runRestore(job: RestoreJob): Promise<void> {
  const setStage = (stage: RestoreStage, message: string) => { job.stage = stage; job.message = message; };
  const token = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const current = env.sqliteFile;
  const dbTemp = `${current}.restore-${token}`;
  const dbPrevious = `${current}.pre-restore-${token}`;
  const uploadParent = path.dirname(env.uploadDir);
  let uploadStage: string | null = null;
  const uploadPrevious = `${env.uploadDir}.pre-restore-${token}`;
  let dbMoved = false;
  let dbInstalled = false;
  let uploadsMoved = false;
  let safety: BackupRow | null = null;

  const rollback = async () => {
    try { await closeDb(); } catch { /* already closed */ }
    try { if (dbInstalled && fs.existsSync(current)) fs.rmSync(current, { force: true }); } catch { /* keep recovery path */ }
    try { if (dbMoved && fs.existsSync(dbPrevious)) fs.renameSync(dbPrevious, current); } catch { /* safety backup remains */ }
    try { if (uploadsMoved && fs.existsSync(env.uploadDir)) fs.rmSync(env.uploadDir, { recursive: true, force: true }); } catch { /* keep recovery path */ }
    try { if (uploadsMoved && fs.existsSync(uploadPrevious)) fs.renameSync(uploadPrevious, env.uploadDir); } catch { /* safety backup remains */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(`${current}${suffix}`, { force: true }); } catch { /* ignore */ }
    }
    try { await migrate(); } catch { /* original database is back; migrations were already applied */ }
    invalidateSettingsCache();
  };

  try {
    setStage('verifying', 'بررسی نهایی سلامت فایل پایگاه داده…');
    await inspectSqlite(job.dbPath);

    setStage('safety_backup', 'گرفتن نسخه پشتیبان ایمنی از داده‌های فعلی…');
    try {
      safety = await createBackup(job.actor, 'پشتیبان ایمنی پیش از بازیابی از فایل');
      job.safetyNote = `نسخه ایمنی «${safety.filename}» ساخته شد.`;
    } catch {
      // Fall back to a plain file-level snapshot (no tar/python dependency).
      const stampName = `safety-before-restore-${token}`;
      fs.mkdirSync(env.backupDir, { recursive: true });
      await sqliteSnapshot(path.join(env.backupDir, `${stampName}.db`));
      if (fs.existsSync(env.uploadDir)) {
        fs.cpSync(env.uploadDir, path.join(env.backupDir, `${stampName}-uploads`), { recursive: true });
      }
      job.safetyNote = `نسخه ایمنی فایلی «${stampName}» در پوشه پشتیبان ذخیره شد.`;
    }

    setStage('swapping', 'جایگزینی پایگاه داده و مدارک…');
    fs.copyFileSync(job.dbPath, dbTemp);
    if (job.inspection.includesUploads) {
      fs.mkdirSync(uploadParent, { recursive: true });
      uploadStage = fs.mkdtempSync(path.join(uploadParent, '.pishkan-uploads-restore-'));
      extractPackageUploads(job, uploadStage);
    }
    await closeDb();
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${current}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    if (fs.existsSync(current)) { fs.renameSync(current, dbPrevious); dbMoved = true; }
    fs.renameSync(dbTemp, current);
    dbInstalled = true;
    if (uploadStage) {
      if (fs.existsSync(env.uploadDir)) { fs.renameSync(env.uploadDir, uploadPrevious); uploadsMoved = true; }
      fs.renameSync(uploadStage, env.uploadDir);
      uploadStage = null;
    }

    setStage('migrating', 'اجرای مهاجرت‌های پایگاه داده و بررسی سلامت…');
    await migrate();
    await q('SELECT COUNT(*) AS c FROM users');

    setStage('finalizing', 'پاک‌سازی نشست‌ها و کش‌ها…');
    invalidateSettingsCache();
    if (safety) {
      // Re-register the safety copy inside the restored database so rolling
      // back stays one click away in the backups list.
      try {
        await run(
          `INSERT INTO backups (id, filename, size, checksum, location, uploads_filename, uploads_size, uploads_checksum, status, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?)`,
          [id('bak'), safety.filename, safety.size, safety.checksum, safety.location ?? env.backupDir,
            safety.uploads_filename ?? null, Number(safety.uploads_size ?? 0), safety.uploads_checksum ?? null,
            'پشتیبان ایمنی پیش از بازیابی از فایل', job.actor.name, nowIso()],
        );
      } catch { /* files still exist on disk even if the row cannot be mirrored */ }
    }
    await writeAudit({
      actorId: job.actor.id, actorName: job.actor.name, action: 'backup.restore_package',
      entityType: 'backup', entityId: job.id,
      after: { type: job.inspection.type, migrations: job.inspection.migrations, includesUploads: job.inspection.includesUploads },
    }).catch(() => undefined);
    try { await run('DELETE FROM sessions'); } catch { /* table exists in every supported schema */ }

    try { if (fs.existsSync(dbPrevious)) fs.rmSync(dbPrevious, { force: true }); } catch { /* safety backup retained */ }
    try { if (fs.existsSync(uploadPrevious)) fs.rmSync(uploadPrevious, { recursive: true, force: true }); } catch { /* safety backup retained */ }
    setStage('done', 'بازیابی کامل شد. همه نشست‌ها بسته شدند؛ دوباره وارد شوید.');
  } catch (error) {
    if (dbInstalled || uploadsMoved) await rollback().catch(() => undefined);
    job.stage = 'failed';
    job.error = error instanceof Error ? error.message : 'خطای ناشناخته هنگام بازیابی.';
    job.message = 'بازیابی ناموفق بود؛ داده‌های قبلی سر جای خود باقی ماندند.';
  } finally {
    try { fs.rmSync(dbTemp, { force: true }); } catch { /* ignore */ }
    try { if (uploadStage) fs.rmSync(uploadStage, { recursive: true, force: true }); } catch { /* ignore */ }
    if (activeJobId === job.id) activeJobId = null;
    const timer = setTimeout(() => {
      jobs.delete(job.id);
      fs.rmSync(job.stagingDir, { recursive: true, force: true });
    }, 10 * 60_000);
    timer.unref?.();
  }
}

export function executeRestore(jobId: string): RestoreJob {
  const job = getRestoreJob(jobId);
  if (activeJobId) throw conflict('یک بازیابی دیگر در حال انجام است؛ تا پایان آن صبر کنید.');
  if (job.stage !== 'staged') throw conflict('این عملیات قبلاً شروع شده است.');
  activeJobId = job.id;
  job.stage = 'verifying';
  job.message = 'در حال آغاز بازیابی…';
  void runRestore(job);
  return job;
}

/* --------------------------- package creation --------------------------- */

function walkFiles(root: string, base = root): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Build a single-file package from the CURRENT live state and return its path
 * (the route streams it as a download and removes the temp file afterwards).
 */
export async function createBackupPackage(): Promise<{ path: string; filename: string; size: number }> {
  assertSqlitePanelRestore();
  fs.mkdirSync(env.backupDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(env.backupDir, '.package-'));
  try {
    const dbTmp = path.join(tmp, 'database.sqlite');
    await sqliteSnapshot(dbTmp);
    const migrations = await q<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations').catch(() => [{ c: 0 }]);
    const users = await q<{ c: number }>('SELECT COUNT(*) AS c FROM users').catch(() => [{ c: 0 }]);
    const manifest = {
      format: 'pishkan-backup',
      version: 1,
      createdAt: nowIso(),
      appVersion: env.version,
      driver: 'sqlite',
      migrations: Number(migrations[0]?.c ?? 0),
      users: Number(users[0]?.c ?? 0),
      includesUploads: true,
    };
    const zip = new AdmZip();
    zip.addFile('pishkan-manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
    zip.addLocalFile(dbTmp, '', 'database.sqlite');
    // Always stamp the uploads root so "includes uploads" is explicit even
    // when the tree is currently empty.
    zip.addFile('uploads/', Buffer.alloc(0));
    let total = fs.statSync(dbTmp).size;
    for (const file of walkFiles(env.uploadDir)) {
      total += fs.statSync(file).size;
      if (total > PACKAGE_MAX_BYTES) {
        throw badRequest('حجم پایگاه داده و مدارک برای بسته تک‌فایل بیش از ۵۱۲ مگابایت است؛ از دانلود جداگانه پایگاه داده و آرشیو مدارک استفاده کنید.');
      }
      const rel = path.relative(env.uploadDir, file).split(path.sep).join('/');
      zip.addLocalFile(file, `uploads/${path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel)}`, path.posix.basename(rel));
    }
    const filename = `pishkan-package-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
    const target = path.join(env.backupDir, filename);
    zip.writeZip(target);
    return { path: target, filename, size: fs.statSync(target).size };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
