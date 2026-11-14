/**
 * SQL dialect parity guard.
 *
 * The application runs on PostgreSQL in production and SQLite during local
 * development on Windows. The two engines agree on far less than they appear
 * to, and every disagreement that was found in practice was invisible on
 * SQLite and fatal in production. This suite pins down the differences that
 * actually bit us, so a future query cannot quietly reintroduce them.
 *
 * Every case below is written twice on purpose: once as raw SQL executed
 * against whatever driver the suite is running on, and once as an assertion
 * that the *type* and *value* match what the application expects. Run the
 * suite with PISHKAN_TEST_DB=postgres as well as the SQLite default; a query
 * that only works on one engine fails here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, q, one, run } from '../src/db/index.js';
import { setup } from './helpers.js';

describe('SQL dialect parity', () => {
  beforeAll(async () => { await setup(); });

  it('sums a conditional count without relying on SUM(boolean)', async () => {
    // `SUM(status = 'x')` returns an integer count on SQLite (comparisons yield
    // 0/1) but raises `function sum(boolean) does not exist` on PostgreSQL.
    // The portable form is an explicit CASE.
    const now = new Date().toISOString();
    await run(`INSERT INTO app_banners (id, title, subtitle, status, sort_order, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?)`, ['dl-b1', 'a', null, 'published', 1, now, now]);
    await run(`INSERT INTO app_banners (id, title, subtitle, status, sort_order, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?)`, ['dl-b2', 'b', null, 'draft', 2, now, now]);
    const row = await one<any>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END), 0) AS published,
              COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft
       FROM app_banners`,
    );
    expect(row.published).toBe(1);
    expect(row.draft).toBe(1);
  });

  it('returns counts as numbers, not strings', async () => {
    // PostgreSQL returns bigint (COUNT, SUM of integer) as a *string* to protect
    // 64-bit precision; SQLite returns a number. The driver normalises them so
    // `count + 1` is arithmetic on both engines instead of string concatenation.
    const row = await one<any>('SELECT COUNT(*) AS c FROM app_banners');
    expect(typeof row.c).toBe('number');
    expect(row.c).toBe(2);
  });

  it('keeps a fractional parameter numeric inside SUM', async () => {
    // `SUM(CASE WHEN ... THEN ? ELSE 1 END)` makes PostgreSQL infer the
    // parameter as integer from the `1` literal and reject 0.25 with
    // `invalid input syntax for type integer`. The CAST is what makes the same
    // statement valid on both engines, and the weighted load is fractional.
    const row = await one<any>('SELECT CAST(SUM(CASE WHEN ? > 0 THEN CAST(? AS NUMERIC) ELSE 1 END) AS NUMERIC) AS w',
      [1, 0.25]);
    expect(Number(row.w)).toBe(0.25);
  });

  it('survives a failed statement inside a transaction only after a savepoint', async () => {
    // This is the production bug that started the whole investigation: on
    // PostgreSQL one failed statement aborts the enclosing transaction and every
    // later statement fails with "current transaction is aborted, commands
    // ignored until end of transaction block". SQLite happily continues, so the
    // fault never appeared on Windows. `tx` must therefore let a caller run a
    // best-effort statement that may fail without poisoning the transaction.
    const { txSavepoint } = await import('../src/db/index.js');
    const exec = (sql: string) => getDb().then((db) => db.exec(sql));
    const marker = `dl-sp-${Date.now()}`;
    await exec(`CREATE TABLE IF NOT EXISTS __dialect_probe (id TEXT PRIMARY KEY)`);
    await run('DELETE FROM __dialect_probe');
    await run('INSERT INTO __dialect_probe (id) VALUES (?)', ['kept']);

    const outcome = await txSavepoint(async (db) => {
      // The duplicate key fails on purpose; the caller must still be able to
      // finish its work and commit.
      await db.run('INSERT INTO __dialect_probe (id) VALUES (?)', ['kept']).catch(() => 'ignored');
      await db.run('INSERT INTO __dialect_probe (id) VALUES (?)', [marker]);
      return await db.one<any>('SELECT COUNT(*) AS c FROM __dialect_probe');
    });

    expect(outcome.c).toBe(2);
    const rows = await q<any>('SELECT id FROM __dialect_probe ORDER BY id');
    expect(rows.map((r) => r.id)).toContain(marker);
    await run('DELETE FROM __dialect_probe');
    await exec('DROP TABLE IF EXISTS __dialect_probe');
  });
});
