import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, login } from './helpers.js';
import { one } from '../src/db/index.js';

async function staffIdOf(username: string): Promise<string> {
  const row = await one<{ id: string }>('SELECT id FROM users WHERE username = ?', [username]);
  return row!.id;
}

/**
 * Regression: «ویرایش کارمند ذخیره نمی‌شود — داده‌های ارسالی معتبر نیست».
 *
 * The edit dialog round-trips the record it loaded. A staff member created
 * without an email/position has those fields as JSON null, and the PATCH
 * schema used `.optional()` — which rejects null — so EVERY save on such a
 * record failed, including a plain password reset. These tests drive the exact
 * payload the dialog sends, and they also pin the second half of the fix:
 * a validation failure must name the field and the rule in Persian, never the
 * old generic sentence.
 */
describe('staff edit (admin)', () => {
  it('saves an edit on a staff record whose email/position are null', async () => {
    const server = await app();
    const admin = await adminSession();
    const username = `edit_null_${Date.now()}`;
    await createStaff('service_expert', { username, password: 'EditNull#12345', fullName: 'کارمند بدون ایمیل' });
    const id = await staffIdOf(username);

    // What the dialog actually sends when the office only changed the name:
    // untouched null fields come back as null.
    const res = await request(server).patch(`/api/staff/${id}`).set('Cookie', admin.cookie).send({
      fullName: 'نام ویرایش‌شده کارمند', email: null, position: null,
      roleCode: 'service_expert', maxActiveCases: 20, acceptsNewCases: true, status: 'active',
      specialties: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('نام ویرایش‌شده کارمند');
  });

  it('resets the password of a staff record with null fields (the reported broken flow)', async () => {
    const server = await app();
    const admin = await adminSession();
    const username = `edit_pw_${Date.now()}`;
    await createStaff('service_expert', { username, password: 'OldPass#12345', fullName: 'کارمند تغییر رمز' });
    const created = { id: await staffIdOf(username) };

    const res = await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({
      fullName: 'کارمند تغییر رمز', email: null, position: null,
      roleCode: 'service_expert', maxActiveCases: 20, acceptsNewCases: true, status: 'active',
      specialties: [], newPassword: 'NewPass#67890',
    });
    expect(res.status).toBe(200);

    // The new password works; the old one no longer does.
    const okLogin = await login(username, 'NewPass#67890');
    expect(okLogin.cookie).toBeTruthy();
    const badLogin = await request(server).post('/api/auth/staff/login').send({ identifier: username, password: 'OldPass#12345' });
    expect(badLogin.status).toBe(401);
  });

  it('treats an empty password box as «no change», not as a short password', async () => {
    const server = await app();
    const admin = await adminSession();
    const username = `edit_empty_pw_${Date.now()}`;
    await createStaff('service_expert', { username, password: 'KeepPass#12345', fullName: 'کارمند رمز خالی' });
    const created = { id: await staffIdOf(username) };
    const res = await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({
      fullName: 'کارمند رمز خالی', email: null, newPassword: '', maxActiveCases: '15',
    });
    expect(res.status).toBe(200);
    // Numeric strings from form inputs are coerced, not rejected.
    expect(res.body.data.maxActiveCases).toBe(15);
    const stillWorks = await login(username, 'KeepPass#12345');
    expect(stillWorks.cookie).toBeTruthy();
  });

  it('names the field and the rule when the email is invalid', async () => {
    const server = await app();
    const admin = await adminSession();
    const u1 = `edit_bademail_${Date.now()}`;
    await createStaff('service_expert', { username: u1, password: 'BadEmail#12345', fullName: 'کارمند ایمیل بد' });
    const created = { id: await staffIdOf(u1) };
    const res = await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('ایمیل');
    expect(res.body.error.message).not.toBe('داده‌های ارسالی معتبر نیست.');
    expect(res.body.error.details[0].path).toBe('email');
  });

  it('names the field when the new password is too short', async () => {
    const server = await app();
    const admin = await adminSession();
    const u2 = `edit_shortpw_${Date.now()}`;
    await createStaff('service_expert', { username: u2, password: 'ShortPw#12345', fullName: 'کارمند رمز کوتاه' });
    const created = { id: await staffIdOf(u2) };
    const res = await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({ newPassword: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('رمز عبور جدید');
    expect(res.body.error.message).toContain('8');
  });

  it('names the field when maxActiveCases is zero or not a number', async () => {
    const server = await app();
    const admin = await adminSession();
    const u3 = `edit_cases_${Date.now()}`;
    await createStaff('service_expert', { username: u3, password: 'Cases#1234567', fullName: 'کارمند سقف پرونده' });
    const created = { id: await staffIdOf(u3) };
    const zero = await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({ maxActiveCases: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error.message).toContain('سقف پرونده‌های هم‌زمان');
    const nan = await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({ maxActiveCases: 'abc' });
    expect(nan.status).toBe(400);
    expect(nan.body.error.message).toContain('عدد');
  });

  it('rejects a duplicate email with a sentence, not a database 500', async () => {
    const server = await app();
    const admin = await adminSession();
    const ua = `edit_dup_a_${Date.now()}`; const ub = `edit_dup_b_${Date.now()}`;
    await createStaff('service_expert', { username: ua, password: 'DupA#1234567', fullName: 'کارمند الف' });
    await createStaff('service_expert', { username: ub, password: 'DupB#1234567', fullName: 'کارمند ب' });
    const a = { id: await staffIdOf(ua) }; const b = { id: await staffIdOf(ub) };
    const first = await request(server).patch(`/api/staff/${a.id}`).set('Cookie', admin.cookie).send({ email: 'duplicate-check@example.com' });
    expect(first.status).toBe(200);
    const second = await request(server).patch(`/api/staff/${b.id}`).set('Cookie', admin.cookie).send({ email: 'duplicate-check@example.com' });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain('ایمیل');
  });

  it('clears the email when the box is emptied', async () => {
    const server = await app();
    const admin = await adminSession();
    const u4 = `edit_clear_${Date.now()}`;
    await createStaff('service_expert', { username: u4, password: 'Clear#1234567', fullName: 'کارمند پاک‌سازی ایمیل' });
    const created = { id: await staffIdOf(u4) };
    await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({ email: 'clear-me@example.com' }).expect(200);
    const res = await request(server).patch(`/api/staff/${created.id}`).set('Cookie', admin.cookie).send({ email: '' }).expect(200);
    expect(res.body.data.email).toBeNull();
  });
});

describe('customer edit (admin) — same null round-trip', () => {
  it('saves a customer edit when email/nationalId/address are null', async () => {
    const server = await app();
    const admin = await adminSession();
    // Register a customer with no email/nationalId, then edit the name the way
    // the dialog does: untouched fields arrive as null.
    const mobile = `0912${Math.floor(1000000 + Math.random() * 8999999)}`;
    const reg = await request(server).post('/api/auth/register').send({ mobile, password: 'Customer#12345', fullName: 'مشتری ویرایشی' });
    expect(reg.status).toBe(201);
    const customerId = (await one<{ id: string }>('SELECT id FROM users WHERE mobile = ?', [mobile]))!.id;
    const res = await request(server).patch(`/api/customers/${customerId}`).set('Cookie', admin.cookie).send({
      fullName: 'مشتری ویرایش‌شده', email: null, nationalId: null, status: 'active', address: null, city: null,
    });
    expect(res.status).toBe(200);
  });
});
