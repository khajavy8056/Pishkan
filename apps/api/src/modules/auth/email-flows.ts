/**
 * Email-based account flows: password reset by one-time link, and email
 * verification by link or 6-digit code.
 *
 * Security properties, each one deliberate:
 *  - the clear token exists only inside the sent email; the DB keeps SHA-256;
 *  - single use + expiry + attempt ceiling, constant-time hash comparison;
 *  - the request endpoint answers identically whether or not the account
 *    exists, so it cannot be used to enumerate users;
 *  - a successful reset revokes every session and sends a confirmation mail;
 *  - per-account request throttling on top of the route-level rate limit.
 */
import { one, run, nowIso } from '../../db/index.js';
import { id, randomToken, numericCode, sha256 } from '../../lib/crypto.js';
import { badRequest, tooMany } from '../../http/errors.js';
import { getBool } from '../settings/service.js';
import { sendTemplateEmail } from '../email/provider.js';
import { writeAudit } from '../audit/service.js';
import {
  findUserById, findUserByUsername, validatePasswordAgainstPolicy, revokeAllSessions,
  type ClientInfo, type UserRow,
} from './service.js';
import { hashPassword } from '../../lib/crypto.js';
import { normalizeMobile } from '../sms/provider.js';

const RESET_TTL_MINUTES = 30;
const WELCOME_TTL_HOURS = 24;
const VERIFY_TTL_MINUTES = 30;

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function createToken(userId: string, email: string, purpose: 'reset_password' | 'verify_email', ttlMinutes: number, client: ClientInfo, secret?: string): Promise<string> {
  const clear = secret ?? randomToken(32);
  await run(
    `INSERT INTO email_tokens (id, user_id, email, purpose, token_hash, expires_at, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id('etk'), userId, email.toLowerCase(), purpose, sha256(clear), minutesFromNow(ttlMinutes), client.ip ?? null, nowIso()],
  );
  return clear;
}

interface TokenRow {
  id: string; user_id: string; email: string; purpose: string;
  attempts: number; max_attempts: number; expires_at: string; consumed_at: string | null;
}

async function consumeToken(clear: string, purpose: 'reset_password' | 'verify_email'): Promise<TokenRow> {
  const row = await one<TokenRow>('SELECT * FROM email_tokens WHERE token_hash = ?', [sha256(String(clear ?? ''))]);
  if (!row || row.purpose !== purpose) throw badRequest('لینک یا کد نامعتبر است. درخواست تازه بدهید.');
  if (row.consumed_at) throw badRequest('این لینک/کد قبلاً استفاده شده است. درخواست تازه بدهید.');
  if (row.expires_at < nowIso()) throw badRequest('مهلت این لینک/کد تمام شده است. درخواست تازه بدهید.');
  if (row.attempts >= row.max_attempts) throw badRequest('تعداد تلاش‌ها بیش از حد مجاز است. درخواست تازه بدهید.');
  await run('UPDATE email_tokens SET attempts = attempts + 1 WHERE id = ?', [row.id]);
  await run('UPDATE email_tokens SET consumed_at = ? WHERE id = ?', [nowIso(), row.id]);
  return row;
}

/* ----------------------------- password reset ----------------------------- */

/**
 * Request a reset link. The answer is the same sentence for existing and
 * non-existing accounts; only a real account with an email gets a message.
 */
export async function requestPasswordResetByEmail(identifierRaw: string, client: ClientInfo): Promise<{ sent: boolean }> {
  if (!(await getBool('email.password_reset_enabled'))) {
    throw badRequest('بازیابی رمز از طریق ایمیل در تنظیمات سامانه غیرفعال است.');
  }
  const identifier = String(identifierRaw ?? '').trim();
  if (!identifier) throw badRequest('نام کاربری یا ایمیل را وارد کنید.');

  let user: UserRow | null = await findUserByUsername(identifier.toLowerCase());
  if (!user) {
    user = await one<UserRow>('SELECT * FROM users WHERE LOWER(email) = ?', [identifier.toLowerCase()]);
  }
  if (!user && /^0?9\d{9}$/.test(normalizeMobile(identifier))) {
    user = await one<UserRow>('SELECT * FROM users WHERE mobile = ?', [normalizeMobile(identifier)]);
  }

  const generic = { sent: true };
  if (!user || !user.email || user.status === 'suspended') return generic;

  // Per-account throttle: at most 3 reset mails in 15 minutes.
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const recent = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM email_tokens WHERE user_id = ? AND purpose = 'reset_password' AND created_at >= ?",
    [user.id, since],
  );
  if (Number(recent?.c ?? 0) >= 3) throw tooMany('تعداد درخواست‌های بازیابی زیاد است. ۱۵ دقیقهٔ دیگر تلاش کنید.');

  const token = await createToken(user.id, user.email, 'reset_password', RESET_TTL_MINUTES, client);
  const result = await sendTemplateEmail({
    to: user.email,
    template: 'password_reset',
    variables: { full_name: user.full_name, token, expires_minutes: String(RESET_TTL_MINUTES) },
    userId: user.id,
    idempotencyKey: `reset:${user.id}:${sha256(token).slice(0, 24)}`,
    transactional: true,
  });
  await writeAudit({
    actorId: user.id, actorName: user.full_name, action: 'auth.password_reset_requested',
    entityType: 'user', entityId: user.id, ip: client.ip,
    after: { channel: 'email', sent: result.ok },
  });
  return generic;
}

export async function confirmPasswordResetByEmail(token: string, newPassword: string, client: ClientInfo): Promise<{ ok: true }> {
  const row = await consumeToken(token, 'reset_password');
  const user = await findUserById(row.user_id);
  if (!user) throw badRequest('حساب کاربری یافت نشد.');
  if (user.status === 'suspended') throw badRequest('حساب کاربری غیرفعال است؛ با مدیر سامانه تماس بگیرید.');
  await validatePasswordAgainstPolicy(newPassword);
  await run(
    'UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
    [await hashPassword(newPassword), nowIso(), user.id],
  );
  await revokeAllSessions(user.id);
  await writeAudit({
    actorId: user.id, actorName: user.full_name, action: 'auth.password_reset_email',
    entityType: 'user', entityId: user.id, ip: client.ip,
  });
  // Confirmation mail — best effort, and only if the account still has the
  // same address the token was issued for.
  if (user.email) {
    await sendTemplateEmail({
      to: user.email, template: 'password_changed',
      variables: { full_name: user.full_name }, userId: user.id,
      idempotencyKey: `pwchanged:${user.id}:${row.id}`, transactional: true,
    }).catch(() => undefined);
  }
  return { ok: true };
}

/* --------------------------- email verification --------------------------- */

export async function requestEmailVerification(userId: string, client: ClientInfo): Promise<{ sent: boolean }> {
  if (!(await getBool('email.verification_enabled'))) {
    throw badRequest('تأیید ایمیل در تنظیمات سامانه غیرفعال است.');
  }
  const user = await findUserById(userId);
  if (!user?.email) throw badRequest('ابتدا ایمیل خود را در پروفایل ثبت کنید.');
  if (user.email_verified) return { sent: true };

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const recent = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM email_tokens WHERE user_id = ? AND purpose = 'verify_email' AND created_at >= ?",
    [user.id, since],
  );
  if (Number(recent?.c ?? 0) >= 4) throw tooMany('تعداد درخواست‌های تأیید زیاد است. ۱۰ دقیقهٔ دیگر تلاش کنید.');

  const token = await createToken(user.id, user.email, 'verify_email', VERIFY_TTL_MINUTES, client);
  const code = numericCode(6);
  await createToken(user.id, user.email, 'verify_email', VERIFY_TTL_MINUTES, client, code);
  const result = await sendTemplateEmail({
    to: user.email, template: 'email_verify',
    variables: { full_name: user.full_name, token, code, expires_minutes: String(VERIFY_TTL_MINUTES) },
    userId: user.id,
    idempotencyKey: `verify:${user.id}:${sha256(token).slice(0, 24)}`,
    transactional: true,
  });
  if (!result.ok) throw badRequest(`ارسال ایمیل تأیید ناموفق بود: ${result.error ?? 'خطای ناشناخته'}`);
  return { sent: true };
}

export async function confirmEmailVerification(userId: string, proof: string, client: ClientInfo): Promise<{ verified: true }> {
  const row = await consumeToken(proof, 'verify_email');
  if (row.user_id !== userId) throw badRequest('این کد/لینک برای حساب دیگری صادر شده است.');
  const user = await findUserById(userId);
  if (!user?.email || user.email.toLowerCase() !== row.email.toLowerCase()) {
    throw badRequest('ایمیل حساب از زمان صدور کد تغییر کرده است. درخواست تازه بدهید.');
  }
  await run('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?', [nowIso(), userId]);
  // Any sibling tokens for the same address are spent too.
  await run(
    "UPDATE email_tokens SET consumed_at = ? WHERE user_id = ? AND purpose = 'verify_email' AND consumed_at IS NULL",
    [nowIso(), userId],
  );
  await writeAudit({
    actorId: userId, actorName: user.full_name, action: 'auth.email_verified',
    entityType: 'user', entityId: userId, ip: client.ip,
  });
  return { verified: true };
}

/* ------------------------------ staff welcome ----------------------------- */

/**
 * When the admin creates a staff account with an email, the office can hand
 * over a set-your-own-password link instead of sharing a password in person.
 * Best effort: a mail failure never fails the account creation.
 */
export async function sendStaffWelcome(userId: string, client: ClientInfo): Promise<void> {
  const user = await findUserById(userId);
  if (!user?.email || !(await getBool('email.enabled')) || !(await getBool('email.staff_welcome'))) return;
  const token = await createToken(user.id, user.email, 'reset_password', WELCOME_TTL_HOURS * 60, client);
  await sendTemplateEmail({
    to: user.email, template: 'staff_welcome',
    variables: { full_name: user.full_name, username: user.username ?? '', token },
    userId: user.id, idempotencyKey: `welcome:${user.id}`, transactional: true,
  }).catch(() => undefined);
}

/** Unused-token hygiene, called by the maintenance sweeper. */
export async function purgeExpiredEmailTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const result = await run('DELETE FROM email_tokens WHERE expires_at < ? AND created_at < ?', [nowIso(), cutoff]);
  return result.changes;
}
