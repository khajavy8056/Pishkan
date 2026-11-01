import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { asyncRoute, rateLimit, requireAuth } from '../http/middleware.js';
import { badRequest, forbidden, unauthorized } from '../http/errors.js';
import {
  activeSessions, authContextFor, changePassword, completeMfaLogin, createSession, findUserById,
  passwordLogin, permissionsOf, publicUser, registerCustomer, requestOtp, resetPasswordWithOtp,
  revokeAllSessions, revokeSession, validatePasswordAgainstPolicy, verifyOtpAndLogin,
} from '../modules/auth/service.js';
import { generateSecret, otpauthUrl, verifyTotp } from '../modules/auth/totp.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { run, nowIso, one } from '../db/index.js';
import { getBool, getString } from '../modules/settings/service.js';
import { writeAudit } from '../modules/audit/service.js';
import { param } from '../http/params.js';

import { profileState, validNationalId } from '../modules/profiles/service.js';

export const authRouter = Router();

function setSessionCookie(res: any, token: string, expiresAt: string) {
  res.cookie(env.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearSessionCookie(res: any) {
  res.clearCookie(env.sessionCookie, { path: '/', httpOnly: true, sameSite: 'lax', secure: env.cookieSecure });
}

/** Session payload shared by login responses. */
async function sessionPayload(context: any, token: string, expiresAt: string) {
  const user = await findUserById(context.user.id);
  return {
    user: {
      ...publicUser(user!),
      kind: context.user.kind,
      roleCode: context.user.roleCode,
      roleName: context.user.roleName,
      permissions: context.permissions,
    },
    expiresAt,
    token,
  };
}

/* ---------------------------------- OTP ----------------------------------- */

authRouter.post('/otp/request',
  rateLimit({ windowMs: 60_000, max: 8, message: 'تعداد درخواست کد زیاد است. یک دقیقه دیگر تلاش کنید.' }),
  asyncRoute(async (req, res) => {
    const body = z.object({
      mobile: z.string().min(10).max(20),
      kind: z.enum(['customer', 'staff']).optional(),
      purpose: z.enum(['login', 'register', 'reset']).optional(),
    }).parse(req.body);
    const result = await requestOtp(body.mobile, body.purpose ?? 'login', { ip: req.ip, userAgent: req.header('user-agent') }, body.kind);
    res.json({ ok: true, data: result });
  }));

authRouter.post('/otp/verify',
  rateLimit({ windowMs: 60_000, max: 15 }),
  asyncRoute(async (req, res) => {
    const body = z.object({
      mobile: z.string().min(10).max(20),
      code: z.string().min(4).max(8),
      kind: z.enum(['customer', 'staff']).optional(),
      purpose: z.enum(['login', 'register', 'reset']).optional(),
    }).parse(req.body);
    const result = await verifyOtpAndLogin(body.mobile, body.code, { ip: req.ip, userAgent: req.header('user-agent') }, { purpose: body.purpose ?? 'login', kind: body.kind });
    if(result.mfaRequired)return res.json({ok:true,data:{mfaRequired:true,mfaToken:result.mfaToken,mfaMode:result.mfaMode}});
    setSessionCookie(res, result.token, result.expiresAt);
    res.json({ ok: true, data: { ...(await sessionPayload(result.context, result.token, result.expiresAt)), isNewUser: result.isNewUser } });
  }));

/* ------------------------------ password login ----------------------------- */

authRouter.post('/login',
  rateLimit({ windowMs: 300_000, max: Number(process.env.AUTH_LOGIN_RATE_LIMIT ?? 15), message: 'تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.' }),
  asyncRoute(async (req, res) => {
    const body = z.object({
      identifier: z.string().min(3).max(120),
      password: z.string().min(1).max(200),
    }).parse(req.body);
    const result = await passwordLogin(body.identifier, body.password, { ip: req.ip, userAgent: req.header('user-agent') });
    if (result.mfaRequired) {
      return res.json({
        ok: true,
        data: {
          mfaRequired: true,
          mfaToken: result.mfaToken,
          mode: result.mfaMode ?? 'totp',
          message: result.mfaMode === 'otp'
            ? 'کد تأیید به شماره موبایل شما ارسال شد.'
            : 'کد ۶ رقمی برنامه Authenticator را وارد کنید.',
        },
      });
    }
    setSessionCookie(res, result.token, result.expiresAt);
    res.json({ ok: true, data: await sessionPayload(result.context, result.token, result.expiresAt) });
  }));

authRouter.post('/mfa/verify',
  rateLimit({ windowMs: 300_000, max: 20 }),
  asyncRoute(async (req, res) => {
    const body = z.object({
      ticket: z.string().min(10),
      code: z.string().min(4).max(10),
      mode: z.enum(['totp', 'otp']).default('totp'),
    }).parse(req.body);
    const result = await completeMfaLogin(body.ticket, body.code, { ip: req.ip, userAgent: req.header('user-agent') }, body.mode);
    setSessionCookie(res, result.token, result.expiresAt);
    res.json({ ok: true, data: await sessionPayload(result.context, result.token, result.expiresAt) });
  }));

/* ------------------------------- registration ------------------------------ */

authRouter.post('/register',
  rateLimit({ windowMs: 600_000, max: Number(process.env.AUTH_REGISTER_RATE_LIMIT ?? 10) }),
  asyncRoute(async (req, res) => {
    const body = z.object({
      mobile: z.string().min(10).max(20),
      password: z.string().min(8).max(200),
      fullName: z.string().min(3).max(120),
      username: z.string().min(3).max(60).optional(),
      email: z.string().email().optional().or(z.literal('')),
      nationalId: z.string().min(10).max(10).optional().or(z.literal('')),
    }).parse(req.body);
    await validatePasswordAgainstPolicy(body.password);
    const result = await registerCustomer({
      mobile: body.mobile, password: body.password, fullName: body.fullName, username: body.username,
      email: body.email || undefined, nationalId: body.nationalId || undefined,
    }, { ip: req.ip, userAgent: req.header('user-agent') });

    if (result.token) {
      setSessionCookie(res, result.token, result.expiresAt!);
      return res.status(201).json({
        ok: true,
        data: {
          requiresVerification: result.requiresVerification,
          requiresApproval: result.requiresApproval,
          ...(await sessionPayload(result.context, result.token, result.expiresAt!)),
        },
      });
    }
    res.status(201).json({ ok: true, data: { requiresVerification: result.requiresVerification, requiresApproval: result.requiresApproval } });
  }));

authRouter.post('/password/reset',
  rateLimit({ windowMs: 600_000, max: 10 }),
  asyncRoute(async (req, res) => {
    const body = z.object({
      mobile: z.string().min(10).max(20),
      code: z.string().min(4).max(8),
      newPassword: z.string().min(8).max(200),
    }).parse(req.body);
    const result = await resetPasswordWithOtp(body.mobile, body.code, body.newPassword, { ip: req.ip, userAgent: req.header('user-agent') });
    setSessionCookie(res, result.token, result.expiresAt);
    res.json({ ok: true, data: { message: 'رمز عبور با موفقیت تغییر کرد.', ...(await sessionPayload(result.context, result.token, result.expiresAt)) } });
  }));

/* --------------------------------- session -------------------------------- */

authRouter.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.user.id);
  if (!user) throw unauthorized();
  const permissions = await permissionsOf(user);
  res.json({
    ok: true,
    data: {
      ...publicUser(user),
      kind: user.kind,
      roleCode: req.auth!.user.roleCode,
      roleName: req.auth!.user.roleName,
      permissions,
      sessionId: req.auth!.sessionId,
      profileState: user.kind === 'customer' ? await profileState(user.id) : null,
    },
  });
}));

authRouter.post('/logout', asyncRoute(async (req, res) => {
  if (req.auth) await revokeSession(req.auth.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true, data: { message: 'از حساب خارج شدید.' } });
}));

authRouter.post('/logout-all', requireAuth, asyncRoute(async (req, res) => {
  const count = await revokeAllSessions(req.auth!.user.id);
  clearSessionCookie(res);
  res.json({ ok: true, data: { revoked: count } });
}));

authRouter.get('/sessions', requireAuth, asyncRoute(async (req, res) => {
  const sessions = await activeSessions(req.auth!.user.id);
  res.json({ ok: true, data: sessions });
}));

authRouter.delete('/sessions/:id', requireAuth, asyncRoute(async (req, res) => {
  const session = await one<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ?', [param(req, 'id')]);
  if (!session || session.user_id !== req.auth!.user.id) throw forbidden();
  await revokeSession(param(req, 'id'));
  res.json({ ok: true, data: { message: 'نشست بسته شد.' } });
}));

authRouter.post('/mobile/verify/request',requireAuth,asyncRoute(async(req,res)=>{
 const mobile=req.auth!.user.mobile;
 if(!mobile)throw badRequest('شماره موبایل حساب ثبت نشده است.');
 const body=z.object({confirm:z.literal(true)}).parse(req.body);
 const result=await requestOtp(mobile,'verify',{ip:req.ip,userAgent:req.header('user-agent')},req.auth!.user.kind==='customer'?'customer':'staff');
 res.json({ok:true,data:result});
}));
authRouter.post('/mobile/verify/confirm',requireAuth,asyncRoute(async(req,res)=>{
 const b=z.object({code:z.string().min(4).max(8)}).parse(req.body);
 const result=await verifyOtpAndLogin(req.auth!.user.mobile ?? '',b.code,{ip:req.ip,userAgent:req.header('user-agent')},{purpose:'verify',kind:req.auth!.user.kind==='customer'?'customer':'staff'});
 setSessionCookie(res,result.token,result.expiresAt);
 res.json({ok:true,data:{verified:true}});
}));

/* --------------------------------- profile -------------------------------- */

authRouter.patch('/profile', requireAuth, asyncRoute(async (req, res) => {
  const body = z.object({
    firstName: z.string().min(1).max(60).optional(),
    lastName: z.string().min(1).max(60).optional(),
    cityId: z.string().max(80).optional(),
    fullName: z.string().min(2).max(120).optional(),
    email: z.string().email().optional().or(z.literal('')),
    nationalId: z.string().length(10).optional().or(z.literal('')),
    address: z.string().max(500).optional(),
    postalCode: z.string().max(10).optional(),
    birthDate: z.string().max(20).optional(),
    jobTitle: z.string().max(120).optional(),
    province: z.string().max(60).optional(),
    city: z.string().max(60).optional(),
  }).parse(req.body);

  const user = await findUserById(req.auth!.user.id);
  if (!user) throw unauthorized();
  if (body.nationalId && !validNationalId(body.nationalId)) throw badRequest('کد ملی معتبر نیست. اعتبار قالب اثبات هویت نیست.');
  const city = body.cityId ? await one<any>('SELECT * FROM cities WHERE id=? AND is_active=1', [body.cityId]) : null;
  if (body.cityId && !city) throw badRequest('شهر را از فهرست انتخاب کنید.');
  if (body.firstName && body.lastName) body.fullName = `${body.firstName} ${body.lastName}`;

  await run(
    `UPDATE users SET full_name = ?, email = ?, national_id = ?, updated_at = ? WHERE id = ?`,
    [
      body.fullName ?? user.full_name,
      body.email !== undefined ? (body.email || null) : user.email,
      body.nationalId !== undefined ? (body.nationalId || null) : user.national_id,
      nowIso(), user.id,
    ],
  );

  if (user.kind === 'customer') {
    const profile = await one('SELECT user_id FROM customer_profiles WHERE user_id = ?', [user.id]);
    if (profile) {
      const current = await one<any>('SELECT * FROM customer_profiles WHERE user_id = ?', [user.id]);
      await run(
        `UPDATE customer_profiles SET address = ?, postal_code = ?, birth_date = ?, job_title = ?, province = ?, city = ?, updated_at = ?
         WHERE user_id = ?`,
        [
          body.address ?? current.address, body.postalCode ?? current.postal_code,
          body.birthDate ?? current.birth_date, body.jobTitle ?? current.job_title,
          body.province ?? current.province, body.city ?? current.city, nowIso(), user.id,
        ],
      );
    } else {
      await run(
        `INSERT INTO customer_profiles (user_id, address, postal_code, birth_date, job_title, province, city, extra, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
        [user.id, body.address ?? null, body.postalCode ?? null, body.birthDate ?? null, body.jobTitle ?? null, body.province ?? null, body.city ?? null, nowIso(), nowIso()],
      );
    }
  }

  if (user.kind === 'customer') {
    await run('UPDATE customer_profiles SET first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), city_id=COALESCE(?,city_id), city=COALESCE(?,city), province=COALESCE(?,province) WHERE user_id=?', [body.firstName ?? null, body.lastName ?? null, body.cityId ?? null, city?.name ?? null, city?.province ?? null, user.id]);
  }
  await writeAudit({ actorId: user.id, actorName: user.full_name, action: 'profile.update', entityType: 'user', entityId: user.id, ip: req.ip });
  const fresh = await findUserById(user.id);
  res.json({ ok: true, data: publicUser(fresh!) });
}));

authRouter.post('/password/change', requireAuth, asyncRoute(async (req, res) => {
  const body = z.object({
    currentPassword: z.string().max(200).optional(),
    newPassword: z.string().min(8).max(200),
  }).parse(req.body);
  await changePassword(req.auth!.user.id, body.currentPassword ?? '', body.newPassword, { ip: req.ip, userAgent: req.header('user-agent') });
  clearSessionCookie(res);
  res.json({ ok: true, data: { message: 'رمز عبور تغییر کرد. لطفاً دوباره وارد شوید.' } });
}));

/* ----------------------------------- MFA ---------------------------------- */

authRouter.get('/mfa/status', requireAuth, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.user.id);
  const policyRequired = user?.kind !== 'customer' && (await getBool('auth.staff_mfa_required'));
  res.json({ ok: true, data: { enabled: Boolean(user?.mfa_enabled), policyRequired, kind: user?.kind } });
}));

authRouter.post('/mfa/setup', requireAuth, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.user.id);
  if (!user) throw unauthorized();
  if (user.kind === 'customer') throw forbidden('ورود دومرحله‌ای برای مشتریان از طریق کد پیامک انجام می‌شود.');
  const secret = generateSecret();
  await run('UPDATE users SET mfa_secret = ?, updated_at = ? WHERE id = ?', [encryptSecret(secret), nowIso(), user.id]);
  const issuer = await getString('site.name');
  res.json({
    ok: true,
    data: {
      secret,
      otpauthUrl: otpauthUrl(secret, user.username ?? user.mobile ?? user.id, issuer),
      instructions: 'کد QR را با اپلیکیشن Authenticator اسکن کنید، سپس کد ۶ رقمی را برای فعال‌سازی وارد کنید.',
    },
  });
}));

authRouter.post('/mfa/enable', requireAuth, asyncRoute(async (req, res) => {
  const body = z.object({ code: z.string().min(6).max(6) }).parse(req.body);
  const user = await findUserById(req.auth!.user.id);
  if (!user?.mfa_secret) throw badRequest('ابتدا مرحله راه‌اندازی را انجام دهید.');
  const secret = decryptSecret(user.mfa_secret);
  if (!verifyTotp(secret, body.code)) throw badRequest('کد واردشده صحیح نیست.');
  await run('UPDATE users SET mfa_enabled = 1, updated_at = ? WHERE id = ?', [nowIso(), user.id]);
  await writeAudit({ actorId: user.id, actorName: user.full_name, action: 'auth.mfa_enabled', entityType: 'user', entityId: user.id, ip: req.ip });
  res.json({ ok: true, data: { message: 'ورود دومرحله‌ای فعال شد.' } });
}));

authRouter.post('/mfa/disable', requireAuth, asyncRoute(async (req, res) => {
  const body = z.object({ password: z.string().min(1), code: z.string().min(6).max(6) }).parse(req.body);
  const user = await findUserById(req.auth!.user.id);
  if (!user?.mfa_secret) throw badRequest('ورود دومرحله‌ای فعال نیست.');
  if (await getBool('auth.staff_mfa_required')) {
    throw forbidden('ورود دومرحله‌ای برای کارکنان توسط مدیر سامانه الزامی شده است.');
  }
  if (!user.password_hash || !(await (await import('../lib/crypto.js')).verifyPassword(body.password, user.password_hash))) {
    throw badRequest('رمز عبور صحیح نیست.');
  }
  if (!verifyTotp(decryptSecret(user.mfa_secret), body.code)) throw badRequest('کد تأیید صحیح نیست.');
  await run('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, updated_at = ? WHERE id = ?', [nowIso(), user.id]);
  await writeAudit({ actorId: user.id, actorName: user.full_name, action: 'auth.mfa_disabled', entityType: 'user', entityId: user.id, ip: req.ip });
  res.json({ ok: true, data: { message: 'ورود دومرحله‌ای غیرفعال شد.' } });
}));

/** Bootstrap info for the login screen (no session needed). */
authRouter.get('/login-info', asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    data: {
      customerOtp: await getBool('auth.customer_otp_enabled'),
      customerPassword: await getBool('auth.customer_password_enabled'),
      registrationOpen: await getBool('auth.customer_registration_open'),
      staffPassword: await getBool('auth.staff_password_login'),
      staffOtp: await getBool('auth.staff_otp_enabled'),
      siteName: await getString('site.name'),
    },
  });
}));

/** Internal helper used by the client to build the current session context. */
export async function contextForUser(userId: string, sessionId = '') {
  const user = await findUserById(userId);
  if (!user) throw unauthorized();
  return authContextFor(user, sessionId);
}

export { createSession };
