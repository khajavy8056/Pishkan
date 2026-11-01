import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession, ACCOUNTANT } from './helpers.js';
import { env } from '../src/env.js';
import { run } from '../src/db/index.js';

let sequence = 0;
async function storedFile(ownerId: string, purpose = 'document') {
  sequence += 1;
  const id = `file-access-${sequence}`;
  const fileName = `${id}.pdf`;
  const dir = path.join(env.uploadDir, 'private');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), '%PDF-1.7\nprivate fixture');
  await run(
    `INSERT INTO files (id, owner_id, name, mime, size, storage_key, sha256, is_public, purpose, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, ownerId, fileName, 'application/pdf', 24, path.join('private', fileName), 'test-checksum', purpose, new Date().toISOString()],
  );
  return id;
}

describe('private file authorization and upload validation', () => {
  it('does not grant managers or accountants blanket access to unrelated private files', async () => {
    const server = await app();
    const customer = await customerSession();
    const customerLogin = await request(server).post('/api/auth/login').send({ identifier: '09121112233', password: 'Customer#12345' });
    const ownerId = customerLogin.body.data.user.id;
    const fileId = await storedFile(ownerId, 'private-bank-document');
    const manager = await createStaff('manager', { username: 'files_manager', password: 'Manager#12345', fullName: 'مدیر پرونده' });
    const accountant = await createStaff('accountant', ACCOUNTANT);
    const admin = await adminSession();

    expect((await request(server).get(`/api/files/${fileId}`).set('Cookie', manager.cookie)).status).toBe(403);
    expect((await request(server).get(`/api/files/${fileId}`).set('Cookie', accountant.cookie)).status).toBe(403);
    expect((await request(server).get(`/api/files/${fileId}`).set('Cookie', customer.cookie)).status).toBe(200);
    expect((await request(server).get(`/api/files/${fileId}`).set('Cookie', admin.cookie)).status).toBe(200);
  });

  it('allows only the assigned case worker and the owning customer to read a request document', async () => {
    const server = await app();
    const customer = await customerSession();
    const profile = await request(server).post('/api/auth/login').send({ identifier: '09121112233', password: 'Customer#12345' });
    const customerId = profile.body.data.user.id;
    const serviceId = (await request(server).get('/api/public/services?pageSize=1')).body.data[0].id;
    const expert = await createStaff('service_expert', { username: 'files_assigned', password: 'Expert#12345', fullName: 'کارشناس تخصیص‌یافته' });
    const otherExpert = await createStaff('service_expert', { username: 'files_unassigned', password: 'Expert#12345', fullName: 'کارشناس دیگر' });
    const expertLogin = await request(server).post('/api/auth/login').send({ identifier: 'files_assigned', password: 'Expert#12345' });
    const requestId = `request-files-${Date.now()}`;
    const fileId = await storedFile(customerId);
    await run(
      `INSERT INTO requests (id, tracking_code, customer_id, service_id, assigned_to, status, priority, form_data, snapshot, fee, discount, total, payment_method, payment_status, current_step, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'assigned', 'normal', '{}', '{}', 0, 0, 0, 'online', 'unpaid', 0, ?, ?)`,
      [requestId, `TR-FILE-${Date.now()}`, customerId, serviceId, expertLogin.body.data.user.id, new Date().toISOString(), new Date().toISOString()],
    );
    await run(
      `INSERT INTO request_documents (id, request_id, file_id, title, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`doc-files-${Date.now()}`, requestId, fileId, 'مدرک خصوصی', 'customer', 'pending', new Date().toISOString()],
    );

    expect((await request(server).get(`/api/files/${fileId}`).set('Cookie', customer.cookie)).status).toBe(200);
    expect((await request(server).get(`/api/files/${fileId}`).set('Cookie', expert.cookie)).status).toBe(200);
    expect((await request(server).get(`/api/files/${fileId}`).set('Cookie', otherExpert.cookie)).status).toBe(403);
  });

  it('rejects files whose content signature does not match an allowed extension and removes the temporary file', async () => {
    const server = await app();
    const customer = await customerSession();
    const privateDir = path.join(env.uploadDir, 'private');
    const before = fs.existsSync(privateDir) ? new Set(fs.readdirSync(privateDir)) : new Set<string>();
    const response = await request(server)
      .post('/api/files/upload')
      .set('Cookie', customer.cookie)
      .attach('file', Buffer.from('<script>alert(1)</script>'), 'fake.pdf');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('محتوای فایل');
    const after = fs.existsSync(privateDir) ? fs.readdirSync(privateDir) : [];
    expect(after.filter((name) => !before.has(name))).toHaveLength(0);
  });
});
