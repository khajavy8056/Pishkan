/**
 * Payment provider adapters.
 *
 * A provider only knows how to *start* a payment and how to *prove* its result
 * server-side. It never receives an amount from the browser: the amount always
 * comes from the pending `payments` row created by the server.
 */
import crypto from 'node:crypto';
import { env } from '../../env.js';
import { isPublicHttpsUrl } from '../../lib/public-url.js';
import { badRequest, forbidden } from '../../http/errors.js';
import { getBool, getNumber, getSecret, getString } from '../settings/service.js';

export type ProviderCode = 'zarinpal' | 'sandbox';

export interface ProviderConfig {
  code: ProviderCode;
  sandbox: boolean;
}

export interface StartInput {
  paymentId: string;
  amount: number;
  description: string;
  /** Where the gateway should send the customer back. */
  callbackUrl: string;
}

export interface StartResult {
  paymentUrl: string;
  authority: string;
  provider: ProviderCode;
  sandbox: boolean;
}

export interface VerifyInput {
  paymentId: string;
  amount: number;
  authority: string;
  /** Provider callback parameters (authority/status/token ...). */
  params: Record<string, string>;
}

export interface VerifyResult {
  confirmed: boolean;
  reference?: string;
  code?: string;
  reason?: string;
}

export interface PaymentProvider {
  code: ProviderCode;
  label: string;
  sandboxCapable: boolean;
  start(input: StartInput): Promise<StartResult>;
  verify(input: VerifyInput): Promise<VerifyResult>;
}

/* -------------------------------- utilities ------------------------------- */

export function callbackBase(): string {
  return env.zarinpalCallbackBaseUrl || env.apiUrl;
}

function sandboxSecret(): string {
  // A dedicated HMAC key; falls back to the encryption key in non-production
  // environments so local installs do not need extra configuration.
  return env.encryptionKey || 'pishkan-sandbox-development-key';
}

/** Signed, expiring token handed to the sandbox checkout page. */
export function sandboxToken(paymentId: string, amount: number): string {
  const expires = Date.now() + 30 * 60_000;
  const payload = `${paymentId}.${amount}.${expires}`;
  const mac = crypto.createHmac('sha256', sandboxSecret()).update(payload).digest('base64url').slice(0, 32);
  return Buffer.from(`${payload}.${mac}`).toString('base64url');
}

export function verifySandboxToken(token: string, paymentId: string, amount: number): boolean {
  try {
    const [pid, amt, expires, mac] = Buffer.from(String(token), 'base64url').toString('utf8').split('.');
    if (!pid || !amt || !expires || !mac) return false;
    if (pid !== paymentId || Number(amt) !== Number(amount)) return false;
    if (Number(expires) < Date.now()) return false;
    const expected = crypto.createHmac('sha256', sandboxSecret()).update(`${pid}.${amt}.${expires}`).digest('base64url').slice(0, 32);
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return false;
  }
}

/* -------------------------------- sandbox --------------------------------- */

const sandboxProvider: PaymentProvider = {
  code: 'sandbox',
  label: 'شبیه‌ساز درگاه (Sandbox)',
  sandboxCapable: true,
  async start(input) {
    if (env.isProd) throw forbidden('شبیه‌ساز درگاه در محیط عملیاتی غیرفعال است.');
    const token = sandboxToken(input.paymentId, input.amount);
    return {
      paymentUrl: `/api/payments/sandbox/${encodeURIComponent(input.paymentId)}?token=${encodeURIComponent(token)}`,
      authority: `SANDBOX-${input.paymentId.slice(-8)}`,
      provider: 'sandbox',
      sandbox: true,
    };
  },
  async verify(input) {
    if (env.isProd) throw forbidden('شبیه‌ساز درگاه در محیط عملیاتی غیرفعال است.');
    const token = String(input.params.token ?? '');
    if (!verifySandboxToken(token, input.paymentId, input.amount)) {
      return { confirmed: false, code: 'invalid_token', reason: 'توکن شبیه‌ساز درگاه معتبر نیست.' };
    }
    if (String(input.params.decision ?? '') !== 'paid') {
      return { confirmed: false, code: 'cancelled', reason: 'پرداخت در شبیه‌ساز لغو شد.' };
    }
    return { confirmed: true, reference: `SBX-${input.paymentId.slice(-10).toUpperCase()}`, code: '100' };
  },
};

/* -------------------------------- zarinpal -------------------------------- */

export function zarinpalBase(sandbox: boolean) {
  return sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
}

/** Rebuild the checkout URL of an already-started pending payment. */
export function resumePaymentUrl(payment: { id: string; amount: number; gateway: string | null; gateway_authority: string | null; gateway_sandbox: number | boolean }): string | null {
  const code = payment.gateway === 'mock' || payment.gateway === 'test' ? 'sandbox' : payment.gateway;
  if (code === 'sandbox') {
    if (env.isProd) return null;
    return `/api/payments/sandbox/${encodeURIComponent(payment.id)}?token=${encodeURIComponent(sandboxToken(payment.id, Number(payment.amount)))}`;
  }
  if (code === 'zarinpal' && payment.gateway_authority) {
    return `${zarinpalBase(Boolean(Number(payment.gateway_sandbox)))}/pg/StartPay/${encodeURIComponent(payment.gateway_authority)}`;
  }
  return null;
}

async function merchantId(): Promise<string> {
  const merchant = await getSecret('accounting.gateway_merchant_id');
  if (!/^[0-9a-f-]{36}$/i.test(merchant)) throw badRequest('شناسه پذیرنده زرین‌پال تنظیم نشده یا معتبر نیست.');
  return merchant;
}

async function zarinpalCall(sandbox: boolean, operation: 'request' | 'verify', payload: object) {
  const timeoutSeconds = Math.min(60, Math.max(5, await getNumber('accounting.gateway_timeout_seconds')));
  let response: Response;
  try {
    response = await fetch(`${zarinpalBase(sandbox)}/pg/v4/payment/${operation}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      redirect: 'error',
    });
  } catch (error: any) {
    throw badRequest('درگاه پاسخ نداد؛ وضعیت را بررسی و دوباره تلاش کنید.');
  }
  if (!response.ok) throw badRequest('درگاه پرداخت پاسخ معتبر نداد.');
  let result: any;
  try { result = await response.json(); } catch { throw badRequest('پاسخ درگاه معتبر نیست.'); }
  if (!result?.data || typeof result.data.code !== 'number') throw badRequest('پاسخ درگاه معتبر نیست.');
  return result.data;
}

const zarinpalProvider: PaymentProvider = {
  code: 'zarinpal',
  label: 'زرین‌پال',
  sandboxCapable: true,
  async start(input) {
    const sandbox = await getBool('accounting.gateway_sandbox');
    const configuredCallback = (await getString('accounting.gateway_callback_url')) || '';
    const callback = new URL('/api/payments/callback/zarinpal', configuredCallback || callbackBase());
    callback.searchParams.set('paymentId', input.paymentId);
    if (env.isProd && !isPublicHttpsUrl(callback.origin)) {
      throw badRequest('نشانی بازگشت درگاه باید HTTPS عمومی باشد.');
    }
    const data = await zarinpalCall(sandbox, 'request', {
      merchant_id: await merchantId(),
      amount: input.amount,
      currency: 'IRR',
      callback_url: callback.toString(),
      description: input.description.slice(0, 250),
    });
    if (data.code !== 100 || !/^A[0-9a-z]{20,64}$/i.test(data.authority ?? '')) {
      throw badRequest('درخواست پرداخت توسط درگاه پذیرفته نشد.');
    }
    return {
      paymentUrl: `${zarinpalBase(sandbox)}/pg/StartPay/${encodeURIComponent(data.authority)}`,
      authority: data.authority,
      provider: 'zarinpal',
      sandbox,
    };
  },
  async verify(input) {
    const store = input.params.sandbox === '1';
    if (String(input.params.status ?? '').toUpperCase() !== 'OK') {
      return { confirmed: false, code: 'not_ok', reason: 'وضعیت بازگشتی درگاه تأیید نیست.' };
    }
    const data = await zarinpalCall(store, 'verify', {
      merchant_id: await merchantId(),
      amount: input.amount,
      authority: input.authority,
    });
    if (![100, 101].includes(data.code) || !data.ref_id) {
      return { confirmed: false, code: String(data.code), reason: 'تأیید سروری پرداخت موفق نبود.' };
    }
    return { confirmed: true, reference: String(data.ref_id), code: String(data.code) };
  },
};

const REGISTRY: Record<ProviderCode, PaymentProvider> = {
  sandbox: sandboxProvider,
  zarinpal: zarinpalProvider,
};

export function providerFor(code: string): PaymentProvider {
  const provider = REGISTRY[code as ProviderCode];
  if (!provider) throw badRequest('درگاه پرداخت انتخاب‌شده پشتیبانی نمی‌شود.');
  return provider;
}

/** Gateway selected by the administrator, validated for the current runtime. */
export async function selectedProvider(): Promise<PaymentProvider | null> {
  const code = await getString('accounting.gateway');
  if (!code || code === 'none') return null;
  // Legacy values from older installs: `test` was the internal simulator and
  // `mock` was the callback name. They map onto the new sandbox provider.
  const normalized = code === 'test' || code === 'mock' ? 'sandbox' : code;
  if (normalized === 'sandbox' && env.isProd) return null;
  return providerFor(normalized);
}

export async function providerReadiness(): Promise<{
  code: string; configured: boolean; sandbox: boolean; enabled: boolean; reason?: string;
}> {
  const code = await getString('accounting.gateway');
  const normalized = code === 'test' || code === 'mock' ? 'sandbox' : code;
  const enabled = await getBool('accounting.online_payment_enabled');
  const sandbox = await getBool('accounting.gateway_sandbox');
  if (!enabled) return { code: normalized, configured: false, sandbox, enabled, reason: 'پرداخت آنلاین در تنظیمات غیرفعال است.' };
  if (normalized === 'none' || !normalized) return { code: normalized, configured: false, sandbox, enabled, reason: 'درگاهی انتخاب نشده است.' };
  if (normalized === 'sandbox') {
    if (env.isProd) return { code: normalized, configured: false, sandbox, enabled, reason: 'شبیه‌ساز درگاه در production مجاز نیست.' };
    return { code: normalized, configured: true, sandbox: true, enabled };
  }
  if (normalized === 'zarinpal') {
    const merchant = await getSecret('accounting.gateway_merchant_id');
    if (!/^[0-9a-f-]{36}$/i.test(merchant)) {
      return { code: normalized, configured: false, sandbox, enabled, reason: 'شناسه پذیرنده زرین‌پال تنظیم نشده است.' };
    }
    const callback = (await getString('accounting.gateway_callback_url')) || callbackBase();
    if (env.isProd && !isPublicHttpsUrl(callback)) {
      return { code: normalized, configured: false, sandbox, enabled, reason: 'نشانی بازگشت درگاه HTTPS عمومی نیست.' };
    }
    return { code: normalized, configured: true, sandbox, enabled };
  }
  return { code: normalized, configured: false, sandbox, enabled, reason: 'درگاه پشتیبانی نمی‌شود.' };
}
