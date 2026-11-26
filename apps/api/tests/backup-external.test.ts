import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { q, run } from '../src/db/index.js';

/**
 * REAL off-server transfer tests. A genuine SFTP server (paramiko, actual
 * SSH handshake) and a genuine FTP server (pyftpdlib) run as child processes
 * on loopback; the app transfers a real backup to them and we verify the
 * bytes on the remote side by checksum — not a mock, not a simulation.
 *
 * Skipped automatically when the Python fixture runtime is unavailable
 * (e.g. a Windows dev box without the test venv); CI/provisioned environments
 * run it. Google Drive needs real OAuth credentials and is covered by the
 * honest "unconfigured" path here plus the documented manual procedure.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const python = path.join(repoRoot, '.venv/bin/python');
const fixtures = path.join(__dirname, 'fixtures');
const hasPython = fs.existsSync(python);

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
const children: ChildProcess[] = [];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-external-test-'));
const sftpRoot = path.join(root, 'sftp-root');
const ftpRoot = path.join(root, 'ftp-root');
const hostKey = path.join(root, 'host_key');
let sftpPort = 0;
let ftpPort = 0;
let backupId = '';

const actor = { id: 'system', name: 'external-test' };

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(script: string, args: string[]): Promise<void> {
  const child = spawn(python, [path.join(fixtures, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${script} did not become ready in 20s`)), 20_000);
    child.stdout!.on('data', (chunk) => {
      if (String(chunk).includes('READY')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${script} exited early (${code})`)); });
  });
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

beforeAll(async () => {
  if (!hasPython) return;
  server = await app();
  admin = await adminSession();
  sftpPort = await freePort();
  ftpPort = await freePort();
  await startServer('sftp_server.py', [String(sftpPort), sftpRoot, 'backupuser', 'SftpTest#123', hostKey]);
  await startServer('ftp_server.py', [String(ftpPort), ftpRoot, 'backupuser', 'FtpTest#123']);

  await updateSettings({ 'backup.include_uploads': true, 'backup.verify_after_backup': false } as any, actor, { confirmCritical: true });
  const created = await request(server).post('/api/system/backups').set('Cookie', admin.cookie).send({ note: 'external-test' }).expect(200);
  backupId = created.body.data.id;
}, 90_000);

afterAll(async () => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  if (hasPython) {
    await updateSettings({ 'backup.external_enabled': false } as any, actor, { confirmCritical: true }).catch(() => undefined);
    await run("DELETE FROM backup_transfers WHERE backup_id IN (SELECT id FROM backups WHERE note = 'external-test')").catch(() => undefined);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasPython)('external backup transfers (real SFTP/FTP servers)', () => {
  it('rejects an unconfigured destination with a clear Persian error', async () => {
    await updateSettings({ 'backup.external_target': 'sftp', 'backup.sftp_host': '', 'backup.sftp_username': '' } as any, actor, { confirmCritical: true });
    const res = await request(server).post('/api/system/backups/external/test').set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.message).toContain('SFTP');
  });

  it('transfers both backup parts over real SFTP with matching checksums', async () => {
    await updateSettings({
      'backup.external_target': 'sftp',
      'backup.sftp_host': '127.0.0.1', 'backup.sftp_port': sftpPort,
      'backup.sftp_username': 'backupuser', 'backup.sftp_password': 'SftpTest#123',
      'backup.external_path': 'offsite/nested', 'backup.external_retention': 14,
    } as any, actor, { confirmCritical: true });

    const test = await request(server).post('/api/system/backups/external/test').set('Cookie', admin.cookie).expect(200);
    expect(test.body.data.ok).toBe(true);

    const res = await request(server).post(`/api/system/backups/${backupId}/transfer`).set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.uploaded).toBe(2); // db + uploads archive
    expect(res.body.data.failed).toBe(0);

    // Verify the REAL bytes landed on the remote side.
    const remoteDir = path.join(sftpRoot, 'offsite/nested');
    const files = fs.readdirSync(remoteDir);
    expect(files.length).toBe(2);
    const rows = await q<any>("SELECT * FROM backup_transfers WHERE backup_id = ? AND status = 'ok'", [backupId]);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const remoteFile = path.join(remoteDir, row.filename);
      expect(fs.existsSync(remoteFile)).toBe(true);
      expect(sha256(remoteFile)).toBe(row.checksum); // byte-for-byte integrity
      expect(fs.statSync(remoteFile).size).toBe(Number(row.size));
    }
  }, 60_000);

  it('records a failed transfer honestly and keeps the local backup intact', async () => {
    await updateSettings({ 'backup.sftp_password': 'WrongPassword#1' } as any, actor, { confirmCritical: true });
    const res = await request(server).post(`/api/system/backups/${backupId}/transfer`).set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.failed).toBeGreaterThan(0);
    expect(res.body.data.errors.length).toBeGreaterThan(0);

    const failed = await q<any>("SELECT * FROM backup_transfers WHERE backup_id = ? AND status = 'failed' ORDER BY created_at DESC", [backupId]);
    expect(failed.length).toBeGreaterThan(0);
    const local = await request(server).get('/api/system/backups').set('Cookie', admin.cookie).expect(200);
    const mine = local.body.data.find((b: any) => b.id === backupId);
    expect(mine.status).toBe('ok'); // local copy untouched

    await updateSettings({ 'backup.sftp_password': 'SftpTest#123' } as any, actor, { confirmCritical: true });
  }, 60_000);

  it('transfers over real FTP and verifies remote checksums', async () => {
    await updateSettings({
      'backup.external_target': 'ftp',
      'backup.ftp_host': '127.0.0.1', 'backup.ftp_port': ftpPort,
      'backup.ftp_username': 'backupuser', 'backup.ftp_password': 'FtpTest#123',
      'backup.ftp_secure': false, // loopback test server is plain FTP
      'backup.external_path': 'ftp-offsite',
    } as any, actor, { confirmCritical: true });

    const test = await request(server).post('/api/system/backups/external/test').set('Cookie', admin.cookie).expect(200);
    expect(test.body.data.ok).toBe(true);

    const res = await request(server).post(`/api/system/backups/${backupId}/transfer`).set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.uploaded).toBe(2);
    expect(res.body.data.failed).toBe(0);

    const remoteDir = path.join(ftpRoot, 'ftp-offsite');
    const rows = await q<any>("SELECT * FROM backup_transfers WHERE backup_id = ? AND target = 'ftp' AND status = 'ok'", [backupId]);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(sha256(path.join(remoteDir, row.filename))).toBe(row.checksum);
    }
  }, 60_000);

  it('prunes only its own pishkan-* files beyond retention, never foreign files', async () => {
    // Seed the remote with old pishkan-* files and one foreign file.
    const remoteDir = path.join(sftpRoot, 'offsite/nested');
    for (let i = 0; i < 6; i += 1) {
      const f = path.join(remoteDir, `pishkan-old-${i}.db`);
      fs.writeFileSync(f, `old-${i}`);
      const past = new Date(Date.now() - (100 - i) * 3_600_000);
      fs.utimesSync(f, past, past);
    }
    fs.writeFileSync(path.join(remoteDir, 'important-foreign-file.txt'), 'do not delete');

    await updateSettings({
      'backup.external_target': 'sftp', 'backup.external_retention': 2,
      'backup.external_path': 'offsite/nested',
      'backup.sftp_password': 'SftpTest#123',
    } as any, actor, { confirmCritical: true });
    const res = await request(server).post(`/api/system/backups/${backupId}/transfer`).set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.uploaded).toBe(2);

    const files = fs.readdirSync(remoteDir);
    expect(files).toContain('important-foreign-file.txt'); // foreign file survives
    const oldRemaining = files.filter((f) => f.startsWith('pishkan-old-'));
    expect(oldRemaining.length).toBeLessThan(6); // pruning happened
    // The freshly transferred parts are always kept.
    const rows = await q<any>("SELECT filename FROM backup_transfers WHERE backup_id = ? AND target = 'sftp' AND status = 'ok'", [backupId]);
    for (const row of rows) expect(files).toContain(row.filename);
  }, 60_000);

  it('auto-transfers after a scheduled-style backup when external storage is enabled', async () => {
    await updateSettings({ 'backup.external_enabled': true, 'backup.external_target': 'ftp', 'backup.external_retention': 14 } as any, actor, { confirmCritical: true });
    const created = await request(server).post('/api/system/backups').set('Cookie', admin.cookie).send({ note: 'external-test' }).expect(200);
    expect(created.body.data.transfer).toBeTruthy();
    expect(created.body.data.transfer.uploaded).toBe(2);
    expect(created.body.data.transfer.failed).toBe(0);

    const history = await request(server).get(`/api/system/backups/transfers?backupId=${created.body.data.id}`).set('Cookie', admin.cookie).expect(200);
    expect(history.body.data.length).toBe(2);
    expect(history.body.data.every((t: any) => t.status === 'ok')).toBe(true);
    await updateSettings({ 'backup.external_enabled': false } as any, actor, { confirmCritical: true });
  }, 90_000);

  it('google drive without credentials fails honestly, not silently', async () => {
    await updateSettings({ 'backup.external_target': 'gdrive', 'backup.gdrive_client_id': '', 'backup.gdrive_refresh_token': '' } as any, actor, { confirmCritical: true });
    const res = await request(server).post('/api/system/backups/external/test').set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.message).toContain('Google Drive');
    await updateSettings({ 'backup.external_target': 'sftp' } as any, actor, { confirmCritical: true });
  });

  it('requires backup permissions for transfer endpoints', async () => {
    await request(server).post('/api/system/backups/external/test').expect(401);
    await request(server).get('/api/system/backups/transfers').expect(401);
  });
});
