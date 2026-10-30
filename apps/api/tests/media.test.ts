import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff, customerSession } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { env } from '../src/env.js';
import { resolveStoragePath } from '../src/modules/media/service.js';

const actor = { id: 'system', name: 'media-test' };

const DOC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
  <rect width="100%" height="100%" fill="#f7f4ee"/>
  <text x="80" y="140" font-size="52" font-family="sans-serif" fill="#111">کارت ملی / NATIONAL ID CARD</text>
  <text x="80" y="240" font-size="30" font-family="monospace" fill="#333">0012345678  1402/05/12  IR-9988776655</text>
  ${Array.from({ length: 22 }, (_, i) => `<rect x="80" y="${320 + i * 24}" width="${500 + (i * 61) % 500}" height="5" fill="#444"/>`).join('')}
</svg>`;

const PDF_FIXTURE = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj\ntrailer<</Root 1 0 R>>\nstartxref\n0\n%%EOF\n',
);

let server: Awaited<ReturnType<typeof app>>;
let admin: { cookie: string[] };
let customer: { cookie: string[] };
let otherCustomer: { cookie: string[] };
let operator: { cookie: string[] };
let customerId: string;
let operatorId: string;
let documentPng: Buffer;
let photoJpeg: Buffer;
let rotatedJpeg: Buffer;
let smallPng: Buffer;
let mediumPng: Buffer;
let serviceId: string;

async function logoutRegister() {
  const res = await request(server).post('/api/auth/register').send({
    mobile: '09127770011', password: 'OtherCustomer#1234', fullName: 'مشتری دوم',
  });
  expect([200, 201, 409]).toContain(res.status);
  const login = await request(server).post('/api/auth/login').send({ identifier: '09127770011', password: 'OtherCustomer#1234' });
  expect(login.status).toBe(200);
  return { cookie: login.headers['set-cookie'] as unknown as string[] };
}

function binary(response: request.Response): Buffer {
  return Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.text ?? '', 'binary');
}

async function download(url: string, cookie: string[]) {
  return request(server).get(url).set('Cookie', cookie)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

async function upload(session: { cookie: string[] }, file: Buffer, name: string, query = 'purpose=document') {
  return request(server).post(`/api/files/upload?${query}`).set('Cookie', session.cookie)
    .attach('file', file, name);
}

async function rawGreyscale(input: Buffer) {
  // Native resolution on purpose: downscaling both sides would hide the exact
  // fine-print damage we are asserting against.
  const { data, info } = await sharp(input, { failOn: 'error' })
    .flatten({ background: '#fff' }).greyscale()
    .raw().toBuffer({ resolveWithObject: true });
  let energy = 0;
  for (let y = 0; y < info.height - 1; y += 1) {
    for (let x = 0; x < info.width - 1; x += 1) {
      const index = y * info.width + x;
      energy += Math.abs(data[index]! - data[index + 1]!) + Math.abs(data[index]! - data[index + info.width]!);
    }
  }
  return { data, width: info.width, height: info.height, energy };
}

/** Independent implementation of the readability check: mean pixel delta + retained edges. */
async function readability(originalBuffer: Buffer, outputBuffer: Buffer) {
  const a = await rawGreyscale(originalBuffer);
  const b = await rawGreyscale(outputBuffer);
  expect(b.width).toBe(a.width);
  expect(b.height).toBe(a.height);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    const diff = Math.abs(a.data[i]! - b.data[i]!);
    sum += diff;
    max = Math.max(max, diff);
  }
  return { meanDiff: sum / a.data.length, maxDiff: max, edgeRatio: a.energy > 0 ? b.energy / a.energy : 1 };
}

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
  customer = await customerSession();
  customerId = (await request(server).get('/api/auth/me').set('Cookie', customer.cookie)).body.data.id;
  otherCustomer = await logoutRegister();
  operator = await createStaff('service_expert', { username: 'media_operator', password: 'Operator#12345', fullName: 'کارشناس رسانه' });
  operatorId = (await request(server).get('/api/auth/me').set('Cookie', operator.cookie)).body.data.id;
  const service = await request(server).post('/api/catalog/services').set('Cookie', admin.cookie).send({
    title: 'خدمت آزمایشی مدارک', baseFee: 100000, form: [], documents: [], workflow: [],
  });
  expect(service.status).toBe(201);
  serviceId = service.body.data.id;

  documentPng = await sharp(Buffer.from(DOC_SVG)).png().toBuffer();

  const width = 1400;
  const height = 900;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = Math.min(255, Math.round((x * 255) / width));
      raw[i + 1] = Math.min(255, Math.round((y * 255) / height));
      raw[i + 2] = Math.min(255, Math.round(128 + 96 * Math.sin(x / 90)));
    }
  }
  photoJpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();

  const rotatedBase = await sharp({ create: { width: 400, height: 800, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 120, height: 120, channels: 3, background: '#111111' } }).png().toBuffer(), top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .toBuffer();
  rotatedJpeg = await sharp(rotatedBase).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();

  smallPng = await sharp({ create: { width: 120, height: 90, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><text x="8" y="40" font-size="14" fill="#000">DOC 12345</text></svg>'), top: 0, left: 0 }])
    .png().toBuffer();
  mediumPng = await sharp({ create: { width: 1400, height: 900, channels: 3, background: '#fafafa' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><text x="40" y="80" font-size="40" fill="#000">LARGE DOCUMENT 999</text></svg>'), top: 0, left: 0 }])
    .png().toBuffer();
}, 120_000);

describe('intelligent image pipeline', () => {
  it('converts a document scan to WebP without losing resolution or legibility', async () => {
    const response = await upload(customer, documentPng, 'national-card.png');
    expect(response.status).toBe(201);
    const file = response.body.data;
    expect(file.processing.status).toBe('ready');
    expect(file.mime).toBe('image/webp');
    expect(file.dimensions).toEqual({ width: 1600, height: 1000 });
    expect(file.original.size).toBe(documentPng.length);
    expect(file.original.mime).toBe('image/png');
    expect(['lossless', 'near_lossless']).toContain(file.processing.mode);
    expect(file.savingsPercent).toBeGreaterThan(40);
    expect(file.previewUrl).toContain('variant=preview');
    expect(file.originalUrl).toContain('variant=original');

    // The recorded percentage must be arithmetic on the real byte counts.
    const expectedSavings = Math.round((1 - file.size / documentPng.length) * 1000) / 10;
    expect(file.savingsPercent).toBeCloseTo(expectedSavings, 1);
    expect(file.size).toBeLessThan(documentPng.length);

    const display = await download(`/api/files/${file.id}`, customer.cookie);
    expect(display.status).toBe(200);
    expect(display.headers['content-type']).toContain('image/webp');
    expect(display.headers['x-content-type-options']).toBe('nosniff');
    const displayBuffer = binary(display);
    const meta = await sharp(displayBuffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1000);

    const quality = await readability(documentPng, displayBuffer);
    expect(quality.meanDiff).toBeLessThanOrEqual(1.5);
    expect(quality.edgeRatio).toBeGreaterThanOrEqual(0.985);

    const original = await download(`/api/files/${file.id}?variant=original`, customer.cookie);
    expect(original.status).toBe(200);
    expect(original.headers['content-type']).toContain('image/png');
    const originalBuffer = binary(original);
    expect(crypto.createHash('sha256').update(originalBuffer).digest('hex'))
      .toBe(crypto.createHash('sha256').update(documentPng).digest('hex'));

    const preview = await download(`/api/files/${file.id}?variant=preview`, customer.cookie);
    expect(preview.status).toBe(200);
    const previewMeta = await sharp(binary(preview)).metadata();
    expect(previewMeta.format).toBe('webp');
    expect(previewMeta.width).toBeLessThanOrEqual(640);
    expect(previewMeta.width).toBeLessThan(1600);
  }, 60_000);

  it('applies the EXIF orientation while archiving the untouched original', async () => {
    const response = await upload(customer, rotatedJpeg, 'rotated.jpg');
    expect(response.status).toBe(201);
    const file = response.body.data;
    expect(file.processing.status).toBe('ready');
    // stored pixels are 400x800 with orientation 6 → the reader must see 800x400
    expect(file.dimensions).toEqual({ width: 800, height: 400 });

    const displayMeta = await sharp(binary(await download(`/api/files/${file.id}`, customer.cookie))).metadata();
    expect(displayMeta.width).toBe(800);
    expect(displayMeta.height).toBe(400);
    expect(displayMeta.orientation ?? 1).toBe(1);

    const original = await download(`/api/files/${file.id}?variant=original`, customer.cookie);
    const originalMeta = await sharp(binary(original)).metadata();
    expect(originalMeta.width).toBe(400);
    expect(originalMeta.height).toBe(800);
    expect(originalMeta.orientation).toBe(6);
  }, 60_000);

  it('shrinks photographs only when the quality gate still passes', async () => {
    const response = await upload(customer, photoJpeg, 'photo.jpg');
    expect(response.status).toBe(201);
    const file = response.body.data;
    expect(file.processing.status).toBe('ready');
    expect(file.dimensions).toEqual({ width: 1400, height: 900 });

    const displayBuffer = binary(await download(`/api/files/${file.id}`, customer.cookie));
    if (file.savingsPercent > 0) {
      expect(file.size).toBeLessThan(photoJpeg.length);
      const quality = await readability(photoJpeg, displayBuffer);
      // Photographs use the photometric gate (documents are never lossy).
      expect(quality.meanDiff).toBeLessThanOrEqual(2.5);
      expect(quality.maxDiff).toBeLessThanOrEqual(64);
      expect(quality.edgeRatio).toBeGreaterThanOrEqual(0.9);
    } else {
      // Refusing to shrink is a valid outcome; it must then keep the original bytes.
      expect(file.processing.mode).toBe('original');
      expect(crypto.createHash('sha256').update(displayBuffer).digest('hex'))
        .toBe(crypto.createHash('sha256').update(photoJpeg).digest('hex'));
    }
  }, 90_000);

  it('refuses spoofed extensions, corrupt images and PDFs with active content', async () => {
    const pngAsJpg = await upload(customer, documentPng, 'id-card.jpg');
    expect(pngAsJpg.status).toBe(400);
    expect(pngAsJpg.body.error.message).toContain('یکسان نیست');

    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(400)]);
    const corruptResponse = await upload(customer, corrupt, 'broken.jpg');
    expect(corruptResponse.status).toBe(400);
    expect(corruptResponse.body.error.message).toContain('تصویر');

    // An undecodable payload that happens to carry a JPEG header is refused too.
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const truncatedResponse = await upload(customer, truncated, 'truncated.jpg');
    expect(truncatedResponse.status).toBe(400);

    const maliciousPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 3 0 R>>endobj\n' +
      '3 0 obj<</Type/Action/S/JavaScript/JS(app.alert(1))>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    );
    const pdfResponse = await upload(customer, maliciousPdf, 'invoice.pdf');
    expect(pdfResponse.status).toBe(400);
    expect(pdfResponse.body.error.message).toContain('محتوای فعال');

    const textResponse = await upload(customer, Buffer.from('<script>alert(1)</script>'), 'payload.txt');
    expect(textResponse.status).toBe(400);

    // No temporary leftovers: the incoming directory must be empty after refusals.
    const incoming = path.join(env.uploadDir, 'incoming');
    const leftovers = fs.existsSync(incoming) ? fs.readdirSync(incoming) : [];
    expect(leftovers).toEqual([]);
  }, 60_000);

  it('refuses oversized images up front and survives a later processing failure', async () => {
    await updateSettings({ 'files.image_max_pixels': 1_000_000 }, actor, { confirmCritical: true });
    try {
      const response = await upload(customer, mediumPng, 'big.png');
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('ابعاد');
    } finally {
      await updateSettings({ 'files.image_max_pixels': 50_000_000 }, actor, { confirmCritical: true });
    }

    // A failure *after* a successful conversion must never destroy the served copy.
    const uploaded = await upload(customer, documentPng, 'resilient.png');
    const file = uploaded.body.data;
    expect(file.processing.status).toBe('ready');
    const originalRow = await one<any>('SELECT original_storage_key FROM files WHERE id = ?', [file.id]);
    fs.rmSync(resolveStoragePath(originalRow.original_storage_key), { force: true });

    const reprocessed = await request(server).post(`/api/files/${file.id}/reprocess`).set('Cookie', admin.cookie);
    expect(reprocessed.status).toBe(200);
    expect(reprocessed.body.data.processing.status).toBe('failed');
    expect(reprocessed.body.data.processing.error).toBeTruthy();

    const display = await download(`/api/files/${file.id}`, customer.cookie);
    expect(display.status).toBe(200);
    expect(display.headers['content-type']).toContain('image/webp');
    expect((await sharp(binary(display)).metadata()).width).toBe(1600);

    const queue = await request(server).get('/api/requests/pending-documents').set('Cookie', admin.cookie).expect(200);
    expect(queue.body.data).toEqual([]);
  }, 60_000);

  it('reuses the optimised output for byte-identical uploads instead of re-encoding', async () => {
    const first = await upload(customer, documentPng, 'first-copy.png');
    const second = await upload(customer, documentPng, 'second-copy.png');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.processing.status).toBe('ready');
    expect(second.body.data.deduplicatedFrom).toBe(first.body.data.id);
    expect(second.body.data.size).toBe(first.body.data.size);
    expect(second.body.data.processing.mode).toBe(first.body.data.processing.mode);
  }, 60_000);

  it('enforces document access control and records original downloads', async () => {
    const created = await upload(customer, documentPng, 'private-card.png');
    const fileId = created.body.data.id;

    await request(server).get(`/api/files/${fileId}`).expect(401);
    await request(server).get(`/api/files/${fileId}`).set('Cookie', otherCustomer.cookie).expect(403);
    await request(server).get(`/api/files/${fileId}`).set('Cookie', operator.cookie).expect(403);
    await request(server).get(`/api/files/${fileId}`).set('Cookie', customer.cookie).expect(200);
    await request(server).get(`/api/files/${fileId}?variant=original`).set('Cookie', otherCustomer.cookie).expect(403);
    await request(server).get(`/api/files/${fileId}?variant=original`).set('Cookie', customer.cookie).expect(200);
    await request(server).get(`/api/files/${fileId}?variant=original`).set('Cookie', admin.cookie).expect(200);
    await request(server).get(`/api/files/${fileId}/history`).set('Cookie', customer.cookie).expect(403);
    const history = await request(server).get(`/api/files/${fileId}/history`).set('Cookie', admin.cookie).expect(200);
    expect(history.body.data.some((row: any) => row.action === 'original')).toBe(true);

    // A tampered storage key may never escape the upload root.
    expect(() => resolveStoragePath('../etc/passwd')).toThrow();
    expect(() => resolveStoragePath('private/../../etc/passwd')).toThrow();
    await run(
      `INSERT INTO files (id, owner_id, name, mime, size, storage_key, sha256, is_public, purpose, created_at, processing_status)
       VALUES ('file-traversal', ?, 'escape.txt', 'text/plain', 3, '../escape.txt', 'x', 0, 'document', ?, 'none')`,
      [customerId, new Date().toISOString()],
    );
    const traversal = await request(server).get('/api/files/file-traversal').set('Cookie', admin.cookie);
    expect(traversal.status).toBe(400);
  }, 60_000);

  it('handles several simultaneous uploads without mixing records', async () => {
    const responses = await Promise.all([
      upload(customer, documentPng, 'concurrent-a.png'),
      upload(customer, smallPng, 'concurrent-b.png'),
      upload(customer, photoJpeg, 'concurrent-c.jpg'),
      upload(customer, rotatedJpeg, 'concurrent-d.jpg'),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(201);
      expect(response.body.data.processing.status).toBe('ready');
    }
    const ids = responses.map((response) => response.body.data.id);
    expect(new Set(ids).size).toBe(4);
    const dimensions = responses.map((response) => response.body.data.dimensions);
    expect(dimensions[0]).toEqual({ width: 1600, height: 1000 });
    expect(dimensions[1]).toEqual({ width: 120, height: 90 });
    expect(dimensions[2]).toEqual({ width: 1400, height: 900 });
    expect(dimensions[3]).toEqual({ width: 800, height: 400 });
  }, 120_000);

  it('stores PDFs unchanged, skips image processing and refuses previews', async () => {
    const response = await upload(customer, PDF_FIXTURE, 'certificate.pdf');
    expect(response.status).toBe(201);
    const file = response.body.data;
    expect(file.mime).toBe('application/pdf');
    expect(file.processing.status).toBe('skipped');
    expect(file.savingsPercent).toBe(0);
    expect(file.previewUrl).toBeNull();

    const display = await download(`/api/files/${file.id}`, customer.cookie);
    expect(display.status).toBe(200);
    expect(display.headers['content-disposition']).toContain('attachment');
    expect(display.headers['content-security-policy']).toContain('sandbox');
    expect(crypto.createHash('sha256').update(binary(display)).digest('hex'))
      .toBe(crypto.createHash('sha256').update(PDF_FIXTURE).digest('hex'));
    await request(server).get(`/api/files/${file.id}?variant=preview`).set('Cookie', customer.cookie).expect(404);
  }, 60_000);

  it('can disable processing at runtime and re-run it on demand', async () => {
    await updateSettings({ 'files.process_images': false }, actor, { confirmCritical: true });
    let fileId: string;
    try {
      const response = await upload(customer, documentPng, 'raw-upload.png');
      expect(response.status).toBe(201);
      expect(response.body.data.processing.status).toBe('skipped');
      expect(response.body.data.mime).toBe('image/png');
      fileId = response.body.data.id;
    } finally {
      await updateSettings({ 'files.process_images': true }, actor, { confirmCritical: true });
    }

    await request(server).post(`/api/files/${fileId}/reprocess`).set('Cookie', operator.cookie).expect(403);
    const reprocessed = await request(server).post(`/api/files/${fileId}/reprocess`).set('Cookie', admin.cookie).expect(200);
    expect(reprocessed.body.data.processing.status).toBe('ready');
    expect(reprocessed.body.data.mime).toBe('image/webp');
    expect(reprocessed.body.data.savingsPercent).toBeGreaterThan(0);

    const stats = await request(server).get('/api/files/media/stats').set('Cookie', admin.cookie).expect(200);
    expect(stats.body.data.totalFiles).toBeGreaterThan(0);
    expect(stats.body.data.byStatus.ready).toBeGreaterThan(0);
    expect(stats.body.data.originalBytes).toBeGreaterThan(stats.body.data.servedSavingsBytes);
    await request(server).get('/api/files/media/stats').set('Cookie', customer.cookie).expect(403);
  }, 90_000);
});

describe('customer profile document archive', () => {
  let profileFileId: string;
  let profileDocumentId: string;
  let requestId: string;

  it('registers an uploaded file as a profile document and derives its validity', async () => {
    const uploaded = await upload(customer, documentPng, 'profile-card.png');
    expect(uploaded.status).toBe(201);
    profileFileId = uploaded.body.data.id;

    const created = await request(server).post('/api/documents/mine').set('Cookie', customer.cookie)
      .send({ fileId: profileFileId, docType: 'passport', issuedAt: '2025-01-01' });
    expect(created.status).toBe(201);
    const document = created.body.data;
    profileDocumentId = document.id;
    expect(document.docType).toBe('passport');
    expect(document.status).toBe('pending');
    expect(document.validity).toBe('valid');
    expect(new Date(document.expiresAt).getTime()).toBe(new Date('2025-01-01T00:00:00.000Z').getTime() + 1825 * 86_400_000);

    const duplicate = await request(server).post('/api/documents/mine').set('Cookie', customer.cookie)
      .send({ fileId: profileFileId, docType: 'passport' });
    expect(duplicate.status).toBe(409);

    const listed = await request(server).get('/api/documents/mine').set('Cookie', customer.cookie).expect(200);
    expect(listed.body.data.map((row: any) => row.id)).toContain(profileDocumentId);
    expect(listed.body.meta.types.some((row: any) => row.code === 'passport' && row.counts.total >= 1)).toBe(true);
  }, 60_000);

  it('requires explicit confirmation, blocks expired documents and refuses duplicates', async () => {
    const createdRequest = await request(server).post('/api/requests').set('Cookie', customer.cookie)
      .send({ serviceId, formData: {}, paymentMethod: 'cash' });
    expect(createdRequest.status).toBe(201);
    requestId = createdRequest.body.data.id;

    const withoutConfirmation = await request(server).post(`/api/requests/${requestId}/documents`)
      .set('Cookie', customer.cookie)
      .send({ customerDocumentId: profileDocumentId, confirmReuse: false });
    expect(withoutConfirmation.status).toBe(400);
    expect(withoutConfirmation.body.error.message).toContain('تأیید');

    const reused = await request(server).post(`/api/requests/${requestId}/documents`)
      .set('Cookie', customer.cookie)
      .send({ customerDocumentId: profileDocumentId, confirmReuse: true });
    expect(reused.status).toBe(200);
    const attached = reused.body.data.documents.find((row: any) => row.customerDocumentId === profileDocumentId);
    expect(attached).toBeTruthy();
    expect(attached.documentType).toBe('passport');
    expect(attached.file.processing.status).toBe('ready');
    expect(attached.file.previewUrl).toContain('variant=preview');
    expect(attached.file.originalUrl).toContain('variant=original');

    const again = await request(server).post(`/api/requests/${requestId}/documents`)
      .set('Cookie', customer.cookie)
      .send({ customerDocumentId: profileDocumentId, confirmReuse: true });
    expect(again.status).toBe(409);

    // An expired document can be archived (traceability) but never reused.
    const expiredUpload = await upload(customer, smallPng, 'old-bill.png');
    const expired = await request(server).post('/api/documents/mine').set('Cookie', customer.cookie)
      .send({ fileId: expiredUpload.body.data.id, docType: 'utility_bill', issuedAt: '2020-01-01', expiresAt: '2020-06-01' });
    expect(expired.status).toBe(201);
    expect(expired.body.data.validity).toBe('expired');
    const expiredReuse = await request(server).post(`/api/requests/${requestId}/documents`)
      .set('Cookie', customer.cookie)
      .send({ customerDocumentId: expired.body.data.id, confirmReuse: true });
    expect(expiredReuse.status).toBe(409);
    expect(expiredReuse.body.error.message).toContain('اعتبار');

    // The archive record cannot be deleted while a live case uses it.
    const blockedDeletion = await request(server).delete(`/api/documents/mine/${profileDocumentId}`).set('Cookie', customer.cookie);
    expect(blockedDeletion.status).toBe(409);
    const foreignDeletion = await request(server).delete(`/api/documents/mine/${profileDocumentId}`).set('Cookie', otherCustomer.cookie);
    expect(foreignDeletion.status).toBe(404);
  }, 90_000);

  it('lets authorised staff review profile documents and keeps other staff out', async () => {
    // A customer with no case assigned to this expert: permission alone is not enough.
    const otherCustomerId = (await request(server).get('/api/auth/me').set('Cookie', otherCustomer.cookie)).body.data.id;
    const foreignList = await request(server).get(`/api/documents/customer/${otherCustomerId}`).set('Cookie', operator.cookie);
    expect(foreignList.status).toBe(403);
    const adminList = await request(server).get(`/api/documents/customer/${customerId}`).set('Cookie', admin.cookie).expect(200);
    expect(adminList.body.data.length).toBeGreaterThan(0);

    const review = await request(server).post(`/api/documents/${profileDocumentId}/review`).set('Cookie', admin.cookie)
      .send({ decision: 'approved', note: 'بررسی شد' });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('approved');
    expect(review.headers).toBeTruthy();

    // An expert with no case for this customer cannot review their archive either.
    const foreignUpload = await upload(otherCustomer, smallPng, 'foreign.png');
    expect(foreignUpload.status).toBe(201);
    const foreignDoc = await request(server).post('/api/documents/mine').set('Cookie', otherCustomer.cookie)
      .send({ fileId: foreignUpload.body.data.id, docType: 'other' });
    expect(foreignDoc.status).toBe(201);
    await request(server).post(`/api/documents/${foreignDoc.body.data.id}/review`).set('Cookie', operator.cookie)
      .send({ decision: 'approved' }).expect(403);
    await request(server).get(`/api/documents/${foreignDoc.body.data.id}`).set('Cookie', operator.cookie).expect(403);

    const byId = await request(server).get(`/api/documents/${profileDocumentId}`).set('Cookie', customer.cookie).expect(200);
    expect(byId.body.data.status).toBe('approved');
    await request(server).get(`/api/documents/${profileDocumentId}`).set('Cookie', otherCustomer.cookie).expect(403);

    const customerDetail = await request(server).get(`/api/customers/${customerId}`).set('Cookie', admin.cookie).expect(200);
    expect(customerDetail.body.data.profileDocuments.some((row: any) => row.id === profileDocumentId)).toBe(true);

    // Staff can see the archive of a customer they own a case for.
    await run("UPDATE requests SET assigned_to = ?, status = 'in_progress' WHERE id = ?", [operatorId, requestId]);
    const scopedList = await request(server).get(`/api/documents/customer/${customerId}`).set('Cookie', operator.cookie);
    expect(scopedList.status).toBe(200);
  }, 60_000);

  it('reveals processing status of every attachment in the staff review queue', async () => {
    const queue = await request(server).get('/api/requests/pending-documents').set('Cookie', admin.cookie).expect(200);
    expect(queue.body.data.length).toBeGreaterThan(0);
    const item = queue.body.data[0];
    expect(item.file.processing).toBeTruthy();
    expect(item.file.processing.status).toBe('ready');
    expect(item.file.displayUrl).toBe(`/api/files/${item.file.id}`);
    expect(item.file.previewUrl).toContain('variant=preview');
  }, 30_000);
});

describe('chat attachments reuse the media pipeline', () => {
  it('returns attachment metadata, keeps the thumbnail private and blocks outsiders', async () => {
    const thread = await request(server).post('/api/messages/threads').set('Cookie', customer.cookie)
      .send({ subject: 'پیوست تصویر' });
    expect(thread.status).toBe(201);
    const threadId = thread.body.data.id;

    const uploaded = await upload(customer, documentPng, 'chat-id.png', 'purpose=chat');
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.data.id;

    const sent = await request(server).post(`/api/messages/threads/${threadId}/messages`).set('Cookie', customer.cookie)
      .send({ body: 'فایل پیوست', fileId });
    expect(sent.status).toBe(201);

    const detail = await request(server).get(`/api/messages/threads/${threadId}`).set('Cookie', customer.cookie).expect(200);
    const message = detail.body.data.messages.find((row: any) => row.fileId === fileId);
    expect(message).toBeTruthy();
    expect(message.file).toMatchObject({ id: fileId, mime: 'image/webp', name: 'chat-id.png' });
    expect(message.file.size).toBeGreaterThan(0);
    expect(message.file.processingStatus).toBe('ready');

    // The preview is served to the owner only.
    const preview = await download(`/api/files/${fileId}?variant=preview`, customer.cookie);
    expect(preview.status).toBe(200);
    await request(server).get(`/api/files/${fileId}`).set('Cookie', otherCustomer.cookie).expect(403);
  }, 60_000);
});
