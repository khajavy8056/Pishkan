import { one } from '../../db/index.js';
import { notifyUser } from './service.js';

/** Build notices from authoritative payment rows; never trust callback text or amounts. */
export async function notifyPaymentStatus(paymentId: string, statusLabel: string): Promise<void> {
  const payment = await one<any>(
    `SELECT p.id, p.customer_id, p.invoice_id, p.amount, p.status, i.number AS invoice_number
     FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ?`,
    [paymentId],
  );
  if (!payment) return;
  await notifyUser(payment.customer_id, {
    title: payment.status === 'confirmed' ? 'پرداخت با موفقیت ثبت شد' : 'وضعیت پرداخت شما تغییر کرد',
    body: `${payment.invoice_number ? `فاکتور ${payment.invoice_number} — ` : ''}${Number(payment.amount).toLocaleString('fa-IR')} ریال — ${statusLabel}`,
    kind: payment.status === 'confirmed' ? 'success' : payment.status === 'failed' ? 'warning' : 'info',
    link: '/app/payments',
    idempotencyKey: `payment:${payment.id}:${payment.status}`,
    sms: { eventCode: 'payment_status', variables: { invoice_number: payment.invoice_number ?? 'بدون شماره فاکتور', payment_status: statusLabel } },
  });
}
