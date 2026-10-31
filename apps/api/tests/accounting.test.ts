import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ACCOUNTANT, adminSession, app, createStaff, customerSession } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { q } from '../src/db/index.js';
import { confirmPayment, createPayment } from '../src/modules/accounting/service.js';

async function createInvoiceForCustomer(admin: any) {
  const server = await app();
  const customer = await customerSession();
  const me = await request(server).get('/api/auth/me').set('Cookie', customer.cookie);
  const invoice = await request(server)
    .post('/api/accounting/invoices')
    .set('Cookie', admin.cookie)
    .send({
      customerId: me.body.data.id,
      title: 'فاکتور تست',
      items: [{ title: 'خدمت تست', qty: 1, unitPrice: 500000 }],
    });
  return { invoice: invoice.body.data, customerCookie: customer.cookie, customerId: me.body.data.id };
}

describe('accounting', () => {
  it('creates an invoice with server-side totals', async () => {
    const admin = await adminSession();
    const { invoice } = await createInvoiceForCustomer(admin);
    expect(invoice.number).toMatch(/^INV-/);
    expect(invoice.subtotal).toBe(500000);
    expect(invoice.total).toBe(500000);
    expect(invoice.status).toBe('issued');
  });

  it('retires manual payment registration and only settles through verified flows', async () => {
    const admin = await adminSession();
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    const server = await app();
    const actor = { id: 'system', name: 'test-accounting' };

    // The retired endpoints must not create revenue from a staff-entered amount.
    const cash = await request(server)
      .post('/api/accounting/payments')
      .set('Cookie', admin.cookie)
      .send({ customerId, invoiceId: invoice.id, amount: 500000, method: 'cash', reference: 'REC-1' });
    expect(cash.status).toBe(400);
    expect(cash.body.error.message).toContain('حذف');

    const policy = await request(server).get('/api/accounting/payment-policy').set('Cookie', admin.cookie).expect(200);
    expect(policy.body.data.allowedMethods).toEqual(['online', 'wallet']);
    expect(policy.body.data.retiredMethods).toContain('cash');

    // A verified gateway payment (created by the provider flow in production)
    // still settles the invoice and the ledger exactly once.
    const payment = await createPayment({
      customerId, invoiceId: invoice.id, amount: 500000, method: 'online', gateway: 'zarinpal', status: 'pending',
    }, actor);
    await confirmPayment(payment.id, actor, 'GW-REF-1');

    const refreshed = await request(server).get(`/api/accounting/invoices/${invoice.id}`).set('Cookie', admin.cookie);
    expect(refreshed.body.data.status).toBe('paid');
    expect(refreshed.body.data.paidAmount).toBe(500000);
    expect(refreshed.body.data.remaining).toBe(0);
  });

  it('rejects overpayment of an invoice', async () => {
    const admin = await adminSession();
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    const actor = { id: 'system', name: 'test-accounting' };
    await expect(createPayment({
      customerId, invoiceId: invoice.id, amount: 900000, method: 'online', status: 'pending',
    }, actor)).rejects.toThrow();
  });

  it('keeps online revenue pending and rejects manual bypass of gateway verification', async () => {
    const admin = await adminSession();
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    const server = await app();
    const actor = { id: 'system', name: 'test-accounting' };

    const before = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    const revenueBefore = before.body.data.summary.revenue;

    const payment = await createPayment({
      customerId, invoiceId: invoice.id, amount: 500000, method: 'online', gateway: 'zarinpal', status: 'pending',
    }, actor);
    const mid = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    expect(mid.body.data.summary.revenue).toBe(revenueBefore);

    // There is no endpoint that confirms a gateway payment by hand any more.
    const confirmed = await request(server)
      .post(`/api/accounting/payments/${payment.id}/confirm`)
      .set('Cookie', admin.cookie)
      .send({ reference: 'GW-123' });
    expect(confirmed.status).toBe(400);

    const after = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    expect(after.body.data.summary.revenue).toBe(revenueBefore);
  });

  it('records an expense and lowers the operating profit', async () => {
    const admin = await adminSession();
    const server = await app();
    const before = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    const profitBefore = before.body.data.summary.operatingProfit;

    await request(server)
      .post('/api/accounting/expenses')
      .set('Cookie', admin.cookie)
      .send({ title: 'هزینه تست', amount: 100000, method: 'cash' })
      .expect(201);

    const after = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    expect(after.body.data.summary.operatingProfit).toBe(profitBefore - 100000);
    expect(after.body.data.summary.expenses).toBeGreaterThanOrEqual(100000);
  });

  it('allows a refund and restores the invoice balance', async () => {
    const admin = await adminSession();
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    const server = await app();
    const actor = { id: 'system', name: 'test-accounting' };
    const payment = await createPayment({
      customerId, invoiceId: invoice.id, amount: 500000, method: 'online', gateway: 'zarinpal', status: 'confirmed',
    }, actor);

    const refund = await request(server)
      .post(`/api/accounting/payments/${payment.id}/refund`)
      .set('Cookie', admin.cookie)
      .send({ reason: 'انصراف مشتری' });
    expect(refund.status).toBe(200);

    const refreshed = await request(server).get(`/api/accounting/invoices/${invoice.id}`).set('Cookie', admin.cookie);
    expect(refreshed.body.data.status).toBe('issued');
    expect(refreshed.body.data.paidAmount).toBe(0);
  });

  it('requires pending or confirmed invoice payments to be resolved before voiding', async () => {
    const admin = await adminSession();
    const server = await app();
    const actor = { id: 'system', name: 'test-accounting' };
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    await createPayment({ customerId, invoiceId: invoice.id, amount: 100000, method: 'online', gateway: 'zarinpal', status: 'pending' }, actor);
    await request(server).post(`/api/accounting/invoices/${invoice.id}/void`).set('Cookie', admin.cookie)
      .send({ reason: 'لغو درخواست' }).expect(409);

    const invoice2 = await createInvoiceForCustomer(admin);
    const payment = await createPayment({
      customerId: invoice2.customerId, invoiceId: invoice2.invoice.id, amount: invoice2.invoice.total,
      method: 'online', gateway: 'zarinpal', status: 'confirmed',
    }, actor);
    await request(server).post(`/api/accounting/invoices/${invoice2.invoice.id}/void`).set('Cookie', admin.cookie)
      .send({ reason: 'لغو درخواست' }).expect(409);
    await request(server).post(`/api/accounting/payments/${payment.id}/refund`).set('Cookie', admin.cookie)
      .send({ reason: 'لغو درخواست مشتری' }).expect(200);
    await request(server).post(`/api/accounting/invoices/${invoice2.invoice.id}/void`).set('Cookie', admin.cookie)
      .send({ reason: 'پس از بازپرداخت' }).expect(200);
    const refreshed = await request(server).get(`/api/accounting/invoices/${invoice2.invoice.id}`).set('Cookie', admin.cookie);
    expect(refreshed.body.data.status).toBe('void');
  });

  it('posts balanced reversal entries when an unpaid accrual invoice is voided', async () => {
    await updateSettings({ 'accounting.revenue_recognition': 'on_invoice' }, { id: 'system', name: 'test-accrual' });
    try {
      const admin = await adminSession();
      const server = await app();
      const { invoice } = await createInvoiceForCustomer(admin);
      await request(server).post(`/api/accounting/invoices/${invoice.id}/void`).set('Cookie', admin.cookie)
        .send({ reason: 'اصلاح فاکتور' }).expect(200);
      const entries = await q<any>("SELECT direction, SUM(amount) AS total FROM ledger_entries WHERE ref_id=? AND ref_type IN ('invoice','invoice-void') GROUP BY direction", [invoice.id]);
      expect(entries).toHaveLength(2);
      expect(Number(entries.find((entry) => entry.direction === 'debit')?.total)).toBe(1000000);
      expect(Number(entries.find((entry) => entry.direction === 'credit')?.total)).toBe(1000000);
    } finally {
      await updateSettings({ 'accounting.revenue_recognition': 'on_payment' }, { id: 'system', name: 'test-cleanup' });
    }
  });

  it('completes an online Zarinpal Sandbox callback without completing the request', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const merchantId = '12345678-1234-1234-1234-123456789abc';
    const originalFetch = globalThis.fetch;
    const calls: { url: string; payload: any }[] = [];
    const authority = `A${'1'.repeat(20)}`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ url, payload });
      const data = url.endsWith('/request.json')
        ? { code: 100, authority }
        : url.endsWith('/verify.json') ? { code: 100, ref_id: 987654321 } : null;
      if (!data) throw new Error(`Unexpected gateway URL: ${url}`);
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    try {
      await updateSettings({
        'accounting.online_payment_enabled': true,
        'accounting.gateway': 'zarinpal',
        'accounting.gateway_sandbox': true,
        'accounting.gateway_merchant_id': merchantId,
      }, { id: 'system', name: 'test-zarinpal-sandbox' }, { confirmCritical: true });
      const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
        title: 'خدمت پرداخت Sandbox', slug: 'zarinpal-sandbox-request', baseFee: 50000,
        paymentMethods: ['online'], form: [], documents: [], workflow: [],
      }).expect(201);
      const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
        .send({ serviceId: service.body.data.id, formData: {}, paymentMethod: 'online' }).expect(201);
      const statusBeforePayment = created.body.data.status;
      const invoice = created.body.data.invoices[0];
      expect(created.body.data.paymentStatus).toBe('unpaid');
      expect(invoice).toBeTruthy();

      const started = await request(server).post(`/api/accounting/my/invoices/${invoice.id}/pay`)
        .set('Cookie', customer.cookie).expect(200);
      expect(started.body.data.paymentUrl).toContain('https://sandbox.zarinpal.com/pg/StartPay/');
      expect(calls[0].url).toBe('https://sandbox.zarinpal.com/pg/v4/payment/request.json');
      expect(calls[0].payload).toMatchObject({ merchant_id: merchantId, amount: 50000, currency: 'IRR' });
      expect(calls[0].payload.callback_url).toContain(started.body.data.paymentId);

      const callback = await request(server).get('/api/accounting/gateway/zarinpal')
        .query({ paymentId: started.body.data.paymentId, Authority: authority, Status: 'OK' }).expect(303);
      expect(callback.headers.location).toContain('payment=confirmed');
      expect(calls[1].url).toBe('https://sandbox.zarinpal.com/pg/v4/payment/verify.json');
      expect(calls[1].payload).toMatchObject({ merchant_id: merchantId, amount: 50000, authority });

      const paidRequest = await request(server).get(`/api/requests/${created.body.data.id}`).set('Cookie', customer.cookie).expect(200);
      expect(paidRequest.body.data.paymentStatus).toBe('paid');
      expect(paidRequest.body.data.status).toBe(statusBeforePayment);
    } finally {
      globalThis.fetch = originalFetch;
      await updateSettings({
        'accounting.online_payment_enabled': false,
        'accounting.gateway': 'none',
        'accounting.gateway_sandbox': true,
        'accounting.gateway_merchant_id': '',
      }, { id: 'system', name: 'test-zarinpal-sandbox-cleanup' }, { confirmCritical: true });
    }
  });

  it('enforces financial permissions for non-accountants', async () => {
    const server = await app();
    const accountant = await createStaff('accountant', ACCOUNTANT);
    const invoices = await request(server).get('/api/accounting/invoices').set('Cookie', accountant.cookie);
    expect(invoices.status).toBe(200);
    // an accountant must not reach system settings
    const settings = await request(server).get('/api/settings/admin').set('Cookie', accountant.cookie);
    expect(settings.status).toBe(403);
  });

  it('exports reports as CSV', async () => {
    const admin = await adminSession();
    const server = await app();
    const res = await request(server).get('/api/accounting/reports/export?type=payments').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });
});
