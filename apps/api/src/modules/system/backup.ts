import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../../env.js';
import { q, one, run, nowIso, closeDb } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool, getNumber, getString } from '../settings/service.js';
import { badRequest, notFound } from '../../http/errors.js';

const exec = promisify(execFile);

export interface BackupRow {
  id: string;
  filename: string;
  size: number;
  checksum: string | null;
  location: string | null;
  uploads_filename?: string | null;
  uploads_size?: number;
  uploads_checksum?: string | null;
  status: string;
  note: string | null;
  created_at: string;
}

function backupDir(): string {
  fs.mkdirSync(env.backupDir, { recursive: true });
  return env.backupDir;
}

function backupPath(filename: string, location = backupDir()): string {
  if (!filename || path.basename(filename) !== filename) throw badRequest('نام فایل پشتیبان نامعتبر است.');
  const root = path.resolve(location);
  const target = path.resolve(root, filename);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw badRequest('مسیر فایل پشتیبان نامعتبر است.');
  return target;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Create one database backup record with an explicitly associated uploads archive. */
export async function createBackup(actor: { id: string; name: string }, note?: string): Promise<BackupRow> {
  const dir = backupDir();
  const backupId = id('bak');
  const suffix = `${stamp()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `pishkan-${suffix}.${env.dbDriver === 'postgres' ? 'dump' : 'db'}`;
  const target = backupPath(filename, dir);
  const includeUploads = await getBool('backup.include_uploads');
  if (!includeUploads) throw badRequest('برای ساخت نسخه پشتیبان کامل، گزینه «شامل فایل‌های مدارک» را فعال کنید.');
  const uploadsFilename = `pishkan-uploads-${suffix}.tar.gz`;
  const uploadsTarget = uploadsFilename ? backupPath(uploadsFilename, dir) : null;
  let size = 0;
  let checksum: string | null = null;
  let uploadsSize = 0;
  let uploadsChecksum: string | null = null;

  try {
    if (env.dbDriver === 'postgres') {
      await exec('pg_dump', ['--format=custom', `--file=${target}`, env.databaseUrl], { timeout: 10 * 60_000 });
    } else {
      if (!fs.existsSync(env.sqliteFile)) throw new Error('فایل پایگاه داده پیدا نشد.');
      const { sqliteSnapshot } = await import('../../db/index.js');
      await sqliteSnapshot(target);
    }
    size = fs.statSync(target).size;
    checksum = await hashFile(target);

    if (includeUploads && uploadsTarget) {
      fs.mkdirSync(env.uploadDir, { recursive: true });
      try {
        await exec('tar', ['-czf', uploadsTarget, '-C', env.uploadDir, '.'], { timeout: 10 * 60_000 });
        uploadsSize = fs.statSync(uploadsTarget).size;
        uploadsChecksum = await hashFile(uploadsTarget);
      } catch (error: any) {
        await run(
          `INSERT INTO backups (id, filename, size, checksum, location, uploads_filename, uploads_size, uploads_checksum, status, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'failed', ?, ?, ?)`,
          [backupId, filename, size, checksum, dir, uploadsFilename, note ?? null, actor.name, nowIso()],
        );
        throw badRequest(`آرشیو مدارک ساخته یا بررسی نشد؛ نسخه پشتیبان کامل نیست و با وضعیت ناموفق ثبت شد. ${error?.message ?? ''}`);
      }
    }

    await run(
      `INSERT INTO backups (id, filename, size, checksum, location, uploads_filename, uploads_size, uploads_checksum, status, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?)`,
      [backupId, filename, size, checksum, dir, uploadsFilename, uploadsSize, uploadsChecksum, note ?? null, actor.name, nowIso()],
    );
  } catch (error) {
    if (!(error instanceof Error && error.name === 'HttpError')) {
      try { fs.rmSync(target, { force: true }); } catch { /* retain metadata if already recorded */ }
      try { if (uploadsTarget) fs.rmSync(uploadsTarget, { force: true }); } catch { /* best effort */ }
      throw badRequest(`پشتیبان‌گیری کامل نشد: ${error instanceof Error ? error.message : 'خطای ناشناخته'}`);
    }
    throw error;
  }

  if (await getBool('backup.verify_after_backup')) {
    const verified = await verifyBackup(backupId);
    if (!verified.ok) {
      await run('UPDATE backups SET status = ? WHERE id = ?', ['invalid', backupId]);
      throw badRequest(`نسخه پشتیبان ساخته شد اما بررسی صحت شکست خورد: ${verified.message}`);
    }
  }

  await pruneOldBackups();
  return (await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]))!;
}

async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function extractUploadsSafely(archive: string, destination: string): Promise<void> {
  const script = String.raw`import pathlib, sys, tarfile, shutil
archive, destination = sys.argv[1:]
root = pathlib.Path(destination).resolve()
root.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive, 'r:gz') as bundle:
    for item in bundle.getmembers():
        if not (item.isdir() or item.isfile()):
            raise SystemExit('Archive contains a link or special file')
        target = (root / item.name).resolve()
        try: target.relative_to(root)
        except ValueError: raise SystemExit('Archive path escapes destination')
        if item.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(item)
            if source is None: raise SystemExit('Unable to read archive member')
            with source, target.open('wb') as output: shutil.copyfileobj(source, output)
`;
  await exec('python3', ['-c', script, archive, destination], { timeout: 10 * 60_000 });
}

async function verifyDatabaseDump(filename: string, file: string): Promise<{ ok: boolean; message: string }> {
  if (filename.endsWith('.dump')) {
    try {
      await exec('pg_restore', ['--list', file], { timeout: 120_000 });
      return { ok: true, message: 'ساختار dump پایگاه داده قابل خواندن است.' };
    } catch {
      return { ok: false, message: 'فایل pg_dump قابل خواندن نیست.' };
    }
  }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('PRAGMA integrity_check').get() as any;
    db.close();
    const ok = row && (row.integrity_check === 'ok' || Object.values(row)[0] === 'ok');
    return { ok: Boolean(ok), message: ok ? 'یکپارچگی پایگاه داده تأیید شد.' : 'بررسی یکپارچگی پایگاه داده ناموفق بود.' };
  } catch (err: any) {
    return { ok: false, message: `فایل پایگاه داده قابل باز کردن نیست: ${err?.message ?? ''}` };
  }
}

export async function verifyBackup(backupId: string): Promise<{ ok: boolean; message: string; checksum?: string }> {
  const backup = await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!backup) throw notFound('نسخه پشتیبان یافت نشد.');
  const file = backupPath(backup.filename, backup.location ?? backupDir());
  if (!fs.existsSync(file)) return { ok: false, message: 'فایل پایگاه داده پشتیبان روی سرور موجود نیست.' };

  const checksum = await hashFile(file);
  if (backup.checksum && checksum !== backup.checksum) {
    return { ok: false, message: 'مجموع کنترلی پایگاه داده با مقدار ثبت‌شده مطابقت ندارد.', checksum };
  }
  const database = await verifyDatabaseDump(backup.filename, file);
  if (!database.ok) return { ok: false, message: database.message, checksum };

  if (backup.uploads_filename) {
    const uploads = backupPath(backup.uploads_filename, backup.location ?? backupDir());
    if (!fs.existsSync(uploads)) return { ok: false, message: 'آرشیو مدارک مرتبط با این نسخه پشتیبان موجود نیست.', checksum };
    const uploadsChecksum = await hashFile(uploads);
    if (!backup.uploads_checksum || uploadsChecksum !== backup.uploads_checksum) {
      return { ok: false, message: 'مجموع کنترلی آرشیو مدارک مطابقت ندارد.', checksum };
    }
    try {
      await exec('tar', ['-tzf', uploads], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return { ok: false, message: 'آرشیو مدارک خراب یا غیرقابل خواندن است.', checksum };
    }
  } else if (backup.status === 'ok') {
    // New backups with uploads enabled must have a linked archive. Legacy rows
    // predate migration 013 and are explicitly reported as database-only.
    return { ok: false, message: 'این نسخه فقط پایگاه داده را دارد و آرشیو مدارک به آن متصل نیست.', checksum };
  }
  return { ok: true, message: 'پایگاه داده و همه اجزای ثبت‌شدهٔ نسخه پشتیبان سالم هستند.', checksum };
}

export async function listBackups(): Promise<BackupRow[]> {
  return q<BackupRow>('SELECT * FROM backups ORDER BY created_at DESC LIMIT 100');
}

async function removeBackupFiles(backup: BackupRow): Promise<void> {
  const root = backup.location ?? backupDir();
  for (const name of [backup.filename, backup.uploads_filename].filter((value): value is string => Boolean(value))) {
    const file = backupPath(name, root);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

async function pruneOldBackups(): Promise<void> {
  const retention = await getNumber('backup.retention_days');
  const cutoff = new Date(Date.now() - retention * 86_400_000).toISOString();
  const old = await q<BackupRow>('SELECT * FROM backups WHERE created_at < ?', [cutoff]);
  for (const backup of old) {
    try {
      await removeBackupFiles(backup);
      await run('DELETE FROM backups WHERE id = ?', [backup.id]);
    } catch {
      await run('UPDATE backups SET status = ? WHERE id = ?', ['cleanup_failed', backup.id]);
    }
  }
}

export async function deleteBackup(backupId: string): Promise<void> {
  const backup = await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!backup) throw notFound('نسخه پشتیبان یافت نشد.');
  try {
    await removeBackupFiles(backup);
  } catch {
    throw badRequest('حذف یکی از فایل‌های نسخه پشتیبان ناموفق بود؛ رکورد برای پیگیری حفظ شد.');
  }
  await run('DELETE FROM backups WHERE id = ?', [backupId]);
}

/**
 * Restore a backup. Destructive: the caller must send an explicit confirmation
 * phrase and the admin password; a safety copy of the current state is taken
 * first and the operator is told to restart the service.
 */
export async function restoreBackup(
  backupId: string,
  confirmation: string,
  actor: { id: string; name: string },
): Promise<{ ok: boolean; message: string; safetyBackup?: string }> {
  if (confirmation !== 'RESTORE') {
    throw badRequest('برای بازیابی باید عبارت RESTORE را دقیقاً وارد کنید.');
  }
  if(env.isProd)throw badRequest('بازیابی روی API فعال ایمن نیست. سرویس را متوقف و از pishkan restore با تأیید صریح استفاده کنید.');
  if(env.dbDriver === 'postgres') throw badRequest('بازیابی PostgreSQL از API پشتیبانی نمی‌شود؛ از pishkan restore برای جایگزینی هماهنگ پایگاه داده و مدارک استفاده کنید.');
  const verified=await verifyBackup(backupId);
  if(!verified.ok)throw badRequest('صحت نسخه پشتیبان تأیید نشد؛ بازیابی لغو شد.');
  const backup = await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!backup) throw notFound('نسخه پشتیبان یافت نشد.');
  const file = backupPath(backup.filename, backup.location ?? backupDir());
  if (!fs.existsSync(file)) throw badRequest('فایل پشتیبان موجود نیست.');

  const safety = await createBackup(actor, 'پشتیبان ایمنی پیش از بازیابی');

  // SQLite restore is prepared completely before replacing either live resource.
  const current = env.sqliteFile;
  const token = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const dbTemp = `${current}.restore-${token}`;
  const dbPrevious = `${current}.pre-restore-${token}`;
  const uploadParent = path.dirname(env.uploadDir);
  fs.mkdirSync(uploadParent, { recursive: true });
  const uploadStage = fs.mkdtempSync(path.join(uploadParent, '.pishkan-uploads-restore-'));
  const uploadPrevious = `${env.uploadDir}.pre-restore-${token}`;
  const hadUploads = fs.existsSync(env.uploadDir);
  let dbMoved = false;
  let dbInstalled = false;
  let uploadsMoved = false;

  try {
    fs.copyFileSync(file, dbTemp);
    if (!backup.uploads_filename) throw badRequest('این نسخه پشتیبان آرشیو مدارک ندارد و برای بازیابی کامل قابل استفاده نیست.');
    await extractUploadsSafely(backupPath(backup.uploads_filename, backup.location ?? backupDir()), uploadStage);
    await closeDb();
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${current}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    if (fs.existsSync(current)) { fs.renameSync(current, dbPrevious); dbMoved = true; }
    fs.renameSync(dbTemp, current);
    dbInstalled = true;
    if (hadUploads) { fs.renameSync(env.uploadDir, uploadPrevious); uploadsMoved = true; }
    fs.renameSync(uploadStage, env.uploadDir);
  } catch (error) {
    try { if (fs.existsSync(current) && dbInstalled) fs.rmSync(current, { force: true }); } catch { /* keep recovery path */ }
    try { if (dbMoved && fs.existsSync(dbPrevious)) fs.renameSync(dbPrevious, current); } catch { /* safety backup remains */ }
    try { if (fs.existsSync(env.uploadDir) && uploadsMoved) fs.rmSync(env.uploadDir, { recursive: true, force: true }); } catch { /* keep recovery path */ }
    try { if (uploadsMoved && fs.existsSync(uploadPrevious)) fs.renameSync(uploadPrevious, env.uploadDir); } catch { /* safety backup remains */ }
    throw badRequest(`بازیابی کامل انجام نشد؛ نسخه ایمنی ${safety.filename} حفظ شد. ${error instanceof Error ? error.message : ''}`);
  } finally {
    try { fs.rmSync(dbTemp, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(uploadStage, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  try { if (fs.existsSync(dbPrevious)) fs.rmSync(dbPrevious, { force: true }); } catch { /* safetyBackup is retained too */ }
  try { if (fs.existsSync(uploadPrevious)) fs.rmSync(uploadPrevious, { recursive: true, force: true }); } catch { /* safetyBackup is retained too */ }
  return {
    ok: true,
    message: 'پایگاه داده و فایل‌های بارگذاری‌شده بازیابی شدند. سرویس را ری‌استارت کنید تا نشست‌ها و کش‌ها پاک شوند.',
    safetyBackup: safety.filename,
  };
}

/** Last backup metadata for the admin dashboard. */
export async function lastBackup(): Promise<BackupRow | null> {
  return one<BackupRow>('SELECT * FROM backups ORDER BY created_at DESC LIMIT 1');
}

export async function backupStatus() {
  const last = await lastBackup();
  const count = await one<{ c: number }>('SELECT COUNT(*) AS c FROM backups');
  return {
    enabled: await getBool('backup.enabled'),
    schedule: await getString('backup.schedule_cron'),
    destination: await getString('backup.destination'),
    retentionDays: await getNumber('backup.retention_days'),
    includeUploads: await getBool('backup.include_uploads'),
    total: Number(count?.c ?? 0),
    last: last ? {
      id: last.id, filename: last.filename, size: Number(last.size), checksum: last.checksum,
      uploadsFilename: last.uploads_filename ?? null, uploadsSize: Number(last.uploads_size ?? 0),
      uploadsChecksum: last.uploads_checksum ?? null, status: last.status,
      complete: Boolean(last.uploads_filename && last.uploads_checksum), createdAt: last.created_at,
    } : null,
  };
}
