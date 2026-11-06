import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = (name: string) => readFileSync(join(process.cwd(), 'migrations', name), 'utf8');

describe('non-destructive geography and artwork upgrades', () => {
  it('retains existing city identifiers and administrator artwork', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE cities (id TEXT PRIMARY KEY, province TEXT NOT NULL, name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, UNIQUE(province,name));
        CREATE TABLE services (slug TEXT PRIMARY KEY, icon TEXT, image TEXT);
        INSERT INTO cities VALUES ('andimeshk','خوزستان','اندیمشک',1),('custom','تهران','شهر سفارشی دفتر',0);
        INSERT INTO services VALUES ('social-security-receipt','receipt-text',NULL),('fuel-card','custom-icon','/uploads/public/my-image.png');`);
      db.exec(migration('030_iran_cities.sql'));
      db.exec(migration('031_default_service_artwork.sql'));
      db.exec(migration('032_default_service_icons.sql'));
      expect(db.prepare("SELECT id FROM cities WHERE province='خوزستان' AND name='اندیمشک'").get()).toEqual({ id: 'andimeshk' });
      expect(db.prepare("SELECT is_active FROM cities WHERE id='custom'").get()).toEqual({ is_active: 0 });
      expect(Number(db.prepare('SELECT COUNT(DISTINCT province) AS n FROM cities').get()?.n)).toBe(31);
      expect(db.prepare("SELECT icon,image FROM services WHERE slug='social-security-receipt'").get()).toMatchObject({ icon: '🧾', image: '/images/services/insurance.png' });
      expect(db.prepare("SELECT icon,image FROM services WHERE slug='fuel-card'").get()).toEqual({ icon: 'custom-icon', image: '/uploads/public/my-image.png' });
    } finally { db.close(); }
  });
});
