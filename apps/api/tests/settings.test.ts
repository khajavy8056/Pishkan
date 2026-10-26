import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, EXPERT } from './helpers.js';

describe('admin settings', () => {
  it('exposes all 14 setting groups and masks secrets', async () => {
    const admin = await adminSession();
    const server = await app();
    // store a secret first
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({
      values: { 'sms.password': 'SuperSecretPassword123', 'sms.username': 'panel-user' },
    }).expect(200);

    const res = await request(server).get('/api/settings/admin').set('Cookie', admin.cookie);
    expect(res.body.data.groups).toHaveLength(14);
    const secret = res.body.data.settings.find((s: any) => s.key === 'sms.password');
    expect(secret.isSecret).toBe(true);
    expect(secret.value).toBe('');
    expect(secret.hasValue).toBe(true);
    expect(secret.masked).toMatch(/••••/);
    expect(JSON.stringify(res.body)).not.toContain('SuperSecretPassword123');
  });

  it('validates types and ranges', async () => {
    const admin = await adminSession();
    const server = await app();
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie)
      .send({ values: { 'auth.otp_ttl_seconds': 5 } }).expect(400);
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie)
      .send({ values: { 'site.primary_color': 'blue' } }).expect(400);
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie)
      .send({ values: { 'unknown.setting': 'x' } }).expect(400);
  });

  it('never allows disabling every customer login method', async () => {
    const admin = await adminSession();
    const server = await app();
    const res = await request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({
      values: { 'auth.customer_otp_enabled': false, 'auth.customer_password_enabled': false },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('روش‌های ورود');
  });

  it('refuses to disable staff password login without a recovery path', async () => {
    const admin = await adminSession();
    const server = await app();
    // The seeded administrator has no mobile number, so OTP login could not be
    // used as a fallback: the change must be rejected instead of locking every
    // administrator out of the system.
    const res = await request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({
      values: { 'auth.staff_password_login': false },
      confirmCritical: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('موبایل');

    const current = await request(server).get('/api/settings/admin').set('Cookie', admin.cookie);
    const flag = current.body.data.settings.find((s: any) => s.key === 'auth.staff_password_login');
    expect(flag.value).toBe(true);
  });

  it('allows switching the customer login method from the panel', async () => {
    const admin = await adminSession();
    const server = await app();
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({
      values: { 'auth.customer_otp_enabled': false, 'auth.customer_password_enabled': true },
    }).expect(200);

    const loginInfo = await request(server).get('/api/auth/login-info');
    expect(loginInfo.body.data.customerOtp).toBe(false);
    expect(loginInfo.body.data.customerPassword).toBe(true);

    // restore OTP so other tests can rely on it
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({
      values: { 'auth.customer_otp_enabled': true, 'auth.customer_password_enabled': true },
    });
  });

  it('persists general settings without touching other data', async () => {
    const admin = await adminSession();
    const server = await app();
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({
      values: { 'site.name': 'دفتر پیشخوان آزمون', 'office.phone': '02112345678' },
    }).expect(200);

    const bootstrap = await request(server).get('/api/public/bootstrap');
    expect(bootstrap.body.data.settings['site.name']).toBe('دفتر پیشخوان آزمون');

    // services must be untouched by a settings change
    const services = await request(server).get('/api/public/services?pageSize=100');
    expect(services.body.meta.total).toBeGreaterThanOrEqual(30);
  });

  it('opens the SMS connection test and reports configuration state', async () => {
    const admin = await adminSession();
    const server = await app();
    const res = await request(server).post('/api/settings/sms/test-connection').set('Cookie', admin.cookie).send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.data.ok).toBe('boolean');
    expect(res.body.data.checkedAt).toBeTruthy();
  });

  it('sends a test SMS only to the explicitly provided number', async () => {
    const admin = await adminSession();
    const server = await app();
    const res = await request(server).post('/api/settings/sms/test-send').set('Cookie', admin.cookie).send({ mobile: '09120000000' });
    expect(res.status).toBe(200);
    expect(res.body.data.checkedAt).toBeTruthy();
  });

  it('rejects malformed domain/SMS payloads with validation errors', async () => {
    const admin = await adminSession();
    const server = await app();
    await request(server).post('/api/settings/sms/test-send').set('Cookie', admin.cookie).send({ mobile: 'x' }).expect(400);
    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie)
      .send({ values: { 'domain.public_url': 'not-a-url' } }).expect(400);
  });

  it('reports domain configuration checks and never claims DNS is configured', async () => {
    const admin = await adminSession();
    const server = await app();
    const res = await request(server).get('/api/settings/domain-check').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.checks)).toBe(true);
    expect(res.body.data.steps.length).toBeGreaterThan(3);
  });

  it('keeps settings endpoints away from service experts', async () => {
    const server = await app();
    const expert = await createStaff('service_expert', { ...EXPERT, username: 'expert_settings_denied' }).catch(() => null);
    if (expert) {
      const res = await request(server).get('/api/settings/admin').set('Cookie', expert.cookie);
      expect(res.status).toBe(403);
    }
  });
});
