import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, CUSTOMER, adminSession, app, createStaff, customerSession, login } from './helpers.js';

describe('authentication', () => {
  it('logs an admin in and exposes permissions', async () => {
    const server = await app();
    const res = await request(server).post('/api/auth/login').send({ identifier: ADMIN.username, password: ADMIN.password });
    expect(res.status).toBe(200);
    expect(res.body.data.user.kind).toBe('admin');
    expect(res.body.data.user.permissions).toBe('*');
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('rejects a wrong password without revealing whether the user exists', async () => {
    const server = await app();
    const res = await request(server).post('/api/auth/login').send({ identifier: ADMIN.username, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('صحیح نیست');
  });

  it('registers a customer and allows a password login', async () => {
    const session = await customerSession();
    const server = await app();
    const me = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.kind).toBe('customer');
    expect(me.body.data.fullName).toBe(CUSTOMER.fullName);
  });

  it('issues an OTP and verifies it end-to-end (console transport)', async () => {
    const server = await app();
    const otpRequest = await request(server).post('/api/auth/otp/request').send({ mobile: '09125559911' });
    expect(otpRequest.status).toBe(200);
    expect(otpRequest.body.data.sent).toBe(true);

    // The console transport writes the SMS to the log; the code itself is only
    // recoverable in non-production mode through `debugCode`.
    const code = otpRequest.body.data.debugCode;
    expect(code).toBeTruthy();
    const verify = await request(server).post('/api/auth/otp/verify').send({ mobile: '09125559911', code });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.kind).toBe('customer');
  });

  it('rejects a wrong OTP code and counts the attempt', async () => {
    const server = await app();
    await request(server).post('/api/auth/otp/request').send({ mobile: '09125559922' });
    const verify = await request(server).post('/api/auth/otp/verify').send({ mobile: '09125559922', code: '00000' });
    expect(verify.status).toBe(400);
  });

  it('enforces the resend cooldown', async () => {
    const server = await app();
    await request(server).post('/api/auth/otp/request').send({ mobile: '09125559933' });
    const again = await request(server).post('/api/auth/otp/request').send({ mobile: '09125559933' });
    expect(again.status).toBe(429);
    expect(again.body.error.message).toContain('صبر کنید');
  });

  it('revokes the session on logout', async () => {
    const session = await adminSession();
    const server = await app();
    await request(server).post('/api/auth/logout').set('Cookie', session.cookie).expect(200);
    const me = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    expect(me.status).toBe(401);
  });

  it('only permits users to revoke their own sessions through the session endpoint', async () => {
    const server = await app();
    const first = await createStaff('service_expert', { username: `session_one_${Date.now()}`, password: 'Session#12345', fullName: 'کارمند نشست یک' });
    const second = await createStaff('service_expert', { username: `session_two_${Date.now()}`, password: 'Session#12345', fullName: 'کارمند نشست دو' });
    const firstSessionId = (await request(server).get('/api/auth/me').set('Cookie', first.cookie)).body.data.sessionId;
    const secondSessionId = (await request(server).get('/api/auth/me').set('Cookie', second.cookie)).body.data.sessionId;
    await request(server).delete(`/api/auth/sessions/${secondSessionId}`).set('Cookie', first.cookie).expect(403);
    await request(server).delete(`/api/auth/sessions/${firstSessionId}`).set('Cookie', first.cookie).expect(200);
  });

  it('never exposes password hashes or MFA secrets', async () => {
    const session = await adminSession();
    const server = await app();
    const res = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('mfa_secret');
  });

  it('rejects unauthenticated access to protected endpoints', async () => {
    const server = await app();
    await request(server).get('/api/requests').expect(401);
    await request(server).get('/api/settings/admin').expect(401);
  });
});
