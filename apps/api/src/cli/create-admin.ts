import { closeDb } from '../db/index.js';
import { ensureAdmin } from '../modules/catalog/seed.js';
import { env } from '../env.js';

/**
 * Usage:
 *   BOOTSTRAP_ADMIN_USERNAME=admin BOOTSTRAP_ADMIN_PASSWORD='Strong#Pass' npm run create-admin
 * Creates the first super admin only when no admin account exists.
 */
const username = process.env.BOOTSTRAP_ADMIN_USERNAME || process.argv[2];
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.argv[3];

if (!username || !password) {
  console.error('BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD (or CLI args) are required.');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}

const id_ = await ensureAdmin(
  { username, password, fullName: process.env.BOOTSTRAP_ADMIN_NAME || 'مدیر سامانه', mobile: process.env.BOOTSTRAP_ADMIN_MOBILE },
  (m) => console.log(`[admin] ${m}`),
);
console.log(id_ ? `[admin] created ${username} (db=${env.dbDriver})` : '[admin] an admin account already exists — nothing changed.');
await closeDb();
