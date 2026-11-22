import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { one, q, run } from '../src/db/index.js';
import { createPayment } from '../src/modules/accounting/service.js';
import { createContract } from '../src/modules/payroll/service.js';
import { followUpReminderSweep, forceAssignSweep } from '../src/modules/requests/service.js';

/**
 * Round 2 platform features: mid-process organization-fee invoices, presence
 * for automatic assignment, follow-up reminders, dashboard workforce alerts,
 * withdrawal receipts, the printable payroll report, Web Push subscriptions
 * and customer-initiated custom requests with creator assignment.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let customerId: string;
let expert: any;
let expertId: string;
let expert2: any;
let expert2Id: string;
let serviceId: string;
let plainServiceId: string;

const r2Expert = { username: 'r2_expert', password: 'Expert#12345', fullName: 'کارشناس دور دوم' };
const r2Expert2 = { username: 'r2_expert_two', password: 'Expert#12345', fullName: 'کارشناس دوم دور دوم' };

async function staffId(username: string) {
  return (await one<any>('SELECT id FROM users WHERE username = ?', [username]))!.id as string;
}

async function createService(title: string, extra: Record<string, unknown> = {}, workflow: any[] = []) {
  const res = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title, slug: `r2-${Math.floor(Math.random() * 900000 + 100000)}`,
    baseFee: 1000000, paymentMethods: ['online'], form: [], documents: [], workflow, ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createRequest(service: string) {
  const res = await request(server).post('/api/requests').set('Cookie', customer.cookie)
    .send({ serviceId: service, formData: {}, paymentMethod: 'online' });
  expect(res.status).toBe(201);
  return res.body.data as any;
}

async function assign(requestId: string, to: string) {
  const res = await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie)
    .send({ staffId: to });
  expect(res.status).toBe(200);
  return res.body.data as any;
}

async function detail(id: string, session: any = admin) {
  const res = await request(server).get(`/api/requests/${id}`).set('Cookie', session.cookie);
  expect(res.status).toBe(200);
  return res.body.data as any;
}

async function payInvoiceFull(invoiceId: string, when?: Date) {
  const invoice = await one<any>('SELECT total FROM invoices WHERE id = ?', [invoiceId]);
  const runPay = () => createPayment(
    { customerId, invoiceId, amount: Number(invoice!.total), method: 'online', status: 'confirmed' },
    { id: 'test-accounting', name: 'آزمون حسابداری' },
  );
  if (!when) return runPay();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(when);
  try { return await runPay(); } finally { vi.useRealTimers(); }
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;

  expert = await createStaff('service_expert', r2Expert);
  expertId = await staffId(r2Expert.username);
  await createContract({
    userId: expertId, kind: 'commission', monthlyAmount: 0, commissionPercent: 10,
    startsOn: '2026-01-01', settlementPeriod: 'daily', note: 'قرارداد آزمون دور دوم',
  }, 'test-payroll', 'آزمون');

  expert2 = await createStaff('service_expert', r2Expert2);
  expert2Id = await staffId(r2Expert2.username);

  serviceId = await createService('خدمت هزینه سازمانی آزمون', {
    hasExternalCosts: true,
    externalCostItems: [{ title: 'عوارض ثابت آزمون', amount: 50000 }],
  }, [
    { title: 'بررسی اولیه', kind: 'action' },
    { title: 'تکمیل مدارک توسط مشتری', kind: 'waiting_customer' },
    { title: 'انجام خدمت', kind: 'action' },
    { title: 'تحویل', kind: 'delivery' },
  ]);
  plainServiceId = await createService('خدمت ساده آزمون دور دوم');

  await updateSettings({
    'services.auto_assign': false,
    'services.auto_assign_strategy': 'queue',
    'services.allow_custom_services': true,
    'workforce.auto_assign_on_shift': false,
    'workforce.force_assign_enabled': false,
    'payroll.withdrawal_enabled': true,
    'payroll.min_withdrawal': 1000,
    'payroll.settlement_period': 'daily',
    'payroll.commission_basis': 'net_of_tax',
  } as any, { id: 'system', name: 'round2-setup' }, { confirmCritical: true });
});

afterAll(async () => {
  await updateSettings({
    'services.auto_assign': true,
    'services.auto_assign_strategy': 'least_loaded',
    'workforce.force_assign_enabled': true,
    'payroll.min_withdrawal': 500000,
    'payroll.settlement_period': 'weekly',
  } as any, { id: 'system', name: 'round2-cleanup' }, { confirmCritical: true });
});

describe('organization-fee invoices', () => {
  it('round-trips the external-cost flags through the catalogue', async () => {
    const res = await request(server).get(`/api/catalog/admin/services/${serviceId}`).set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.hasExternalCosts).toBe(true);
    expect(res.body.data.externalCostsNote).toContain('سازمان');
    expect(res.body.data.externalCostItems).toEqual([{ title: 'عوارض ثابت آزمون', amount: 50000 }]);
  });

  it('flows: issue → case waits → customer pays → no commission, case resumes, basis stays clean', async () => {
    const created = await createRequest(serviceId);
    await assign(created.id, expertId);

    const byCustomer = await request(server).post(`/api/requests/${created.id}/external-invoices`)
      .set('Cookie', customer.cookie).send({ title: 'حق بیمه آزمون', amount: 777000 });
    expect(byCustomer.status).toBe(403);

    const issued = await request(server).post(`/api/requests/${created.id}/external-invoices`)
      .set('Cookie', expert.cookie).send({ title: 'حق بیمه تأمین اجتماعی — آزمون', amount: 777000, note: 'مبلغ اعلامی سامانه' });
    expect(issued.status).toBe(201);
    expect(issued.body.data.status).toBe('waiting_customer');

    const external = (issued.body.data.invoices as any[]).find((invoice) => invoice.purpose === 'external_cost');
    expect(external).toBeTruthy();
    expect(external.total).toBe(777000);
    expect(external.status).not.toBe('paid');

    // Customer was told (in-app notification with the invoice key).
    const notices = await q<any>(
      'SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?', [customerId, `external-invoice:${external.id}`],
    );
    expect(notices).toHaveLength(1);

    // Estimate on the card still reflects only the service fee, not the org fee.
    const serviceNet = await one<any>(
      `SELECT COALESCE(SUM(total - tax),0) AS net FROM invoices WHERE request_id = ? AND purpose = 'service'`, [created.id],
    );
    const before = await detail(created.id, expert);
    expect(before.earnings?.state).toBe('estimated');
    expect(before.earnings?.amount).toBe(Math.round(Number(serviceNet!.net) * 10 / 100));

    // Pay the organization fee: pass-through → liability, zero commission,
    // and the parked case resumes on its own.
    const payment: any = await payInvoiceFull(external.id);
    const entries = await q<any>('SELECT id FROM compensation_entries WHERE payment_id = ?', [payment.id]);
    expect(entries).toHaveLength(0);
    const ledger = await one<any>(
      `SELECT account FROM ledger_entries WHERE ref_type = 'payment' AND ref_id = ? AND direction = 'credit'`, [payment.id],
    );
    expect(ledger!.account).toBe('external:liability');

    const after = await detail(created.id, expert);
    expect(after.status).toBe('in_progress');
    expect(after.paymentStatus).toBe('unpaid'); // service invoice still open
    const paidNotices = await q<any>(
      'SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?', [expertId, `external-invoice-paid:${external.id}`],
    );
    expect(paidNotices).toHaveLength(1);

    // Paying the actual service fee accrues commission on the clean basis.
    const mainInvoice = (after.invoices as any[]).find((invoice) => invoice.purpose === 'service');
    await payInvoiceFull(mainInvoice.id, new Date(Date.now() - 10 * 86_400_000));
    const commission = await one<any>(
      `SELECT * FROM compensation_entries WHERE request_id = ? AND kind = 'commission'`, [created.id],
    );
    expect(commission).toBeTruthy();
    expect(Number(commission!.basis_amount)).toBe(Math.round(Number(serviceNet!.net)));
    const finalView = await detail(created.id, expert);
    expect(finalView.paymentStatus).toBe('paid');
  });

  it('blocks experts on unflagged services but lets managers issue', async () => {
    const created = await createRequest(plainServiceId);
    await assign(created.id, expertId);
    const byExpert = await request(server).post(`/api/requests/${created.id}/external-invoices`)
      .set('Cookie', expert.cookie).send({ title: 'هزینه سازمانی آزمون', amount: 1000 });
    expect(byExpert.status).toBe(403);
    const byAdmin = await request(server).post(`/api/requests/${created.id}/external-invoices`)
      .set('Cookie', admin.cookie).send({ title: 'هزینه سازمانی آزمون', amount: 1000 });
    expect(byAdmin.status).toBe(201);
  });
});

describe('presence-aware automatic assignment', () => {
  it('skips staff who have been inactive beyond the online window', async () => {
    const created = await createRequest(plainServiceId);
    await run(
      'UPDATE requests SET created_at = ?, force_assign_at = ? WHERE id = ? AND assigned_to IS NULL',
      [new Date(Date.now() - 3 * 86_400_000).toISOString(), new Date(Date.now() - 86_400_000).toISOString(), created.id],
    );
    await updateSettings({
      'workforce.force_assign_enabled': true,
      'workforce.online_window_minutes': 30,
    } as any, { id: 'system', name: 'round2-presence' }, { confirmCritical: true });
    await run('UPDATE staff_profiles SET accepts_new_cases = 0');
    await run('UPDATE staff_profiles SET accepts_new_cases = 1, max_active_cases = 50 WHERE user_id = ?', [expert2Id]);
    try {
      // Last seen two hours ago → outside the 30-minute window.
      await run('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date(Date.now() - 2 * 3_600_000).toISOString(), expert2Id]);
      await forceAssignSweep();
      let row = await one<any>('SELECT assigned_to FROM requests WHERE id = ?', [created.id]);
      expect(row!.assigned_to).toBeNull();

      // Seen just now → the sweep may place the case with them.
      await run('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), expert2Id]);
      await forceAssignSweep();
      row = await one<any>('SELECT assigned_to FROM requests WHERE id = ?', [created.id]);
      expect(row!.assigned_to).toBe(expert2Id);
    } finally {
      await run('UPDATE staff_profiles SET accepts_new_cases = 1');
      await updateSettings({
        'workforce.force_assign_enabled': false,
        'workforce.online_window_minutes': 120,
      } as any, { id: 'system', name: 'round2-presence-cleanup' }, { confirmCritical: true });
    }
  });
});

describe('follow-up reminders and dashboard alerts', () => {
  it('reminds the owner (and the waiting customer) once a day', async () => {
    const created = await createRequest(serviceId);
    await assign(created.id, expertId);
    const advanced = await request(server).post(`/api/requests/${created.id}/steps/advance`)
      .set('Cookie', expert.cookie).send({});
    expect(advanced.body.data.workBucket).toBe('waiting_customer');
    await run('UPDATE requests SET updated_at = ? WHERE id = ?', [new Date(Date.now() - 49 * 3_600_000).toISOString(), created.id]);

    await followUpReminderSweep();
    await followUpReminderSweep();
    const staffNotices = await q<any>(
      'SELECT id FROM notifications WHERE user_id = ? AND dedupe_key LIKE ?', [expertId, `followup:${created.id}:%`],
    );
    expect(staffNotices).toHaveLength(1);
    const customerNotices = await q<any>(
      'SELECT id FROM notifications WHERE user_id = ? AND dedupe_key LIKE ?', [customerId, `followup-customer:${created.id}:%`],
    );
    expect(customerNotices).toHaveLength(1);
  });

  it('exposes live workforce alerts on the manager dashboard', async () => {
    const created = await createRequest(plainServiceId);
    await run(
      'UPDATE requests SET force_assign_at = ? WHERE id = ? AND assigned_to IS NULL',
      [new Date(Date.now() - 3_600_000).toISOString(), created.id],
    );
    const res = await request(server).get('/api/dashboard/summary').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.workforceAlerts.unassigned).toBeGreaterThanOrEqual(1);
    expect(res.body.data.workforceAlerts.overdueUnassigned).toBeGreaterThanOrEqual(1);
    expect(res.body.data.workforceAlerts.waitingCases).toBeGreaterThanOrEqual(1);
    expect(res.body.data.workforceAlerts.onlineStaff).toBeGreaterThanOrEqual(1);
  });
});

describe('withdrawal receipt and printable report', () => {
  it('stores the bank receipt on the paid withdrawal and shows it to the employee', async () => {
    const balance = await one<any>(
      `SELECT COALESCE(SUM(amount),0) AS total FROM compensation_entries
       WHERE user_id = ? AND kind = 'commission'`, [expertId],
    );
    const amount = Number(balance!.total);
    expect(amount).toBeGreaterThan(1000);

    const createdWithdrawal = await request(server).post('/api/payroll/me/withdrawals')
      .set('Cookie', expert.cookie).send({ amount, note: 'آزمون رسید' });
    expect(createdWithdrawal.status).toBe(201);
    const withdrawalId = createdWithdrawal.body.data.id as string;

    await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/decision`)
      .set('Cookie', admin.cookie).send({ action: 'review', note: 'بررسی شد' }).expect(200);
    await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/decision`)
      .set('Cookie', admin.cookie).send({ action: 'approve', note: 'تأیید' }).expect(200);

    // A receipt id that does not exist must be rejected, not silently stored.
    const bogus = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/pay`)
      .set('Cookie', admin.cookie)
      .send({ method: 'bank_transfer', trackingCode: 'TRK-404', receiptFileId: 'missing-file-id' });
    expect(bogus.status).toBe(400);

    const fileId = `fil_r2receipt${Math.floor(Math.random() * 1e6)}`;
    await run(
      `INSERT INTO files (id, owner_id, name, mime, size, storage_key, purpose, created_at)
       VALUES (?, ?, 'receipt.png', 'image/png', 12, 'test/receipt.png', 'receipt', ?)`,
      [fileId, expertId, new Date().toISOString()],
    );
    const paid = await request(server).post(`/api/payroll/withdrawals/${withdrawalId}/pay`)
      .set('Cookie', admin.cookie)
      .send({ method: 'bank_transfer', trackingCode: 'TRK-R2-1', receiptFileId: fileId });
    expect(paid.status).toBe(200);

    const detailRes = await request(server).get(`/api/payroll/withdrawals/${withdrawalId}`).set('Cookie', admin.cookie);
    expect(detailRes.body.data.receiptFileId).toBe(fileId);
    expect(detailRes.body.data.receiptUrl).toContain(fileId);

    const mine = await request(server).get('/api/payroll/me/withdrawals').set('Cookie', expert.cookie);
    const mineRow = (mine.body.data as any[]).find((row) => row.id === withdrawalId);
    expect(mineRow?.receiptUrl).toContain(fileId);
  });

  it('renders the printable payroll report for managers only', async () => {
    const res = await request(server).get('/api/payroll/reports/print').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('گزارش حقوق و عملکرد کارکنان');
    expect(res.text).toContain('عملکرد پرونده‌ای');
    const asCustomer = await request(server).get('/api/payroll/reports/print').set('Cookie', customer.cookie);
    expect(asCustomer.status).toBe(403);
  });
});

describe('web push subscriptions', () => {
  it('serves a VAPID key and manages device subscriptions', async () => {
    // A case lands in the pool before anyone subscribes: no push, no crash.
    await createRequest(plainServiceId);

    const key = await request(server).get('/api/push/public-key').set('Cookie', expert.cookie);
    expect(key.status).toBe(200);
    expect(key.body.data.enabled).toBe(true);
    expect(String(key.body.data.publicKey).length).toBeGreaterThan(50);
    expect(key.body.data.subscriptions).toBe(0);

    const subscription = {
      endpoint: 'https://push.example.com/subscription/r2-test',
      keys: { p256dh: 'B'.repeat(80), auth: 'A'.repeat(20) },
    };
    const sub = await request(server).post('/api/push/subscribe').set('Cookie', expert.cookie).send(subscription);
    expect(sub.status).toBe(200);

    const afterSub = await request(server).get('/api/push/public-key').set('Cookie', expert.cookie);
    expect(afterSub.body.data.subscriptions).toBe(1);

    // Another case arrives: a delivery is attempted to the (dead) endpoint
    // asynchronously and must not fail the request creation.
    await createRequest(plainServiceId);

    const unsub = await request(server).post('/api/push/unsubscribe')
      .set('Cookie', expert.cookie).send({ endpoint: subscription.endpoint });
    expect(unsub.status).toBe(200);
    const afterUnsub = await request(server).get('/api/push/public-key').set('Cookie', expert.cookie);
    expect(afterUnsub.body.data.subscriptions).toBe(0);
  });
});

describe('customer-initiated custom requests', () => {
  it('intake → priced by expert → accepted → runs with the defining expert', async () => {
    const intake = await request(server).post('/api/catalog/custom-requests')
      .set('Cookie', customer.cookie)
      .send({ title: 'پیگیری پرونده خاص آزمون', description: 'شرح کامل خواستهٔ مشتری برای آزمون خدمت اختصاصی است.' });
    expect(intake.status).toBe(201);
    const intakeId = intake.body.data.id as string;

    const staffList = await request(server).get('/api/catalog/custom-requests').set('Cookie', expert.cookie);
    expect((staffList.body.data as any[]).some((row) => row.id === intakeId && row.customerId === customerId)).toBe(true);

    const offerRes = await request(server).post('/api/catalog/custom-services')
      .set('Cookie', expert.cookie)
      .send({
        customerId, title: 'پیگیری پرونده خاص آزمون', description: 'شرح خدمت اختصاصی تعریف‌شده توسط کارشناس آزمون.',
        baseFee: 2500000, customRequestId: intakeId, assignToCreator: true, expiryHours: 72,
      });
    expect(offerRes.status).toBe(201);

    const intakesAfter = await request(server).get('/api/catalog/custom-requests').set('Cookie', customer.cookie);
    const priced = (intakesAfter.body.data as any[]).find((row) => row.id === intakeId);
    expect(priced?.status).toBe('priced');
    expect(priced?.offerId).toBeTruthy();

    const accepted = await request(server).post(`/api/catalog/offers/${priced.offerId}/accept`)
      .set('Cookie', customer.cookie).send({ formData: {} });
    expect(accepted.status).toBe(200);
    const requestId = accepted.body.data.request.id as string;
    const view = await detail(requestId);
    expect(view.assignedTo).toBe(expertId);
  });

  it('pool mode leaves the accepted case in the free queue', async () => {
    const offerRes = await request(server).post('/api/catalog/custom-services')
      .set('Cookie', expert.cookie)
      .send({
        customerId, title: 'خدمت اختصاصی صف آزاد آزمون', description: 'شرح خدمت اختصاصی برای آزمون صف آزاد.',
        baseFee: 1000000, assignToCreator: false, expiryHours: 72,
      });
    expect(offerRes.status).toBe(201);
    const accepted = await request(server).post(`/api/catalog/offers/${offerRes.body.data.offerId}/accept`)
      .set('Cookie', customer.cookie).send({ formData: {} });
    expect(accepted.status).toBe(200);
    const view = await detail(accepted.body.data.request.id);
    expect(view.assignedTo).toBeNull();
  });

  it('rejects an intake with a reason the customer can see', async () => {
    const intake = await request(server).post('/api/catalog/custom-requests')
      .set('Cookie', customer.cookie)
      .send({ title: 'خواسته خارج از توان دفتر', description: 'شرح خواسته‌ای که دفتر انجام نمی‌دهد برای آزمون رد.' });
    const rejected = await request(server).post(`/api/catalog/custom-requests/${intake.body.data.id}/reject`)
      .set('Cookie', expert.cookie).send({ note: 'این خدمت در حوزهٔ فعالیت دفتر نیست.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('rejected');
    const notices = await q<any>(
      'SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?',
      [customerId, `custom-request-rejected:${intake.body.data.id}`],
    );
    expect(notices).toHaveLength(1);
  });
});
