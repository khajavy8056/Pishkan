/**
 * Reset a staff/admin password from the server console.
 *
 *   npx tsx src/cli/reset-password.ts --username admin [--password 'New#Pass123'] [--generate] [--unlock]
 *
 * - Prints the generated password once.
 * - Revokes every existing session for that account.
 * - Never touches customer, invoice or settings data.
 */
import { closeDb, one, run, nowIso } from '../db/index.js';
import { hashPassword } from '../lib/crypto.js';
import { validatePasswordAgainstPolicy } from '../modules/auth/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { env } from '../env.js';

const args = process.argv.slice(2);
const readFlag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const username = readFlag('username') ?? process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin';
const provided = readFlag('password');
const generate = args.includes('--generate') || !provided;
const unlock = args.includes('--unlock');

function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = Array.from({ length: 20 }, () => Math.floor(Math.random() * alphabet.length));
  const core = bytes.map((b) => alphabet[b]).join('');
  return `${core.slice(0, 6)}#${core.slice(6, 14)}${core.slice(14)}9`;
}

const user = await one<any>(
  `SELECT u.id, u.username, u.full_name, u.kind, u.must_change_password
   FROM users u WHERE LOWER(u.username) = ? OR u.mobile = ? LIMIT 1`,
  [username.toLowerCase(), username],
);

if (!user) {
  console.error(`[reset] no account found for "${username}".`);
  await closeDb();
  process.exit(1);
}
if (user.kind === 'customer') {
  console.error('[reset] refusing to change a customer password here; use the admin panel instead.');
  await closeDb();
  process.exit(1);
}

const password = provided ?? generatePassword();
if (!provided) await validatePasswordAgainstPolicy(password);

await run(
  'UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
  [await hashPassword(password), nowIso(), user.id],
);
// `--unlock` is accepted for compatibility with documented commands; the reset
// above always clears the lockout counters so a locked-out admin can recover.
void unlock;
await run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), user.id]);

await writeAudit({
  actorId: 'system', actorName: 'CLI (server console)',
  action: 'user.password_reset_cli', entityType: 'user', entityId: user.id,
  after: { username: user.username, generated: generate },
});

console.log(`[reset] password updated for "${user.username ?? username}" (${user.kind}) — all sessions revoked.`);
console.log(`[reset] must change password on next login: yes`);
if (generate) {
  console.log('');
  console.log('  ⚠ One-time password (shown only now):');
  console.log(`     ${password}`);
  console.log('');
}
console.log(`[reset] db=${env.dbDriver}`);
await closeDb();
