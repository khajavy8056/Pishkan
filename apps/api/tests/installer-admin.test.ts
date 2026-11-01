import request from 'supertest';
import { describe, it, expect, beforeAll } from 'vitest';
import { app, login, createStaff } from './helpers.js';
import { upsertInstallerAdmin } from '../src/modules/catalog/seed.js';

/**
 * Installer admin provisioning (create-admin --upsert).
 * Reproduces the Windows-install failure where re-running the installer with
 * fresh credentials «succeeded» but the typed username/password never worked,
 * because creation was skipped whenever any admin already existed.
 */
const USER = 'office_admin';
const PASS1 = 'Office#12345';
const PASS2 = 'NewOffice#6789';

describe('installer admin upsert', () => {
  beforeAll(async () => { await app(); });

  it('creates the account even though another admin already exists', async () => {
    const result = await upsertInstallerAdmin({ username: USER, password: PASS1, fullName: 'مدیر دفتر' });
    expect(result.status).toBe('created');
    const session = await login(USER, PASS1);
    const server = await app();
    const me = await request(server).get('/api/auth/me').set('Cookie', session.cookie).expect(200);
    expect(me.body.data.kind).toBe('admin');
    expect(me.body.data.username).toBe(USER);
  });

  it('is verified (not recreated) when the same password is supplied again', async () => {
    const again = await upsertInstallerAdmin({ username: USER, password: PASS1 });
    expect(again.status).toBe('verified');
    await login(USER, PASS1);
  });

  it('matches the username case-insensitively', async () => {
    const upper = await upsertInstallerAdmin({ username: 'Office_Admin', password: PASS1 });
    expect(upper.status).toBe('verified');
  });

  it('resets the password when the installer supplies a different one', async () => {
    const changed = await upsertInstallerAdmin({ username: USER, password: PASS2 });
    expect(changed.status).toBe('updated');
    await login(USER, PASS2);
    const server = await app();
    const oldLogin = await request(server).post('/api/auth/login').send({ identifier: USER, password: PASS1 });
    expect(oldLogin.status).toBe(401);
  });

  it('refuses to hijack a staff account with the same username', async () => {
    const staffPassword = 'Expert#12345';
    await createStaff('service_expert', { username: 'taken_user', password: staffPassword, fullName: 'کارشناس آزمایشی' });
    const conflict = await upsertInstallerAdmin({ username: 'taken_user', password: PASS2 });
    expect(conflict.status).toBe('conflict');
    // The staff account is untouched: original password works, installer password does not.
    await login('taken_user', staffPassword);
    const server = await app();
    const wrong = await request(server).post('/api/auth/login').send({ identifier: 'taken_user', password: PASS2 });
    expect(wrong.status).toBe(401);
  });
});
