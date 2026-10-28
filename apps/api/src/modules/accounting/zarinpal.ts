import { env } from '../../env.js';
import { one, run, tx, nowIso } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../http/errors.js';
import { getBool, getString, getSecret } from '../settings/service.js';
import { createPayment, confirmPayment, getInvoice } from './service.js';
import { notifyPaymentStatus } from '../notifications/events.js';

function base(sandbox: boolean) { return sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com'; }
async function call(sandbox: boolean, operation: 'request'|'verify', payload: object) {
 let response: Response;
 try { response = await fetch(`${base(sandbox)}/pg/v4/payment/${operation}.json`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),redirect:'error'}); }
 catch { throw badRequest('درگاه پاسخ نداد؛ وضعیت را بررسی و دوباره تلاش کنید.'); }
 if (!response.ok) throw badRequest('درگاه پرداخت پاسخ معتبر نداد.');
 const result = await response.json() as any;
 if (!result?.data || typeof result.data.code !== 'number') throw badRequest('پاسخ درگاه معتبر نیست.');
 return result.data;
}
async function configuration() {
 if (!(await getBool('accounting.online_payment_enabled')) || await getString('accounting.gateway') !== 'zarinpal') throw forbidden('درگاه زرین‌پال فعال نیست.');
 const merchant = await getSecret('accounting.gateway_merchant_id');
 if (!/^[0-9a-f-]{36}$/i.test(merchant)) throw badRequest('شناسه پذیرنده زرین‌پال تنظیم نشده یا معتبر نیست.');
 const sandbox = await getBool('accounting.gateway_sandbox');
 const url = new URL(env.apiUrl);
 if (!sandbox && (url.protocol !== 'https:' || ['localhost','127.0.0.1'].includes(url.hostname))) throw badRequest('درگاه واقعی به API_URL عمومی و HTTPS نیاز دارد.');
 return {merchant,sandbox};
}
export async function startZarinpal(invoiceId: string, customerId: string) {
 const config = await configuration();
 return tx(async () => {
  await run('UPDATE invoices SET updated_at=updated_at WHERE id=?',[invoiceId]);
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw notFound('فاکتور یافت نشد.');
  if (invoice.customerId !== customerId) throw forbidden();
  if (invoice.status === 'draft' || invoice.status === 'void' || invoice.remaining <= 0) throw badRequest('این فاکتور قابل پرداخت نیست.');
  let payment = await one<any>("SELECT * FROM payments WHERE invoice_id=? AND method='online' AND status='pending' AND gateway='zarinpal' ORDER BY created_at DESC LIMIT 1",[invoiceId]);
  if (payment?.gateway_authority) return {paymentId:payment.id,paymentUrl:`${base(Boolean(payment.gateway_sandbox))}/pg/StartPay/${encodeURIComponent(payment.gateway_authority)}`};
  if (!payment) {
   const created = await createPayment({invoiceId,customerId,amount:invoice.remaining,method:'online',gateway:'zarinpal'},{id:customerId,name:'مشتری'});
   payment = await one<any>('SELECT * FROM payments WHERE id=?',[created.id]);
  }
  const callback = new URL('/api/accounting/gateway/zarinpal',env.apiUrl);
  callback.searchParams.set('paymentId',payment.id);
  const data = await call(config.sandbox,'request',{merchant_id:config.merchant,amount:Number(payment.amount),currency:'IRR',callback_url:callback.toString(),description:`فاکتور ${invoice.number}`});
  if (data.code !== 100 || !/^A[0-9a-z]{20,64}$/i.test(data.authority ?? '')) throw badRequest('درخواست پرداخت توسط درگاه پذیرفته نشد.');
  await run('UPDATE payments SET gateway_authority=?,gateway_sandbox=?,updated_at=? WHERE id=?',[data.authority,Number(config.sandbox),nowIso(),payment.id]);
  return {paymentId:payment.id,paymentUrl:`${base(config.sandbox)}/pg/StartPay/${encodeURIComponent(data.authority)}`};
 });
}
export async function verifyZarinpal(paymentId: string, authority: string, status: string) {
 const payment = await one<any>("SELECT * FROM payments WHERE id=? AND gateway='zarinpal'",[paymentId]);
 if (!payment || !authority || payment.gateway_authority !== authority) throw badRequest('شناسه پرداخت با درخواست تطابق ندارد.');
 if (payment.status === 'confirmed') {
  await notifyPaymentStatus(paymentId,'پرداخت تأیید شد').catch(()=>undefined);
  return {confirmed:true,reference:payment.reference};
 }
 if (payment.status !== 'pending' || status !== 'OK') return {confirmed:false};
 const merchant = await getSecret('accounting.gateway_merchant_id');
 if (!merchant) throw badRequest('شناسه پذیرنده تنظیم نشده است.');
 const data = await call(Boolean(payment.gateway_sandbox),'verify',{merchant_id:merchant,amount:Number(payment.amount),authority});
 if (![100,101].includes(data.code) || !data.ref_id) throw badRequest('تأیید سروری پرداخت موفق نبود.');
 await confirmPayment(paymentId,{id:'gateway:zarinpal',name:'تأیید سروری زرین‌پال'},String(data.ref_id));
 await notifyPaymentStatus(paymentId,'پرداخت تأیید شد').catch(()=>undefined);
 return {confirmed:true,reference:String(data.ref_id)};
}
