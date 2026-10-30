import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Locate the .env file. In production the docker/systemd unit sets
 * PISHKAN_ENV_FILE, during local development we fall back to the repo root.
 */
/** Search the working directory and its parents for the first .env file. */
function findEnvFile(): string | null {
  if (process.env.PISHKAN_ENV_FILE) return process.env.PISHKAN_ENV_FILE;
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envFile = findEnvFile();
if (envFile) loadDotenv({ path: envFile });

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const nodeEnv = str('NODE_ENV', 'development');

export type DbDriver = 'postgres' | 'sqlite';
export function parseDbDriver(value: string, runtime: string): DbDriver {
  if (value !== 'postgres' && value !== 'sqlite') {
    throw new Error(`Invalid DB_DRIVER=${JSON.stringify(value)}. Supported values are "postgres" and "sqlite".`);
  }
  if (runtime === 'production' && value !== 'postgres') {
    throw new Error('DB_DRIVER=sqlite is restricted to development and tests; production requires PostgreSQL.');
  }
  return value;
}

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: num('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  /** postgres | sqlite — sqlite is used for local development and CI only. */
  dbDriver: parseDbDriver(str('DB_DRIVER', 'postgres'), nodeEnv),
  databaseUrl: str('DATABASE_URL', ''),
  sqliteFile: str('SQLITE_FILE', path.resolve(process.cwd(), '.data/pishkan.db')),
  appUrl: str('APP_URL', 'http://localhost:5173'),
  apiUrl: str('API_URL', 'http://localhost:3000'),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173,http://localhost:4173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: str('TRUST_PROXY', 'true') === 'true',
  cookieSecure: str('COOKIE_SECURE', nodeEnv === 'production' ? 'true' : 'false') === 'true',
  sessionCookie: str('SESSION_COOKIE', 'pishkan_session'),
  sessionTtlHours: num('SESSION_TTL_HOURS', 24 * 7),
  uploadDir: str('UPLOAD_DIR', path.resolve(process.cwd(), '.data/uploads')),
  backupDir: str('BACKUP_DIR', path.resolve(process.cwd(), '.data/backups')),
  /** 32+ char secret used to encrypt integration credentials at rest. */
  encryptionKey: str('APP_ENCRYPTION_KEY', ''),
  /** Bootstrap admin created by the installer. */
  bootstrapAdmin: {
    username: str('BOOTSTRAP_ADMIN_USERNAME', ''),
    password: str('BOOTSTRAP_ADMIN_PASSWORD', ''),
    fullName: str('BOOTSTRAP_ADMIN_NAME', 'مدیر سامانه'),
    mobile: str('BOOTSTRAP_ADMIN_MOBILE', ''),
  },
  logLevel: str('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),
  demoMode: str('DEMO_MODE', 'false') === 'true',
  version: str('APP_VERSION', '1.2.0'),
} as const;

/** Fail fast on obviously unsafe production configuration. */
export function assertProductionSafety(): string[] {
  const problems: string[] = [];
  if (!env.isProd) return problems;
  if (!env.encryptionKey || env.encryptionKey.length < 32) {
    problems.push('APP_ENCRYPTION_KEY must be set to at least 32 characters in production.');
  }
  if (env.dbDriver === 'postgres' && !env.databaseUrl) {
    problems.push('DATABASE_URL is required when DB_DRIVER=postgres.');
  }
  if (!env.cookieSecure) {
    problems.push('COOKIE_SECURE should be true in production (HTTPS is mandatory).');
  }
  return problems;
}
