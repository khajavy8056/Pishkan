/**
 * A customer tells us their name once, at sign-up.
 *
 * Sign-up (web and Android) has one «نام و نام خانوادگی» field while the
 * profile stores two columns, and nothing used to bridge them: the profile
 * screen opened empty and demanded the family name that had been typed minutes
 * earlier, and `profileState` called the account incomplete. These tests pin
 * the three parts of the fix — the split at registration, the derivation for
 * accounts that predate it, and the boot-time repair that makes the stored row
 * agree with the account.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { backfillProfileNames, splitFullName, withDerivedNames } from '../src/modules/profiles/service.js';

let server: Awaited<ReturnType<typeof app>>;

async function registerWith(fullName: string) {
  const mobile = `0935${Math.floor(1000000 + Math.random() * 8999999)}`;
  const password = 'Customer#12345';
  await request(server).post('/api/auth/register').send({ mobile, password, fullName }).expect(201);
  const login = await request(server).post('/api/auth/customer/login').send({ identifier: mobile, password }).expect(200);
  const me = await request(server).get('/api/auth/me').set('Cookie', login.headers['set-cookie'] as string[]).expect(200);
  return { cookie: login.headers['set-cookie'] as string[], id: me.body.data.id as string, me: me.body.data };
}

describe('profile names come from the sign-up name', () => {
  beforeAll(async () => {
    server = await app();
  });

  it('splits the sign-up name into both profile columns', async () => {
    const { id, me } = await registerWith('سارا محمدی نیا');
    const state = me.profileState;
    expect(state.profile.first_name).toBe('سارا');
    expect(state.profile.last_name).toBe('محمدی نیا');
    expect(state.missing).not.toContain('نام');
    expect(state.missing).not.toContain('نام خانوادگی');
    // Persisted, not merely rendered: the office's own customer view reads the
    // columns, and a name that only exists at read time would vanish there.
    const row = await one<any>('SELECT first_name, last_name FROM customer_profiles WHERE user_id = ?', [id]);
    expect(row).toMatchObject({ first_name: 'سارا', last_name: 'محمدی نیا' });
    expect(`${row.first_name} ${row.last_name}`.trim()).toBe('سارا محمدی نیا');
  });

  it('derives the halves for a legacy profile whose columns were never filled', async () => {
    const { id, cookie } = await registerWith('کاوه رضایی');
    await run('UPDATE customer_profiles SET first_name = NULL, last_name = NULL WHERE user_id = ?', [id]);

    const me = await request(server).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.data.profileState.profile.first_name).toBe('کاوه');
    expect(me.body.data.profileState.profile.last_name).toBe('رضایی');
    expect(me.body.data.profileState.missing).not.toContain('نام خانوادگی');
  });

  it('repairs those rows on boot without inventing a family name', async () => {
    const { id } = await registerWith('نگار احمدی');
    await run('UPDATE customer_profiles SET first_name = NULL, last_name = NULL WHERE user_id = ?', [id]);
    const result = await backfillProfileNames();
    expect(result.updated).toBeGreaterThanOrEqual(1);
    const row = await one<any>('SELECT first_name, last_name FROM customer_profiles WHERE user_id = ?', [id]);
    expect(row).toMatchObject({ first_name: 'نگار', last_name: 'احمدی' });

    // A single-word name has no second half to recover — say so instead of
    // making one up, and keep asking for it.
    const single = await registerWith('میلاد');
    await run('UPDATE customer_profiles SET first_name = NULL, last_name = NULL WHERE user_id = ?', [single.id]);
    await backfillProfileNames();
    const after = await request(server).get('/api/auth/me').set('Cookie', single.cookie).expect(200);
    expect(after.body.data.profileState.missing).toContain('نام خانوادگی');
    expect(after.body.data.profileState.profile.first_name).toBe('میلاد');
    expect(after.body.data.profileState.profile.last_name ?? null).toBeNull();
  });

  it('never overwrites names an office already edited', async () => {
    const { id, cookie } = await registerWith('علی محمدی');
    await request(server).patch('/api/auth/profile').set('Cookie', cookie)
      .send({ firstName: 'علی‌رضا', lastName: 'محمدی‌پور' }).expect(200);
    await backfillProfileNames();
    const row = await one<any>('SELECT first_name, last_name FROM customer_profiles WHERE user_id = ?', [id]);
    expect(row).toMatchObject({ first_name: 'علی‌رضا', last_name: 'محمدی‌پور' });
  });

  it('splits names the way the profile form rejoins them', () => {
    expect(splitFullName('  علی   محمدی ')).toEqual({ firstName: 'علی', lastName: 'محمدی' });
    expect(splitFullName('میلاد')).toEqual({ firstName: 'میلاد', lastName: '' });
    expect(splitFullName('')).toEqual({ firstName: '', lastName: '' });
    expect(withDerivedNames({ full_name: 'سارا محمدی نیا', first_name: '', last_name: '' }))
      .toMatchObject({ first_name: 'سارا', last_name: 'محمدی نیا' });
    expect(withDerivedNames({ full_name: 'سارا محمدی', first_name: 'بی‌نام', last_name: '' }))
      .toMatchObject({ first_name: 'بی‌نام', last_name: 'محمدی' });
  });
});
