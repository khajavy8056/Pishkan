import { run } from '../src/db/index.js';
import fs from 'node:fs';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/http/app.js';
import { migrate } from '../src/db/migrate.js';
import { runSeed } from '../src/modules/catalog/seed.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { closeDb } from '../src/db/index.js';
import { env } from '../src/env.js';

let appPromise: Promise<Express> | null = null;
let seeded = false;

export const ADMIN = { username: 'testadmin', password: 'TestAdmin#12345' };
export const CUSTOMER = { mobile: '09121112233', password: 'Customer#12345', fullName: 'مشتری آزمایشی' };
export const ACCOUNTANT = { username: 'acc_test', password: 'Accountant#12345', fullName: 'حسابدار آزمایشی' };
export const EXPERT = { username: 'expert_test', password: 'Expert#12345', fullName: 'کارشناس آزمایشی' };

/** Fresh database + seeded catalogue for the whole test run (single fork). */
export async function setup() {
  if (!seeded) {
    // start from an empty file so repeated local runs are deterministic
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${env.sqliteFile}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    await migrate();
    await runSeed({
      admin: { ...ADMIN, fullName: 'مدیر آزمایشی' },
      log: () => undefined,
    });

    // Test policy: password login for customers + console SMS transport.
    await updateSettings({
      'auth.customer_password_enabled': true,
      'auth.customer_otp_enabled': true,
      'auth.staff_otp_enabled': true,
      'sms.enabled': true,
      'sms.provider': 'console',
      'sms.otp_template_id': '',
      'services.auto_assign': true,
      'services.auto_assign_strategy': 'least_loaded',
    }, { id: 'system', name: 'test-bootstrap' }, { confirmCritical: true });
    seeded = true;
  }
  if (!appPromise) appPromise = createApp();
  return appPromise;
}

export async function app() {
  return setup();
}

export async function resetDb() {
  await closeDb();
}

export interface Session { cookie: string[] }

/** Log in and return a supertest-friendly cookie jar. */
export async function login(identifier: string, password: string): Promise<Session> {
  const server = await app();
  const res = await request(server).post('/api/auth/login').send({ identifier, password });
  if (!res.body.ok) throw new Error(`login failed for ${identifier}: ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'] as unknown as string[];
  return { cookie };
}

export async function adminSession() {
  return login(ADMIN.username, ADMIN.password);
}

export async function customerSession() {
  const server = await app();
  // register once, then log in
  const reg = await request(server).post('/api/auth/register').send({
    mobile: CUSTOMER.mobile, password: CUSTOMER.password, fullName: CUSTOMER.fullName,
  });
  if (!reg.body.ok && reg.body?.error?.code !== 'conflict') throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const session = await login(CUSTOMER.mobile, CUSTOMER.password);
  await request(server).patch('/api/auth/profile').set('Cookie',session.cookie).send({firstName:'مشتری',lastName:'آزمایشی',nationalId:'0013546295',cityId:'tehran'}).expect(200);
  return session;
}

export async function createStaff(roleCode: string, user: { username: string; password: string; fullName: string }) {
  const admin = await adminSession();
  const server = await app();
  const res = await request(server)
    .post('/api/staff')
    .set('Cookie', admin.cookie)
    .send({
      fullName: user.fullName,
      mobile: `0912${Math.floor(1000000 + Math.random() * 8999999)}`,
      username: user.username,
      password: user.password,
      roleCode,
      employeeCode: `T-${Math.floor(Math.random() * 9000 + 1000)}`,
    });
  if (!res.body.ok) throw new Error(`createStaff failed: ${JSON.stringify(res.body)}`);
  // A controlled verified fixture, not an implicit production ownership claim.
  await run('UPDATE users SET mobile_verified=1 WHERE id=?',[res.body.data.id]);
  return login(user.username, user.password);
}

export async function firstServiceId(): Promise<{ id: string; title: string; required: boolean }> {
  const server = await app();
  const res = await request(server).get('/api/public/services?pageSize=1');
  const service = res.body.data[0];
  return { id: service.id, title: service.title, required: true };
}

export function auth(session: Session) {
  return { Cookie: session.cookie };
}
