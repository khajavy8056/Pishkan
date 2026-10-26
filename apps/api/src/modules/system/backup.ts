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
  status: string;
  note: string | null;
  created_at: string;
}

function backupDir(): string {
  fs.mkdirSync(env.backupDir, { recursive: true });
  return env.backupDir;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Create a database backup (pg_dump for PostgreSQL, file copy for SQLite). */
export async function createBackup(actor: { id: string; name: string }, note?: string): Promise<BackupRow> {
  const dir = backupDir();
  const filename = `pishkan-${stamp()}.${env.dbDriver === 'postgres' ? 'dump' : 'db'}`;
  const target = path.join(dir, filename);

  if (env.dbDriver === 'postgres') {
    try {
      await exec('pg_dump', ['--format=custom', `--file=${target}`, env.databaseUrl], { timeout: 10 * 60_000 });
    } catch (err: any) {
      throw badRequest(`پشتیبان‌گیری از پایگاه داده ناموفق بود: ${err?.message ?? 'pg_dump در دسترس نیست'}`);
    }
  } else {
    // flush WAL by closing the handle briefly; Node sqlite writes are synchronous
    const source = env.sqliteFile;
    if (!fs.existsSync(source)) throw badRequest('فایل پایگاه داده پیدا نشد.');
    const { sqliteSnapshot } = await import('../../db/index.js');
    await sqliteSnapshot(target);
  }

  // optionally include uploaded documents
  if (await getBool('backup.include_uploads')) {
    const uploadsArchive = path.join(dir, `pishkan-uploads-${stamp()}.tar.gz`);
    try {
      await exec('tar', ['-czf', uploadsArchive, '-C', path.dirname(env.uploadDir), path.basename(env.uploadDir)], { timeout: 10 * 60_000 });
    } catch {
      // uploads are optional; a failure here must not break the DB backup
    }
  }

  const size = fs.statSync(target).size;
  const checksum = await hashFile(target);
  const backupId = id('bak');

  await run(
    `INSERT INTO backups (id, filename, size, checksum, location, status, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?)`,
    [backupId, filename, size, checksum, dir, note ?? null, actor.name, nowIso()],
  );

  if (await getBool('backup.verify_after_backup')) {
    const verified = await verifyBackup(backupId);
    if (!verified.ok) await run('UPDATE backups SET status = ? WHERE id = ?', ['invalid', backupId]);
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

export async function verifyBackup(backupId: string): Promise<{ ok: boolean; message: string; checksum?: string }> {
  const backup = await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!backup) throw notFound('نسخه پشتیبان یافت نشد.');
  const file = path.join(backup.location ?? backupDir(), backup.filename);
  if (!fs.existsSync(file)) return { ok: false, message: 'فایل پشتیبان روی سرور موجود نیست.' };

  const checksum = await hashFile(file);
  if (backup.checksum && checksum !== backup.checksum) {
    return { ok: false, message: 'مجموع کنترلی فایل با مقدار ثبت‌شده مطابقت ندارد.', checksum };
  }

  if (backup.filename.endsWith('.dump')) {
    try {
      await exec('pg_restore', ['--list', file], { timeout: 120_000 });
      return { ok: true, message: 'نسخه پشتیبان PostgreSQL سالم است.', checksum };
    } catch {
      return { ok: false, message: 'فایل pg_dump قابل خواندن نیست.', checksum };
    }
  }

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('PRAGMA integrity_check').get() as any;
    db.close();
    const ok = row && (row.integrity_check === 'ok' || Object.values(row)[0] === 'ok');
    return { ok: Boolean(ok), message: ok ? 'یکپارچگی پایگاه داده تأیید شد.' : 'بررسی یکپارچگی ناموفق بود.', checksum };
  } catch (err: any) {
    return { ok: false, message: `فایل پایگاه داده قابل باز کردن نیست: ${err?.message ?? ''}`, checksum };
  }
}

export async function listBackups(): Promise<BackupRow[]> {
  return q<BackupRow>('SELECT * FROM backups ORDER BY created_at DESC LIMIT 100');
}

async function pruneOldBackups(): Promise<void> {
  const retention = await getNumber('backup.retention_days');
  const cutoff = new Date(Date.now() - retention * 86_400_000).toISOString();
  const old = await q<BackupRow>('SELECT * FROM backups WHERE created_at < ?', [cutoff]);
  for (const backup of old) {
    const file = path.join(backup.location ?? backupDir(), backup.filename);
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    await run('DELETE FROM backups WHERE id = ?', [backup.id]);
  }
}

export async function deleteBackup(backupId: string): Promise<void> {
  const backup = await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!backup) throw notFound('نسخه پشتیبان یافت نشد.');
  const file = path.join(backup.location ?? backupDir(), backup.filename);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
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
  const verified=await verifyBackup(backupId);
  if(!verified.ok)throw badRequest('صحت نسخه پشتیبان تأیید نشد؛ بازیابی لغو شد.');
  const backup = await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!backup) throw notFound('نسخه پشتیبان یافت نشد.');
  const file = path.join(backup.location ?? backupDir(), backup.filename);
  if (!fs.existsSync(file)) throw badRequest('فایل پشتیبان موجود نیست.');

  const safety = await createBackup(actor, 'پشتیبان ایمنی پیش از بازیابی');

  if (env.dbDriver === 'postgres') {
    try {
      await exec('pg_restore', ['--clean', '--if-exists', '--no-owner', `--dbname=${env.databaseUrl}`, file], { timeout: 30 * 60_000 });
    } catch (err: any) {
      throw badRequest(`بازیابی ناموفق بود: ${err?.message ?? ''}`);
    }
    return { ok: true, message: 'بازیابی انجام شد. برای اطمینان کامل سرویس را یک‌بار ری‌استارت کنید.', safetyBackup: safety.filename };
  }

  // SQLite: replace the database file. The API keeps its handle, so a restart is required.
  const current = env.sqliteFile;
  const temp = `${current}.restore-${Date.now()}`;
  fs.copyFileSync(file, temp);
  await closeDb();
  fs.copyFileSync(temp, current);
  try { fs.unlinkSync(temp); } catch { /* ignore */ }
  return {
    ok: true,
    message: 'بازیابی انجام شد. سرویس را با دستور sudo systemctl restart pishkan ری‌استارت کنید تا تغییرات اعمال شود.',
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
      id: last.id, filename: last.filename, size: Number(last.size), status: last.status,
      createdAt: last.created_at,
    } : null,
  };
}
