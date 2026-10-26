import { migrate } from '../db/migrate.js';
import { closeDb } from '../db/index.js';
import { env } from '../env.js';
import { runSeed } from '../modules/catalog/seed.js';

/**
 * `--catalog-only` seeds roles, settings and the service catalogue but never
 * demo requests/invoices. Demo data is opt-in (`--demo` or DEMO_MODE=true) and
 * is only inserted when no request exists yet.
 */
const catalogOnly = process.argv.includes('--catalog-only');
const demo = process.argv.includes('--demo') || (env.demoMode && !catalogOnly);
const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || (env.isProd ? '' : 'Admin@12345');

await migrate({ log: (m) => console.log(`[migrate] ${m}`) });
const result = await runSeed({
  withDemo: demo,
  admin: adminPassword ? {
    username: adminUsername,
    password: adminPassword,
    fullName: process.env.BOOTSTRAP_ADMIN_NAME || 'مدیر سامانه',
    mobile: process.env.BOOTSTRAP_ADMIN_MOBILE,
  } : undefined,
  log: (m) => console.log(`[seed] ${m}`),
});

console.log(`[seed] done. demo=${demo} admin=${result.adminId ? 'created' : 'exists/not requested'}`);
await closeDb();
