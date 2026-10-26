import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';

describe('service catalogue', () => {
  it('exposes the 30 default services in 3 categories', async () => {
    const server = await app();
    const categories = await request(server).get('/api/public/categories');
    expect(categories.body.data).toHaveLength(3);
    const services = await request(server).get('/api/public/services?pageSize=100');
    expect(services.body.meta.total).toBe(30);
  });

  it('includes a dynamic form, documents and workflow for each service', async () => {
    const server = await app();
    const res = await request(server).get('/api/public/services?pageSize=5');
    for (const service of res.body.data) {
      expect(Array.isArray(service.form)).toBe(true);
      expect(service.form.length).toBeGreaterThan(0);
      expect(Array.isArray(service.documents)).toBe(true);
      expect(service.workflow.length).toBeGreaterThan(1);
      // seeded data is flagged as needing official confirmation
      expect(service.needsReview).toBe(true);
    }
  });

  it('finds services with Arabic characters and colloquial wording', async () => {
    const server = await app();
    // "بيمه" with Arabic yeh + "سابقه" (colloquial) should find insurance records
    const res = await request(server).get('/api/public/search?q=' + encodeURIComponent('سابقه بيمه'));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].title).toMatch(/سوابق|قبض|بیمه/);
  });

  it('finds subsidy services with a typo-tolerant query', async () => {
    const server = await app();
    const res = await request(server).get('/api/public/search?q=' + encodeURIComponent('يارانه دهك'));
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('lets an admin create a category and a service with a custom form', async () => {
    const admin = await adminSession();
    const server = await app();

    const category = await request(server)
      .post('/api/catalog/categories')
      .set('Cookie', admin.cookie)
      .send({ title: 'خدمات آزمایشی', description: 'دسته تست' });
    expect(category.status).toBe(201);

    const service = await request(server)
      .post('/api/catalog/services')
      .set('Cookie', admin.cookie)
      .send({
        title: 'خدمت تست خودکار',
        categoryId: category.body.data.id,
        summary: 'خلاصه تست',
        baseFee: 100000,
        discountPercent: 10,
        estimatedDays: 2,
        form: [
          { key: 'full_name', label: 'نام و نام خانوادگی', type: 'text', required: true },
          { key: 'national_id', label: 'کد ملی', type: 'national_id', required: true },
        ],
        documents: [{ title: 'کارت ملی', required: true }],
        workflow: [{ title: 'ثبت' }, { title: 'بررسی' }, { title: 'تحویل' }],
        tags: ['تست'],
      });
    expect(service.status).toBe(201);
    expect(service.body.data.finalFee).toBe(90000);
    expect(service.body.data.form).toHaveLength(2);

    const listed = await request(server).get('/api/public/search?q=' + encodeURIComponent('خدمت تست خودکار'));
    expect(listed.body.data.some((s: any) => s.id === service.body.data.id)).toBe(true);
  });

  it('rejects an invalid form schema', async () => {
    const admin = await adminSession();
    const server = await app();
    const res = await request(server)
      .post('/api/catalog/services')
      .set('Cookie', admin.cookie)
      .send({ title: 'خدمت نامعتبر', form: [{ key: '1bad', label: 'x', type: 'text' }] });
    expect(res.status).toBe(400);
  });

  it('separates "published" from "accepting requests"', async () => {
    const admin = await adminSession();
    const server = await app();
    const list = await request(server).get('/api/catalog/admin/services?pageSize=1').set('Cookie', admin.cookie);
    const service = list.body.data[0];

    const updated = await request(server)
      .patch(`/api/catalog/services/${service.id}`)
      .set('Cookie', admin.cookie)
      .send({ isPublished: true, acceptingRequests: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isPublished).toBe(true);
    expect(updated.body.data.acceptingRequests).toBe(false);

    await request(server).patch(`/api/catalog/services/${service.id}`).set('Cookie', admin.cookie).send({ acceptingRequests: true });
  });

  it('blocks customers from the admin catalogue API', async () => {
    const server = await app();
    const res = await request(server).get('/api/catalog/admin/services');
    expect(res.status).toBe(401);
  });
});
