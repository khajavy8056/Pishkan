import { describe, expect, it } from 'vitest';
import { listMigrations } from '../src/db/migrate.js';

describe('migration registry', () => {
  it('contains an ordered, unique, checksum-addressed migration for every current feature change', () => {
    const migrations = listMigrations();
    const names = migrations.map((migration) => migration.name);
    expect(names).toHaveLength(15);
    expect(names.at(-1)).toBe('015_request_submission_idempotency.sql');
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))).toBe(true);
    expect(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum))).toBe(true);
    expect(names).toEqual([...names].sort());
  });
});
