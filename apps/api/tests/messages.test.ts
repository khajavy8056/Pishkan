import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';

describe('messages', () => {
  it('validates thread customers and assignees before updating a conversation', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();
    const customerMe = await request(server).get('/api/auth/me').set('Cookie', customer.cookie);
    const staff = await createStaff('service_expert', {
      username: `message_staff_${Date.now()}`,
      password: 'Messages#12345',
      fullName: 'کارشناس پیام‌ها',
    });
    const staffMe = await request(server).get('/api/auth/me').set('Cookie', staff.cookie);

    await request(server).post('/api/messages/threads').set('Cookie', admin.cookie)
      .send({ customerId: staffMe.body.data.id, subject: 'نامعتبر' }).expect(400);

    const created = await request(server).post('/api/messages/threads').set('Cookie', admin.cookie)
      .send({ customerId: customerMe.body.data.id, subject: 'پیگیری درخواست' }).expect(201);
    const threadId = created.body.data.id;

    await request(server).patch(`/api/messages/threads/${threadId}`).set('Cookie', admin.cookie)
      .send({ assignedTo: customerMe.body.data.id }).expect(400);
    await request(server).patch(`/api/messages/threads/${threadId}`).set('Cookie', admin.cookie)
      .send({ assignedTo: staffMe.body.data.id }).expect(200);
  });
});
