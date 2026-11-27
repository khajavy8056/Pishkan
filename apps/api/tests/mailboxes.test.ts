import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff } from './helpers.js';
import { one } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { resetMailCli, setMailCli, type MailCliResult } from '../src/modules/mailboxes/service.js';

const actor = { id: 'system', name: 'mailbox-test' };
const calls: string[][] = [];

/** Fake CLI: records every call, answers status as a running server. */
const fakeCli = async (args: string[]): Promise<MailCliResult> => {
  calls.push(args);
  if (args[0] === 'status') {
    return { code: 0, stdout: JSON.stringify({ installed: true, running: true, domain: 'office.ir', hostname: 'mail' }), stderr: '' };
  }
  return { code: 0, stdout: 'ok', stderr: '' };
};

beforeAll(async () => {
  await app(); // initialise the DB + migrations before touching settings
  await updateSettings({ 'mail.domain': 'office.ir', 'mail.hostname': 'mail' } as any, actor, { confirmCritical: true });
  setMailCli(fakeCli);
});

afterAll(async () => {
  resetMailCli();
  await updateSettings({ 'mail.domain': '' } as any, actor, { confirmCritical: true });
});

describe('organizational mailboxes (admin)', () => {
  it('reports server status + Gmail IMAP/SMTP connection info', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).get('/api/mailboxes/status').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.status.running).toBe(true);
    expect(res.body.data.gmail.incoming).toMatchObject({ host: 'mail.office.ir', port: 993 });
    expect(res.body.data.gmail.outgoing).toMatchObject({ host: 'mail.office.ir', port: 465 });
  });

  it('creates a mailbox on the configured domain and calls the CLI', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'admin', password: 'StrongPass#123', displayName: 'مدیر سامانه' });
    expect(res.status).toBe(201);
    expect(res.body.data.address).toBe('admin@office.ir');
    const row = await one<{ address: string }>('SELECT address FROM mailboxes WHERE id = ?', [res.body.data.id]);
    expect(row!.address).toBe('admin@office.ir');
    expect(calls.some((c) => c[0] === 'add' && c[1] === 'admin@office.ir')).toBe(true);
  });

  it('rejects an invalid local part with a specific Persian error', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'bad name!', password: 'StrongPass#123' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('نام صندوق');
  });

  it('rejects a short password', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'shortpw', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('رمز');
    expect(res.body.error.message).toContain('حداقل');
  });

  it('rejects a duplicate mailbox with 409', async () => {
    const server = await app();
    const admin = await adminSession();
    await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'dup', password: 'StrongPass#123' });
    const res = await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'dup', password: 'StrongPass#123' });
    expect(res.status).toBe(409);
  });

  it('lists created mailboxes', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).get('/api/mailboxes').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.some((b: any) => b.address === 'admin@office.ir')).toBe(true);
  });

  it('changes a mailbox password through the CLI', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).put('/api/mailboxes/admin@office.ir/password').set('Cookie', admin.cookie)
      .send({ password: 'NewStrongPass#456' });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c[0] === 'passwd' && c[1] === 'admin@office.ir')).toBe(true);
  });

  it('suspends and restores a mailbox', async () => {
    const server = await app();
    const admin = await adminSession();
    const off = await request(server).put('/api/mailboxes/admin@office.ir/active').set('Cookie', admin.cookie).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.active).toBe(0);
    expect(calls.some((c) => c[0] === 'disable' && c[1] === 'admin@office.ir')).toBe(true);
    const on = await request(server).put('/api/mailboxes/admin@office.ir/active').set('Cookie', admin.cookie).send({ active: true });
    expect(on.body.data.active).toBe(1);
    expect(calls.some((c) => c[0] === 'enable' && c[1] === 'admin@office.ir')).toBe(true);
  });

  it('deletes a mailbox', async () => {
    const server = await app();
    const admin = await adminSession();
    await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'todelete', password: 'StrongPass#123' });
    const res = await request(server).delete('/api/mailboxes/todelete@office.ir').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    const row = await one('SELECT id FROM mailboxes WHERE address = ?', ['todelete@office.ir']);
    expect(row).toBeNull();
    expect(calls.some((c) => c[0] === 'del' && c[1] === 'todelete@office.ir')).toBe(true);
  });

  it('returns a clear 503 when the mail server is not installed', async () => {
    setMailCli(async (args) => {
      if (args[0] === 'status') return { code: 1, stdout: '', stderr: 'sudo: /usr/local/bin/pishkan-mail: command not found' };
      return { code: 1, stdout: '', stderr: 'sudo: /usr/local/bin/pishkan-mail: command not found' };
    });
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'noinstall', password: 'StrongPass#123' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain('نصب نشده');
    setMailCli(fakeCli);
  });

  it('refuses a staff member without settings.edit', async () => {
    const server = await app();
    const staff = await createStaff('service_expert', { username: `mbx_staff_${Date.now()}`, password: 'StaffPass#12345', fullName: 'کارمند بدون دسترسی' });
    const res = await request(server).post('/api/mailboxes').set('Cookie', staff.cookie)
      .send({ localPart: 'forbidden', password: 'StrongPass#123' });
    expect(res.status).toBe(403);
  });

  it('requires the organizational domain to be configured', async () => {
    await updateSettings({ 'mail.domain': '' } as any, actor, { confirmCritical: true });
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).post('/api/mailboxes').set('Cookie', admin.cookie)
      .send({ localPart: 'nodomain', password: 'StrongPass#123' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('دامنه');
    await updateSettings({ 'mail.domain': 'office.ir' } as any, actor, { confirmCritical: true });
  });
});
