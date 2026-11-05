import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, customerSession, newCustomer } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let service: any;

const FORM = {
  full_name: 'مشتری آزمایشی',
  mobile: '09121234567',
  topic: 'موضوع آزمایشی',
  consent: true,
};

const SANDBOX_SETTINGS = {
  'accounting.online_payment_enabled': true,
  'accounting.gateway': 'sandbox',
  'accounting.gateway_sandbox': true,
  'wallet.enabled': true,
  'wallet.allow_wallet_payment': true,
  'wallet.min_topup': 10000,
  'wallet.max_topup': 50000000,
  'wallet.max_balance': 200000000,
  'wallet.admin_credit_max': 100000000,
} as const;

function createCode(body: Record<string, unknown>, session = admin) {
  return request(server).post('/api/discount-codes').set('Cookie', session.cookie).send({
    title: 'کد آزمایشی', type: 'percent', value: 10, perCustomerLimit: 5, isActive: true, ...body,
  });
}

async function createRequest(session: any, overrides: Record<string, unknown> = {}) {
  return request(server).post('/api/requests').set('Cookie', session.cookie).send({
    serviceId: service.id,
    formData: FORM,
    paymentMethod: service.paymentMethods?.[0] ?? 'in_person',
    idempotencyKey: `disc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  });
}

describe('discount codes', () => {
  beforeAll(async () => {
    server = await app();
    admin = await adminSession();
    customer = await customerSession();
    await updateSettings(SANDBOX_SETTINGS, { id: 'system', name: 'test-discounts' }, { confirmCritical: true });
    service = (await request(server).get('/api/public/services/consult-general')).body.data;
    expect(service.id).toBeTruthy();
  });

  afterAll(async () => {
    // restore wallet defaults touched by this suite
    await updateSettings({}, { id: 'system', name: 'test-discounts' }, { confirmCritical: true }).catch(() => undefined);
  });

  it('admin can create a code and duplicates/bad formats are rejected', async () => {
    const created = await createCode({ code: 'off10' });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('OFF10');

    const duplicate = await createCode({ code: 'OFF10' });
    expect(duplicate.status).toBe(409);

    const badFormat = await createCode({ code: 'تخفیف' });
    expect([400, 422]).toContain(badFormat.status);

    const badValue = await createCode({ code: 'TOOBIG', value: 150 });
    expect([400, 422]).toContain(badValue.status);
  });

  it('customers cannot manage codes', async () => {
    const create = await createCode({ code: 'HACK1' }, customer);
    expect([401, 403]).toContain(create.status);
    const list = await request(server).get('/api/discount-codes').set('Cookie', customer.cookie);
    expect([401, 403]).toContain(list.status);
  });

  it('preview matches the quote and the invoice on create', async () => {
    const preview = await request(server).post('/api/discount-codes/preview').set('Cookie', customer.cookie)
      .send({ code: 'off10', serviceId: service.id });
    expect(preview.status).toBe(200);
    expect(preview.body.data.amount).toBeGreaterThan(0);

    const quotePlain = await request(server).post('/api/requests/quote').set('Cookie', customer.cookie)
      .send({ serviceId: service.id });
    const quoteWithCode = await request(server).post('/api/requests/quote').set('Cookie', customer.cookie)
      .send({ serviceId: service.id, discountCode: 'OFF10' });
    expect(quoteWithCode.body.data.codeDiscount).toBe(preview.body.data.amount);
    expect(quoteWithCode.body.data.total).toBe(preview.body.data.payableBeforeTax + quoteWithCode.body.data.tax);
    expect(quoteWithCode.body.data.total).toBeLessThan(quotePlain.body.data.total);

    const created = await createRequest(customer, { discountCode: 'OFF10' });
    expect(created.status).toBe(201);
    expect(created.body.data.total).toBe(quoteWithCode.body.data.total);
    expect(created.body.data.invoices[0].total).toBe(quoteWithCode.body.data.total);

    const list = await request(server).get('/api/discount-codes').set('Cookie', admin.cookie);
    const code = list.body.data.find((c: any) => c.code === 'OFF10');
    expect(code.usedCount).toBe(1);

    const usages = await request(server).get(`/api/discount-codes/${code.id}/usages`).set('Cookie', admin.cookie);
    expect(usages.status).toBe(200);
    expect(usages.body.data).toHaveLength(1);
    expect(usages.body.data[0].amount).toBe(quoteWithCode.body.data.codeDiscount);
  });

  it('wallet payment deducts exactly the discounted total', async () => {
    const { session } = await newCustomer('مشتری کیف پول');
    // top-up through the sandbox gateway
    const started = await request(server).post('/api/wallet/my/topup').set('Cookie', session.cookie).send({ amount: 5000000 });
    expect(started.status).toBe(200);
    const url = new URL(started.body.data.paymentUrl, 'http://localhost');
    const paymentId = url.pathname.split('/').pop()!;
    await request(server).post(`/api/payments/sandbox/${paymentId}/finish`).type('form')
      .send({ token: url.searchParams.get('token') ?? '', decision: 'paid' }).expect((res) => {
        if (![200, 302, 303].includes(res.status)) throw new Error(`sandbox finish ${res.status}`);
      });

    const before = (await request(server).get('/api/wallet/my').set('Cookie', session.cookie)).body.data.balance;
    expect(before).toBeGreaterThan(0);

    const created = await createRequest(session, { paymentMethod: 'wallet', discountCode: 'OFF10' });
    expect(created.status).toBe(201);

    const after = (await request(server).get('/api/wallet/my').set('Cookie', session.cookie)).body.data.balance;
    expect(before - after).toBe(created.body.data.total);
  });

  it('enforces per-customer and total usage limits atomically', async () => {
    await createCode({ code: 'ONCE-PER', perCustomerLimit: 1 }).expect(201);
    const first = await createRequest(customer, { discountCode: 'ONCE-PER' });
    expect(first.status).toBe(201);
    const second = await createRequest(customer, { discountCode: 'ONCE-PER' });
    expect(second.status).toBe(400);

    await createCode({ code: 'ONLY-ONE', usageLimit: 1, perCustomerLimit: 5 }).expect(201);
    const a = await createRequest(customer, { discountCode: 'ONLY-ONE' });
    expect(a.status).toBe(201);
    const { session: other } = await newCustomer('مشتری دیگر');
    const b = await createRequest(other, { discountCode: 'ONLY-ONE' });
    expect(b.status).toBe(400);
    // no request was created for the rejected attempt
    const mine = await request(server).get('/api/requests?pageSize=50').set('Cookie', other.cookie);
    expect(mine.body.meta.total).toBe(0);
  });

  it('rejects expired/inactive/too-expensive codes without consuming them', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    await createCode({ code: 'EXPIRED1', startsAt: twoDaysAgo, expiresAt: yesterday }).expect(201);
    const expired = await request(server).post('/api/discount-codes/preview').set('Cookie', customer.cookie)
      .send({ code: 'EXPIRED1', serviceId: service.id });
    expect(expired.status).toBe(400);

    await createCode({ code: 'FUTURE1', startsAt: tomorrow }).expect(201);
    const future = await request(server).post('/api/discount-codes/preview').set('Cookie', customer.cookie)
      .send({ code: 'FUTURE1', serviceId: service.id });
    expect(future.status).toBe(400);

    await createCode({ code: 'DISABLED1', isActive: false }).expect(201);
    const disabled = await request(server).post('/api/discount-codes/preview').set('Cookie', customer.cookie)
      .send({ code: 'DISABLED1', serviceId: service.id });
    expect(disabled.status).toBe(400);

    await createCode({ code: 'BIGMIN1', minAmount: 999999999 }).expect(201);
    const rejected = await createRequest(customer, { discountCode: 'BIGMIN1' });
    expect(rejected.status).toBe(400);
    const list = await request(server).get('/api/discount-codes').set('Cookie', admin.cookie);
    expect(list.body.data.find((c: any) => c.code === 'BIGMIN1').usedCount).toBe(0);
  });

  it('unknown codes get a friendly error and used codes deactivate instead of deleting', async () => {
    const unknown = await request(server).post('/api/discount-codes/preview').set('Cookie', customer.cookie)
      .send({ code: 'NOPE404', serviceId: service.id });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toContain('معتبر نیست');

    const list = await request(server).get('/api/discount-codes').set('Cookie', admin.cookie);
    const used = list.body.data.find((c: any) => c.code === 'OFF10');
    const removed = await request(server).delete(`/api/discount-codes/${used.id}`).set('Cookie', admin.cookie);
    expect(removed.status).toBe(200);
    expect(removed.body.data.deactivated).toBe(true);

    const after = await request(server).get('/api/discount-codes').set('Cookie', admin.cookie);
    const stillThere = after.body.data.find((c: any) => c.code === 'OFF10');
    expect(stillThere).toBeTruthy();
    expect(stillThere.isActive).toBe(false);
  });
  it('lists only disclosed and assigned codes and enforces assignments at preview', async () => {
    const alice = await newCustomer('آلیس');
    const bob = await newCustomer('باب');
    const assigned = await createCode({ code: 'PERSONALX', audience: 'assigned', value: 10 });
    expect(assigned.status).toBe(201);
    await createCode({ code: 'SECRETXX', audience: 'code', value: 10 }).expect(201);
    await createCode({ code: 'EVERYONEX', audience: 'all', value: 10, serviceId: service.id }).expect(201);
    const denied = await request(server).post('/api/discount-codes/preview').set('Cookie', bob.session.cookie).send({ code: 'PERSONALX', serviceId: service.id });
    expect(denied.status).toBe(400);
    await request(server).post(`/api/discount-codes/${assigned.body.data.id}/assignments`).set('Cookie', alice.session.cookie).send({ customerId: alice.id }).expect(403);
    await request(server).post(`/api/discount-codes/${assigned.body.data.id}/assignments`).set('Cookie', admin.cookie).send({ customerId: alice.id }).expect(200);
    const a = await request(server).get('/api/discount-codes/mine').set('Cookie', alice.session.cookie).expect(200);
    const b = await request(server).get('/api/discount-codes/mine').set('Cookie', bob.session.cookie).expect(200);
    expect(a.body.data.map((x: any) => x.code)).toContain('PERSONALX');
    expect(a.body.data.map((x: any) => x.code)).toContain('EVERYONEX');
    expect(a.body.data.find((x: any) => x.code === 'EVERYONEX').serviceTitle).toBe(service.title);
    expect(a.body.data.map((x: any) => x.code)).not.toContain('SECRETXX');
    expect(b.body.data.map((x: any) => x.code)).not.toContain('PERSONALX');
    await request(server).post('/api/discount-codes/preview').set('Cookie', alice.session.cookie).send({ code: 'PERSONALX', serviceId: service.id }).expect(200);
  });

  it('reserves the first-purchase campaign once across competing codes', async () => {
    const newcomer = await newCustomer('تازه وارد');
    await createCode({ code: 'FIRSTONE', audience: 'first_purchase' }).expect(201);
    await createCode({ code: 'FIRSTTWO', audience: 'first_purchase' }).expect(201);
    const responses = await Promise.all([
      createRequest(newcomer.session, { discountCode: 'FIRSTONE' }),
      createRequest(newcomer.session, { discountCode: 'FIRSTTWO' }),
    ]);
    expect(responses.filter(r => r.status === 201)).toHaveLength(1);
    expect(responses.filter(r => r.status !== 201)).toHaveLength(1);
    const mine = await request(server).get('/api/discount-codes/mine').set('Cookie', newcomer.session.cookie).expect(200);
    expect(mine.body.data.filter((x: any) => x.audience === 'first_purchase').every((x: any) => !x.usable)).toBe(true);
    const used = responses.find(r => r.status === 201)!.body.data;
    expect(used.invoices[0].total).toBe(used.total);
    expect(used.discount).toBeGreaterThan(0);
  });

});
