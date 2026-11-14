import { describe, expect, it } from 'vitest';
import { app } from './helpers.js';
import { one, q, run } from '../src/db/index.js';
import { seedDefaultBanners, upgradeStarterBanners } from '../src/modules/mobile/service.js';

/**
 * Starter banners, and the promise that deleting them is permanent.
 *
 * Seeding is idempotent by design, and the property that matters is not "a
 * fresh install has banners" — it is "an office that deliberately cleared
 * them does not get them back on the next restart". A seed without that
 * second half quietly overwrites a decision the office made, every deploy.
 */
describe('starter banners', () => {
  it('seeds several distinct banners on a fresh install', async () => {
    await app();
    const seeded = await seedDefaultBanners();
    // More than one, and more than one kind: the rail has to be able to carry
    // a general card, a service card and an informational card at once.
    expect(seeded).toBeGreaterThanOrEqual(3);
    const rows = await one<{ n: number }>('SELECT COUNT(*) AS n FROM app_banners');
    expect(Number(rows?.n)).toBe(seeded);

    // The starter set is a *slider*: five slides of one campaign, so a single
    // `kind` is correct now. What has to stay true is that each slide carries
    // its own artwork and its own picture path — the previous generation reused
    // catalogue thumbnails, and the one before that pointed every card at the
    // same fallback, which is why the rail showed one picture five times.
    const distinctArt = await one<{ n: number }>(
      'SELECT COUNT(DISTINCT image_url) AS n FROM app_banners WHERE image_url IS NOT NULL',
    );
    expect(Number(distinctArt?.n)).toBeGreaterThanOrEqual(5);
    const distinctTitles = await one<{ n: number }>('SELECT COUNT(DISTINCT title) AS n FROM app_banners');
    expect(Number(distinctTitles?.n)).toBeGreaterThanOrEqual(5);

    // Every seeded service banner must point at a real service, or its tap
    // would 404 on a customer's phone.
    const serviceBanners = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM app_banners WHERE destination_kind = 'service'",
    );
    expect(Number(serviceBanners?.n)).toBeGreaterThanOrEqual(2);
    const dangling = await one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM app_banners b
        WHERE b.destination_kind = 'service'
          AND NOT EXISTS (SELECT 1 FROM services s WHERE s.slug = b.destination_slug AND s.archived_at IS NULL)`,
    );
    expect(Number(dangling?.n)).toBe(0);
  });

  it('never recreates banners the office deleted', async () => {
    await app();
    await seedDefaultBanners();
    await run('DELETE FROM app_banners');
    expect(await seedDefaultBanners()).toBe(0);
    const rows = await one<{ n: number }>('SELECT COUNT(*) AS n FROM app_banners');
    expect(Number(rows?.n)).toBe(0);
  });

  /**
   * The upgrade to the five-slide set is the one place this file could quietly
   * undo a decision the office made, so each promise gets its own assertion.
   */
  it('rewrites a first-generation install into the five-slide slider', async () => {
    await app();
    await run('DELETE FROM app_banners');
    await run("DELETE FROM settings WHERE key IN ('internal.starter_banners_initialized', 'internal.starter_banners_v2')");
    // Exactly what the old version seeded: catalogue thumbnails, six cards.
    const legacy = [
      ['همهٔ خدمات، بدون مراجعه حضوری', '/images/services/backdrops/insurance-health.webp', '/app/services'],
      ['تعویض پلاک، بدون صف', '/images/services/individual/plate-replacement-appointment.webp', null],
      ['ثبت شرکت با مسئولیت محدود', '/images/services/backdrops/companies-institutions.webp', null],
      ['وام ازدواج، بی‌دغدغه', '/images/services/individual/marriage-loan-registration.webp', null],
      ['کارت ملی هوشمند', '/images/services/individual/smart-national-card-registration.webp', null],
      ['پیگیری لحظه‌ای پرونده', '/images/services/backdrops/insurance-health.webp', '/app/requests'],
    ];
    for (const [index, [title, image, url]] of legacy.entries()) {
      await run(
        `INSERT INTO app_banners
          (id, kind, title, subtitle, image_file_id, image_url, accent_color,
           destination_kind, destination_slug, destination_url, action_label,
           sort_order, starts_at, expires_at, status, notify_customers, created_by, created_at, updated_at)
         VALUES (?, 'service', ?, 'x', NULL, ?, '#1F6FEE',
                 'url', NULL, ?, 'باز کردن', ?, NULL, NULL, 'published', 0, 'system', ?, ?)`,
        [`legacy-${index}`, title, image, url, index + 1, '2020-01-01', '2020-01-01'],
      );
    }

    expect(await upgradeStarterBanners()).toBe(5);
    const rows = await q<any>('SELECT * FROM app_banners ORDER BY sort_order');
    expect(rows).toHaveLength(5);
    // Every old catalogue thumbnail is gone, replaced by a drawn slide.
    for (const row of rows) {
      expect(String(row.image_url)).toContain('/images/banners/slide-');
    }
    // The ids survived, so nothing that referenced a card was orphaned.
    expect(rows[0].id).toBe('legacy-0');
    // And it is one-shot.
    expect(await upgradeStarterBanners()).toBe(0);
  });

  it('leaves a card the office edited alone, and does not resurrect deleted ones', async () => {
    await app();
    await run('DELETE FROM app_banners');
    await run("DELETE FROM settings WHERE key IN ('internal.starter_banners_initialized', 'internal.starter_banners_v2')");
    // One untouched first-generation card, and one the office retitled.
    await run(
      `INSERT INTO app_banners
        (id, kind, title, subtitle, image_file_id, image_url, accent_color,
         destination_kind, destination_slug, destination_url, action_label,
         sort_order, starts_at, expires_at, status, notify_customers, created_by, created_at, updated_at)
       VALUES ('untouched', 'service', 'تعویض پلاک، بدون صف', 'x', NULL,
               '/images/services/individual/plate-replacement-appointment.webp', '#1F6FEE',
               'url', NULL, '/app/services', 'باز کردن', 1, NULL, NULL, 'published', 0, 'system', '2020-01-01', '2020-01-01')`,
    );
    await run(
      `INSERT INTO app_banners
        (id, kind, title, subtitle, image_file_id, image_url, accent_color,
         destination_kind, destination_slug, destination_url, action_label,
         sort_order, starts_at, expires_at, status, notify_customers, created_by, created_at, updated_at)
       VALUES ('edited', 'service', 'تعویض پلاک، بدون صف', 'x', NULL,
               '/images/services/individual/plate-replacement-appointment.webp', '#1F6FEE',
               'url', NULL, '/app/services', 'باز کردن', 2, NULL, NULL, 'published', 0, 'system', '2020-01-01', '2020-01-01')`,
    );
    await run("UPDATE app_banners SET title = 'کمپین نوروزی ما' WHERE id = 'edited'");

    await upgradeStarterBanners();
    const edited = await one<any>("SELECT * FROM app_banners WHERE id = 'edited'");
    expect(edited?.title).toBe('کمپین نوروزی ما');
    const untouched = await one<any>("SELECT * FROM app_banners WHERE id = 'untouched'");
    expect(String(untouched?.image_url)).toContain('/images/banners/slide-');
  });
});
