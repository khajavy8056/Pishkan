import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { app, adminSession, customerSession, ADMIN } from './helpers.js';
import { env } from '../src/env.js';
import { closeDb, one, run } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { runSeed } from '../src/modules/catalog/seed.js';
import { invalidateSettingsCache, updateSettings } from '../src/modules/settings/service.js';
import {
  stageRestoreUpload, executeRestore, getRestoreJob, createBackupPackage,
} from '../src/modules/system/restore-package.js';

/**
 * HTTP surface of one-file restore: package creation, upload + inspection,
 * guards. Execution itself is covered in the isolated block below so the
 * shared test database is never swapped under other suites.
 */
describe('restore package HTTP surface', () => {
  it('creates a downloadable one-file package and inspects an uploaded one', async () => {
    const server = await app();
    const admin = await adminSession();

    const pkg = await request(server)
      .post('/api/system/backups/package')
      .set('Cookie', admin.cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pkg.status).toBe(200);
    const bytes = pkg.body as Buffer;
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    const staged = await request(server)
      .post('/api/system/backups/restore-upload')
      .set('Cookie', admin.cookie)
      .attach('file', bytes, 'pishkan-package.zip');
    expect(staged.status).toBe(201);
    expect(staged.body.data.inspection.type).toBe('package');
    expect(staged.body.data.inspection.migrations).toBeGreaterThan(0);
    expect(staged.body.data.inspection.includesUploads).toBe(true);
    const jobId = staged.body.data.jobId as string;

    const status = await request(server).get(`/api/system/backups/restore-upload/${jobId}`).set('Cookie', admin.cookie);
    expect(status.body.data.stage).toBe('staged');

    // Guards: wrong phrase and wrong password never start a restore.
    const badPhrase = await request(server)
      .post(`/api/system/backups/restore-upload/${jobId}/execute`)
      .set('Cookie', admin.cookie)
      .send({ confirmation: 'yes', password: ADMIN.password });
    expect(badPhrase.status).toBe(400);
    const badPassword = await request(server)
      .post(`/api/system/backups/restore-upload/${jobId}/execute`)
      .set('Cookie', admin.cookie)
      .send({ confirmation: 'RESTORE', password: 'WrongPassword#1' });
    expect(badPassword.status).toBe(400);

    const discarded = await request(server).delete(`/api/system/backups/restore-upload/${jobId}`).set('Cookie', admin.cookie);
    expect(discarded.status).toBe(200);
  });

  it('rejects garbage uploads and non-privileged users', async () => {
    const server = await app();
    const admin = await adminSession();
    const garbage = await request(server)
      .post('/api/system/backups/restore-upload')
      .set('Cookie', admin.cookie)
      .attach('file', Buffer.from('this is not a backup at all'), 'fake.zip');
    expect(garbage.status).toBe(400);

    const customer = await customerSession();
    const forbidden = await request(server)
      .post('/api/system/backups/restore-upload')
      .set('Cookie', customer.cookie)
      .attach('file', Buffer.from('PK\x03\x04'), 'x.zip');
    expect(forbidden.status).toBe(403);
  });
});

/**
 * Full execution in an isolated root (the backup-restore.test.ts pattern):
 * package → stage → execute → database + uploads really swap, sessions are
 * cleared, and a safety backup stays behind.
 */
describe('restore package execution (isolated)', () => {
  const original = { sqliteFile: env.sqliteFile, uploadDir: env.uploadDir, backupDir: env.backupDir };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-package-test-'));

  beforeAll(async () => {
    await closeDb();
    Object.assign(env, {
      sqliteFile: path.join(root, 'isolated.sqlite'),
      uploadDir: path.join(root, 'uploads'),
      backupDir: path.join(root, 'backups'),
    });
    invalidateSettingsCache();
  });

  afterAll(async () => {
    await closeDb();
    Object.assign(env, original);
    invalidateSettingsCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('restores database + uploads from a package and clears sessions', async () => {
    await migrate();
    await runSeed({ admin: { username: 'package-admin', password: 'PackageTest#12345', fullName: 'نام پیش از پشتیبان' }, log: () => undefined });
    await updateSettings({ 'backup.include_uploads': true }, { id: 'package-test', name: 'آزمون' });
    const admin = await one<{ id: string }>("SELECT id FROM users WHERE username = 'package-admin'");
    expect(admin).toBeTruthy();

    fs.mkdirSync(path.join(env.uploadDir, 'private'), { recursive: true });
    const marker = path.join(env.uploadDir, 'private', 'marker.txt');
    fs.writeFileSync(marker, 'state-at-backup');
    await run(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ['sess-test', admin!.id, 'hash-test', new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString()],
    );

    const pkg = await createBackupPackage();
    const uploaded = path.join(root, 'uploaded.zip');
    fs.copyFileSync(pkg.path, uploaded);
    fs.rmSync(pkg.path, { force: true });

    await run("UPDATE users SET full_name = 'نام پس از پشتیبان' WHERE id = ?", [admin!.id]);
    fs.writeFileSync(marker, 'modified-after-backup');
    fs.writeFileSync(path.join(env.uploadDir, 'should-be-removed.txt'), 'not-in-snapshot');

    const staged = await stageRestoreUpload(uploaded, { id: admin!.id, name: 'آزمون بسته' });
    expect(staged.inspection.type).toBe('package');
    expect(staged.inspection.includesUploads).toBe(true);

    executeRestore(staged.jobId);
    let job = getRestoreJob(staged.jobId);
    for (let i = 0; i < 150 && job.stage !== 'done' && job.stage !== 'failed'; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      job = getRestoreJob(staged.jobId);
    }
    expect(job.stage).toBe('done');

    expect((await one<{ full_name: string }>('SELECT full_name FROM users WHERE id = ?', [admin!.id]))?.full_name).toBe('نام پیش از پشتیبان');
    expect(fs.readFileSync(marker, 'utf8')).toBe('state-at-backup');
    expect(fs.existsSync(path.join(env.uploadDir, 'should-be-removed.txt'))).toBe(false);
    expect(Number((await one<{ c: number }>('SELECT COUNT(*) AS c FROM sessions'))?.c ?? -1)).toBe(0);
    const safetyRow = await one<{ id: string }>("SELECT id FROM backups WHERE note LIKE '%پشتیبان ایمنی پیش از بازیابی از فایل%' LIMIT 1");
    expect(safetyRow).toBeTruthy();
  }, 60_000);

  it('rejects zip-slip packages and non-backup files', async () => {
    const evil = new AdmZip();
    evil.addFile('../escape.txt', Buffer.from('boom'));
    evil.addFile('database.sqlite', Buffer.from('not-a-db'));
    const evilPath = path.join(root, 'evil.zip');
    evil.writeZip(evilPath);
    await expect(stageRestoreUpload(evilPath, { id: 'x', name: 'آزمون' })).rejects.toThrow();

    const garbagePath = path.join(root, 'garbage.zip');
    fs.writeFileSync(garbagePath, 'plain text, not a backup');
    await expect(stageRestoreUpload(garbagePath, { id: 'x', name: 'آزمون' })).rejects.toThrow();
  });
});
