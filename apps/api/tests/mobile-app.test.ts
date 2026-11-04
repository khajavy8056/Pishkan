import { describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { adminSession, app, customerSession } from './helpers.js';

/**
 * Native-app backend: public runtime config, story management from the web
 * admin side, customer story feed + media streaming, and the device
 * registry behind usage statistics.
 */

async function jpegFixture(): Promise<Buffer> {
  return sharp({ create: { width: 540, height: 960, channels: 3, background: '#1d4ed8' } })
    .jpeg({ quality: 85 }).toBuffer();
}

describe('android app backend', () => {
  it('serves public app config with brand and version policy', async () => {
    const server = await app();
    const res = await request(server).get('/api/app/config').expect(200);
    expect(res.body.data.brand.name).toBeTruthy();
    expect(res.body.data.version.latest).toBeTruthy();
    expect(res.body.data.version).toHaveProperty('min');
    expect(res.body.data).toHaveProperty('storiesEnabled');
    expect(res.body.data.auth).toHaveProperty('otp');
  });

  it('publishes a story from the admin side and streams it to customers', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();

    const upload = await request(server).post('/api/files/upload?purpose=story')
      .set('Cookie', admin.cookie).attach('file', await jpegFixture(), 'story-cover.jpg');
    expect(upload.status).toBe(201);
    const fileId = upload.body.data.id as string;

    const createdRes = await request(server).post('/api/app/admin/stories').set('Cookie', admin.cookie).send({
      groupTitle: 'پیشنهاد هفته', title: 'تخفیف تعویض پلاک', mediaType: 'image', fileId,
      linkUrl: '/app/services', linkLabel: 'مشاهده خدمت', durationSeconds: 5, status: 'published',
    });
    expect(createdRes.status).toBe(201);
    const story = createdRes.body.data;
    expect(story.mediaUrl).toBe(`/api/app/stories/${story.id}/media`);

    const feed = await request(server).get('/api/app/stories').set('Cookie', customer.cookie).expect(200);
    const group = feed.body.data.groups.find((g: any) => g.title === 'پیشنهاد هفته');
    expect(group).toBeTruthy();
    expect(group.items.some((item: any) => item.id === story.id)).toBe(true);

    const media = await request(server).get(`/api/app/stories/${story.id}/media`)
      .set('Cookie', customer.cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(media.status).toBe(200);
    expect(String(media.headers['content-type'])).toContain('image/');
    expect((media.body as Buffer).length).toBeGreaterThan(500);

    // Range requests (video playback) answer with 206.
    const ranged = await request(server).get(`/api/app/stories/${story.id}/media`)
      .set('Cookie', customer.cookie).set('Range', 'bytes=0-99');
    expect(ranged.status).toBe(206);

    // Unauthenticated media stays closed, and customers cannot manage stories.
    expect((await request(server).get(`/api/app/stories/${story.id}/media`)).status).toBe(401);
    const forbidden = await request(server).post('/api/app/admin/stories').set('Cookie', customer.cookie)
      .send({ title: 'استوری غیرمجاز تستی', mediaType: 'image', mediaUrl: 'https://example.com/x.jpg' });
    expect(forbidden.status).toBe(403);
  });

  it('keeps expired and draft stories out of the customer feed', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await customerSession();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const upload = await request(server).post('/api/files/upload?purpose=story')
      .set('Cookie', admin.cookie).attach('file', await jpegFixture(), 'story-expired.jpg');
    const expired = await request(server).post('/api/app/admin/stories').set('Cookie', admin.cookie).send({
      title: 'استوری منقضی آزمون', mediaType: 'image', fileId: upload.body.data.id, expiresAt: past, status: 'published',
    });
    expect(expired.status).toBe(201);
    const draft = await request(server).post('/api/app/admin/stories').set('Cookie', admin.cookie).send({
      title: 'استوری پیش نویس آزمون', mediaType: 'image', mediaUrl: 'https://example.com/draft.jpg', status: 'draft',
    });
    expect(draft.status).toBe(201);

    const feed = await request(server).get('/api/app/stories').set('Cookie', customer.cookie).expect(200);
    const ids = feed.body.data.groups.flatMap((g: any) => g.items.map((item: any) => item.id));
    expect(ids).not.toContain(expired.body.data.id);
    expect(ids).not.toContain(draft.body.data.id);

    await request(server).delete(`/api/app/admin/stories/${expired.body.data.id}`).set('Cookie', admin.cookie).expect(200);
    await request(server).delete(`/api/app/admin/stories/${draft.body.data.id}`).set('Cookie', admin.cookie).expect(200);
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
  });
});
