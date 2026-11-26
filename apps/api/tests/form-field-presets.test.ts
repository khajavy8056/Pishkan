import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';
import { one } from '../src/db/index.js';

/**
 * The ready-made field palette of the service editor.
 *
 * ## What this pins down
 *
 * Defining a form meant retyping «کد ملی» — key, label, type, required, help —
 * for the fortieth time, and every retyping was a chance for one service to use
 * `national_id` and the next `melli_code` — and the profile autofill matches a
 * service field to a profile value by that exact key (`profileAutofill` returns
 * values under catalogue keys, the checkout looks up `field.key`), so drift does
 * not error, it just stops filling anything in. The palette is the fix, and its
 * whole value is in three promises:
 *
 *  1. a field another service already defines is offered, with its standard
 *     attached (so the office cannot *not* find it);
 *  2. a field invented today is offered on the next service without anybody
 *     maintaining a list;
 *  3. the free-form path stays open, and placeholder keys the editor invents for
 *     itself never pollute the list.
 *
 * These read the seeded catalogue rather than a fixture, because the point is
 * exactly that the palette is the catalogue.
 */
const PALETTE = '/api/catalog/admin/form-field-presets';

/** The palette is an admin screen's data: it needs the session cookie. */
async function palette(server: any, admin: { cookie: string }, query = '') {
  const res = await request(server)
    .get(`${PALETTE}?limit=200&q=${encodeURIComponent(query)}`)
    .set('cookie', admin.cookie)
    .expect(200);
  return res.body.data as { key: string; label: string; type: string; usage: number; source: string; field: any }[];
}

describe('form field presets', () => {
  it('offers the fields the catalogue already defines, with their usage', async () => {
    const server = await app();
    const admin = await adminSession();
    const items = await palette(server, admin);
    const national = items.find((item) => item.key === 'national_id');
    expect(national, 'the palette must know «کد ملی»').toBeTruthy();
    expect(national!.label).toBe('کد ملی');
    expect(national!.type).toBe('national_id');
    expect(national!.usage).toBeGreaterThan(50);
    // The standard carries the cap, which the app enforced and the API dropped.
    expect(national!.field.maxLength).toBe(10);
  });

  it('searches the way a Persian speaker types', async () => {
    const server = await app();
    const admin = await adminSession();
    // Arabic ي/ك and no diacritics: «ملي» must find «ملی», and two words AND.
    expect((await palette(server, admin, 'ملي')).some((item) => item.key === 'national_id')).toBe(true);
    expect((await palette(server, admin, 'تاریخ تولد')).map((item) => item.key)).toContain('birth_date');
    const birth = (await palette(server, admin, 'تاریخ تولد')).filter((item) => !/تاریخ تولد|تاریخ /.test(item.label));
    expect(birth, 'a hit whose label is unrelated means the AND is not applied').toEqual([]);
  });

  it('registers a field the office invented, so the next service reuses it', async () => {
    const server = await app();
    const admin = await adminSession();
    const title = `خدمت آزمون پالت ${Date.now()}`;
    const created = await request(server)
      .post('/api/catalog/services')
      .set('cookie', admin.cookie)
      .send({
        title,
        summary: 'آزمون',
        description: 'توضیح آزمون',
        baseFee: 100000,
        estimatedDays: 3,
        paymentMethod: 'online',
        form: [{ key: 'court_file_no', label: 'شماره پرونده دادگاه', type: 'text', required: true, maxLength: 20, help: '۱۳ رقم' }],
      })
      .expect(201);
    expect(created.body.data.form[0].maxLength).toBe(20);

    const found = (await palette(server, admin, 'شماره پرونده')).find((item) => item.key === 'court_file_no');
    expect(found, 'a saved service field must be reusable without a second save').toBeTruthy();
    expect(found!.usage).toBe(1);
    expect(found!.field.help).toBe('۱۳ رقم');
  });

  it('keeps the editor free-form but refuses to memorise its placeholders', async () => {
    const server = await app();
    const admin = await adminSession();
    await request(server)
      .post('/api/catalog/services')
      .set('cookie', admin.cookie)
      .send({
        title: `خدمت فیلد بی‌نام ${Date.now()}`,
        summary: 'آزمون',
        description: 'توضیح',
        baseFee: 0,
        paymentMethod: 'online',
        form: [{ key: 'field_1', label: 'فیلد اول', type: 'text' }],
      })
      .expect(201);
    const items = await palette(server, admin);
    expect(items.some((item) => item.key === 'field_1'), '«field_1» is the editor\'s blank row, not a standard').toBe(false);
  });

  it('lets the office save a corrected standard, and that one wins', async () => {
    const server = await app();
    const admin = await adminSession();
    await request(server)
      .post(PALETTE)
      .set('cookie', admin.cookie)
      .send({ key: 'birth_certificate_no', label: 'شماره سریال شناسنامه', type: 'text', required: true, maxLength: 20, help: 'پایهٔ صفحهٔ سوم' })
      .expect(201);

    const items = await palette(server, admin, 'سریال شناسنامه');
    const birth = items.find((item) => item.key === 'birth_certificate_no');
    expect(birth, 'a deliberate standard must not be shadowed by the scanned one').toBeTruthy();
    expect(birth!.label).toBe('شماره سریال شناسنامه');
    expect(birth!.source).toBe('manual');
    const row = await one<{ definition: string }>('SELECT definition FROM form_field_presets WHERE key = ?', ['birth_certificate_no']);
    expect(JSON.parse(row!.definition).help).toBe('پایهٔ صفحهٔ سوم');

    // And a palette entry the service schema would reject is a trap, not a help.
    await request(server).post(PALETTE).set('cookie', admin.cookie).send({ key: 'x', label: 'ک' }).expect(400);
    await request(server).post(PALETTE).set('cookie', admin.cookie)
      .send({ key: 'field_2', label: 'فیلد بی‌نام', type: 'text' }).expect(400);

    await request(server).delete(`${PALETTE}/birth_certificate_no`).set('cookie', admin.cookie).expect(200);
    // `await one(...)!.c` would read `.c` off the *promise* — the parens are load-bearing.
    const after = await one<{ c: number | string }>('SELECT COUNT(*) AS c FROM form_field_presets WHERE key = ?', ['birth_certificate_no']);
    expect(Number(after!.c)).toBe(0);
  });

  it('refuses to delete a field that lives in a service', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).delete(`${PALETTE}/national_id`).set('cookie', admin.cookie).expect(400);
    expect(res.body.error.message).toContain('فیلدهایی که در خدمات هستند');
  });
});
