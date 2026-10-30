import { closeDb, one } from '../db/index.js';
import { ensureAdmin } from '../modules/catalog/seed.js';
import { env } from '../env.js';
import { validatePasswordAgainstPolicy } from '../modules/auth/service.js';

/**
 * Usage (three supported ways to pass the password — pick the least exposing one):
 *
 *   1. stdin  — recommended for installers and GUI launchers:
 *        node dist/cli/create-admin.js --username admin --stdin
 *      (the password is read from the first line of stdin; it never appears in
 *       the process list, the shell history or the environment)
 *   2. CLI flag / positional argument: visible in the process list
 *   3. BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD environment variables
 *
 * The command is idempotent: it only creates the first super admin when no admin
 * account exists yet, so it is safe to re-run after a retry or an upgrade.
 * Password rules come from the same settings the login screen uses
 * (auth.password_min_length / auth.password_require_mixed), so the installer can
 * never create an admin that the API would later refuse.
 */

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0].trim();
}

const useStdin = process.argv.includes('--stdin');
const username = readFlag('username') || process.env.BOOTSTRAP_ADMIN_USERNAME || process.argv[2];
const password = useStdin
  ? await readStdin()
  : (readFlag('password') || process.env.BOOTSTRAP_ADMIN_PASSWORD || process.argv[3] || '');
const fullName = readFlag('full-name') || process.env.BOOTSTRAP_ADMIN_NAME || 'مدیر سامانه';
const mobile = readFlag('mobile') || process.env.BOOTSTRAP_ADMIN_MOBILE;

if (!username || !password) {
  console.error('an admin username and password are required (--username/--stdin, CLI args, or BOOTSTRAP_ADMIN_*).');
  process.exit(1);
}
if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) {
  console.error('username must be 3-60 characters: letters, digits, dot, underscore or dash.');
  process.exit(1);
}

try {
  await validatePasswordAgainstPolicy(password);
} catch (error) {
  console.error((error as Error)?.message ?? String(error));
  process.exit(1);
}

const existing = await one<{ id: string }>('SELECT id FROM users WHERE kind = ?', ['admin']);
if (existing) {
  console.log('[admin] an admin account already exists — nothing changed.');
  await closeDb();
  process.exit(0);
}

const id_ = await ensureAdmin(
  { username, password, fullName, mobile },
  (m) => console.log(`[admin] ${m}`),
);
console.log(id_ ? `[admin] created ${username} (db=${env.dbDriver})` : '[admin] an admin account already exists — nothing changed.');
await closeDb();
process.exit(0);
