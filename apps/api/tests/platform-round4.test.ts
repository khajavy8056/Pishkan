import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, CUSTOMER, adminSession, app, customerSession, login } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { ensureSettingDefaults } from '../src/modules/settings/service.js';

/**
 * Round 4 — entry separation + editable landing.
 *
 * The customer entrance and the staff entrance are different doors in the
 * API itself: valid credentials at the wrong door fail like unknown ones,
 * OTP/password-reset can never cross account families, and the landing page
 * is driven by admin-editable settings exposed through public bootstrap.
 */

async function createStaffWithMobile(username: string, mobile: string, password = 'Expert#12345') {
  const server = await app();
  const admin = await adminSession();
  const res = await request(server)
    .post('/api/staff')
    .set('Cookie', admin.cookie)
    .send({
      fullName: 'کارشناس آزمون درها',
      mobile,
      username,
      password,
      roleCode: 'service_expert',
      employeeCode: `R4-${Math.floor(Math.random() * 9000 + 1000)}`,
    });
  if (!res.body.ok) throw new Error(`createStaffWithMobile failed: ${JSON.stringify(res.body)}`);
  await run('UPDATE users SET mobile_verified=1 WHERE id=?', [res.body.data.id]);
  return { id: res.body.data.id as string, username, password, mobile };
}

describe('separated login doors', () => {
  it('customer door refuses the super-admin credentials; staff door accepts them', async () => {
    const server = await app();
    const wrongDoor = await request(server).post('/api/auth/customer/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password });
    expect(wrongDoor.status).toBe(401);
    expect(wrongDoor.body.error.message).toContain('صحیح نیست');
    expect(wrongDoor.headers['set-cookie']).toBeUndefined();

    const rightDoor = await request(server).post('/api/auth/staff/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password });
    expect(rightDoor.status).toBe(200);
    expect(rightDoor.body.data.user.kind).toBe('admin');
  });

  it('staff door refuses customer credentials; customer door accepts them', async () => {
    await customerSession(); // ensures the fixture customer exists
    const server = await app();

    const wrongDoor = await request(server).post('/api/auth/staff/login')
      .send({ identifier: CUSTOMER.mobile, password: CUSTOMER.password });
    expect(wrongDoor.status).toBe(401);

    const rightDoor = await request(server).post('/api/auth/customer/login')
      .send({ identifier: CUSTOMER.mobile, password: CUSTOMER.password });
    expect(rightDoor.status).toBe(200);
    expect(rightDoor.body.data.user.kind).toBe('customer');
  });

  it('knocking on the wrong door does not count as a failed attempt on the real account', async () => {
    const server = await app();
    const staff = await createStaffWithMobile('r4_door_expert', '09129990001');
    for (let i = 0; i < 3; i += 1) {
      const res = await request(server).post('/api/auth/customer/login')
        .send({ identifier: staff.username, password: staff.password });
      expect(res.status).toBe(401);
    }
    // The account is untouched: the correct door still opens immediately.
    const session = await login(staff.username, staff.password, 'staff');
    const me = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.kind).toBe('staff');
  });

  it('the legacy /login shim requires an explicit audience', async () => {
    const server = await app();
    const missing = await request(server).post('/api/auth/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password });
    expect(missing.status).toBe(400);

    const explicit = await request(server).post('/api/auth/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password, audience: 'staff' });
    expect(explicit.status).toBe(200);

    const wrongAudience = await request(server).post('/api/auth/login')
      .send({ identifier: ADMIN.username, password: ADMIN.password, audience: 'customer' });
    expect(wrongAudience.status).toBe(401);
  });

  it('OTP at the customer door never signs into a staff account that shares the mobile', async () => {
    const server = await app();
    const staff = await createStaffWithMobile('r4_shared_mobile', '09129998877');

    const otpRequest = await request(server).post('/api/auth/otp/request')
      .send({ mobile: staff.mobile, kind: 'customer' });
    expect(otpRequest.status).toBe(200);
    const code = otpRequest.body.data.debugCode;
    expect(code).toBeTruthy();

    const verify = await request(server).post('/api/auth/otp/verify')
      .send({ mobile: staff.mobile, code, kind: 'customer' });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.kind).toBe('customer');
    expect(verify.body.data.user.id).not.toBe(staff.id);
  });

  it('password reset at the customer door cannot touch a staff-only mobile', async () => {
    const server = await app();
    const staff = await createStaffWithMobile('r4_reset_target', '09129998866');

    const reset = await request(server).post('/api/auth/otp/request')
      .send({ mobile: staff.mobile, kind: 'customer', purpose: 'reset' });
    expect(reset.status).toBe(400);

    // The staff password is untouched.
    const session = await login(staff.username, staff.password, 'staff');
    expect(session.cookie?.length).toBeGreaterThan(0);
  });

  it('OTP endpoints require the door to be named', async () => {
    const server = await app();
    const res = await request(server).post('/api/auth/otp/request').send({ mobile: '09129990002' });
    expect(res.status).toBe(400);
  });
});

describe('editable landing surface', () => {
  it('bootstrap exposes landing settings and real counters', async () => {
    const server = await app();
    const res = await request(server).get('/api/public/bootstrap');
    expect(res.status).toBe(200);
    const { settings, stats } = res.body.data;
    expect(settings['landing.hero_subtitle']).toContain('همراه شما');
    expect(settings['landing.app_android_url']).toBe('');
    // Round-2 install surface: three destinations, all unpublished by default,
    // and the coming-soon cards switched on so the page can ship before release.
    expect(settings['landing.app_bazaar_url']).toBe('');
    expect(settings['landing.app_myket_url']).toBe('');
    expect(settings['landing.app_coming_soon']).toBe(true);
    expect(settings['site.name_en']).toBeTruthy();
    expect(JSON.parse(settings['landing.features'])).toHaveLength(6);
    expect(stats.services).toBeGreaterThanOrEqual(190);
    expect(stats.customers).toBeGreaterThanOrEqual(1);
    expect(stats.completedRequests).toBeGreaterThanOrEqual(0);
  });

  it('rewrites a legacy install label exactly once, and never after release', async () => {
    await app();
    const read = () => one<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'landing.app_button_label'",
    );

    // The pre-split value named the only button; it now labels the APK card.
    await run("UPDATE settings SET value='دریافت اپلیکیشن' WHERE key='landing.app_button_label'");
    await run("UPDATE settings SET value='' WHERE key='landing.app_android_url'");
    await ensureSettingDefaults();
    expect((await read())?.value).toBe('دانلود مستقیم');

    // Wording the office chose is never touched.
    await run("UPDATE settings SET value='از بازار بگیرید' WHERE key='landing.app_button_label'");
    await ensureSettingDefaults();
    expect((await read())?.value).toBe('از بازار بگیرید');

    // And once a real APK link exists, the migration stops firing entirely.
    await run("UPDATE settings SET value='دریافت اپلیکیشن' WHERE key='landing.app_button_label'");
    await run("UPDATE settings SET value='https://example.ir/app.apk' WHERE key='landing.app_android_url'");
    await ensureSettingDefaults();
    expect((await read())?.value).toBe('دریافت اپلیکیشن');

    await run("UPDATE settings SET value='' WHERE key='landing.app_android_url'");
  });

  it('an admin edit to landing settings is served to the public immediately', async () => {
    const server = await app();
    const admin = await adminSession();
    const marker = 'زیرعنوان آزمایشی دور چهارم';
    const put = await request(server).put('/api/settings/admin')
      .set('Cookie', admin.cookie)
      .send({ values: { 'landing.hero_subtitle': marker } });
    expect(put.status).toBe(200);

    const res = await request(server).get('/api/public/bootstrap');
    expect(res.body.data.settings['landing.hero_subtitle']).toBe(marker);

    // Restore the default copy for the rest of the suite.
    await request(server).put('/api/settings/admin')
      .set('Cookie', admin.cookie)
      .send({ values: { 'landing.hero_subtitle': 'همراه شما در انجام امور اداری و خدمات دولتی' } })
      .expect(200);
  });

  it('brand logo asset is 404 until a logo file is configured', async () => {
    const server = await app();
    const res = await request(server).get('/api/public/brand-asset/logo');
    expect(res.status).toBe(404);
  });
});
