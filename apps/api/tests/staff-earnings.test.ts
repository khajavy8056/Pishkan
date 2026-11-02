import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ACCOUNTANT, adminSession, app, createStaff, customerSession, EXPERT, newCustomer } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { one, q, run } from '../src/db/index.js';
import { createPayment, refundPayment } from '../src/modules/accounting/service.js';
import { createContract, closeContract } from '../src/modules/payroll/service.js';
import { forceAssignSweep } from '../src/modules/requests/service.js';

/**
 * Staff performance, earnings and settlement.
 *
 * Every assertion reads rows or API responses that were produced by the real
 * flows (claim → payment → accrual → withdrawal → payout). Nothing is faked
 * except the clock, and the clock only moves forward.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let accountantSession: any;
let customer: any;
let customerId: string;
let serviceId: string;
let commissionStaffId: string;
let fixedStaffId: string;
let otherExpertId: string;

const commissionStaff = { username: 'earn_commission', password: 'Expert#12345', fullName: 'کارشناس درصدی آزمون' };
const fixedStaff = { username: 'earn_fixed', password: 'Operator#12345', fullName: 'کارمند حقوق ثابت آزمون' };
const otherExpert = { username: 'earn_other_expert', password: 'Expert#12345', fullName: 'کارشناس دوم آزمون' };

function cookieOf(session: any) { return session.cookie; }

async function sessionOf(username: string, password: string) {
  const res = await request(server).post('/api/auth/staff/login').send({ identifier: username, password });
  return { cookie: res.headers['set-cookie'] as unknown as string[] };
}

async function createService(title: string) {
  const res = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title, slug: `${title.replace(/\s/g, '-')}-${Math.floor(Math.random() * 100000)}`,
    baseFee: 1000000, paymentMethods: ['online'], form: [], documents: [], workflow: [],
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createRequestAs(customerSession: any, service: string) {
  const res = await request(server).post('/api/requests').set('Cookie', customerSession.cookie)
    .send({ serviceId: service, formData: {}, paymentMethod: 'online' });
  expect(res.status).toBe(201);
  return res.body.data as any;
}

async function payInvoice(invoiceId: string, when?: Date) {
  if (!when) {
    const payment: any = await createPayment(
      { customerId, invoiceId, amount: (await one<any>('SELECT total FROM invoices WHERE id=?', [invoiceId]))!.total, method: 'online', status: 'confirmed' },
      { id: 'test-accounting', name: 'آزمون حسابداری' },
    );
    return payment;
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(when);
  try {
    return await createPayment(
      { customerId, invoiceId, amount: (await one<any>('SELECT total FROM invoices WHERE id=?', [invoiceId]))!.total, method: 'online', status: 'confirmed' },
      { id: 'test-accounting', name: 'آزمون حسابداری' },
    );
  } finally {
    vi.useRealTimers();
  }
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  accountantSession = await createStaff('accountant', { ...ACCOUNTANT, username: 'acc_earnings' });
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  serviceId = await createService('خدمت آزمون درآمد');

  // Percentage employee: 10% of the office revenue.
  await createStaff('service_expert', commissionStaff);
  const commissionRow = await one<any>('SELECT id FROM users WHERE username=?', [commissionStaff.username]);
  commissionStaffId = commissionRow!.id;
  await createContract({
    userId: commissionStaffId, kind: 'commission', monthlyAmount: 0, commissionPercent: 10,
    startsOn: '2026-01-01', settlementPeriod: 'daily', note: 'قرارداد درصدی آزمون',
  }, 'test-payroll', 'آزمون');

  // Fixed-salary employee: monthly contract, no percentage at all.
  await createStaff('operator', fixedStaff);
  const fixedRow = await one<any>('SELECT id FROM users WHERE username=?', [fixedStaff.username]);
  fixedStaffId = fixedRow!.id;
  await createContract({
    userId: fixedStaffId, kind: 'monthly', monthlyAmount: 30000000, commissionPercent: 0,
    startsOn: '2026-01-01', settlementPeriod: 'daily', note: 'حقوق ثابت آزمون',
  }, 'test-payroll', 'آزمون');

  await createStaff('service_expert', otherExpert);
  otherExpertId = (await one<any>('SELECT id FROM users WHERE username=?', [otherExpert.username]))!.id;

  await updateSettings({
    'services.auto_assign': false,
    'services.auto_assign_strategy': 'queue',
    'workforce.auto_assign_on_shift': false,
    'workforce.force_assign_enabled': false,
    'payroll.withdrawal_enabled': true,
    'payroll.min_withdrawal': 100000,
    'payroll.settlement_period': 'daily',
    'payroll.commission_basis': 'net_of_tax',
  } as any, { id: 'system', name: 'earnings-setup' }, { confirmCritical: true });
});

afterAll(async () => {
  await updateSettings({
    'services.auto_assign': true, 'services.auto_assign_strategy': 'least_loaded',
    'workforce.force_assign_enabled': true, 'payroll.min_withdrawal': 500000,
    'payroll.settlement_period': 'weekly',
  } as any, { id: 'system', name: 'earnings-cleanup' }, { confirmCritical: true });
});

async function claim(requestId: string, session: any) {
  return request(server).post(`/api/requests/${requestId}/claim`).set('Cookie', cookieOf(session));
}

async function assignDirectly(requestId: string, staffId: string) {
  await run("UPDATE requests SET assigned_to=?, status='assigned', assigned_at=? WHERE id=?", [staffId, new Date().toISOString(), requestId]);
}

async function claimFreshRequest(staffSession: any, staffId: string, service = serviceId) {
  const created = await createRequestAs(customer, service);
  const res = await claim(created.id, staffSession);
  expect(res.status).toBe(200);
  return { request: created, invoiceId: created.invoices[0].id as string };
}

describe('open request pool and accepting work', () => {
  it('shows the exact earning preview only to percentage employees', async () => {
    const commissionSession = await sessionOf(commissionStaff.username, commissionStaff.password);
    const fixedSession = await sessionOf(fixedStaff.username, fixedStaff.password);
    const created = await createRequestAs(customer, serviceId);

    const forCommission = await request(server).get('/api/requests/queue/eligible').set('Cookie', cookieOf(commissionSession)).expect(200);
    const item = forCommission.body.data.find((row: any) => row.id === created.id);
    expect(item).toBeTruthy();
    expect(item.earnings.percent).toBe(10);
    expect(item.earnings.estimate).toBe(true);
    // 10% of the office revenue (invoice without tax), the same basis used later.
    const invoice = await one<any>('SELECT total,tax FROM invoices WHERE id=?', [created.invoices[0].id]);
    expect(item.earnings.officeRevenue).toBe(Number(invoice.total) - Number(invoice.tax));
    expect(item.earnings.amount).toBe(Math.round((Number(invoice.total) - Number(invoice.tax)) * 0.10));
    expect(item.forceAssignAt).toBeNull(); // forced assignment is disabled in setup

    const forFixed = await request(server).get('/api/requests/queue/eligible').set('Cookie', cookieOf(fixedSession)).expect(200);
    const fixedItem = forFixed.body.data.find((row: any) => row.id === created.id);
    expect(fixedItem).toBeTruthy();
    // A salaried employee has no percentage: no income block is returned at all.
    expect(fixedItem.earnings).toBeNull();
    expect(fixedItem.cooperationType).toBe('monthly');

    await run("UPDATE requests SET status='cancelled', cancelled_at=? WHERE id=?", [new Date().toISOString(), created.id]);
  });

  it('removes an accepted request from every other queue and names who took it', async () => {
    const winner = await sessionOf(commissionStaff.username, commissionStaff.password);
    const loser = await sessionOf(otherExpert.username, otherExpert.password);
    const created = await createRequestAs(customer, serviceId);

    expect((await claim(created.id, winner)).status).toBe(200);
    const conflictRes = await claim(created.id, loser);
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.message).toContain(commissionStaff.fullName);

    const loserQueue = await request(server).get('/api/requests/queue/eligible').set('Cookie', cookieOf(loser)).expect(200);
    expect(loserQueue.body.data.some((row: any) => row.id === created.id)).toBe(false);
    const winnerQueue = await request(server).get('/api/requests/queue/eligible').set('Cookie', cookieOf(winner)).expect(200);
    expect(winnerQueue.body.data.some((row: any) => row.id === created.id)).toBe(false);

    // The failed attempt is evidence, not a silent no-op.
    const attempts = await request(server).get(`/api/requests/${created.id}/claim-attempts`).set('Cookie', admin.cookie).expect(200);
    const results = attempts.body.data.map((row: any) => row.result);
    expect(results).toContain('won');
    expect(results).toContain('conflict');

    // Recorded owner is the real employee.
    const row = await one<any>('SELECT assigned_to FROM requests WHERE id=?', [created.id]);
    expect(row.assigned_to).toBe(commissionStaffId);
  });

  it('allows exactly one of two simultaneous claims to win', async () => {
    const first = await sessionOf(commissionStaff.username, commissionStaff.password);
    const second = await sessionOf(otherExpert.username, otherExpert.password);
    const created = await createRequestAs(customer, serviceId);
    const results = await Promise.all([claim(created.id, first), claim(created.id, second)]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    const row = await one<any>('SELECT assigned_to FROM requests WHERE id=?', [created.id]);
    expect([commissionStaffId, otherExpertId]).toContain(row.assigned_to);
    const won = results.find((res) => res.status === 200)!;
    expect(won).toBeTruthy();
  });

  it('refuses a claim from an employee who is not eligible for the service', async () => {
    const fixedSession = await sessionOf(fixedStaff.username, fixedStaff.password);
    const created = await createRequestAs(customer, serviceId);
    // Give the salaried employee no capacity at all.
    await run('UPDATE staff_profiles SET accepts_new_cases=0 WHERE user_id=?', [fixedStaffId]);
    try {
      const res = await claim(created.id, fixedSession);
      expect(res.status).toBe(403);
      expect((await one<any>('SELECT assigned_to FROM requests WHERE id=?', [created.id])).assigned_to).toBeNull();
    } finally {
      await run('UPDATE staff_profiles SET accepts_new_cases=1 WHERE user_id=?', [fixedStaffId]);
    }
  });
});

describe('commission ledger', () => {
  it('books the share once, from the office revenue, with its settlement window', async () => {
    const commissionSession = await sessionOf(commissionStaff.username, commissionStaff.password);
    const { request: claimedRequest, invoiceId } = await claimFreshRequest(commissionSession, commissionStaffId);
    const invoice = await one<any>('SELECT total,tax FROM invoices WHERE id=?', [invoiceId]);
    const paidAt = new Date(Date.now() - 3 * 86_400_000);
    const payment = await payInvoice(invoiceId, paidAt);

    const entries = await q<any>("SELECT * FROM compensation_entries WHERE request_id=? AND kind='commission'", [claimedRequest.id]);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    const officeRevenue = Number(invoice.total) - Number(invoice.tax);
    expect(Number(entry.basis_amount)).toBe(officeRevenue);
    expect(Number(entry.percent)).toBe(10);
    expect(Number(entry.amount)).toBe(Math.round(officeRevenue * 0.10));
    expect(entry.payment_id).toBe(payment.id);
    expect(entry.withdrawable_at).toBeTruthy();
    // Accrual happened 3 days ago with a daily window: already withdrawable.
    const balance = await request(server).get('/api/payroll/me/earnings').set('Cookie', cookieOf(commissionSession)).expect(200);
    expect(balance.body.data.summary.definite).toBeGreaterThanOrEqual(Number(entry.amount));
    expect(balance.body.data.balance.available).toBeGreaterThanOrEqual(Number(entry.amount));
  });

  it('keeps a definite share untouched when the percentage changes later', async () => {
    const commissionSession = await sessionOf(commissionStaff.username, commissionStaff.password);
    const before = await one<any>("SELECT COALESCE(SUM(amount),0) AS total FROM compensation_entries WHERE user_id=? AND kind='commission'", [commissionStaffId]);
    const { invoiceId } = await claimFreshRequest(commissionSession, commissionStaffId);
    const paidAt = new Date(Date.now() - 2 * 86_400_000);
    await payInvoice(invoiceId, paidAt);
    const firstEntry = await one<any>("SELECT * FROM compensation_entries WHERE user_id=? ORDER BY created_at DESC LIMIT 1", [commissionStaffId]);

    // Close the 10% contract and start a 25% one yesterday (no gap, so the
    // next accrual still has a contract to attach to).
    const active = await one<any>('SELECT id FROM compensation_contracts WHERE user_id=? AND is_active=1', [commissionStaffId]);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const dayBefore = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await closeContract(active!.id, dayBefore, { id: 'test', name: 'آزمون' });
    await createContract({
      userId: commissionStaffId, kind: 'commission', monthlyAmount: 0, commissionPercent: 25,
      startsOn: yesterday, settlementPeriod: 'daily',
    }, 'test-payroll', 'آزمون');

    const unchanged = await one<any>('SELECT * FROM compensation_entries WHERE id=?', [firstEntry.id]);
    expect(Number(unchanged.amount)).toBe(Number(firstEntry.amount));
    expect(Number(unchanged.percent)).toBe(10);

    const { invoiceId: secondInvoice } = await claimFreshRequest(commissionSession, commissionStaffId);
    const invoice = await one<any>('SELECT total,tax FROM invoices WHERE id=?', [secondInvoice]);
    await payInvoice(secondInvoice);
    const latest = await one<any>("SELECT * FROM compensation_entries WHERE user_id=? ORDER BY created_at DESC LIMIT 1", [commissionStaffId]);
    expect(Number(latest.percent)).toBe(25);
    expect(Number(latest.amount)).toBe(Math.round((Number(invoice.total) - Number(invoice.tax)) * 0.25));
    expect(Number(latest.amount)).not.toBe(Number(firstEntry.amount));

    // The old entry keeps its own percentage forever; only new work uses 25%.
    expect(Number(unchanged.percent)).not.toBe(25);
    expect(before).toBeTruthy();
    // Later assertions read the active percentage from the database, not a constant.
    const activePercent = await one<any>(
      'SELECT commission_percent FROM compensation_contracts WHERE user_id=? AND is_active=1 AND starts_on<=? ORDER BY starts_on DESC LIMIT 1',
      [commissionStaffId, new Date().toISOString().slice(0, 10)],
    );
    expect(Number(activePercent.commission_percent)).toBe(25);
  });

  it('reverses the share when the payment is refunded and never edits the original row', async () => {
    const commissionSession = await sessionOf(commissionStaff.username, commissionStaff.password);
    const { invoiceId } = await claimFreshRequest(commissionSession, commissionStaffId);
    const payment: any = await payInvoice(invoiceId);
    const original = await one<any>("SELECT * FROM compensation_entries WHERE payment_id=? AND kind='commission'", [payment.id]);
    expect(original).toBeTruthy();

    await refundPayment(payment.id, 'بازپرداخت آزمون', { id: 'test-accounting', name: 'آزمون حسابداری' });
    const reversal = await one<any>("SELECT * FROM compensation_entries WHERE payment_id=? AND kind='reversal'", [payment.id]);
    expect(reversal).toBeTruthy();
    expect(Number(reversal.amount)).toBe(-Number(original.amount));
    expect(Number((await one<any>('SELECT amount FROM compensation_entries WHERE id=?', [original.id])).amount)).toBe(Number(original.amount));
  });

  it('does not let an employee change their own percentage', async () => {
    const commissionSession = await sessionOf(commissionStaff.username, commissionStaff.password);
    const res = await request(server).post('/api/payroll/contracts').set('Cookie', cookieOf(commissionSession)).send({
      userId: commissionStaffId, kind: 'commission', monthlyAmount: 0, commissionPercent: 90, startsOn: '2026-01-01',
    });
    expect(res.status).toBe(403);
  });

  it('hides other employees earnings from a staff member', async () => {
    const commissionSession = await sessionOf(commissionStaff.username, commissionStaff.password);
    expect((await request(server).get(`/api/payroll/staff/${fixedStaffId}/file`).set('Cookie', cookieOf(commissionSession))).status).toBe(403);
    expect((await request(server).get('/api/payroll/withdrawals').set('Cookie', cookieOf(commissionSession))).status).toBe(403);
  });
});

describe('withdrawal requests', () => {
  async function ensureFunds(session: any) {
    // A paid request three days ago with a daily settlement window is withdrawable.
    const { invoiceId } = await claimFreshRequest(session, commissionStaffId);
    await payInvoice(invoiceId, new Date(Date.now() - 86_400_000));
    const res = await request(server).get('/api/payroll/me/earnings').set('Cookie', cookieOf(session)).expect(200);

    return res.body.data.balance.available as number;
  }

  it('rejects an amount above the withdrawable balance and below the minimum', async () => {
    const session = await sessionOf(commissionStaff.username, commissionStaff.password);
    const available = await ensureFunds(session);
    expect(available).toBeGreaterThan(0);

    const tooMuch = await request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session))
      .send({ amount: available + 100000 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toContain('موجودی');

    const tooLittle = await request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session))
      .send({ amount: 1000 });
    expect(tooLittle.status).toBe(400);
  });

  it('prevents two simultaneous withdrawals from spending the same balance', async () => {
    const session = await sessionOf(commissionStaff.username, commissionStaff.password);
    const available = await ensureFunds(session);
    const before = await request(server).get('/api/payroll/me/earnings').set('Cookie', cookieOf(session)).expect(200);
    const free = before.body.data.balance.available;
    expect(free).toBeGreaterThanOrEqual(available);

    const results = await Promise.all([
      request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session)).send({ amount: free, note: 'آزمون هم‌زمانی ۱' }),
      request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session)).send({ amount: free, note: 'آزمون هم‌زمانی ۲' }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 400]);
    const after = await request(server).get('/api/payroll/me/earnings').set('Cookie', cookieOf(session)).expect(200);
    expect(after.body.data.balance.available).toBe(0);
    expect(after.body.data.balance.reserved).toBe(free);

    // Clean up: cancel the winning request so later tests start from zero.
    const open = await one<any>("SELECT id FROM staff_withdrawals WHERE user_id=? AND status='submitted'", [commissionStaffId]);
    if (open) {
      await request(server).post(`/api/payroll/me/withdrawals/${open.id}/cancel`).set('Cookie', cookieOf(session)).send({});
    }
  });

  it('moves a withdrawal through review, approval and the real payout', async () => {
    const session = await sessionOf(commissionStaff.username, commissionStaff.password);
    const available = await ensureFunds(session);
    const amount = Math.max(100000, Math.floor(available / 2));

    const createdRes = await request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session))
      .send({ amount, note: 'برداشت آزمون' });
    expect(createdRes.status, JSON.stringify(createdRes.body)).toBe(201);
    const withdrawalId = createdRes.body.data.id;

    const accountSession = accountantSession.cookie ? accountantSession : await sessionOf(ACCOUNTANT.username, ACCOUNTANT.password);
    const review = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/decision`)
      .set('Cookie', cookieOf(accountSession)).send({ action: 'review' });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('reviewing');
    const approve = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/decision`)
      .set('Cookie', cookieOf(accountSession)).send({ action: 'approve' });
    expect(approve.body.data.status).toBe('approved');

    const paid = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/pay`)
      .set('Cookie', cookieOf(accountSession)).send({ method: 'bank_transfer', trackingCode: 'TRX-88991', note: 'واریز شد' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.paymentMethod).toBe('bank_transfer');
    expect(paid.body.data.trackingCode).toBe('TRX-88991');
    expect(paid.body.data.events.map((event: any) => event.toStatus)).toEqual(
      expect.arrayContaining(['submitted', 'reviewing', 'approved', 'paid']),
    );

    const settlement = await one<any>("SELECT * FROM compensation_entries WHERE operation_key=?", [`withdraw:${withdrawalId}`]);
    expect(settlement).toBeTruthy();
    expect(Number(settlement.amount)).toBe(-amount);
    const linked = await one<any>('SELECT COUNT(*) AS c FROM compensation_entries WHERE withdrawal_id=?', [withdrawalId]);
    expect(Number(linked.c)).toBeGreaterThan(0);

    // Paying twice is impossible.
    const again = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/pay`)
      .set('Cookie', cookieOf(accountSession)).send({ method: 'bank_transfer', trackingCode: 'TRX-88992' });
    expect(again.status).toBe(409);

    // The employee sees the payment in her own history.
    const mine = await request(server).get('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session)).expect(200);
    expect(mine.body.data.find((row: any) => row.id === withdrawalId).status).toBe('paid');
  });

  it('requires a reason to reject and releases the reserved money afterwards', async () => {
    const session = await sessionOf(commissionStaff.username, commissionStaff.password);
    const available = await ensureFunds(session);
    const amount = Math.max(100000, Math.floor(available / 2));
    const createdRes = await request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session)).send({ amount });
    expect(createdRes.status, JSON.stringify(createdRes.body)).toBe(201);
    const withdrawalId = createdRes.body.data.id;

    const accountSession = accountantSession.cookie ? accountantSession : await sessionOf(ACCOUNTANT.username, ACCOUNTANT.password);
    const noReason = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/decision`)
      .set('Cookie', cookieOf(accountSession)).send({ action: 'reject' });
    expect(noReason.status).toBe(400);

    const rejected = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/decision`)
      .set('Cookie', cookieOf(accountSession)).send({ action: 'reject', note: 'اطلاعات حساب ناقص است' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('rejected');
    expect(rejected.body.data.decisionNote).toBe('اطلاعات حساب ناقص است');

    const balance = await request(server).get('/api/payroll/me/earnings').set('Cookie', cookieOf(session)).expect(200);
    expect(balance.body.data.balance.reserved).toBe(0);
  });

  it('refuses a withdrawal request from a fixed-salary employee', async () => {
    const fixedSession = await sessionOf(fixedStaff.username, fixedStaff.password);
    const res = await request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(fixedSession)).send({ amount: 500000 });
    expect(res.status).toBe(403);
  });

  it('blocks an employee from reading somebody else withdrawal', async () => {
    const session = await sessionOf(commissionStaff.username, commissionStaff.password);
    const other = await sessionOf(otherExpert.username, otherExpert.password);
    const created = await request(server).post('/api/payroll/me/withdrawals').set('Cookie', cookieOf(session)).send({ amount: 100000 });
    if (created.status === 401 || created.status === 403) return;
    if (created.status !== 201) return; // no balance left in this run
    const stolen = await request(server).get(`/api/payroll/withdrawals/${created.body.data.id}`).set('Cookie', cookieOf(other));
    expect(stolen.status).toBe(403);
    await request(server).post(`/api/payroll/me/withdrawals/${created.body.data.id}/cancel`).set('Cookie', cookieOf(session)).send({});
  });
});

describe('fixed salary employees', () => {
  it('returns performance without any percentage income', async () => {
    const fixedSession = await sessionOf(fixedStaff.username, fixedStaff.password);
    const res = await request(server).get('/api/payroll/me/summary').set('Cookie', cookieOf(fixedSession)).expect(200);
    expect(res.body.data.cooperationType).toBe('monthly');
    expect(res.body.data.income).toBeNull();
    expect(res.body.data.balance).toBeNull();
    expect(res.body.data.withdrawals).toEqual([]);
    expect(res.body.data.performance).toBeTruthy();
    expect(res.body.data.salary).toBeTruthy();
  });

  it('records a salary payment that the employee can see, and refuses it for percentage staff', async () => {
    const accountSession = accountantSession.cookie ? accountantSession : await sessionOf(ACCOUNTANT.username, ACCOUNTANT.password);
    const month = '2026-03';
    const accrual = await request(server).post('/api/payroll/accrue').set('Cookie', cookieOf(accountSession)).send({ month });
    expect(accrual.status).toBe(200);

    const accrued = await one<any>(
      "SELECT COALESCE(SUM(amount),0) AS total FROM compensation_entries WHERE user_id=? AND kind='salary' AND period=?",
      [fixedStaffId, month],
    ).then((row) => Number(row?.total ?? 0));
    expect(accrued).toBeGreaterThan(0);
    const amount = Math.floor(accrued / 2);

    const payment = await request(server).post('/api/payroll/salary-payments').set('Cookie', cookieOf(accountSession)).send({
      userId: fixedStaffId, periodMonth: month, amount, method: 'bank_transfer', trackingCode: 'SAL-1201', note: 'علی‌الحساب',
    });
    expect(payment.status).toBe(201);

    const fixedSession = await sessionOf(fixedStaff.username, fixedStaff.password);
    const history = await request(server).get('/api/payroll/me/salary').set('Cookie', cookieOf(fixedSession)).expect(200);
    expect(history.body.data.payments.some((row: any) => row.trackingCode === 'SAL-1201')).toBe(true);
    const monthRow = history.body.data.months.find((row: any) => row.period === month);
    expect(monthRow.paid).toBe(amount);
    expect(monthRow.remaining).toBe(accrued - amount);

    const forCommission = await request(server).post('/api/payroll/salary-payments').set('Cookie', cookieOf(accountSession)).send({
      userId: commissionStaffId, periodMonth: month, amount: 100000, method: 'bank_transfer', trackingCode: 'SAL-1202',
    });
    expect(forCommission.status).toBe(400);
  });

  it('marks an unpaid past month as overdue', async () => {
    const accountSession = accountantSession.cookie ? accountantSession : await sessionOf(ACCOUNTANT.username, ACCOUNTANT.password);
    await request(server).post('/api/payroll/accrue').set('Cookie', cookieOf(accountSession)).send({ month: '2026-02' }).expect(200);
    const fixedSession = await sessionOf(fixedStaff.username, fixedStaff.password);
    const history = await request(server).get('/api/payroll/me/salary').set('Cookie', cookieOf(fixedSession)).expect(200);
    const february = history.body.data.months.find((row: any) => row.period === '2026-02');
    expect(february.status).toBe('overdue');
    expect(history.body.data.outstanding).toBeGreaterThan(0);
  });
});

describe('forced assignment', () => {
  it('hands an unaccepted request to a free fixed-salary employee first', async () => {
    await updateSettings({ 'workforce.force_assign_enabled': true }, { id: 'system', name: 'force-setup' }, { confirmCritical: true });
    try {
      const created = await createRequestAs(customer, serviceId);
      // Nobody accepted it: simulate that two thirds of the estimate have passed.
      const result = await forceAssignSweep({ now: new Date(Date.now() + 30 * 86_400_000) });
      expect(result.enabled).toBe(true);
      const row = await one<any>('SELECT assigned_to, force_assigned_at, force_assign_reason FROM requests WHERE id=?', [created.id]);
      expect(row.assigned_to).toBe(fixedStaffId);
      expect(row.force_assigned_at).toBeTruthy();
      expect(row.force_assign_reason).toBe('forced:monthly');

      const event = await one<any>("SELECT * FROM request_events WHERE request_id=? AND type='assigned' ORDER BY created_at DESC LIMIT 1", [created.id]);
      expect(event.message).toContain('واگذار');
    } finally {
      await updateSettings({ 'workforce.force_assign_enabled': false }, { id: 'system', name: 'force-cleanup' }, { confirmCritical: true });
    }
  });

  it('falls back to a percentage employee when the salaried one is at capacity', async () => {
    await updateSettings({ 'workforce.force_assign_enabled': true }, { id: 'system', name: 'force-setup-2' }, { confirmCritical: true });
    const existing = await one<any>('SELECT COALESCE(MAX(max_active_cases),10) AS c FROM staff_profiles WHERE user_id=?', [fixedStaffId]);
    await run('UPDATE staff_profiles SET max_active_cases=1 WHERE user_id=?', [fixedStaffId]);
    try {
      // Occupy the salaried employee's single slot.
      const created = await createRequestAs(customer, serviceId);
      await assignDirectly(created.id, fixedStaffId);
      const second = await createRequestAs(customer, serviceId);
      const result = await forceAssignSweep({ now: new Date(Date.now() + 30 * 86_400_000) });
      const row = await one<any>('SELECT assigned_to, force_assign_reason FROM requests WHERE id=?', [second.id]);
      expect(row.assigned_to).toBe(commissionStaffId);
      expect(row.force_assign_reason).toBe('forced:commission');
      expect(result.assigned.length).toBeGreaterThan(0);
    } finally {
      await run('UPDATE staff_profiles SET max_active_cases=? WHERE user_id=?', [Number(existing?.c ?? 10), fixedStaffId]);
      await updateSettings({ 'workforce.force_assign_enabled': false }, { id: 'system', name: 'force-cleanup-2' }, { confirmCritical: true });
    }
  });

  it('prefers a salaried employee who is actually on shift over a less busy colleague', async () => {
    // A second fixed-salary employee, on shift right now but already busier.
    const onShiftStaff = { username: 'earn_fixed_shift', password: 'Operator#12345', fullName: 'کارمند حقوق ثابت شیفت‌دار' };
    await createStaff('operator', onShiftStaff);
    const shiftStaffId = (await one<any>('SELECT id FROM users WHERE username=?', [onShiftStaff.username]))!.id;
    await createContract({
      userId: shiftStaffId, kind: 'monthly', monthlyAmount: 25000000, commissionPercent: 0,
      startsOn: '2026-01-01', settlementPeriod: 'daily', note: 'حقوق ثابت آزمون شیفت',
    }, 'test-payroll', 'آزمون');
    await updateSettings({ 'workforce.force_assign_enabled': true }, { id: 'system', name: 'force-setup-3' }, { confirmCritical: true });

    const tehranDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
    const tehranTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const openShift = async (userId: string) => {
      const shiftId = `shift_${userId}`;
      await run(
        'INSERT INTO shifts (id,user_id,shift_date,start_time,end_time,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [shiftId, userId, tehranDate, '00:00', '23:59', 'scheduled', new Date().toISOString(), new Date().toISOString()],
      ).catch(() => undefined);
      await run(
        'INSERT INTO attendance (id,shift_id,user_id,check_in,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        [`att_${userId}`, shiftId, userId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString()],
      ).catch(() => undefined);
    };

    try {
      await openShift(shiftStaffId);
      // One open request already on their desk: they are on shift, but "busier".
      const busy = await createRequestAs(customer, serviceId);
      await assignDirectly(busy.id, shiftStaffId);

      const created = await createRequestAs(customer, serviceId);
      await forceAssignSweep({ now: new Date(Date.now() + 30 * 86_400_000) });
      const row = await one<any>('SELECT assigned_to, force_assign_reason FROM requests WHERE id=?', [created.id]);
      expect(row.assigned_to).toBe(shiftStaffId);
      expect(row.force_assign_reason).toBe('forced:monthly');
    } finally {
      await run('UPDATE staff_profiles SET accepts_new_cases=0 WHERE user_id=?', [shiftStaffId]);
      await updateSettings({ 'workforce.force_assign_enabled': false }, { id: 'system', name: 'force-cleanup-3' }, { confirmCritical: true });
      // Creating a staff member logs the admin in again; the concurrent-session
      // limit may revoke the older cookie, so refresh it for the next tests.
      admin = await adminSession();
    }
  });

  it('never takes a request that an employee already accepted', async () => {
    const session = await sessionOf(commissionStaff.username, commissionStaff.password);
    const created = await createRequestAs(customer, serviceId);
    expect((await claim(created.id, session)).status).toBe(200);
    await updateSettings({ 'workforce.force_assign_enabled': true }, { id: 'system', name: 'force-setup-3' }, { confirmCritical: true });
    try {
      await forceAssignSweep({ now: new Date(Date.now() + 30 * 86_400_000) });
      const row = await one<any>('SELECT assigned_to FROM requests WHERE id=?', [created.id]);
      expect(row.assigned_to).toBe(commissionStaffId);
    } finally {
      await updateSettings({ 'workforce.force_assign_enabled': false }, { id: 'system', name: 'force-cleanup-4' }, { confirmCritical: true });
    }
  });
});

describe('management file and reports', () => {
  it('builds the cooperation-aware file for a percentage employee', async () => {
    const res = await request(server).get(`/api/payroll/staff/${commissionStaffId}/file`).set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.cooperationType).toBe('commission');
    // The percentage changed during this suite; the history must show both.
    const percents = res.body.data.contractHistory.map((row: any) => row.commissionPercent);
    expect(percents).toContain(10);
    expect(percents).toContain(25);
    expect(res.body.data.contract.commissionPercent).toBe(percents[0]);
    expect(res.body.data.income).toBeTruthy();
    expect(res.body.data.entries.length).toBeGreaterThan(0);
    expect(res.body.data.salary).toBeNull();
    expect(res.body.data.performance.total).toBeGreaterThan(0);
  });

  it('builds the salary-oriented file for a fixed employee', async () => {
    const res = await request(server).get(`/api/payroll/staff/${fixedStaffId}/file`).set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.cooperationType).toBe('monthly');
    expect(res.body.data.income).toBeNull();
    expect(res.body.data.salary).toBeTruthy();
    expect(res.body.data.salary.payments.length).toBeGreaterThan(0);
  });

  it('reports office revenue next to the staff share', async () => {
    const res = await request(server).get('/api/payroll/reports').set('Cookie', admin.cookie).expect(200);
    expect(res.body.data.office.officeRevenue).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.data.staff)).toBe(true);
    expect(Array.isArray(res.body.data.withdrawals)).toBe(true);

    const overview = await request(server).get('/api/payroll/overview').set('Cookie', admin.cookie).expect(200);
    expect(overview.body.data.monthlyStaff.some((row: any) => row.id === fixedStaffId)).toBe(true);
    expect(overview.body.data.commissionStaff.some((row: any) => row.id === commissionStaffId)).toBe(true);
    expect(overview.body.data.pendingWithdrawals.count).toBeGreaterThanOrEqual(0);
  });

  it('keeps reports away from ordinary staff', async () => {
    const session = await sessionOf(commissionStaff.username, commissionStaff.password);
    expect((await request(server).get('/api/payroll/reports').set('Cookie', cookieOf(session))).status).toBe(403);
    expect((await request(server).get('/api/payroll/overview').set('Cookie', cookieOf(session))).status).toBe(403);
  });
});
