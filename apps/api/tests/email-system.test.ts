import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, login } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { notifyUser } from '../src/modules/notifications/service.js';
import { sendTemplateEmail } from '../src/modules/email/provider.js';
import { setEmailPrefs } from '../src/modules/email/service.js';

/**
 * The email channel, proven against a REAL SMTP server (aiosmtpd fixture):
 * nodemailer does a genuine EHLO/MAIL/RCPT/DATA exchange and the fixture
 * writes exactly what a mailbox would receive. These tests drive the whole
 * chain — settings → provider → ledger → templates → token flows — not mocks.
 *
 * Skipped automatically when the Python fixture runtime is unavailable.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const python = path.join(repoRoot, '.venv/bin/python');
const fixtures = path.join(__dirname, 'fixtures');
const hasPython = fs.existsSync(python);

let server: Awaited<ReturnType<typeof app>>;
let admin: Awaited<ReturnType<typeof adminSession>>;
const children: ChildProcess[] = [];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-email-test-'));
const maildir = path.join(root, 'mail');
let port = 0;
const actor = { id: 'system', name: 'email-test' };

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

function captured(): any[] {
  if (!fs.existsSync(maildir)) return [];
  return fs.readdirSync(maildir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(maildir, f), 'utf8')));
}

function clearCaptured(): void {
  if (fs.existsSync(maildir)) for (const f of fs.readdirSync(maildir)) fs.unlinkSync(path.join(maildir, f));
}

async function waitForMail(count: number, timeoutMs = 8000): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mails = captured();
    if (mails.length >= count) return mails;
    await new Promise((r) => setTimeout(r, 150));
  }
  return captured();
}

async function staffIdOf(username: string): Promise<string> {
  return (await one<{ id: string }>('SELECT id FROM users WHERE username = ?', [username]))!.id;
}

beforeAll(async () => {
  if (!hasPython) return;
  fs.mkdirSync(maildir, { recursive: true });
  server = await app();
  admin = await adminSession();
  port = await freePort();
  const child = spawn(python, [path.join(fixtures, 'smtp_server.py'), String(port), maildir], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('smtp fixture not ready in 20s')), 20_000);
    child.stdout!.on('data', (chunk) => { if (String(chunk).includes('READY')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`smtp fixture exited early (${code})`)); });
  });
  await updateSettings({
    'email.enabled': true, 'email.host': '127.0.0.1', 'email.port': port, 'email.secure': false,
    'email.user': '', 'email.password': '', 'email.from_address': 'no-reply@test.local', 'email.from_name': 'تک پیشخوان آزمایشی',
    'domain.public_url': 'https://office.example.ir',
  } as any, actor, { confirmCritical: true });
}, 40_000);

afterAll(async () => {
  for (const child of children) child.kill('SIGTERM');
  if (hasPython) {
    await updateSettings({ 'email.enabled': false, 'email.host': '' } as any, actor, { confirmCritical: true });
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasPython)('email transport (real SMTP)', () => {
  it('verifies the SMTP connection through the admin endpoint', async () => {
    const res = await request(server).post('/api/settings/email/test-connection').set('Cookie', (await adminSession()).cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });

  it('sends a test email that the server actually receives, RTL and Persian', async () => {
    clearCaptured();
    const res = await request(server).post('/api/settings/email/test-send').set('Cookie', (await adminSession()).cookie).send({ to: 'inbox@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    const mails = await waitForMail(1);
    expect(mails.length).toBe(1);
    expect(mails[0].rcpt_tos).toContain('inbox@test.local');
    expect(mails[0].subject).toContain('آزمایش');
    expect(mails[0].html).toContain('dir="rtl"');
    expect(mails[0].text).toContain('SMTP');
  });

  it('records every send in the ledger and never stores the body by default', async () => {
    const row = await one<any>("SELECT * FROM email_logs WHERE purpose = 'test' ORDER BY created_at DESC LIMIT 1");
    expect(row.status).toBe('sent');
    expect(row.provider).toBe('smtp');
    expect(row.body).toBeNull();
  });

  it('sends one email per idempotency key', async () => {
    clearCaptured();
    const key = `idem-test-${Date.now()}`;
    const first = await sendTemplateEmail({ to: 'idem@test.local', template: 'test', idempotencyKey: key });
    const second = await sendTemplateEmail({ to: 'idem@test.local', template: 'test', idempotencyKey: key });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe('duplicate');
    expect((await waitForMail(1)).length).toBe(1);
  });

  it('honours the daily ceiling', async () => {
    await updateSettings({ 'email.daily_limit': 1 } as any, actor, { confirmCritical: true });
    clearCaptured();
    // The ledger already has sent rows from earlier tests today, so the very
    // next send must be skipped with the honest reason.
    const result = await sendTemplateEmail({ to: 'limit@test.local', template: 'test', idempotencyKey: `limit-${Date.now()}` });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('daily_limit');
    await updateSettings({ 'email.daily_limit': 500 } as any, actor, { confirmCritical: true });
  });
});

describe.skipIf(!hasPython)('password reset by email (staff and customer)', () => {
  it('runs the full flow: request → emailed link → confirm → login, old sessions revoked', async () => {
    clearCaptured();
    const username = `reset_flow_${Date.now()}`;
    await createStaff('service_expert', { username, password: 'Before#12345', fullName: 'کارمند بازیابی' });
    const id = await staffIdOf(username);
    await run('UPDATE users SET email = ? WHERE id = ?', ['staff-reset@test.local', id]);
    const oldSession = await login(username, 'Before#12345');

    const req1 = await request(server).post('/api/auth/password/reset-email/request').send({ identifier: username });
    expect(req1.status).toBe(200);
    expect(req1.body.data.sent).toBe(true);

    const mails = await waitForMail(1);
    expect(mails.length).toBe(1);
    expect(mails[0].subject).toContain('بازیابی');
    const match = mails[0].text.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
    expect(match).toBeTruthy();
    const token = match![1];

    const confirm = await request(server).post('/api/auth/password/reset-email/confirm').send({ token, newPassword: 'After#67890' });
    expect(confirm.status).toBe(200);

    // New password works, old one does not, old session is dead.
    await login(username, 'After#67890');
    const bad = await request(server).post('/api/auth/staff/login').send({ identifier: username, password: 'Before#12345' });
    expect(bad.status).toBe(401);
    const me = await request(server).get('/api/auth/me').set('Cookie', oldSession.cookie);
    expect(me.status).toBe(401);

    // The token is single-use.
    const reuse = await request(server).post('/api/auth/password/reset-email/confirm').send({ token, newPassword: 'Again#67890' });
    expect(reuse.status).toBe(400);

    // A confirmation email arrived too.
    const all = await waitForMail(2);
    expect(all.some((m) => m.subject.includes('تغییر رمز'))).toBe(true);
  });

  it('answers identically for a non-existent account and sends nothing', async () => {
    clearCaptured();
    const res = await request(server).post('/api/auth/password/reset-email/request').send({ identifier: 'no-such-user-xyz' });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(captured().length).toBe(0);
  });

  it('rejects an expired token with a meaningful message', async () => {
    clearCaptured();
    const username = `reset_exp_${Date.now()}`;
    await createStaff('service_expert', { username, password: 'Expire#12345', fullName: 'کارمند انقضا' });
    const id = await staffIdOf(username);
    await run('UPDATE users SET email = ? WHERE id = ?', ['staff-exp@test.local', id]);
    await request(server).post('/api/auth/password/reset-email/request').send({ identifier: username }).expect(200);
    const mails = await waitForMail(1);
    const token = mails[0].text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)![1];
    await run("UPDATE email_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE purpose = 'reset_password' AND user_id = ?", [id]);
    const res = await request(server).post('/api/auth/password/reset-email/confirm').send({ token, newPassword: 'Late#678901' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('مهلت');
  });

  it('works for customers too, found by email', async () => {
    clearCaptured();
    const mobile = `0912${Math.floor(1000000 + Math.random() * 8999999)}`;
    await request(server).post('/api/auth/register').send({ mobile, password: 'CustBefore#123', fullName: 'مشتری بازیابی ایمیلی' }).expect(201);
    const id = (await one<{ id: string }>('SELECT id FROM users WHERE mobile = ?', [mobile]))!.id;
    await run('UPDATE users SET email = ? WHERE id = ?', ['customer-reset@test.local', id]);
    await request(server).post('/api/auth/password/reset-email/request').send({ identifier: 'customer-reset@test.local' }).expect(200);
    const mails = await waitForMail(1);
    const token = mails[0].text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)![1];
    await request(server).post('/api/auth/password/reset-email/confirm').send({ token, newPassword: 'CustAfter#456' }).expect(200);
    await login(mobile, 'CustAfter#456', 'customer');
  });
});

describe.skipIf(!hasPython)('email verification', () => {
  it('verifies by the emailed 6-digit code and marks the account', async () => {
    clearCaptured();
    const username = `verify_flow_${Date.now()}`;
    const session = await createStaff('service_expert', { username, password: 'Verify#12345', fullName: 'کارمند تأیید' });
    const id = await staffIdOf(username);
    await request(server).patch('/api/auth/profile').set('Cookie', session.cookie).send({ email: 'verify-me@test.local' }).expect(200);

    const req1 = await request(server).post('/api/auth/email/verify/request').set('Cookie', session.cookie).send({});
    expect(req1.status).toBe(200);
    const mails = await waitForMail(1);
    expect(mails[0].subject).toContain('تأیید');
    const code = mails[0].text.match(/کد: (\d{6})/)![1];

    const confirm = await request(server).post('/api/auth/email/verify/confirm').set('Cookie', session.cookie).send({ proof: code });
    expect(confirm.status).toBe(200);
    const me = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    expect(me.body.data.emailVerified).toBe(true);

    // Changing the address afterwards un-verifies it again.
    await request(server).patch('/api/auth/profile').set('Cookie', session.cookie).send({ email: 'verify-other@test.local' }).expect(200);
    const me2 = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    expect(me2.body.data.emailVerified).toBe(false);
    expect(id).toBeTruthy();
  });
});

describe.skipIf(!hasPython)('notification emails and per-user alarm prefs', () => {
  it('delivers an event email through notifyUser when every gate is open', async () => {
    clearCaptured();
    const username = `notify_email_${Date.now()}`;
    await createStaff('service_expert', { username, password: 'Notify#12345', fullName: 'کارمند اعلان' });
    const id = await staffIdOf(username);
    await run('UPDATE users SET email = ? WHERE id = ?', ['notify@test.local', id]);
    await notifyUser(id, {
      title: 'رویداد آزمایشی', body: 'متن رویداد', kind: 'info', link: '/app/support',
      idempotencyKey: `notify-email-${Date.now()}`,
      email: { template: 'ticket_reply', variables: { ticket_number: 'T-1', ticket_title: 'تیکت آزمایشی', link: '/staff/support' } },
    });
    const mails = await waitForMail(1);
    expect(mails.length).toBe(1);
    expect(mails[0].subject).toContain('تیکت');
    expect(mails[0].html).toContain('office.example.ir/staff/support');
  });

  it('respects the user switching the category off', async () => {
    clearCaptured();
    const username = `notify_off_${Date.now()}`;
    await createStaff('service_expert', { username, password: 'NotifyOff#123', fullName: 'کارمند خاموش' });
    const id = await staffIdOf(username);
    await run('UPDATE users SET email = ? WHERE id = ?', ['notify-off@test.local', id]);
    await setEmailPrefs(id, { tickets: false });
    await notifyUser(id, {
      title: 'رویداد خاموش', body: 'نباید ایمیل شود', kind: 'info',
      idempotencyKey: `notify-off-${Date.now()}`,
      email: { template: 'ticket_reply', variables: { ticket_number: 'T-2', ticket_title: 'خاموش' } },
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(captured().length).toBe(0);
    const ledger = await one<any>("SELECT * FROM email_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", [id]);
    // The gate refused before any send attempt — no pending/sent row for it.
    expect(ledger?.status ?? 'none').not.toBe('sent');
  });

  it('exposes and updates the prefs through the account-scoped endpoint', async () => {
    admin = await adminSession();
    const get1 = await request(server).get('/api/notifications/email-prefs').set('Cookie', admin.cookie);
    expect(get1.status).toBe(200);
    expect(get1.body.data.emailEnabled).toBe(true);
    const put = await request(server).put('/api/notifications/email-prefs').set('Cookie', admin.cookie).send({ payments: false });
    expect(put.status).toBe(200);
    expect(put.body.data.payments).toBe(false);
    const get2 = await request(server).get('/api/notifications/email-prefs').set('Cookie', admin.cookie);
    expect(get2.body.data.payments).toBe(false);
    await request(server).put('/api/notifications/email-prefs').set('Cookie', admin.cookie).send({ payments: true }).expect(200);
  });

  it('reports emailEnabled in the channel status', async () => {
    const res = await request(server).get('/api/notifications/status').set('Cookie', (await adminSession()).cookie);
    expect(res.status).toBe(200);
    const policy = res.body.data.policy ?? res.body.data;
    expect(policy.emailEnabled).toBe(true);
  });
});

describe.skipIf(!hasPython)('staff welcome email', () => {
  it('sends a set-your-own-password link when a staff account is created with an email', async () => {
    clearCaptured();
    const username = `welcome_${Date.now()}`;
    const res = await request(server).post('/api/staff').set('Cookie', (await adminSession()).cookie).send({
      fullName: 'کارمند خوش‌آمد', mobile: `0912${Math.floor(1000000 + Math.random() * 8999999)}`,
      username, password: 'Welcome#12345', roleCode: 'service_expert', email: 'welcome@test.local',
    });
    expect(res.status).toBe(201);
    const mails = await waitForMail(1);
    expect(mails.length).toBe(1);
    expect(mails[0].subject).toContain('خوش آمدید');
    const token = mails[0].text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)![1];
    // The welcome link really sets the password.
    await request(server).post('/api/auth/password/reset-email/confirm').send({ token, newPassword: 'MyOwn#67890' }).expect(200);
    await login(username, 'MyOwn#67890');
  });
});
