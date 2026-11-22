import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, newCustomer } from './helpers.js';

let server: Awaited<ReturnType<typeof app>>;

describe('avatar presets', () => {
  beforeAll(async () => {
    server = await app();
  });

  /**
   * The picker has three tabs — female, male and "همه" (show both). The third
   * tab is a *view filter*, but its own name (`unspecified`) was being sent as
   * the account gender, and the endpoint accepts only `male | female | ''`.
   * Every pick made while "همه" was selected came back 400 «داده‌های ارسالی
   * معتبر نیست» — an error that never names the offending field, so it looked
   * like the preset number was wrong.
   *
   * The client now maps the tab to the empty string. This pins both the wire
   * contract and the mapping, so a future third tab cannot silently reappear
   * as a rejected enum value.
   */
  it('accepts the gender the picker actually sends, and rejects a stray tab name', async () => {
    const { session } = await newCustomer('مشتری آواتار');

    for (const gender of ['male', 'female', '']) {
      const res = await request(server)
        .put('/api/customers/me/avatar/preset')
        .set('Cookie', session.cookie)
        .send({ preset: 3, gender });
      expect(res.status, `gender ${JSON.stringify(gender)}`).toBe(200);
      expect(res.body.data.preset).toBe(3);
    }

    // The view-filter name must not be a valid wire value; that is precisely
    // why the client has to translate it.
    const bad = await request(server)
      .put('/api/customers/me/avatar/preset')
      .set('Cookie', session.cookie)
      .send({ preset: 3, gender: 'unspecified' });
    expect(bad.status).toBe(400);
  });

  it('bounds the preset to the number of faces that exist', async () => {
    const { session } = await newCustomer('مشتری آواتار ۲');
    for (const preset of [0, 25]) {
      const res = await request(server)
        .put('/api/customers/me/avatar/preset')
        .set('Cookie', session.cookie)
        .send({ preset });
      expect(res.status).toBe(400);
    }
  });
});
