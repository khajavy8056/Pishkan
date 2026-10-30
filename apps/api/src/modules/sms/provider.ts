/**
 * SMS provider abstraction.
 *
 * The default provider is MeliPayamak (ملی پیامک). Two documented transports
 * are supported, both kept behind the same interface so a second provider can
 * be added later without touching business code:
 *
 *  1. Panel web service (`rest.payamak-panel.com`)
 *     POST {base}/SendSMS/BaseServiceNumber   username, password, text, to, bodyId
 *     POST {base}/SendSMS/SendSMS             username, password, to, from, text, isFlash
 *     POST {base}/SendSMS/GetCredit           username, password
 *     `password` may be the panel API key (Developers → web service settings).
 *
 *  2. Console REST API (`console.melipayamak.com`)
 *     POST {base}/api/send/shared/{token}     {"bodyId": n, "to": "09...", "args": ["12345"]}
 *     The token is part of the URL path, so it is never logged.
 *
 * Sources verified on 2026-10-24:
 *   https://www.melipayamak.com/api/            (web service overview)
 *   https://www.melipayamak.com/api/sendotp/    (SendOtp + return codes)
 *   https://www.melipayamak.com/blog/posts/send-sms-by-api-key/
 *   https://www.melipayamak.com/blog/posts/melipayamak-console/ (console REST)
 * If the provider changes its endpoint the operator can override `sms.base_url`
 * from the admin panel without a code change.
 */
import { getBool, getNumber, getSecret, getString } from '../settings/service.js';
import { one, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getEnabledSmsTemplate, type SmsEvent } from './templates.js';

export interface SmsResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  provider: string;
}

export interface SmsConfig {
  provider: string;
  authMode: 'credentials' | 'apikey' | 'console';
  username: string;
  password: string;
  apiKey: string;
  senderLine: string;
  baseUrl: string;
}

export async function smsConfig(): Promise<SmsConfig> {
  return {
    provider: await getString('sms.provider'),
    authMode: (await getString('sms.auth_mode')) as SmsConfig['authMode'],
    username: (await getSecret('sms.username')).trim(),
    password: await getSecret('sms.password'),
    apiKey: await getSecret('sms.api_key'),
    senderLine: (await getString('sms.sender_line')).trim(),
    baseUrl: (await getString('sms.base_url')).replace(/\/+$/, '') || 'https://rest.payamak-panel.com/api',
  };
}

/** Persian/Arabic digits (the panel displays keys with Persian digits) → ASCII. */
export function normalizeDigits(value: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return value.replace(/[۰-۹٠-٩]/g, (d) => String(fa.indexOf(d) >= 0 ? fa.indexOf(d) : ar.indexOf(d)));
}

export function normalizeMobile(input: string): string {
  let m = normalizeDigits(String(input ?? '')).replace(/[^\d+]/g, '');
  if (m.startsWith('+98')) m = `0${m.slice(3)}`;
  else if (m.startsWith('0098')) m = `0${m.slice(4)}`;
  else if (m.startsWith('98') && m.length === 12) m = `0${m.slice(2)}`;
  else if (/^9\d{9}$/.test(m)) m = `0${m}`;
  return m;
}

export function isValidMobile(input: string): boolean {
  return /^09\d{9}$/.test(normalizeMobile(input));
}

export function maskMobile(mobile: string): string {
  const m = normalizeMobile(mobile);
  return m.length === 11 ? `${m.slice(0, 4)}***${m.slice(-3)}` : '***';
}

/* ----------------------------- error mapping ------------------------------ */

/** Return codes documented for the MeliPayamak web service. */
const PANEL_CODES: Record<string, string> = {
  '0': 'نام کاربری یا رمز عبور اشتباه است.',
  '1': 'درخواست معتبر نیست.',
  '2': 'اعتبار حساب پیامکی کافی نیست.',
  '3': 'محدودیت ارسال روزانه سرویس‌دهنده.',
  '4': 'محدودیت حجم ارسال.',
  '5': 'شماره فرستنده معتبر نیست.',
  '6': 'سامانه پیامک در حال بروزرسانی است.',
  '7': 'متن پیامک شامل کلمه فیلترشده است.',
  '9': 'ارسال از خطوط عمومی از طریق وب‌سرویس مجاز نیست.',
  '10': 'شماره گیرنده در لیست سیاه مخابرات است.',
  '108': 'IP سرور برای استفاده از وب‌سرویس مجاز نشده است.',
  '109': 'استفاده از کلید API به‌جای رمز عبور الزامی است.',
  '110': 'دسترسی وب‌سرویس برای این حساب فعال نیست.',
  '111': 'IP درخواست‌کننده نامعتبر است.',
  '-111': 'IP درخواست‌کننده نامعتبر است.',
  '-110': 'استفاده از کلید API به‌جای رمز عبور لازم است.',
  '-109': 'IP سرور باید در پنل ملی پیامک مجاز شود.',
  '-108': 'IP به دلیل درخواست‌های ناموفق موقتاً مسدود شده است.',
  '-10': 'متغیرهای پیامک نمی‌توانند شامل پیوند باشند.',
  '-7': 'شماره فرستنده برای ارسال معتبر نیست.',
  '-6': 'خطای داخلی سرویس‌دهنده پیامک.',
  '-5': 'متغیرهای ارسالی با الگوی تأییدشده مطابقت ندارند.',
  '-4': 'شناسه الگوی پیامک معتبر یا تأییدشده نیست.',
  '-3': 'خط ارسال در حساب سرویس‌دهنده تعریف نشده است.',
  '-2': 'در هر درخواست فقط یک شماره گیرنده مجاز است.',
  '-1': 'دسترسی به وب‌سرویس پیامک فعال نیست.',
  '11': 'پیامک توسط سرویس‌دهنده ارسال نشد.',
  '12': 'مدارک حساب سرویس‌دهنده کامل نیست.',
  '14': 'متن پیامک شامل پیوند است.',
  '16': 'شماره گیرنده پیدا نشد.',
  '17': 'متن پیامک خالی است.',
  '18': 'شماره گیرنده معتبر نیست.',
  '19': 'محدودیت زمانی ارسال سرویس‌دهنده اعمال شده است.',
  '35': 'شماره گیرنده در فهرست سیاه مخابرات است.',
};

function panelError(value: unknown): { message: string; code: string } {
  const code = String(value ?? '');
  return { message: PANEL_CODES[code] ?? `خطای نامشخص سرویس پیامک (کد ${code || '؟'})`, code };
}

/** The official REST API returns a plain-text numeric RecId/error code. */
function parsePanelSendResult(res: { ok: boolean; status: number; json: any; text: string }): SmsResult {
  if (!res.ok) {
    return { ok: false, error: `پاسخ نامعتبر از سرویس پیامک (HTTP ${res.status}).`, errorCode: `http_${res.status}`, provider: 'melipayamak' };
  }
  const payload = res.json && typeof res.json === 'object' ? res.json : null;
  const value = payload
    ? payload.Value ?? payload.value ?? payload.ReturnValue ?? payload.returnValue
    : typeof res.json === 'string' || typeof res.json === 'number' ? res.json : res.text.trim();
  const messageId = String(value ?? '').trim().replace(/^\"|\"$/g, '');
  const legacyStatus = payload?.RetStatus ?? payload?.retStatus;
  if (/^\d{16,}$/.test(messageId) || (String(legacyStatus) === '1' && /^\d+$/.test(messageId) && messageId !== '0')) {
    return { ok: true, messageId, provider: 'melipayamak' };
  }
  if (messageId) {
    const err = panelError(messageId);
    return { ok: false, error: err.message, errorCode: err.code, provider: 'melipayamak' };
  }
  return { ok: false, error: `پاسخ نامعتبر از سرویس پیامک (HTTP ${res.status}).`, errorCode: 'bad_response', provider: 'melipayamak' };
}

/* -------------------------------- transport ------------------------------- */

async function postForm(url: string, data: Record<string, string>, timeoutMs = 12_000): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', accept: 'application/json' },
      body: new URLSearchParams(data).toString(),
      signal: controller.signal,
      redirect: 'error',
    });
    const text = (await res.text()).slice(0, 8192);
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-json response */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url: string, body: unknown, timeoutMs = 12_000): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    const text = (await res.text()).slice(0, 8192);
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------- providers ------------------------------- */

interface SendPatternInput {
  to: string;
  bodyId: string;
  args: string[];
  text?: string;
}

interface SendSimpleInput {
  to: string;
  text: string;
}

export interface SmsProvider {
  name: string;
  configured(): boolean;
  sendPattern(input: SendPatternInput): Promise<SmsResult>;
  sendSimple(input: SendSimpleInput): Promise<SmsResult>;
  ping(): Promise<{ ok: boolean; message: string; detail?: string }>;
}

function melipayamakPanel(cfg: SmsConfig): SmsProvider {
  const credential = cfg.authMode === 'apikey' ? normalizeDigits(cfg.apiKey) : cfg.password;
  const username = normalizeDigits(cfg.username);
  return {
    name: 'melipayamak-panel',
    configured: () => Boolean(username && credential),
    async sendPattern({ to, bodyId, args, text }) {
      const payload = {
        username,
        password: credential,
        text: text ?? args.join(';'),
        to: normalizeMobile(to),
        bodyId: normalizeDigits(String(bodyId)),
      };
      try {
        const res = await postForm(`${cfg.baseUrl}/SendSMS/BaseServiceNumber`, payload);
        return parsePanelSendResult(res);
      } catch (e: any) {
        return { ok: false, error: e?.name === 'AbortError' ? 'زمان پاسخ سرویس پیامک به پایان رسید.' : 'ارتباط با سرویس پیامک برقرار نشد.', errorCode: 'network', provider: 'melipayamak' };
      }
    },
    async sendSimple({ to, text }) {
      const payload = {
        username,
        password: credential,
        to: normalizeMobile(to),
        from: normalizeDigits(cfg.senderLine),
        text,
        isflash: 'false',
      };
      try {
        const res = await postForm(`${cfg.baseUrl}/SendSMS/SendSMS`, payload);
        return parsePanelSendResult(res);
      } catch (e: any) {
        return { ok: false, error: e?.name === 'AbortError' ? 'زمان پاسخ سرویس پیامک به پایان رسید.' : 'ارتباط با سرویس پیامک برقرار نشد.', errorCode: 'network', provider: 'melipayamak' };
      }
    },
    async ping() {
      if (!username || !credential) return { ok: false, message: 'نام کاربری یا کلید/رمز ملی پیامک وارد نشده است.' };
      try {
        const res = await postForm(`${cfg.baseUrl}/SendSMS/GetCredit`, { username, password: credential });
        const value = res.json?.Value ?? res.json?.value;
        if (res.json && (res.json.RetStatus === 1 || res.json.retStatus === 1 || typeof value === 'number')) {
          return { ok: true, message: 'اتصال به ملی پیامک برقرار است.', detail: `اعتبار حساب: ${value} پیامک` };
        }
        const err = panelError(value);
        return { ok: false, message: err.message, detail: `کد پاسخ: ${err.code || '؟'}` };
      } catch {
        return { ok: false, message: 'ارتباط شبکه‌ای با ملی پیامک برقرار نشد.' };
      }
    },
  };
}

function melipayamakConsole(cfg: SmsConfig): SmsProvider {
  const token = (cfg.apiKey || cfg.password).trim();
  const base = cfg.baseUrl.includes('console.melipayamak.com')
    ? cfg.baseUrl.replace(/\/api$/, '')
    : 'https://console.melipayamak.com';
  const url = (path: string) => `${base}/api/send/${path}/${encodeURIComponent(token)}`;

  const parse = (res: { ok: boolean; status: number; json: any }): SmsResult => {
    const recId = res.json?.recId ?? res.json?.id ?? res.json?.messageId;
    if (res.ok && recId !== undefined && recId !== null) {
      return { ok: true, messageId: String(recId), provider: 'melipayamak-console' };
    }
    const message = res.json?.message || res.json?.error || `خطای سرویس پیامک (HTTP ${res.status})`;
    return { ok: false, error: String(message), errorCode: String(res.status), provider: 'melipayamak-console' };
  };

  return {
    name: 'melipayamak-console',
    configured: () => Boolean(token),
    async sendPattern({ to, bodyId, args }) {
      try {
        return parse(await postJson(url('shared'), { bodyId: Number(bodyId), to: normalizeMobile(to), args }));
      } catch {
        return { ok: false, error: 'ارتباط با کنسول ملی پیامک برقرار نشد.', errorCode: 'network', provider: 'melipayamak-console' };
      }
    },
    async sendSimple({ to, text }) {
      try {
        return parse(await postJson(url('simple'), { to: normalizeMobile(to), text }));
      } catch {
        return { ok: false, error: 'ارتباط با کنسول ملی پیامک برقرار نشد.', errorCode: 'network', provider: 'melipayamak-console' };
      }
    },
    async ping() {
      if (!token) return { ok: false, message: 'کلید API کنسول ملی پیامک وارد نشده است.' };
      // The console has no documented "ping"; sending is the only verification.
      return { ok: true, message: 'کلید API تنظیم شده است؛ برای بررسی واقعی از «ارسال پیامک آزمایشی» استفاده کنید.' };
    },
  };
}

/** Development provider — writes messages to the server log instead of sending. */
function consoleProvider(): SmsProvider {
  if(process.env.NODE_ENV==='production') throw new Error('Development SMS transport is forbidden in production');
  const logSend = (to: string, text: string) => {
    console.log(`[sms:dev] to=${maskMobile(to)} body=[redacted]`);
    return { ok: true, messageId: `dev_${Date.now()}`, provider: 'console' } as SmsResult;
  };
  return {
    name: 'console',
    configured: () => true,
    async sendPattern({ to, args, text }) { return logSend(to, text ?? args.join(';')); },
    async sendSimple({ to, text }) { return logSend(to, text); },
    async ping() { return { ok: true, message: 'ارائه‌دهنده شبیه‌ساز فعال است؛ پیامک واقعی ارسال نمی‌شود.' }; },
  };
}

export async function getProvider(): Promise<SmsProvider> {
  const cfg = await smsConfig();
  if (cfg.provider === 'console') return consoleProvider();
  if (cfg.authMode === 'console') return melipayamakConsole(cfg);
  return melipayamakPanel(cfg);
}

/* ------------------------------ logging helper ---------------------------- */

async function logSms(input: {
  mobile: string; purpose?: string; provider: string; templateCode?: string;
  body?: string; status: 'pending' | 'sent' | 'failed' | 'skipped'; messageId?: string; error?: string; idempotencyKey?: string;
}) {
  const keepBody = await getBool('sms.log_body');
  await run(
    `INSERT INTO sms_logs (id, mobile, purpose, provider, template_code, body, status, provider_message_id, error, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id('sms'), normalizeMobile(input.mobile), input.purpose ?? null, input.provider,
      input.templateCode ?? null, keepBody ? input.body ?? null : null, input.status,
      input.messageId ?? null, input.error ?? null, nowIso(), input.idempotencyKey ?? null,
    ],
  );
}

/** Today's outbound SMS count — guards the platform-wide daily ceiling. */
async function sentToday(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM sms_logs WHERE status = ? AND created_at >= ?',
    ['sent', start.toISOString()],
  );
  return Number(row?.c ?? 0);
}

/* --------------------------------- facade --------------------------------- */

export async function sendOtpSms(mobile: string, code: string, purpose = 'login'): Promise<SmsResult> {
  const enabled = await getBool('sms.enabled');
  if (!enabled) {
    await logSms({ mobile, purpose, provider: 'disabled', status: 'skipped', error: 'ارسال پیامک غیرفعال است.' });
    return { ok: false, error: 'ارسال پیامک در تنظیمات سامانه غیرفعال است.', errorCode: 'disabled', provider: 'none' };
  }
  if (!isValidMobile(mobile)) {
    return { ok: false, error: 'شماره موبایل معتبر نیست.', errorCode: 'invalid_mobile', provider: 'none' };
  }
  const dailyLimit = await getNumber('sms.daily_limit');
  if ((await sentToday()) >= dailyLimit) {
    await logSms({ mobile, purpose, provider: 'limit', status: 'skipped', error: 'سقف ارسال روزانه' });
    return { ok: false, error: 'سقف ارسال پیامک روزانه سامانه تکمیل شده است.', errorCode: 'daily_limit', provider: 'none' };
  }

  const provider = await getProvider();
  const templateId = await getString('sms.otp_template_id');
  const paramName = await getString('sms.otp_param_name') || '0';
  const templateBody = await getString('sms.otp_template_body');

  let result: SmsResult;
  if (templateId) {
    // Approved pattern (پترن). Only the parameter values are sent.
    result = await provider.sendPattern({ to: mobile, bodyId: templateId, args: [code] });
  } else {
    const text = (templateBody || 'کد ورود شما {0} است').replace(/\{0\}|\{code\}/g, code);
    result = await provider.sendSimple({ to: mobile, text });
  }

  await logSms({
    mobile, purpose, provider: result.provider, templateCode: templateId || undefined,
    body: `code:${code.length}digits${templateId ? '' : ` / ${paramName}`}`,
    status: result.ok ? 'sent' : 'failed', messageId: result.messageId, error: result.error,
  });
  return result;
}

function scrubSmsError(error: string | undefined): string | undefined {
  if (!error) return undefined;
  let safe = error.slice(0, 400);
  for (const value of [process.env.APP_ENCRYPTION_KEY, process.env.SMS_API_KEY, process.env.SMS_PASSWORD]) {
    if (value && value.length >= 4) safe = safe.split(value).join('[redacted]');
  }
  return safe;
}

/** Send a configured approved pattern once for a durable event key. */
export async function sendEventNotificationSms(mobile: string, event: SmsEvent, idempotencyKey: string): Promise<SmsResult> {
  if (!isValidMobile(mobile)) return { ok: false, error: 'شماره موبایل معتبر نیست.', errorCode: 'invalid_mobile', provider: 'none' };
  if (!(await getBool('sms.enabled')) || !(await getBool('sms.notify_enabled'))) {
    return { ok: false, error: 'پیامک اعلان غیرفعال است.', errorCode: 'disabled', provider: 'none' };
  }
  const template = await getEnabledSmsTemplate(event.eventCode);
  if (!template) {
    await logSms({ mobile, purpose: event.eventCode, provider: 'none', status: 'skipped', error: 'الگوی فعال و معتبر برای این رویداد تعریف نشده است.' });
    return { ok: false, error: 'الگوی فعال و معتبر برای این رویداد تعریف نشده است.', errorCode: 'template_unavailable', provider: 'none' };
  }
  const names = [...template.variables];
  if (Object.keys(event.variables).sort().join('|') !== [...names].sort().join('|')) {
    await logSms({ mobile, purpose: event.eventCode, templateCode: template.bodyId, provider: 'none', status: 'skipped', error: 'متغیرهای رویداد با قرارداد الگو سازگار نیستند.' });
    return { ok: false, error: 'متغیرهای پیامک کامل نیستند.', errorCode: 'invalid_variables', provider: 'none' };
  }
  const args = names.map((name) => String(event.variables[name]).slice(0, 120));
  if (!idempotencyKey || idempotencyKey.length > 180) {
    return { ok: false, error: 'کلید یکتای ارسال معتبر نیست.', errorCode: 'invalid_idempotency_key', provider: 'none' };
  }
  if ((await sentToday()) >= await getNumber('sms.daily_limit')) {
    await logSms({ mobile, purpose: event.eventCode, provider: 'limit', status: 'skipped', error: 'سقف ارسال روزانه' });
    return { ok: false, error: 'سقف ارسال پیامک روزانه سامانه تکمیل شده است.', errorCode: 'daily_limit', provider: 'none' };
  }

  const logId = id('sms');
  const timestamp = nowIso();
  const claim = await run(
    `INSERT INTO sms_logs (id, mobile, purpose, provider, template_code, body, status, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
    [logId, normalizeMobile(mobile), event.eventCode, 'pending', template.bodyId, `event:${event.eventCode}; params:${args.length}`, timestamp, idempotencyKey],
  );
  if (!claim.changes) return { ok: false, error: 'این رویداد قبلاً برای این گیرنده پردازش شده است.', errorCode: 'duplicate', provider: 'deduplicated' };

  let result: SmsResult;
  try {
    const provider = await getProvider();
    if (!provider.configured()) throw new Error('اعتبارنامه پیامک تنظیم نشده است.');
    result = await provider.sendPattern({ to: mobile, bodyId: template.bodyId, args });
  } catch (error) {
    result = { ok: false, error: 'پیکربندی یا اتصال ارائه‌دهنده پیامک نامعتبر است.', errorCode: 'provider_error', provider: 'none' };
  }
  const safeError = scrubSmsError(result.error);
  await run(
    'UPDATE sms_logs SET provider=?, status=?, provider_message_id=?, error=? WHERE id=? AND status=\'pending\'',
    [result.provider, result.ok ? 'sent' : 'failed', result.messageId ?? null, safeError ?? null, logId],
  );
  return { ...result, error: safeError };
}

export async function sendNotificationSms(mobile: string, params: string[], purpose = 'notification'): Promise<SmsResult> {
  if (!(await getBool('sms.enabled')) || !(await getBool('sms.notify_enabled'))) {
    return { ok: false, error: 'پیامک اعلان غیرفعال است.', errorCode: 'disabled', provider: 'none' };
  }
  const templateId = await getString('sms.notify_template_id');
  if (!templateId) {
    return { ok: false, error: 'الگوی اعلان در تنظیمات تعریف نشده است.', errorCode: 'no_template_pin', provider: 'none' };
  }
  const provider = await getProvider();
  const result = await provider.sendPattern({ to: mobile, bodyId: templateId, args: params });
  await logSms({
    mobile, purpose, provider: result.provider, templateCode: templateId,
    status: result.ok ? 'sent' : 'failed', messageId: result.messageId, error: result.error,
  });
  return result;
}

/** Settings-panel actions: connection test and real test message. */
export async function testConnection(): Promise<{ ok: boolean; message: string; detail?: string; checkedAt: string }> {
  const provider = await getProvider();
  const result = await provider.ping();
  return { ...result, checkedAt: nowIso() };
}

export async function sendTestSms(mobile: string): Promise<SmsResult & { checkedAt: string }> {
  const result = await sendOtpSms(mobile, '12345', 'test');
  return { ...result, checkedAt: nowIso() };
}

export async function smsLogs(limit = 100) {
  const rows = await one<{ c: number }>('SELECT COUNT(*) AS c FROM sms_logs');
  const items = await (await import('../../db/index.js')).q(
    'SELECT id, mobile, purpose, provider, template_code, status, provider_message_id, error, created_at FROM sms_logs ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
  return { total: Number(rows?.c ?? 0), items };
}
