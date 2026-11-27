/**
 * SMTP email provider — the transport behind every system email.
 *
 * Mirrors the SMS provider's honesty rules:
 *  - every attempt lands in `email_logs` (pending → sent/failed/skipped) with
 *    an idempotency key, so a retried event sends exactly once;
 *  - a daily ceiling (`email.daily_limit`) protects against runaway loops;
 *  - bodies are NOT stored unless `email.log_body` is explicitly on;
 *  - errors are scrubbed of credentials before they touch the ledger;
 *  - `provider=console` is a development transport that renders to the log
 *    instead of the network, and says so — it never claims a real delivery.
 *
 * SMTP acceptance is not proof a human read the mail; the ledger therefore
 * records `sent`, never `delivered`. Read-receipts are deliberately not faked.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { getBool, getNumber, getSecret, getString } from '../settings/service.js';
import { one, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { renderEmailTemplate, type EmailTemplateCode } from './templates.js';

export interface EmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  provider: string;
  /** The rendered subject/text — only populated for the console transport so
   * tests and development can read what would have been sent. */
  devPreview?: { subject: string; text: string };
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export async function emailConfig(): Promise<EmailConfig> {
  return {
    host: (await getString('email.host')).trim(),
    port: Number(await getNumber('email.port')) || 587,
    secure: await getBool('email.secure'),
    user: (await getString('email.user')).trim(),
    password: await getSecret('email.password'),
    fromName: (await getString('email.from_name')).trim() || 'دفتر پیشخوان',
    fromAddress: (await getString('email.from_address')).trim(),
  };
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? '').trim());
}

export function maskEmail(email: string): string {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  const head = (local ?? '').slice(0, 2);
  return `${head}***@${domain}`;
}

function scrubError(error: unknown, cfg: EmailConfig): string {
  let safe = String(error instanceof Error ? error.message : error ?? '').slice(0, 400);
  for (const value of [cfg.password, cfg.user, process.env.APP_ENCRYPTION_KEY]) {
    if (value && value.length >= 4) safe = safe.split(value).join('[redacted]');
  }
  return safe;
}

/* ------------------------------- transports ------------------------------- */

let cachedTransport: { key: string; transporter: Transporter } | null = null;

function smtpTransport(cfg: EmailConfig): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}`;
  if (cachedTransport?.key === key) return cachedTransport.transporter;
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { minVersion: 'TLSv1.2' },
  });
  cachedTransport = { key, transporter };
  return transporter;
}

/** Verify SMTP connectivity/auth without sending anything. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await emailConfig();
  if (!cfg.host || !cfg.fromAddress) return { ok: false, error: 'هاست SMTP یا ایمیل فرستنده تنظیم نشده است.' };
  try {
    await smtpTransport(cfg).verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: scrubError(error, cfg) };
  }
}

/* --------------------------------- ledger --------------------------------- */

async function sentToday(): Promise<number> {
  const dayStart = `${nowIso().slice(0, 10)}T00:00:00.000Z`;
  const row = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM email_logs WHERE status = 'sent' AND created_at >= ?",
    [dayStart],
  );
  return Number(row?.c ?? 0);
}

export interface SendTemplateOptions {
  to: string;
  template: EmailTemplateCode;
  variables?: Record<string, string>;
  userId?: string | null;
  idempotencyKey?: string;
  /** Account emails (reset/verify/welcome) ignore the notify toggles but still
   * require email.enabled — an office that switched email off means it. */
  transactional?: boolean;
}

/**
 * Render + send one template email. Returns an honest result; never throws for
 * a delivery problem (the caller's business flow must not fail because a mail
 * server is down).
 */
export async function sendTemplateEmail(opts: SendTemplateOptions): Promise<EmailResult> {
  const to = String(opts.to ?? '').trim().toLowerCase();
  // The master switch applies to everything, transactional included: an office
  // that switched email off means it. The notify toggles are layered on top in
  // service.ts, and transactional mails skip only those.
  if (!(await getBool('email.enabled'))) {
    return { ok: false, error: 'ارسال ایمیل در تنظیمات سامانه غیرفعال است.', errorCode: 'disabled', provider: 'none' };
  }
  if (!isValidEmail(to)) {
    return { ok: false, error: 'نشانی ایمیل گیرنده معتبر نیست.', errorCode: 'invalid_email', provider: 'none' };
  }
  if (opts.idempotencyKey && opts.idempotencyKey.length > 180) {
    return { ok: false, error: 'کلید یکتای ارسال معتبر نیست.', errorCode: 'invalid_idempotency_key', provider: 'none' };
  }

  const cfg = await emailConfig();
  const providerName = cfg.host ? 'smtp' : 'console';
  if (providerName === 'smtp' && !isValidEmail(cfg.fromAddress)) {
    return { ok: false, error: 'ایمیل فرستنده (email.from_address) تنظیم نشده یا معتبر نیست.', errorCode: 'not_configured', provider: 'none' };
  }

  const officeName = (await getString('office.name')) || 'تک پیشخوان';
  const publicUrl = (await getString('domain.public_url')).replace(/\/+$/, '');
  const rendered = renderEmailTemplate(opts.template, { officeName, publicUrl, variables: opts.variables ?? {} });

  // Claim the idempotency slot before touching the network: two concurrent
  // events with the same key produce one send, not two.
  const logId = id('eml');
  const timestamp = nowIso();
  const logBody = (await getBool('email.log_body')) ? rendered.text.slice(0, 4000) : null;
  const claim = await run(
    `INSERT INTO email_logs (id, user_id, to_email, purpose, subject, body, provider, status, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
    [logId, opts.userId ?? null, to, opts.template, rendered.subject.slice(0, 300), logBody, opts.idempotencyKey ?? null, timestamp],
  );
  if (!claim.changes) {
    return { ok: false, error: 'این ایمیل قبلاً برای همین رویداد ارسال شده است.', errorCode: 'duplicate', provider: 'deduplicated' };
  }

  if ((await sentToday()) >= (await getNumber('email.daily_limit'))) {
    await run("UPDATE email_logs SET provider='limit', status='skipped', error='سقف ارسال روزانه' WHERE id=?", [logId]);
    return { ok: false, error: 'سقف ارسال ایمیل روزانهٔ سامانه تکمیل شده است.', errorCode: 'daily_limit', provider: 'none' };
  }

  let result: EmailResult;
  if (providerName === 'console') {
    // Development transport: render, log a redacted line, never touch the network.
    console.log(`[email:dev] to=${maskEmail(to)} template=${opts.template} subject=${rendered.subject}`);
    result = { ok: true, messageId: `dev_${Date.now()}`, provider: 'console', devPreview: { subject: rendered.subject, text: rendered.text } };
  } else {
    try {
      const info = await smtpTransport(cfg).sendMail({
        from: { name: cfg.fromName, address: cfg.fromAddress },
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      result = { ok: true, messageId: String(info.messageId ?? ''), provider: 'smtp' };
    } catch (error) {
      result = { ok: false, error: scrubError(error, cfg), errorCode: 'smtp_error', provider: 'smtp' };
    }
  }

  await run(
    "UPDATE email_logs SET provider=?, status=?, provider_message_id=?, error=?, sent_at=? WHERE id=? AND status='pending'",
    [result.provider, result.ok ? 'sent' : 'failed', result.messageId ?? null, result.error ?? null, result.ok ? nowIso() : null, logId],
  );
  return result;
}
