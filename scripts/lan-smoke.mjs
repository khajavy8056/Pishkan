#!/usr/bin/env node
/**
 * Real multi-device LAN smoke test.
 *
 * Simulates the "Windows PC + customer phone + admin on a second device"
 * scenario against a *running* server bound to 0.0.0.0, over a non-loopback
 * address of the machine. It does not use mocks: every check is an HTTP call to
 * the real API, and the wallet/payment assertions read the real database state
 * through the API.
 *
 *   LAN_IP=192.168.1.24 PORT=3000 node scripts/lan-smoke.mjs
 *   ADMIN_USER=admin ADMIN_PASS='…' LAN_IP=… node scripts/lan-smoke.mjs
 *
 * Exit code 0 = every check passed.
 */
const LAN_IP = process.env.LAN_IP ?? '';
const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS ?? '';
const CUSTOMER_PASS = process.env.CUSTOMER_PASS ?? 'Customer#12345';

if (!LAN_IP) {
  console.error('LAN_IP is required (a private IPv4 address of this machine, e.g. 192.168.1.24).');
  process.exit(2);
}
if (!ADMIN_PASS) {
  console.error('ADMIN_PASS is required (do not hardcode credentials in the repository).');
  process.exit(2);
}

const BASE = `http://${LAN_IP}:${PORT}`;
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

async function call(cookie, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const type = res.headers.get('content-type') ?? '';
  const json = type.includes('json') ? await res.json().catch(() => null) : null;
  return { status: res.status, json, headers: res.headers, setCookie: res.headers.getSetCookie?.() ?? [] };
}

const cookieOf = (res) => res.setCookie.map((value) => value.split(';')[0]).join('; ');

async function main() {
  const loopback = await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => null);
  check('سرور روی 0.0.0.0 گوش می‌دهد و از loopback پاسخ می‌دهد', loopback?.status === 200, `status=${loopback?.status}`);

  const adminLogin = await call(null, 'POST', '/api/auth/login', { identifier: ADMIN_USER, password: ADMIN_PASS });
  check('ورود مدیر از دستگاه دوم در شبکه محلی', adminLogin.status === 200, `status=${adminLogin.status}`);
  const admin = cookieOf(adminLogin);
  if (!admin) return finish();

  const mobile = `0936${Math.floor(1000000 + Math.random() * 8999999)}`;
  await call(null, 'POST', '/api/auth/register', { mobile, password: CUSTOMER_PASS, fullName: 'مشتری آزمون شبکه' });
  const customerLogin = await call(null, 'POST', '/api/auth/login', { identifier: mobile, password: CUSTOMER_PASS });
  check('ورود مشتری (گوشی) از شبکه محلی', customerLogin.status === 200, `status=${customerLogin.status}`);
  const customer = cookieOf(customerLogin);
  await call(customer, 'PATCH', '/api/auth/profile', {
    firstName: 'مشتری', lastName: 'شبکه', nationalId: '0013546295', cityId: 'tehran',
  });

  const settings = await call(admin, 'PUT', '/api/settings/admin', {
    values: {
      'accounting.online_payment_enabled': true,
      'accounting.gateway': 'sandbox',
      'accounting.gateway_sandbox': true,
      'wallet.enabled': true,
      'wallet.allow_wallet_payment': true,
    },
    confirmCritical: true,
  });
  check('تنظیم درگاه و کیف پول از دستگاه مدیر', settings.status === 200, `updated=${settings.json?.data?.updated?.length}`);

  check('مشتری از گوشی به مرکز پایش دسترسی ندارد',
    (await call(customer, 'GET', '/api/monitoring/health')).status === 403);
  check('مشتری از گوشی به کیف پول مدیریتی دسترسی ندارد',
    (await call(customer, 'GET', '/api/wallet/admin/summary')).status === 403);
  check('درخواست بدون احراز هویت از شبکه رد می‌شود',
    (await fetch(`${BASE}/api/wallet/my`)).status === 401);

  const topup = await call(customer, 'POST', '/api/wallet/my/topup', { amount: 300000 });
  check('شروع شارژ کیف پول از گوشی', topup.status === 200, `paymentId=${topup.json?.data?.paymentId}`);
  const paymentUrl = topup.json?.data?.paymentUrl ?? '';
  const token = new URL(paymentUrl, BASE).searchParams.get('token');
  const paymentId = new URL(paymentUrl, BASE).pathname.split('/').pop();
  const finished = await fetch(`${BASE}/api/payments/sandbox/${paymentId}/finish`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, decision: 'paid' }).toString(),
    redirect: 'manual',
  });
  check('تأیید پرداخت در شبیه‌ساز درگاه از گوشی', finished.status === 303, `location=${finished.headers.get('location')}`);
  const wallet = await call(customer, 'GET', '/api/wallet/my');
  check('موجودی کیف پول پس از شارژ', wallet.json?.data?.balance === 300000, `balance=${wallet.json?.data?.balance}`);

  const service = await call(admin, 'POST', '/api/catalog/services', {
    title: 'خدمت آزمون شبکه محلی',
    slug: `lan-smoke-${Date.now()}`,
    baseFee: 120000,
    paymentMethods: ['wallet'],
    form: [], documents: [], workflow: [],
  });
  const created = await call(customer, 'POST', '/api/requests', {
    serviceId: service.json?.data?.id, formData: {}, paymentMethod: 'wallet',
  });
  check('ثبت درخواست و پرداخت از کیف پول روی گوشی', created.status === 201,
    `status=${created.status} payment=${created.json?.data?.paymentStatus}`);
  const afterPay = await call(customer, 'GET', '/api/wallet/my');
  check('کسر هزینه خدمت از کیف پول گوشی', afterPay.json?.data?.balance === 180000, `balance=${afterPay.json?.data?.balance}`);

  const requests = await call(admin, 'GET', '/api/requests?pageSize=5');
  check('مدیر درخواست گوشی را از دستگاه دوم می‌بیند',
    requests.status === 200 && (requests.json?.meta?.total ?? 0) >= 1, `total=${requests.json?.meta?.total}`);
  const health = await call(admin, 'GET', '/api/monitoring/health');
  check('سلامت سامانه از دستگاه مدیر', health.status === 200, `status=${health.json?.data?.status}`);
  const overview = await call(admin, 'GET', '/api/monitoring/overview');
  check('نشست‌های آنلاین در پایش', (overview.json?.data?.sessions?.active ?? 0) >= 2, `active=${overview.json?.data?.sessions?.active}`);
  const lan = await call(admin, 'GET', '/api/system/lan');
  check('اطلاعات شبکه محلی بدون افشای رمز',
    lan.status === 200 && !/password|token|secret/i.test(JSON.stringify(lan.json)), `host=${lan.json?.data?.host}`);

  // A removed payment method must be rejected from any device.
  const cash = await call(customer, 'POST', '/api/requests', { serviceId: service.json?.data?.id, formData: {}, paymentMethod: 'cash' });
  check('روش پرداخت حذف‌شده (نقدی) از گوشی رد می‌شود', cash.status === 400, `status=${cash.status}`);

  finish();
}

function finish() {
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} LAN checks passed via ${BASE}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('LAN smoke test crashed:', error?.message ?? error);
  process.exit(3);
});
