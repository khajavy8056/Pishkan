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
    if (env.dbDriver === 'sqlite') {
      // start from an empty file so repeated local runs are deterministic
      for (const suffix of ['', '-wal', '-shm']) {
        const file = `${env.sqliteFile}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    } else {
      // The SQLite path gets a brand-new file per process. PostgreSQL is a
      // real server with a persistent database, so without this reset the
      // second run starts on top of the first one's rows: `createStaff` hits
      // a duplicate username, and a setting changed by an earlier test file
      // stays changed for every file after it.
      //
      // This is why the suite never caught a dialect difference: the SQLite
      // runs were always clean, so they could not show what a dirty database
      // does.
      await resetPostgresSchema();
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

/**
 * Drop and recreate `public`. Only ever called by the test harness, and only
 * when the driver is postgres — a guard is cheap insurance against a future
 * refactor that copies this import somewhere it does not belong.
 */
async function resetPostgresSchema(): Promise<void> {
  if (env.dbDriver !== 'postgres') {
    throw new Error('resetPostgresSchema is only valid for the postgres driver');
  }
  const { q } = await import('../src/db/index.js');
  await q('DROP SCHEMA IF EXISTS public CASCADE');
  await q('CREATE SCHEMA public');
}

export async function app() {
  return setup();
}

export async function resetDb() {
  await closeDb();
}

export interface Session { cookie: string[] }

/** Log in through one of the two separated doors and return a cookie jar. */
export async function login(identifier: string, password: string, audience: 'customer' | 'staff' = 'staff'): Promise<Session> {
  const server = await app();
  const res = await request(server).post(`/api/auth/${audience}/login`).send({ identifier, password });
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
  const session = await login(CUSTOMER.mobile, CUSTOMER.password, 'customer');
  await request(server).patch('/api/auth/profile').set('Cookie',session.cookie).send({firstName:'مشتری',lastName:'آزمایشی',nationalId:'0013546295',cityId:'tehran'}).expect(200);
  return session;
}

/** A brand-new verified customer, for isolation and wallet-scope tests. */
export async function newCustomer(name = 'مشتری دوم') {
  const server = await app();
  const mobile = `0935${Math.floor(1000000 + Math.random() * 8999999)}`;
  const password = 'Customer#12345';
  await request(server).post('/api/auth/register').send({ mobile, password, fullName: name }).expect(201);
  const session = await login(mobile, password, 'customer');
  await request(server).patch('/api/auth/profile').set('Cookie', session.cookie).send({
    firstName: 'مشتری', lastName: 'دوم', nationalId: '0013546295', cityId: 'tehran',
  }).expect(200);
  const me = await request(server).get('/api/auth/me').set('Cookie', session.cookie).expect(200);
  return { session, id: me.body.data.id as string, mobile };
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

/**
 * True when the suite is running against SQLite.
 *
 * Some features are *defined* in terms of the SQLite database file: the
 * one-file restore package stores a literal `database.sqlite` inside a zip, and
 * the backup/restore round trip swaps that file. They are not portability bugs,
 * they are SQLite-only by design, and the production route rejects them on
 * PostgreSQL with an explicit message. Guard those suites with this flag so a
 * PostgreSQL run reports "skipped" instead of "failed" — a red test that means
 * "wrong engine" trains people to ignore red tests.
 */
export const isSqlite = env.dbDriver === 'sqlite';
