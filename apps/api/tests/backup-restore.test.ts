import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';
import { closeDb, one, run } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { runSeed } from '../src/modules/catalog/seed.js';
import { createBackup, restoreBackup } from '../src/modules/system/backup.js';
import { invalidateSettingsCache, updateSettings } from '../src/modules/settings/service.js';

const original = { sqliteFile: env.sqliteFile, uploadDir: env.uploadDir, backupDir: env.backupDir };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-restore-test-'));
Object.assign(env, {
  sqliteFile: path.join(root, 'isolated.sqlite'),
  uploadDir: path.join(root, 'uploads'),
  backupDir: path.join(root, 'backups'),
});

afterAll(async () => {
  await closeDb();
  Object.assign(env, original);
  invalidateSettingsCache();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('isolated SQLite backup restore', () => {
  it('restores both the database snapshot and its paired upload archive', async () => {
    await migrate();
    await runSeed({ admin: { username: 'restore-admin', password: 'RestoreTest#12345', fullName: 'نام پیش از پشتیبان' }, log: () => undefined });
    await updateSettings({ 'backup.include_uploads': true }, { id: 'restore-test', name: 'آزمون' });
    const admin = await one<{ id: string }>("SELECT id FROM users WHERE username = 'restore-admin'");
    expect(admin).toBeTruthy();

    fs.mkdirSync(env.uploadDir, { recursive: true });
    const marker = path.join(env.uploadDir, 'restore-marker.txt');
    fs.writeFileSync(marker, 'state-at-backup');
    const backup = await createBackup({ id: admin!.id, name: 'آزمون بازیابی' }, 'isolated restore test');

    await run("UPDATE users SET full_name = 'نام پس از پشتیبان' WHERE id = ?", [admin!.id]);
    fs.writeFileSync(marker, 'modified-after-backup');
    fs.writeFileSync(path.join(env.uploadDir, 'should-be-removed.txt'), 'not-in-snapshot');

    Object.assign(env, { dbDriver: 'postgres' });
    await expect(restoreBackup(backup.id, 'RESTORE', { id: admin!.id, name: 'آزمون بازیابی' })).rejects.toThrow('از API پشتیبانی نمی‌شود');
    Object.assign(env, { dbDriver: 'sqlite' });
    const restored = await restoreBackup(backup.id, 'RESTORE', { id: admin!.id, name: 'آزمون بازیابی' });
    expect(restored.ok).toBe(true);
    expect((await one<{ full_name: string }>('SELECT full_name FROM users WHERE id = ?', [admin!.id]))?.full_name).toBe('نام پیش از پشتیبان');
    expect(fs.readFileSync(marker, 'utf8')).toBe('state-at-backup');
    expect(fs.existsSync(path.join(env.uploadDir, 'should-be-removed.txt'))).toBe(false);
    expect(fs.existsSync(path.join(env.backupDir, restored.safetyBackup!))).toBe(true);
  });
});
