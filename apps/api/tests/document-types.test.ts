import { describe, expect, it } from 'vitest';
import { app } from './helpers.js';
import { getServiceBySlug, backfillServiceDocumentTypes } from '../src/modules/catalog/service.js';
import { inferDocumentType } from '../src/modules/documents/service.js';
import { one, q, run } from '../src/db/index.js';

/**
 * Document requirements used to carry no `documentType` at all.
 *
 * That is what made «ذخیره مدارک» look broken rather than merely unfinished: a
 * document could be saved to the profile perfectly, but nothing could ever match
 * it back to a requirement, so every new request asked for the same national
 * card again. Both halves are covered here — the types the seed now ships, and
 * the backfill that gives them to a database seeded before they existed.
 */
describe('service document requirements carry a usable type', () => {
  it('seeds the common requirements with the profile type they correspond to', async () => {
    await app();
    const national = await getServiceBySlug('insurance-history');
    const card = (national?.documents ?? []).find((doc) => doc.title.includes('کارت ملی'));
    expect(card, 'the seeded service must still ask for a national card').toBeTruthy();
    expect(card!.documentType).toBe('national_card');

    const passport = await getServiceBySlug('passport-renewal').catch(() => null);
    if (passport?.documents?.length) {
      expect(passport.documents.every((doc) => doc.title.length > 0)).toBe(true);
    }
  });

  it('reads a type out of a Persian title, and only when it is unambiguous', () => {
    expect(inferDocumentType('تصویر کارت ملی')).toBe('national_card');
    expect(inferDocumentType('تصویر کارت ملی پشت و رو (واضح)')).toBe('national_card');
    // Two documents in one slot: no single type is correct, so it abstains.
    expect(inferDocumentType('تصویر شناسنامه و کارت ملی همسر')).toBeNull();
    expect(inferDocumentType('تصویر صفحه اول شناسنامه')).toBe('birth_certificate');
    expect(inferDocumentType('پروانه کسب و مجوز فعالیت')).toBe('business_license');
    expect(inferDocumentType('عکس پرسنلی ۳×۴ جدید')).toBe('personal_photo');
    expect(inferDocumentType('مدرک احراز محل سکونت (قبض خدماتی / اجاره‌نامه / سند)')).toBe('utility_bill');

    // A title with no category must not be guessed at: filing it somewhere the
    // next request will never look is worse than leaving it per-request.
    expect(inferDocumentType('تصویر برگ سبز خودرو (سند مالکیت)')).toBeNull();
    expect(inferDocumentType('صورتجلسه هیئت‌مدیره')).toBeNull();
    expect(inferDocumentType('')).toBeNull();
  });

  it('backfills an install seeded before the types existed, once', async () => {
    await app();
    // Recreate the legacy state: types stripped, marker gone.
    const rows = await q<{ id: string; documents: string }>('SELECT id, documents FROM services');
    for (const row of rows) {
      const documents = JSON.parse(String(row.documents) || '[]');
      await run('UPDATE services SET documents = ? WHERE id = ?', [
        JSON.stringify(documents.map((doc: any) => {
          const { documentType: _dropped, ...rest } = doc;
          return rest;
        })),
        row.id,
      ]);
    }
    await run("DELETE FROM settings WHERE key = 'internal.service_document_types_v1'");

    const stripped = JSON.parse(String(
      (await one<{ documents: string }>('SELECT documents FROM services WHERE slug = ?', ['insurance-history']))!.documents,
    ));
    expect(stripped.some((doc: any) => doc.documentType)).toBe(false);

    expect(await backfillServiceDocumentTypes()).toBeGreaterThan(0);

    const filled = JSON.parse(String(
      (await one<{ documents: string }>('SELECT documents FROM services WHERE slug = ?', ['insurance-history']))!.documents,
    ));
    const card = filled.find((doc: any) => doc.title.includes('کارت ملی'));
    expect(card?.documentType).toBe('national_card');

    // The marker makes it a one-time repair, not work on every boot.
    expect(await backfillServiceDocumentTypes()).toBe(0);
  });
});
