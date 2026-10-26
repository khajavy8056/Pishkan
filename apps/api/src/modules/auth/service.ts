import { one, q, run, nowIso, addHours } from '../../db/index.js';
import {
  encryptSecret, decryptSecret, hashPassword, id, numericCode, randomToken,
  sha256, verifyPassword,
} from '../../lib/crypto.js';
import { expandPermissions, hasPermission } from '../../lib/permissions.js';
import { getBool, getNumber, getString, getJson } from '../settings/service.js';
import { sendOtpSms, isValidMobile, maskMobile, normalizeMobile } from '../sms/provider.js';
import { badRequest, conflict, forbidden, tooMany, unauthorized } from '../../http/errors.js';
import { writeAudit } from '../audit/service.js';
import type { AuthContext, AuthUser } from './types.js';
import { env } from '../../env.js';
import { verifyTotp } from './totp.js';

/* -------------------------------------------------------------------------- */
/*                                   types                                    */
/* -------------------------------------------------------------------------- */

export interface UserRow {
  id: string;
  kind: 'customer' | 'staff' | 'admin';
  role_id: string | null;
  mobile: string | null;
  mobile_verified: number;
  email: string | null;
  username: string | null;
  password_hash: string | null;
  full_name: string;
  national_id: string | null;
  status: string;
  avatar_file_id: string | null;
  mfa_secret: string | null;
  mfa_enabled: number;
  must_change_password: number;
  last_login_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientInfo { ip?: string; userAgent?: string }

/* -------------------------------------------------------------------------- */
/*                                 user helpers                               */
/* -------------------------------------------------------------------------- */

export async function findUserById(userId: string): Promise<UserRow | null> {
  return one<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
}

export async function findUserByMobile(mobile: string, kind: 'customer' | 'staff' | 'admin' = 'customer'): Promise<UserRow | null> {
  return one<UserRow>('SELECT * FROM users WHERE kind = ? AND mobile = ?', [kind, normalizeMobile(mobile)]);
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const value = String(username ?? '').trim().toLowerCase();
  if (!value) return null;
  return one<UserRow>('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?', [value, value]);
}

async function roleOf(user: UserRow): Promise<{ code: string; name: string; permissions: string[] | '*' } | null> {
  if (!user.role_id) return null;
  const role = await one<{ code: string; name: string; permissions: string }>(
    'SELECT code, name, permissions FROM roles WHERE id = ?', [user.role_id],
  );
  if (!role) return null;
  let perms: string[] | '*' = [];
  try {
    const parsed = JSON.parse(role.permissions || '[]');
    perms = parsed === '*' ? '*' : expandPermissions(Array.isArray(parsed) ? parsed : []);
  } catch {
    perms = [];
  }
  return { code: role.code, name: role.name, permissions: perms };
}

export async function authContextFor(user: UserRow, sessionId: string): Promise<AuthContext> {
  const role = await roleOf(user);
  const permissions = user.kind === 'customer' ? [] : role?.permissions ?? [];
  return {
    sessionId,
    permissions,
    user: {
      id: user.id,
      kind: user.kind,
      roleCode: role?.code ?? null,
      roleName: role?.name ?? null,
      fullName: user.full_name,
      mobile: user.mobile,
      email: user.email,
      username: user.username,
    },
  };
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    kind: user.kind,
    fullName: user.full_name,
    mobile: user.mobile,
    mobileVerified: Boolean(user.mobile_verified),
    email: user.email,
    username: user.username,
    nationalId: user.national_id,
    status: user.status,
    mfaEnabled: Boolean(user.mfa_enabled),
    mustChangePassword: Boolean(user.must_change_password),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  sessions                                  */
/* -------------------------------------------------------------------------- */

async function sessionTtlHours(): Promise<number> {
  return (await getNumber('auth.session_ttl_hours')) || env.sessionTtlHours;
}

export async function createSession(userId: string, client: ClientInfo): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  const token = randomToken(32);
  const sessionId = id('ses');
  const expiresAt = addHours(await sessionTtlHours());

  // enforce maximum concurrent sessions
  const maxSessions = await getNumber('security.max_sessions_per_user');
  const active = await q<{ id: string }>(
    'SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at ASC',
    [userId, nowIso()],
  );
  if (active.length >= maxSessions) {
    const drop = active.slice(0, active.length - maxSessions + 1).map((s) => s.id);
    for (const sid of drop) {
      await run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), sid]);
    }
  }

  await run(
    `INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, userId, sha256(token), client.ip ?? null, (client.userAgent ?? '').slice(0, 400), nowIso(), expiresAt, nowIso()],
  );
  await run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), userId]);
  return { token, sessionId, expiresAt };
}

export async function resolveSession(token: string, client: ClientInfo = {}): Promise<AuthContext | null> {
  if (!token) return null;
  const session = await one<{ id: string; user_id: string; expires_at: string; revoked_at: string | null; ip: string | null }>(
    'SELECT * FROM sessions WHERE token_hash = ?', [sha256(token)],
  );
  if (!session || session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const user = await findUserById(session.user_id);
  if (!user || user.status === 'suspended') return null;

  if (await getBool('security.bind_session_to_ip')) {
    if (session.ip && client.ip && session.ip !== client.ip) return null;
  }

  // cheap last-seen update (throttled to 5 minutes)
  const seen = await one<{ last_seen_at: string | null }>('SELECT last_seen_at FROM sessions WHERE id = ?', [session.id]);
  if (!seen?.last_seen_at || Date.now() - new Date(seen.last_seen_at).getTime() > 300_000) {
    await run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [nowIso(), session.id]);
  }

  return authContextFor(user, session.id);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), sessionId]);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const res = exceptSessionId
    ? await run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', [nowIso(), userId, exceptSessionId])
    : await run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), userId]);
  return res.changes;
}

export async function activeSessions(userId: string) {
  const rows = await q(
    `SELECT id, ip, user_agent, created_at, expires_at, last_seen_at
     FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_seen_at DESC`,
    [userId, nowIso()],
  );
  return rows.map((r) => ({
    id: r.id, ip: r.ip, userAgent: r.user_agent, createdAt: r.created_at,
    expiresAt: r.expires_at, lastSeenAt: r.last_seen_at,
  }));
}

/* -------------------------------------------------------------------------- */
/*                                   login                                    */
/* -------------------------------------------------------------------------- */

async function logLogin(input: { userId?: string | null; identifier: string; method: string; success: boolean; reason?: string; client: ClientInfo }) {
  await run(
    `INSERT INTO login_events (id, user_id, identifier, method, success, reason, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id('lg'), input.userId ?? null, String(input.identifier).slice(0, 100), input.method,
      input.success ? 1 : 0, input.reason ?? null, input.client.ip ?? null,
      (input.client.userAgent ?? '').slice(0, 400), nowIso(),
    ],
  );
}

async function registerFailure(user: UserRow | null) {
  if (!user) return;
  const attempts = Number(user.failed_attempts) + 1;
  const max = await getNumber('auth.max_login_attempts');
  const lockMinutes = await getNumber('auth.lockout_minutes');
  const lockedUntil = attempts >= max ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null;
  await run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [lockedUntil ? 0 : attempts, lockedUntil, user.id]);
}

function assertNotLocked(user: UserRow) {
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const minutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    throw tooMany(`حساب شما به دلیل تلاش‌های ناموفق تا ${minutes} دقیقه آینده قفل است.`);
  }
}

function assertActive(user: UserRow) {
  if (user.status === 'suspended') throw forbidden('حساب کاربری شما غیرفعال شده است. با دفتر تماس بگیرید.');
  if (user.status === 'pending') throw forbidden('حساب شما در انتظار تأیید توسط دفتر است.');
}

/* --------------------------------- OTP ------------------------------------ */

export async function requestOtp(mobileRaw: string, purpose: 'login' | 'register' | 'reset' | 'verify', client: ClientInfo, requestedKind?: 'customer' | 'staff') {
  const mobile = normalizeMobile(mobileRaw);
  if (!isValidMobile(mobile)) throw badRequest('شماره موبایل را به شکل ۰۹۱۲۳۴۵۶۷۸۹ وارد کنید.');

  const staffAccount = await one<UserRow>("SELECT * FROM users WHERE mobile=? AND kind IN ('staff','admin')", [mobile]);
  const customerAccount = await findUserByMobile(mobile, 'customer');
  const kind = requestedKind ?? (staffAccount && !customerAccount && purpose === 'login' ? 'staff' : 'customer');
  if (kind === 'staff' && (!staffAccount || (purpose !== 'verify' && !staffAccount.mobile_verified))) throw forbidden('ورود پیامکی کارکنان نیازمند حساب و شماره تأییدشده است.');
  const otpEnabled = await getBool(kind === 'staff' ? 'auth.staff_otp_enabled' : 'auth.customer_otp_enabled');
  if (!otpEnabled && purpose !== 'verify' && purpose !== 'reset') throw forbidden('ورود با رمز یک‌بارمصرف در حال حاضر فعال نیست.');

  const registrationOpen = await getBool('auth.customer_registration_open');
  const autoRegister = await getBool('auth.customer_auto_register_otp');
  const existing = await findUserByMobile(mobile, 'customer');
  if (purpose === 'reset' && !existing) throw badRequest('حسابی برای بازیابی یافت نشد.');
  if (kind === 'customer' && !existing && purpose !== 'reset' && !(registrationOpen && autoRegister)) {
    throw forbidden('حسابی با این شماره یافت نشد. برای ایجاد حساب با دفتر تماس بگیرید.');
  }

  const resendSeconds = await getNumber('auth.otp_resend_seconds');
  const recent = await one<{ created_at: string }>(
    'SELECT created_at FROM otp_codes WHERE mobile = ? AND purpose = ? AND account_kind = ? ORDER BY created_at DESC LIMIT 1',
    [mobile, purpose, kind],
  );
  if (recent) {
    const elapsed = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsed < resendSeconds) {
      throw tooMany(`برای ارسال مجدد کد، ${Math.ceil(resendSeconds - elapsed)} ثانیه دیگر صبر کنید.`);
    }
  }

  const dailyLimit = await getNumber('auth.otp_daily_limit');
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayCount = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM otp_codes WHERE mobile = ? AND created_at >= ?',
    [mobile, dayStart.toISOString()],
  );
  if (Number(todayCount?.c ?? 0) >= dailyLimit) {
    throw tooMany('تعداد درخواست کد برای این شماره امروز به سقف رسیده است. فردا تلاش کنید.');
  }

  const digits = await getNumber('auth.otp_code_length');
  const code = numericCode(Math.min(8, Math.max(4, digits)));
  const ttl = await getNumber('auth.otp_ttl_seconds');
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const maxAttempts = await getNumber('auth.otp_max_attempts');

  // invalidate previous codes for the same purpose
  await run('UPDATE otp_codes SET consumed_at = ? WHERE mobile = ? AND purpose = ? AND account_kind = ? AND consumed_at IS NULL', [nowIso(), mobile, purpose, kind]);
  await run(
    `INSERT INTO otp_codes (id, mobile, code_hash, purpose, attempts, max_attempts, expires_at, ip, created_at, account_kind)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [id('otp'), mobile, sha256(`${mobile}:${code}`), purpose, maxAttempts, expiresAt, client.ip ?? null, nowIso(), kind],
  );

  const result = await sendOtpSms(mobile, code, purpose);
  await logLogin({ identifier: mobile, method: 'otp-request', success: result.ok, reason: result.error, client });

  // The code is only echoed when no real transport is configured (local dev and
  // the console/simulator provider). A live SMS provider never leaks it.
  const smsEnabled = await getBool('sms.enabled');
  const providerName = await getString('sms.provider');
  const debugCode = (!smsEnabled || providerName === 'console') && !env.isProd ? code : undefined;

  return {
    sent: result.ok,
    smsEnabled,
    expiresIn: ttl,
    resendIn: resendSeconds,
    maskedMobile: maskMobile(mobile),
    error: result.ok ? undefined : result.error,
    debugCode,
  };
}

export async function verifyOtpAndLogin(
  mobileRaw: string,
  codeRaw: string,
  client: ClientInfo,
  options: { purpose?: 'login' | 'register' | 'reset' | 'verify'; kind?: 'customer' | 'staff'; staffKinds?: ('staff' | 'admin')[] } = {},
): Promise<{ context: AuthContext; token: string; expiresAt: string; isNewUser: boolean; mfaRequired?:boolean;mfaToken?:string;mfaMode?:'totp' }> {
  const mobile = normalizeMobile(mobileRaw);
  const purpose = options.purpose ?? 'login';
  if (!isValidMobile(mobile)) throw badRequest('شماره موبایل معتبر نیست.');
  const code = normalizeOtp(codeRaw);
  if (!/^\d{4,8}$/.test(code)) throw badRequest('کد ارسال‌شده معتبر نیست.');

  const staffAccount = await one<UserRow>("SELECT * FROM users WHERE mobile=? AND kind IN ('staff','admin')", [mobile]);
  const customerAccount = await findUserByMobile(mobile, 'customer');
  const kind = options.kind ?? (staffAccount && !customerAccount && purpose === 'login' ? 'staff' : 'customer');
  if (purpose !== 'verify' && !(await getBool(kind === 'staff' ? 'auth.staff_otp_enabled' : 'auth.customer_otp_enabled'))) throw forbidden('ورود با رمز یک‌بارمصرف غیرفعال است.');

  const record = await one<{
    id: string; attempts: number; max_attempts: number; expires_at: string; consumed_at: string | null;
  }>(
    'SELECT id, attempts, max_attempts, expires_at, consumed_at FROM otp_codes WHERE mobile = ? AND purpose = ? AND account_kind = ? ORDER BY created_at DESC LIMIT 1',
    [mobile, purpose, kind],
  );
  if (!record) throw badRequest('کدی برای این شماره ثبت نشده است. ابتدا درخواست کد بدهید.');
  if (record.consumed_at) throw badRequest('این کد قبلاً استفاده شده است. کد جدید درخواست کنید.');
  if (new Date(record.expires_at).getTime() < Date.now()) throw badRequest('کد ارسال‌شده منقضی شده است. کد جدید درخواست کنید.');
  if (Number(record.attempts) >= Number(record.max_attempts)) throw tooMany('تعداد تلاش‌های این کد به پایان رسیده است. کد جدید درخواست کنید.');

  if (sha256(`${mobile}:${code}`) !== (await one<{ code_hash: string }>('SELECT code_hash FROM otp_codes WHERE id = ?', [record.id]))?.code_hash) {
    await run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [record.id]);
    await logLogin({ identifier: mobile, method: 'otp-verify', success: false, reason: 'wrong_code', client });
    throw badRequest('کد واردشده صحیح نیست.');
  }

  const consumed = await run('UPDATE otp_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND attempts < max_attempts', [nowIso(), record.id]);
  if (!consumed.changes) throw conflict('کد قبلاً مصرف شده است.');

  let user = kind === 'staff' ? staffAccount : customerAccount;
  let isNewUser = false;

  if (kind === 'staff' && (!user || (purpose !== 'verify' && !user.mobile_verified))) throw forbidden('شماره کارکنان تأیید نشده است.');
  if (!user) {
    // Staff/admin accounts may also use OTP if they are the named account.
    const staff = options.staffKinds?.length
      ? await one<UserRow>('SELECT * FROM users WHERE mobile = ? AND kind IN (?, ?)', [mobile, 'staff', 'admin'])
      : null;
    if (staff) {
      user = staff;
    } else {
      const registrationOpen = await getBool('auth.customer_registration_open');
      const autoRegister = await getBool('auth.customer_auto_register_otp');
      if (!registrationOpen || !autoRegister) {
        throw forbidden('حسابی با این شماره یافت نشد.');
      }
      const requireApproval = await getBool('auth.customer_require_approval');
      const ts = nowIso();
      const userId = id('usr');
      await run(
        `INSERT INTO users (id, kind, mobile, mobile_verified, full_name, status, created_at, updated_at)
         VALUES (?, 'customer', ?, 1, ?, ?, ?, ?)`,
        [userId, mobile, '', requireApproval ? 'pending' : 'active', ts, ts],
      );
      await run('INSERT INTO customer_profiles (user_id, extra, created_at, updated_at) VALUES (?, ?, ?, ?)', [userId, '{}', ts, ts]);
      user = await findUserById(userId);
      isNewUser = true;
      await writeAudit({ actorId: userId, actorName: mobile, action: 'customer.self_register', entityType: 'user', entityId: userId, ip: client.ip });
    }
  } else {
    await run('UPDATE users SET mobile_verified = 1 WHERE id = ?', [user.id]);
  }

  if (!user) throw unauthorized('ورود ناموفق بود.');
  assertNotLocked(user);
  assertActive(user);

  if(user.kind!=='customer' && purpose==='login' && (user.mfa_enabled || await getBool('auth.staff_mfa_required') || (await getBool('security.require_mfa_finance') && ['super_admin','manager','accountant'].includes((await one<any>('SELECT code FROM roles WHERE id=?',[user.role_id]))?.code)))){
    if(!user.mfa_secret)throw forbidden('ثبت‌نام تأیید دومرحله‌ای لازم است.');
    return {context:null as any,token:'',expiresAt:'',isNewUser:false,mfaRequired:true,mfaToken:mfaTicket(user.id),mfaMode:'totp'};
  }
  await run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
  const session = await createSession(user.id, client);
  await logLogin({ userId: user.id, identifier: mobile, method: 'otp', success: true, client });
  const fresh = await findUserById(user.id);
  return { context: await authContextFor(fresh!, session.sessionId), token: session.token, expiresAt: session.expiresAt, isNewUser };
}

function normalizeOtp(value: string): string {
  return String(value ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');
}

/* ------------------------------ password login ----------------------------- */

export async function passwordLogin(
  identifier: string,
  password: string,
  client: ClientInfo,
): Promise<{ context: AuthContext; token: string; expiresAt: string; mfaRequired?: boolean; mfaToken?: string; mfaMode?: 'totp' | 'otp' }> {
  const ident = String(identifier ?? '').trim();
  if (!ident || !password) throw badRequest('نام کاربری و رمز عبور الزامی است.');

  const byMobile = isValidMobile(ident) ? await one<UserRow>('SELECT * FROM users WHERE mobile = ? ORDER BY kind ASC', [normalizeMobile(ident)]) : null;
  const user = byMobile ?? (await findUserByUsername(ident));
  if (!user) {
    await logLogin({ identifier: ident, method: 'password', success: false, reason: 'unknown_user', client });
    throw unauthorized('نام کاربری یا رمز عبور صحیح نیست.');
  }

  if (user.kind === 'customer' && !(await getBool('auth.customer_password_enabled'))) {
    throw forbidden('ورود با رمز عبور برای مشتریان فعال نیست. از ورود با کد یک‌بارمصرف استفاده کنید.');
  }
  const recoveryRole=user.role_id?await one<any>('SELECT code FROM roles WHERE id=?',[user.role_id]):null;
  if (user.kind !== 'customer' && recoveryRole?.code!=='super_admin' && !(await getBool('auth.staff_password_login'))) {
    throw forbidden('ورود کارکنان با رمز عبور غیرفعال شده است. با مدیر سامانه تماس بگیرید.');
  }

  assertNotLocked(user);
  assertActive(user);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await registerFailure(user);
    await logLogin({ userId: user.id, identifier: ident, method: 'password', success: false, reason: 'bad_password', client });
    await writeAudit({ actorId: user.id, actorName: user.full_name, action: 'auth.failed_login', entityType: 'user', entityId: user.id, ip: client.ip });
    throw unauthorized('نام کاربری یا رمز عبور صحیح نیست.');
  }

  // MFA for staff/admin when enabled by policy or per-account.
  const policyMfa = user.kind !== 'customer' && ((await getBool('auth.staff_mfa_required')) || (await getBool('security.require_mfa_finance') && ['super_admin','manager','accountant'].includes(recoveryRole?.code)));
  if ((user.mfa_enabled || policyMfa) && user.kind !== 'customer') {
    if (!user.mfa_secret) {
      throw forbidden('پیش از الزام MFA باید حساب‌ها ثبت‌نام دومرحله‌ای را تکمیل کنند. با مدیر کل تماس بگیرید.');
    } else {
      return { context: null as any, token: '', expiresAt: '', mfaRequired: true, mfaToken: mfaTicket(user.id), mfaMode: 'totp' };
    }
  }

  if (user.kind === 'customer' && (await getBool('auth.customer_combined_required')) && (await getBool('auth.customer_otp_enabled'))) {
    // combined mode: password verified, a fresh OTP is required next
    await requestOtp(user.mobile ?? '', 'login', client);
    return { context: null as any, token: '', expiresAt: '', mfaRequired: true, mfaToken: mfaTicket(user.id), mfaMode: 'otp' };
  }

  await run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
  const session = await createSession(user.id, client);
  await logLogin({ userId: user.id, identifier: ident, method: 'password', success: true, client });
  return { context: await authContextFor(user, session.sessionId), token: session.token, expiresAt: session.expiresAt };
}

/* ------------------------------- MFA tickets ------------------------------- */

const ticketStore = new Map<string, { userId: string; expiresAt: number }>();

function mfaTicket(userId: string): string {
  const ticket = randomToken(24);
  ticketStore.set(ticket, { userId, expiresAt: Date.now() + 5 * 60_000 });
  // opportunistic cleanup
  if (ticketStore.size > 1000) {
    for (const [k, v] of ticketStore) if (v.expiresAt < Date.now()) ticketStore.delete(k);
  }
  return ticket;
}

export async function completeMfaLogin(
  ticket: string,
  code: string,
  client: ClientInfo,
  mode: 'totp' | 'otp' = 'totp',
): Promise<{ context: AuthContext; token: string; expiresAt: string }> {
  const entry = ticketStore.get(String(ticket ?? ''));
  if (!entry || entry.expiresAt < Date.now()) throw unauthorized('زمان تأیید دومرحله‌ای به پایان رسیده است. دوباره وارد شوید.');
  ticketStore.delete(ticket); // consume before the first await: no parallel replay
  const user = await findUserById(entry.userId);
  if (!user) throw unauthorized();
  assertNotLocked(user);

  assertActive(user);
  if (mode !== (user.kind === 'customer' ? 'otp' : 'totp')) throw forbidden('روش تأیید با حساب سازگار نیست.');
  if (mode === 'totp') {
    const secret = decryptSecret(user.mfa_secret);
    if (!secret || !verifyTotp(secret, code)) {
      await registerFailure(user);
      await logLogin({ userId: user.id, identifier: user.username ?? '', method: 'mfa', success: false, reason: 'bad_totp', client });
      throw unauthorized('کد تأیید دومرحله‌ای صحیح نیست.');
    }
  } else {
    const result = await verifyOtpAndLogin(user.mobile ?? '', code, client, { purpose: 'login' });
    ticketStore.delete(ticket);
    return { context: result.context, token: result.token, expiresAt: result.expiresAt };
  }

  ticketStore.delete(ticket);
  const session = await createSession(user.id, client);
  await logLogin({ userId: user.id, identifier: user.username ?? '', method: 'mfa', success: true, client });
  return { context: await authContextFor(user, session.sessionId), token: session.token, expiresAt: session.expiresAt };
}

/* ------------------------------ registration ------------------------------- */

export interface RegisterInput {
  mobile?: string;
  username?: string;
  password: string;
  fullName: string;
  email?: string;
  nationalId?: string;
}

export async function registerCustomer(input: RegisterInput, client: ClientInfo) {
  const registrationOpen = await getBool('auth.customer_registration_open');
  if (!registrationOpen) throw forbidden('ثبت‌نام عمومی در حال حاضر غیرفعال است.');
  if (!(await getBool('auth.customer_password_enabled'))) {
    throw forbidden('ثبت‌نام با رمز عبور فعال نیست. با شماره موبایل وارد شوید.');
  }
  const mobile = normalizeMobile(input.mobile ?? '');
  if (!isValidMobile(mobile)) throw badRequest('شماره موبایل معتبر نیست.');
  const fullName = String(input.fullName ?? '').trim();
  if (fullName.length < 3) throw badRequest('نام و نام خانوادگی را کامل وارد کنید.');

  validatePasswordPolicy(input.password);
  const existing = await findUserByMobile(mobile, 'customer');
  if (existing) throw conflict('حسابی با این شماره موبایل قبلاً ثبت شده است.');

  const username = input.username?.trim().toLowerCase() || null;
  if (username && !/^[a-z][a-z0-9._-]{2,59}$/.test(username)) throw badRequest('نام کاربری باید ۳ تا ۶۰ حرف لاتین، رقم یا نقطه باشد.');
  if (username && await findUserByUsername(username)) throw conflict('نام کاربری قبلاً استفاده شده است.');
  const requireApproval = await getBool('auth.customer_require_approval');
  const requireVerification = await getBool('auth.customer_require_mobile_verification');
  const ts = nowIso();
  const userId = id('usr');
  await run(
    `INSERT INTO users (id, kind, mobile, mobile_verified, email, password_hash, full_name, national_id, status, created_at, updated_at, username)
     VALUES (?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, mobile, 0, input.email ?? null, await hashPassword(input.password),
      fullName, input.nationalId ?? null, requireApproval ? 'pending' : 'active', ts, ts, username,
    ],
  );
  await run('INSERT INTO customer_profiles (user_id, extra, created_at, updated_at) VALUES (?, ?, ?, ?)', [userId, '{}', ts, ts]);
  await writeAudit({ actorId: userId, actorName: fullName, action: 'customer.register', entityType: 'user', entityId: userId, ip: client.ip });

  if (requireVerification && (await getBool('auth.customer_otp_enabled'))) {
    await requestOtp(mobile, 'register', client);
    return { userId, requiresVerification: true, requiresApproval: requireApproval };
  }
  const user = await findUserById(userId);
  const session = await createSession(userId, client);
  return {
    userId,
    requiresVerification: false,
    requiresApproval: requireApproval,
    context: await authContextFor(user!, session.sessionId),
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

export function validatePasswordPolicy(password: string): void {
  // synchronous fast checks; length/character policy read separately by callers when needed
  if (!password || password.length < 8) throw badRequest('رمز عبور باید حداقل ۸ کاراکتر باشد.');
  if (password.length > 200) throw badRequest('رمز عبور بیش از حد طولانی است.');
}

export async function validatePasswordAgainstPolicy(password: string): Promise<void> {
  const min = await getNumber('auth.password_min_length');
  if (password.length < min) throw badRequest(`رمز عبور باید حداقل ${min} کاراکتر باشد.`);
  if (await getBool('auth.password_require_mixed')) {
    if (!/[A-Za-z\u0600-\u06FF]/.test(password) || !/\d/.test(password)) {
      throw badRequest('رمز عبور باید ترکیبی از حرف و رقم باشد.');
    }
  }
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, client: ClientInfo) {
  const user = await findUserById(userId);
  if (!user) throw unauthorized();
  if (user.password_hash) {
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) throw badRequest('رمز عبور فعلی صحیح نیست.');
  }
  await validatePasswordAgainstPolicy(newPassword);
  await run(
    'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
    [await hashPassword(newPassword), nowIso(), userId],
  );
  await revokeAllSessions(userId);
  await writeAudit({ actorId: userId, actorName: user.full_name, action: 'auth.password_changed', entityType: 'user', entityId: userId, ip: client.ip });
}

export async function resetPasswordWithOtp(mobileRaw: string, code: string, newPassword: string, client: ClientInfo) {
  if (!(await getBool('auth.allow_customer_password_reset'))) throw forbidden('بازیابی رمز عبور فعال نیست.');
  const result = await verifyOtpAndLogin(mobileRaw, code, client, { purpose: 'reset' });
  await validatePasswordAgainstPolicy(newPassword);
  await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [await hashPassword(newPassword), nowIso(), result.context.user.id]);
  await revokeAllSessions(result.context.user.id);
  const session = await createSession(result.context.user.id, client);
  return { ...result, token: session.token, expiresAt: session.expiresAt, context: await authContextFor((await findUserById(result.context.user.id))!, session.sessionId) };
}

/* --------------------------------- helpers -------------------------------- */

export async function permissionsOf(user: UserRow): Promise<string[] | '*'> {
  if (user.kind === 'customer') return [];
  const role = await roleOf(user);
  return role?.permissions ?? [];
}

export async function ensureRoleAssignment(userId: string, roleCode: string) {
  const role = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', [roleCode]);
  if (!role) throw badRequest('نقش انتخابی وجود ندارد.');
  await run('UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?', [role.id, nowIso(), userId]);
}

export { hasPermission };
export { getJson };
