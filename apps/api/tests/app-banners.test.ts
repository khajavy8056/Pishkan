import { describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { adminSession, app, newCustomer } from './helpers.js';

/**
 * The banner surface, end to end.
 *
 * These are the behaviours an office actually depends on, and each of them has
 * a failure mode that is invisible in the admin panel but obvious on a phone:
 *
 *  - a draft or an out-of-window banner must not reach the app;
 *  - a service banner must point at a service that exists, or the tap 404s;
 *  - reordering must be what the app sees next time it loads;
 *  - an uploaded picture must be streamable by a signed-in customer and not
 *    by an anonymous request;
 *  - the notify switch must reach the notification feed exactly once.
 */
describe('app banners', () => {
  const png = async (colour = '#3574ab') =>
    sharp({ create: { width: 320, height: 180, channels: 3, background: colour } }).png().toBuffer();

  it('serves only published, in-window banners in the office order', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await newCustomer('مشتری آزمون بنر');
    const bearer = `Bearer ${(await request(server).post('/api/auth/customer/login')
      .send({ identifier: customer.mobile, password: 'Customer#12345' }).expect(200)).body.data.token}`;

    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await png(), 'banner.png').expect(201);
    const fileId = upload.body.data.id;

    const create = (body: Record<string, unknown>) =>
      request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send(body).expect(201);

    const live = await create({ title: 'بنر زنده', imageFileId: fileId, destinationKind: 'none', status: 'published' });
    await create({ title: 'بنر پیش‌نویس', imageFileId: fileId, destinationKind: 'none', status: 'draft' });
    // Scheduled for the future: published, but must stay invisible.
    await create({
      title: 'بنر آینده', imageFileId: fileId, destinationKind: 'none', status: 'published',
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    // Already expired: also invisible.
    await create({
      title: 'بنر گذشته', imageFileId: fileId, destinationKind: 'none', status: 'published',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const feed = await request(server).get('/api/app/banners').set('Authorization', bearer).expect(200);
    const titles = feed.body.data.banners.map((banner: any) => banner.title);
    expect(titles).toContain(live.body.data.title);
    expect(titles).not.toContain('بنر پیش‌نویس');
    expect(titles).not.toContain('بنر آینده');
    expect(titles).not.toContain('بنر گذشته');

    // The uploaded picture is streamed through the banner's own URL, and only
    // to a signed-in user.
    const banner = feed.body.data.banners.find((item: any) => item.title === live.body.data.title);
    expect(banner.imageUrl).toBe(`/api/app/banners/${banner.id}/image`);
    await request(server).get(banner.imageUrl).set('Authorization', bearer).expect(200);
    await request(server).get(banner.imageUrl).expect(401);
  });

  it('rejects a service destination that does not exist and clears stale ones', async () => {
    const server = await app();
    const admin = await adminSession();
    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await png(), 'banner.png').expect(201);
    const fileId = upload.body.data.id;

    // A banner that would navigate nowhere: the server refuses it rather than
    // letting the app discover the problem on a phone.
    await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      title: 'بنر خدمت ناموجود', imageFileId: fileId, destinationKind: 'service', destinationSlug: 'not-a-real-service',
    }).expect(400);

    const created = await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      title: 'بنر خدمت', imageFileId: fileId, destinationKind: 'service', destinationSlug: 'insurance-history',
    }).expect(201);
    expect(created.body.data.destinationSlug).toBe('insurance-history');

    // Switching away from a service must drop the slug; otherwise the app
    // still reports a service destination the office thought it removed.
    const switched = await request(server).patch(`/api/app/admin/banners/${created.body.data.id}`)
      .set('Cookie', admin.cookie).send({ destinationKind: 'none' }).expect(200);
    expect(switched.body.data.destinationSlug).toBeNull();
    expect(switched.body.data.destinationKind).toBe('none');
  });

  it('reorders banners and keeps the new order in the customer feed', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await newCustomer('مشتری ترتیب بنر');
    const bearer = `Bearer ${(await request(server).post('/api/auth/customer/login')
      .send({ identifier: customer.mobile, password: 'Customer#12345' }).expect(200)).body.data.token}`;
    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await png(), 'banner.png').expect(201);
    const fileId = upload.body.data.id;

    const first = (await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie)
      .send({ title: 'اول', imageFileId: fileId }).expect(201)).body.data;
    const second = (await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie)
      .send({ title: 'دوم', imageFileId: fileId }).expect(201)).body.data;

    // The response is the whole list (the admin table diffs against it), and
    // the store is shared with the other cases in this file, so only the two
    // positions that were asked for are asserted.
    const reordered = await request(server).post('/api/app/admin/banners/reorder')
      .set('Cookie', admin.cookie).send({ ids: [second.id, first.id] }).expect(200);
    const ids = reordered.body.data.map((banner: any) => banner.id);
    expect(ids.slice(0, 2)).toEqual([second.id, first.id]);

    const feed = await request(server).get('/api/app/banners').set('Authorization', bearer).expect(200);
    const titles = feed.body.data.banners.map((banner: any) => banner.title);
    expect(titles.indexOf('دوم')).toBeLessThan(titles.indexOf('اول'));
  });

  it('notifies customers once when a banner with the switch goes live', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await newCustomer('مشتری اعلان بنر');
    const bearer = `Bearer ${(await request(server).post('/api/auth/customer/login')
      .send({ identifier: customer.mobile, password: 'Customer#12345' }).expect(200)).body.data.token}`;
    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await png(), 'banner.png').expect(201);

    // Created as a draft: nothing is announced while it is invisible.
    const created = (await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie).send({
      title: 'بنر اعلانی', imageFileId: upload.body.data.id, status: 'draft', notifyCustomers: true,
    }).expect(201)).body.data;

    const before = await request(server).get('/api/customers/me/notifications').set('Authorization', bearer).expect(200);
    expect(before.body.data.some((item: any) => item.title === 'بنر اعلانی')).toBe(false);

    // Publishing it is the moment the announcement goes out.
    await request(server).patch(`/api/app/admin/banners/${created.id}`)
      .set('Cookie', admin.cookie).send({ status: 'published' }).expect(200);

    const after = await request(server).get('/api/customers/me/notifications').set('Authorization', bearer).expect(200);
    const matches = after.body.data.filter((item: any) => item.title === 'بنر اعلانی');
    expect(matches.length).toBe(1);
    expect(matches[0].link).toBe('/app/banners');

    // A second edit must not announce it again.
    await request(server).patch(`/api/app/admin/banners/${created.id}`)
      .set('Cookie', admin.cookie).send({ title: 'بنر اعلانی' }).expect(200);
    const again = await request(server).get('/api/customers/me/notifications').set('Authorization', bearer).expect(200);
    expect(again.body.data.filter((item: any) => item.title === 'بنر اعلانی').length).toBe(1);
  });

  it('hides the whole rail when the office switches banners off', async () => {
    const server = await app();
    const admin = await adminSession();
    const customer = await newCustomer('مشتری بنر خاموش');
    const bearer = `Bearer ${(await request(server).post('/api/auth/customer/login')
      .send({ identifier: customer.mobile, password: 'Customer#12345' }).expect(200)).body.data.token}`;
    const upload = await request(server).post('/api/files/upload?purpose=banner')
      .set('Cookie', admin.cookie).attach('file', await png(), 'banner.png').expect(201);

    await request(server).post('/api/app/admin/banners').set('Cookie', admin.cookie)
      .send({ title: 'بنر خاموشی', imageFileId: upload.body.data.id }).expect(201);

    const on = await request(server).get('/api/app/banners').set('Authorization', bearer).expect(200);
    expect(on.body.data.banners.length).toBeGreaterThan(0);
    const config = await request(server).get('/api/app/config').expect(200);
    expect(config.body.data.bannersEnabled).toBe(true);

    await request(server).put('/api/settings/admin').set('Cookie', admin.cookie)
      .send({ values: { 'app.banners_enabled': false }, confirmCritical: true }).expect(200);

    const off = await request(server).get('/api/app/banners').set('Authorization', bearer).expect(200);
    expect(off.body.data.banners).toEqual([]);
    const configOff = await request(server).get('/api/app/config').expect(200);
    expect(configOff.body.data.bannersEnabled).toBe(false);
  });
});
