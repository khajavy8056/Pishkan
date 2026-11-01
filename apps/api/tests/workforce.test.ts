import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { one, q, run } from '../src/db/index.js';
import { createPayment, refundPayment } from '../src/modules/accounting/service.js';
import { createContract } from '../src/modules/payroll/service.js';
import { forceAssignSweep } from '../src/modules/requests/service.js';

/**
 * Workforce spec items shipped in this round: typed workflow steps + the
 * step engine, work buckets, weighted capacity, per-service commission
 * percent, manager-approved commission split, overdue-unassigned alerts and
 * the payroll performance/CSV report. Everything runs through the real HTTP
 * API or the real domain services against the shared seeded database.
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
let oddServiceId: string;

const creditExpert = { username: 'wf_expert', password: 'Expert#12345', fullName: 'کارشناس نیروی کار آزمون' };
const creditExpert2 = { username: 'wf_expert_two', password: 'Expert#12345', fullName: 'کارشناس دوم نیروی کار آزمون' };

async function staffId(username: string) {
  return (await one<any>('SELECT id FROM users WHERE username = ?', [username]))!.id as string;
}

async function createService(title: string, workflow: any[] = [], baseFee = 1000000) {
  const res = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title, slug: `wf-${Math.floor(Math.random() * 900000 + 100000)}`,
    baseFee, paymentMethods: ['online'], form: [], documents: [], workflow,
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

async function assign(requestId: string, staffIdValue: string) {
  const res = await request(server).patch(`/api/requests/${requestId}/assign`).set('Cookie', admin.cookie)
    .send({ staffId: staffIdValue });
  expect(res.status).toBe(200);
  return res.body.data as any;
}

async function detail(id: string, session: any = admin) {
  const res = await request(server).get(`/api/requests/${id}`).set('Cookie', session.cookie);
  expect(res.status).toBe(200);
  return res.body.data as any;
}

async function pay(created: any) {
  const invoiceId = created.invoices[0].id as string;
  const invoice = await one<any>('SELECT total FROM invoices WHERE id = ?', [invoiceId]);
  const payment: any = await createPayment(
    { customerId, invoiceId, amount: Number(invoice!.total), method: 'online', status: 'confirmed' },
    { id: 'test-accounting', name: 'آزمون حسابداری' },
  );
  return payment;
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;

  expert = await createStaff('service_expert', creditExpert);
  expertId = await staffId(creditExpert.username);
  await createContract({
    userId: expertId, kind: 'commission', monthlyAmount: 0, commissionPercent: 10,
    startsOn: '2026-01-01', settlementPeriod: 'daily', note: 'قرارداد درصدی آزمون نیروی کار',
  }, 'test-payroll', 'آزمون');

  expert2 = await createStaff('service_expert', creditExpert2);
  expert2Id = await staffId(creditExpert2.username);
  await createContract({
    userId: expert2Id, kind: 'commission', monthlyAmount: 0, commissionPercent: 20,
    startsOn: '2026-01-01', settlementPeriod: 'daily', note: 'قرارداد درصدی کارشناس دوم آزمون نیروی کار',
  }, 'test-payroll', 'آزمون');

  serviceId = await createService('خدمت مراحل نیروی کار', [
    { title: 'بررسی اولیه', description: '', kind: 'action' },
    { title: 'تکمیل مدارک توسط مشتری', description: '', kind: 'waiting_customer' },
    { title: 'ثبت در سامانه', description: '', kind: 'action' },
    { title: 'صدور نتیجه توسط سازمان', description: '', kind: 'waiting_organization' },
    { title: 'تحویل نتیجه', description: '', kind: 'delivery' },
  ]);
  // Odd fee so percentage pools produce a rounding remainder.
  oddServiceId = await createService('خدمت تقسیم سهم نیروی کار', [
    { title: 'انجام خدمت', description: '', kind: 'action' },
    { title: 'تحویل', description: '', kind: 'delivery' },
  ], 1000003);

  await updateSettings({
    'services.auto_assign': false,
    'services.auto_assign_strategy': 'queue',
    'workforce.auto_assign_on_shift': false,
    'workforce.force_assign_enabled': false,
    'workforce.waiting_case_weight': 25,
    'payroll.commission_basis': 'net_of_tax',
  } as any, { id: 'system', name: 'workforce-setup' }, { confirmCritical: true });
});

afterAll(async () => {
  await updateSettings({
    'services.auto_assign': true,
    'services.auto_assign_strategy': 'least_loaded',
    'workforce.force_assign_enabled': true,
  } as any, { id: 'system', name: 'workforce-cleanup' }, { confirmCritical: true });
});

describe('typed workflow steps and the step engine', () => {
  it('preserves step kinds through the catalogue API', async () => {
    const res = await request(server).get(`/api/catalog/admin/services/${serviceId}`).set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    const kinds = (res.body.data.workflow ?? []).map((step: any) => step.kind);
    expect(kinds).toEqual(['action', 'waiting_customer', 'action', 'waiting_organization', 'delivery']);
  });

  it('moving steps drives the work bucket and mirrors the matching status', async () => {
    const created = await createRequest(serviceId);
    await assign(created.id, expertId);

    let current = await detail(created.id, expert);
    expect(current.currentStep).toBe(0);
    expect(current.currentStepKind).toBe('action');
    expect(current.workBucket).toBe('action');
    expect(current.nextStepTitle).toBe('تکمیل مدارک توسط مشتری');
    expect(current.assignmentSource).toBe('manual');

    // Customers and other staff may not move steps.
    const byCustomer = await request(server).post(`/api/requests/${created.id}/steps/advance`)
      .set('Cookie', customer.cookie).send({});
    expect(byCustomer.status).toBe(403);
    const byOtherStaff = await request(server).post(`/api/requests/${created.id}/steps/advance`)
      .set('Cookie', expert2.cookie).send({});
    expect(byOtherStaff.status).toBe(403);

    const step1 = await request(server).post(`/api/requests/${created.id}/steps/advance`)
      .set('Cookie', expert.cookie).send({ note: 'از مشتری سند خواسته شد' });
    expect(step1.status).toBe(200);
    expect(step1.body.data.currentStep).toBe(1);
    expect(step1.body.data.workBucket).toBe('waiting_customer');
    expect(step1.body.data.status).toBe('waiting_customer');

    const step2 = await request(server).post(`/api/requests/${created.id}/steps/advance`)
      .set('Cookie', expert.cookie).send({});
    expect(step2.status).toBe(200);
    expect(step2.body.data.currentStep).toBe(2);
    expect(step2.body.data.status).toBe('in_progress');
    expect(step2.body.data.workBucket).toBe('in_progress');

    const step3 = await request(server).post(`/api/requests/${created.id}/steps/advance`)
      .set('Cookie', expert.cookie).send({});
    expect(step3.body.data.currentStepKind).toBe('waiting_organization');
    expect(step3.body.data.workBucket).toBe('waiting_organization');

    const back = await request(server).post(`/api/requests/${created.id}/steps/back`)
      .set('Cookie', expert.cookie).send({});
    expect(back.body.data.currentStep).toBe(2);
    expect(back.body.data.workBucket).toBe('in_progress');

    // Bucket filter on the list endpoint finds the same case.
    const list = await request(server).get('/api/requests?mine=true&bucket=in_progress&group=open')
      .set('Cookie', expert.cookie);
    expect(list.status).toBe(200);
    expect((list.body.data as any[]).some((item) => item.id === created.id)).toBe(true);
    const waitingList = await request(server).get('/api/requests?mine=true&bucket=waiting_customer&group=open')
      .set('Cookie', expert.cookie);
    expect((waitingList.body.data as any[]).some((item) => item.id === created.id)).toBe(false);

    current = await detail(created.id, expert);
    expect(current.currentStepTitle).toBe('ثبت در سامانه');
    expect(current.nextStepTitle).toBe('صدور نتیجه توسط سازمان');
  });
});

describe('per-service commission percent', () => {
  it('is manager-managed, overrides the contract percent at accrual, and is snapshotted', async () => {
    const forbiddenPut = await request(server).put(`/api/payroll/staff/${expertId}/service-percents`)
      .set('Cookie', expert.cookie).send({ items: [{ serviceId, percent: 30 }] });
    expect(forbiddenPut.status).toBe(403);

    const put = await request(server).put(`/api/payroll/staff/${expertId}/service-percents`)
      .set('Cookie', admin.cookie).send({ items: [{ serviceId, percent: 30, note: 'درصد ویژه خدمت آزمون' }] });
    expect(put.status).toBe(200);
    expect(Array.isArray(put.body.data)).toBe(true);
    expect(put.body.data).toHaveLength(1);
    expect(put.body.data[0].percent).toBe(30);
    expect(put.body.data[0].serviceId).toBe(serviceId);

    const created = await createRequest(serviceId);
    await assign(created.id, expertId);
    await pay(created);

    const entries = await q<any>(
      `SELECT * FROM compensation_entries WHERE request_id = ? AND kind = 'commission'`, [created.id],
    );
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].percent)).toBe(30);
    expect(Number(entries[0].amount)).toBe(Math.round(Number(entries[0].basis_amount) * 30 / 100));
    const snapshot = JSON.parse(entries[0].snapshot ?? '{}');
    expect(snapshot.percent).toBe(30);
    expect(snapshot.servicePercentOverride).toBe(30);

    // Removing the override afterwards never rewrites the recorded entry.
    await request(server).put(`/api/payroll/staff/${expertId}/service-percents`)
      .set('Cookie', admin.cookie).send({ items: [] }).expect(200);
    const after = await one<any>('SELECT percent FROM compensation_entries WHERE id = ?', [entries[0].id]);
    expect(Number(after!.percent)).toBe(30);
  });
});

describe('multi-staff commission split', () => {
  it('splits the pool by manager-approved shares, locks after accrual and reverses per person', async () => {
    const created = await createRequest(oddServiceId);
    await assign(created.id, expertId);

    const invalid = await request(server).put(`/api/requests/${created.id}/shares`)
      .set('Cookie', admin.cookie)
      .send({ shares: [{ userId: expertId, sharePercent: 50 }, { userId: expert2Id, sharePercent: 40 }] });
    expect(invalid.status).toBe(400);

    const byExpert = await request(server).put(`/api/requests/${created.id}/shares`)
      .set('Cookie', expert.cookie)
      .send({ shares: [{ userId: expertId, sharePercent: 60 }, { userId: expert2Id, sharePercent: 40 }] });
    expect(byExpert.status).toBe(403);

    const saved = await request(server).put(`/api/requests/${created.id}/shares`)
      .set('Cookie', admin.cookie)
      .send({ shares: [{ userId: expertId, sharePercent: 60 }, { userId: expert2Id, sharePercent: 40 }] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.shares).toHaveLength(2);
    expect(saved.body.data.locked).toBe(false);

    const payment = await pay(created);
    const entries = await q<any>(
      `SELECT * FROM compensation_entries WHERE request_id = ? AND kind = 'commission' ORDER BY amount DESC`, [created.id],
    );
    expect(entries).toHaveLength(2);
    const byUser = new Map(entries.map((row) => [row.user_id, Number(row.amount)]));
    const pool = [...byUser.values()].reduce((sum, value) => sum + value, 0);
    // Pool is the assignee's earning: 10% of the office revenue basis.
    expect(pool).toBe(Math.round(Number(entries[0].basis_amount) * 10 / 100));
    // 60/40 of the pool, conserving every rial; the rounding remainder goes
    // to the largest share (floor 40-share, remainder to 60-share).
    expect(byUser.get(expertId)).toBe(pool - Math.floor((pool * 40) / 100));
    expect(byUser.get(expert2Id)).toBe(Math.floor((pool * 40) / 100));

    const lockedPut = await request(server).put(`/api/requests/${created.id}/shares`)
      .set('Cookie', admin.cookie)
      .send({ shares: [{ userId: expertId, sharePercent: 100 }] });
    expect(lockedPut.status).toBe(409);

    await updateSettings({ 'accounting.allow_refund': true } as any,
      { id: 'system', name: 'workforce-refund' }, { confirmCritical: true });
    await refundPayment(payment.id, 'بازگشت آزمون تقسیم سهم', { id: 'test', name: 'آزمون' });
    const net = await q<any>(
      `SELECT user_id, SUM(amount) AS total FROM compensation_entries
       WHERE request_id = ? GROUP BY user_id`, [created.id],
    );
    expect(net.length).toBeGreaterThanOrEqual(2);
    for (const row of net) expect(Number(row.total)).toBe(0);
  });
});

describe('weighted capacity and the overdue-unassigned alert', () => {
  it('lets staff with only waiting cases claim within a max of 1 real case', async () => {
    await run('UPDATE staff_profiles SET max_active_cases = 1 WHERE user_id = ?', [expert2Id]);
    try {
      const first = await createRequest(serviceId);
      await assign(first.id, expert2Id);
      const advanced = await request(server).post(`/api/requests/${first.id}/steps/advance`)
        .set('Cookie', expert2.cookie).send({});
      expect(advanced.body.data.workBucket).toBe('waiting_customer');

      const second = await createRequest(serviceId);
      const claim = await request(server).post(`/api/requests/${second.id}/claim`)
        .set('Cookie', expert2.cookie).send({});
      // Weighted load = 0.25 (waiting) < 1 → claim allowed even though the
      // raw case count already equals the max.
      expect(claim.status).toBe(200);
      const claimed = await detail(second.id, expert2);
      expect(claimed.assignedTo).toBe(expert2Id);
      const over = await detail(second.id, expert2);
      expect(over.assignmentSource).toBe('claimed');
    } finally {
      await run('UPDATE staff_profiles SET max_active_cases = 20 WHERE user_id = ?', [expert2Id]);
    }
  });

  it('alerts managers once a day when an overdue request finds nobody available', async () => {
    const created = await createRequest(serviceId);
    await run(
      `UPDATE requests SET created_at = ?, force_assign_at = ? WHERE id = ?`,
      [new Date(Date.now() - 3 * 86_400_000).toISOString(), new Date(Date.now() - 86_400_000).toISOString(), created.id],
    );
    await updateSettings({ 'workforce.force_assign_enabled': true } as any,
      { id: 'system', name: 'workforce-sweep' }, { confirmCritical: true });
    await run('UPDATE staff_profiles SET accepts_new_cases = 0');
    try {
      await forceAssignSweep();
      await forceAssignSweep();
      const adminRow = await one<any>("SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE code = 'super_admin') LIMIT 1");
      const alerts = await q<any>(
        `SELECT id FROM notifications WHERE user_id = ? AND dedupe_key LIKE ?`,
        [adminRow!.id, `unassigned-overdue:${created.id}:%`],
      );
      expect(alerts).toHaveLength(1);
      const stillOpen = await one<any>('SELECT assigned_to FROM requests WHERE id = ?', [created.id]);
      expect(stillOpen!.assigned_to).toBeNull();
    } finally {
      await run('UPDATE staff_profiles SET accepts_new_cases = 1');
      await updateSettings({ 'workforce.force_assign_enabled': false } as any,
        { id: 'system', name: 'workforce-sweep-cleanup' }, { confirmCritical: true });
    }
  });
});

describe('payroll performance report', () => {
  it('includes per-staff performance and exports as Excel-ready CSV', async () => {
    const report = await request(server).get('/api/payroll/reports').set('Cookie', admin.cookie);
    expect(report.status).toBe(200);
    expect(Array.isArray(report.body.data.performance)).toBe(true);
    const mine = (report.body.data.performance as any[]).find((row) => row.userId === expertId);
    expect(mine).toBeTruthy();
    expect(typeof mine.received).toBe('number');

    const csv = await request(server).get('/api/payroll/reports/export.csv').set('Cookie', admin.cookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.startsWith('﻿')).toBe(true);
    expect(csv.text).toContain('عملکرد پرونده‌ای');
  });
});
