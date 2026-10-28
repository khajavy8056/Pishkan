import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { app, adminSession, customerSession, createStaff } from '../tests/helpers.js';
import { one, run, nowIso } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { defaultValues } from '../src/modules/settings/definitions.js';
import { createBackup } from '../src/modules/system/backup.js';
import { env } from '../src/env.js';
import path from 'node:path';

// Run from repo root:
// npm exec --workspace apps/api -- vitest run --config audit.config.ts
// Intentionally fails until the implementation meets these requirements.
const actor = { id: 'system', name: 'acceptance-audit' };
let server: Awaited<ReturnType<typeof app>>;
let admin: Awaited<ReturnType<typeof adminSession>>;
let customer: Awaited<ReturnType<typeof customerSession>>;
let customerId: string;
let serviceId: string;
let sequence = 0;

async function makeRequest(priority = 'normal') {
  return request(server).post('/api/requests').set('Cookie', customer.cookie)
    .send({ serviceId, formData: {}, paymentMethod: 'cash', priority });
}
async function invoice() {
  const res = await request(server).post('/api/accounting/invoices').set('Cookie', admin.cookie)
    .send({ customerId, title: 'Audit invoice', items: [{ title: 'Audit item', qty: 1, unitPrice: 500000 }] });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  await updateSettings({ 'services.auto_assign': false }, actor);
  const res = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie)
    .send({ title: 'Audit service', slug: 'audit-service', baseFee: 1000000, estimatedDays: 3, form: [], documents: [], workflow: [] });
  expect(res.status).toBe(201);
  serviceId = res.body.data.id;
});

describe('Requirements acceptance audit (release blockers)', () => {
  it('A01: fresh installation supports password signup without SMS', () => {
    const values = defaultValues();
    expect.soft(values['auth.customer_password_enabled']).toBe(true);
    expect.soft(values['auth.customer_otp_enabled']).toBe(false);
  });

  it('A02: customer signup persists the chosen username', async () => {
    await updateSettings({ 'auth.customer_require_mobile_verification': false }, actor);
    const res = await request(server).post('/api/auth/register').send({
      mobile: '09125557001', fullName: 'Audit username', username: 'chosen_audit_user', password: 'Audit#Password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBe('chosen_audit_user');
  });

  it('A03: disabling mandatory SMS does not falsely mark mobile ownership verified', async () => {
    await updateSettings({ 'auth.customer_require_mobile_verification': false }, actor);
    const res = await request(server).post('/api/auth/register').send({
      mobile: '09125557002', fullName: 'Audit unverified', password: 'Audit#Password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.mobileVerified).toBe(false);
  });

  it('A04: incomplete profile cannot submit a service request', async () => {
    await run('UPDATE customer_profiles SET city_id=NULL,city=NULL WHERE user_id=?',[customerId]);
    try {
      const res = await makeRequest();
      expect(res.status).toBe(403);
    } finally {
      await run("UPDATE customer_profiles SET city_id='tehran',city='تهران' WHERE user_id=?",[customerId]);
    }
  });

  it('A05: customer cannot claim paid urgent priority on an unconfigured service', async () => {
    const res = await makeRequest('high');
    expect(res.status).toBe(400);
  });

  it('A06: operator cannot read a case assigned to another worker', async () => {
    const created = await makeRequest();
    expect(created.status).toBe(201);
    const operator = await createStaff('operator', { username: 'audit_operator', password: 'Audit#Password123', fullName: 'Audit operator' });
    const other = await createStaff('operator', { username: 'audit_other_worker', password: 'Audit#Password123', fullName: 'Audit other worker' });
    const otherMe = await request(server).get('/api/auth/me').set('Cookie', other.cookie);
    await request(server).patch(`/api/requests/${created.body.data.id}/assign`).set('Cookie', admin.cookie)
      .send({ staffId: otherMe.body.data.id }).expect(200);
    const res = await request(server).get(`/api/requests/${created.body.data.id}`).set('Cookie', operator.cookie);
    expect([403, 404]).toContain(res.status);
  });

  it('A07: service expert cannot read all office invoices as personal accounting', async () => {
    const unrelatedInvoice = await invoice();
    const expert = await createStaff('service_expert', { username: 'audit_expert', password: 'Audit#Password123', fullName: 'Audit expert' });
    const res = await request(server).get('/api/accounting/invoices').set('Cookie', expert.cookie);
    if (res.status === 403) return;
    expect(res.status).toBe(200);
    expect(res.body.data.map((item: any) => item.id)).not.toContain(unrelatedInvoice.id);
  });

  it('A08: customer note response must not disclose internal-only case events', async () => {
    const created = await makeRequest();
    expect(created.status).toBe(201);
    const url = `/api/requests/${created.body.data.id}/notes`;
    await request(server).post(url).set('Cookie', admin.cookie)
      .send({ message: 'AUDIT_INTERNAL_ONLY', visibleToCustomer: false }).expect(200);
    const res = await request(server).post(url).set('Cookie', customer.cookie)
      .send({ message: 'Customer reply' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('AUDIT_INTERNAL_ONLY');
  });

  it('A09: customer cannot attach a private file owned by someone else', async () => {
    const created = await makeRequest();
    const uploaded = await request(server).post('/api/files/upload').set('Cookie', admin.cookie)
      .attach('file', Buffer.from('%PDF-1.4\nAudit private document\n'), { filename: 'audit-private.pdf', contentType: 'application/pdf' });
    expect(uploaded.status).toBe(201);
    const res = await request(server).post(`/api/requests/${created.body.data.id}/documents`)
      .set('Cookie', customer.cookie).send({ fileId: uploaded.body.data.id, title: 'Unowned file' });
    expect(res.status).toBe(403);
  });

  it('A10: successful password reset returns a usable new session', async () => {
    const mobile = '09125557003';
    await request(server).post('/api/auth/register').send({ mobile, fullName: 'Audit reset', password: 'Audit#Password123' }).expect(201);
    const otp = await request(server).post('/api/auth/otp/request').send({ mobile, purpose: 'reset' });
    expect(otp.status).toBe(200);
    const reset = await request(server).post('/api/auth/password/reset').send({ mobile, code: otp.body.data.debugCode, newPassword: 'Audit#Changed123' });
    expect(reset.status).toBe(200);
    const me = await request(server).get('/api/auth/me').set('Cookie', reset.headers['set-cookie'] as unknown as string[]);
    expect(me.status).toBe(200);
  });

  it('A11: full refund returns net revenue to its pre-payment value', async () => {
    const inv = await invoice();
    const before = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    const payment = await request(server).post('/api/accounting/payments').set('Cookie', admin.cookie)
      .send({ customerId, invoiceId: inv.id, amount: 500000, method: 'cash' });
    expect(payment.status).toBe(201);
    await request(server).post(`/api/accounting/payments/${payment.body.data.id}/refund`).set('Cookie', admin.cookie)
      .send({ reason: 'Audit full refund' }).expect(200);
    const after = await request(server).get('/api/accounting/reports/summary').set('Cookie', admin.cookie);
    expect(after.body.data.summary.revenue).toBe(before.body.data.summary.revenue);
  });

  it('A12: SQLite backup includes committed data still present in WAL', async () => {
    const marker = `audit-marker-${++sequence}`;
    await run('INSERT INTO expense_categories (id, title, created_at) VALUES (?, ?, ?)', [marker, marker, nowIso()]);
    const backup = await createBackup(actor, 'Audit WAL preservation');
    const db = new DatabaseSync(path.join(backup.location!, backup.filename), { readOnly: true });
    let found = false;
    try {
      found = Boolean(db.prepare('SELECT id FROM expense_categories WHERE id = ?').get(marker));
    } catch { /* missing table/data means the snapshot is not complete */ }
    finally { db.close(); }
    expect(found).toBe(true);
  });

  it('A13: staff OTP login resolves the staff account, not a new customer', async () => {
    const staff = await createStaff('operator', { username: 'audit_otp_staff', password: 'Audit#Password123', fullName: 'Audit OTP staff' });
    const me = await request(server).get('/api/auth/me').set('Cookie', staff.cookie);
    const mobile = me.body.data.mobile;
    const otp = await request(server).post('/api/auth/otp/request').send({ mobile });
    expect(otp.status).toBe(200);
    const res = await request(server).post('/api/auth/otp/verify').send({ mobile, code: otp.body.data.debugCode });
    expect(res.status).toBe(200);
    expect(res.body.data.user.kind).toBe('staff');
  });

  it('A14: selecting Zarinpal must not return a mock payment URL', async () => {
    await updateSettings({ 'accounting.online_payment_enabled': true, 'accounting.gateway': 'zarinpal' }, actor);
    const inv = await invoice();
    const res = await request(server).post(`/api/accounting/my/invoices/${inv.id}/pay`).set('Cookie', customer.cookie);
    // An unconfigured provider should explicitly reject. A configured one should
    // return a genuine provider URL, never the mock path. No external call here.
    if (res.status >= 400) return;
    expect(res.status).toBe(200);
    expect(res.body.data.paymentUrl).not.toContain('/callback/mock');
  });

  it('A15: internal manager cannot reset a super-admin password', async () => {
    const protectedAdmin = await createStaff('super_admin', { username: 'audit_protected_admin', password: 'Audit#Password123', fullName: 'Audit protected admin' });
    const protectedMe = await request(server).get('/api/auth/me').set('Cookie', protectedAdmin.cookie);
    const manager = await createStaff('manager', { username: 'audit_manager', password: 'Audit#Password123', fullName: 'Audit manager' });
    const res = await request(server).patch(`/api/staff/${protectedMe.body.data.id}`).set('Cookie', manager.cookie)
      .send({ newPassword: 'Audit#ChangedByManager123' });
    expect(res.status).toBe(403);
  });

  it('A16: accepting a custom proposal must not create a duplicate issued invoice', async () => {
    admin = await adminSession();
    const offer = await request(server).post('/api/catalog/custom-services').set('Cookie', admin.cookie)
      .send({ customerId, title: 'Audit custom offer', description: 'Audit custom proposal description', baseFee: 500000, form: [], documents: [] });
    expect(offer.status).toBe(201);
    const accepted = await request(server).post(`/api/catalog/offers/${offer.body.data.offerId}/accept`)
      .set('Cookie', customer.cookie).send({ formData: {}, paymentMethod: 'cash' });
    expect(accepted.status).toBe(200);
    const count = await one<any>("SELECT COUNT(*) AS c FROM invoices WHERE request_id = ? AND status <> 'void'", [accepted.body.data.request.id]);
    expect(Number(count?.c)).toBe(1);
  });

});
