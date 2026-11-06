import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createStaff, EXPERT, newCustomer } from './helpers.js';

let server: Awaited<ReturnType<typeof app>>;

describe('profile autofill', () => {
  beforeAll(async () => {
    server = await app();
  });

  it('stores extended profile fields and serves them for form autofill', async () => {
    const { session } = await newCustomer('مشتری پروفایل');
    const patch = await request(server).patch('/api/auth/profile').set('Cookie', session.cookie).send({
      fatherName: 'رضا',
      birthCertificateNo: '1234',
      birthPlace: 'تهران',
      birthDate: '1990-05-12',
      landline: '021-22334455',
      iban: 'ir06 2960 0000 0010 0324 2000 01',
      bankName: 'بانک ملی',
      cardNumber: '6037-9971-0000-0000',
    });
    expect(patch.status).toBe(200);

    const res = await request(server).get('/api/auth/profile/autofill').set('Cookie', session.cookie);
    expect(res.status).toBe(200);
    const { values, entries, missing } = res.body.data;
    expect(values.father_name).toBe('رضا');
    expect(values.birth_place).toBe('تهران');
    expect(values.birth_date).toBe('1990-05-12');
    expect(values.iban).toBe('IR062960000000100324200001');
    expect(values.mobile).toMatch(/^09\d{9}$/);
    expect(entries.some((e: any) => e.key === 'iban' && e.label === 'شماره شبا')).toBe(true);
    expect(missing.some((m: any) => m.key === 'iban')).toBe(false);
  });

  it('rejects an invalid IBAN', async () => {
    const { session } = await newCustomer('مشتری شبا');
    const bad = await request(server).patch('/api/auth/profile').set('Cookie', session.cookie)
      .send({ iban: 'IR123456' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('شبا');
  });

  it('reports what is still missing for a fresh customer', async () => {
    const { session } = await newCustomer('مشتری تازه');
    const res = await request(server).get('/api/auth/profile/autofill').set('Cookie', session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.values.full_name).toBeTruthy();
    expect(res.body.data.missing.length).toBeGreaterThan(0);
    expect(res.body.data.missing.some((m: any) => m.key === 'father_name')).toBe(true);
  });

  it('is customer-only', async () => {
    const staff = await createStaff('service_expert', { ...EXPERT, username: 'expert_af' });
    const res = await request(server).get('/api/auth/profile/autofill').set('Cookie', staff.cookie);
    expect(res.status).toBe(403);
  });
});
