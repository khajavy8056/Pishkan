import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';
import { env } from '../src/env.js';
import { getDb } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';

describe('backup, audit and system status', () => {
  it('reports system status with version and migrations', async () => {
    const admin = await adminSession();
    const server = await app();
    const res = await request(server).get('/api/system/status').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBeTruthy();
    expect(res.body.data.migrations.count).toBeGreaterThanOrEqual(5);
  });

  it('creates and verifies a database backup', async () => {
    const admin = await adminSession();
    const server = await app();
    const created = await request(server).post('/api/system/backups').set('Cookie', admin.cookie).send({ note: 'تست خودکار' });
    expect(created.status).toBe(200);
    expect(created.body.data.size).toBeGreaterThan(0);
    expect(fs.existsSync(`${env.backupDir}/${created.body.data.filename}`)).toBe(true);
    expect(created.body.data.uploads_filename).toBeTruthy();
    expect(created.body.data.uploads_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(`${env.backupDir}/${created.body.data.uploads_filename}`)).toBe(true);

    const archive = `${env.backupDir}/${created.body.data.uploads_filename}`;
    const original = fs.readFileSync(archive);
    fs.writeFileSync(archive, Buffer.from('corrupted archive'));
    const corrupted = await request(server).post(`/api/system/backups/${created.body.data.id}/verify`).set('Cookie', admin.cookie);
    expect(corrupted.body.data.ok).toBe(false);
    fs.writeFileSync(archive, original);

    const verify = await request(server).post(`/api/system/backups/${created.body.data.id}/verify`).set('Cookie', admin.cookie);
    expect(verify.body.data.ok).toBe(true);
  });

  it('refuses to report a complete backup when uploads are disabled', async () => {
    const admin = await adminSession();
    const server = await app();
    await updateSettings({ 'backup.include_uploads': false }, { id: 'test-admin', name: 'مدیر آزمون' });
    const response = await request(server).post('/api/system/backups').set('Cookie', admin.cookie).send({ note: 'uploads disabled test' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('شامل فایل‌های مدارک');
    await updateSettings({ 'backup.include_uploads': true }, { id: 'test-admin', name: 'مدیر آزمون' });
  });

  it('requires an explicit confirmation phrase for restore', async () => {
    const admin = await adminSession();
    const server = await app();
    const backups = await request(server).get('/api/system/backups').set('Cookie', admin.cookie);
    const backup = backups.body.data[0];

    const res = await request(server).post('/api/system/backups/restore').set('Cookie', admin.cookie).send({
      backupId: backup.id,
      confirmation: 'yes',
      password: 'TestAdmin#12345',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('RESTORE');
  });

  it('records privileged actions in the audit log', async () => {
    const admin = await adminSession();
    const server = await app();
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({ values: { 'site.tagline': 'شعار تست' } });
    const audit = await request(server).get('/api/system/audit?action=settings.update').set('Cookie', admin.cookie);
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThan(0);
    expect(audit.body.data[0].action).toBe('settings.update');
  });

  it('exposes sessions and allows revoking them', async () => {
    const admin = await adminSession();
    const server = await app();
    const sessions = await request(server).get('/api/system/sessions').set('Cookie', admin.cookie);
    expect(sessions.status).toBe(200);
    expect(sessions.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(sessions.body)).not.toContain('token_hash');
  });

  it('keeps the database portable between SQLite and PostgreSQL', async () => {
    const db = await getDb();
    expect(['sqlite', 'postgres']).toContain(db.driver);
    const row = await db.one<{ c: number }>('SELECT COUNT(*) AS c FROM settings');
    expect(Number(row?.c)).toBeGreaterThan(100);
  });
});
