import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // The suite normally runs on SQLite: it is fast, needs no server, and
      // covers the same SQL because every query is written for both dialects.
      //
      // But production runs on PostgreSQL, and the two differ in ways SQLite
      // hides: type coercion on aggregates, ordering of NULLs, RETURNING
      // behaviour, case sensitivity in LIKE, concurrent writes. A test that
      // only ever ran on SQLite is exactly how "it worked on my machine" ships.
      //
      // PISHKAN_TEST_DB=postgres runs the identical suite against a real
      // PostgreSQL (DATABASE_URL). CI runs both; a developer switching to
      // Postgres before a release is the cheap version of the same guarantee.
      DB_DRIVER: process.env.PISHKAN_TEST_DB === 'postgres' ? 'postgres' : 'sqlite',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      SQLITE_FILE: `/tmp/pishkan-test-${process.pid}.db`,
      APP_ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdef',
      COOKIE_SECURE: 'false',
      DEMO_MODE: 'false',
      UPLOAD_DIR: `/tmp/pishkan-test-uploads-${process.pid}`,
      BACKUP_DIR: `/tmp/pishkan-test-backups-${process.pid}`,
      LOG_LEVEL: 'error',
      RATE_LIMIT_PER_MINUTE: '100000',
      AUTH_LOGIN_RATE_LIMIT: '100000',
      AUTH_REGISTER_RATE_LIMIT: '100000',
    },
  },
});
