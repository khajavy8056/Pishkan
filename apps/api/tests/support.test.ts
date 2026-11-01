import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createStaff, customerSession, EXPERT, newCustomer } from './helpers.js';
import { updateSettings } from '../src/modules/settings/service.js';

let server: Awaited<ReturnType<typeof app>>;
let customer: any;
let expert: any;
let ticketId: string;

describe('support tickets', () => {
  beforeAll(async () => {
    server = await app();
    customer = await customerSession();
    expert = await createStaff('service_expert', EXPERT);
  });

  afterAll(async () => {
    await updateSettings({ 'support.enabled': true }, { id: 'system', name: 'test-support' }, { confirmCritical: true }).catch(() => undefined);
  });

  it('customer opens a ticket and staff sees it in the queue', async () => {
    const meta = await request(server).get('/api/support/meta').set('Cookie', customer.cookie);
    expect(meta.status).toBe(200);
    expect(meta.body.data.enabled).toBe(true);
    expect(Array.isArray(meta.body.data.departments)).toBe(true);

    const created = await request(server).post('/api/support/tickets').set('Cookie', customer.cookie).send({
      department: 'services', subject: 'سؤال دربارهٔ وضعیت پرونده', priority: 'high', body: 'لطفاً وضعیت پرونده‌ام را بگویید.',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.number).toMatch(/^SUP-\d+$/);
    expect(created.body.data.status).toBe('open');
    ticketId = created.body.data.id;

    const staffList = await request(server).get('/api/support/tickets').set('Cookie', expert.cookie);
    expect(staffList.status).toBe(200);
    expect(staffList.body.data.some((t: any) => t.id === ticketId)).toBe(true);

    const ownList = await request(server).get('/api/support/tickets').set('Cookie', customer.cookie);
    expect(ownList.body.data.some((t: any) => t.id === ticketId)).toBe(true);
  });

  it('reply flow drives status and unread counters', async () => {
    const reply = await request(server).post(`/api/support/tickets/${ticketId}/reply`).set('Cookie', expert.cookie)
      .send({ body: 'در حال بررسی است؛ فردا خبر می‌دهیم.' });
    expect(reply.status).toBe(200);
    expect(reply.body.data.status).toBe('answered');

    const detail = await request(server).get(`/api/support/tickets/${ticketId}`).set('Cookie', customer.cookie);
    expect(detail.body.data.messages).toHaveLength(2);
    expect(detail.body.data.unreadForCustomer).toBe(0); // reading cleared it

    const ownReply = await request(server).post(`/api/support/tickets/${ticketId}/reply`).set('Cookie', customer.cookie)
      .send({ body: 'ممنون، منتظرم.' });
    expect(ownReply.status).toBe(200);
    expect(ownReply.body.data.status).toBe('open'); // customer reply reopens the ticket
  });

  it('internal notes are invisible to the customer', async () => {
    const note = await request(server).post(`/api/support/tickets/${ticketId}/reply`).set('Cookie', expert.cookie)
      .send({ body: 'یادداشت داخلی: بررسی شود', internal: true });
    expect(note.status).toBe(200);

    const staffView = await request(server).get(`/api/support/tickets/${ticketId}`).set('Cookie', expert.cookie);
    expect(staffView.body.data.messages.some((m: any) => m.isInternal)).toBe(true);

    const customerView = await request(server).get(`/api/support/tickets/${ticketId}`).set('Cookie', customer.cookie);
    expect(customerView.body.data.messages.some((m: any) => m.isInternal)).toBe(false);
    expect(customerView.body.data.messages.some((m: any) => String(m.body).includes('یادداشت داخلی'))).toBe(false);
  });

  it('other customers cannot peek or reply', async () => {
    const { session: stranger } = await newCustomer('مشتری غریبه');
    const peek = await request(server).get(`/api/support/tickets/${ticketId}`).set('Cookie', stranger.cookie);
    expect(peek.status).toBe(404);
    const reply = await request(server).post(`/api/support/tickets/${ticketId}/reply`).set('Cookie', stranger.cookie)
      .send({ body: 'سلام' });
    expect(reply.status).toBe(404);
  });

  it('resolution, rating and closing are enforced', async () => {
    const rateTooEarly = await request(server).post(`/api/support/tickets/${ticketId}/rate`).set('Cookie', customer.cookie)
      .send({ rating: 5 });
    expect([400, 409]).toContain(rateTooEarly.status);

    const resolved = await request(server).patch(`/api/support/tickets/${ticketId}`).set('Cookie', expert.cookie)
      .send({ status: 'resolved' });
    expect(resolved.status).toBe(200);

    // resolving re-opens on customer reply per normal support flow
    const rated = await request(server).post(`/api/support/tickets/${ticketId}/rate`).set('Cookie', customer.cookie)
      .send({ rating: 5, note: 'عالی بود' });
    expect(rated.status).toBe(200);
    expect(rated.body.data.rating).toBe(5);

    // customers may correct their rating while the ticket is still rateable
    const reRate = await request(server).post(`/api/support/tickets/${ticketId}/rate`).set('Cookie', customer.cookie)
      .send({ rating: 4 });
    expect(reRate.status).toBe(200);
    expect(reRate.body.data.rating).toBe(4);

    const closed = await request(server).patch(`/api/support/tickets/${ticketId}`).set('Cookie', expert.cookie)
      .send({ status: 'closed' });
    expect(closed.status).toBe(200);

    const replyClosed = await request(server).post(`/api/support/tickets/${ticketId}/reply`).set('Cookie', customer.cookie)
      .send({ body: 'باز هم سؤال دارم' });
    expect([400, 409]).toContain(replyClosed.status);
  });

  it('stats differ for staff and customers', async () => {
    const stats = await request(server).get('/api/support/stats').set('Cookie', expert.cookie);
    expect(stats.status).toBe(200);
    expect(typeof stats.body.data.open).toBe('number');
    expect(typeof stats.body.data.unassigned).toBe('number');

    // Customers only ever see their own counters, never the office-wide queue.
    const mine = await request(server).get('/api/support/stats').set('Cookie', customer.cookie);
    expect(mine.status).toBe(200);
    expect(mine.body.data.unassigned).toBeUndefined();
  });

  it('validation and the settings kill-switch work', async () => {
    const empty = await request(server).post('/api/support/tickets').set('Cookie', customer.cookie)
      .send({ subject: 'x', body: '' });
    expect(empty.status).toBe(400);

    const badCategory = await request(server).post('/api/support/tickets').set('Cookie', customer.cookie)
      .send({ subject: 'تست', body: 'متن کافی', department: 'not-a-department' });
    expect(badCategory.status).toBe(400);

    await updateSettings({ 'support.enabled': false }, { id: 'system', name: 'test-support' }, { confirmCritical: true });
    const blocked = await request(server).post('/api/support/tickets').set('Cookie', customer.cookie)
      .send({ subject: 'تست', body: 'متن کافی' });
    expect(blocked.status).toBe(403);
    await updateSettings({ 'support.enabled': true }, { id: 'system', name: 'test-support' }, { confirmCritical: true });
  });
});
