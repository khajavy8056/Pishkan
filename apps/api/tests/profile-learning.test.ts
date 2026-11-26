import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { learnFromSubmission } from '../src/modules/profiles/autofill.js';

/**
 * The profile gets completed by the forms a customer already fills.
 *
 * ## The ask, in the office's words
 *
 * «تاریخ تولد در پروفایل نیست؛ اما اگر یک بار در یک خدمت پر شود، برای خدمات بعدی
 * هم خودش پر شود.» Reasking the same fact on every service is what makes a
 * customer's third form feel like the first one. So a submission now writes back
 * the answers that are facts about the person — and only into cells that are
 * still empty.
 *
 * ## The rules this file exists to keep
 *
 *  1. **Never overwrite.** A profile cell the owner set wins, even against a
 *     newer form. Otherwise one typo in one service becomes the source of truth
 *     for every future autofill — the damage of a wrong fact is much larger than
 *     the cost of a missing one.
 *  2. **Never another person's fact.** `spouse_national_id` and `child_*` are
 *     answers *about someone else*; they stay in the case file.
 *  3. **Never an unverified identity field.** `mobile`/`email` are how a person
 *     logs in (`users.mobile_verified` is a separate claim), so a form answer
 *     must not move them.
 *  4. **Not from a staff submission.** A case typed by an office clerk is not the
 *     customer's own declaration.
 *
 * These read the real tables because the whole point is what the next service's
 * autofill will see.
 */
const NATIONAL = '0013546295';
// Both are check-digit-valid (the form validator enforces it), so a rejected
// spouse id below is a policy decision, not a validation accident.
const OTHER_NATIONAL = '0013546309';
// 26 characters, `IR` + 24 digits, and the second one fails the mod-97 check —
// `validIban` is the same function the form validator uses, so the accepted
// value here is a shape a customer can actually submit.
const IBAN = 'IR062960000000100324200001';
const BAD_IBAN = 'IR062960000000100324200002';

async function setupCase(form: unknown[]) {
  const server = await app();
  const admin = await adminSession();
  const title = `خدمت یادگیری پروفایل ${Date.now()}`;
  const created = await request(server)
    .post('/api/catalog/services')
    .set('cookie', admin.cookie)
    .send({
      title,
      summary: 'آزمون',
      description: 'توضیح آزمون',
      baseFee: 0,
      estimatedDays: 2,
      paymentMethod: 'online',
      form,
    })
    .expect(201);
  const mobile = `0936${Math.floor(1000000 + Math.random() * 8999999)}`;
  const password = 'Customer#12345';
  await request(server).post('/api/auth/register').send({ mobile, password, fullName: 'سارا آزمایشی' }).expect(201);
  const login = await request(server).post('/api/auth/customer/login').send({ identifier: mobile, password }).expect(200);
  const cookie = login.headers['set-cookie'] as unknown as string[];
  // `requireCompleteProfile` is an unconditional gate on submission (name, mobile,
  // a valid national id, a city), so a real customer always arrives with those
  // four. That is also why this test — and `WRITEBACK` — is only about the cells
  // the gate does *not* insist on.
  await request(server).patch('/api/auth/profile').set('cookie', cookie)
    .send({ firstName: 'سارا', lastName: 'آزمایشی', nationalId: NATIONAL, cityId: 'tehran' }).expect(200);
  const me = await request(server).get('/api/auth/me').set('cookie', cookie).expect(200);
  return { server, cookie, customerId: me.body.data.id as string, serviceId: created.body.data.id as string };
}

const FORM = [
  { key: 'birth_date', label: 'تاریخ تولد', type: 'date', required: true },
  { key: 'national_id', label: 'کد ملی', type: 'national_id', required: true },
  { key: 'postal_code', label: 'کد پستی', type: 'postal_code', required: false },
  { key: 'spouse_national_id', label: 'کد ملی همسر', type: 'national_id', required: false },
  { key: 'father_name', label: 'نام پدر', type: 'text', required: false },
  { key: 'iban', label: 'شماره شبا', type: 'iban', required: false },
];

describe('profile learning from submissions', () => {
  it('fills the empty profile cells a service just asked for', async () => {
    const { server, cookie, customerId, serviceId } = await setupCase(FORM);
    const res = await request(server)
      .post('/api/requests')
      .set('cookie', cookie)
      .send({
        serviceId,
        paymentMethod: 'online',
        formData: {
          birth_date: '1370-05-12',
          national_id: NATIONAL,
          postal_code: '1561873429',
          spouse_national_id: OTHER_NATIONAL,
          father_name: 'مریم',
          iban: IBAN,
        },
      });
    if (res.status !== 201) throw new Error(`submit failed: ${JSON.stringify(res.body)}`);

    expect(res.body.data.profileLearned).toEqual(
      expect.arrayContaining(['تاریخ تولد', 'کد پستی', 'نام پدر', 'شماره شبا']),
    );
    const profile = await one<any>(
      `SELECT birth_date, postal_code, father_name, iban FROM customer_profiles WHERE user_id = ?`,
      [customerId],
    );
    expect(profile!.birth_date).toBe('1370-05-12');
    expect(profile!.postal_code).toBe('1561873429');
    expect(profile!.iban).toBe(IBAN);

    // …and the *next* service's form is prefilled from it — the whole point.
    const autofill = await request(server).get('/api/auth/profile/autofill').set('cookie', cookie).expect(200);
    expect(autofill.body.data.values.birth_date).toBe('1370-05-12');
    expect(autofill.body.data.values.postal_code).toBe('1561873429');
    expect(autofill.body.data.missing.map((entry: { key: string }) => entry.key)).not.toContain('birth_date');
  });

  it('offers nothing that is not a fact about the person', async () => {
    const { server, cookie, customerId, serviceId } = await setupCase(FORM);
    const res = await request(server)
      .post('/api/requests')
      .set('cookie', cookie)
      .send({
        serviceId,
        paymentMethod: 'online',
        formData: {
          birth_date: '1370-05-12',
          national_id: NATIONAL,
          spouse_national_id: OTHER_NATIONAL,
          father_name: 'مریم',
        },
      })
      .expect(201);

    // What the next service will be offered, read through the real autofill path.
    const autofill = await request(server).get('/api/auth/profile/autofill').set('cookie', cookie).expect(200);
    const values = autofill.body.data.values as Record<string, string>;
    expect(values.birth_date).toBe('1370-05-12');
    expect(values.father_name).toBe('مریم');
    // A spouse's national id is somebody else's fact: it must not become a
    // profile value, and `national_id` must stay the owner's own.
    expect(values).not.toHaveProperty('spouse_national_id');
    expect(values.national_id).toBe(NATIONAL);
    // Identity cells are the profile gate's own job, never a form's.
    const learned = res.body.data.profileLearned as string[];
    expect(learned).not.toContain('شماره موبایل');
    expect(learned).not.toContain('کد ملی');
    expect(learned).not.toContain('کد ملی همسر');
    const columns = await one<Record<string, unknown>>('SELECT * FROM customer_profiles WHERE user_id = ?', [customerId]);
    expect(Object.keys(columns!).some((name) => name.includes('spouse'))).toBe(false);
  });

  it('never rewrites what the owner already set', async () => {
    const { server, cookie, customerId, serviceId } = await setupCase(FORM);
    const ts = new Date().toISOString();
    await run('UPDATE customer_profiles SET birth_date = ?, postal_code = ?, updated_at = ? WHERE user_id = ?',
      ['1365-01-01', '1111111111', ts, customerId]);
    const res = await request(server)
      .post('/api/requests')
      .set('cookie', cookie)
      .send({
        serviceId,
        paymentMethod: 'online',
        // Both valid, both different — a newer form answer still must not move
        // a cell the owner filled.
        formData: { birth_date: '1372-09-09', national_id: NATIONAL, postal_code: '2222222222', father_name: 'مریم' },
      })
      .expect(201);
    expect(res.body.data.profileLearned).toEqual(['نام پدر']);
    const profile = await one<any>('SELECT birth_date, postal_code, father_name FROM customer_profiles WHERE user_id = ?', [customerId]);
    expect(profile!.birth_date).toBe('1365-01-01');
    expect(profile!.postal_code).toBe('1111111111');
    expect(profile!.father_name).toBe('مریم');
  });

  it('learns only what the autofill side can give back', async () => {
    // `WRITEBACK` is not exported, so the invariant is checked where it can
    // actually break: from the module's own source. Anything the write-back can
    // store must be readable again, or the profile silently forgets on purpose.
    const source = await readFile(new URL('../src/modules/profiles/autofill.ts', import.meta.url), 'utf8');
    const map = source.slice(source.indexOf('const WRITEBACK'), source.indexOf('export async function learnFromSubmission'));
    const keys = [...map.matchAll(/^  ([a-z_]+): \{ column: '/gm)].map((m) => m[1]);
    expect(keys.length, 'the write-back map was reformatted; update this probe').toBeGreaterThan(8);
    const server = await app();
    const { cookie } = await setupCase(FORM);
    const published = await request(server).get('/api/auth/profile/autofill').set('cookie', cookie).expect(200);
    const known = new Set([...Object.keys(published.body.data.values), ...published.body.data.missing.map((entry: { key: string }) => entry.key)]);
    for (const key of keys) expect(known.has(key), `«${key}» would be saved but never offered back`).toBe(true);
  });

  it('refuses an answer that is not a valid value for that column', async () => {
    // Straight at the write-back, because the form validator is the first line of
    // defence and would reject these before they ever reached it — which is the
    // point: the learn-back must hold the same rules on its own, since a staff
    // submission, a future import, or a form with a looser field type can all
    // hand it the same garbage.
    const { customerId } = await setupCase(FORM);
    const result = await learnFromSubmission(customerId, {
      postal_code: '123',
      iban: BAD_IBAN,
      birth_date: '1402/05/12',
      card_number: '1234',
      address: 'خیابان',
      birth_certificate_no: '9',
      father_name: 'م',
      job_title: 'شغل آزمایشی',
    });
    expect(result.learned, 'only the job title is a well-formed value here').toEqual(['شغل']);
    const profile = await one<any>('SELECT postal_code, iban, birth_date, address, job_title FROM customer_profiles WHERE user_id = ?', [customerId]);
    expect(profile!.postal_code).toBeFalsy();
    expect(profile!.iban).toBeFalsy();
    expect(profile!.birth_date).toBeFalsy();
    expect(profile!.address, 'too short to be an address').toBeFalsy();
    expect(profile!.job_title).toBe('شغل آزمایشی');
  });

  it('does not learn from a case an office clerk typed on the customer\'s behalf', async () => {
    const { server, customerId, serviceId } = await setupCase(FORM);
    const admin = await adminSession();
    const res = await request(server)
      .post('/api/requests')
      .set('cookie', admin.cookie)
      .send({ serviceId, customerId, paymentMethod: 'online', formData: { birth_date: '1370-05-12', national_id: NATIONAL } })
      .expect(201);
    expect(res.body.data.profileLearned).toBeUndefined();
    const profile = await one<{ birth_date: string }>('SELECT birth_date FROM customer_profiles WHERE user_id = ?', [customerId]);
    expect(profile?.birth_date ?? null, 'a clerk is not the person declaring their own birthday').toBeNull();
  });
});
