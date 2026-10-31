/**
 * Payment orchestration: start a payment, handle the gateway callback, settle an
 * invoice from the wallet.
 *
 * Security invariants:
 *   - amounts always come from the pending `payments` row (never the request);
 *   - a callback is only a *hint*: the provider is verified server-side before
 *     a payment is confirmed;
 *   - confirmation is idempotent (conditional status transition + unique
 *     financial operation key + wallet idempotency key);
 *   - every callback attempt is recorded in `payment_callbacks`;
 *   - secrets are never written to logs.
 */
import { one, q, run, nowIso, tx } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { getBool, getNumber } from '../settings/service.js';
import { confirmPayment, createPayment, getInvoice } from '../accounting/service.js';
import { assertWalletUsable, creditFromGateway, ensureWallet, moveMoney, topUpLimits } from '../wallet/service.js';
import { logEvent } from '../logging/service.js';
import { providerFor, providerReadiness, resumePaymentUrl, selectedProvider } from './providers.js';
import { notifyPaymentStatus } from '../notifications/events.js';
import { env } from '../../env.js';

export async function recordCallback(input: {
  paymentId?: string | null; provider: string; event: string; status: string;
  code?: string | null; reference?: string | null; ip?: string | null; detail?: string | null;
}) {
  await run(
    `INSERT INTO payment_callbacks (id, payment_id, provider, event, status, code, reference, ip, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id('pcb'), input.paymentId ?? null, input.provider,
      input.event, input.status, input.code ?? null,
      input.reference ? String(input.reference).slice(0, 120) : null,
      input.ip ? String(input.ip).slice(0, 60) : null,
      input.detail ? String(input.detail).slice(0, 500) : null, nowIso()],
  );
}

/** Create the pending payment row and ask the provider for a checkout URL. */
async function begin(input: {
  customerId: string;
  amount: number;
  purpose: 'invoice' | 'wallet_topup';
  invoiceId?: string | null;
  requestId?: string | null;
  walletId?: string | null;
  description: string;
  actor: { id: string; name: string; ip?: string };
}) {
  if (!(await getBool('accounting.online_payment_enabled'))) {
    throw badRequest('پرداخت آنلاین در حال حاضر فعال نیست.');
  }
  const readiness = await providerReadiness();
  if (!readiness.configured) throw badRequest(readiness.reason ?? 'درگاه پرداخت پیکربندی نشده است.');
  const provider = await selectedProvider();
  if (!provider) throw badRequest('درگاه پرداخت پیکربندی نشده است.');

  const payment = await createPayment({
    customerId: input.customerId,
    invoiceId: input.invoiceId ?? null,
    requestId: input.requestId ?? null,
    amount: input.amount,
    method: 'online',
    gateway: provider.code,
    status: 'pending',
    purpose: input.purpose,
    walletId: input.walletId ?? null,
  }, input.actor);

  let started;
  try {
    started = await provider.start({
      paymentId: payment.id,
      amount: input.amount,
      description: input.description,
      callbackUrl: '',
    });
  } catch (error) {
    // A payment that never reached the gateway must not stay pending forever.
    await run("UPDATE payments SET status='failed', note=?, updated_at=? WHERE id=? AND status='pending'",
      ['شروع پرداخت در درگاه ناموفق بود.', nowIso(), payment.id]);
    await recordCallback({
      paymentId: payment.id, provider: provider.code, event: 'start', status: 'error',
      detail: error instanceof Error ? error.message : 'start failed',
    });
    throw error;
  }

  await run('UPDATE payments SET gateway_authority=?, gateway_sandbox=?, updated_at=? WHERE id=?',
    [started.authority, started.sandbox ? 1 : 0, nowIso(), payment.id]);
  await recordCallback({
    paymentId: payment.id, provider: provider.code, event: 'start', status: 'pending',
    reference: started.authority, ip: input.actor.ip,
  });
  await logEvent({
    level: 'INFO', category: 'gateway', action: 'payment.start', result: 'success',
    actorId: input.actor.id, actorName: input.actor.name, ip: input.actor.ip,
    entityType: 'payment', entityId: payment.id, transactionId: payment.id,
    message: 'درخواست پرداخت در درگاه ایجاد شد.',
    details: { provider: provider.code, amount: input.amount, purpose: input.purpose, sandbox: started.sandbox },
  });
  return { paymentId: payment.id, paymentUrl: started.paymentUrl, provider: provider.code, sandbox: started.sandbox };
}

/** Customer pays an issued invoice through the online gateway. */
export async function startInvoicePayment(invoiceId: string, customerId: string, actor: { id: string; name: string; ip?: string }) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw notFound('فاکتور یافت نشد.');
  if (invoice.customerId !== customerId) throw forbidden('این فاکتور متعلق به شما نیست.');
  if (invoice.status === 'draft' || invoice.status === 'void') throw badRequest('این فاکتور قابل پرداخت نیست.');
  if (invoice.remaining <= 0) throw badRequest('این فاکتور تسویه شده است.');
  const min = await getNumber('accounting.min_online_payment');
  if (invoice.remaining < min) throw badRequest(`حداقل مبلغ پرداخت آنلاین ${min} ریال است.`);

  // Re-use an existing pending gateway payment instead of stacking reservations.
  const pending = await one<any>(
    "SELECT * FROM payments WHERE invoice_id=? AND purpose='invoice' AND method='online' AND status='pending' ORDER BY created_at DESC LIMIT 1",
    [invoiceId],
  );
  if (pending?.gateway_authority) {
    const url = resumePaymentUrl(pending);
    if (url) {
      return {
        paymentId: pending.id,
        paymentUrl: url,
        provider: pending.gateway,
        sandbox: Boolean(Number(pending.gateway_sandbox)),
        reused: true,
      };
    }
  }

  return begin({
    customerId, amount: invoice.remaining, purpose: 'invoice', invoiceId,
    requestId: invoice.requestId ?? null,
    description: `پرداخت فاکتور ${invoice.number}`,
    actor,
  });
}

/** Customer starts a wallet top-up. The credited amount is always this one. */
export async function startWalletTopUp(customerId: string, amountInput: unknown, actor: { id: string; name: string; ip?: string }) {
  if (!(await getBool('wallet.enabled'))) throw forbidden('کیف پول در حال حاضر غیرفعال است.');
  const amount = Number(amountInput);
  if (!Number.isInteger(amount)) throw badRequest('مبلغ شارژ باید عدد صحیح ریالی باشد.');
  const { min, max } = await topUpLimits();
  if (amount < min) throw badRequest(`حداقل مبلغ شارژ ${min} ریال است.`);
  if (amount > max) throw badRequest(`حداکثر مبلغ شارژ در هر تراکنش ${max} ریال است.`);
  const wallet = await assertWalletUsable(customerId);
  const maxBalance = await getNumber('wallet.max_balance');
  if (maxBalance > 0 && Number(wallet.balance) + amount > maxBalance) {
    throw badRequest('مبلغ شارژ از سقف موجودی مجاز کیف پول بیشتر است.');
  }
  const pendingReserved = await one<{ total: number }>(
    "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE wallet_id=? AND purpose='wallet_topup' AND status='pending'",
    [wallet.id],
  );
  if (maxBalance > 0 && Number(wallet.balance) + Number(pendingReserved?.total ?? 0) + amount > maxBalance) {
    throw conflict('شارژهای در انتظار پرداخت، سقف موجودی کیف پول را پر می‌کنند.');
  }
  return begin({
    customerId, amount, purpose: 'wallet_topup', walletId: wallet.id,
    description: 'شارژ کیف پول مشتری', actor,
  });
}

/**
 * Gateway callback. `params` come straight from the provider's redirect; every
 * value is verified against the provider, never trusted on its own.
 */
export async function handleGatewayCallback(input: {
  provider: string; paymentId: string; params: Record<string, string>; ip?: string;
}) {
  const providerCode = input.provider === 'mock' || input.provider === 'test' ? 'sandbox' : input.provider;
  let provider;
  try {
    provider = providerFor(providerCode);
  } catch {
    await recordCallback({ provider: providerCode, event: 'callback', status: 'rejected', detail: 'unknown provider', ip: input.ip });
    throw badRequest('درگاه پرداخت پشتیبانی نمی‌شود.');
  }

  const payment = await one<any>('SELECT * FROM payments WHERE id = ?', [input.paymentId]);
  if (!payment) {
    await recordCallback({ provider: providerCode, event: 'callback', status: 'rejected', detail: 'payment not found', ip: input.ip });
    throw notFound('تراکنش یافت نشد.');
  }
  if (payment.gateway !== providerCode) {
    await recordCallback({
      paymentId: payment.id, provider: providerCode, event: 'callback', status: 'rejected',
      detail: 'provider mismatch', ip: input.ip,
    });
    throw forbidden('این تراکنش متعلق به درگاه اعلام‌شده نیست.');
  }

  const purpose = payment.purpose === 'wallet_topup' ? 'wallet' : 'invoices';

  if (payment.status === 'confirmed') {
    // Replay of a legitimate callback: report success without moving money twice.
    await recordCallback({
      paymentId: payment.id, provider: providerCode, event: 'callback', status: 'duplicate',
      reference: input.params.authority ?? input.params.token, ip: input.ip,
    });
    await logEvent({
      level: 'WARNING', category: 'gateway', action: 'payment.callback.duplicate', result: 'success',
      entityType: 'payment', entityId: payment.id, transactionId: payment.id, ip: input.ip,
      message: 'Callback تکراری دریافت و بدون اثر مالی نادیده گرفته شد.',
      details: { provider: providerCode },
    });
    return { confirmed: true, duplicate: true, reference: payment.reference, purpose };
  }
  if (payment.status !== 'pending') {
    await recordCallback({
      paymentId: payment.id, provider: providerCode, event: 'callback', status: 'rejected',
      detail: `payment status ${payment.status}`, ip: input.ip,
    });
    return { confirmed: false, status: payment.status, purpose };
  }

  let result;
  try {
    result = await provider.verify({
      paymentId: payment.id,
      amount: Number(payment.amount),
      authority: String(input.params.authority ?? payment.gateway_authority ?? ''),
      params: input.params,
    });
  } catch (error) {
    await recordCallback({
      paymentId: payment.id, provider: providerCode, event: 'verify', status: 'error',
      detail: error instanceof Error ? error.message : 'verify failed', ip: input.ip,
    });
    await logEvent({
      level: 'ERROR', category: 'gateway', action: 'payment.verify.error', result: 'failure',
      entityType: 'payment', entityId: payment.id, transactionId: payment.id, ip: input.ip,
      message: 'استعلام پرداخت از درگاه با خطا مواجه شد.',
      details: { provider: providerCode },
    });
    throw error;
  }

  if (!result.confirmed) {
    // An unverifiable callback is a forged/replayed browser redirect, not a
    // failed payment: the pending transaction stays open for the real attempt.
    if (result.code === 'invalid_token') {
      await recordCallback({
        paymentId: payment.id, provider: providerCode, event: 'verify', status: 'rejected',
        code: result.code, detail: 'token signature mismatch', ip: input.ip,
      });
      await logEvent({
        level: 'SECURITY', category: 'gateway', action: 'payment.callback.invalid', result: 'failure',
        entityType: 'payment', entityId: payment.id, transactionId: payment.id, ip: input.ip,
        message: 'Callback با امضای نامعتبر رد شد و وضعیت پرداخت تغییر نکرد.',
        details: { provider: providerCode },
      });
      return { confirmed: false, status: 'pending', purpose };
    }
    await run("UPDATE payments SET status='failed', note=?, updated_at=? WHERE id=? AND status='pending'",
      [String(result.reason ?? 'پرداخت ناموفق بود').slice(0, 500), nowIso(), payment.id]);
    await recordCallback({
      paymentId: payment.id, provider: providerCode, event: 'verify', status: 'rejected',
      code: result.code, ip: input.ip, detail: result.reason,
    });
    await logEvent({
      level: 'WARNING', category: 'gateway', action: 'payment.failed', result: 'failure',
      entityType: 'payment', entityId: payment.id, transactionId: payment.id, ip: input.ip,
      message: 'پرداخت در درگاه تأیید نشد.', details: { provider: providerCode, code: result.code },
    });
    await notifyPaymentStatus(payment.id, 'پرداخت تأیید نشد').catch(() => undefined);
    return { confirmed: false, status: 'failed', purpose };
  }

  if (result.reference) {
    await run('UPDATE payments SET provider_reference=?, updated_at=? WHERE id=?', [result.reference, nowIso(), payment.id]);
  }
  await confirmPayment(payment.id, { id: `gateway:${providerCode}`, name: `تأیید سروری ${providerCode}`, ip: input.ip }, result.reference ?? undefined);
  await recordCallback({
    paymentId: payment.id, provider: providerCode, event: 'verify', status: 'accepted',
    code: result.code, reference: result.reference, ip: input.ip,
  });
  await logEvent({
    level: 'INFO', category: 'gateway', action: 'payment.confirmed', result: 'success',
    entityType: 'payment', entityId: payment.id, transactionId: payment.id, ip: input.ip,
    message: 'پرداخت با استعلام سروری تأیید شد.',
    details: { provider: providerCode, amount: Number(payment.amount), purpose: payment.purpose },
  });
  await notifyPaymentStatus(payment.id, 'پرداخت تأیید شد').catch(() => undefined);
  return { confirmed: true, reference: result.reference, purpose };
}

/**
 * Settle an invoice from the wallet. Used both by the wallet API and by request
 * creation (`paymentMethod='wallet'`), so a rolled-back request cannot leave a
 * debit behind.
 */
export async function settleInvoiceWithWallet(
  invoiceId: string,
  customerId: string,
  actor: { id: string; name: string; ip?: string },
) {
  if (!(await getBool('wallet.enabled')) || !(await getBool('wallet.allow_wallet_payment'))) {
    throw forbidden('پرداخت از کیف پول در حال حاضر غیرفعال است.');
  }
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw notFound('فاکتور یافت نشد.');
  if (invoice.customerId !== customerId) throw forbidden('این فاکتور متعلق به شما نیست.');
  if (invoice.status === 'draft' || invoice.status === 'void') throw badRequest('این فاکتور قابل پرداخت نیست.');
  if (invoice.remaining <= 0) throw badRequest('این فاکتور تسویه شده است.');
  const wallet = await assertWalletUsable(customerId);
  if (Number(wallet.balance) < invoice.remaining) {
    throw conflict('موجودی کیف پول برای پرداخت این فاکتور کافی نیست.', [{
      field: 'wallet',
      message: `موجودی: ${wallet.balance} ریال — مبلغ لازم: ${invoice.remaining} ریال`,
      available: Number(wallet.balance),
      required: invoice.remaining,
    }]);
  }

  return tx(async () => {
    const payment = await createPayment({
      customerId, invoiceId, requestId: invoice.requestId ?? null, amount: invoice.remaining,
      method: 'wallet', status: 'pending', gateway: 'wallet',
    }, actor);
    await moveMoney({
      customerId,
      amount: invoice.remaining,
      direction: 'debit',
      type: 'purchase',
      source: 'wallet',
      paymentId: payment.id,
      invoiceId,
      requestId: invoice.requestId ?? null,
      description: `پرداخت فاکتور ${invoice.number}`,
      idempotencyKey: `wallet-pay:${payment.id}`,
    });
    const confirmed = await confirmPayment(payment.id, { id: actor.id, name: actor.name, ip: actor.ip });
    await logEvent({
      level: 'INFO', category: 'wallet', action: 'wallet.purchase', result: 'success',
      actorId: actor.id, actorName: actor.name, ip: actor.ip,
      entityType: 'payment', entityId: payment.id, transactionId: payment.id,
      message: 'هزینه خدمت از کیف پول پرداخت شد.',
      details: { invoiceId, amount: Number(invoice.remaining), requestId: invoice.requestId ?? null },
    });
    return { payment: confirmed, invoice: await getInvoice(invoiceId) };
  });
}

/** Pay an invoice from the wallet via the customer API. */
export async function payInvoiceFromWallet(invoiceId: string, customerId: string, actor: { id: string; name: string; ip?: string }) {
  const result = await settleInvoiceWithWallet(invoiceId, customerId, actor);
  await notifyPaymentStatus(result.payment.id, 'پرداخت از کیف پول انجام شد').catch(() => undefined);
  return result;
}

/** Customer-visible payment status (polling after return from the gateway). */
export async function paymentForCustomer(paymentId: string, customerId: string) {
  const payment = await one<any>('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment || payment.customer_id !== customerId) throw notFound('تراکنش یافت نشد.');
  return {
    id: payment.id,
    amount: Number(payment.amount),
    status: payment.status,
    purpose: payment.purpose,
    method: payment.method,
    gateway: payment.gateway,
    reference: payment.reference,
    providerReference: payment.provider_reference ?? null,
    createdAt: payment.created_at,
    paidAt: payment.paid_at,
  };
}

/** Recent gateway callbacks for the operator console. */
export async function listCallbacks(params: { paymentId?: string; provider?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 50) || 50));
  const where: string[] = [];
  const args: any[] = [];
  if (params.paymentId) { where.push('payment_id = ?'); args.push(params.paymentId); }
  if (params.provider) { where.push('provider = ?'); args.push(params.provider); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM payment_callbacks ${clause}`, args);
  const rows = await q<any>(
    `SELECT * FROM payment_callbacks ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((r) => ({
      id: r.id, paymentId: r.payment_id, provider: r.provider, event: r.event, status: r.status,
      code: r.code, reference: r.reference, ip: r.ip, detail: r.detail, createdAt: r.created_at,
    })),
    total: Number(total?.c ?? 0), page, pageSize,
  };
}

/** Admin "test connection" — never charges money and never returns secrets. */
export async function gatewayDiagnostics() {
  const readiness = await providerReadiness();
  const last24h = await one<any>(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS accepted,
       COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END),0) AS rejected
     FROM payment_callbacks WHERE created_at >= ?`,
    [new Date(Date.now() - 86_400_000).toISOString()],
  );
  const pending = await one<{ c: number }>("SELECT COUNT(*) AS c FROM payments WHERE purpose='invoice' AND method='online' AND status='pending'");
  return {
    ...readiness,
    providerLabel: readiness.code === 'zarinpal' ? 'زرین‌پال' : readiness.code === 'sandbox' ? 'شبیه‌ساز درگاه' : 'بدون درگاه',
    callbacks24h: {
      total: Number(last24h?.total ?? 0),
      accepted: Number(last24h?.accepted ?? 0),
      rejected: Number(last24h?.rejected ?? 0),
    },
    pendingPayments: Number(pending?.c ?? 0),
    checkedAt: nowIso(),
    secretsExposed: false,
  };
}

/** Verify a top-up amount without creating a payment (used by the UI). */
export async function validateTopUp(amountInput: unknown, customerId: string) {
  const amount = Number(amountInput);
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('مبلغ شارژ باید عدد صحیح ریالی باشد.');
  const { min, max } = await topUpLimits();
  if (amount < min) throw badRequest(`حداقل مبلغ شارژ ${min} ریال است.`);
  if (amount > max) throw badRequest(`حداکثر مبلغ شارژ در هر تراکنش ${max} ریال است.`);
  const wallet = await ensureWallet(customerId);
  return { amount, min, max, balance: Number(wallet.balance), currency: wallet.currency };
}

export { creditFromGateway };
