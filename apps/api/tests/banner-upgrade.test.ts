import { describe, expect, it } from 'vitest';
import { app } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { seedDefaultBanners } from '../src/modules/mobile/service.js';

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

    const kinds = await one<{ n: number }>('SELECT COUNT(DISTINCT kind) AS n FROM app_banners');
    expect(Number(kinds?.n)).toBeGreaterThanOrEqual(3);

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
});
