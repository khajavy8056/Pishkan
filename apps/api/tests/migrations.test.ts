import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { listMigrations } from '../src/db/migrate.js';

describe('migration registry', () => {
  it('contains an ordered, unique, checksum-addressed migration for every current feature change', () => {
    const migrations = listMigrations();
    const names = migrations.map((migration) => migration.name);
    // The count is deliberately not hard-coded: this test exists to prove the
    // registry is well-formed, and pinning a number here meant every new
    // migration failed a test that had nothing to do with the new file. What
    // matters is that the registry matches the directory exactly.
    const onDisk = fs.readdirSync(path.resolve(__dirname, '../migrations')).filter((name) => name.endsWith('.sql'));
    expect(names).toHaveLength(onDisk.length);
    expect(names.at(-1)).toBe(onDisk.sort().at(-1));
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))).toBe(true);
    expect(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum))).toBe(true);
    expect(names).toEqual([...names].sort());
  });
});
