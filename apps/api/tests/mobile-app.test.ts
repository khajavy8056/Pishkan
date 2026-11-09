import { describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { adminSession, app, customerSession } from './helpers.js';

/**
 * Native-app backend: public runtime config, banner management from the web
 * admin side, the customer banner feed with its image streaming, and the
 * device registry behind usage statistics.
 *
 * Banners replaced stories wholesale — see migration 038. The behaviours
 * pinned here are the ones the admin panel promises and the app relies on:
 * a published banner with a real picture reaches the phone, a draft or an
 * expired one does not, a customer cannot manage banners, and the campaign
 * notification goes out once, at publication.
 */

async function jpegFixture(): Promise<Buffer> {
  return sharp({ create: { width: 540, height: 304, channels: 3, background: '#1d4ed8' } })
    .jpeg({ quality: 85 }).toBuffer();
}

describe('android app backend', () => {
  it('serves public app config with brand, version policy and the banner switch', async () => {
    const server = await app();
    const res = await request(server).get('/api/app/config').expect(200);
    expect(res.body.data.brand.name).toBeTruthy();
    expect(res.body.data.version.latest).toBeTruthy();
    expect(res.body.data.version).toHaveProperty('min');
    expect(res.body.data).toHaveProperty('bannersEnabled');
    expect(res.body.data.auth).toHaveProperty('otp');
  });

  it('publishes a banner from the admin side and streams its image to customers', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();

    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await jpegFixture(), 'banner-cover.jpg');
    expect(upload.status).toBe(201);
    const fileId = upload.body.data.id as string;

    const createdRes = await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      kind: 'service', title: 'تخفیف تعویض پلاک', subtitle: 'بدون صف و بدون مراجعه',
      imageFileId: fileId, destinationKind: 'service', destinationSlug: 'insurance-history',
      actionLabel: 'مشاهده خدمت', status: 'published',
    });
    expect(createdRes.status).toBe(201);
    const banner = createdRes.body.data;
    expect(banner.imageUrl).toBe(`/api/app/banners/${banner.id}/image`);
    expect(banner.destinationSlug).toBe('insurance-history');

    const feed = await request(server).get('/api/app/banners').set('Cookie', customer.cookie).expect(200);
    expect(feed.body.data.banners.some((item: any) => item.id === banner.id)).toBe(true);

    const media = await request(server).get(`/api/app/banners/${banner.id}/image`)
      .set('Cookie', customer.cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(media.status).toBe(200);
    expect(String(media.headers['content-type'])).toContain('image/');
    // Banner artwork is cached hard and keyed by the banner, so an unchanged
    // banner is never downloaded a second time.
    expect(String(media.headers['cache-control'])).toContain('immutable');
    // The fixture is a flat colour, so it compresses to a few hundred bytes.
    // It is served re-encoded as WebP — the upload pipeline optimises every
    // image — so the signature is RIFF, not the JPEG one that was uploaded.
    const bytes = media.body as Buffer;
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');

    // Unauthenticated media stays closed, and customers cannot manage banners.
    expect((await request(server).get(`/api/app/banners/${banner.id}/image`)).status).toBe(401);
    const forbidden = await request(server).post('/api/app/admin/banners').set('Cookie', customer.cookie)
      .send({ title: 'بنر غیرمجاز تستی', imageUrl: 'https://example.com/x.jpg' });
    expect(forbidden.status).toBe(403);
  });

  it('keeps expired, future and draft banners out of the customer feed', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await jpegFixture(), 'banner-window.jpg');
    const fileId = upload.body.data.id;

    const expired = await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      title: 'بنر منقضی آزمون', imageFileId: fileId, expiresAt: past, status: 'published',
    });
    expect(expired.status).toBe(201);
    const upcoming = await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      title: 'بنر آینده آزمون', imageFileId: fileId, startsAt: future, status: 'published',
    });
    expect(upcoming.status).toBe(201);
    const draft = await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      title: 'بنر پیش نویس آزمون', imageFileId: fileId, status: 'draft',
    });
    expect(draft.status).toBe(201);

    const feed = await request(server).get('/api/app/banners').set('Cookie', customer.cookie).expect(200);
    const ids = feed.body.data.banners.map((item: any) => item.id);
    expect(ids).not.toContain(expired.body.data.id);
    expect(ids).not.toContain(upcoming.body.data.id);
    expect(ids).not.toContain(draft.body.data.id);

    for (const created of [expired, upcoming, draft]) {
      await request(server).delete(`/api/app/admin/banners/${created.body.data.id}`).set('Cookie', admin.cookie).expect(200);
    }
  });

  it('notifies customers once, when a banner is published', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();

    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await jpegFixture(), 'banner-notify.jpg');
    expect(upload.status).toBe(201);

    const subtitle = 'اکنون می‌توانید درخواست صدور و تمدید کارت ملی را کاملاً غیرحضوری ثبت کنید.';
    // Draft first: publishing must not notify yet.
    const draft = await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      kind: 'info', title: 'ثبت غیرحضوری کارت ملی', subtitle,
      imageFileId: upload.body.data.id, status: 'draft', notifyCustomers: true,
    });
    expect(draft.status).toBe(201);
    expect(draft.body.data.subtitle).toBe(subtitle);

    const before = await request(server).get('/api/customers/me/notifications?limit=50').set('Cookie', customer.cookie).expect(200);
    expect((before.body.data as any[]).some((n) => String(n.title).includes('کارت ملی'))).toBe(false);

    const published = await request(server).patch(`/api/app/admin/banners/${draft.body.data.id}`)
      .set('Cookie', admin.cookie).send({ status: 'published' }).expect(200);
    expect(published.body.data.subtitle).toBe(subtitle);

    // The customer feed carries the subtitle the notification was built from.
    const feed = await request(server).get('/api/app/banners').set('Cookie', customer.cookie).expect(200);
    const item = feed.body.data.banners.find((i: any) => i.id === draft.body.data.id);
    expect(item).toBeTruthy();
    expect(item.subtitle).toBe(subtitle);

    // The fan-out is intentionally fire-and-forget, so poll briefly.
    let notified = false;
    for (let attempt = 0; attempt < 20 && !notified; attempt += 1) {
      const after = await request(server).get('/api/customers/me/notifications?limit=50').set('Cookie', customer.cookie).expect(200);
      notified = (after.body.data as any[]).some((n) => String(n.title).includes('کارت ملی') && n.link === '/app/banners');
      if (!notified) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(notified).toBe(true);
  });

  it('exposes LAN connection info for the admin QR card', async () => {
    const server = await app();
    const admin = await adminSession();
    const res = await request(server).get('/api/app/admin/connection').set('Cookie', admin.cookie).expect(200);
    expect(res.body.data).toHaveProperty('lanEnabled');
    expect(Array.isArray(res.body.data.urls)).toBe(true);
    expect(res.body.data).toHaveProperty('mode');
    expect(String(res.body.data.note).length).toBeGreaterThan(0);
    // Customers must not see the admin connection card.
    const customer = await customerSession();
    await request(server).get('/api/app/admin/connection').set('Cookie', customer.cookie).expect(403);
  });

  it('offers the admin a service list to point banners at', async () => {
    const server = await app();
    const admin = await adminSession();
    const targets = await request(server).get('/api/app/admin/banner-targets').set('Cookie', admin.cookie).expect(200);
    expect(Array.isArray(targets.body.data)).toBe(true);
    expect(targets.body.data.length).toBeGreaterThan(100);
    const sample = targets.body.data.find((row: any) => row.slug === 'insurance-history');
    expect(sample).toBeTruthy();
    // The picker groups by category, so each row has to carry one.
    expect(sample.category).toBeTruthy();
  });

  it('registers customer devices and reports usage stats', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();
    const payload = { deviceId: 'test-device-001', platform: 'android', appVersion: '1.0.0', appBuild: '1', deviceModel: 'Pixel Test' };
    const first = await request(server).post('/api/app/device').set('Cookie', customer.cookie).send(payload).expect(200);
    expect(first.body.data.updated).toBe(false);
    const second = await request(server).post('/api/app/device').set('Cookie', customer.cookie).send(payload).expect(200);
    expect(second.body.data.updated).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);

    const stats = await request(server).get('/api/app/admin/stats').set('Cookie', admin.cookie).expect(200);
    expect(stats.body.data.devices.total).toBeGreaterThanOrEqual(1);
    expect(stats.body.data.devices.active7d).toBeGreaterThanOrEqual(1);
    expect(stats.body.data.devices.recent.some((row: any) => row.deviceModel === 'Pixel Test')).toBe(true);
    // The dashboard counts banners, not the retired story table.
    expect(stats.body.data).toHaveProperty('banners');
    expect(stats.body.data).not.toHaveProperty('stories');
  });
});
