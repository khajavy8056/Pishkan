import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, customerSession, createStaff } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { one, q } from '../src/db/index.js';

const SANDBOX = {
  'accounting.online_payment_enabled': true,
  'accounting.gateway': 'sandbox',
  'accounting.gateway_sandbox': true,
  'accounting.min_online_payment': 1000,
  'wallet.enabled': true,
  'wallet.allow_wallet_payment': true,
} as const;

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let customerId: string;
let serviceId: string;

async function sandboxSettings(extra: Record<string, unknown> = {}) {
  await updateSettings({ ...SANDBOX, ...extra } as any, { id: 'system', name: 'payments-test-setup' }, { confirmCritical: true });
}

async function createOnlineRequest(amount = 45000) {
  const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title: `خدمت پرداخت آنلاین ${amount}`, slug: `online-${amount}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    baseFee: amount, paymentMethods: ['online'], form: [], documents: [], workflow: [],
  }).expect(201);
  const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
    .send({ serviceId: service.body.data.id, formData: {}, paymentMethod: 'online' }).expect(201);
  return {
    serviceId: service.body.data.id as string,
    request: created.body.data,
    invoiceId: created.body.data.invoices[0].id as string,
  };
}

async function startPayment(invoiceId: string) {
  const res = await request(server).post(`/api/accounting/my/invoices/${invoiceId}/pay`).set('Cookie', customer.cookie);
  expect(res.status).toBe(200);
  return res.body.data as { paymentId: string; paymentUrl: string; provider: string; sandbox: boolean };
}

function tokenOf(paymentUrl: string) {
  return new URL(paymentUrl, 'http://localhost').searchParams.get('token') ?? '';
}

async function finish(paymentUrl: string, decision: 'paid' | 'cancelled' = 'paid') {
  const id = new URL(paymentUrl, 'http://localhost').pathname.split('/').pop()!;
  return request(server).post(`/api/payments/sandbox/${id}/finish`)
    .type('form').send({ token: tokenOf(paymentUrl), decision });
}

async function ledgerFor(paymentId: string) {
  return q<any>('SELECT * FROM ledger_entries WHERE ref_id=?', [paymentId]);
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  await sandboxSettings();
  const svc = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title: 'خدمت پایهٔ پرداخت آنلاین', slug: `online-base-${Date.now()}`, baseFee: 45000,
    paymentMethods: ['online'], form: [], documents: [], workflow: [],
  }).expect(201);
  serviceId = svc.body.data.id;
});

afterAll(async () => {
  await updateSettings({
    'accounting.online_payment_enabled': false,
    'accounting.gateway': 'none',
    'accounting.gateway_sandbox': true,
  } as any, { id: 'system', name: 'payments-test-cleanup' }, { confirmCritical: true });
});

describe('online gateway payments', () => {
  it('offers only online and wallet methods to the customer UI', async () => {
    const policy = await request(server).get('/api/accounting/payment-policy').set('Cookie', customer.cookie).expect(200);
    expect(policy.body.data.allowedMethods).toEqual(['online', 'wallet']);
    expect(policy.body.data.retiredMethods).toEqual(expect.arrayContaining(['cash', 'pos', 'transfer']));

    const rejected = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId, formData: {}, paymentMethod: 'cash' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toContain('حذف');
    const pos = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId, formData: {}, paymentMethod: 'pos' });
    expect(pos.status).toBe(400);
    const transfer = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId, formData: {}, paymentMethod: 'transfer' });
    expect(transfer.status).toBe(400);
  });

  it('starts a payment, verifies it server-side and marks the invoice paid', async () => {
    const { request: created, invoiceId } = await createOnlineRequest();
    expect(created.paymentStatus).toBe('unpaid');
    const started = await startPayment(invoiceId);
    expect(started.sandbox).toBe(true);
    expect(started.provider).toBe('sandbox');
    expect(started.paymentUrl).toContain('/api/payments/sandbox/');
    // The browser only ever receives a redirect URL, never a gateway secret.
    expect(JSON.stringify(started)).not.toMatch(/merchant|secret|password/i);

    const page = await request(server).get(started.paymentUrl);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('شبیه‌ساز درگاه');

    const finished = await finish(started.paymentUrl);
    expect(finished.status).toBe(303);
    expect(finished.headers.location).toContain('payment=confirmed');

    const payment = await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId]);
    expect(payment.status).toBe('confirmed');
    expect(payment.purpose).toBe('invoice');
    expect(payment.request_id).toBe(created.id);
    expect(payment.provider_reference).toMatch(/^SBX-/);
    expect(payment.paid_at).toBeTruthy();

    const invoice = await request(server).get(`/api/accounting/invoices/${invoiceId}`).set('Cookie', admin.cookie).expect(200);
    expect(invoice.body.data.status).toBe('paid');
    expect(invoice.body.data.remaining).toBe(0);

    const after = await request(server).get(`/api/requests/${created.id}`).set('Cookie', admin.cookie).expect(200);
    expect(after.body.data.paymentStatus).toBe('paid');

    const ledger = await ledgerFor(started.paymentId);
    expect(ledger.length).toBeGreaterThanOrEqual(2);
    const debit = ledger.reduce((sum, row) => sum + (row.direction === 'debit' ? Number(row.amount) : 0), 0);
    const credit = ledger.reduce((sum, row) => sum + (row.direction === 'credit' ? Number(row.amount) : 0), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(45000);

    const callbacks = await request(server).get(`/api/payments/admin/callbacks?paymentId=${started.paymentId}`)
      .set('Cookie', admin.cookie).expect(200);
    expect(callbacks.body.data.map((row: any) => row.event)).toEqual(expect.arrayContaining(['start', 'verify']));
    expect(callbacks.body.data.some((row: any) => row.status === 'accepted')).toBe(true);
  });

  it('ignores duplicate and replayed callbacks without double-charging', async () => {
    const { invoiceId } = await createOnlineRequest(60000);
    const started = await startPayment(invoiceId);
    await finish(started.paymentUrl);

    const paymentAfter = await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId]);
    const ledgerCount = (await ledgerFor(started.paymentId)).length;
    const invoice = await request(server).get(`/api/accounting/invoices/${invoiceId}`).set('Cookie', admin.cookie);
    const paid = invoice.body.data.paidAmount;

    for (let i = 0; i < 3; i += 1) {
      const replay = await finish(started.paymentUrl);
      expect(replay.status).toBe(303);
      expect(replay.headers.location).toContain('payment=confirmed');
    }
    expect((await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId])).status).toBe(paymentAfter.status);
    expect((await ledgerFor(started.paymentId)).length).toBe(ledgerCount);
    const refreshed = await request(server).get(`/api/accounting/invoices/${invoiceId}`).set('Cookie', admin.cookie);
    expect(refreshed.body.data.paidAmount).toBe(paid);

    const callbacks = await q<any>("SELECT * FROM payment_callbacks WHERE payment_id=? AND status='duplicate'", [started.paymentId]);
    expect(callbacks.length).toBeGreaterThanOrEqual(3);
    const duplicateLogs = await q<any>("SELECT * FROM system_logs WHERE action='payment.callback.duplicate' AND entity_id=?", [started.paymentId]);
    expect(duplicateLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a forged or unsigned callback from confirming or failing the payment', async () => {
    const { invoiceId } = await createOnlineRequest(23000);
    const started = await startPayment(invoiceId);

    // A browser-only "success" redirect proves nothing: no signed token.
    const forged = await request(server).get(`/api/payments/callback/sandbox?paymentId=${started.paymentId}&status=OK&Authority=forged`);
    expect(forged.status).toBe(303);
    expect(forged.headers.location).toContain('payment=failed');
    expect((await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId])).status).toBe('pending');

    const badToken = await request(server).post(`/api/payments/sandbox/${started.paymentId}/finish`)
      .type('form').send({ token: 'x'.repeat(40), decision: 'paid' });
    expect(badToken.status).toBe(403);
    expect((await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId])).status).toBe('pending');

    const invoice = await request(server).get(`/api/accounting/invoices/${invoiceId}`).set('Cookie', admin.cookie);
    expect(invoice.body.data.status).toBe('issued');
    expect(await ledgerFor(started.paymentId)).toHaveLength(0);

    const security = await q<any>("SELECT * FROM system_logs WHERE level='SECURITY' AND action='payment.callback.invalid' AND entity_id=?", [started.paymentId]);
    expect(security.length).toBeGreaterThanOrEqual(1);
    const rejected = await q<any>("SELECT * FROM payment_callbacks WHERE payment_id=? AND status='rejected'", [started.paymentId]);
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    // The genuine attempt still works afterwards.
    const finished = await finish(started.paymentUrl);
    expect(finished.status).toBe(303);
    expect((await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId])).status).toBe('confirmed');
  });

  it('marks a cancelled checkout as failed with no invoice or ledger effect', async () => {
    const { request: created, invoiceId } = await createOnlineRequest(31000);
    const started = await startPayment(invoiceId);
    const cancelled = await finish(started.paymentUrl, 'cancelled');
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.location).toContain('payment=failed');

    const payment = await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId]);
    expect(payment.status).toBe('failed');
    expect(payment.paid_at).toBeNull();
    expect(await ledgerFor(started.paymentId)).toHaveLength(0);

    const invoice = await request(server).get(`/api/accounting/invoices/${invoiceId}`).set('Cookie', admin.cookie);
    expect(invoice.body.data.status).toBe('issued');
    expect(invoice.body.data.paidAmount).toBe(0);

    const refreshed = await request(server).get(`/api/requests/${created.id}`).set('Cookie', admin.cookie);
    expect(refreshed.body.data.paymentStatus).toBe('unpaid');
  });

  it('resumes the same pending payment instead of stacking reservations', async () => {
    const { invoiceId } = await createOnlineRequest(77000);
    const first = await startPayment(invoiceId);
    const second = await startPayment(invoiceId);
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.reused).toBe(true);
    const reserved = await one<any>("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id=? AND status='pending'", [invoiceId]);
    expect(Number(reserved.total)).toBe(77000);
  });

  it('refuses to start a payment when the gateway is disabled or unconfigured', async () => {
    const { invoiceId } = await createOnlineRequest(5000);
    await sandboxSettings({ 'accounting.online_payment_enabled': false });
    const disabled = await request(server).post(`/api/accounting/my/invoices/${invoiceId}/pay`).set('Cookie', customer.cookie);
    expect(disabled.status).toBe(400);
    expect(disabled.body.error.message).toContain('فعال نیست');

    await sandboxSettings({ 'accounting.gateway': 'none' });
    const unconfigured = await request(server).post(`/api/accounting/my/invoices/${invoiceId}/pay`).set('Cookie', customer.cookie);
    expect(unconfigured.status).toBe(400);
    await sandboxSettings();
  });

  it('reports gateway health without ever exposing credentials', async () => {
    const diagnostics = await request(server).get('/api/payments/admin/diagnostics').set('Cookie', admin.cookie).expect(200);
    expect(diagnostics.body.data.configured).toBe(true);
    expect(diagnostics.body.data.providerLabel).toContain('شبیه‌ساز');
    expect(diagnostics.body.data.secretsExposed).toBe(false);
    expect(JSON.stringify(diagnostics.body.data)).not.toMatch(/merchant|api[_-]?key|password|private[_-]?key/i);
    expect(diagnostics.body.data).not.toHaveProperty('merchantId');
    expect(diagnostics.body.data).not.toHaveProperty('accessToken');

    const accountant = await createStaff('accountant', { username: `gw_acc_${Date.now() % 100000}`, password: 'Accountant#12345', fullName: 'حسابدار درگاه' });
    await request(server).get('/api/payments/admin/diagnostics').set('Cookie', accountant.cookie).expect(200);
    const expert = await createStaff('service_expert', { username: `gw_exp_${Date.now() % 100000}`, password: 'Expert#12345', fullName: 'کارشناس درگاه' });
    await request(server).get('/api/payments/admin/diagnostics').set('Cookie', expert.cookie).expect(403);
  });

  it('stores the Zarinpal merchant id as a masked secret and never logs it', async () => {
    const merchant = '12345678-1234-1234-1234-123456789abc';
    await sandboxSettings({ 'accounting.gateway': 'zarinpal', 'accounting.gateway_merchant_id': merchant });
    const settings = await request(server).get('/api/settings/admin').set('Cookie', admin.cookie).expect(200);
    expect(JSON.stringify(settings.body.data)).not.toContain(merchant);

    const diagnostics = await request(server).get('/api/payments/admin/diagnostics').set('Cookie', admin.cookie).expect(200);
    expect(diagnostics.body.data.code).toBe('zarinpal');
    expect(diagnostics.body.data.configured).toBe(true);
    expect(JSON.stringify(diagnostics.body.data)).not.toContain(merchant);

    const logs = await q<any>('SELECT * FROM system_logs WHERE message LIKE ? OR details LIKE ?', [`%${merchant}%`, `%${merchant}%`]);
    expect(logs).toHaveLength(0);
    const audits = await q<any>('SELECT * FROM audit_logs WHERE after_data LIKE ?', [`%${merchant}%`]);
    expect(audits).toHaveLength(0);
    await sandboxSettings({ 'accounting.gateway_merchant_id': '' });
  });

  it('blocks customers from operator payment endpoints', async () => {
    await request(server).get('/api/payments/admin/callbacks').set('Cookie', customer.cookie).expect(403);
    await request(server).get('/api/payments/admin/diagnostics').set('Cookie', customer.cookie).expect(403);
    await request(server).post('/api/payments/admin/pay_1/cancel').set('Cookie', customer.cookie).send({ reason: 'تلاش مشتری' }).expect(403);
    // A customer can only read its own payment status.
    await request(server).get('/api/payments/my/pay_missing').set('Cookie', customer.cookie).expect(404);
  });
});
