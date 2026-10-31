import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession, EXPERT, newCustomer } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { one, q } from '../src/db/index.js';

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
};

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let customerId: string;
let otherCustomer: any;
let otherCustomerId: string;

function tokenFrom(url: string) {
  return new URL(url, 'http://localhost').searchParams.get('token') ?? '';
}

async function topUp(session: any, amount: number) {
  const started = await request(server).post('/api/wallet/my/topup').set('Cookie', session.cookie).send({ amount });
  expect(started.status).toBe(200);
  return started.body.data;
}

async function completeSandbox(paymentUrl: string, decision: 'paid' | 'cancelled' = 'paid') {
  const url = new URL(paymentUrl, 'http://localhost');
  const paymentId = url.pathname.split('/').pop()!;
  return request(server).post(`/api/payments/sandbox/${paymentId}/finish`)
    .type('form')
    .send({ token: url.searchParams.get('token') ?? '', decision });
}

async function balanceOf(session: any) {
  const res = await request(server).get('/api/wallet/my').set('Cookie', session.cookie).expect(200);
  return res.body.data.balance as number;
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  const second = await newCustomer();
  otherCustomer = second.session;
  otherCustomerId = second.id;
  await updateSettings(SANDBOX_SETTINGS as any, { id: 'system', name: 'wallet-test-setup' }, { confirmCritical: true });
});

afterAll(async () => {
  await updateSettings({
    'accounting.online_payment_enabled': false,
    'accounting.gateway': 'none',
    'accounting.gateway_sandbox': true,
  } as any, { id: 'system', name: 'wallet-test-cleanup' }, { confirmCritical: true });
});

describe('customer wallet', () => {
  it('starts with an empty, isolated wallet and never trusts a client-side balance', async () => {
    const me = await request(server).get('/api/wallet/my').set('Cookie', customer.cookie).expect(200);
    expect(me.body.data.customerId).toBe(customerId);
    expect(Number.isInteger(me.body.data.balance)).toBe(true);
    expect(me.body.data.totals.topup).toBeGreaterThanOrEqual(0);

    // Sending a balance field changes nothing: the only writer is the server.
    const before = me.body.data.balance;
    const started = await request(server).post('/api/wallet/my/topup').set('Cookie', customer.cookie)
      .send({ amount: 25000, balance: 9000000 });
    expect(started.status).toBe(200);
    expect(await balanceOf(customer)).toBe(before);
    expect(started.body.data.paymentUrl).toContain('/api/payments/sandbox/');

    const finished = await completeSandbox(started.body.data.paymentUrl);
    expect(finished.status).toBe(303);
    expect(await balanceOf(customer)).toBe(before + 25000);
  });

  it('credits a top-up exactly once even when the callback is replayed', async () => {
    const before = await balanceOf(customer);
    const started = await topUp(customer, 30000);
    await completeSandbox(started.paymentUrl);
    const afterFirst = await balanceOf(customer);
    expect(afterFirst).toBe(before + 30000);

    await completeSandbox(started.paymentUrl);
    await completeSandbox(started.paymentUrl);
    expect(await balanceOf(customer)).toBe(afterFirst);
    const rows = await q<any>("SELECT * FROM wallet_transactions WHERE payment_id=?", [started.paymentId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('topup');
    expect(rows[0].direction).toBe('credit');
    expect(rows[0].balance_before).toBe(before);
    expect(rows[0].balance_after).toBe(afterFirst);
    expect(rows[0].tracking_code).toMatch(/^WLT-/);
  });

  it('rejects tampered amounts and invalid sandbox tokens without moving money', async () => {
    const before = await balanceOf(customer);
    for (const amount of [-1000, 0, 9999, 100000000, 12.5]) {
      const res = await request(server).post('/api/wallet/my/topup').set('Cookie', customer.cookie).send({ amount });
      expect(res.status).toBe(400);
    }
    const started = await topUp(customer, 15000);
    const url = new URL(started.paymentUrl, 'http://localhost');
    const paymentId = url.pathname.split('/').pop()!;
    const forged = await request(server).post(`/api/payments/sandbox/${paymentId}/finish`)
      .type('form').send({ token: 'forged-token-value-123456', decision: 'paid' });
    expect(forged.status).toBe(403);
    // A token issued for a different payment must not work either.
    const other = await topUp(customer, 15000);
    const otherToken = tokenFrom(other.paymentUrl);
    const mismatched = await request(server).post(`/api/payments/sandbox/${paymentId}/finish`)
      .type('form').send({ token: otherToken, decision: 'paid' });
    expect(mismatched.status).toBe(403);
    expect(await balanceOf(customer)).toBe(before);
  });

  it('records a failed payment without crediting the wallet', async () => {
    const before = await balanceOf(customer);
    const started = await topUp(customer, 20000);
    const finished = await completeSandbox(started.paymentUrl, 'cancelled');
    expect(finished.status).toBe(303);
    expect(finished.headers.location).toContain('topup=failed');
    expect(await balanceOf(customer)).toBe(before);
    const payment = await one<any>('SELECT * FROM payments WHERE id=?', [started.paymentId]);
    expect(payment.status).toBe('failed');
    const transactions = await q<any>('SELECT * FROM wallet_transactions WHERE payment_id=?', [started.paymentId]);
    expect(transactions).toHaveLength(0);
  });

  it('pays a service invoice from the wallet and links the transaction to the request', async () => {
    const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
      title: 'خدمت پرداخت کیف پولی', slug: `wallet-pay-${Date.now()}`, baseFee: 30000,
      paymentMethods: ['wallet'], form: [], documents: [], workflow: [],
    }).expect(201);

    const before = await balanceOf(customer);
    expect(before).toBeGreaterThanOrEqual(30000);
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId: service.body.data.id, formData: {}, paymentMethod: 'wallet' }).expect(201);
    const created1 = created.body.data;
    expect(created1.paymentMethod).toBe('wallet');
    expect(created1.paymentStatus).toBe('paid');
    expect(created1.invoices[0].status).toBe('paid');

    expect(await balanceOf(customer)).toBe(before - 30000);
    const purchase = await one<any>(
      "SELECT * FROM wallet_transactions WHERE request_id=? AND type='purchase'", [created1.id],
    );
    expect(purchase).toBeTruthy();
    expect(purchase.invoice_id).toBe(created1.invoices[0].id);
    expect(purchase.amount).toBe(30000);
    const payment = await one<any>('SELECT * FROM payments WHERE id=?', [purchase.payment_id]);
    expect(payment.method).toBe('wallet');
    expect(payment.status).toBe('confirmed');
    expect(payment.invoice_id).toBe(created1.invoices[0].id);
  });

  it('blocks wallet payments with insufficient balance and does not create the case', async () => {
    const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
      title: 'خدمت گران کیف پولی', slug: `wallet-expensive-${Date.now()}`, baseFee: 90000000,
      paymentMethods: ['wallet'], form: [], documents: [], workflow: [],
    }).expect(201);
    const before = await balanceOf(customer);
    const countBefore = Number((await one<any>('SELECT COUNT(*) AS c FROM requests WHERE customer_id=?', [customerId]))?.c ?? 0);
    const res = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId: service.body.data.id, formData: {}, paymentMethod: 'wallet' });
    expect(res.status).toBe(409);
    expect(res.body.error.details?.[0]?.available).toBe(before);
    expect(await balanceOf(customer)).toBe(before);
    const countAfter = Number((await one<any>('SELECT COUNT(*) AS c FROM requests WHERE customer_id=?', [customerId]))?.c ?? 0);
    expect(countAfter).toBe(countBefore);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it('never allows a concurrent double spend to create a negative balance', async () => {
    await request(server).post('/api/wallet/admin/credit').set('Cookie', admin.cookie)
      .send({ customerId, amount: 50000, reason: 'آماده‌سازی آزمون هم‌زمانی کیف پول', type: 'admin_credit' }).expect(201);
    const balance = await balanceOf(customer);
    const invoices = await Promise.all([1, 2].map(async (index) => {
      const res = await request(server).post('/api/accounting/invoices').set('Cookie', admin.cookie).send({
        customerId, title: `فاکتور هم‌زمانی ${index}`, items: [{ title: 'آزمون', qty: 1, unitPrice: balance - 1000 }],
      });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    }));
    const results = await Promise.all(invoices.map((invoiceId) =>
      request(server).post(`/api/wallet/my/invoices/${invoiceId}/pay`).set('Cookie', customer.cookie)));
    const successes = results.filter((result) => result.status === 200);
    expect(successes).toHaveLength(1);
    expect(await balanceOf(customer)).toBe(1000);
    expect(await balanceOf(customer)).toBeGreaterThanOrEqual(0);
  });

  it('keeps customer and admin scopes apart', async () => {
    await request(server).get('/api/wallet/admin/summary').set('Cookie', customer.cookie).expect(403);
    await request(server).post('/api/wallet/admin/credit').set('Cookie', customer.cookie)
      .send({ customerId, amount: 10000, reason: 'تلاش غیرمجاز برای شارژ' }).expect(403);
    const expert = await createStaff('operator', { username: `wallet_expert_${Date.now() % 100000}`, password: 'Expert#12345', fullName: EXPERT.fullName });
    await request(server).get('/api/wallet/admin/summary').set('Cookie', expert.cookie).expect(403);
    // The wallet is per customer: another customer sees its own empty wallet only.
    const other = await request(server).get('/api/wallet/my').set('Cookie', otherCustomer.cookie).expect(200);
    expect(other.body.data.customerId).toBe(otherCustomerId);
    expect(other.body.data.balance).toBe(0);
    expect(other.body.data.recentTransactions).toHaveLength(0);

    // A customer can never read or pay another customer's invoice.
    const otherInvoice = await request(server).post('/api/accounting/invoices').set('Cookie', admin.cookie).send({
      customerId, title: 'فاکتور محرمانه مشتری اول', items: [{ title: 'آزمون', qty: 1, unitPrice: 5000 }],
    }).expect(201);
    await request(server).post(`/api/wallet/my/invoices/${otherInvoice.body.data.id}/pay`)
      .set('Cookie', otherCustomer.cookie).expect(403);
  });
});

describe('administrative wallet credit', () => {
  it('requires a reason, records the operator and refuses non-financial roles', async () => {
    const before = await balanceOf(customer);
    const noReason = await request(server).post('/api/wallet/admin/credit').set('Cookie', admin.cookie)
      .send({ customerId, amount: 10000, reason: '' });
    expect(noReason.status).toBe(400);

    const shortReason = await request(server).post('/api/wallet/admin/credit').set('Cookie', admin.cookie)
      .send({ customerId, amount: 10000, reason: 'بده' });
    expect(shortReason.status).toBe(400);

    const credited = await request(server).post('/api/wallet/admin/credit').set('Cookie', admin.cookie)
      .send({ customerId, amount: 12000, reason: 'جبران اختلال درگاه برای آزمون', type: 'admin_credit' });
    expect(credited.status).toBe(201);
    expect(credited.body.data.transaction.balanceBefore).toBe(before);
    expect(credited.body.data.transaction.balanceAfter).toBe(before + 12000);
    expect(credited.body.data.transaction.adminName).toBeTruthy();
    expect(await balanceOf(customer)).toBe(before + 12000);

    const details = await request(server).get(`/api/wallet/admin/customers/${customerId}`).set('Cookie', admin.cookie).expect(200);
    const row = details.body.data.transactions.find((tx: any) => tx.id === credited.body.data.transaction.id);
    expect(row.source).toBe('admin');
    expect(row.reason).toContain('جبران');
    expect(row.adminName).toBeTruthy();
    expect(details.body.data.wallet.balance).toBe(before + 12000);

    const expert = await createStaff('service_expert', { username: `wallet_expert2_${Date.now() % 100000}`, password: 'Expert#12345', fullName: 'کارشناس مالی نشده' });
    await request(server).post('/api/wallet/admin/credit').set('Cookie', expert.cookie)
      .send({ customerId, amount: 5000, reason: 'تلاش کارشناس بدون مجوز مالی' }).expect(403);
  });

  it('corrects a wrong credit with a reversal instead of deleting history', async () => {
    const credited = await request(server).post('/api/wallet/admin/credit').set('Cookie', admin.cookie)
      .send({ customerId, amount: 7000, reason: 'شارژ اشتباه برای آزمون اصلاحیه' }).expect(201);
    const transactionId = credited.body.data.transaction.id;
    const afterCredit = await balanceOf(customer);

    const reversed = await request(server).post(`/api/wallet/admin/transactions/${transactionId}/reverse`)
      .set('Cookie', admin.cookie).send({ reason: 'اشتباه در مبلغ؛ اصلاح شد' });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.transaction.type).toBe('correction');
    expect(reversed.body.data.transaction.direction).toBe('debit');
    expect(await balanceOf(customer)).toBe(afterCredit - 7000);

    const original = await one<any>('SELECT status FROM wallet_transactions WHERE id=?', [transactionId]);
    expect(original.status).toBe('reversed');
    const again = await request(server).post(`/api/wallet/admin/transactions/${transactionId}/reverse`)
      .set('Cookie', admin.cookie).send({ reason: 'تلاش دوم برای اصلاحیه' });
    expect(again.status).toBe(409);
  });

  it('runs an admin sandbox test top-up end to end', async () => {
    const before = await balanceOf(customer);
    const started = await request(server).post('/api/wallet/admin/test-topup').set('Cookie', admin.cookie)
      .send({ customerId, amount: 11000 });
    expect(started.status).toBe(200);
    expect(started.body.data.sandbox).toBe(true);
    await completeSandbox(started.body.data.paymentUrl);
    expect(await balanceOf(customer)).toBe(before + 11000);
    const diagnostics = await request(server).get('/api/payments/admin/diagnostics').set('Cookie', admin.cookie).expect(200);
    expect(diagnostics.body.data.secretsExposed).toBe(false);
    expect(JSON.stringify(diagnostics.body.data)).not.toContain('12345678-1234');
  });
});
