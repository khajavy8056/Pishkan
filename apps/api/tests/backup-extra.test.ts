import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, customerSession } from './helpers.js';
import { cronMatches, nextCronRun, parseCron, runBackupSchedulerTick } from '../src/modules/system/scheduler.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { run } from '../src/db/index.js';

let server: Awaited<ReturnType<typeof app>>;
let admin: any;

describe('backup scheduler & downloads', () => {
  beforeAll(async () => {
    server = await app();
    admin = await adminSession();
  });

  afterAll(async () => {
    await updateSettings({
      'backup.enabled': true,
      'backup.schedule_cron': '0 2 * * *',
      'backup.retention_days': 30,
      'backup.retention_min_count': 3,
    }, { id: 'system', name: 'test-backup' }, { confirmCritical: true }).catch(() => undefined);
  });

  it('parses and matches 5-field cron expressions', () => {
    const every = parseCron('* * * * *');
    expect(every).not.toBeNull();
    expect(cronMatches(every!, new Date())).toBe(true);

    const atThree = parseCron('0 3 * * *');
    expect(atThree).not.toBeNull();
    const next = nextCronRun('0 3 * * *', new Date());
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(Date.now() - 1000);

    expect(parseCron('not a cron')).toBeNull();
    expect(parseCron('61 * * * *')).toBeNull();
    expect(parseCron('*/5 * * * *')).not.toBeNull();
  });

  it('scheduler tick creates a backup when the schedule matches', async () => {
    const before = await request(server).get('/api/system/backups').set('Cookie', admin.cookie);
    const beforeCount = before.body.data.length;

    await updateSettings({
      'backup.enabled': true,
      'backup.schedule_cron': '* * * * *',
    }, { id: 'system', name: 'test-backup' }, { confirmCritical: true });
    await runBackupSchedulerTick();

    const after = await request(server).get('/api/system/backups').set('Cookie', admin.cookie);
    expect(after.body.data.length).toBe(beforeCount + 1);
    expect(after.body.data[0].status).toBe('ok');
    expect(after.body.data[0].note).toContain('خودکار');
  }, 60000);

  it('never prunes below the retention floor', async () => {
    await updateSettings({
      'backup.retention_days': 1,
      'backup.retention_min_count': 3,
    }, { id: 'system', name: 'test-backup' }, { confirmCritical: true });

    for (let i = 0; i < 3; i += 1) {
      const res = await request(server).post('/api/system/backups').set('Cookie', admin.cookie).send({ note: `floor ${i}` });
      expect(res.body.ok).toBe(true);
    }
    // Pretend every backup is 40 days old, then take one more: the age-based
    // prune must still keep at least the newest 3 healthy copies.
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    await run('UPDATE backups SET created_at = ?', [old]);
    const final = await request(server).post('/api/system/backups').set('Cookie', admin.cookie).send({ note: 'floor trigger' });
    expect(final.body.ok).toBe(true);

    const list = await request(server).get('/api/system/backups').set('Cookie', admin.cookie);
    const okCount = list.body.data.filter((b: any) => b.status === 'ok').length;
    expect(okCount).toBeGreaterThanOrEqual(3);
    expect(list.body.data.some((b: any) => b.id === final.body.data.id)).toBe(true);
  }, 120000);

  it('downloads backup parts with permission checks', async () => {
    const list = await request(server).get('/api/system/backups').set('Cookie', admin.cookie);
    const backup = list.body.data.find((b: any) => b.status === 'ok');
    expect(backup).toBeTruthy();

    const db = await request(server).get(`/api/system/backups/${backup.id}/download?part=db`).set('Cookie', admin.cookie);
    expect(db.status).toBe(200);
    expect(db.headers['content-disposition']).toContain('attachment');

    const uploads = await request(server).get(`/api/system/backups/${backup.id}/download?part=uploads`).set('Cookie', admin.cookie);
    expect(uploads.status).toBe(200);

    const badPart = await request(server).get(`/api/system/backups/${backup.id}/download?part=everything`).set('Cookie', admin.cookie);
    expect(badPart.status).toBe(400);

    const customer = await customerSession();
    const forbidden = await request(server).get(`/api/system/backups/${backup.id}/download?part=db`).set('Cookie', customer.cookie);
    expect([401, 403]).toContain(forbidden.status);
  }, 60000);
});
