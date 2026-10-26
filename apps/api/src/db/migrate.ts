import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, nowIso } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Migration directory resolution works both from src/ (tsx) and dist/ (compiled). */
export function migrationsDir(): string {
  const candidates = [
    path.resolve(here, '../../migrations'),
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), 'apps/api/migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`migration directory not found (looked in: ${candidates.join(', ')})`);
}

/** Ordered, stable list of migration files. */
export function listMigrations(dir = migrationsDir()): { name: string; sql: string; checksum: string }[] {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      return { name: file, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

export type MigrationResult = { applied: string[]; skipped: string[] };

/**
 * Idempotent migration runner. Every migration is recorded with a checksum so
 * that a modified migration is detected instead of silently ignored.
 */
export async function migrate(options: { log?: (msg: string) => void } = {}): Promise<MigrationResult> {
  const log = options.log ?? (() => undefined);
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const appliedRows = await db.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
  const appliedMap = new Map(appliedRows.map((r) => [r.name, r.checksum]));
  const result: MigrationResult = { applied: [], skipped: [] };

  for (const migration of listMigrations()) {
    const existing = appliedMap.get(migration.name);
    if (existing) {
      if (existing !== migration.checksum) {
        throw new Error(
          `migration ${migration.name} changed after being applied (checksum mismatch). ` +
          'Create a new migration instead of editing an applied one.',
        );
      }
      result.skipped.push(migration.name);
      continue;
    }

    log(`applying ${migration.name}`);
    // SQLite and PostgreSQL both support transactional DDL. A failed additive
    // migration must not leave half-applied ALTERs without a checksum record.
    await db.tx(async connection=>{
      await connection.exec(migration.sql);
      await connection.run('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)',[migration.name,migration.checksum,nowIso()]);
    });
    result.applied.push(migration.name);
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate({ log: (m) => console.log(`[migrate] ${m}`) })
    .then((r) => {
      console.log(`[migrate] done. applied=${r.applied.length} skipped=${r.skipped.length}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
