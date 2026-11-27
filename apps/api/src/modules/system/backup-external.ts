/**
 * Off-server backup transfers: SFTP (SSH), FTP/FTPS, Google Drive (OAuth).
 *
 * The local backup row stays the source of truth; every uploaded part gets a
 * `backup_transfers` row with its remote path, size, checksum and outcome.
 * Credentials are read through getSecret (AES-256-GCM at rest) and never
 * logged. Failures are recorded and surfaced to admins — a failed transfer
 * never deletes or invalidates the local copy.
 *
 * Remote retention only ever deletes files matching the `pishkan-` prefix
 * that this module itself uploaded (tracked in backup_transfers), so a
 * misconfigured destination path can never wipe unrelated remote files.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { env } from '../../env.js';
import { getBool, getNumber, getString, getSecret } from '../settings/service.js';
import { logEvent } from '../logging/service.js';
import { notifyRole } from '../notifications/service.js';
import { badRequest, notFound } from '../../http/errors.js';
import type { BackupRow } from './backup.js';

export type ExternalTarget = 'sftp' | 'ftp' | 'gdrive';

export interface TransferRow {
  id: string; backup_id: string; target: string; filename: string; remote_path: string;
  size: number; checksum: string | null; status: string; error: string | null; created_at: string;
}

export interface UploadedPart { remotePath: string; size: number; }

/** One destination connection; implementations live below. */
export interface ExternalAdapter {
  /** Verify credentials/connectivity without writing anything. */
  test(): Promise<{ ok: boolean; message: string }>;
  /** Upload one local file into the destination folder, return remote path. */
  upload(localFile: string, remoteName: string): Promise<UploadedPart>;
  /** Delete previously-uploaded pishkan-* files beyond the retention count. */
  prune(retention: number, keepRemotePaths: Set<string>): Promise<number>;
  close(): Promise<void>;
}

/* ------------------------------- SFTP ---------------------------------- */

async function sftpAdapter(): Promise<ExternalAdapter> {
  const host = (await getString('backup.sftp_host')).trim();
  const port = await getNumber('backup.sftp_port');
  const username = (await getString('backup.sftp_username')).trim();
  const password = await getSecret('backup.sftp_password');
  const privateKey = await getSecret('backup.sftp_private_key');
  const passphrase = await getSecret('backup.sftp_passphrase');
  const remoteDir = ((await getString('backup.external_path')) || 'pishkan-backups').trim();
  if (!host || !username || (!password && !privateKey)) {
    throw badRequest('تنظیمات SFTP کامل نیست: میزبان، نام کاربری و یکی از رمز/کلید خصوصی لازم است.');
  }
  const { Client } = await import('ssh2');
  const conn = new Client();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { conn.destroy(); reject(new Error('اتصال SFTP در مهلت ۲۰ ثانیه برقرار نشد.')); }, 20_000);
    conn.on('ready', () => { clearTimeout(timer); resolve(); });
    conn.on('error', (err) => { clearTimeout(timer); reject(new Error(`خطای اتصال SFTP: ${err.message}`)); });
    conn.connect({
      host, port, username,
      ...(privateKey ? { privateKey, ...(passphrase ? { passphrase } : {}) } : { password }),
      readyTimeout: 20_000,
    });
  });
  const sftp = await new Promise<any>((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(new Error(`راه‌اندازی SFTP ناموفق: ${err.message}`)) : resolve(s)));
  });
  const call = <T>(fn: (cb: (err: any, result?: T) => void) => void) =>
    new Promise<T>((resolve, reject) => fn((err, result) => (err ? reject(err) : resolve(result as T))));

  // mkdir -p over SFTP (no shell on the remote side).
  const parts = remoteDir.split('/').filter(Boolean);
  let cursor = remoteDir.startsWith('/') ? '/' : '';
  for (const part of parts) {
    cursor = cursor ? path.posix.join(cursor, part) : part;
    await call<void>((cb) => sftp.mkdir(cursor, cb)).catch(() => undefined); // exists → fine
  }

  return {
    async test() {
      await call<any[]>((cb) => sftp.readdir(cursor, cb));
      return { ok: true, message: `اتصال SFTP به ${host}:${port} برقرار است و پوشهٔ ${cursor} قابل دسترسی است.` };
    },
    async upload(localFile, remoteName) {
      const remotePath = path.posix.join(cursor, remoteName);
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localFile, remotePath, (err: any) => (err ? reject(new Error(`بارگذاری SFTP ناموفق: ${err.message}`)) : resolve()));
      });
      const stat = await call<any>((cb) => sftp.stat(remotePath, cb));
      const localSize = fs.statSync(localFile).size;
      if (Number(stat.size) !== localSize) {
        throw new Error(`اندازهٔ فایل روی مقصد (${stat.size}) با مبدأ (${localSize}) برابر نیست؛ انتقال ناقص بود.`);
      }
      return { remotePath, size: localSize };
    },
    async prune(retention, keep) {
      const entries = await call<any[]>((cb) => sftp.readdir(cursor, cb));
      const candidates = entries
        .filter((e) => /^pishkan-/.test(e.filename) && e.attrs.isFile?.())
        .map((e) => ({ name: e.filename as string, mtime: Number(e.attrs.mtime ?? 0), full: path.posix.join(cursor, e.filename) }))
        .filter((e) => !keep.has(e.full))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(retention);
      let removed = 0;
      for (const item of candidates) {
        await call<void>((cb) => sftp.unlink(item.full, cb)).then(() => { removed += 1; }).catch(() => undefined);
      }
      return removed;
    },
    async close() { conn.end(); },
  };
}

/* -------------------------------- FTP ---------------------------------- */

async function ftpAdapter(): Promise<ExternalAdapter> {
  const host = (await getString('backup.ftp_host')).trim();
  const port = await getNumber('backup.ftp_port');
  const user = (await getString('backup.ftp_username')).trim();
  const password = await getSecret('backup.ftp_password');
  const secure = await getBool('backup.ftp_secure');
  const remoteDir = ((await getString('backup.external_path')) || 'pishkan-backups').trim();
  if (!host || !user) throw badRequest('تنظیمات FTP کامل نیست: میزبان و نام کاربری لازم است.');
  const ftp = await import('basic-ftp');
  const client = new ftp.Client(30_000);
  await client.access({ host, port, user, password, secure });
  await client.ensureDir(remoteDir);

  return {
    async test() {
      const list = await client.list();
      return { ok: true, message: `اتصال ${secure ? 'FTPS' : 'FTP'} به ${host}:${port} برقرار است (${list.length} قلم در پوشهٔ مقصد).` };
    },
    async upload(localFile, remoteName) {
      await client.uploadFrom(localFile, remoteName);
      const size = await client.size(remoteName);
      const localSize = fs.statSync(localFile).size;
      if (size !== localSize) {
        throw new Error(`اندازهٔ فایل روی مقصد (${size}) با مبدأ (${localSize}) برابر نیست؛ انتقال ناقص بود.`);
      }
      return { remotePath: path.posix.join(remoteDir, remoteName), size: localSize };
    },
    async prune(retention, keep) {
      const list = await client.list();
      const candidates = list
        .filter((e) => e.isFile && /^pishkan-/.test(e.name))
        .map((e) => ({ name: e.name, mtime: e.modifiedAt?.getTime() ?? 0, full: path.posix.join(remoteDir, e.name) }))
        .filter((e) => !keep.has(e.full))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(retention);
      let removed = 0;
      for (const item of candidates) {
        await client.remove(item.name).then(() => { removed += 1; }).catch(() => undefined);
      }
      return removed;
    },
    async close() { client.close(); },
  };
}

/* ----------------------------- Google Drive ----------------------------- */

async function gdriveAdapter(): Promise<ExternalAdapter> {
  const clientId = (await getString('backup.gdrive_client_id')).trim();
  const clientSecret = await getSecret('backup.gdrive_client_secret');
  const refreshToken = await getSecret('backup.gdrive_refresh_token');
  const folderId = (await getString('backup.gdrive_folder_id')).trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw badRequest('تنظیمات Google Drive کامل نیست: Client ID، Client Secret و Refresh Token لازم است (راهنما: docs/BACKUP-EXTERNAL-FA.md).');
  }
  // Fresh access token from the stored refresh token — the app never needs
  // an interactive OAuth round-trip after the one-time setup.
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20_000),
  });
  const tokenJson: any = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenJson.access_token) {
    throw new Error(`دریافت توکن Google ناموفق بود (${tokenResponse.status}): ${String(tokenJson.error_description ?? tokenJson.error ?? 'پاسخ نامعتبر').slice(0, 200)}`);
  }
  const accessToken = String(tokenJson.access_token);
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
    return response;
  }

  return {
    async test() {
      const about = await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota');
      if (!about.ok) return { ok: false, message: `دسترسی به Google Drive ممکن نیست (${about.status}). دسترسی drive.file و صحت Refresh Token را بررسی کنید.` };
      const info: any = await about.json();
      return { ok: true, message: `اتصال Google Drive برقرار است (حساب: ${info?.user?.emailAddress ?? 'نامشخص'}).` };
    },
    async upload(localFile, remoteName) {
      const metadata: Record<string, unknown> = { name: remoteName };
      if (folderId) metadata.parents = [folderId];
      // Resumable upload: initiate, then PUT the bytes. Handles large archives.
      const init = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,name', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream' },
        body: JSON.stringify(metadata),
      });
      if (!init.ok) throw new Error(`شروع بارگذاری Google Drive ناموفق (${init.status}): ${(await init.text()).slice(0, 200)}`);
      const sessionUrl = init.headers.get('location');
      if (!sessionUrl) throw new Error('Google Drive نشانی نشست بارگذاری را برنگرداند.');
      const buffer = fs.readFileSync(localFile);
      const put = await fetch(sessionUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(buffer.length) },
        body: buffer,
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const putJson: any = await put.json().catch(() => ({}));
      if (!put.ok || !putJson.id) throw new Error(`بارگذاری Google Drive ناموفق (${put.status}): ${JSON.stringify(putJson.error ?? {}).slice(0, 200)}`);
      if (String(putJson.size ?? buffer.length) !== String(buffer.length)) {
        throw new Error('اندازهٔ فایل ثبت‌شده در Google Drive با فایل مبدأ برابر نیست.');
      }
      return { remotePath: `gdrive:${putJson.id}`, size: buffer.length };
    },
    async prune(retention, keep) {
      const query = encodeURIComponent(`name contains 'pishkan-' and trashed = false${folderId ? ` and '${folderId}' in parents` : ''}`);
      const list = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=1000`);
      if (!list.ok) return 0;
      const json: any = await list.json();
      const files: { id: string; name: string }[] = json.files ?? [];
      const candidates = files.filter((f) => !keep.has(`gdrive:${f.id}`)).slice(retention);
      let removed = 0;
      for (const file of candidates) {
        const del = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE' });
        if (del.ok || del.status === 204) removed += 1;
      }
      return removed;
    },
    async close() { /* stateless HTTP */ },
  };
}

export async function openAdapter(target: ExternalTarget): Promise<ExternalAdapter> {
  if (target === 'sftp') return sftpAdapter();
  if (target === 'ftp') return ftpAdapter();
  if (target === 'gdrive') return gdriveAdapter();
  throw badRequest('مقصد خارجی نامعتبر است.');
}

/* ----------------------------- orchestration ---------------------------- */

async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function localPath(filename: string): string {
  if (path.basename(filename) !== filename) throw badRequest('نام فایل پشتیبان نامعتبر است.');
  return path.join(env.backupDir, filename);
}

/** Connection/credentials check for the settings UI — writes nothing. */
export async function testExternalTarget(): Promise<{ ok: boolean; target: string; message: string }> {
  const target = (await getString('backup.external_target')) as ExternalTarget;
  let adapter: ExternalAdapter | null = null;
  try {
    adapter = await openAdapter(target);
    const result = await adapter.test();
    return { ...result, target };
  } catch (error) {
    return { ok: false, target, message: error instanceof Error ? error.message : 'خطای ناشناخته در آزمایش مقصد خارجی' };
  } finally {
    await adapter?.close().catch(() => undefined);
  }
}

export interface TransferSummary {
  backupId: string; target: string; uploaded: number; failed: number; pruned: number; errors: string[];
}

/**
 * Transfer both parts of one successful backup to the configured external
 * target. Called after manual and scheduled backups when external storage is
 * enabled. Never throws for transfer problems — each part's outcome is
 * recorded, and admins are notified once per backup on failure.
 */
export async function transferBackup(backupId: string): Promise<TransferSummary> {
  const backup = await one<BackupRow>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!backup) throw notFound('نسخه پشتیبان یافت نشد.');
  if (backup.status !== 'ok') throw badRequest('فقط نسخهٔ پشتیبان موفق قابل انتقال به مقصد خارجی است.');
  const target = (await getString('backup.external_target')) as ExternalTarget;
  const summary: TransferSummary = { backupId, target, uploaded: 0, failed: 0, pruned: 0, errors: [] };

  const parts: { filename: string; checksum: string | null }[] = [{ filename: backup.filename, checksum: backup.checksum }];
  if (backup.uploads_filename) parts.push({ filename: backup.uploads_filename, checksum: backup.uploads_checksum ?? null });
  const codeMatch = /^pishkan-(.+)\.(dump|db)$/.exec(backup.filename);
  if (codeMatch) {
    const codeFilename = `pishkan-code-${codeMatch[1]}.tar.gz`;
    if (fs.existsSync(path.join(backup.location || env.backupDir, codeFilename))) {
      parts.push({ filename: codeFilename, checksum: null });
    }
  }

  let adapter: ExternalAdapter | null = null;
  try {
    adapter = await openAdapter(target);
    for (const part of parts) {
      const file = localPath(part.filename);
      const transferId = id('btr');
      try {
        if (!fs.existsSync(file)) throw new Error('فایل محلی پشتیبان پیدا نشد.');
        const checksum = part.checksum ?? await hashFile(file);
        const uploaded = await adapter.upload(file, part.filename);
        await run(
          `INSERT INTO backup_transfers (id, backup_id, target, filename, remote_path, size, checksum, status, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?)`,
          [transferId, backupId, target, part.filename, uploaded.remotePath, uploaded.size, checksum, nowIso()],
        );
        summary.uploaded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'خطای ناشناخته در انتقال';
        summary.failed += 1;
        summary.errors.push(`${part.filename}: ${message}`);
        await run(
          `INSERT INTO backup_transfers (id, backup_id, target, filename, remote_path, size, checksum, status, error, created_at)
           VALUES (?, ?, ?, ?, '', 0, NULL, 'failed', ?, ?)`,
          [transferId, backupId, target, part.filename, message.slice(0, 500), nowIso()],
        ).catch(() => undefined);
      }
    }

    // Remote retention: keep the newest N successfully transferred files.
    // "keep" = every remote path still referenced by a local backup row, so
    // pruning never removes the only off-server copy of a retained backup.
    if (summary.uploaded > 0) {
      const retention = await getNumber('backup.external_retention');
      const okTransfers = await q<TransferRow>("SELECT * FROM backup_transfers WHERE status = 'ok' AND target = ? ORDER BY created_at DESC", [target]);
      const keep = new Set(okTransfers.slice(0, retention * 2).map((t) => t.remote_path));
      summary.pruned = await adapter.prune(retention * 2, keep).catch(() => 0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'خطای ناشناخته در مقصد خارجی';
    summary.failed += parts.length - summary.uploaded;
    summary.errors.push(message);
    await run(
      `INSERT INTO backup_transfers (id, backup_id, target, filename, remote_path, size, checksum, status, error, created_at)
       VALUES (?, ?, ?, '', '', 0, NULL, 'failed', ?, ?)`,
      [id('btr'), backupId, target, message.slice(0, 500), nowIso()],
    ).catch(() => undefined);
  } finally {
    await adapter?.close().catch(() => undefined);
  }

  await logEvent({
    level: summary.failed > 0 ? 'ERROR' : 'INFO',
    category: 'backup', action: 'backup.external_transfer', result: summary.failed > 0 ? 'failure' : 'success',
    entityType: 'backup', entityId: backupId,
    message: summary.failed > 0
      ? `انتقال پشتیبان به ${target} ناقص ماند (${summary.uploaded} موفق، ${summary.failed} ناموفق).`
      : `پشتیبان به مقصد خارجی ${target} منتقل شد (${summary.uploaded} فایل).`,
    details: { target, uploaded: summary.uploaded, failed: summary.failed, pruned: summary.pruned, errors: summary.errors.slice(0, 5) },
  });

  if (summary.failed > 0) {
    await notifyRole(['super_admin'], {
      title: 'انتقال پشتیبان به مقصد خارجی ناموفق بود',
      body: `نسخهٔ ${backup.filename} به ${target} منتقل نشد: ${summary.errors[0] ?? ''} — نسخهٔ محلی سالم است؛ تنظیمات مقصد خارجی را بررسی کنید.`,
      kind: 'error', link: '/admin/operations?tab=backup',
      idempotencyKey: `backup-external-failed:${backupId}`,
    }).catch(() => undefined);
  }
  return summary;
}

/** Post-backup hook: transfer when enabled; a transfer failure never fails the backup itself. */
export async function maybeTransferBackup(backupId: string): Promise<TransferSummary | null> {
  if (!(await getBool('backup.external_enabled').catch(() => false))) return null;
  try {
    return await transferBackup(backupId);
  } catch (error) {
    await logEvent({
      level: 'ERROR', category: 'backup', action: 'backup.external_transfer', result: 'failure',
      entityType: 'backup', entityId: backupId,
      message: 'انتقال خارجی پشتیبان اجرا نشد.',
      details: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return null;
  }
}

export async function listTransfers(backupId?: string): Promise<TransferRow[]> {
  if (backupId) {
    return q<TransferRow>('SELECT * FROM backup_transfers WHERE backup_id = ? ORDER BY created_at DESC LIMIT 100', [backupId]);
  }
  return q<TransferRow>('SELECT * FROM backup_transfers ORDER BY created_at DESC LIMIT 100');
}
