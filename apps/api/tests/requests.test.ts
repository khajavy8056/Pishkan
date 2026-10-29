import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createStaff, customerSession, adminSession, EXPERT } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { autoAssign, validateFormData } from '../src/modules/requests/service.js';
import { one, q } from '../src/db/index.js';

async function serviceIdBySlug(slug: string) {
  const server = await app();
  const res = await request(server).get(`/api/public/services/${slug}`);
  return res.body.data.id as string;
}

function validForm(service: any) {
  const data: Record<string, any> = {};
  for (const field of service.form) {
    if (!field.required) continue;
    switch (field.type) {
      case 'national_id': data[field.key] = '0013546295'; break;
      case 'tel': data[field.key] = '09121234567'; break;
      case 'iban': data[field.key] = 'IR062960000000100324200001'; break;
      case 'postal_code': data[field.key] = '1234567890'; break;
      case 'number':
      case 'money': data[field.key] = 1000000; break;
      case 'select':
      case 'radio': data[field.key] = field.options?.[0] ?? 'سایر'; break;
      case 'checkbox': data[field.key] = true; break;
      default: data[field.key] = 'اطلاعات آزمایشی';
    }
  }
  return data;
}

describe('request lifecycle', () => {
  it('strictly validates national IDs, IBAN checksums, and localized numbers', () => {
    const service = { form: [
      { key: 'national_id', label: 'کد ملی', type: 'national_id', required: true },
      { key: 'iban', label: 'شبا', type: 'iban', required: true },
      { key: 'amount', label: 'مبلغ', type: 'money', required: true },
    ] } as any;
    expect(validateFormData(service, { national_id: '0013546295', iban: 'IR062960000000100324200001', amount: '۱,۲۵۰' }))
      .toEqual({ national_id: '0013546295', iban: 'IR062960000000100324200001', amount: 1250 });
    expect(() => validateFormData(service, { national_id: '0012345678', iban: 'IR062960000000100324200001', amount: '1250' })).toThrow();
    expect(() => validateFormData(service, { national_id: 'abc0013546295', iban: 'IR062960000000100324200001', amount: '1250' })).toThrow();
    expect(() => validateFormData(service, { national_id: '0013546295', iban: 'IR062960000000100324200002', amount: '1250' })).toThrow();
    expect(() => validateFormData(service, { national_id: '0013546295', iban: 'IR062960000000100324200001', amount: 'abc10' })).toThrow();
  });

  it('requires a required checkbox to be affirmatively checked', () => {
    const service = { form: [{ key: 'consent', label: 'رضایت', type: 'checkbox', required: true }] } as any;
    try {
      validateFormData(service, { consent: false });
      throw new Error('Expected unchecked required consent to fail');
    } catch (error: any) {
      expect(error.details).toEqual([{ field: 'consent', message: '«رضایت» باید تأیید شود.' }]);
    }
    expect(validateFormData(service, { consent: true })).toEqual({ consent: true });
  });

  it('rotates round-robin assignments and leaves queue-strategy requests unassigned', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    await updateSettings({ 'workforce.auto_assign_on_shift': false, 'services.auto_assign': true }, { id: 'system', name: 'test-routing' });
    const firstStaff = await createStaff('service_expert', { username: 'rotation_one', password: 'Rotation#12345', fullName: 'کارشناس چرخشی یک' });
    const secondStaff = await createStaff('service_expert', { username: 'rotation_two', password: 'Rotation#12345', fullName: 'کارشناس چرخشی دو' });
    const firstId = (await request(server).get('/api/auth/me').set('Cookie', firstStaff.cookie)).body.data.id;
    const secondId = (await request(server).get('/api/auth/me').set('Cookie', secondStaff.cookie)).body.data.id;
    const service = (await request(server).get('/api/public/services/social-security-receipt')).body.data;
    const originalRule = (await request(server).get(`/api/staff/meta/service-assignments/${service.id}`).set('Cookie', admin.cookie)).body.data;
    await request(server).put(`/api/staff/meta/service-assignments/${service.id}`).set('Cookie', admin.cookie)
      .send({ staffIds: [firstId, secondId], strategy: 'round_robin' }).expect(200);
    const makeRequest = async () => request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId: service.id, formData: validForm(service) });
    const first = await makeRequest();
    const second = await makeRequest();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.assignedTo).not.toBe(second.body.data.assignedTo);

    await request(server).put(`/api/staff/meta/service-assignments/${service.id}`).set('Cookie', admin.cookie)
      .send({ staffIds: [firstId, secondId], strategy: 'queue' }).expect(200);
    const queued = await makeRequest();
    expect(queued.status).toBe(201);
    expect(queued.body.data.assignedTo).toBeNull();
    await request(server).put(`/api/staff/meta/service-assignments/${service.id}`).set('Cookie', admin.cookie)
      .send({ staffIds: originalRule.rule?.staffIds ?? [], strategy: originalRule.rule?.strategy ?? 'least_loaded', maxLoad: originalRule.rule?.maxLoad ?? 0 }).expect(200);
  });
  it('aggregates payment status across every active invoice on a request', async () => {
    const customer = await customerSession();
    const admin = await adminSession();
    const server = await app();
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId: service.id, formData: validForm(service) }).expect(201);
    const invoice = created.body.data.invoices[0];
    await request(server).post('/api/accounting/invoices').set('Cookie', admin.cookie)
      .send({ customerId: created.body.data.customerId, requestId: created.body.data.id, serviceId: service.id,
        title: 'هزینه تکمیلی', items: [{ title: 'هزینه تکمیلی', qty: 1, unitPrice: 10000 }] }).expect(201);
    await request(server).post('/api/accounting/payments').set('Cookie', admin.cookie)
      .send({ customerId: created.body.data.customerId, invoiceId: invoice.id, amount: invoice.total, method: 'cash' }).expect(201);
    const detail = await request(server).get(`/api/requests/${created.body.data.id}`).set('Cookie', customer.cookie);
    expect(detail.body.data.paymentStatus).toBe('partial');
  });

  it('creates a request with tracking code, snapshot and invoice', async () => {
    const customer = await customerSession();
    const server = await app();
    const serviceId = await serviceIdBySlug('insurance-history');
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;

    const res = await request(server)
      .post('/api/requests')
      .set('Cookie', customer.cookie)
      .send({ serviceId, formData: validForm(service), paymentMethod: 'cash' });

    expect(res.status).toBe(201);
    expect(res.body.data.trackingCode).toMatch(/^PK-/);
    expect(res.body.data.total).toBe(60000);
    expect(res.body.data.invoices).toHaveLength(1);
    // immutable snapshot captured at submit time
    expect(res.body.data.snapshot.service.title).toBe(service.title);
    expect(res.body.data.events[0].type).toBe('created');
  });

  it('replays the original request for a concurrent duplicate submission and rejects key reuse with changed data', async () => {
    const customer = await customerSession();
    const server = await app();
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;
    const payload = { serviceId: service.id, formData: validForm(service), paymentMethod: 'cash' };
    const submit = () => request(server).post('/api/requests').set('Cookie', customer.cookie)
      .set('Idempotency-Key', 'request-submit-test-0001').send(payload);

    const [first, retry] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.trackingCode).toBe(first.body.data.trackingCode);
    expect(retry.body.data.invoices).toHaveLength(1);

    const changedPayload = { ...payload, formData: { ...payload.formData, extra: 'different submission' } };
    const conflictResponse = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .set('Idempotency-Key', 'request-submit-test-0001').send(changedPayload);
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body.error.message).toContain('کلید ثبت');
  });

  it('only auto-assigns a request once when two assignment attempts overlap', async () => {
    const customer = await customerSession();
    const server = await app();
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;
    await updateSettings({ 'services.auto_assign': false, 'workforce.auto_assign_on_shift': false }, { id: 'system', name: 'test-atomic-assignment' });
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId: service.id, formData: validForm(service), paymentMethod: 'cash' }).expect(201);
    expect(created.body.data.assignedTo).toBeFalsy();

    await updateSettings({ 'services.auto_assign': true }, { id: 'system', name: 'test-atomic-assignment' });
    const results = await Promise.all([autoAssign(created.body.data.id), autoAssign(created.body.data.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await one<any>('SELECT assigned_to FROM requests WHERE id = ?', [created.body.data.id]);
    const events = await q<any>("SELECT id FROM request_events WHERE request_id = ? AND type = 'assigned'", [created.body.data.id]);
    expect(row?.assigned_to).toBeTruthy();
    expect(events).toHaveLength(1);
  });

  it('allows only one of two eligible employees to claim the same queued request', async () => {
    const customer = await customerSession();
    const server = await app();
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;
    const firstStaff = await createStaff('service_expert', { username: 'claim_race_one', password: 'ClaimRace#12345', fullName: 'کارشناس پذیرش اول' });
    const secondStaff = await createStaff('service_expert', { username: 'claim_race_two', password: 'ClaimRace#12345', fullName: 'کارشناس پذیرش دوم' });
    const firstId = (await request(server).get('/api/auth/me').set('Cookie', firstStaff.cookie)).body.data.id;
    const secondId = (await request(server).get('/api/auth/me').set('Cookie', secondStaff.cookie)).body.data.id;

    await updateSettings({ 'services.auto_assign': false, 'workforce.auto_assign_on_shift': false }, { id: 'system', name: 'test-claim-race' });
    let created: any;
    try {
      created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
        .send({ serviceId: service.id, formData: validForm(service), paymentMethod: 'cash' }).expect(201);
    } finally {
      await updateSettings({ 'services.auto_assign': true }, { id: 'system', name: 'test-claim-race' });
    }

    const [firstClaim, secondClaim] = await Promise.all([
      request(server).post(`/api/requests/${created.body.data.id}/claim`).set('Cookie', firstStaff.cookie),
      request(server).post(`/api/requests/${created.body.data.id}/claim`).set('Cookie', secondStaff.cookie),
    ]);
    expect([firstClaim.status, secondClaim.status].sort()).toEqual([200, 409]);
    const row = await one<any>('SELECT assigned_to FROM requests WHERE id = ?', [created.body.data.id]);
    const events = await q<any>("SELECT id FROM request_events WHERE request_id = ? AND type = 'assigned'", [created.body.data.id]);
    expect([firstId, secondId]).toContain(row?.assigned_to);
    expect(events).toHaveLength(1);
  });

  it('routes a customer request to staff and exposes staff status changes back to that customer', async () => {
    const customer = await customerSession();
    const admin = await adminSession();
    const server = await app();
    await updateSettings({ 'workforce.auto_assign_on_shift': false }, { id: 'system', name: 'test-lifecycle' });
    const staff = await createStaff('service_expert', { ...EXPERT, username: 'lifecycle_expert', password: 'Lifecycle#12345' });
    const staffMe = await request(server).get('/api/auth/me').set('Cookie', staff.cookie);
    const service = (await request(server).get('/api/public/services/social-security-receipt')).body.data;
    const originalRule = (await request(server).get(`/api/staff/meta/service-assignments/${service.id}`).set('Cookie', admin.cookie)).body.data;
    await request(server).put(`/api/staff/meta/service-assignments/${service.id}`).set('Cookie', admin.cookie)
      .send({ staffIds: [staffMe.body.data.id], strategy: 'fixed' }).expect(200);

    const created = await request(server)
      .post('/api/requests')
      .set('Cookie', customer.cookie)
      .send({ serviceId: service.id, formData: validForm(service) });
    expect(created.status).toBe(201);
    expect(created.body.data.assignedTo).toBe(staffMe.body.data.id);

    const staffQueue = await request(server).get('/api/requests').set('Cookie', staff.cookie);
    expect(staffQueue.body.data.some((item: any) => item.id === created.body.data.id)).toBe(true);

    const changed = await request(server)
      .patch(`/api/requests/${created.body.data.id}/status`)
      .set('Cookie', staff.cookie)
      .send({ status: 'in_progress', note: 'بررسی آغاز شد' });
    expect(changed.status).toBe(200);

    const customerDetail = await request(server)
      .get(`/api/requests/${created.body.data.id}`)
      .set('Cookie', customer.cookie);
    expect(customerDetail.body.data.status).toBe('in_progress');
    expect(customerDetail.body.data.events.some((event: any) => event.type === 'status' && event.toStatus === 'in_progress')).toBe(true);

    await request(server).put(`/api/staff/meta/service-assignments/${service.id}`).set('Cookie', admin.cookie)
      .send({ staffIds: originalRule.rule?.staffIds ?? [], strategy: originalRule.rule?.strategy ?? 'least_loaded', maxLoad: originalRule.rule?.maxLoad ?? 0 }).expect(200);
  });

  it('includes Andimeshk as an active selectable city', async () => {
    const server = await app();
    const cities = await request(server).get('/api/public/cities');
    expect(cities.status).toBe(200);
    expect(cities.body.data).toContainEqual(expect.objectContaining({ id: 'andimeshk', province: 'خوزستان', name: 'اندیمشک' }));
    const bootstrap = await request(server).get('/api/public/bootstrap');
    expect(bootstrap.body.data.settings['office.city']).toBe('اندیمشک');
    expect(bootstrap.body.data.settings['office.province']).toBe('خوزستان');
  });

  it('rejects a submission with missing required fields', async () => {
    const customer = await customerSession();
    const server = await app();
    const serviceId = await serviceIdBySlug('insurance-history');
    const res = await request(server)
      .post('/api/requests')
      .set('Cookie', customer.cookie)
      .send({ serviceId, formData: { full_name: 'فقط نام' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('validates national codes and IBAN values server-side', async () => {
    const customer = await customerSession();
    const server = await app();
    const serviceId = await serviceIdBySlug('insurance-history');
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;
    const form = validForm(service);
    form.national_id = '12345';
    const res = await request(server).post('/api/requests').set('Cookie', customer.cookie).send({ serviceId, formData: form });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('کد ملی');
  });

  it('blocks illegal status transitions and allows legal ones', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const serviceId = await serviceIdBySlug('subsidy-status-inquiry');
    const service = (await request(server).get('/api/public/services/subsidy-status-inquiry')).body.data;

    const created = await request(server)
      .post('/api/requests')
      .set('Cookie', customer.cookie)
      .send({ serviceId, formData: validForm(service) });
    const requestId = created.body.data.id;

    // new -> completed directly is not allowed
    const illegal = await request(server)
      .patch(`/api/requests/${requestId}/status`)
      .set('Cookie', admin.cookie)
      .send({ status: 'completed' });
    expect(illegal.status).toBe(409);

    const legal = await request(server)
      .patch(`/api/requests/${requestId}/status`)
      .set('Cookie', admin.cookie)
      .send({ status: 'in_progress', note: 'شروع بررسی' });
    expect(legal.status).toBe(200);
    expect(legal.body.data.status).toBe('in_progress');
  });

  it('requires approved documents before completion when policy is on', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const serviceId = await serviceIdBySlug('insurance-history');
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;

    const created = await request(server)
      .post('/api/requests')
      .set('Cookie', customer.cookie)
      .send({ serviceId, formData: validForm(service) });
    const requestId = created.body.data.id;

    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'in_progress' });
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'under_review' });
    const complete = await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'completed' });
    expect(complete.status).toBe(409);
    expect(complete.body.error.message).toContain('مدارک');
  });

  it("never lets a customer read another customer's request", async () => {
    const server = await app();
    const first = await customerSession();
    const created = await request(server).get('/api/requests?pageSize=1').set('Cookie', first.cookie);
    expect(created.status).toBe(200);

    // register a second customer with a different mobile
    await request(server).post('/api/auth/register').send({ mobile: '09127778899', password: 'Other#12345', fullName: 'مشتری دوم' });
    const second = await request(server).post('/api/auth/login').send({ identifier: '09127778899', password: 'Other#12345' });
    const cookie = second.headers['set-cookie'] as unknown as string[];

    const target = created.body.data[0];
    if (target) {
      const res = await request(server).get(`/api/requests/${target.id}`).set('Cookie', cookie);
      expect(res.status).toBe(404);
    }
  });

  it('records status changes in the request timeline', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const serviceId = await serviceIdBySlug('justice-shares-value');
    const service = (await request(server).get('/api/public/services/justice-shares-value')).body.data;

    const created = await request(server)
      .post('/api/requests')
      .set('Cookie', customer.cookie)
      .send({ serviceId, formData: validForm(service) });
    const requestId = created.body.data.id;

    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'in_progress' });
    const detail = await request(server).get(`/api/requests/${requestId}`).set('Cookie', customer.cookie);
    const types = detail.body.data.events.map((e: any) => e.type);
    expect(types).toContain('created');
    expect(types).toContain('status');
    expect(detail.body.data.events.every((e: any) => typeof e.message === 'string' || e.message === null)).toBe(true);
  });
});
