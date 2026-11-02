import { describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { app, createStaff, customerSession, adminSession, EXPERT } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { confirmPayment, createPayment } from '../src/modules/accounting/service.js';
import { autoAssign, validateFormData } from '../src/modules/requests/service.js';
import { one, q, run } from '../src/db/index.js';
import { id } from '../src/lib/crypto.js';
import { login } from './helpers.js';

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
      case 'file': break;
      default: data[field.key] = 'اطلاعات آزمایشی';
    }
  }
  return data;
}

let fixtureImageSequence = 0;
async function uploadRequestFixture(server: any, customer: { cookie: string[] }, name: string, purpose = 'document') {
  const sequence = fixtureImageSequence++;
  const image = await sharp({
    create: { width: 40 + (sequence % 23), height: 35 + (sequence % 19), channels: 3, background: { r: sequence % 255, g: (sequence * 7) % 255, b: (sequence * 13) % 255 } },
  }).png().toBuffer();
  const uploaded = await request(server).post(`/api/files/upload?purpose=${purpose}`).set('Cookie', customer.cookie)
    .attach('file', image, `${name}-${sequence}.png`);
  if (uploaded.status !== 201) throw new Error(`fixture upload failed (${uploaded.status}): ${JSON.stringify(uploaded.body)}`);
  return uploaded.body.data.id as string;
}

async function requestInput(server: any, customer: { cookie: string[] }, service: any, overrides: Record<string, any> = {}) {
  const formData = { ...validForm(service), ...(overrides.formData ?? {}) };
  const documentIds: { fileId: string; title: string; requirementKey: string }[] = [];
  for (const [index, doc] of (service.documents ?? []).entries()) {
    if (!doc.required) continue;
    documentIds.push({ fileId: await uploadRequestFixture(server, customer, `service-doc-${index}`), title: doc.title, requirementKey: doc.key });
  }
  for (const field of (service.form ?? []).filter((item: any) => item.type === 'file' && item.required)) {
    if (!formData[field.key]) formData[field.key] = await uploadRequestFixture(server, customer, `field-${field.key}`);
  }
  const suppliedDocuments = overrides.documentIds ?? [];
  return { ...overrides, serviceId: service.id, formData, documentIds: [...documentIds, ...suppliedDocuments] };
}

async function createStaffWithPermissions(prefix: string, permissions: string[]) {
  const suffix = id('test').slice(-8);
  const roleCode = `${prefix}_${suffix}`;
  const username = `${prefix}_${suffix}`;
  const roleId = id('role');
  const ts = new Date().toISOString();
  await run(
    'INSERT INTO roles (id, code, name, description, is_system, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
    [roleId, roleCode, `Test ${prefix}`, 'test role', JSON.stringify(permissions), ts, ts],
  );
  const admin = await adminSession();
  const server = await app();
  const created = await request(server).post('/api/staff').set('Cookie', admin.cookie).send({
    fullName: `کارمند ${prefix}`,
    mobile: `0912${Math.floor(1000000 + Math.random() * 8999999)}`,
    username,
    password: 'PermissionTest#12345',
    roleCode,
    employeeCode: `T-${Math.floor(Math.random() * 900000 + 100000)}`,
  }).expect(201);
  await run('UPDATE users SET mobile_verified=1 WHERE id=?', [created.body.data.id]);
  return login(username, 'PermissionTest#12345');
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
      .send(await requestInput(server, customer, service));
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
      .send(await requestInput(server, customer, service)).expect(201);
    const invoice = created.body.data.invoices[0];
    await request(server).post('/api/accounting/invoices').set('Cookie', admin.cookie)
      .send({ customerId: created.body.data.customerId, requestId: created.body.data.id, serviceId: service.id,
        title: 'هزینه تکمیلی', items: [{ title: 'هزینه تکمیلی', qty: 1, unitPrice: 10000 }] }).expect(201);
    // Settlement now happens through the verified gateway/wallet flows; the test
    // uses the same service call the gateway callback performs.
    const payment = await createPayment({
      customerId: created.body.data.customerId, invoiceId: invoice.id, amount: invoice.total,
      method: 'online', gateway: 'zarinpal', status: 'pending',
    }, { id: 'system', name: 'test-payments' });
    await confirmPayment(payment.id, { id: 'system', name: 'test-payments' }, 'GW-AGG-1');
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
      .send(await requestInput(server, customer, service, { paymentMethod: 'online' }));

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
    const payload = await requestInput(server, customer, service, { paymentMethod: 'online' });
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
      .send(await requestInput(server, customer, service, { paymentMethod: 'online' })).expect(201);
    expect(created.body.data.assignedTo).toBeFalsy();

    await updateSettings({ 'services.auto_assign': true }, { id: 'system', name: 'test-atomic-assignment' });
    const results = await Promise.all([autoAssign(created.body.data.id), autoAssign(created.body.data.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await one<any>('SELECT assigned_to FROM requests WHERE id = ?', [created.body.data.id]);
    const events = await q<any>("SELECT id FROM request_events WHERE request_id = ? AND type = 'assigned'", [created.body.data.id]);
    expect(row?.assigned_to).toBeTruthy();
    expect(events).toHaveLength(1);
    expect(await one<any>("SELECT id FROM audit_logs WHERE entity_type='request' AND entity_id=? AND action='request.auto_assign'", [created.body.data.id])).toBeTruthy();
  });

  it('audits manual assignment changes and returns an unassigned case to the claimable queue', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const firstStaff = await createStaff('service_expert', { username: 'manual_assign_one', password: 'ManualAssign#12345', fullName: 'کارشناس ارجاع یک' });
    const secondStaff = await createStaff('service_expert', { username: 'manual_assign_two', password: 'ManualAssign#12345', fullName: 'کارشناس ارجاع دو' });
    const firstId = (await request(server).get('/api/auth/me').set('Cookie', firstStaff.cookie)).body.data.id;
    const secondId = (await request(server).get('/api/auth/me').set('Cookie', secondStaff.cookie)).body.data.id;
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;
    await run('UPDATE services SET documents=? WHERE id=?', [JSON.stringify([]), service.id]);
    await updateSettings({ 'services.auto_assign': false }, { id: 'system', name: 'test-manual-assignment' });
    try {
      const noDocumentService = (await request(server).get('/api/public/services/insurance-history')).body.data;
      const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
        .send(await requestInput(server, customer, noDocumentService, { paymentMethod: 'online' })).expect(201);
      const requestId = created.body.data.id;
      expect(created.body.data).toMatchObject({ assignedTo: null, status: 'new' });

      await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie).send({ staffId: firstId })
        .expect(200).expect((res) => expect(res.body.data.assignedTo).toBe(firstId));
      await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie).send({ staffId: secondId })
        .expect(200).expect((res) => expect(res.body.data.assignedTo).toBe(secondId));
      const unassigned = await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie).send({ staffId: null }).expect(200);
      expect(unassigned.body.data).toMatchObject({ assignedTo: null, status: 'new' });

      const audits = await q<any>("SELECT before_data,after_data FROM audit_logs WHERE action='request.assign' AND entity_id=?", [requestId]);
      expect(audits).toHaveLength(3);
      const afters = audits.map((entry) => JSON.parse(entry.after_data));
      expect(afters).toContainEqual({ staffId: firstId, status: 'assigned' });
      expect(afters).toContainEqual({ staffId: secondId, status: 'assigned' });
      expect(afters).toContainEqual({ staffId: null, status: 'new' });
      expect(await q<any>("SELECT id FROM request_events WHERE request_id=? AND type='assigned'", [requestId])).toHaveLength(3);
    } finally {
      await run('UPDATE services SET documents=? WHERE id=?', [JSON.stringify(service.documents), service.id]);
      await updateSettings({ 'services.auto_assign': true }, { id: 'system', name: 'test-manual-assignment' });
    }
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
        .send(await requestInput(server, customer, service, { paymentMethod: 'online' })).expect(201);
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
    expect(await one<any>("SELECT id FROM audit_logs WHERE entity_type='request' AND entity_id=? AND action='request.claim'", [created.body.data.id])).toBeTruthy();
  });

  it('scopes request statistics and outstanding invoice amounts to assigned staff', async () => {
    const customer = await customerSession();
    const server = await app();
    const firstStaff = await createStaff('operator', { username: 'stats_scope_one', password: 'StatsScope#12345', fullName: 'کارمند آمار اول' });
    const secondStaff = await createStaff('operator', { username: 'stats_scope_two', password: 'StatsScope#12345', fullName: 'کارمند آمار دوم' });
    const firstId = (await request(server).get('/api/auth/me').set('Cookie', firstStaff.cookie)).body.data.id;
    const secondId = (await request(server).get('/api/auth/me').set('Cookie', secondStaff.cookie)).body.data.id;
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;

    const firstRequest = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send(await requestInput(server, customer, service)).expect(201);
    const secondRequest = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send(await requestInput(server, customer, service)).expect(201);
    await run('UPDATE requests SET assigned_to=? WHERE id=?', [firstId, firstRequest.body.data.id]);
    await run('UPDATE requests SET assigned_to=? WHERE id=?', [secondId, secondRequest.body.data.id]);

    const firstStats = await request(server).get('/api/requests/stats').set('Cookie', firstStaff.cookie).expect(200);
    const dashboard = await request(server).get('/api/dashboard/summary').set('Cookie', firstStaff.cookie).expect(200);
    expect(firstStats.body.data.total).toBe(1);
    expect(firstStats.body.data.outstandingAmount).toBe(firstRequest.body.data.total);
    expect(dashboard.body.data.stats.total).toBe(1);
    expect(dashboard.body.data.stats.outstandingAmount).toBe(firstRequest.body.data.total);
  });

  it('keeps estimated completion separate from an explicit operational deadline', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const service = (await request(server).get('/api/public/services/insurance-history')).body.data;
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send(await requestInput(server, customer, service)).expect(201);
    const estimated = created.body.data.estimatedCompletionAt;
    expect(estimated).toBeTruthy();
    expect(created.body.data.deadlineAt).toBeNull();

    const deadline = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const updated = await request(server).patch(`/api/requests/${created.body.data.id}/deadline`).set('Cookie', admin.cookie)
      .send({ deadlineAt: deadline }).expect(200);
    expect(updated.body.data.deadlineAt).toBe(deadline);
    expect(updated.body.data.estimatedCompletionAt).toBe(estimated);
    const cleared = await request(server).patch(`/api/requests/${created.body.data.id}/deadline`).set('Cookie', admin.cookie)
      .send({ deadlineAt: null }).expect(200);
    expect(cleared.body.data.deadlineAt).toBeNull();
    expect(cleared.body.data.estimatedCompletionAt).toBe(estimated);
  });

  it('enforces dashboard and request-stat permissions while retaining customer dashboards', async () => {
    const server = await app();
    const dashboardOnly = await createStaffWithPermissions('dashonly', ['dashboard.view']);
    await request(server).get('/api/dashboard/summary').set('Cookie', dashboardOnly.cookie).expect(200);
    await request(server).get('/api/requests/stats').set('Cookie', dashboardOnly.cookie).expect(403);

    const requestsOnly = await createStaffWithPermissions('reqonly', ['requests.view']);
    await request(server).get('/api/requests/stats').set('Cookie', requestsOnly.cookie).expect(200);
    await request(server).get('/api/dashboard/summary').set('Cookie', requestsOnly.cookie).expect(403);

    const customer = await customerSession();
    await request(server).get('/api/dashboard/summary').set('Cookie', customer.cookie).expect(200);
    await request(server).get('/api/requests/stats').set('Cookie', customer.cookie).expect(200);
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
      .send(await requestInput(server, customer, service));
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

  it('keeps online settlement separate from case progress and requires per-document review before completion or replacement', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    await updateSettings({ 'services.auto_assign': false, 'services.require_document_approval': true }, { id: 'system', name: 'test-document-workflow' });
    const serviceResponse = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
      title: 'آزمون چرخه مدرک نقدی', slug: 'request-review-cash-flow', baseFee: 50000, paymentMethods: ['online'],
      form: [], documents: [
        { key: 'identity_front', title: 'روی مدرک هویتی', required: true },
        { key: 'identity_back', title: 'پشت مدرک هویتی', required: true },
      ], workflow: [{ title: 'دریافت' }, { title: 'بررسی' }],
    });
    expect(serviceResponse.status).toBe(201);
    const service = serviceResponse.body.data;
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send(await requestInput(server, customer, service, { paymentMethod: 'online' })).expect(201);
    const requestId = created.body.data.id;
    expect(created.body.data.paymentMethod).toBe('online');
    expect(created.body.data.paymentStatus).toBe('unpaid');
    expect(created.body.data.status).not.toBe('completed');
    expect(created.body.data.invoices).toHaveLength(1);
    expect(Number((await one<any>('SELECT COUNT(*) AS c FROM payments WHERE invoice_id=?', [created.body.data.invoices[0].id]))?.c ?? 0)).toBe(0);

    const documents = created.body.data.documents.filter((document: any) => document.kind === 'customer');
    expect(documents).toHaveLength(2);
    const front = documents.find((document: any) => document.requirementKey === 'identity_front');
    const back = documents.find((document: any) => document.requirementKey === 'identity_back');
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'in_progress' }).expect(200);
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'under_review' }).expect(200);

    const missingReason = await request(server).post(`/api/requests/${requestId}/documents/${back.id}/review`)
      .set('Cookie', admin.cookie).send({ decision: 'rejected' });
    expect(missingReason.status).toBe(400);
    const approvedFront = await request(server).post(`/api/requests/${requestId}/documents/${front.id}/review`)
      .set('Cookie', admin.cookie).send({ decision: 'approved', note: 'هر دو سمت بررسی شد.' }).expect(200);
    expect(approvedFront.body.data.documents.find((document: any) => document.id === front.id).reviewHistory).toHaveLength(1);
    const blockedEarly = await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'ready' });
    expect(blockedEarly.status).toBe(409);
    expect(blockedEarly.body.error.message).toContain('مدارک');

    await request(server).post(`/api/requests/${requestId}/documents/${back.id}/review`)
      .set('Cookie', admin.cookie).send({ decision: 'rejected', note: 'تصویر پشت مدرک تار است.' }).expect(200);
    let customerView = await request(server).get(`/api/requests/${requestId}`).set('Cookie', customer.cookie).expect(200);
    const rejectedBack = customerView.body.data.documents.find((document: any) => document.id === back.id);
    expect(customerView.body.data.status).toBe('waiting_documents');
    expect(rejectedBack.reviewNote).toBe('تصویر پشت مدرک تار است.');
    expect(rejectedBack.reviewHistory[0].decision).toBe('rejected');

    const replacementFile = await uploadRequestFixture(server, customer, 'identity-back-replacement');
    const attached = await request(server).post(`/api/requests/${requestId}/documents`).set('Cookie', customer.cookie)
      .send({ fileId: replacementFile, requirementKey: 'identity_back' }).expect(200);
    const replacement = attached.body.data.documents.find((document: any) => document.file.id === replacementFile);
    expect(replacement.requirementKey).toBe('identity_back');
    expect(replacement.replacesDocumentId).toBe(back.id);
    expect(attached.body.data.status).toBe('under_review');
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'ready' }).expect(409);
    await request(server).post(`/api/requests/${requestId}/documents/${replacement.id}/review`)
      .set('Cookie', admin.cookie).send({ decision: 'approved', note: 'نسخه جایگزین بررسی شد.' }).expect(200);

    customerView = await request(server).get(`/api/requests/${requestId}`).set('Cookie', customer.cookie).expect(200);
    expect(customerView.body.data.documents.find((document: any) => document.id === back.id).status).toBe('rejected');
    expect(customerView.body.data.documents.find((document: any) => document.id === replacement.id).status).toBe('approved');
    expect(customerView.body.data.status).toBe('in_progress');
    const ready = await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'ready' }).expect(200);
    const completed = await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'completed' }).expect(200);
    expect(completed.body.data.status).toBe('completed');
    expect(completed.body.data.paymentStatus).toBe('unpaid');
    expect(completed.body.data.estimatedCompletionAt).toBeTruthy();
    expect(completed.body.data.deadlineAt).toBeNull();
    expect(ready.body.data.status).toBe('ready');
  });

  it('validates required form-file fields and links replacement approval to the same requirement', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const serviceResponse = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
      title: 'خدمت با مدرک فرم', slug: 'form-file-review-lifecycle', baseFee: 65000, paymentMethods: ['online'],
      form: [{ key: 'supporting_file', label: 'مدرک پشتیبان', type: 'file', required: true }], documents: [], workflow: [],
    }).expect(201);
    const service = serviceResponse.body.data;
    const missing = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId: service.id, formData: {}, paymentMethod: 'online' });
    expect(missing.status).toBe(400);

    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send(await requestInput(server, customer, service, { paymentMethod: 'online' })).expect(201);
    const requestId = created.body.data.id;
    const accountant = await createStaff('accountant', { username: 'requests_file_accountant', password: 'Accountant#File123', fullName: 'حسابدار بدون دسترسی مدرک' });
    const restrictedView = await request(server).get(`/api/requests/${requestId}`).set('Cookie', accountant.cookie).expect(200);
    expect(restrictedView.body.data.documents).toEqual([]);
    expect(restrictedView.body.data.formData).not.toHaveProperty('supporting_file');
    const original = created.body.data.documents.find((document: any) => document.requirementKey === 'field:supporting_file');
    expect(original).toBeTruthy();
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'in_progress' }).expect(200);
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'under_review' }).expect(200);
    await request(server).post(`/api/requests/${requestId}/documents/${original.id}/review`).set('Cookie', admin.cookie)
      .send({ decision: 'rejected', note: 'مدرک پشتیبان ناقص است.' }).expect(200);

    const replacementFile = await uploadRequestFixture(server, customer, 'form-field-replacement');
    const replacementResponse = await request(server).post(`/api/requests/${requestId}/documents`).set('Cookie', customer.cookie)
      .send({ fileId: replacementFile, requirementKey: 'field:supporting_file' }).expect(200);
    const replacement = replacementResponse.body.data.documents.find((document: any) => document.file.id === replacementFile);
    expect(replacement.replacesDocumentId).toBe(original.id);
    await request(server).post(`/api/requests/${requestId}/documents/${replacement.id}/review`).set('Cookie', admin.cookie)
      .send({ decision: 'approved', note: 'مدرک کامل شد.' }).expect(200);
    expect((await request(server).get(`/api/requests/${requestId}`).set('Cookie', customer.cookie).expect(200)).body.data.status).toBe('in_progress');
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'ready' }).expect(200);
    const completed = await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie)
      .send({ status: 'completed' }).expect(200);
    expect(completed.body.data.paymentStatus).toBe('unpaid');
  });

  it('uses an approved profile document as a linked replacement for a rejected request requirement', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const serviceResponse = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
      title: 'خدمت با استفاده دوباره از پروفایل', slug: 'profile-reuse-request-replacement', baseFee: 40000,
      paymentMethods: ['online'], form: [], documents: [{ key: 'identity_front', title: 'مدرک هویتی', required: true }], workflow: [],
    }).expect(201);
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send(await requestInput(server, customer, serviceResponse.body.data, { paymentMethod: 'online' })).expect(201);
    const requestId = created.body.data.id;
    const rejected = created.body.data.documents.find((document: any) => document.requirementKey === 'identity_front');
    await request(server).post(`/api/requests/${requestId}/documents/${rejected.id}/review`).set('Cookie', admin.cookie)
      .send({ decision: 'rejected', note: 'تصویر مدرک باید دوباره بررسی شود.' }).expect(200);

    const profileFile = await uploadRequestFixture(server, customer, 'approved-profile-identity', 'profile_document');
    const profileDocument = await request(server).post('/api/documents/mine').set('Cookie', customer.cookie)
      .send({ fileId: profileFile, docType: 'national_card' }).expect(201);
    await request(server).post(`/api/documents/${profileDocument.body.data.id}/review`).set('Cookie', admin.cookie)
      .send({ decision: 'approved', note: 'مدرک پروفایل معتبر است.' }).expect(200);

    const missingKey = await request(server).post(`/api/requests/${requestId}/documents`).set('Cookie', customer.cookie)
      .send({ customerDocumentId: profileDocument.body.data.id, confirmReuse: true });
    expect(missingKey.status).toBe(400);
    const missingKeyAlternate = await request(server).post(`/api/documents/mine/${profileDocument.body.data.id}/reuse`).set('Cookie', customer.cookie)
      .send({ requestId, confirm: true });
    expect(missingKeyAlternate.status).toBe(400);
    await request(server).post(`/api/documents/mine/${profileDocument.body.data.id}/reuse`).set('Cookie', customer.cookie)
      .send({ requestId, confirm: true, requirementKey: 'identity_front' }).expect(200);
    const requestAfterReuse = await request(server).get(`/api/requests/${requestId}`).set('Cookie', customer.cookie).expect(200);
    const replacement = requestAfterReuse.body.data.documents.find((document: any) => document.customerDocumentId === profileDocument.body.data.id);
    expect(replacement.requirementKey).toBe('identity_front');
    expect(replacement.replacesDocumentId).toBe(rejected.id);
    await request(server).post(`/api/requests/${requestId}/documents/${replacement.id}/review`).set('Cookie', admin.cookie)
      .send({ decision: 'approved', note: 'مدرک جایگزین تأیید شد.' }).expect(200);
    expect((await request(server).get(`/api/requests/${requestId}`).set('Cookie', customer.cookie).expect(200)).body.data.status).toBe('in_progress');
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'ready' }).expect(200);
    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'completed' }).expect(200);
  });

  it('records free service as not-required without an invoice or paid status', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
      title: 'خدمت رایگان آزمون', slug: 'free-service-payment-state', baseFee: 0, paymentMethods: [], form: [], documents: [], workflow: [],
    }).expect(201);
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send(await requestInput(server, customer, service.body.data, { paymentMethod: 'online' })).expect(201);
    expect(created.body.data.total).toBe(0);
    expect(created.body.data.paymentMethod).toBe('none');
    expect(created.body.data.paymentStatus).toBe('not_required');
    expect(created.body.data.invoices).toHaveLength(0);
    expect(created.body.data.status).not.toBe('completed');
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
      .send(await requestInput(server, customer, service));
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
      .send(await requestInput(server, customer, service));
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
    const second = await request(server).post('/api/auth/customer/login').send({ identifier: '09127778899', password: 'Other#12345' });
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
      .send(await requestInput(server, customer, service));
    const requestId = created.body.data.id;

    await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie', admin.cookie).send({ status: 'in_progress' }).expect(200);
    expect(await one<any>("SELECT id FROM audit_logs WHERE entity_type='request' AND entity_id=? AND action='request.status'", [requestId])).toBeTruthy();
    const detail = await request(server).get(`/api/requests/${requestId}`).set('Cookie', customer.cookie);
    const types = detail.body.data.events.map((e: any) => e.type);
    expect(types).toContain('created');
    expect(types).toContain('status');
    expect(detail.body.data.events.every((e: any) => typeof e.message === 'string' || e.message === null)).toBe(true);
  });
});
