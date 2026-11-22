import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession, newCustomer } from './helpers.js';
import { one, q, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { createPayment } from '../src/modules/accounting/service.js';
import { createContract } from '../src/modules/payroll/service.js';

/**
 * Three field reports, locked as end-to-end tests:
 *  1. A customer could not open/download the file an executor delivered
 *     (original variant was gated to the uploading staff member only).
 *  2. A percentage employee's income never appeared when the customer paid
 *     BEFORE the case was claimed/assigned (accrual only ran at payment time).
 *  3. The super admin had no way to reset a colleague's password from the
 *     staff edit screen.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let customerId: string;
let expert: any;
let expertId: string;
let serviceId: string;

const expertCreds = { username: 'fix_percent', password: 'FixExpert#12345', fullName: 'کارشناس درصدی اصلاحات' };

async function sessionOf(username: string, password: string) {
  const res = await request(server).post('/api/auth/staff/login').send({ identifier: username, password });
  return { cookie: res.headers['set-cookie'] as unknown as string[], status: res.status, body: res.body };
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  await updateSettings({
    'services.auto_assign': false,
    'services.auto_assign_strategy': 'queue',
    'workforce.auto_assign_on_shift': false,
    'workforce.force_assign_enabled': false,
  }, { id: 'system', name: 'fixes test' });

  expert = await createStaff('service_expert', expertCreds);
  expertId = (await request(server).get('/api/auth/me').set('Cookie', expert.cookie)).body.data.id;
  await createContract({
    userId: expertId, kind: 'commission', monthlyAmount: 0, commissionPercent: 10,
    startsOn: '2026-01-01', settlementPeriod: 'daily', note: 'قرارداد درصدی آزمون اصلاحات',
  }, 'test-payroll', 'آزمون');

  const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title: 'خدمت آزمون اصلاحات', slug: `fixes-${Date.now()}`, baseFee: 1000000,
    paymentMethods: ['online'], form: [], documents: [], workflow: [],
  });
  expect(service.status).toBe(201);
  serviceId = service.body.data.id;
});

async function newPaidRequest() {
  const res = await request(server).post('/api/requests').set('Cookie', customer.cookie)
    .send({ serviceId, formData: {}, paymentMethod: 'online' });
  expect(res.status).toBe(201);
  const created = res.body.data;
  const invoiceId = created.invoices[0].id as string;
  const invoice = await one<any>('SELECT total,tax FROM invoices WHERE id=?', [invoiceId]);
  await createPayment(
    { customerId, invoiceId, amount: Number(invoice.total), method: 'online', status: 'confirmed' },
    { id: 'test-accounting', name: 'آزمون حسابداری' },
  );
  return { created, invoice };
}

describe('delivery file + percentage income (payment before assignment)', () => {
  it('books the commission when a percentage expert claims an already-paid case, and the customer can download the delivered original', async () => {
    const { created, invoice } = await newPaidRequest();
    const requestId = created.id as string;

    // Nobody has taken the case: no income can exist yet.
    const before = await q<any>("SELECT id FROM compensation_entries WHERE request_id=? AND kind='commission'", [requestId]);
    expect(before).toHaveLength(0);

    const claim = await request(server).post(`/api/requests/${requestId}/claim`).set('Cookie', expert.cookie);
    expect(claim.status).toBe(200);

    // The sweep at claim time must have booked the income of the earlier
    // payment for the percentage expert who now owns the case.
    const entries = await q<any>("SELECT * FROM compensation_entries WHERE request_id=? AND kind='commission'", [requestId]);
    expect(entries).toHaveLength(1);
    const officeRevenue = Number(invoice.total) - Number(invoice.tax);
    expect(entries[0].user_id).toBe(expertId);
    expect(Number(entries[0].amount)).toBe(Math.round(officeRevenue * 0.10));

    const earnings = await request(server).get('/api/payroll/me/earnings').set('Cookie', expert.cookie).expect(200);
    expect(earnings.body.data.summary.definite).toBeGreaterThanOrEqual(Number(entries[0].amount));

    // Deliver a PDF result directly to the customer.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\nstartxref\n0\n%%EOF\n');
    const upload = await request(server).post('/api/files/upload?purpose=delivery')
      .set('Cookie', expert.cookie).attach('file', pdf, 'final-result.pdf');
    expect(upload.status).toBe(201);
    const fileId = upload.body.data.id as string;

    const deliver = await request(server).post(`/api/requests/${requestId}/deliver`).set('Cookie', expert.cookie)
      .send({ files: [{ fileId, title: 'نتیجه نهایی خدمت' }], summary: 'کار انجام شد؛ سند نتیجه پیوست است.' });
    expect(deliver.status).toBe(200);
    expect(deliver.body.data.status).toBe('completed');

    // The customer opens the delivered original exactly like the panel does.
    const download = await request(server).get(`/api/files/${fileId}?variant=original&download=true`)
      .set('Cookie', customer.cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(String(download.headers['content-type'])).toContain('application/pdf');
    expect((download.body as Buffer).subarray(0, 4).toString('latin1')).toBe('%PDF');

    // Another customer still gets nothing.
    const stranger = await newCustomer();
    const denied = await request(server).get(`/api/files/${fileId}?variant=original`).set('Cookie', stranger.session.cookie);
    expect(denied.status).toBe(403);
  });

  it('reconcile backfills a historically missed commission and is idempotent', async () => {
    const { created } = await newPaidRequest();
    const requestId = created.id as string;
    // Simulate pre-fix data: paid case assigned straight in the database, so
    // no claim/assign/deliver hook ever ran for it.
    await run("UPDATE requests SET assigned_to=?, status='in_progress' WHERE id=?", [expertId, requestId]);
    expect(await q<any>("SELECT id FROM compensation_entries WHERE request_id=? AND kind='commission'", [requestId])).toHaveLength(0);

    const first = await request(server).post('/api/payroll/commissions/reconcile').set('Cookie', admin.cookie).send({});
    expect(first.status).toBe(200);
    expect(first.body.data.accruedPayments).toBeGreaterThanOrEqual(1);
    const entries = await q<any>("SELECT id FROM compensation_entries WHERE request_id=? AND kind='commission'", [requestId]);
    expect(entries).toHaveLength(1);

    const second = await request(server).post('/api/payroll/commissions/reconcile').set('Cookie', admin.cookie).send({});
    expect(second.status).toBe(200);
    expect(second.body.data.accruedPayments).toBe(0);
    expect(await q<any>("SELECT id FROM compensation_entries WHERE request_id=? AND kind='commission'", [requestId])).toHaveLength(1);
  });
});

describe('super-admin password reset for staff', () => {
  it('lets only the super admin reset a colleague password, and the new password works', async () => {
    const victim = await createStaff('operator', { username: 'fix_victim', password: 'VictimOld#12345', fullName: 'کارمند فراموش‌کار' });
    const victimId = (await request(server).get('/api/auth/me').set('Cookie', victim.cookie)).body.data.id as string;
    const manager = await createStaff('manager', { username: 'fix_manager', password: 'FixManager#12345', fullName: 'مدیر دفتر آزمون' });

    // The office manager may edit staff but must not reset passwords.
    const plainEdit = await request(server).patch(`/api/staff/${victimId}`).set('Cookie', manager.cookie)
      .send({ position: 'کارشناس امور اداری' });
    expect(plainEdit.status).toBe(200);
    const managerReset = await request(server).patch(`/api/staff/${victimId}`).set('Cookie', manager.cookie)
      .send({ newPassword: 'ManagerSet#12345' });
    expect(managerReset.status).toBe(403);

    // Old password still valid after the refused attempt.
    expect((await sessionOf('fix_victim', 'VictimOld#12345')).status).toBe(200);

    // Super admin resets it from the same edit endpoint.
    const reset = await request(server).patch(`/api/staff/${victimId}`).set('Cookie', admin.cookie)
      .send({ newPassword: 'FreshStart#1405' });
    expect(reset.status).toBe(200);

    expect((await sessionOf('fix_victim', 'VictimOld#12345')).status).not.toBe(200);
    expect((await sessionOf('fix_victim', 'FreshStart#1405')).status).toBe(200);

    // The session the employee held before the reset is dead.
    const stale = await request(server).get('/api/auth/me').set('Cookie', victim.cookie);
    expect(stale.status).toBe(401);
  });
});
