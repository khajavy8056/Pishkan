import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, customerSession, CUSTOMER } from './helpers.js';
import { one } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';

describe('service catalogue', () => {
  it('exposes the default services in their categories', async () => {
    const server = await app();
    const categories = await request(server).get('/api/public/categories');
    expect(categories.body.data).toHaveLength(15);
    const services = await request(server).get('/api/public/services?pageSize=100');
    expect(services.body.meta.total).toBe(193);
  });

  it('serves distinct individual default art and preserves admin custom artwork', async () => {
    const server = await app();
    const slugs = ['social-security-receipt', 'fuel-card-registration', 'marriage-loan-registration'];
    const images = await Promise.all(slugs.map(async slug => (await request(server).get(`/api/public/services/${slug}`).expect(200)).body.data.image));
    expect(new Set(images).size).toBe(3);
    expect(images.every(image => image.startsWith('/images/services/individual/') && image.endsWith('.webp'))).toBe(true);
    const { resolveServiceArtwork } = await import('../src/modules/catalog/default-artwork.js');
    expect(resolveServiceArtwork(slugs[0], '/uploads/public/admin.webp')).toBe('/uploads/public/admin.webp');
    expect(resolveServiceArtwork(slugs[0], '/images/services/insurance.png')).toBe(images[0]);
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
    const longIcon = `/uploads/public/${'a'.repeat(85)}.webp`;
    await request(server).patch(`/api/catalog/categories/${category.body.data.id}`).set('Cookie', admin.cookie)
      .send({ icon: longIcon, image: '/uploads/public/category.webp', color: '#3a4b5c' }).expect(200);
    const publicCategories = await request(server).get('/api/public/categories').expect(200);
    expect(publicCategories.body.data.find((item: any) => item.id === category.body.data.id)).toMatchObject({
      icon: longIcon, image: '/uploads/public/category.webp', color: '#3a4b5c',
    });

    const service = await request(server)
      .post('/api/catalog/services')
      .set('Cookie', admin.cookie)
      .send({
        title: 'خدمت تست خودکار',
        categoryId: category.body.data.id,
        summary: 'خلاصه تست',
        baseFee: 100000,
        discountPercent: 10,
        estimatedMinutes: 30,
        urgentEnabled: true,
        urgentMinutes: 120,
        form: [
          { key: 'full_name', label: 'نام و نام خانوادگی', type: 'text', required: true },
          { key: 'national_id', label: 'کد ملی', type: 'national_id', required: true },
        ],
        documents: [{ key: 'national_card', title: 'کارت ملی', required: true, note: 'نسخه خوانا' }],
        workflow: [{ title: 'ثبت' }, { title: 'بررسی' }, { title: 'تحویل' }],
        tags: ['تست'],
      });
    expect(service.status).toBe(201);
    expect(service.body.data.finalFee).toBe(90000);
    expect(service.body.data.form).toHaveLength(2);
    expect(service.body.data.estimatedMinutes).toBe(30);
    expect(service.body.data.estimatedDays).toBe(1);
    expect(service.body.data.urgentMinutes).toBe(120);
    expect(service.body.data.urgentDays).toBe(1);
    expect(service.body.data.documents[0]).toMatchObject({ key: 'national_card', required: true, note: 'نسخه خوانا' });

    const listed = await request(server).get('/api/public/search?q=' + encodeURIComponent('خدمت تست خودکار'));
    expect(listed.body.data.some((s: any) => s.id === service.body.data.id)).toBe(true);
    const categories = await request(server).get('/api/catalog/admin/categories').set('Cookie', admin.cookie);
    expect(categories.body.data.find((item: any) => item.id === category.body.data.id).serviceCount).toBe(1);

    await updateSettings({ 'assistant.enabled': true, 'assistant.llm_provider': 'builtin' }, { id: 'system', name: 'assistant-duration-test' });
    const assistant = await request(server).post('/api/assistant/chat').send({ message: 'هزینه خدمت تست خودکار' }).expect(200);
    expect(assistant.body.data.suggestions[0]).toMatchObject({ id: service.body.data.id, estimatedMinutes: 30, estimatedDays: 1 });
    expect(assistant.body.data.reply).toContain('۳۰ دقیقه');
  });

  it('clears the sample-review marker only after an explicit admin catalogue edit', async () => {
    const admin = await adminSession();
    const server = await app();
    const created = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
      title: 'خدمت نیازمند بازبینی', slug: 'review-marker-clear', baseFee: 0, form: [], documents: [], workflow: [],
    }).expect(201);
    expect(created.body.data.needsReview).toBe(true);
    const updated = await request(server).patch(`/api/catalog/services/${created.body.data.id}`)
      .set('Cookie', admin.cookie).send({ needsReview: false }).expect(200);
    expect(updated.body.data.needsReview).toBe(false);
    const publicView = await request(server).get(`/api/public/services/${created.body.data.slug}`).expect(200);
    expect(publicView.body.data.needsReview).toBe(false);
  });

  it('preserves minute, hour and day durations without rounding to whole days', async () => {
    const admin = await adminSession();
    const server = await app();
    const values = [30, 120, 1440, 240]; // 30 minutes, 2 hours, 1 day, 4 hours
    for (const [index, estimatedMinutes] of values.entries()) {
      const created = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
        title: `مدت آزمایشی ${index + 1}`, slug: `duration-check-${index + 1}`,
        estimatedMinutes, baseFee: 0, form: [], documents: [], workflow: [],
      });
      expect(created.status).toBe(201);
      expect(created.body.data.estimatedMinutes).toBe(estimatedMinutes);
      expect(created.body.data.estimatedDays).toBe(Math.ceil(estimatedMinutes / 1440));
    }
  });

  it('links an accepted custom-offer invoice to the new request before returning it', async () => {
    const admin = await adminSession();
    const customer = await customerSession();
    const server = await app();
    const customerRow = await one<{ id: string }>('SELECT id FROM users WHERE mobile=?', [CUSTOMER.mobile]);
    expect(customerRow).toBeTruthy();

    const offer = await request(server).post('/api/catalog/custom-services').set('Cookie', admin.cookie).send({
      customerId: customerRow!.id,
      title: 'خدمت اختصاصی با فاکتور پیوندخورده',
      description: 'شرح کافی برای آزمون پیوند فاکتور پیش‌صدور به درخواست مشتری.',
      baseFee: 55000,
      documents: [], form: [], workflow: [], createInvoice: true, expiryHours: 1,
    }).expect(201);
    expect(offer.body.data.invoiceId).toBeTruthy();
    expect(new Date(offer.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(offer.body.data.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000);

    const accepted = await request(server).post(`/api/catalog/offers/${offer.body.data.offerId}/accept`)
      .set('Cookie', customer.cookie).send({ formData: {}, paymentMethod: 'online' }).expect(200);
    const createdRequest = accepted.body.data.request;
    expect(createdRequest.paymentStatus).toBe('unpaid');
    expect(createdRequest.invoices).toHaveLength(1);
    expect(createdRequest.invoices[0]).toMatchObject({ id: offer.body.data.invoiceId, status: 'issued', total: 55000 });
    expect(createdRequest.events.some((event: any) => event.type === 'invoice')).toBe(true);
    const linkedInvoice = await one<{ request_id: string }>('SELECT request_id FROM invoices WHERE id=?', [offer.body.data.invoiceId]);
    expect(linkedInvoice?.request_id).toBe(createdRequest.id);
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

  it('keeps unpublished services and quotes private from customers', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();
    const created = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie)
      .send({ title: 'پیش‌نویس محرمانه', isPublished: false, baseFee: 123456, form: [] });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug;
    const id = created.body.data.id;
    await request(server).get(`/api/public/services/${slug}`).expect(404);
    await request(server).get(`/api/public/services/${slug}`).set('Cookie', customer.cookie).expect(404);
    await request(server).get(`/api/public/services/${slug}`).set('Cookie', admin.cookie).expect(200);
    await request(server).get(`/api/catalog/services/${id}/quote`).set('Cookie', customer.cookie).expect(404);
  });

  it('blocks customers from the admin catalogue API', async () => {
    const server = await app();
    const res = await request(server).get('/api/catalog/admin/services');
    expect(res.status).toBe(401);
  });
});
