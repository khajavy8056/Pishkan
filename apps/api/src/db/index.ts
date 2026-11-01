/**
 * Portable database layer.
 *
 * The whole application is written against a single SQL dialect that is valid
 * on both PostgreSQL (production) and SQLite (development / CI). Rules:
 *   - only TEXT / INTEGER column types
 *   - `?` placeholders, numbered for PostgreSQL automatically
 *   - no vendor specific functions (no ILIKE, no now(), no `::` casts)
 *   - timestamps are ISO-8601 TEXT, ids are application generated TEXT
 */
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { env } from '../env.js';

export type Row = Record<string, any>;
export type Params = any[];

export interface ExecResult {
  changes: number;
}

export interface Db {
  readonly driver: 'postgres' | 'sqlite';
  query<T = Row>(sql: string, params?: Params): Promise<T[]>;
  one<T = Row>(sql: string, params?: Params): Promise<T | null>;
  run(sql: string, params?: Params): Promise<ExecResult>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  snapshot?(target: string): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*                              placeholder helpers                            */
/* -------------------------------------------------------------------------- */

/**
 * Convert `?` placeholders into PostgreSQL `$1..$n` while leaving question
 * marks inside single quoted string literals untouched.
 */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let inString = false;
  let n = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      // handle escaped '' inside literals
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inString = !inString;
      out += ch;
      continue;
    }
    if (ch === '?' && !inString) {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Normalise values so both drivers behave the same way. */
function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

/* -------------------------------------------------------------------------- */
/*                                SQLite driver                                */
/* -------------------------------------------------------------------------- */

async function createSqliteDb(file: string, readonly = false): Promise<Db> {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file, { readOnly: readonly });
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec('PRAGMA busy_timeout = 5000');

  const make = (connection: typeof conn): Db => ({
    driver: 'sqlite',
    async snapshot(target: string) { const { backup } = await import('node:sqlite'); await backup(connection, target); },
    async query<T>(sql: string, params: Params = []) {
      const stmt = connection.prepare(sql);
      // Node's sqlite binding only accepts numbers, strings, bigints, null and buffers.
      const safe = params.map((p) => {
        const v = normalizeParam(p);
        return typeof v === 'boolean' ? (v ? 1 : 0) : v;
      });
      return stmt.all(...(safe as any[])) as T[];
    },
    async one<T>(sql: string, params: Params = []) {
      const rows = await this.query<T>(sql, params);
      return (rows[0] as T) ?? null;
    },
    async run(sql: string, params: Params = []) {
      const stmt = connection.prepare(sql);
      const safe = params.map(normalizeParam);
      const res = stmt.run(...(safe as any[]));
      return { changes: Number(res.changes ?? 0) };
    },
    async exec(sql: string) {
      connection.exec(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      connection.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(make(connection));
        connection.exec('COMMIT');
        return result;
      } catch (err) {
        try { connection.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw err;
      }
    },
    async close() {
      connection.close();
    },
  });

  return make(conn);
}

/* -------------------------------------------------------------------------- */
/*                              PostgreSQL driver                              */
/* -------------------------------------------------------------------------- */

async function createPostgresDb(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 15),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'pishkan-api',
  });

  const runner = (client: any): Db => ({
    driver: 'postgres',
    async query<T>(sql: string, params: Params = []) {
      const res = await client.query(toPgPlaceholders(sql), params.map(normalizeParam));
      return res.rows as T[];
    },
    async one<T>(sql: string, params: Params = []) {
      const res = await client.query(toPgPlaceholders(sql), params.map(normalizeParam));
      return (res.rows[0] as T) ?? null;
    },
    async run(sql: string, params: Params = []) {
      const res = await client.query(toPgPlaceholders(sql), params.map(normalizeParam));
      return { changes: res.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (client.__inTx) return fn(runner(client));
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const scoped = { ...runner(c), __inTx: true } as any;
        const result = await fn(scoped);
        await c.query('COMMIT');
        return result;
      } catch (err) {
        try { await c.query('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
    },
  });

  // Validate connectivity early so misconfiguration fails at boot, not on first request.
  const probe = await pool.connect();
  probe.release();

  return runner(pool);
}

/* -------------------------------------------------------------------------- */
/*                                   facade                                    */
/* -------------------------------------------------------------------------- */

const transactionScope = new AsyncLocalStorage<Db>();
let sqliteTail: Promise<unknown> = Promise.resolve();
let instance: Db | null = null;
let instancePromise: Promise<Db> | null = null;

export async function getDb(): Promise<Db> {
  if (instance) return instance;
  if (!instancePromise) {
    instancePromise = (async () => {
      const db = env.dbDriver === 'sqlite'
        ? await createSqliteDb(env.sqliteFile)
        : await createPostgresDb(env.databaseUrl);
      instance = db;
      return db;
    })();
  }
  return instancePromise;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
    instancePromise = null;
  }
}

/** Serialise SQLite operations; transaction-local helpers share the same
 * connection on both PostgreSQL and SQLite (including nested domain calls). */
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
 const scoped = transactionScope.getStore();
 if (scoped) return fn(scoped);
 const db = await getDb();
 if (db.driver !== 'sqlite') return fn(db);
 const result = sqliteTail.then(() => fn(db));
 sqliteTail = result.catch(() => undefined);
 return result;
}
export async function q<T = Row>(sql: string, params: Params = []): Promise<T[]> { return withDb(db => db.query<T>(sql,params)); }
export async function one<T = Row>(sql: string, params: Params = []): Promise<T|null> { return withDb(db => db.one<T>(sql,params)); }
export async function run(sql: string, params: Params = []): Promise<ExecResult> { return withDb(db => db.run(sql,params)); }
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
 const scoped = transactionScope.getStore();
 if (scoped) return fn(scoped);
 return withDb(db => db.tx(connection => transactionScope.run(connection, () => fn(connection))));
}

/* --------------------------------- helpers -------------------------------- */

export function jsonParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** ISO timestamp helper — one source of truth for "now". */
export function nowIso(): string {
  return new Date().toISOString();
}

export function addHours(hours: number, from = new Date()): string {
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}

export function addDays(days: number, from = new Date()): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

export async function sqliteSnapshot(target: string) {
  const db = await getDb();
  if (!db.snapshot) throw new Error('Snapshot requires SQLite');
  await db.snapshot(target);
}
