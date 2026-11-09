import { describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { ADMIN, adminSession, app, newCustomer } from './helpers.js';

describe('Android customer API contract (real HTTP and SQLite)', () => {
  it('supports the full customer request flow and protects customer data', async () => {
    const server = await app();
    const customer = await newCustomer('مشتری آزمایش اندروید');
    const login = await request(server).post('/api/auth/customer/login').send({ identifier: customer.mobile, password: 'Customer#12345' }).expect(200);
    expect(login.body.data.user.kind).toBe('customer');
    const bearer = `Bearer ${login.body.data.token}`;
    await request(server).post('/api/auth/customer/login').send({ identifier: ADMIN.username, password: ADMIN.password }).expect(401);

    const catalog1 = await request(server).get('/api/public/services?page=1&pageSize=100').set('Authorization', bearer).expect(200);
    const catalog2 = await request(server).get('/api/public/services?page=2&pageSize=100').set('Authorization', bearer).expect(200);
    expect(catalog1.body.meta.total).toBeGreaterThan(100);
    expect(catalog1.body.data.length + catalog2.body.data.length).toBe(catalog1.body.meta.total);
    for (const item of [...catalog1.body.data, ...catalog2.body.data]) {
      // Every seeded service now ships its own WebP artwork; the `.png`
      // category photos only survive as the fallback for a service whose slug
      // has no individual picture yet.
      expect(item.image).toMatch(/^\/images\/services\/.*\.(webp|png)$/);
      expect(item.icon).toMatch(/\p{Extended_Pictographic}/u);
    }

    const service = (await request(server).get('/api/public/services/insurance-history').set('Authorization', bearer).expect(200)).body.data;
    const quote = await request(server).post('/api/requests/quote').set('Authorization', bearer).send({ serviceId: service.id, priority: 'normal' }).expect(200);
    expect(quote.body.data.total).toBeGreaterThanOrEqual(0);
    const formData: Record<string, any> = {};
    let sequence = 0;
    const upload = async () => {
      const n = sequence++;
      const image = await sharp({ create: { width: 40 + n, height: 35 + n, channels: 3, background: { r: n, g: 100, b: 200 } } }).png().toBuffer();
      return (await request(server).post('/api/files/upload?purpose=document').set('Authorization', bearer).attach('file', image, `fixture-${n}.png`).expect(201)).body.data.id;
    };
    for (const field of service.form) {
      if (!field.required) continue;
      switch (field.type) {
        case 'national_id': formData[field.key] = '0013546295'; break;
        case 'tel': formData[field.key] = '09121234567'; break;
        case 'iban': formData[field.key] = 'IR062960000000100324200001'; break;
        case 'postal_code': formData[field.key] = '1234567890'; break;
        case 'number': case 'money': formData[field.key] = 1000000; break;
        case 'select': case 'radio': formData[field.key] = field.options?.[0] ?? 'سایر'; break;
        case 'checkbox': formData[field.key] = true; break;
        case 'file': formData[field.key] = await upload(); break;
        default: formData[field.key] = 'اطلاعات آزمایشی';
      }
    }
    const documents = [];
    for (const doc of service.documents.filter((d: any) => d.required)) {
      documents.push({ fileId: await upload(), title: doc.title, requirementKey: doc.key });
    }
    const created = await request(server).post('/api/requests').set('Authorization', bearer).set('Idempotency-Key', 'android-contract-test-001')
      .send({ serviceId: service.id, priority: 'normal', formData, documentIds: documents }).expect(201);
    const id = created.body.data.id;
    expect(created.body.data.total).toBe(quote.body.data.total);
    const list = await request(server).get('/api/requests?page=1&pageSize=20').set('Authorization', bearer).expect(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data.some((item: any) => item.id === id)).toBe(true);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
    const bucket = list.body.data.find((item: any) => item.id === id).workBucket;
    const filtered = await request(server).get(`/api/requests?bucket=${bucket}`).set('Authorization', bearer).expect(200);
    expect(filtered.body.data.some((item: any) => item.id === id)).toBe(true);
    await request(server).get(`/api/requests/${id}`).set('Authorization', bearer).expect(200);
    const other = await newCustomer('مشتری دیگر آزمون اندروید');
    await request(server).get(`/api/requests/${id}`).set('Cookie', other.session.cookie).expect(404);
    for (const path of ['/api/accounting/my/invoices', '/api/accounting/my/payments', '/api/wallet/my/transactions']) {
      const response = await request(server).get(path).set('Authorization', bearer).expect(200);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.meta.total).toBeGreaterThanOrEqual(0);
    }
    expect((await request(server).get('/api/accounting/my/invoices').set('Authorization', bearer).expect(200)).body.data.some((invoice: any) => invoice.requestId === id)).toBe(true);
  });

  it('accepts app profile completion and changes the actual password', async () => {
    const server = await app();
    const mobile = '09129997766';
    const password = 'Password#12345';
    const registered = await request(server).post('/api/auth/register').send({ mobile, password, fullName: 'مشتری جدید اندروید' }).expect(201);
    expect(registered.body.data.user.kind).toBe('customer');
    const bearer = `Bearer ${registered.body.data.token}`;
    expect((await request(server).get('/api/auth/me').set('Authorization', bearer).expect(200)).body.data.profileState.complete).toBe(false);
    const cities = await request(server).get('/api/public/cities').expect(200);
    expect(cities.body.data.length).toBeGreaterThan(1000);
    expect(new Set(cities.body.data.map((city: any) => city.province)).size).toBe(31);
    const andimeshk = cities.body.data.find((city: any) => city.name === 'اندیمشک' && city.province === 'خوزستان');
    expect(andimeshk).toBeTruthy();
    await request(server).patch('/api/auth/profile').set('Authorization', bearer).send({
      firstName: 'مشتری', lastName: 'اندروید', nationalId: '0013546295', cityId: andimeshk.id,
      fatherName: 'رضا', address: 'نشانی آزمون', postalCode: '1234567890', email: 'test@example.com',
    }).expect(200);
    const refreshed = (await request(server).get('/api/auth/me').set('Authorization', bearer).expect(200)).body.data;
    expect(refreshed.profileState.complete).toBe(true);
    expect(refreshed.profileState.profile).toMatchObject({ first_name: 'مشتری', last_name: 'اندروید', city_id: andimeshk.id, city: 'اندیمشک', province: 'خوزستان', father_name: 'رضا', address: 'نشانی آزمون', postal_code: '1234567890' });
    expect(refreshed).toMatchObject({ email: 'test@example.com', nationalId: '0013546295' });
    await request(server).post('/api/auth/password/change').set('Authorization', bearer).send({ currentPassword: password, newPassword: 'NewPassword#12345' }).expect(200);
    await request(server).post('/api/auth/customer/login').send({ identifier: mobile, password }).expect(401);
    await request(server).post('/api/auth/customer/login').send({ identifier: mobile, password: 'NewPassword#12345' }).expect(200);
  });

  it('uses real chat, support, documents and notification feeds', async () => {
    const server = await app();
    const customer = await newCustomer('مشتری آزمایش پشتیبانی');
    const admin = await adminSession();
    const customerAuth = customer.session.cookie;
    const thread = await request(server).post('/api/messages/threads').set('Cookie', customerAuth).send({ subject: 'پیگیری آزمایشی' }).expect(201);
    const threadId = thread.body.data.id;
    await request(server).post(`/api/messages/threads/${threadId}/messages`).set('Cookie', customerAuth).send({ body: 'پیام آزمایشی مشتری' }).expect(201);
    await request(server).post(`/api/messages/threads/${threadId}/messages`).set('Cookie', admin.cookie).send({ body: 'پاسخ آزمایشی دفتر' }).expect(201);
    const messages = await request(server).get(`/api/messages/threads/${threadId}`).set('Cookie', customerAuth).expect(200);
    expect(messages.body.data.messages.map((message: any) => message.body)).toContain('پاسخ آزمایشی دفتر');
    const ticket = await request(server).post('/api/support/tickets').set('Cookie', customerAuth).send({
      department: 'general', subject: 'تیکت آزمایشی', body: 'درخواست پشتیبانی آزمایشی مشتری', priority: 'normal',
    }).expect(201);
    await request(server).post(`/api/support/tickets/${ticket.body.data.id}/reply`).set('Cookie', admin.cookie).send({ body: 'پاسخ تیکت دفتر' }).expect(200);
    const feed = await request(server).get('/api/customers/me/notifications?limit=50').set('Cookie', customerAuth).expect(200);
    expect(feed.body.data.some((item: any) => item.link === `/app/messages/${threadId}`)).toBe(true);
    expect(feed.body.data.some((item: any) => item.link === `chat:${ticket.body.data.id}`)).toBe(true);
    const notification = feed.body.data.find((item: any) => item.link === `/app/messages/${threadId}`);
    await request(server).post('/api/customers/me/notifications/read').set('Cookie', customerAuth).send({ id: notification.id }).expect(200);
    const image = await sharp({ create: { width: 41, height: 37, channels: 3, background: { r: 20, g: 30, b: 40 } } }).png().toBuffer();
    const upload = await request(server).post('/api/files/upload?purpose=document').set('Cookie', customerAuth).attach('file', image, 'national-card.png').expect(201);
    await request(server).post('/api/documents/mine').set('Cookie', customerAuth).send({ fileId: upload.body.data.id, docType: 'national_card' }).expect(201);
    const documents = await request(server).get('/api/documents/mine').set('Cookie', customerAuth).expect(200);
    expect(documents.body.data.some((doc: any) => doc.docType === 'national_card')).toBe(true);
    expect(documents.body.meta.types.some((type: any) => type.code === 'national_card')).toBe(true);
  });

  it('publishes service artwork without making customer uploads public', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await newCustomer('مشتری آزمون تصویر خدمت');
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#3574ab' } }).png().toBuffer();
    await request(server).post('/api/files/upload?purpose=service&public=true').set('Cookie', customer.session.cookie).attach('file', image, 'icon.png').expect(403);
    const uploaded = await request(server).post('/api/files/upload?purpose=service&public=true').set('Cookie', admin.cookie).attach('file', image, 'icon.png').expect(201);
    expect(uploaded.body.data.isPublic).toBe(true);
    const url = uploaded.body.data.url;
    expect(url).toMatch(/^\/uploads\/public\//);
    expect(url.length).toBeLessThanOrEqual(60);
    await request(server).get(url).expect(200);
    const service = (await request(server).get('/api/public/services/insurance-history').expect(200)).body.data;
    await request(server).patch(`/api/catalog/services/${service.id}`).set('Cookie', admin.cookie).send({ icon: url, image: url }).expect(200);
    const saved = (await request(server).get('/api/public/services/insurance-history').expect(200)).body.data;
    expect(saved.icon).toBe(url);
    expect(saved.image).toBe(url);
  });

  it('returns the private offer slug so its owner can retrieve the real form', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await newCustomer('مشتری پیشنهاد آزمایشی');
    const created = await request(server).post('/api/catalog/custom-services').set('Cookie', admin.cookie).send({
      customerId: customer.id, title: 'خدمت ویژه آزمایشی', description: 'توضیحات کافی برای خدمت ویژه آزمون', baseFee: 500000,
      form: [{ key: 'detail', label: 'توضیح', type: 'text', required: true }],
    }).expect(201);
    const offers = await request(server).get('/api/catalog/offers').set('Cookie', customer.session.cookie).expect(200);
    const offer = offers.body.data.find((item: any) => item.id === created.body.data.offerId);
    expect(offer.serviceSlug).toBeTruthy();
    const detail = await request(server).get(`/api/public/services/${offer.serviceSlug}`).set('Cookie', customer.session.cookie).expect(200);
    expect(detail.body.data.form[0].key).toBe('detail');
    const other = await newCustomer('مشتری غیرمجاز آزمایشی');
    await request(server).get(`/api/public/services/${offer.serviceSlug}`).set('Cookie', other.session.cookie).expect(404);
  });
});
