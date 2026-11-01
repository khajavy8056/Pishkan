/**
 * Backwards-compatible Zarinpal entry points.
 *
 * The real work lives in `modules/payments/*` so that every provider (Zarinpal,
 * internal sandbox) follows one verified, idempotent flow. These wrappers exist
 * because the admin UI and the historical test suite use them directly.
 */
import { one } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../http/errors.js';
import { providerReadiness, selectedProvider } from '../payments/providers.js';
import { handleGatewayCallback, startInvoicePayment } from '../payments/service.js';

export async function startZarinpal(invoiceId: string, customerId: string) {
  if (!(await providerReadiness()).configured) throw badRequest('درگاه پرداخت پیکربندی نشده است.');
  const provider = await selectedProvider();
  if (!provider || provider.code !== 'zarinpal') throw forbidden('درگاه زرین‌پال فعال نیست.');
  return startInvoicePayment(invoiceId, customerId, { id: customerId, name: 'مشتری' });
}

export async function verifyZarinpal(paymentId: string, authority: string, status: string) {
  const payment = await one<any>("SELECT * FROM payments WHERE id=? AND gateway='zarinpal'", [paymentId]);
  if (!payment || !authority || payment.gateway_authority !== authority) {
    throw badRequest('شناسه پرداخت با درخواست تطابق ندارد.');
  }
  const result = await handleGatewayCallback({
    provider: 'zarinpal',
    paymentId,
    params: { authority, status, sandbox: String(Number(payment.gateway_sandbox)) },
  });
  return result.confirmed
    ? { confirmed: true, reference: result.reference }
    : { confirmed: false };
}

export async function findPayment(paymentId: string) {
  const payment = await one<any>('SELECT * FROM payments WHERE id=?', [paymentId]);
  if (!payment) throw notFound('تراکنش یافت نشد.');
  return payment;
}
