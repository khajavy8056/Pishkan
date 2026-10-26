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
      DB_DRIVER: 'sqlite',
      SQLITE_FILE: `/tmp/pishkan-test-${process.pid}.db`,
      APP_ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdef',
      COOKIE_SECURE: 'false',
      DEMO_MODE: 'false',
      UPLOAD_DIR: `/tmp/pishkan-test-uploads-${process.pid}`,
      BACKUP_DIR: `/tmp/pishkan-test-backups-${process.pid}`,
      LOG_LEVEL: 'error',
      RATE_LIMIT_PER_MINUTE: '100000',
    },
  },
});
