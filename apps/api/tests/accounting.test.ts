import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ACCOUNTANT, adminSession, app, createStaff, customerSession } from './helpers.js';

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

  it('registers an in-person payment and settles the invoice', async () => {
    const admin = await adminSession();
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    const server = await app();

    const payment = await request(server)
      .post('/api/accounting/payments')
      .set('Cookie', admin.cookie)
      .send({ customerId, invoiceId: invoice.id, amount: 500000, method: 'cash', reference: 'REC-1' });
    expect(payment.status).toBe(201);
    expect(payment.body.data.status).toBe('confirmed');

    const refreshed = await request(server).get(`/api/accounting/invoices/${invoice.id}`).set('Cookie', admin.cookie);
    expect(refreshed.body.data.status).toBe('paid');
    expect(refreshed.body.data.paidAmount).toBe(500000);
    expect(refreshed.body.data.remaining).toBe(0);
  });

  it('rejects overpayment of an invoice', async () => {
    const admin = await adminSession();
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    const server = await app();
    const res = await request(server)
      .post('/api/accounting/payments')
      .set('Cookie', admin.cookie)
      .send({ customerId, invoiceId: invoice.id, amount: 900000, method: 'cash' });
    expect(res.status).toBe(400);
  });

  it('keeps online revenue pending and rejects manual bypass of gateway verification', async () => {
    const admin = await adminSession();
    const { invoice, customerId } = await createInvoiceForCustomer(admin);
    const server = await app();

    const before = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    const revenueBefore = before.body.data.summary.revenue;

    const payment = await request(server)
      .post('/api/accounting/payments')
      .set('Cookie', admin.cookie)
      .send({ customerId, invoiceId: invoice.id, amount: 500000, method: 'online', gateway: 'mock' });
    expect(payment.body.data.status).toBe('pending');

    const mid = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    expect(mid.body.data.summary.revenue).toBe(revenueBefore);

    const confirmed = await request(server)
      .post(`/api/accounting/payments/${payment.body.data.id}/confirm`)
      .set('Cookie', admin.cookie)
      .send({ reference: 'GW-123' });
    expect(confirmed.status).toBe(403);

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
    const payment = await request(server)
      .post('/api/accounting/payments')
      .set('Cookie', admin.cookie)
      .send({ customerId, invoiceId: invoice.id, amount: 500000, method: 'cash' });

    const refund = await request(server)
      .post(`/api/accounting/payments/${payment.body.data.id}/refund`)
      .set('Cookie', admin.cookie)
      .send({ reason: 'انصراف مشتری' });
    expect(refund.status).toBe(200);

    const refreshed = await request(server).get(`/api/accounting/invoices/${invoice.id}`).set('Cookie', admin.cookie);
    expect(refreshed.body.data.status).toBe('issued');
    expect(refreshed.body.data.paidAmount).toBe(0);
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
