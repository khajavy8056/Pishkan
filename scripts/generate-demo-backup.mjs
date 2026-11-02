#!/usr/bin/env node
/**
 * Generate a restorable Pishkan demo backup that looks like 1–2 months of
 * real office work.
 *
 *   npm run build --workspace apps/api
 *   node --experimental-sqlite scripts/generate-demo-backup.mjs [--out demo-backup]
 *
 * What it produces (in the output folder):
 *   pishkan-demo-60-days.sqlite        — the file to pick in the Windows
 *                                        Manager "restore" dialog (a clean
 *                                        VACUUM INTO snapshot, the same
 *                                        shape the Manager itself writes).
 *   pishkan-demo-60-days-uploads.tar.gz— companion uploads archive (the demo
 *                                        is intentionally self-contained and
 *                                        needs no uploaded binaries).
 *   pishkan-demo-60-days-summary.json  — counts, demo logins, checksums.
 *   SHA256SUMS.txt
 *
 * The scenario is executed through the real HTTP API against an isolated
 * throw-away database, so invoices, payments, commission ledgers, salary
 * accruals, withdrawals, tickets and blog rows are all produced by the
 * program's own business logic. Only timestamps are rewritten afterwards
 * (directly in the isolated SQLite file) to spread the activity over the
 * last ~60 days.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true');
}
const OUT_DIR = path.resolve(ROOT, args.get('out') ?? 'demo-backup');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-demo-'));
const DB_FILE = path.join(WORK, 'pishkan.db');
const UPLOAD_DIR = path.join(WORK, 'uploads');
const BACKUP_DIR = path.join(WORK, 'backups');
const LOG_FILE = path.join(WORK, 'server.log');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const ADMIN = { username: 'admin', password: 'Admin@12345', fullName: 'مدیر کل دفتر' };
const STAFF_PASSWORD = 'Demo@12345';
const CUSTOMER_PASSWORD = 'Demo@12345';

const DAY = 86_400_000;
const NOW = new Date();

/* ------------------------------ tiny utils ------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261103);
const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log('[demo-backup]', ...m);

/** A moment `days` ago at a Tehran wall-clock time (stored as UTC ISO). */
function atDaysAgo(days, tehranHour = 10, minute = 0) {
  const d = new Date(NOW.getTime() - days * DAY);
  const utcMinutes = tehranHour * 60 + minute - 210; // Asia/Tehran = UTC+03:30
  d.setUTCHours(Math.floor(utcMinutes / 60), ((utcMinutes % 60) + 60) % 60, 0, 0);
  if (d.getTime() > NOW.getTime() - 60_000) return new Date(NOW.getTime() - 60_000);
  return d;
}
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const addHours = (d, h) => new Date(d.getTime() + h * 3_600_000);
const clampPast = (d) => (d.getTime() > NOW.getTime() - 30_000 ? new Date(NOW.getTime() - 30_000) : d);
const iso = (d) => d.toISOString();
const dateOnly = (d) => d.toISOString().slice(0, 10);
function monthStr(offset = 0) {
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const monthFirst = (offset = 0) => `${monthStr(offset)}-01`;
function monthEndDate(month) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 14, 30, 0));
}
function nationalId(i) {
  const base = String(100000000 + i * 7919).slice(-9).padStart(9, '0');
  let s = 0;
  for (let k = 0; k < 9; k += 1) s += Number(base[k]) * (10 - k);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
}
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/* ------------------------------- HTTP client ---------------------------- */

let base = '';

class Client {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
  }

  async req(method, p, { body, form, headers = {}, expect = [200, 201] } = {}) {
    const h = { ...headers };
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    const res = await fetch(base + p, { method, headers: h, body: payload, redirect: 'manual' });
    const sets = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const c of sets) {
      const pair = c.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* html/redirect */ }
    if (!expect.includes(res.status)) {
      throw new Error(`${this.label} ${method} ${p} -> ${res.status}: ${text.slice(0, 1500)}`);
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  async data(method, p, opts = {}) {
    const r = await this.req(method, p, opts);
    if (r.json && r.json.ok === false) throw new Error(`${this.label} ${method} ${p}: ${JSON.stringify(r.json).slice(0, 800)}`);
    return r.json?.data;
  }

  get(p) { return this.data('GET', p); }
  post(p, body, opts = {}) { return this.data('POST', p, { body, ...opts }); }
  patch(p, body) { return this.data('PATCH', p, { body }); }
  put(p, body) { return this.data('PUT', p, { body }); }
}

const anon = new Client('anon');

async function finishSandbox(paymentUrl, decision = 'paid') {
  const u = new URL(paymentUrl, 'http://localhost');
  const id = u.pathname.split('/').filter(Boolean).pop();
  const token = u.searchParams.get('token') ?? '';
  await anon.req('POST', `/api/payments/sandbox/${id}/finish`, {
    form: { token, decision }, expect: [200, 302, 303],
  });
  return id;
}

/* ------------------------------ API lifecycle --------------------------- */

let child = null;
let logStream = null;

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function startApi(port) {
  const entry = path.join(ROOT, 'apps/api/dist/index.js');
  if (!fs.existsSync(entry)) throw new Error('apps/api/dist/index.js missing — run: npm run build --workspace apps/api');
  logStream = fs.openSync(LOG_FILE, 'a');
  fs.writeSync(logStream, `\n--- boot ${new Date().toISOString()} ---\n`);
  child = spawn(process.execPath, ['--experimental-sqlite', entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      PISHKAN_ENV_FILE: path.join(WORK, 'no-env-file'),
      NODE_ENV: 'development',
      DB_DRIVER: 'sqlite',
      SQLITE_FILE: DB_FILE,
      UPLOAD_DIR,
      BACKUP_DIR,
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_URL: `http://127.0.0.1:${port}`,
      API_URL: `http://127.0.0.1:${port}`,
      CORS_ORIGINS: `http://127.0.0.1:${port}`,
      APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      BOOTSTRAP_ADMIN_USERNAME: ADMIN.username,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
      BOOTSTRAP_ADMIN_NAME: ADMIN.fullName,
      BOOTSTRAP_ADMIN_MOBILE: '09120000000',
      RATE_LIMIT_PER_MINUTE: '1000000',
      AUTH_LOGIN_RATE_LIMIT: '100000',
      AUTH_REGISTER_RATE_LIMIT: '100000',
    },
    stdio: ['ignore', logStream, logStream],
  });
  base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`API exited early (${child.exitCode}); see ${LOG_FILE}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) { await r.text(); break; }
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`API did not come up; see ${LOG_FILE}`);
    await sleep(400);
  }
  log(`API up on ${base} (work dir ${WORK})`);
}

async function stopApi() {
  if (!child) return;
  const done = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  const ok = await Promise.race([done.then(() => true), sleep(15_000).then(() => false)]);
  if (!ok) { child.kill('SIGKILL'); await done; }
  child = null;
  if (logStream !== null) { try { fs.closeSync(logStream); } catch { /* noop */ } logStream = null; }
  log('API stopped');
}

/** Run fn(db) inside a transaction on the (stopped) work database. */
function withDb(fn) {
  const db = new DatabaseSync(DB_FILE);
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('BEGIN');
    const out = fn(db);
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    db.close();
  }
}
const tableCols = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
const tableExists = (db, t) => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t));

/* ------------------------------- demo data ------------------------------ */

const STAFF_DEFS = [
  { username: 'manager', fullName: 'سارا محمدی', roleCode: 'manager', position: 'مدیر عملیات', contract: { kind: 'monthly', monthlyAmount: 42_000_000 } },
  { username: 'accounting', fullName: 'رضا کریمی', roleCode: 'accountant', position: 'حسابدار ارشد', contract: { kind: 'monthly', monthlyAmount: 36_000_000 } },
  { username: 'fixed1', fullName: 'مریم حسینی', roleCode: 'operator', position: 'کارشناس پذیرش و خودرو', contract: { kind: 'monthly', monthlyAmount: 28_000_000 } },
  { username: 'fixed2', fullName: 'حسین رضایی', roleCode: 'service_expert', position: 'کارشناس ثبت شرکت و مجوزها', contract: { kind: 'monthly', monthlyAmount: 32_000_000 } },
  { username: 'fixed3', fullName: 'فاطمه احمدی', roleCode: 'operator', position: 'کارشناس خدمات بانکی', contract: { kind: 'monthly', monthlyAmount: 26_000_000 } },
  { username: 'fixed4', fullName: 'علی محمدی', roleCode: 'service_expert', position: 'کارشناس بیمه و مالیات', contract: { kind: 'monthly', monthlyAmount: 30_000_000 } },
  { username: 'percent1', fullName: 'زهرا موسوی', roleCode: 'service_expert', position: 'کارشناس ارشد خودرو', contract: { kind: 'commission', commissionPercent: 12, settlementPeriod: 'daily', monthlyTarget: 4_500_000 } },
  { username: 'percent2', fullName: 'محمد صادقی', roleCode: 'service_expert', position: 'کارشناس مجوزها و اصناف', contract: { kind: 'commission', commissionPercent: 12, settlementPeriod: 'weekly', monthlyTarget: 5_000_000 }, percentAfter20Days: 15 },
  { username: 'percent3', fullName: 'نگار احمدی', roleCode: 'service_expert', position: 'کارشناس بانکی و تسهیلات', contract: { kind: 'commission', commissionPercent: 10, settlementPeriod: 'monthly', monthlyTarget: 4_000_000 } },
  { username: 'percent4', fullName: 'امیر کاظمی', roleCode: 'service_expert', position: 'کارشناس مالیاتی', contract: { kind: 'commission', commissionPercent: 18, settlementPeriod: 'daily', monthlyTarget: 6_000_000 } },
  { username: 'content', fullName: 'لیلا احمدی', roleCode: 'content_manager', position: 'مدیر محتوا', contract: { kind: 'monthly', monthlyAmount: 24_000_000 } },
];
const WORKER_ORDER = ['percent1', 'fixed1', 'percent2', 'fixed2', 'percent3', 'fixed3', 'percent4', 'fixed4'];

const CUSTOMER_NAMES = [
  ['رضا', 'محمودی'], ['زهرا', 'کاظمی'], ['علی', 'نجفی'], ['فاطمه', 'مرادی'], ['حسین', 'صادقی'], ['مریم', 'عزیزی'],
  ['محمد', 'جعفری'], ['سکینه', 'هاشمی'], ['حسن', 'رحیمی'], ['خدیجه', 'یوسفی'], ['مهدی', 'کریمی'], ['زینب', 'احمدی'],
  ['سعید', 'حسینی'], ['معصومه', 'محمدی'], ['جواد', 'رضایی'], ['طاهره', 'علیزاده'], ['کاظم', 'نوری'], ['رقیه', 'اسدی'],
  ['مجتبی', 'فرهادی'], ['الهام', 'سلطانی'], ['امید', 'زارعی'], ['شبنم', 'قاسمی'], ['وحید', 'باقری'], ['نسترن', 'حیدری'],
  ['بهروز', 'شریفی'], ['آزیتا', 'موسوی'], ['فرهاد', 'اکبری'], ['لیلا', 'رستمی'], ['دانیال', 'کرمی'], ['شیما', 'عباسی'],
  ['پیمان', 'صالحی'], ['هانیه', 'آقایی'], ['سروش', 'امیری'], ['پرستو', 'نادری'], ['کیان', 'میرزایی'], ['درنا', 'توکلی'],
];

const workflow = (follow = false) => [
  { title: 'بررسی اولیه و تماس با مشتری', description: '', kind: 'action' },
  { title: 'تکمیل اطلاعات و مدارک توسط مشتری', description: '', kind: 'waiting_customer' },
  { title: 'ثبت و انجام فرایند در سامانه مرجع', description: '', kind: 'action' },
  { title: 'انتظار پاسخ و صدور نتیجه از سازمان مربوطه', description: '', kind: 'waiting_organization' },
  ...(follow ? [{ title: 'پیگیری نتیجه و رفع نقص احتمالی', description: '', kind: 'followup' }] : []),
  { title: 'آماده‌سازی و تحویل نتیجه به مشتری', description: '', kind: 'delivery' },
];

const SERVICE_DEFS = [
  { slug: 'demo-vehicle-plate', title: 'پیگیری تعویض پلاک و فک رهن خودرو', categorySlug: 'vehicle-services', fee: 3_800_000, days: 4, icon: 'car-front', external: true, urgent: true },
  { slug: 'demo-fuel-card', title: 'درخواست کارت سوخت المثنی و پیگیری صدور', categorySlug: 'vehicle-services', fee: 1_200_000, days: 7, icon: 'fuel' },
  { slug: 'demo-marriage-loan', title: 'ثبت‌نام و پیگیری وام ازدواج', categorySlug: 'banking-services', fee: 4_500_000, days: 10, icon: 'landmark', follow: true },
  { slug: 'demo-business-license', title: 'اخذ و تمدید پروانه کسب صنفی', categorySlug: 'business-licenses', fee: 5_500_000, days: 14, icon: 'store', follow: true, external: true },
  { slug: 'demo-company', title: 'ثبت شرکت و تغییرات ثبتی', categorySlug: 'companies-institutions', fee: 7_500_000, days: 12, icon: 'building-2', follow: true },
  { slug: 'demo-tax', title: 'تنظیم و ارسال اظهارنامه مالیاتی مشاغل', categorySlug: 'tax-services', fee: 3_200_000, days: 5, icon: 'calculator', urgent: true },
  { slug: 'demo-insurance', title: 'پیگیری سوابق و اعتراض بیمه تأمین اجتماعی', categorySlug: 'insurance-health', fee: 1_500_000, days: 8, icon: 'shield-plus' },
  { slug: 'demo-subsidy', title: 'اصلاح خانوار و پیگیری یارانه', categorySlug: 'subsidy-welfare', fee: 900_000, days: 6, icon: 'hand-coins' },
  { slug: 'demo-passport', title: 'درخواست گذرنامه و پیگیری صدور', categorySlug: 'police-services', fee: 2_800_000, days: 9, icon: 'shield', external: true },
  { slug: 'demo-university', title: 'ثبت‌نام دانشگاه و انتخاب رشته', categorySlug: 'university-students', fee: 1_800_000, days: 3, icon: 'book-open', urgent: true },
  { slug: 'demo-housing-loan', title: 'ثبت درخواست وام ودیعه مسکن', categorySlug: 'housing-land', fee: 4_200_000, days: 11, icon: 'house', follow: true },
  { slug: 'demo-judicial', title: 'خدمات الکترونیک قضایی و ثنا', categorySlug: 'judicial-services', fee: 2_400_000, days: 4, icon: 'scale' },
];

const STEP_NOTES = [
  'مدارک اولیه بررسی شد؛ ادامه فرایند در حال انجام است.',
  'ثبت در سامانه مرجع انجام شد و کد رهگیری دریافت گردید.',
  'پرونده برای صدور نتیجه به سازمان مربوطه ارسال شده است.',
  'پیگیری تلفنی انجام شد؛ پاسخ سازمان در انتظار است.',
];
const DELIVERY_SUMMARIES = [
  'خدمت با موفقیت انجام و نتیجه نهایی به مشتری تحویل شد؛ کد رهگیری در پرونده ثبت است.',
  'کار تکمیل و مستندات نتیجه آماده تحویل در دفتر است؛ لطفاً برای دریافت اصل مدارک مراجعه کنید.',
  'نتیجه نهایی صادر شد و جزئیات آن در همین پرونده قابل مشاهده است.',
];

/* ------------------------------ global state ---------------------------- */

const S = {
  admin: null,
  staff: new Map(), // username -> {def,id,client,contractId}
  staffById: new Map(),
  customers: [], // {i,first,last,mobile,id,client,regDaysAgo,weight,used}
  services: [], // created DTOs + def
  serviceBySlug: new Map(),
  requestPlans: new Map(), // requestId -> plan dates & ids
  walletTopups: [], // {customerId,paymentId,date,failed}
  walletCredits: [], // {transactionId,customerId,date}
  manualInvoices: [], // {invoiceId,paymentId,customerId,createdAt,paidAt}
  expenses: [], // {id,spentOn}
  withdrawals: new Map(), // id -> dates
  tickets: new Map(), // id -> dates
  threads: new Map(), // id -> dates
  blogPosts: new Map(), // id -> dates
  blogComments: new Map(), // id -> dates
  blogSubscribers: [], // {email,date}
  customStandalone: [], // {intakeId,offerId,createdAt,updatedAt,expiresAt,decidedAt}
  refundedPaymentId: null,
};

const settlementDaysOf = (staff) => (
  staff?.def.contract.settlementPeriod === 'monthly' ? 30
    : staff?.def.contract.settlementPeriod === 'weekly' ? 7 : 1
);

/* ----------------------------- request specs ---------------------------- */

function buildSpecs() {
  const specs = [];
  const add = (outcome, ages, paidFlags = null, extra = {}) => {
    ages.forEach((age, i) => specs.push({
      outcome, age, paid: paidFlags ? Boolean(paidFlags[i]) : false, ...extra,
    }));
  };
  // 52 completed cases spread across the last two months.
  const completedAges = Array.from({ length: 52 }, (_, i) => 58 - Math.floor((i * 56) / 51));
  add('completed', completedAges, completedAges.map(() => true));
  add('action', [20, 16, 13, 10, 8, 6, 4, 2], [1, 1, 1, 0, 1, 0, 1, 1]);
  add('waiting_customer', [15, 12, 9, 7, 5, 3], [1, 0, 1, 1, 0, 1]);
  add('waiting_org', [18, 14, 11, 7, 4], [1, 1, 0, 1, 1]);
  add('followup', [13, 8, 5], [1, 1, 0]);
  add('assigned_new', [6, 5, 4, 3, 2, 1, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1]);
  add('queue', [5, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  specs.push({ outcome: 'cancelled_refunded', age: 40, paid: true });
  add('cancelled', [30, 22, 12, 6]);
  add('rejected', [28, 9]);

  // Oldest first so tracking codes / invoice numbers grow with time.
  specs.sort((a, b) => b.age - a.age);

  const workers = WORKER_ORDER;
  let w = 0;
  let svc = 0;
  let followSvc = 0;
  specs.forEach((spec, i) => {
    spec.index = i;
    const assigned = !['queue', 'rejected'].includes(spec.outcome)
      && !(spec.outcome === 'cancelled' && i % 2 === 0);
    spec.worker = assigned || spec.outcome === 'cancelled_refunded' ? workers[w++ % workers.length] : null;
    if (spec.outcome === 'followup') {
      const list = SERVICE_DEFS.filter((s) => s.follow);
      spec.serviceDef = list[followSvc++ % list.length];
    } else {
      spec.serviceDef = SERVICE_DEFS[svc++ % SERVICE_DEFS.length];
    }
    spec.priority = spec.serviceDef.urgent && i % 11 === 0 ? 'high' : 'normal';
    spec.discountCode = i % 13 === 0 ? 'WELCOME10' : i % 13 === 5 ? 'OFFICE15'
      : i % 13 === 9 && spec.serviceDef.fee >= 2_000_000 ? 'FIXED200' : undefined;
    spec.assignMode = i % 5 === 3 ? 'admin' : i % 5 === 4 ? 'manager' : 'claim';
    spec.external = spec.serviceDef.external
      && ['completed', 'action', 'waiting_customer'].includes(spec.outcome) && i % 3 === 0;
    spec.externalPaid = spec.outcome === 'completed' || i % 2 === 0;
    spec.split = spec.outcome === 'completed' && i % 17 === 4;
    spec.conflictAttempt = ['completed', 'action'].includes(spec.outcome) && i % 23 === 6;
    spec.declineBy = spec.outcome === 'queue' && i % 4 === 1 ? workers[(i + 2) % workers.length] : null;
    spec.handoff = spec.outcome === 'waiting_org' && i % 5 === 2 ? 'management'
      : spec.outcome === 'action' && i % 7 === 3 ? 'accounting' : null;
  });
  // Two cases run through the custom-service flow instead of the catalogue.
  const customDone = specs.find((s) => s.outcome === 'completed' && s.age <= 45 && s.age >= 35 && !s.split && !s.external
    && !['fixed1', 'fixed3'].includes(s.worker)); // definer needs services.create (service_expert)
  if (customDone) customDone.customMode = 'creator';
  const customPool = specs.find((s) => s.outcome === 'queue' && !s.paid && !s.declineBy);
  if (customPool) customPool.customMode = 'pool';
  return specs;
}

function assignCustomers(specs) {
  const customers = S.customers;
  specs.forEach((spec, idx) => {
    const eligible = customers.filter((c) => c.regDaysAgo >= spec.age + 1);
    const pool = eligible.length ? eligible : customers;
    const unused = pool.filter((c) => c.used === 0);
    const remaining = specs.length - idx;
    let chosen;
    if (unused.length && (remaining <= unused.length + 6 || rng() < 0.45)) {
      chosen = unused.reduce((a, b) => (b.weight - b.used > a.weight - a.used ? b : a));
    } else {
      // Weighted by loyalty tier, damped by how often already used.
      let best = null; let bestScore = -1;
      for (const c of pool) {
        const score = (c.weight * (0.5 + rng())) / (1 + c.used);
        if (score > bestScore) { bestScore = score; best = c; }
      }
      chosen = best;
    }
    chosen.used += 1;
    spec.customer = chosen;
  });
}

/* ------------------------------ phase: setup ---------------------------- */

async function loginStaff(username, password, label) {
  const c = new Client(label ?? username);
  await c.post('/api/auth/staff/login', { identifier: username, password });
  return c;
}

async function setupSettings(admin) {
  await admin.put('/api/settings/admin', {
    confirmCritical: true,
    values: {
      'site.name': 'پیشخوان آرتا',
      'office.phone': '061-32220000',
      'office.mobile': '09160000000',
      'office.email': 'info@example.ir',
      'office.address': 'خوزستان، اندیمشک، خیابان امام، پلاک ۱۲',
      'office.working_hours': 'شنبه تا چهارشنبه ۸:۰۰ تا ۱۶:۰۰، پنجشنبه ۸:۰۰ تا ۱۲:۰۰',
      'auth.customer_password_enabled': true,
      'auth.customer_registration_open': true,
      'auth.customer_otp_enabled': false,
      'sms.enabled': true,
      'sms.provider': 'console',
      'sms.otp_template_id': '',
      'accounting.online_payment_enabled': true,
      'accounting.gateway': 'sandbox',
      'accounting.gateway_sandbox': true,
      'accounting.min_online_payment': 1000,
      'accounting.allow_refund': true,
      'wallet.enabled': true,
      'wallet.allow_wallet_payment': true,
      'wallet.min_topup': 10000,
      'wallet.max_topup': 100000000,
      'wallet.max_balance': 300000000,
      'wallet.admin_credit_max': 100000000,
      'services.auto_assign': false,
      'services.auto_assign_strategy': 'queue',
      'services.max_active_cases_per_staff': 60,
      'workforce.force_assign_enabled': false,
      'workforce.auto_assign_on_shift': false,
      'workforce.attendance_required': false,
      'workforce.allow_self_checkin': true,
      'payroll.commission_basis': 'net_of_tax',
      'payroll.withdrawal_enabled': true,
      'payroll.min_withdrawal': 100000,
      'payroll.settlement_period': 'daily',
      'backup.include_uploads': true,
      'support.enabled': true,
    },
  });
  log('settings applied');
}

async function setupServices(admin) {
  const cats = await admin.get('/api/catalog/admin/categories');
  const bySlug = new Map((Array.isArray(cats) ? cats : []).map((c) => [c.slug, c.id]));
  for (const def of SERVICE_DEFS) {
    const created = await admin.post('/api/catalog/services', {
      title: def.title,
      slug: def.slug,
      categoryId: bySlug.get(def.categorySlug) ?? bySlug.get('other-services') ?? null,
      summary: `انجام کامل «${def.title}» توسط کارشناسان دفتر، از بررسی اولیه تا تحویل نتیجه.`,
      description: 'این خدمت بدون نیاز به مراجعه حضوری مکرر انجام می‌شود و همه مراحل آن در همین پرونده قابل پیگیری است.',
      icon: def.icon,
      baseFee: def.fee,
      estimatedDays: def.days,
      paymentMethods: ['online', 'wallet'],
      tags: ['پیشخوان', 'خدمات دولتی'],
      form: [
        { key: 'description', label: 'توضیحات تکمیلی', type: 'textarea', required: false },
        { key: 'preferred_time', label: 'زمان ترجیحی تماس', type: 'text', required: false },
      ],
      documents: [],
      workflow: workflow(Boolean(def.follow)),
      hasExternalCosts: Boolean(def.external),
      externalCostsNote: def.external
        ? 'ممکن است در حین انجام، مبالغی بابت هزینه سازمان مربوطه (خارج از حق‌الزحمه دفتر) لازم شود که با فاکتور جداگانه در همین پرونده اعلام می‌شود.'
        : undefined,
      requiresManagerApproval: false,
      urgentEnabled: Boolean(def.urgent),
      urgentPercent: def.urgent ? 35 : 0,
      urgentMinutes: def.urgent ? 1440 : undefined,
      urgentCapacity: def.urgent ? 5 : 0,
      isPublished: true,
      acceptingRequests: true,
      needsReview: false,
    });
    const svc = { ...created, def };
    S.services.push(svc);
    S.serviceBySlug.set(def.slug, svc);
  }
  log(`created ${S.services.length} demo services`);
}

async function setupStaff(admin) {
  const startsOn = monthFirst(-2);
  for (let i = 0; i < STAFF_DEFS.length; i += 1) {
    const def = STAFF_DEFS[i];
    const created = await admin.post('/api/staff', {
      fullName: def.fullName,
      mobile: `09121${String(100000 + i * 111).slice(-6)}`,
      username: def.username,
      password: STAFF_PASSWORD,
      roleCode: def.roleCode,
      employeeCode: `EMP-${101 + i}`,
      position: def.position,
      specialties: [],
      maxActiveCases: 60,
    });
    const rec = { def, id: created.id, client: null, contractId: null };
    S.staff.set(def.username, rec);
    S.staffById.set(created.id, rec);

    await admin.post('/api/payroll/contracts', {
      userId: created.id,
      kind: def.contract.kind,
      monthlyAmount: def.contract.monthlyAmount ?? 0,
      commissionPercent: def.contract.commissionPercent ?? 0,
      startsOn,
      settlementPeriod: def.contract.settlementPeriod ?? 'monthly',
      monthlyTarget: def.contract.monthlyTarget ?? null,
      note: def.contract.kind === 'commission' ? 'قرارداد درصدی کارمند' : 'قرارداد حقوق ثابت ماهانه',
    });
  }
  // Per-service commission overrides (snapshotted on each payment).
  const vehicle = S.serviceBySlug.get('demo-vehicle-plate');
  const tax = S.serviceBySlug.get('demo-tax');
  await admin.put(`/api/payroll/staff/${S.staff.get('percent1').id}/service-percents`, {
    items: [{ serviceId: vehicle.id, percent: 20, note: 'درصد ویژه خدمات خودرو' }],
  });
  await admin.put(`/api/payroll/staff/${S.staff.get('percent4').id}/service-percents`, {
    items: [{ serviceId: tax.id, percent: 22, note: 'درصد ویژه اظهارنامه مالیاتی' }],
  });
  log(`created ${S.staff.size} staff + contracts`);
}

async function setupDiscounts(admin) {
  await admin.post('/api/discount-codes', { code: 'WELCOME10', title: 'تخفیف مشتریان جدید', type: 'percent', value: 10, perCustomerLimit: 5, isActive: true });
  await admin.post('/api/discount-codes', { code: 'OFFICE15', title: 'کمپین معرفی دفتر', type: 'percent', value: 15, perCustomerLimit: 3, isActive: true });
  await admin.post('/api/discount-codes', { code: 'FIXED200', title: 'تخفیف ثابت خدمات ویژه', type: 'fixed', value: 200000, minAmount: 1000000, perCustomerLimit: 3, isActive: true });
  log('discount codes created');
}

async function activeContractId(admin, userId) {
  const history = await admin.get(`/api/payroll/contracts/${userId}/history`);
  const rows = Array.isArray(history) ? history : history?.contracts ?? [];
  const active = rows.find((r) => r.isActive) ?? rows[0];
  return active?.id ?? null;
}

/* ---------------------------- phase: customers -------------------------- */

async function setupCustomers() {
  for (let i = 0; i < CUSTOMER_NAMES.length; i += 1) {
    const [first, last] = CUSTOMER_NAMES[i];
    const mobile = `09122${String(100000 + i * 137).slice(-6)}`;
    const anonC = new Client(`reg-${i}`);
    await anonC.post('/api/auth/register', { mobile, password: CUSTOMER_PASSWORD, fullName: `${first} ${last}` });
    const client = new Client(`customer-${i}`);
    await client.post('/api/auth/customer/login', { identifier: mobile, password: CUSTOMER_PASSWORD });
    await client.patch('/api/auth/profile', {
      firstName: first, lastName: last, nationalId: nationalId(i + 3), cityId: 'tehran',
    });
    const me = await client.get('/api/auth/me');
    S.customers.push({
      i, first, last, mobile, id: me.id, client,
      regDaysAgo: Math.max(3, Math.round(60 - (i * 57) / (CUSTOMER_NAMES.length - 1))),
      weight: i < 8 ? 3 : i < 24 ? 2 : 1,
      used: 0,
    });
  }
  log(`registered ${S.customers.length} customers`);
}

async function walletTopUps() {
  const early = S.customers.slice(0, 8);
  for (let k = 0; k < early.length; k += 1) {
    const c = early[k];
    const amount = 18_000_000 + k * 2_000_000;
    const started = await c.client.post('/api/wallet/my/topup', { amount });
    await finishSandbox(started.paymentUrl, 'paid');
    S.walletTopups.push({ customerId: c.id, paymentId: started.paymentId, date: atDaysAgo(Math.max(2, c.regDaysAgo - 2), 11) });
  }
  // One failed top-up attempt, for a believable payment history.
  const c = early[1];
  const failed = await c.client.post('/api/wallet/my/topup', { amount: 5_000_000 });
  await finishSandbox(failed.paymentUrl, 'cancelled');
  S.walletTopups.push({ customerId: c.id, paymentId: failed.paymentId, date: atDaysAgo(9, 12), failed: true });
  log('wallet top-ups done');
}

const walletCustomerIds = () => new Set(S.customers.slice(0, 8).map((c) => c.id));

/* ----------------------------- phase: shifts ---------------------------- */

async function setupShifts(admin) {
  const from = dateOnly(addDays(NOW, -45));
  const until = dateOnly(addDays(NOW, 14));
  for (const rec of S.staff.values()) {
    await admin.post('/api/shifts', {
      userId: rec.id, date: from, startTime: '08:00', endTime: '16:00',
      note: 'شیفت روزانه دفتر',
      repeat: { until, weekdays: [0, 1, 2, 3, 4, 5] }, // Sat..Thu (Persian weekday codes)
    });
  }
  // One approved leave + one pending add-shift request.
  const fixed2 = S.staff.get('fixed2');
  const tomorrow = dateOnly(addDays(NOW, 1));
  const in10 = dateOnly(addDays(NOW, 10));
  const mine = await fixed2.client.get(`/api/shifts?mine=true&from=${tomorrow}&to=${in10}`);
  const target = (Array.isArray(mine) ? mine : []).find((s) => s.status === 'scheduled');
  if (target) {
    const leave = await fixed2.client.post('/api/shifts/change-requests', {
      kind: 'leave', shiftId: target.id, reason: 'مرخصی استحقاقی دو روزه',
    });
    await admin.patch(`/api/shifts/change-requests/${leave.id}`, { decision: 'approved', note: 'تأیید شد' });
  }
  const percent1 = S.staff.get('percent1');
  await percent1.client.post('/api/shifts/change-requests', {
    kind: 'add', requestedDate: dateOnly(addDays(NOW, 4)), startTime: '16:00', endTime: '18:00',
    reason: 'پوشش شیفت عصر برای تحویل پرونده‌ها',
  });
  log('shifts scheduled');
}

/* ---------------------------- phase: requests --------------------------- */

async function payInvoice(customer, invoiceId, { useWallet = false } = {}) {
  if (useWallet) {
    try {
      const d = await customer.client.post(`/api/wallet/my/invoices/${invoiceId}/pay`, {});
      return d?.payment?.id ?? d?.paymentId ?? null;
    } catch { /* fall back to the gateway below */ }
  }
  const started = await customer.client.post(`/api/accounting/my/invoices/${invoiceId}/pay`, {});
  await finishSandbox(started.paymentUrl, 'paid');
  return started.paymentId;
}

function planFor(spec, requestId, invoiceId, trackingCode) {
  const i = spec.index;
  const createdAt = atDaysAgo(spec.age, 9 + (i % 7), (i * 13) % 50);
  const assignedAt = spec.worker ? addHours(createdAt, 2 + (i % 20)) : null;
  const paidAt = spec.paid
    ? (assignedAt ? addHours(assignedAt, 1 + (i % 8)) : addHours(createdAt, 1))
    : null;
  const completionDelay = 2 + (i % 5);
  let finalAt; let completedAt = null; let cancelledAt = null;
  if (spec.outcome === 'completed') {
    completedAt = clampPast(addDays(createdAt, Math.min(completionDelay, Math.max(1, spec.age))));
    finalAt = completedAt;
  } else if (spec.outcome.startsWith('cancelled')) {
    cancelledAt = clampPast(addHours(createdAt, 20 + (i % 30)));
    finalAt = cancelledAt;
  } else if (spec.outcome === 'rejected') {
    finalAt = addHours(createdAt, 26);
  } else if (spec.outcome === 'queue') {
    finalAt = paidAt ?? createdAt;
  } else {
    const progressed = Math.min(spec.age, 1 + (i % 4));
    finalAt = clampPast(addDays(createdAt, progressed));
  }
  const plan = {
    requestId, invoiceId, trackingCode, customerId: spec.customer.id,
    workerUser: spec.worker, serviceDays: spec.serviceDef.days,
    createdAt, assignedAt, paidAt, finalAt, completedAt, cancelledAt,
    refundAt: spec.outcome === 'cancelled_refunded' ? addHours(cancelledAt ?? createdAt, 8) : null,
    externalAt: spec.external ? addDays(createdAt, 1 + (i % 2)) : null,
    externalPaidAt: spec.external && spec.externalPaid ? addDays(createdAt, 1 + (i % 2)) : null,
    externalInvoiceId: null, paymentId: null, externalPaymentId: null,
    handoffAt: spec.handoff ? finalAt : null,
  };
  if (plan.externalPaidAt) plan.externalPaidAt = addHours(plan.externalPaidAt, 6);
  S.requestPlans.set(requestId, plan);
  return plan;
}

async function createViaCustom(spec) {
  const customer = spec.customer;
  const definer = S.staff.get(spec.worker ?? 'fixed2');
  let intakeId = null;
  if (spec.customMode === 'creator') {
    const intake = await customer.client.post('/api/catalog/custom-requests', {
      title: 'پیگیری ویژه پرونده ثبتی شرکت خانوادگی',
      description: 'برای شرکت خانوادگی‌مان نیاز به پیگیری هم‌زمان ثبت تغییرات و دریافت روزنامه رسمی داریم؛ لطفاً هزینه و زمان را اعلام کنید.',
    });
    intakeId = intake.id;
  }
  const offer = await (spec.customMode === 'creator' ? definer.client : S.staff.get('fixed2').client)
    .post('/api/catalog/custom-services', {
      customerId: customer.id,
      title: spec.customMode === 'creator' ? 'پیگیری ویژه پرونده ثبتی شرکت خانوادگی' : 'خدمت اختصاصی پیگیری پرونده ملکی',
      description: 'خدمت اختصاصی تعریف‌شده برای همین مشتری، شامل پیگیری کامل تا تحویل نتیجه.',
      baseFee: spec.serviceDef.fee,
      documents: [], form: [], workflow: workflow(false),
      customRequestId: intakeId ?? undefined,
      assignToCreator: spec.customMode === 'creator',
      expiryHours: 720,
    });
  let offerId = offer.offerId ?? offer.id;
  if (!offerId && intakeId) {
    const intakes = await customer.client.get('/api/catalog/custom-requests');
    offerId = (Array.isArray(intakes) ? intakes : []).find((r) => r.id === intakeId)?.offerId;
  }
  const accepted = await customer.client.post(`/api/catalog/offers/${offerId}/accept`, { formData: {}, paymentMethod: 'online' });
  const req = accepted.request ?? accepted;
  S.customStandalone.push({
    intakeId, offerId, requestId: req.id,
    createdAt: null, updatedAt: null, expiresAt: null, decidedAt: null, // filled from the request plan later
  });
  return req;
}

async function runRequestSpec(spec) {
  const customer = spec.customer;
  const service = S.serviceBySlug.get(spec.serviceDef.slug);
  const worker = spec.worker ? S.staff.get(spec.worker) : null;
  let created;
  if (spec.customMode) {
    created = await createViaCustom(spec);
  } else {
    created = await customer.client.data('POST', '/api/requests', {
      body: {
        serviceId: service.id,
        formData: { description: 'درخواست انجام خدمت برای اینجانب ثبت شود؛ در صورت نیاز با بنده تماس بگیرید.', preferred_time: 'ساعت ۱۰ تا ۱۲' },
        paymentMethod: 'online',
        priority: spec.priority,
        discountCode: spec.discountCode,
      },
      headers: { 'Idempotency-Key': `demo-req-${spec.index}` },
      expect: [201],
    });
  }
  const requestId = created.id;
  const invoiceId = created.invoices?.[0]?.id;
  const plan = planFor(spec, requestId, invoiceId, created.trackingCode);
  const useWallet = spec.paid && Boolean(spec.worker) && walletCustomerIds().has(customer.id) && spec.index % 2 === 0;

  if (spec.outcome === 'queue') {
    if (spec.declineBy) {
      await S.staff.get(spec.declineBy).client.post(`/api/requests/${requestId}/decline`, {});
    }
    if (spec.paid && invoiceId) plan.paymentId = await payInvoice(customer, invoiceId);
    if (spec.index % 6 === 0) {
      await customer.client.post(`/api/requests/${requestId}/notes`, { message: 'در صورت نیاز به مدرک تکمیلی لطفاً همین‌جا اطلاع دهید.' });
    }
    return;
  }

  if (spec.outcome === 'rejected') {
    await S.admin.patch(`/api/requests/${requestId}/status`, {
      status: 'rejected', note: 'این خواسته خارج از حوزه خدمات دفتر است و امکان انجام آن وجود ندارد.',
    });
    return;
  }

  if (spec.outcome === 'cancelled' || spec.outcome === 'cancelled_refunded') {
    if (worker) await worker.client.post(`/api/requests/${requestId}/claim`, {});
    if (spec.paid && invoiceId) plan.paymentId = await payInvoice(customer, invoiceId);
    await customer.client.post(`/api/requests/${requestId}/cancel`, { reason: 'از انجام این خدمت منصرف شدم.' });
    if (spec.outcome === 'cancelled_refunded' && plan.paymentId) {
      S.refundedPaymentId = plan.paymentId;
      const accountant = S.staff.get('accounting');
      try {
        await accountant.client.post(`/api/accounting/payments/${plan.paymentId}/refund`, { reason: 'لغو درخواست توسط مشتری و عودت وجه' });
      } catch {
        await S.admin.post(`/api/accounting/payments/${plan.paymentId}/refund`, { reason: 'لغو درخواست توسط مشتری و عودت وجه' });
      }
    }
    return;
  }

  // Assigned flows: claim (free queue) or a manager assignment.
  if (!spec.customMode) {
    if (spec.assignMode === 'claim') {
      await worker.client.post(`/api/requests/${requestId}/claim`, {});
      if (spec.conflictAttempt) {
        const other = WORKER_ORDER.find((u) => u !== spec.worker);
        await S.staff.get(other).client.req('POST', `/api/requests/${requestId}/claim`, { body: {}, expect: [409] });
      }
    } else {
      const assigner = spec.assignMode === 'manager' ? S.staff.get('manager').client : S.admin;
      await assigner.patch(`/api/requests/${requestId}/assign`, { staffId: worker.id });
    }
  }

  if (spec.split) {
    const partner = WORKER_ORDER.find((u) => u !== spec.worker && u.startsWith('percent'));
    if (partner && spec.worker.startsWith('percent')) {
      await S.admin.put(`/api/requests/${requestId}/shares`, {
        shares: [
          { userId: worker.id, sharePercent: 60 },
          { userId: S.staff.get(partner).id, sharePercent: 40 },
        ],
      });
    }
  }

  if (spec.paid && invoiceId) {
    plan.paymentId = await payInvoice(customer, invoiceId, { useWallet });
  }

  // Workflow progress.
  const steps = service.workflow ?? workflow(Boolean(spec.serviceDef.follow));
  const idxOfKind = (kind, after = -1) => steps.findIndex((s, ix) => s.kind === kind && ix > after);
  let advances = 0;
  if (spec.outcome === 'completed') advances = Math.min(steps.length - 2, 2 + (spec.index % 3));
  else if (spec.outcome === 'waiting_customer') advances = Math.max(1, idxOfKind('waiting_customer'));
  else if (spec.outcome === 'action') advances = Math.max(1, idxOfKind('action', 0));
  else if (spec.outcome === 'waiting_org') advances = Math.max(1, idxOfKind('waiting_organization'));
  else if (spec.outcome === 'followup') advances = Math.max(1, idxOfKind('followup'));
  for (let k = 0; k < advances; k += 1) {
    await worker.client.post(`/api/requests/${requestId}/steps/advance`, {
      note: k === 0 ? STEP_NOTES[spec.index % STEP_NOTES.length] : undefined,
    });
  }

  // Mid-process organization fee (separate pass-through invoice).
  if (spec.external) {
    await worker.client.post(`/api/requests/${requestId}/external-invoices`, {
      title: 'هزینه پرداختی به سازمان مربوطه',
      amount: 650_000 + (spec.index % 5) * 120_000,
      note: 'این مبلغ مستقیماً به سازمان پرداخت می‌شود و جزو حق‌الزحمه دفتر نیست.',
    });
    const detail = await S.admin.get(`/api/requests/${requestId}`);
    const ext = (detail.invoices ?? []).find((inv) => inv.id !== invoiceId && inv.status !== 'void');
    if (ext) {
      plan.externalInvoiceId = ext.id;
      if (spec.externalPaid) plan.externalPaymentId = await payInvoice(customer, ext.id);
    }
  }

  if (spec.index % 4 === 0 && spec.outcome !== 'assigned_new') {
    await worker.client.post(`/api/requests/${requestId}/notes`, {
      message: 'پیگیری پرونده انجام شد؛ نتیجه به‌محض صدور در همین صفحه اعلام می‌شود.',
      visibleToCustomer: true,
    });
  }
  if (spec.index % 7 === 0 && ['action', 'waiting_customer'].includes(spec.outcome)) {
    await customer.client.post(`/api/requests/${requestId}/notes`, { message: 'ممنون از پیگیری شما؛ منتظر نتیجه هستم.' });
  }

  if (spec.handoff) {
    await worker.client.post(`/api/requests/${requestId}/handoffs`, {
      department: spec.handoff,
      reason: spec.handoff === 'management'
        ? 'نتیجه سازمان با اطلاعات پرونده مغایرت دارد و نیازمند تصمیم مدیریت است.'
        : 'مبلغ هزینه سازمانی با فاکتور صادرشده اختلاف دارد؛ لطفاً حسابداری بررسی کند.',
    });
  }

  if (spec.outcome === 'completed') {
    await worker.client.post(`/api/requests/${requestId}/deliver`, {
      files: [], summary: DELIVERY_SUMMARIES[spec.index % DELIVERY_SUMMARIES.length],
    });
  }
}

async function runRequests(specs) {
  let percentChanged = false;
  let overrideChanged = false;
  for (const spec of specs) {
    // Mid-history contract upgrade for percent2 (12% -> 15%, 20 days ago).
    if (!percentChanged && spec.age <= 20) {
      percentChanged = true;
      const p2 = S.staff.get('percent2');
      const cid = await activeContractId(S.admin, p2.id);
      if (cid) await S.admin.post(`/api/payroll/contracts/${cid}/close`, { endsOn: dateOnly(atDaysAgo(21)) });
      await S.admin.post('/api/payroll/contracts', {
        userId: p2.id, kind: 'commission', monthlyAmount: 0, commissionPercent: 15,
        startsOn: dateOnly(atDaysAgo(20)), settlementPeriod: 'weekly', monthlyTarget: 5_000_000,
        note: 'افزایش درصد پس از ارزیابی عملکرد',
      });
      log('percent2 contract upgraded 12% -> 15%');
    }
    if (!overrideChanged && spec.age <= 15) {
      overrideChanged = true;
      const vehicle = S.serviceBySlug.get('demo-vehicle-plate');
      await S.admin.put(`/api/payroll/staff/${S.staff.get('percent1').id}/service-percents`, {
        items: [{ serviceId: vehicle.id, percent: 14, note: 'بازنگری درصد ویژه خودرو' }],
      });
      log('percent1 vehicle override revised 20% -> 14%');
    }
    await runRequestSpec(spec);
    if ((spec.index + 1) % 25 === 0) log(`requests ${spec.index + 1}/${specs.length}`);
  }
  log(`requests done (${specs.length})`);
}

/* --------------------------- custom intakes ----------------------------- */

async function customStandalone() {
  const expert = S.staff.get('fixed2');
  // Rejected intake.
  const c1 = S.customers[10];
  const rejected = await c1.client.post('/api/catalog/custom-requests', {
    title: 'انجام تشریفات خارج از کشور',
    description: 'درخواست انجام اموری در خارج از کشور دارم که احتمالاً در حوزه کاری دفتر نیست؛ لطفاً بررسی کنید.',
  });
  await expert.client.post(`/api/catalog/custom-requests/${rejected.id}/reject`, {
    note: 'این خدمت در حوزه فعالیت دفتر نیست؛ پیشنهاد می‌کنیم به دفاتر تخصصی همان حوزه مراجعه کنید.',
  });
  S.customStandalone.push({
    intakeId: rejected.id, offerId: null,
    createdAt: atDaysAgo(12, 10), updatedAt: atDaysAgo(11, 12), expiresAt: null, decidedAt: null,
  });
  // Priced but not yet accepted by the customer.
  const c2 = S.customers[18];
  const priced = await c2.client.post('/api/catalog/custom-requests', {
    title: 'پیگیری پرونده قدیمی ملکی',
    description: 'یک پرونده ملکی قدیمی داریم که نیازمند پیگیری اداری چندمرحله‌ای است؛ هزینه و زمان انجام را اعلام کنید.',
  });
  const offer = await expert.client.post('/api/catalog/custom-services', {
    customerId: c2.id, title: 'پیگیری پرونده قدیمی ملکی',
    description: 'پیگیری اداری پرونده ملکی شامل استعلام‌ها و ثبت درخواست‌ها تا تحویل نتیجه.',
    baseFee: 6_800_000, documents: [], form: [], workflow: workflow(true),
    customRequestId: priced.id, assignToCreator: false, expiryHours: 720,
  });
  S.customStandalone.push({
    intakeId: priced.id, offerId: offer.offerId ?? offer.id ?? null,
    createdAt: atDaysAgo(3, 9), updatedAt: atDaysAgo(2, 13),
    expiresAt: addDays(atDaysAgo(2, 13), 30), decidedAt: null,
  });
  // Fresh pending intake.
  const c3 = S.customers[27];
  const pending = await c3.client.post('/api/catalog/custom-requests', {
    title: 'مشاوره و انجام امور ثبتی مغازه',
    description: 'برای مغازه تازه‌خریده‌شده نیازمند راهنمایی و انجام امور ثبتی و صنفی هستم.',
  });
  S.customStandalone.push({
    intakeId: pending.id, offerId: null,
    createdAt: atDaysAgo(0, 10), updatedAt: atDaysAgo(0, 10), expiresAt: null, decidedAt: null,
  });
  log('custom intakes done');
}

/* ------------------------------- support -------------------------------- */

async function supportPhase() {
  const responders = ['fixed1', 'percent1', 'fixed3', 'manager'];
  const defs = [
    { age: 45, flow: 'closed', dept: 'services', pri: 'normal', rating: 5, subject: 'سؤال درباره مدارک تعویض پلاک', body: 'برای تعویض پلاک چه مدارکی لازم است؟', reply: 'کارت ملی و شناسنامه طرفین، سند و کارت خودرو، بیمه شخص ثالث و احراز محل سکونت خریدار لازم است؛ جزئیات در پرونده خدمت آمده است.' },
    { age: 38, flow: 'closed', dept: 'financial', pri: 'high', rating: 4, subject: 'مغایرت مبلغ فاکتور', body: 'مبلغ فاکتور پرونده‌ام با مبلغ اعلام‌شده فرق دارد؛ لطفاً بررسی کنید.', reply: 'بررسی شد؛ اختلاف مربوط به هزینه سازمانی جداگانه است که در فاکتور دوم پرونده شفاف درج شده و جزو حق‌الزحمه دفتر نیست.' },
    { age: 31, flow: 'resolved', dept: 'services', pri: 'normal', rating: 5, subject: 'زمان صدور کارت سوخت', body: 'کارت سوخت المثنی معمولاً چقدر طول می‌کشد؟', reply: 'پس از ثبت و تأیید، صدور و ارسال معمولاً چند هفته زمان می‌برد و وضعیت آن در پرونده به‌روز می‌شود.' },
    { age: 24, flow: 'closed', dept: 'technical', pri: 'normal', rating: 4, subject: 'مشکل ورود به پنل', body: 'هنگام ورود خطای رمز عبور می‌گیرم درحالی‌که رمز درست است.', reply: 'مشکل از ذخیره شدن رمز قبلی در مرورگر بود؛ با پاک‌کردن رمز ذخیره‌شده و ورود مجدد برطرف می‌شود.' },
    { age: 18, flow: 'resolved', dept: 'services', pri: 'normal', rating: 5, subject: 'پیگیری وام ازدواج', body: 'ثبت‌نام وام ازدواج ما در چه مرحله‌ای است؟', reply: 'ثبت‌نام در سامانه بانک مرکزی انجام و بانک عامل مشخص شده است؛ مرحله بعد مراجعه به شعبه با عقدنامه رسمی است.' },
    { age: 12, flow: 'answered', dept: 'financial', pri: 'normal', subject: 'درخواست فاکتور رسمی', body: 'برای پرونده شرکت، فاکتور رسمی قابل چاپ لازم دارم.', reply: 'از بخش فاکتورهای پنل خودتان می‌توانید نسخه چاپی بگیرید؛ اگر اطلاعات حقوقی نیازمند اصلاح است همین‌جا اعلام کنید.' },
    { age: 9, flow: 'answered', dept: 'services', pri: 'low', subject: 'تغییر شماره تماس پرونده', body: 'شماره تماسم عوض شده؛ روی پرونده‌های باز هم اصلاح می‌شود؟', reply: 'بله؛ شماره جدید از بخش پروفایل اصلاح شد و کارشناسان پرونده‌های باز با شماره جدید تماس می‌گیرند.' },
    { age: 6, flow: 'internal', dept: 'complaint', pri: 'high', subject: 'تأخیر در پاسخ سازمان', body: 'پرونده من مدتی است در انتظار پاسخ سازمان مانده و نگرانم.', reply: 'حق با شماست؛ پیگیری مجدد از سازمان انجام شد و به‌محض دریافت پاسخ در پرونده اطلاع‌رسانی می‌کنیم.' },
    { age: 4, flow: 'open_reply', dept: 'services', pri: 'normal', subject: 'مدارک پروانه کسب', body: 'برای پروانه کسب، گواهی دوره احکام تجارت را از کجا بگیرم؟', reply: 'پیش از ثبت درخواست در درگاه ملی مجوزها، گذراندن دوره احکام تجارت الزامی است؛ راهنمای ثبت دوره را ارسال کردیم.' },
    { age: 2, flow: 'open', dept: 'services', pri: 'urgent', subject: 'مهلت انتخاب رشته رو به پایان است', body: 'انتخاب رشته‌ام فوریت دارد؛ لطفاً امروز بررسی شود.' },
    { age: 1, flow: 'open', dept: 'general', pri: 'normal', subject: 'ساعات کاری دفتر', body: 'برای دریافت اصل مدارک چه ساعتی مراجعه کنم؟' },
    { age: 0, flow: 'open', dept: 'services', pri: 'high', subject: 'نتیجه گذرنامه آماده است؟', body: 'سلام؛ گذرنامه من صادر شده یا هنوز در حال انجام است؟' },
  ];
  for (let i = 0; i < defs.length; i += 1) {
    const d = defs[i];
    const customer = S.customers[(i * 3 + 1) % S.customers.length];
    const staff = S.staff.get(responders[i % responders.length]);
    const created = await customer.client.post('/api/support/tickets', {
      department: d.dept, subject: d.subject, priority: d.pri, body: d.body,
    });
    const id = created.id;
    const createdAt = atDaysAgo(d.age, 9 + (i % 5), 15);
    let resolvedAt = null; let closedAt = null;
    if (d.reply) {
      await staff.client.post(`/api/support/tickets/${id}/reply`, { body: d.reply });
    }
    if (d.flow === 'internal') {
      await staff.client.post(`/api/support/tickets/${id}/reply`, {
        body: 'یادداشت داخلی: پیگیری سازمان در اولویت قرار گرفت؛ فردا دوباره تماس گرفته شود.', internal: true,
      });
    }
    if (d.flow === 'open_reply') {
      await customer.client.post(`/api/support/tickets/${id}/reply`, { body: 'ممنون؛ گواهی دوره را گرفتم، لطفاً ادامه ثبت را انجام دهید.' });
    }
    if (d.flow === 'resolved' || d.flow === 'closed') {
      await staff.client.patch(`/api/support/tickets/${id}`, { status: 'resolved' });
      resolvedAt = addDays(createdAt, 1 + (i % 2));
      if (d.rating) await customer.client.post(`/api/support/tickets/${id}/rate`, { rating: d.rating, note: 'پاسخ‌گویی سریع و دقیق بود.' });
      if (d.flow === 'closed') {
        await staff.client.patch(`/api/support/tickets/${id}`, { status: 'closed' });
        closedAt = addDays(createdAt, 2 + (i % 2));
      }
    }
    S.tickets.set(id, { createdAt, resolvedAt, closedAt });
  }
  log(`support tickets done (${defs.length})`);
}

/* ------------------------------- messages ------------------------------- */

async function messagesPhase() {
  const manager = S.staff.get('manager');
  const defs = [
    { cust: 2, staff: 'fixed1', age: 20, close: true, subject: 'هماهنگی تحویل مدارک', m1: 'اصل مدارک را کی و کجا تحویل بگیرم؟', r1: 'فردا ساعت ۱۰ تا ۱۲ در دفتر آماده تحویل است؛ کارت ملی همراه داشته باشید.', m2: 'حتماً، ممنون از شما.' },
    { cust: 6, staff: 'percent1', age: 11, close: true, subject: 'سؤال درباره فک رهن', m1: 'برای فک رهن خودرو چه چیزی لازم است؟', r1: 'معرفی‌نامه رهن‌دهنده، اصل سند مالکیت، کارت خودرو و مدارک هویتی؛ اگر آماده است در پرونده بارگذاری کنید.' },
    { cust: 13, staff: 'fixed3', age: 6, close: false, subject: 'پیگیری وام ودیعه', m1: 'وام ودیعه ما به چه مرحله‌ای رسیده است؟', r1: 'ثبت اولیه انجام شده و منتظر تأیید بانک هستیم؛ به‌محض پاسخ خبر می‌دهیم.', m2: 'ممنون، منتظر خبرتان هستم.' },
    { cust: 21, staff: 'fixed1', age: 2, close: false, subject: 'ارسال اطلاعات تکمیلی', m1: 'اطلاعات تکمیلی که خواسته بودید را در پرونده ثبت کردم.' },
    { cust: 30, staff: 'percent4', age: 1, close: false, subject: 'اظهارنامه امسال', m1: 'برای اظهارنامه امسال از چه زمانی اقدام کنم؟', r1: 'از همین حالا می‌توانیم شروع کنیم؛ خلاصه درآمد سال را در پرونده بنویسید تا محاسبه انجام شود.' },
    { cust: 33, staff: 'fixed3', age: 0, close: false, subject: 'درخواست مشاوره', m1: 'برای ثبت شرکت نیاز به مشاوره دارم؛ امکان تماس امروز هست؟' },
  ];
  for (const d of defs) {
    const customer = S.customers[d.cust % S.customers.length];
    const thread = await customer.client.post('/api/messages/threads', { subject: d.subject, message: d.m1 });
    const staff = S.staff.get(d.staff);
    await manager.client.patch(`/api/messages/threads/${thread.id}`, { assignedTo: staff.id });
    if (d.r1) await staff.client.post(`/api/messages/threads/${thread.id}/messages`, { body: d.r1 });
    if (d.m2) await customer.client.post(`/api/messages/threads/${thread.id}/messages`, { body: d.m2 });
    if (d.close) await manager.client.patch(`/api/messages/threads/${thread.id}`, { status: 'closed' });
    S.threads.set(thread.id, { createdAt: atDaysAgo(d.age, 11, 5) });
  }
  // One conversation tied to a live case: the assignee answers in context.
  const linked = [...S.requestPlans.values()].find((p) => p.workerUser === 'percent1' && p.assignedAt && !p.completedAt);
  if (linked) {
    const customer = S.customers.find((c) => c.id === linked.customerId);
    const staff = S.staff.get('percent1');
    const thread = await customer.client.post('/api/messages/threads', {
      subject: 'سؤال درباره پرونده جاری', requestId: linked.requestId,
      message: 'پرونده من در چه مرحله‌ای است و قدم بعدی چیست؟',
    });
    await staff.client.post(`/api/messages/threads/${thread.id}/messages`, {
      body: 'پرونده شما در حال انجام است و مرحله فعلی در صفحه پرونده مشخص است؛ قدم بعدی را همین‌جا اطلاع می‌دهم.',
    });
    S.threads.set(thread.id, { createdAt: atDaysAgo(1, 12, 20) });
  }
  log('message threads done');
}

/* --------------------------------- blog --------------------------------- */

async function blogPhase() {
  const editor = S.staff.get('content');
  const catDefs = [
    { title: 'آموزش و راهنما', slug: 'guides', color: '#2563eb', icon: 'book-open' },
    { title: 'خودرو و نقل‌وانتقال', slug: 'vehicle-guides', color: '#0ea5e9', icon: 'car-front' },
    { title: 'اخبار و اطلاعیه‌های دفتر', slug: 'office-news', color: '#16a34a', icon: 'megaphone' },
  ];
  const cats = {};
  for (const c of catDefs) {
    const created = await editor.client.post('/api/blog/categories', c);
    cats[c.slug] = created.id;
  }
  const postDefs = [
    {
      title: 'راهنمای کامل تعویض پلاک خودرو در سال ۱۴۰۵', cat: 'vehicle-guides', age: 40, views: 14, featured: true,
      tags: ['تعویض پلاک', 'خودرو'],
      content: '<h2>مدارک لازم</h2><p>برای تعویض پلاک، کارت ملی و شناسنامه طرفین، سند مالکیت و کارت خودرو، تسویه خلافی و بیمه شخص ثالث معتبر لازم است. احراز محل سکونت خریدار از طریق سامانه سخا یا تأییدیه کد پستی انجام می‌شود و برای خودروهای بالای چهار سال، برگ معاینه فنی نیز لازم است.</p><h2>فک رهن</h2><p>در فک رهن، معرفی‌نامه رهن‌دهنده، اصل سند مالکیت، کارت خودرو، مدارک هویتی و احراز سکونت لازم است. کارشناسان ما همه مراحل را از بررسی مدارک تا تحویل نتیجه پیگیری می‌کنند.</p>',
    },
    {
      title: 'ثبت‌نام وام ازدواج؛ از سامانه بانک مرکزی تا مراجعه به شعبه', cat: 'guides', age: 33, views: 11,
      tags: ['وام ازدواج', 'بانک'],
      content: '<h2>ثبت‌نام اینترنتی</h2><p>ثبت‌نام وام ازدواج در سامانه بانک مرکزی انجام می‌شود و در مرحله ثبت اینترنتی فقط کد ملی زوجین و تاریخ عقد لازم است؛ مدرکی بارگذاری نمی‌شود. بانک و شعبه پیشنهادی در همان مرحله انتخاب می‌شود.</p><h2>مراجعه به شعبه</h2><p>پس از تعیین شعبه، عقدنامه رسمی به همراه شناسنامه و کارت ملی زوجین در شعبه ارائه می‌شود. مدرک نظام وظیفه برای این وام لازم نیست.</p>',
    },
    {
      title: 'پروانه کسب از درگاه ملی مجوزها؛ قدم‌به‌قدم', cat: 'guides', age: 25, views: 8,
      tags: ['پروانه کسب', 'مجوز'],
      content: '<h2>از کجا شروع کنیم؟</h2><p>درخواست پروانه کسب از درگاه ملی مجوزها ثبت و برای بررسی به اتحادیه مربوط ارجاع می‌شود. گذراندن دوره احکام تجارت پیش از ثبت درخواست الزامی است.</p><h2>مدارک اصلی</h2><p>سند مالکیت یا اجاره‌نامه معتبر محل کسب، تصویر شناسنامه و کارت ملی، مفاصاحساب مالیاتی و گواهی عدم سوء پیشینه از مدارک اصلی است و برخی استعلام‌ها به‌صورت سیستمی انجام می‌شود.</p>',
    },
    {
      title: 'کارت سوخت المثنی؛ شرایط و مدارک درخواست', cat: 'vehicle-guides', age: 17, views: 6,
      tags: ['کارت سوخت', 'خودرو'],
      content: '<h2>مدارک درخواست</h2><p>برای درخواست کارت سوخت، کارت ملی مالک، سند یا کارت خودرو، شماره موبایل به نام مالک، شماره پلاک و VIN و کد پستی لازم است. داشتن بیمه شخص ثالث معتبر شرط فعال ماندن سهمیه سوخت است.</p><p>ثبت درخواست و پیگیری صدور آن را می‌توانید از طریق همین سامانه به دفتر بسپارید.</p>',
    },
    {
      title: 'ساعات کاری جدید دفتر و پذیرش آنلاین درخواست‌ها', cat: 'office-news', age: 9, views: 4,
      tags: ['اطلاعیه'],
      content: '<p>به آگاهی مراجعان گرامی می‌رساند دفتر از شنبه تا چهارشنبه از ساعت ۸ تا ۱۶ و پنجشنبه‌ها از ۸ تا ۱۲ پاسخ‌گوی شماست. ثبت و پیگیری آنلاین درخواست‌ها در همه ساعات شبانه‌روز از همین سامانه ممکن است و نیازی به مراجعه حضوری برای ثبت اولیه نیست.</p>',
    },
    {
      title: 'ثبت شرکت با مسئولیت محدود یا سهامی خاص؛ کدام بهتر است؟', cat: 'guides', age: null, draft: true,
      tags: ['ثبت شرکت'],
      content: '<p>پیش‌نویس مقاله مقایسه‌ای درباره تفاوت‌های ثبت شرکت با مسئولیت محدود و سهامی خاص؛ پس از تکمیل بخش هزینه‌ها منتشر می‌شود.</p>',
    },
    {
      title: 'مدارک لازم برای درخواست گذرنامه', cat: 'guides', age: null, scheduledInDays: 3,
      tags: ['گذرنامه'],
      content: '<p>راهنمای مدارک و مراحل درخواست گذرنامه؛ این مطلب طبق برنامه انتشار، چند روز دیگر به‌صورت خودکار منتشر می‌شود.</p>',
    },
  ];
  const createdPosts = [];
  for (const d of postDefs) {
    const publishedAt = d.scheduledInDays ? addDays(NOW, d.scheduledInDays) : d.age !== null && d.age !== undefined ? atDaysAgo(d.age, 9) : null;
    const created = await editor.client.post('/api/blog/posts', {
      title: d.title,
      subtitle: 'راهنمای کاربردی دفتر پیشخوان آرتا',
      excerpt: 'راهنمای کوتاه و کاربردی تهیه‌شده توسط کارشناسان دفتر برای انجام سریع‌تر و بدون خطای این خدمت.',
      content: d.content,
      categoryId: cats[d.cat],
      tags: d.tags,
      coverUrl: '/images/blog-hero.jpg',
      coverAlt: d.title,
      status: d.draft ? 'draft' : 'published',
      publishedAt: publishedAt ? iso(publishedAt) : undefined,
      featured: Boolean(d.featured),
      seoTitle: d.title,
      seoDescription: 'راهنمای کاربردی دفتر پیشخوان آرتا همراه با مدارک لازم و مراحل انجام خدمت.',
    });
    createdPosts.push({ ...created, def: d });
    S.blogPosts.set(created.id, {
      publishedAt,
      createdAt: publishedAt ? addDays(publishedAt, -2) : atDaysAgo(d.draft ? 4 : 1, 10),
      updatedAt: publishedAt ?? atDaysAgo(d.draft ? 2 : 0, 12),
    });
    if (d.views) {
      for (let v = 0; v < d.views; v += 1) {
        await anon.req('GET', `/api/public/blog/posts/${encodeURIComponent(created.slug)}`, { expect: [200] });
      }
    }
  }
  // Comments: a moderated thread, one pending, one rejected.
  const commentPlan = [];
  const addComment = async (post, body, name, decision, ageDays, parentId = null) => {
    const c = await anon.post(`/api/public/blog/posts/${encodeURIComponent(post.slug)}/comments`, { name, body, parentId: parentId ?? undefined });
    let reviewedAt = null;
    if (decision) {
      await editor.client.post(`/api/blog/comments/${c.id}/decision`, { status: decision });
      reviewedAt = addHours(atDaysAgo(ageDays, 13), 4);
    }
    S.blogComments.set(c.id, { createdAt: atDaysAgo(ageDays, 13), reviewedAt });
    commentPlan.push(c);
    return c;
  };
  const root = await addComment(createdPosts[0], 'مطلب خیلی کامل و کاربردی بود؛ به‌خصوص بخش احراز سکونت.', 'خواننده گرامی', 'approved', 36);
  await addComment(createdPosts[0], 'موافقم؛ برای ما هم دقیقاً همین مراحل بود.', 'مشتری دفتر', 'approved', 35, root.id);
  await addComment(createdPosts[1], 'آیا برای وام ازدواج حتماً باید هر دو نفر به شعبه مراجعه کنند؟', 'سؤال‌کننده', 'approved', 30);
  await addComment(createdPosts[2], 'دوره احکام تجارت را آنلاین هم می‌شود گذراند؟', 'کاسب جوان', null, 2);
  await addComment(createdPosts[3], 'تبلیغات نامرتبط با موضوع مقاله', 'مهمان', 'rejected', 12);
  // Newsletter subscribers.
  const emails = ['reader1@example.ir', 'reader2@example.ir', 'mohammadi@example.ir', 'karimi@example.ir', 'office.fan@example.ir', 'news.reader@example.ir'];
  for (let i = 0; i < emails.length; i += 1) {
    await anon.post('/api/public/blog/subscribe', { email: emails[i] });
    S.blogSubscribers.push({ email: emails[i], date: atDaysAgo(30 - i * 4, 14) });
  }
  log('blog done');
}

/* ------------------------------ accounting ------------------------------ */

async function accountingExtras() {
  const admin = S.admin;
  const accountant = S.staff.get('accounting');
  const cats = await admin.get('/api/accounting/expenses/categories');
  const catList = Array.isArray(cats) ? cats : [];
  const catId = (kw, fallbackIdx) => catList.find((c) => String(c.title).includes(kw))?.id ?? catList[fallbackIdx % Math.max(1, catList.length)]?.id;
  const expenseDefs = [
    { title: 'اجاره دفتر — ماه گذشته', amount: 55_000_000, age: 52, kw: 'اجاره' },
    { title: 'اجاره دفتر — این ماه', amount: 55_000_000, age: 22, kw: 'اجاره' },
    { title: 'اینترنت و خط ارتباطی دفتر', amount: 2_400_000, age: 44, kw: 'ارتباط' },
    { title: 'شارژ پنل پیامک دفتر', amount: 6_000_000, age: 37, kw: 'پیامک' },
    { title: 'خرید کاغذ و ملزومات چاپ', amount: 3_800_000, age: 28, kw: 'ملزومات' },
    { title: 'تعمیر و سرویس پرینتر', amount: 4_500_000, age: 19, kw: 'تعمیر' },
    { title: 'تبلیغات محلی و چاپ بنر', amount: 9_000_000, age: 14, kw: 'تبلیغ' },
    { title: 'قبوض آب و برق دفتر', amount: 1_900_000, age: 8, kw: 'قبوض' },
    { title: 'خرید تجهیزات شبکه', amount: 12_500_000, age: 5, kw: 'تجهیز' },
    { title: 'پذیرایی و هزینه‌های جاری دفتر', amount: 1_200_000, age: 2, kw: 'جاری' },
  ];
  for (let i = 0; i < expenseDefs.length; i += 1) {
    const d = expenseDefs[i];
    const spentOn = dateOnly(atDaysAgo(d.age, 12));
    const created = await accountant.client.post('/api/accounting/expenses', {
      title: d.title, amount: d.amount, categoryId: catId(d.kw, i), spentOn,
      method: 'transfer', reference: `EXP-${140500 + i}`, note: 'هزینه عملیاتی دفتر',
    });
    S.expenses.push({ id: created.id, spentOn });
  }
  // Manual (custom) invoices issued by accounting.
  const invoiceDefs = [
    { cust: 4, amount: 2_600_000, age: 26, pay: true, title: 'مشاوره و تنظیم مدارک ثبتی' },
    { cust: 15, amount: 1_750_000, age: 13, pay: true, title: 'خدمات تکمیلی پرونده مالیاتی' },
    { cust: 24, amount: 3_100_000, age: 3, pay: false, title: 'مشاوره تخصصی مجوزهای صنفی' },
  ];
  for (const d of invoiceDefs) {
    const customer = S.customers[d.cust % S.customers.length];
    const inv = await accountant.client.post('/api/accounting/invoices', {
      customerId: customer.id, title: d.title, issue: true,
      items: [{ title: d.title, qty: 1, unitPrice: d.amount }],
      notes: 'فاکتور صادرشده توسط واحد حسابداری دفتر',
    });
    const createdAt = atDaysAgo(d.age, 12, 30);
    let paymentId = null;
    if (d.pay) paymentId = await payInvoice(customer, inv.id);
    S.manualInvoices.push({
      invoiceId: inv.id, paymentId, customerId: customer.id,
      createdAt, paidAt: d.pay ? addHours(createdAt, 5) : null,
    });
  }
  // Goodwill wallet gifts recorded by the admin.
  const giftCust = [S.customers[1], S.customers[8], S.customers[19]];
  for (let i = 0; i < giftCust.length; i += 1) {
    const res = await admin.post('/api/wallet/admin/credit', {
      customerId: giftCust[i].id, amount: 500_000, type: 'gift',
      reason: 'هدیه وفاداری مشتری برای استفاده از خدمات بعدی',
    });
    if (res?.transaction?.id) {
      S.walletCredits.push({ transactionId: res.transaction.id, customerId: giftCust[i].id, date: atDaysAgo(6 - i * 2, 13) });
    }
  }
  log('accounting extras done');
}

/* -------------------------------- payroll ------------------------------- */

async function payrollSalaries() {
  const accountant = S.staff.get('accounting');
  const m2 = monthStr(-2);
  const m1 = monthStr(-1);
  await accountant.client.post('/api/payroll/accrue', { month: m2 });
  await accountant.client.post('/api/payroll/accrue', { month: m1 });
  const prevPayDate = clampPast(new Date(`${m1}-05T05:00:00.000Z`));
  const thisPayDate = clampPast(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1, 5, 0, 0)));
  for (const rec of S.staff.values()) {
    if (rec.def.contract.kind !== 'monthly') continue;
    const history = await accountant.client.get(`/api/payroll/salary-payments?userId=${rec.id}`);
    const months = history?.months ?? [];
    for (const [period, fraction, paidAt] of [
      [m2, 1, prevPayDate],
      [m1, rec.def.username === 'fixed3' ? 0.5 : 1, thisPayDate],
    ]) {
      const row = months.find((x) => x.period === period);
      if (!row) continue;
      const amount = Math.floor((Number(row.accrued) - Number(row.paid)) * fraction);
      if (amount <= 0) continue;
      await accountant.client.post('/api/payroll/salary-payments', {
        userId: rec.id, periodMonth: period, amount,
        method: 'bank_transfer', trackingCode: `SAL-${period.replace('-', '')}-${rec.def.username.toUpperCase()}`,
        paidAt: iso(paidAt), note: fraction < 1 ? 'پرداخت بخشی حقوق؛ مابقی در نوبت تسویه' : 'پرداخت کامل حقوق ماه',
      });
    }
  }
  log('salary accruals + payments done');
}

/** Make commission availability match the story dates before withdrawals. */
function preliminaryCompFix() {
  withDb((db) => {
    const rows = db.prepare(
      "SELECT id, request_id, user_id, kind FROM compensation_entries WHERE kind IN ('commission','reversal','adjustment')",
    ).all();
    const upd = db.prepare('UPDATE compensation_entries SET created_at=?, withdrawable_at=?, period_start=?, period_end=? WHERE id=?');
    for (const row of rows) {
      const plan = S.requestPlans.get(row.request_id);
      if (!plan?.paidAt) continue;
      const staff = S.staffById.get(row.user_id);
      const created = row.kind === 'reversal' ? (plan.refundAt ?? plan.paidAt) : plan.paidAt;
      const w = addDays(created, settlementDaysOf(staff));
      upd.run(iso(created), iso(w), iso(created), iso(w), row.id);
    }
  });
  log('commission windows aligned to story dates');
}

async function withdrawalsPhase() {
  const accountant = S.staff.get('accounting');
  async function create(username, fraction) {
    const staff = S.staff.get(username);
    const earn = await staff.client.get('/api/payroll/me/earnings');
    const available = Number(earn?.balance?.available ?? 0);
    const amount = Math.floor((available * fraction) / 1000) * 1000;
    if (amount < 100_000) throw new Error(`withdrawal balance too small for ${username}: available=${available}`);
    const created = await staff.client.post('/api/payroll/me/withdrawals', { amount, note: 'درخواست برداشت درآمد دوره' });
    return created.id;
  }
  const decide = (id, action, note) => accountant.client.post(`/api/payroll/withdrawals/${id}/decision`, { action, note });
  const pay = (id, tracking) => accountant.client.post(`/api/payroll/withdrawals/${id}/pay`, {
    method: 'bank_transfer', trackingCode: tracking, note: 'واریز به حساب اعلام‌شده کارمند',
  });
  const plan = (id, reqAge, days) => {
    const requestedAt = atDaysAgo(reqAge, 11);
    S.withdrawals.set(id, {
      requestedAt,
      reviewedAt: days.review !== undefined ? addDays(requestedAt, days.review) : null,
      approvedAt: days.approve !== undefined ? addDays(requestedAt, days.approve) : null,
      rejectedAt: days.reject !== undefined ? addDays(requestedAt, days.reject) : null,
      paidAt: days.pay !== undefined ? clampPast(addDays(requestedAt, days.pay)) : null,
      periodStart: addDays(requestedAt, -30), periodEnd: requestedAt,
    });
  };

  // percent1 — fully paid out.
  const w1 = await create('percent1', 0.55);
  await decide(w1, 'review'); await decide(w1, 'approve'); await pay(w1, 'DEMO-WD-1001');
  plan(w1, 16, { review: 1, approve: 2, pay: 3 });

  // percent2 — one paid, plus a fresh approved (not yet paid) request.
  const w2 = await create('percent2', 0.5);
  await decide(w2, 'review'); await decide(w2, 'approve'); await pay(w2, 'DEMO-WD-1002');
  plan(w2, 9, { review: 1, approve: 1, pay: 2 });
  const w2b = await create('percent2', 0.45);
  await decide(w2b, 'review'); await decide(w2b, 'approve');
  plan(w2b, 2, { review: 1, approve: 1 });

  // percent3 — one rejected (funds released), then a fresh pending request.
  const w3 = await create('percent3', 0.5);
  await decide(w3, 'reject', 'شماره شبای اعلام‌شده با نام کارمند مطابقت ندارد؛ لطفاً اصلاح و دوباره ثبت کنید.');
  plan(w3, 6, { reject: 1 });
  const w3b = await create('percent3', 0.4);
  plan(w3b, 1, {});

  // percent4 — under review right now.
  const w4 = await create('percent4', 0.5);
  await decide(w4, 'review');
  plan(w4, 3, { review: 1 });
  log('withdrawals done');
}

async function checkIns() {
  for (const u of ['fixed1', 'percent1', 'accounting', 'manager']) {
    try {
      await S.staff.get(u).client.post('/api/shifts/attendance/check-in', {});
    } catch (e) {
      log(`check-in skipped for ${u}: ${String(e.message).slice(0, 160)}`);
    }
  }
  log('today check-ins done');
}

/* --------------------------- final date rewrite -------------------------- */

function finalize() {
  const startAt = atDaysAgo(65, 8);
  const launch = iso(startAt);
  const colsCache = new Map();
  const colsOf = (db, t) => {
    if (!colsCache.has(t)) colsCache.set(t, tableExists(db, t) ? tableCols(db, t) : new Set());
    return colsCache.get(t);
  };
  const upd = (db, table, set, where, params = []) => {
    const cols = colsOf(db, table);
    const entries = Object.entries(set).filter(([k, v]) => cols.has(k) && v !== undefined);
    if (!entries.length) return;
    db.prepare(`UPDATE ${table} SET ${entries.map(([k]) => `${k}=?`).join(', ')} WHERE ${where}`)
      .run(...entries.map(([, v]) => v), ...params);
  };
  const spread = (db, table, col, from, to) => {
    if (!colsOf(db, table).has(col)) return;
    let rows;
    try { rows = db.prepare(`SELECT rowid AS rid FROM ${table} ORDER BY rowid`).all(); } catch { return; }
    if (!rows.length) return;
    const u = db.prepare(`UPDATE ${table} SET ${col}=? WHERE rowid=?`);
    rows.forEach((r, i) => {
      const t = rows.length === 1 ? to : new Date(from.getTime() + ((to.getTime() - from.getTime()) * i) / (rows.length - 1));
      u.run(iso(t), r.rid);
    });
  };
  const fmtLike = (existing, d) => (typeof existing === 'string' && existing.length <= 10 ? dateOnly(d) : iso(d));

  const paymentDates = new Map();
  for (const t of S.walletTopups) if (t.paymentId) paymentDates.set(t.paymentId, t.date);
  for (const m of S.manualInvoices) if (m.paymentId) paymentDates.set(m.paymentId, m.paidAt);
  for (const p of S.requestPlans.values()) {
    if (p.paymentId && p.paidAt) paymentDates.set(p.paymentId, p.paidAt);
    if (p.externalPaymentId && p.externalPaidAt) paymentDates.set(p.externalPaymentId, p.externalPaidAt);
  }

  withDb((db) => {
    /* Generic history spread for log-like tables (row order ≈ time order). */
    for (const t of ['audit_logs', 'system_logs', 'sms_logs', 'financial_operations', 'login_events', 'notifications']) {
      spread(db, t, 'created_at', startAt, NOW);
    }
    spread(db, 'metric_samples', 'captured_at', atDaysAgo(30, 8), NOW);
    spread(db, 'alerts', 'created_at', atDaysAgo(20, 8), NOW);

    /* Users & profiles. */
    const online = new Set(['admin', 'manager', 'accounting', 'fixed1', 'percent1']);
    upd(db, 'users', {
      created_at: launch, updated_at: launch,
      last_login_at: iso(new Date(NOW.getTime() - 1_800_000)), last_seen_at: iso(new Date(NOW.getTime() - 900_000)),
    }, 'username=?', [ADMIN.username]);
    const hired = monthFirst(-2);
    let si = 0;
    for (const rec of S.staff.values()) {
      const seen = online.has(rec.def.username)
        ? new Date(NOW.getTime() - 600_000 - si * 60_000)
        : atDaysAgo(si % 2, 15, 10);
      upd(db, 'users', {
        created_at: `${hired}T05:00:00.000Z`, updated_at: iso(seen),
        last_login_at: iso(addHours(seen, -2)), last_seen_at: iso(seen),
      }, 'id=?', [rec.id]);
      upd(db, 'staff_profiles', {
        hired_at: hired, created_at: `${hired}T05:00:00.000Z`, updated_at: iso(seen),
      }, 'user_id=?', [rec.id]);
      si += 1;
    }
    for (const c of S.customers) {
      const reg = atDaysAgo(c.regDaysAgo, 10, 20);
      upd(db, 'users', { created_at: iso(reg), updated_at: iso(reg) }, 'id=?', [c.id]);
      upd(db, 'customer_profiles', { created_at: iso(reg), updated_at: iso(reg) }, 'user_id=?', [c.id]);
    }
    for (const row of db.prepare('SELECT id, starts_on, ends_on FROM compensation_contracts').all()) {
      upd(db, 'compensation_contracts', {
        created_at: `${row.starts_on}T05:30:00.000Z`,
        updated_at: row.ends_on ? `${row.ends_on}T05:30:00.000Z` : `${row.starts_on}T05:30:00.000Z`,
      }, 'id=?', [row.id]);
    }

    /* Catalogue & system scaffolding: present since launch. */
    for (const t of ['service_categories', 'roles', 'expense_categories', 'shift_templates']) {
      if (colsOf(db, t).has('created_at')) db.prepare(`UPDATE ${t} SET created_at=?`).run(launch);
      if (colsOf(db, t).has('updated_at')) db.prepare(`UPDATE ${t} SET updated_at=?`).run(launch);
    }
    if (colsOf(db, 'settings').has('updated_at')) db.prepare('UPDATE settings SET updated_at=?').run(launch);
    if (tableExists(db, 'schema_migrations')) db.prepare('UPDATE schema_migrations SET applied_at=?').run(launch);
    db.prepare('UPDATE services SET created_at=?, updated_at=?').run(launch, launch);
    for (const s of S.services) {
      upd(db, 'services', { created_at: iso(addDays(startAt, 1)), updated_at: iso(addDays(startAt, 1)) }, 'id=?', [s.id]);
    }
    upd(db, 'discount_codes', {
      created_at: iso(addDays(startAt, 2)), updated_at: iso(addDays(startAt, 2)),
      starts_at: launch, expires_at: iso(addDays(NOW, 45)),
    }, '1=1');

    /* Requests and everything hanging off them. */
    for (const plan of S.requestPlans.values()) {
      const row = db.prepare('SELECT snapshot, force_assign_at FROM requests WHERE id=?').get(plan.requestId);
      let snapshot = row?.snapshot;
      try {
        const parsed = JSON.parse(snapshot);
        if (parsed && typeof parsed === 'object') { parsed.submittedAt = iso(plan.createdAt); snapshot = JSON.stringify(parsed); }
      } catch { /* keep original snapshot */ }
      upd(db, 'requests', {
        created_at: iso(plan.createdAt), updated_at: iso(plan.finalAt),
        assigned_at: plan.assignedAt ? iso(plan.assignedAt) : null,
        completed_at: plan.completedAt ? iso(plan.completedAt) : null,
        cancelled_at: plan.cancelledAt ? iso(plan.cancelledAt) : null,
        due_at: iso(addDays(plan.createdAt, plan.serviceDays)),
        estimated_completion_at: iso(addDays(plan.createdAt, plan.serviceDays)),
        force_assign_at: row?.force_assign_at ? iso(addDays(plan.createdAt, 2)) : null,
        snapshot,
      }, 'id=?', [plan.requestId]);

      for (const inv of db.prepare('SELECT id, purpose, status FROM invoices WHERE request_id=?').all(plan.requestId)) {
        const ext = inv.purpose === 'external_cost' || inv.id === plan.externalInvoiceId;
        const created = ext ? (plan.externalAt ?? plan.createdAt) : plan.createdAt;
        const paid = ext ? plan.externalPaidAt : plan.paidAt;
        upd(db, 'invoices', {
          created_at: iso(created), issued_at: iso(created),
          updated_at: paid ? iso(paid) : iso(created),
          due_at: iso(addDays(created, 7)),
        }, 'id=?', [inv.id]);
      }

      const events = db.prepare('SELECT rowid AS rid, type, message FROM request_events WHERE request_id=? ORDER BY rowid').all(plan.requestId);
      const evUpd = db.prepare('UPDATE request_events SET created_at=? WHERE rowid=?');
      let last = plan.createdAt;
      events.forEach((ev, i) => {
        let d;
        const msg = String(ev.message ?? '');
        if (ev.type === 'created') d = plan.createdAt;
        else if (ev.type === 'assigned' || msg.includes('پذیرش') || msg.includes('ارجاع شد')) d = plan.assignedAt ?? plan.createdAt;
        else if (ev.type === 'payment') d = plan.paidAt ?? plan.createdAt;
        else if (ev.type === 'invoice') d = plan.externalAt ?? plan.createdAt;
        else if (ev.type === 'delivery') d = plan.completedAt ?? plan.finalAt;
        else if (ev.type === 'handoff') d = plan.handoffAt ?? plan.finalAt;
        else {
          const from = plan.assignedAt ?? plan.createdAt;
          d = new Date(from.getTime() + ((plan.finalAt.getTime() - from.getTime()) * (i + 1)) / (events.length + 1));
        }
        if (d < last) d = last;
        last = d;
        evUpd.run(iso(d), ev.rid);
      });

      upd(db, 'request_claim_attempts', { created_at: iso(plan.assignedAt ?? plan.createdAt) }, 'request_id=?', [plan.requestId]);
      upd(db, 'request_declines', { created_at: iso(addHours(plan.createdAt, 3)) }, 'request_id=?', [plan.requestId]);
      upd(db, 'request_commission_shares', { created_at: iso(plan.assignedAt ? addHours(plan.assignedAt, 1) : plan.createdAt) }, 'request_id=?', [plan.requestId]);
      upd(db, 'request_handoffs', { created_at: iso(plan.handoffAt ?? plan.finalAt) }, 'request_id=?', [plan.requestId]);
      upd(db, 'discount_code_usages', { created_at: iso(plan.createdAt) }, 'request_id=?', [plan.requestId]);
    }
    // Custom services were born with their request.
    try {
      db.exec(`UPDATE services SET created_at = COALESCE((SELECT created_at FROM requests WHERE requests.service_id = services.id ORDER BY created_at LIMIT 1), created_at),
               updated_at = created_at WHERE is_custom = 1`);
    } catch { /* older schema */ }

    /* Manual invoices & expenses. */
    for (const m of S.manualInvoices) {
      upd(db, 'invoices', {
        created_at: iso(m.createdAt), issued_at: iso(m.createdAt),
        updated_at: m.paidAt ? iso(m.paidAt) : iso(m.createdAt), due_at: iso(addDays(m.createdAt, 7)),
      }, 'id=?', [m.invoiceId]);
    }
    const expenseDates = new Map();
    for (const e of S.expenses) {
      const d = new Date(`${e.spentOn}T08:30:00.000Z`);
      expenseDates.set(e.id, d);
      upd(db, 'expenses', { created_at: iso(d) }, 'id=?', [e.id]);
    }

    /* Payments, ledger, callbacks. */
    for (const p of db.prepare('SELECT id, request_id, invoice_id, status, paid_at FROM payments').all()) {
      let date = paymentDates.get(p.id);
      if (!date && p.request_id) {
        const plan = S.requestPlans.get(p.request_id);
        date = plan ? (plan.paidAt ?? plan.createdAt) : null;
      }
      if (!date && p.invoice_id) {
        const m = S.manualInvoices.find((x) => x.invoiceId === p.invoice_id);
        if (m) date = m.paidAt ?? m.createdAt;
      }
      if (!date) continue;
      paymentDates.set(p.id, date);
      const isRefund = p.id === S.refundedPaymentId;
      const plan = p.request_id ? S.requestPlans.get(p.request_id) : null;
      upd(db, 'payments', {
        created_at: iso(addHours(date, -0.2)),
        paid_at: p.paid_at ? iso(date) : null,
        updated_at: isRefund && plan?.refundAt ? iso(plan.refundAt) : iso(date),
      }, 'id=?', [p.id]);
    }
    if (colsOf(db, 'ledger_entries').size) {
      for (const le of db.prepare('SELECT id, ref_id, entry_date FROM ledger_entries').all()) {
        const d = paymentDates.get(le.ref_id) ?? expenseDates.get(le.ref_id);
        if (d) upd(db, 'ledger_entries', { entry_date: fmtLike(le.entry_date, d), created_at: iso(d) }, 'id=?', [le.id]);
      }
    }
    if (colsOf(db, 'payment_callbacks').has('payment_id')) {
      for (const cb of db.prepare('SELECT id, payment_id FROM payment_callbacks').all()) {
        const d = paymentDates.get(cb.payment_id);
        if (d) upd(db, 'payment_callbacks', { created_at: iso(d) }, 'id=?', [cb.id]);
      }
    }
    spread(db, 'payment_gateway_logs', 'created_at', startAt, NOW);

    /* Wallet. */
    const creditDates = new Map(S.walletCredits.map((c) => [c.transactionId, c.date]));
    if (colsOf(db, 'wallet_transactions').size) {
      for (const tx of db.prepare('SELECT id, payment_id, request_id, invoice_id FROM wallet_transactions').all()) {
        let d = creditDates.get(tx.id) ?? paymentDates.get(tx.payment_id);
        if (!d && tx.request_id) d = S.requestPlans.get(tx.request_id)?.paidAt;
        if (!d && tx.invoice_id) d = S.manualInvoices.find((m) => m.invoiceId === tx.invoice_id)?.paidAt;
        if (d) upd(db, 'wallet_transactions', { created_at: iso(d) }, 'id=?', [tx.id]);
      }
      try {
        db.exec(`UPDATE wallets SET
          created_at = COALESCE((SELECT MIN(created_at) FROM wallet_transactions WHERE wallet_transactions.wallet_id = wallets.id), created_at),
          updated_at = COALESCE((SELECT MAX(created_at) FROM wallet_transactions WHERE wallet_transactions.wallet_id = wallets.id), updated_at)`);
      } catch { /* noop */ }
    }

    /* Payroll: salary payments first (paid_at was already historical). */
    if (colsOf(db, 'staff_salary_payments').size) {
      db.exec('UPDATE staff_salary_payments SET created_at = paid_at, updated_at = paid_at WHERE paid_at IS NOT NULL');
    }
    const salaryPaidAt = new Map();
    if (colsOf(db, 'staff_salary_payments').size) {
      for (const r of db.prepare('SELECT id, paid_at FROM staff_salary_payments').all()) salaryPaidAt.set(r.id, r.paid_at);
    }
    for (const e of db.prepare('SELECT * FROM compensation_entries').all()) {
      if (['commission', 'reversal', 'adjustment'].includes(e.kind) && e.request_id) {
        const plan = S.requestPlans.get(e.request_id);
        if (!plan?.paidAt) continue;
        const staff = S.staffById.get(e.user_id);
        const created = e.kind === 'reversal' ? (plan.refundAt ?? plan.paidAt) : plan.paidAt;
        let w = addDays(created, settlementDaysOf(staff));
        if (e.withdrawal_id && S.withdrawals.get(e.withdrawal_id)?.paidAt) {
          const paidAt = S.withdrawals.get(e.withdrawal_id).paidAt;
          if (paidAt < w) w = paidAt;
        }
        upd(db, 'compensation_entries', {
          created_at: iso(created), withdrawable_at: iso(w), period_start: iso(created), period_end: iso(w),
        }, 'id=?', [e.id]);
      } else if (e.kind === 'salary' && e.period) {
        const end = monthEndDate(e.period);
        upd(db, 'compensation_entries', {
          created_at: iso(end), withdrawable_at: iso(end),
          period_start: `${e.period}-01`, period_end: dateOnly(end),
        }, 'id=?', [e.id]);
      } else if (e.kind === 'settlement' && e.salary_payment_id && salaryPaidAt.get(e.salary_payment_id)) {
        upd(db, 'compensation_entries', { created_at: salaryPaidAt.get(e.salary_payment_id) }, 'id=?', [e.id]);
      } else if (e.kind === 'settlement' && String(e.operation_key ?? '').startsWith('withdraw:')) {
        const wid = String(e.operation_key).slice('withdraw:'.length);
        const wp = S.withdrawals.get(wid);
        if (wp?.paidAt) upd(db, 'compensation_entries', { created_at: iso(wp.paidAt) }, 'id=?', [e.id]);
      }
    }
    upd(db, 'staff_service_commissions', { created_at: iso(addDays(startAt, 3)), updated_at: iso(addDays(startAt, 3)) }, '1=1');

    /* Withdrawals. */
    for (const [id, w] of S.withdrawals) {
      const lastEvent = w.paidAt ?? w.rejectedAt ?? w.approvedAt ?? w.reviewedAt ?? w.requestedAt;
      upd(db, 'staff_withdrawals', {
        requested_at: iso(w.requestedAt), created_at: iso(w.requestedAt), updated_at: iso(lastEvent),
        reviewed_at: w.reviewedAt ? iso(w.reviewedAt) : null,
        approved_at: w.approvedAt ? iso(w.approvedAt) : null,
        rejected_at: w.rejectedAt ? iso(w.rejectedAt) : null,
        paid_at: w.paidAt ? iso(w.paidAt) : null,
        period_start: iso(w.periodStart), period_end: iso(w.periodEnd),
      }, 'id=?', [id]);
      if (colsOf(db, 'staff_withdrawal_events').has('withdrawal_id')) {
        const evs = db.prepare('SELECT rowid AS rid, * FROM staff_withdrawal_events WHERE withdrawal_id=? ORDER BY rowid').all(id);
        const u = db.prepare('UPDATE staff_withdrawal_events SET created_at=? WHERE rowid=?');
        evs.forEach((ev, i) => {
          const to = String(ev.to_status ?? ev.action ?? '');
          let d = w.requestedAt;
          if (to.includes('review')) d = w.reviewedAt ?? w.requestedAt;
          else if (to.includes('approv')) d = w.approvedAt ?? w.requestedAt;
          else if (to.includes('reject')) d = w.rejectedAt ?? w.requestedAt;
          else if (to.includes('paid') || to.includes('paying')) d = w.paidAt ?? lastEvent;
          else if (i > 0) d = addDays(w.requestedAt, i);
          u.run(iso(clampPast(d)), ev.rid);
        });
      }
    }

    /* Support tickets. */
    for (const [id, plan] of S.tickets) {
      const msgs = db.prepare('SELECT rowid AS rid FROM support_ticket_messages WHERE ticket_id=? ORDER BY rowid').all(id);
      const u = db.prepare('UPDATE support_ticket_messages SET created_at=?, read_at=? WHERE rowid=?');
      let lastMsg = plan.createdAt;
      msgs.forEach((m, i) => {
        const d = i === 0 ? plan.createdAt : addHours(plan.createdAt, i * 7);
        lastMsg = d;
        const read = (i < msgs.length - 1 || plan.resolvedAt || plan.closedAt) ? iso(addHours(d, 2)) : null;
        u.run(iso(d), read, m.rid);
      });
      upd(db, 'support_tickets', {
        created_at: iso(plan.createdAt), last_message_at: iso(lastMsg),
        resolved_at: plan.resolvedAt ? iso(plan.resolvedAt) : null,
        closed_at: plan.closedAt ? iso(plan.closedAt) : null,
        updated_at: iso(plan.closedAt ?? plan.resolvedAt ?? lastMsg),
      }, 'id=?', [id]);
    }

    /* Chat threads. */
    for (const [id, plan] of S.threads) {
      const msgs = db.prepare('SELECT rowid AS rid FROM messages WHERE thread_id=? ORDER BY rowid').all(id);
      const u = db.prepare('UPDATE messages SET created_at=?, read_at=? WHERE rowid=?');
      let lastMsg = plan.createdAt;
      msgs.forEach((m, i) => {
        const d = i === 0 ? plan.createdAt : addHours(plan.createdAt, i * 5);
        lastMsg = d;
        u.run(iso(d), i < msgs.length - 1 ? iso(addHours(d, 1)) : null, m.rid);
      });
      upd(db, 'threads', { created_at: iso(plan.createdAt), last_message_at: iso(lastMsg) }, 'id=?', [id]);
    }

    /* Blog. */
    upd(db, 'blog_categories', { created_at: iso(addDays(startAt, 5)), updated_at: iso(addDays(startAt, 5)) }, '1=1');
    for (const [id, plan] of S.blogPosts) {
      upd(db, 'blog_posts', {
        created_at: iso(plan.createdAt), updated_at: iso(plan.updatedAt),
        published_at: plan.publishedAt ? iso(plan.publishedAt) : undefined,
      }, 'id=?', [id]);
    }
    for (const [id, plan] of S.blogComments) {
      upd(db, 'blog_comments', {
        created_at: iso(plan.createdAt), reviewed_at: plan.reviewedAt ? iso(plan.reviewedAt) : null,
      }, 'id=?', [id]);
    }
    for (const s of S.blogSubscribers) {
      upd(db, 'blog_subscribers', { created_at: iso(s.date) }, 'email=?', [s.email]);
    }

    /* Custom intakes & offers. */
    for (const c of S.customStandalone) {
      let createdAt = c.createdAt; let updatedAt = c.updatedAt;
      let expiresAt = c.expiresAt; let decidedAt = c.decidedAt; let offerAt = c.updatedAt;
      if (c.requestId) {
        const plan = S.requestPlans.get(c.requestId);
        if (plan) {
          createdAt = addDays(plan.createdAt, -1);
          offerAt = addHours(plan.createdAt, -5);
          updatedAt = plan.createdAt;
          decidedAt = plan.createdAt;
          expiresAt = addDays(offerAt, 30);
        }
      }
      if (c.intakeId && createdAt) {
        upd(db, 'custom_requests', { created_at: iso(createdAt), updated_at: iso(updatedAt ?? createdAt) }, 'id=?', [c.intakeId]);
      }
      if (c.offerId && offerAt) {
        upd(db, 'custom_service_offers', {
          created_at: iso(offerAt),
          decided_at: decidedAt ? iso(decidedAt) : null,
          expires_at: expiresAt ? iso(expiresAt) : null,
        }, 'id=?', [c.offerId]);
      }
    }

    /* Shifts, attendance history, change requests. */
    upd(db, 'shifts', { created_at: iso(addDays(startAt, 3)), updated_at: iso(addDays(startAt, 3)) }, '1=1');
    const today = dateOnly(NOW);
    if (colsOf(db, 'attendance').size) {
      const shifts = db.prepare("SELECT id, user_id, shift_date, start_time FROM shifts WHERE shift_date < ? AND status='scheduled' ORDER BY shift_date").all(today);
      const hasAtt = db.prepare('SELECT id FROM attendance WHERE shift_id=?');
      const ins = db.prepare('INSERT INTO attendance (id, user_id, shift_id, check_in, check_out, status, minutes_late, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const sh of shifts) {
        if (hasAtt.get(sh.id)) continue;
        const r = rng();
        if (r < 0.05) {
          ins.run(`att_demo_${sh.id}`, sh.user_id, sh.id, null, null, 'absent', 0, 'غیبت ثبت‌شده', `${sh.shift_date}T05:00:00.000Z`);
        } else if (r < 0.15) {
          ins.run(`att_demo_${sh.id}`, sh.user_id, sh.id, `${sh.shift_date}T04:50:00.000Z`, `${sh.shift_date}T12:30:00.000Z`, 'late', 20, null, `${sh.shift_date}T04:50:00.000Z`);
        } else {
          ins.run(`att_demo_${sh.id}`, sh.user_id, sh.id, `${sh.shift_date}T04:32:00.000Z`, `${sh.shift_date}T12:30:00.000Z`, 'present', 0, null, `${sh.shift_date}T04:32:00.000Z`);
        }
      }
      db.prepare(`UPDATE shifts SET status='completed' WHERE shift_date < ? AND status='scheduled'
        AND EXISTS (SELECT 1 FROM attendance a WHERE a.shift_id = shifts.id AND a.status IN ('present','late','remote'))`).run(today);
      db.prepare(`UPDATE shifts SET status='absent' WHERE shift_date < ? AND status='scheduled'
        AND EXISTS (SELECT 1 FROM attendance a WHERE a.shift_id = shifts.id AND a.status='absent')`).run(today);
    }
    if (colsOf(db, 'shift_change_requests').size) {
      for (const r of db.prepare('SELECT id, decided_at FROM shift_change_requests ORDER BY rowid').all()) {
        if (r.decided_at) upd(db, 'shift_change_requests', { created_at: iso(atDaysAgo(6, 10)), decided_at: iso(atDaysAgo(5, 11)) }, 'id=?', [r.id]);
        else upd(db, 'shift_change_requests', { created_at: iso(atDaysAgo(1, 10)) }, 'id=?', [r.id]);
      }
    }

    /* Customer last activity follows their newest case. */
    try {
      db.exec(`UPDATE users SET
        last_login_at = COALESCE((SELECT MAX(updated_at) FROM requests WHERE requests.customer_id = users.id), last_login_at),
        last_seen_at = COALESCE((SELECT MAX(updated_at) FROM requests WHERE requests.customer_id = users.id), last_seen_at),
        updated_at = COALESCE((SELECT MAX(updated_at) FROM requests WHERE requests.customer_id = users.id), updated_at)
        WHERE kind = 'customer'`);
    } catch { /* noop */ }
    if (colsOf(db, 'login_events').has('user_id')) {
      try {
        db.exec(`UPDATE login_events SET created_at = MAX(created_at,
          COALESCE((SELECT created_at FROM users WHERE users.id = login_events.user_id), created_at))
          WHERE user_id IS NOT NULL`);
      } catch { /* noop */ }
    }

    /* Request-linked notifications get their case's moment. */
    if (colsOf(db, 'notifications').size) {
      const notes = db.prepare('SELECT id, user_id, title, body, link, created_at FROM notifications').all();
      const salaryByUserPeriod = new Map();
      if (colsOf(db, 'staff_salary_payments').size) {
        for (const r of db.prepare('SELECT user_id, period_month, paid_at FROM staff_salary_payments').all()) {
          salaryByUserPeriod.set(`${r.user_id}:${r.period_month}`, r.paid_at);
        }
      }
      const plans = [...S.requestPlans.values()];
      for (const n of notes) {
        let d = null;
        if (n.link) {
          const plan = plans.find((p) => String(n.link).includes(p.requestId));
          if (plan) {
            const text = `${n.title ?? ''} ${n.body ?? ''}`;
            if (text.includes('تحویل') || text.includes('تکمیل')) d = plan.completedAt ?? plan.finalAt;
            else if (text.includes('ارجاع') || text.includes('پذیرش')) d = plan.assignedAt ?? plan.createdAt;
            else if (text.includes('فاکتور')) d = plan.externalAt ?? plan.createdAt;
            else if (text.includes('ثبت شد')) d = plan.createdAt;
            else d = plan.finalAt;
          }
        }
        if (!d && String(n.title ?? '').includes('حقوق')) {
          const period = String(n.body ?? '').match(/20\d{2}-\d{2}/)?.[0];
          const paid = period ? salaryByUserPeriod.get(`${n.user_id}:${period}`) : null;
          if (paid) d = new Date(paid);
        }
        if (d) {
          const read = d.getTime() < NOW.getTime() - 2 * DAY && rng() < 0.75 ? iso(addHours(d, 3)) : null;
          upd(db, 'notifications', { created_at: iso(clampPast(d)), read_at: read }, 'id=?', [n.id]);
        }
      }
      // A lived-in office reads its bell: most older notifications are read,
      // a believable handful from the last couple of days is still unread.
      const stale = db.prepare('SELECT id, created_at FROM notifications WHERE read_at IS NULL AND created_at < ?')
        .all(iso(addDays(NOW, -2)));
      const markRead = db.prepare('UPDATE notifications SET read_at=? WHERE id=?');
      for (const n of stale) {
        if (rng() < 0.88) markRead.run(iso(addHours(new Date(n.created_at), 2 + Math.floor(rng() * 20))), n.id);
      }
    }

    /* No live sessions or OTPs travel inside a backup. */
    for (const t of ['sessions', 'otp_codes', 'backups']) {
      if (tableExists(db, t)) db.prepare(`DELETE FROM ${t}`).run();
    }
  });

  /* Snapshot + verify. */
  const sqlitePath = path.join(OUT_DIR, 'pishkan-demo-60-days.sqlite');
  const uploadsPath = path.join(OUT_DIR, 'pishkan-demo-60-days-uploads.tar.gz');
  fs.rmSync(sqlitePath, { force: true });
  const db = new DatabaseSync(DB_FILE);
  let integrity; let fk; let migrations;
  try {
    integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check ?? 'unknown';
    fk = db.prepare('PRAGMA foreign_key_check').all();
    migrations = Number(db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c);
    if (integrity !== 'ok') throw new Error(`integrity_check failed: ${integrity}`);
    if (fk.length) throw new Error(`foreign_key_check found ${fk.length} violation(s)`);
    db.exec(`VACUUM INTO '${sqlitePath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const tar = spawnSync('tar', ['-czf', uploadsPath, '-C', UPLOAD_DIR, '.'], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.stdout}`);

  const ro = new DatabaseSync(sqlitePath, { readOnly: true });
  const one = (sql, ...p) => ro.prepare(sql).get(...p);
  const group = (sql) => Object.fromEntries(ro.prepare(sql).all().map((r) => [r.k, Number(r.c)]));
  const summary = {
    generatedAt: new Date().toISOString(),
    scenario: 'Simulated ~60 days of office activity ending at generation time.',
    restore: {
      windowsManager: 'Open the Pishkan Manager, press «بازیابی», and choose pishkan-demo-60-days.sqlite. The Manager keeps a safety copy of the current database and restarts the service.',
      uploads: 'The demo is self-contained (no uploaded binaries). pishkan-demo-60-days-uploads.tar.gz mirrors the uploads folder for completeness.',
    },
    counts: {
      migrations,
      customers: Number(one("SELECT COUNT(*) c FROM users WHERE kind='customer'").c),
      staffAndAdmins: Number(one("SELECT COUNT(*) c FROM users WHERE kind IN ('staff','admin')").c),
      servicesTotal: Number(one('SELECT COUNT(*) c FROM services').c),
      requestsTotal: Number(one('SELECT COUNT(*) c FROM requests').c),
      requestsByStatus: group('SELECT status AS k, COUNT(*) AS c FROM requests GROUP BY status'),
      requestsByWorkBucket: group('SELECT work_bucket AS k, COUNT(*) AS c FROM requests GROUP BY work_bucket'),
      freeQueueUnassigned: Number(one("SELECT COUNT(*) c FROM requests WHERE assigned_to IS NULL AND status IN ('new','under_review')").c),
      invoices: Number(one('SELECT COUNT(*) c FROM invoices').c),
      confirmedPayments: Number(one("SELECT COUNT(*) c FROM payments WHERE status='confirmed'").c),
      confirmedPaymentTotal: Number(one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='confirmed'").s),
      commissionEntries: Number(one("SELECT COUNT(*) c FROM compensation_entries WHERE kind='commission'").c),
      commissionTotal: Number(one("SELECT COALESCE(SUM(amount),0) s FROM compensation_entries WHERE kind='commission'").s),
      salaryPayments: Number(one('SELECT COUNT(*) c FROM staff_salary_payments').c),
      salaryPaidTotal: Number(one('SELECT COALESCE(SUM(amount),0) s FROM staff_salary_payments').s),
      withdrawalsByStatus: group('SELECT status AS k, COUNT(*) AS c FROM staff_withdrawals GROUP BY status'),
      expenses: Number(one('SELECT COUNT(*) c FROM expenses').c),
      supportTickets: group('SELECT status AS k, COUNT(*) AS c FROM support_tickets GROUP BY status'),
      messageThreads: Number(one('SELECT COUNT(*) c FROM threads').c),
      blogPosts: group('SELECT status AS k, COUNT(*) AS c FROM blog_posts GROUP BY status'),
      blogComments: Number(one('SELECT COUNT(*) c FROM blog_comments').c),
      shifts: Number(one('SELECT COUNT(*) c FROM shifts').c),
      attendanceRows: Number(one('SELECT COUNT(*) c FROM attendance').c),
      notifications: Number(one('SELECT COUNT(*) c FROM notifications').c),
    },
    credentials: {
      admin: { username: ADMIN.username, password: ADMIN.password, login: '/login-admin' },
      staffPassword: STAFF_PASSWORD,
      staff: STAFF_DEFS.map((d) => ({ username: d.username, fullName: d.fullName, role: d.roleCode, contract: d.contract.kind })),
      customerPassword: CUSTOMER_PASSWORD,
      customersSample: S.customers.slice(0, 5).map((c) => ({ mobile: c.mobile, fullName: `${c.first} ${c.last}` })),
      note: 'Every demo staff account uses the staff password above; every demo customer logs in with their mobile + the customer password.',
    },
    checks: { integrity, foreignKeyViolations: fk.length, migrations },
    files: {
      sqlite: { name: path.basename(sqlitePath), bytes: fs.statSync(sqlitePath).size, sha256: sha256File(sqlitePath) },
      uploads: { name: path.basename(uploadsPath), bytes: fs.statSync(uploadsPath).size, sha256: sha256File(uploadsPath) },
    },
  };
  ro.close();
  const summaryPath = path.join(OUT_DIR, 'pishkan-demo-60-days-summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const sums = [sqlitePath, uploadsPath, summaryPath]
    .map((f) => `${sha256File(f)}  ${path.basename(f)}`).join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'SHA256SUMS.txt'), `${sums}\n`, 'utf8');
  return summary;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const port = await freePort();
  try {
    await startApi(port);
    S.admin = await loginStaff(ADMIN.username, ADMIN.password, 'admin');
    await setupSettings(S.admin);
    await setupServices(S.admin);
    await setupStaff(S.admin);
    await setupDiscounts(S.admin);
    await stopApi();

    withDb((db) => db.exec("UPDATE users SET mobile_verified=1 WHERE kind IN ('staff','admin')"));

    await startApi(port);
    S.admin = await loginStaff(ADMIN.username, ADMIN.password, 'admin');
    for (const rec of S.staff.values()) {
      rec.client = await loginStaff(rec.def.username, STAFF_PASSWORD, rec.def.username);
    }
    await setupCustomers();
    const specs = buildSpecs();
    assignCustomers(specs);
    await walletTopUps();
    await setupShifts(S.admin);
    await runRequests(specs);
    await customStandalone();
    await supportPhase();
    await messagesPhase();
    await blogPhase();
    await accountingExtras();
    await payrollSalaries();
    await stopApi();

    preliminaryCompFix();

    await startApi(port);
    await S.admin.get('/api/auth/me'); // sessions survive the restart
    await withdrawalsPhase();
    await checkIns();
    await stopApi();

    const summary = finalize();
    log('DONE — artifacts in', OUT_DIR);
    console.log(JSON.stringify(summary.counts, null, 2));
  } catch (e) {
    try { await stopApi(); } catch { /* noop */ }
    console.error('[demo-backup] FAILED:', e?.stack ?? e);
    try {
      const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-60).join('\n');
      console.error('--- server log tail ---\n', tail);
    } catch { /* noop */ }
    console.error('[demo-backup] work dir kept at', WORK);
    process.exitCode = 1;
  }
}

main();



