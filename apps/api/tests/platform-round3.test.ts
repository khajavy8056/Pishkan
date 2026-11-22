import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession, login } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { one, run } from '../src/db/index.js';

/**
 * Round 3 product behavior requested by the office:
 *  - the executor delivers straight to the customer (note + optional files)
 *    and the case completes; manager approval exists only for services that
 *    explicitly opt in,
 *  - notifications really flow: step progress, new free-pool cases for every
 *    eligible expert (bell + push), chat pointers that deep-link correctly,
 *  - the cooperation contract (fixed salary vs. percentage) is chosen when
 *    the employee is defined and shows up on the staff directory.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let customer: any;
let customerId: string;
let expert: any;
let expertId: string;
let directServiceId: string;
let approvalServiceId: string;

const r3Expert = { username: 'r3_expert', password: 'Expert#12345', fullName: 'مجری دور سوم' };

const pdfFixture = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\nstartxref\n0\n%%EOF\n');

async function staffId(username: string) {
  return (await one<any>('SELECT id FROM users WHERE username = ?', [username]))!.id as string;
}

async function createService(title: string, extra: Record<string, unknown> = {}) {
  const res = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title, slug: `r3-${Math.floor(Math.random() * 900000 + 100000)}`,
    baseFee: 1000000, paymentMethods: ['online'], form: [], documents: [],
    workflow: [
      { title: 'بررسی اولیه', kind: 'action' },
      { title: 'انجام خدمت', kind: 'action' },
      { title: 'تحویل به مشتری', kind: 'delivery' },
    ],
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createAssignedRequest(service: string) {
  const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
    .send({ serviceId: service, formData: {}, paymentMethod: 'online' });
  expect(created.status).toBe(201);
  const id = created.body.data.id as string;
  const assigned = await request(server).patch(`/api/requests/${id}/assign`).set('Cookie', admin.cookie)
    .send({ staffId: expertId });
  expect(assigned.status).toBe(200);
  const advanced = await request(server).post(`/api/requests/${id}/steps/advance`).set('Cookie', expert.cookie).send({});
  expect(advanced.status).toBe(200);
  return id;
}

async function uploadResult(session: any, name: string) {
  const res = await request(server).post('/api/files/upload?purpose=delivery')
    .set('Cookie', session.cookie).attach('file', pdfFixture, name);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function notificationsOf(session: any) {
  const res = await request(server).get('/api/customers/me/notifications?limit=50').set('Cookie', session.cookie);
  expect(res.status).toBe(200);
  return res.body.data as any[];
}

async function detail(id: string, session: any) {
  const res = await request(server).get(`/api/requests/${id}`).set('Cookie', session.cookie);
  expect(res.status).toBe(200);
  return res.body.data as any;
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  expert = await createStaff('service_expert', r3Expert);
  expertId = await staffId(r3Expert.username);

  directServiceId = await createService('خدمت تحویل مستقیم آزمون');
  approvalServiceId = await createService('خدمت حساس نیازمند تأیید مدیر آزمون', { requiresManagerApproval: true });
  // Make the expert an eligible candidate for both services.
  for (const service of [directServiceId, approvalServiceId]) {
    await run('INSERT INTO service_staff (service_id, user_id, priority) VALUES (?, ?, 0)', [service, expertId]);
  }

  await updateSettings({
    'services.auto_assign': false,
    'services.auto_assign_strategy': 'queue',
    'workforce.auto_assign_on_shift': false,
    'workforce.force_assign_enabled': false,
  } as any, { id: 'system', name: 'round3-setup' }, { confirmCritical: true });
});

afterAll(async () => {
  await updateSettings({
    'services.auto_assign': true,
    'services.auto_assign_strategy': 'least_loaded',
    'workforce.force_assign_enabled': true,
  } as any, { id: 'system', name: 'round3-cleanup' }, { confirmCritical: true });
});

describe('direct customer delivery (the normal path)', () => {
  it('executor delivers with a note and a file — case completes at once, customer sees everything', async () => {
    const requestId = await createAssignedRequest(directServiceId);
    const fileId = await uploadResult(expert, 'result-r3.pdf');

    const delivered = await request(server).post(`/api/requests/${requestId}/deliver`)
      .set('Cookie', expert.cookie)
      .send({ files: [{ fileId, title: 'گواهی صادره' }], summary: 'گواهی صادر شد؛ تصویر آن پیوست است و اصل مدرک در دفتر آماده تحویل حضوری است.' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data).toMatchObject({ status: 'completed', mode: 'direct' });

    const asCustomer = await detail(requestId, customer);
    expect(asCustomer.status).toBe('completed');
    expect(asCustomer.currentStep).toBe(2); // pinned to the last (delivery) step
    const deliveryEvent = asCustomer.events.find((e: any) => e.type === 'delivery');
    expect(deliveryEvent).toBeTruthy();
    expect(deliveryEvent.message).toContain('گواهی صادر شد');
    const resultDoc = asCustomer.documents.find((d: any) => d.title === 'گواهی صادره');
    expect(resultDoc).toBeTruthy();
    expect(resultDoc.status).toBe('approved'); // visible without any manager review

    const notice = (await notificationsOf(customer)).find((n) => n.title === 'درخواست شما تحویل شد');
    expect(notice).toBeTruthy();
    expect(notice.link).toBe(`/app/requests/${requestId}`);
  });

  it('delivery without any file is fine too (note-only outcome)', async () => {
    const requestId = await createAssignedRequest(directServiceId);
    const delivered = await request(server).post(`/api/requests/${requestId}/deliver`)
      .set('Cookie', expert.cookie)
      .send({ files: [], summary: 'ثبت‌نام شما در سامانه سازمان انجام شد؛ کد رهگیری پیامک شده است.' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.status).toBe('completed');
    const asCustomer = await detail(requestId, customer);
    expect(asCustomer.events.some((e: any) => e.type === 'delivery' && e.message.includes('کد رهگیری'))).toBe(true);
  });

  it('a closed case cannot be delivered twice', async () => {
    const requestId = await createAssignedRequest(directServiceId);
    await request(server).post(`/api/requests/${requestId}/deliver`).set('Cookie', expert.cookie)
      .send({ files: [], summary: 'کار انجام و تحویل داده شد.' }).expect(200);
    const again = await request(server).post(`/api/requests/${requestId}/deliver`).set('Cookie', expert.cookie)
      .send({ files: [], summary: 'تلاش دوباره برای تحویل پرونده بسته' });
    expect(again.status).toBe(409);
  });
});

describe('manager-approved delivery (special services only)', () => {
  it('requires at least one result file and keeps it hidden until approval', async () => {
    const requestId = await createAssignedRequest(approvalServiceId);

    const noFile = await request(server).post(`/api/requests/${requestId}/deliver`)
      .set('Cookie', expert.cookie)
      .send({ files: [], summary: 'نتیجه آماده بررسی مدیر است.' });
    expect(noFile.status).toBe(400);

    const fileId = await uploadResult(expert, 'sensitive-r3.pdf');
    const delivered = await request(server).post(`/api/requests/${requestId}/deliver`)
      .set('Cookie', expert.cookie)
      .send({ files: [{ fileId, title: 'نتیجه حساس' }], summary: 'نتیجه آماده بررسی مدیر است.' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data).toMatchObject({ status: 'under_review', mode: 'approval' });
    expect(delivered.body.data.handoffId).toBeTruthy();

    const asCustomer = await detail(requestId, customer);
    expect(asCustomer.status).toBe('under_review');
    expect(asCustomer.serviceRequiresApproval).toBe(true);
    expect(asCustomer.documents).toHaveLength(0); // nothing leaks before approval
    expect(asCustomer.events.some((e: any) => e.type === 'delivery')).toBe(false);
  });
});

describe('notifications that actually arrive', () => {
  it('step progress notifies the customer with a deep link', async () => {
    const before = await notificationsOf(customer);
    const requestId = await createAssignedRequest(directServiceId); // includes one advance
    const after = await notificationsOf(customer);
    const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
    const stepNotice = fresh.find((n) => n.title === 'مرحلهٔ پروندهٔ شما به‌روز شد');
    expect(stepNotice).toBeTruthy();
    expect(stepNotice.link).toBe(`/app/requests/${requestId}`);
  });

  it('a new unassigned case rings every eligible expert in the bell', async () => {
    const before = await notificationsOf(expert);
    const created = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId: directServiceId, formData: {}, paymentMethod: 'online' });
    expect(created.status).toBe(201);
    const after = await notificationsOf(expert);
    const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
    const queueNotice = fresh.find((n) => n.title === 'پروندهٔ تازه در صف آزاد');
    expect(queueNotice).toBeTruthy();
    expect(queueNotice.link).toBe('/staff/queue');
  });

  it('marking one notification read decrements the unread badge by exactly one', async () => {
    await createAssignedRequest(directServiceId); // generates fresh notices
    const list = await request(server).get('/api/customers/me/notifications?limit=50').set('Cookie', customer.cookie);
    const unreadBefore = Number(list.body.meta.unread);
    const target = (list.body.data as any[]).find((n) => !n.readAt);
    expect(target).toBeTruthy();
    await request(server).post('/api/customers/me/notifications/read')
      .set('Cookie', customer.cookie).send({ id: target.id }).expect(200);
    const after = await request(server).get('/api/customers/me/notifications?limit=50').set('Cookie', customer.cookie);
    expect(Number(after.body.meta.unread)).toBe(unreadBefore - 1);
  });
});

describe('floating chat (support tickets)', () => {
  let ticketId: string;

  it('customer opens a conversation; staff reply deep-links back as chat:<id>', async () => {
    const created = await request(server).post('/api/support/tickets').set('Cookie', customer.cookie)
      .send({ department: 'general', subject: 'سؤال آزمون دور سوم', body: 'سلام، وضعیت پرونده من به کجا رسید؟' });
    expect(created.status).toBe(201);
    ticketId = created.body.data.id;

    const reply = await request(server).post(`/api/support/tickets/${ticketId}/reply`)
      .set('Cookie', admin.cookie)
      .send({ body: 'سلام، پرونده شما در مرحله انجام خدمت است.' });
    expect(reply.status).toBe(200);

    const notice = (await notificationsOf(customer)).find((n) => n.link === `chat:${ticketId}`);
    expect(notice).toBeTruthy();
    expect(notice.title).toContain('پاسخ پشتیبانی');
  });

  it('unread counters track both sides and clear on open', async () => {
    const statsBefore = await request(server).get('/api/support/stats').set('Cookie', customer.cookie);
    expect(Number(statsBefore.body.data.unread)).toBeGreaterThan(0);

    const opened = await request(server).get(`/api/support/tickets/${ticketId}`).set('Cookie', customer.cookie);
    expect(opened.status).toBe(200);
    expect(opened.body.data.unreadForCustomer).toBe(0);

    const statsAfter = await request(server).get('/api/support/stats').set('Cookie', customer.cookie);
    expect(Number(statsAfter.body.data.unread)).toBe(0);

    // Customer writes again -> the staff side must see it as unread.
    await request(server).post(`/api/support/tickets/${ticketId}/reply`)
      .set('Cookie', customer.cookie)
      .send({ body: 'ممنون، منتظر تحویل می‌مانم.' }).expect(200);
    const list = await request(server).get('/api/support/tickets?pageSize=10').set('Cookie', admin.cookie);
    const row = (list.body.data as any[]).find((t) => t.id === ticketId);
    expect(row).toBeTruthy();
    expect(row.unreadForStaff).toBeGreaterThan(0);
    expect(row.customerName).toBeTruthy();
  });
});

describe('contract chosen at employee definition', () => {
  it('percentage staff: directory shows the percent and the panel is commission-based', async () => {
    const created = await request(server).post('/api/staff').set('Cookie', admin.cookie).send({
      fullName: 'کارمند درصدی دور سوم', mobile: '09120003001', username: 'r3_percent',
      password: 'Percent#12345', roleCode: 'service_expert',
    });
    expect(created.status).toBe(201);
    const userId = created.body.data.id as string;

    const contract = await request(server).post('/api/payroll/contracts').set('Cookie', admin.cookie).send({
      userId, kind: 'commission', monthlyAmount: 0, commissionPercent: 25,
      startsOn: new Date().toISOString().slice(0, 10), note: 'قرارداد هنگام تعریف کارمند (آزمون)',
    });
    expect(contract.status).toBe(201);

    const directory = await request(server).get('/api/staff?search=r3_percent').set('Cookie', admin.cookie);
    const row = (directory.body.data as any[]).find((m) => m.id === userId);
    expect(row.cooperationKind).toBe('commission');
    expect(row.commissionPercent).toBe(25);

    const session = await login('r3_percent', 'Percent#12345');
    const panel = await request(server).get('/api/payroll/me/summary').set('Cookie', session.cookie);
    expect(panel.status).toBe(200);
    expect(panel.body.data.cooperationType).toBe('commission');
    expect(panel.body.data.income).toBeTruthy(); // percentage panel: income + withdrawals
    expect(panel.body.data.balance).toBeTruthy();
    const mine = await request(server).get('/api/payroll/me').set('Cookie', session.cookie);
    expect(Number(mine.body.data.contracts[0].commission_percent)).toBe(25);
  });

  it('fixed-salary staff: directory shows monthly and the panel has no percentage income', async () => {
    const created = await request(server).post('/api/staff').set('Cookie', admin.cookie).send({
      fullName: 'کارمند ثابت دور سوم', mobile: '09120003002', username: 'r3_fixed',
      password: 'Fixed#12345', roleCode: 'service_expert',
    });
    expect(created.status).toBe(201);
    const userId = created.body.data.id as string;

    const contract = await request(server).post('/api/payroll/contracts').set('Cookie', admin.cookie).send({
      userId, kind: 'monthly', monthlyAmount: 120000000, commissionPercent: 0,
      startsOn: new Date().toISOString().slice(0, 10), note: 'قرارداد هنگام تعریف کارمند (آزمون)',
    });
    expect(contract.status).toBe(201);

    const directory = await request(server).get('/api/staff?search=r3_fixed').set('Cookie', admin.cookie);
    const row = (directory.body.data as any[]).find((m) => m.id === userId);
    expect(row.cooperationKind).toBe('monthly');
    expect(row.monthlyAmount).toBe(120000000);

    const session = await login('r3_fixed', 'Fixed#12345');
    const panel = await request(server).get('/api/payroll/me/summary').set('Cookie', session.cookie);
    expect(panel.status).toBe(200);
    expect(panel.body.data.cooperationType).toBe('monthly');
    // Fixed-salary staff must never receive the percentage panel.
    expect(panel.body.data.income).toBeNull();
    expect(panel.body.data.balance).toBeNull();
    expect(panel.body.data.withdrawals).toEqual([]);
  });

  it('service flag round-trips through the catalogue', async () => {
    const res = await request(server).get(`/api/catalog/admin/services/${approvalServiceId}`).set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.requiresManagerApproval).toBe(true);
    const plain = await request(server).get(`/api/catalog/admin/services/${directServiceId}`).set('Cookie', admin.cookie);
    expect(plain.body.data.requiresManagerApproval).toBe(false);
  });
});
