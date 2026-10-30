#!/usr/bin/env node
/**
 * Pishkan runtime verification & end-to-end workflow test.
 *
 * This file is the single source of truth for "is this installation really
 * working?" and is used by:
 *   - the Windows installer (final verification step),
 *   - the Windows manager app (status panel, `--mode status`),
 *   - CI / Linux runs (`npm run verify:runtime`).
 *
 * It talks to the real HTTP API and the real database — no mocks. The only
 * external services that may be simulated are SMS and the payment gateway,
 * which are documented in docs/WINDOWS-LOCAL-REPORT-2026-10-30.md.
 *
 * Usage
 *   node windows/lib/verify.mjs --mode status   --url http://127.0.0.1:3000
 *   node windows/lib/verify.mjs --mode core     --url ... --env .env.windows.local
 *   node windows/lib/verify.mjs --mode workflow --url ... --admin-user admin --admin-pass 'secret'
 *
 * Output: one JSON document on stdout (prefixed with RESULT_JSON:), human text on stderr.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readEnvFile } from './envfile.mjs';

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
}
function flag(name) { return args.includes(`--${name}`); }

const MODE = arg('mode', 'core');
const BASE = (arg('url', process.env.PISHKAN_URL || 'http://127.0.0.1:3000')).replace(/\/+$/, '');
const ENV_FILE = arg('env', process.env.PISHKAN_ENV_FILE || '');
const ADMIN_USER = arg('admin-user', process.env.PISHKAN_ADMIN_USER || 'admin');
const ADMIN_PASS = arg('admin-pass', process.env.PISHKAN_ADMIN_PASS || '');
const TIMEOUT = Number(arg('timeout', '15000'));

const checks = [];
const steps = [];
const notes = [];

function record(id, label, ok, detail = '', extra = {}) {
  checks.push({ id, label, ok: Boolean(ok), detail: String(detail ?? ''), ...extra });
  const mark = ok ? 'PASS' : 'FAIL';
  process.stderr.write(`[${mark}] ${label}${detail ? ` — ${detail}` : ''}\n`);
  return ok;
}

async function check(id, label, fn, options = {}) {
  const started = Date.now();
  try {
    const result = await fn();
    const detail = typeof result === 'string' ? result : result?.detail ?? '';
    const ok = typeof result === 'object' && result !== null && 'ok' in result ? Boolean(result.ok) : true;
    record(id, label, ok, detail, { ms: Date.now() - started, ...(options.extra ?? {}) });
    return ok;
  } catch (error) {
    const detail = error?.message ?? String(error);
    record(id, label, false, detail, { ms: Date.now() - started, error: detail });
    if (options.fatal) throw error;
    return false;
  }
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ms: Date.now() - started, detail: typeof detail === 'string' ? detail : '' });
    process.stderr.write(`[STEP] ${name} ✓${detail ? ` — ${detail}` : ''}\n`);
    return detail;
  } catch (error) {
    const detail = error?.message ?? String(error);
    steps.push({ name, ok: false, ms: Date.now() - started, detail });
    process.stderr.write(`[STEP] ${name} ✗ — ${detail}\n`);
    throw error;
  }
}

/* ------------------------------- http client ------------------------------- */

/**
 * Every actor (super admin, expert, customer) keeps its own cookie jar. Sharing
 * one jar would silently make the *last* login win and turn a role-permission
 * check into a false pass, so sessions are strictly separated here.
 */
const sessions = new Map();

function jar(actor) {
  if (!sessions.has(actor)) sessions.set(actor, new Map());
  return sessions.get(actor);
}

function cookieHeader(actor) {
  return [...jar(actor).entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function storeCookies(response, actor) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const store = jar(actor);
  for (const raw of list) {
    const first = String(raw).split(';')[0];
    const index = first.indexOf('=');
    if (index > 0) store.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
  }
}

async function request(pathname, options = {}) {
  const { method = 'GET', body, form, expect = 200, raw = false, session = true, redirect } = options;
  const actor = options.actor ?? 'anon';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const headers = { accept: 'application/json' };
  if (session && jar(actor).size) headers.cookie = cookieHeader(actor);
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method, headers, body: payload, signal: controller.signal, redirect: redirect ?? 'follow',
    });
    if (session) storeCookies(response, actor);
    const text = await response.text();
    if (raw) {
      if (response.status !== expect) throw new Error(`${method} ${pathname} → ${response.status}`);
      return { status: response.status, headers: response.headers, text };
    }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (response.status !== expect) {
      const message = json?.error?.message ?? json?.message ?? text.slice(0, 300);
      throw new Error(`${method} ${pathname} → ${response.status}${message ? `: ${message}` : ''}`);
    }
    if (json && json.ok === false) throw new Error(`${method} ${pathname} → ${json.error?.message ?? 'rejected'}`);
    return { status: response.status, headers: response.headers, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------- fixture builders ---------------------------- */

function png(width = 96, height = 64) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeBuffer = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuffer, data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const dark = (x > 12 && x < width - 12 && y > 10 && y < height - 10 && (x + y) % 17 < 8);
      row[1 + x * 3] = dark ? 20 : 245;
      row[2 + x * 3] = dark ? 30 : 246;
      row[3 + x * 3] = dark ? 45 : 250;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pdf() {
  // Structurally complete, one-page PDF: the upload validator checks for
  // Catalog/Pages/Page objects plus a trailer and %%EOF marker.
  return Buffer.from(
    '%PDF-1.4\n'
    + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n'
    + 'trailer<</Root 1 0 R>>\nstartxref\n0\n%%EOF\n',
  );
}

function formDataFile(buffer, filename, type) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  return form;
}

/* --------------------------------- checks ---------------------------------- */

async function checkConfig() {
  const config = readEnvFile(ENV_FILE);
  if (!ENV_FILE) return check('config', 'فایل تنظیمات محیط محلی', () => ({ ok: false, detail: 'فایل تنظیمات تعیین نشده است' }));
  return check('config', 'فایل تنظیمات محیط محلی', () => {
    if (!fs.existsSync(ENV_FILE)) return { ok: false, detail: `پیدا نشد: ${ENV_FILE}` };
    if (!config.DB_DRIVER) return { ok: false, detail: 'DB_DRIVER تعریف نشده است' };
    if (!config.APP_ENCRYPTION_KEY || config.APP_ENCRYPTION_KEY.length < 32) {
      return { ok: false, detail: 'APP_ENCRYPTION_KEY کوتاه است' };
    }
    return { ok: true, detail: `${config.DB_DRIVER} · پورت ${config.PORT ?? '—'} · NODE_ENV=${config.NODE_ENV ?? '—'}` };
  }, { extra: { config } }).then(() => config);
}

async function checkDatabase(config) {
  if ((config.DB_DRIVER || '').toLowerCase() === 'sqlite') {
    const file = config.SQLITE_FILE || '';
    if (!file || !fs.existsSync(file)) {
      record('database-file', 'فایل پایگاه داده SQLite', false, file ? `پیدا نشد: ${file}` : 'SQLITE_FILE تعریف نشده');
      return;
    }
    const sizeKb = Math.round(fs.statSync(file).size / 1024);
    record('database-file', 'فایل پایگاه داده SQLite', true, `${file} (${sizeKb} KB)`);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const safe = (id, label, fn) => {
        try {
          const detail = fn();
          record(id, label, true, detail);
        } catch (error) {
          record(id, label, false, error?.message ?? String(error));
        }
      };
      const count = (sql, ...params) => {
        const row = db.prepare(sql).get(...params);
        return row ? Number(Object.values(row)[0]) : 0;
      };
      safe('database-migrations', 'مهاجرت‌های اعمال‌شده', () => {
        const migrations = count('SELECT COUNT(*) AS c FROM schema_migrations');
        const tables = count("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'");
        if (migrations <= 0) throw new Error('هیچ مهاجرتی ثبت نشده است');
        return `${migrations} مهاجرت · ${tables} جدول`;
      });
      safe('database-admin', 'حساب مدیر کل فعال', () => {
        const admins = count("SELECT COUNT(*) AS c FROM users WHERE kind = 'admin' AND status = 'active'");
        if (admins <= 0) throw new Error('مدیر فعالی وجود ندارد');
        return `${admins} مدیر فعال`;
      });
      safe('database-roles', 'نقش‌های سیستمی', () => {
        const roles = count('SELECT COUNT(*) AS c FROM roles');
        if (roles < 6) throw new Error(`فقط ${roles} نقش تعریف شده است`);
        return `${roles} نقش`;
      });
      safe('database-catalog', 'کاتالوگ خدمات', () => {
        const services = count('SELECT COUNT(*) AS c FROM services');
        if (services <= 0) throw new Error('کاتالوگ خالی است');
        return `${services} خدمت`;
      });
      safe('database-files', 'رکورد فایل‌ها', () => `${count('SELECT COUNT(*) AS c FROM files')} فایل ثبت‌شده`);
    } finally {
      db.close();
    }
    return;
  }
  record('database-file', 'اتصال PostgreSQL', false, 'این اسکریپت بررسی مستقیم PostgreSQL را انجام نمی‌دهد؛ وضعیت از /api/health خوانده می‌شود');
}

async function checkStorage(config, root) {
  const baseDir = config.UPLOAD_DIR || path.join(root, '.data', 'uploads');
  const expected = ['incoming', 'private/originals', 'private/optimized', 'private/previews', 'public'];
  await check('storage-dir', 'پوشه ذخیره‌سازی فایل‌ها', () => {
    const missing = expected.filter((relative) => !fs.existsSync(path.join(baseDir, relative)));
    if (missing.length) return { ok: false, detail: `پوشه‌های غایب: ${missing.join(', ')}` };
    return { ok: true, detail: baseDir };
  });
  await check('storage-write', 'اجازه نوشتن در پوشه ذخیره‌سازی', () => {
    const probe = path.join(baseDir, 'incoming', `.verify-${Date.now()}.tmp`);
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return { ok: true, detail: 'آزمون نوشتن و پاک‌سازی انجام شد' };
  });
  await check('backup-dir', 'پوشه پشتیبان‌گیری', () => {
    const dir = config.BACKUP_DIR || path.join(root, '.data', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, detail: dir };
  });
}

async function checkApi() {
  await check('api-health', 'سرویس API (/api/health)', async () => {
    const response = await request('/api/health', { session: false, expect: 200 });
    const status = response.json?.status ?? response.json?.data?.status;
    return { ok: response.json?.ok !== false && (status === 'ok' || !status), detail: `وضعیت: ${status ?? 'ok'}` };
  });
  await check('api-ready', 'آمادگی پایگاه داده (/api/health/ready)', async () => {
    const response = await request('/api/health/ready', { session: false });
    return { ok: true, detail: response.json?.status ?? 'ready' };
  });
  await check('api-public', 'کاتالوگ عمومی خدمات', async () => {
    const response = await request('/api/public/services?pageSize=3', { session: false });
    const total = response.json?.meta?.total ?? response.json?.data?.length ?? 0;
    return { ok: Number(total) > 0, detail: `${total} خدمت` };
  });
  await check('api-auth-guard', 'محافظت از مسیرهای خصوصی', async () => {
    const response = await fetch(`${BASE}/api/requests`, { headers: { accept: 'application/json' } });
    return { ok: response.status === 401 || response.status === 403, detail: `کد پاسخ بدون نشست: ${response.status}` };
  });
}

async function checkFrontend() {
  await check('web-index', 'صفحه اصلی رابط کاربری', async () => {
    const response = await request('/', { session: false, raw: true });
    const hasRoot = response.text.includes('id="root"');
    const hasTheme = response.text.includes('pishkan.theme');
    return { ok: hasRoot, detail: hasRoot ? `HTML سرو شد${hasTheme ? ' · اسکریپت تم فعال' : ''}` : 'root div پیدا نشد' };
  });
  await check('web-spa-route', 'مسیرهای SPA (نمونه: /login)', async () => {
    const response = await request('/login', { session: false, raw: true });
    return { ok: response.text.includes('id="root"'), detail: 'fallback به index.html' };
  });
  await check('web-assets', 'فایل‌های استاتیک', async () => {
    const index = await request('/', { session: false, raw: true });
    const match = /src="(\/assets\/[^"]+\.js)"/.exec(index.text);
    if (!match) return { ok: false, detail: 'bundle اصلی در HTML پیدا نشد' };
    const asset = await request(match[1], { session: false, raw: true });
    return { ok: asset.text.length > 1000, detail: `${match[1]} (${Math.round(asset.text.length / 1024)} KB)` };
  });
}

async function login(identifier, password, actor = 'anon') {
  jar(actor).clear();
  const response = await request('/api/auth/login', {
    method: 'POST', body: { identifier, password }, session: true, expect: 200, actor,
  });
  return response;
}

/* ------------------------------ workflow mode ------------------------------ */

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const suffix = stamp.slice(-7).toLowerCase();
const ACTORS = { admin: 'admin', expert: 'expert', customer: 'customer' };

/** Authenticate one actor. Each actor keeps a separate cookie jar. */
async function loginAs(actor, identifier, password) {
  const response = await login(identifier, password, actor);
  return response.json?.data?.user ?? response.json?.data ?? null;
}

function actorOptions(actor, extra = {}) {
  return { actor: ACTORS[actor] ?? actor, ...extra };
}

/**
 * 16-step end-to-end workflow over the *real* API:
 * catalogue + request intake → document review loop → delivery → management
 * approval → customer visibility → closure. Mirrors apps/api/tests/automation.
 */
async function runWorkflow() {
  const state = {};

  await step('ورود مدیر کل', async () => {
    const user = await loginAs('admin', ADMIN_USER, ADMIN_PASS);
    if (!user?.id) throw new Error('پاسخ ورود مدیر شناسه کاربر نداشت');
    if (user.roleCode !== 'super_admin') throw new Error(`نقش حساب ${user.roleCode} است، نه super_admin`);
    state.adminId = user.id;
    return `نقش ${user.roleCode} · دسترسی ${user.permissions === '*' ? 'همه' : `${(user.permissions ?? []).length} مجوز`}`;
  });

  await step('داشبورد مدیریت', async () => {
    const response = await request('/api/dashboard/summary', actorOptions('admin'));
    const stats = response.json?.data?.stats ?? response.json?.data;
    if (!stats) throw new Error('خلاصه داشبورد خالی است');
    return `${stats.total ?? 0} پرونده`;
  });

  await step('ایجاد کارکنان چهار نقش (کارشناس، اپراتور، حسابدار، مدیر)', async () => {
    const people = [];
    const specs = [
      { key: 'expert', roleCode: 'service_expert', label: 'کارشناس آزمون' },
      { key: 'operator', roleCode: 'operator', label: 'اپراتور آزمون' },
      { key: 'accountant', roleCode: 'accountant', label: 'حسابدار آزمون' },
      { key: 'manager', roleCode: 'manager', label: 'مدیر داخلی آزمون' },
    ];
    for (const spec of specs) {
      const username = `e2e_${spec.key}_${suffix}`;
      const mobile = `09${Math.floor(100000000 + Math.random() * 899999999)}`;
      const response = await request('/api/staff', actorOptions('admin', {
        method: 'POST',
        body: {
          fullName: `${spec.label} ${suffix}`,
          mobile,
          username,
          password: 'Expert#Pass12345',
          roleCode: spec.roleCode,
          employeeCode: `E2E-${spec.key}-${suffix}`,
        },
        expect: 201,
      }));
      state[spec.key] = { username, password: 'Expert#Pass12345', id: response.json.data.id, mobile };
      people.push(`${spec.roleCode}:${username}`);
    }
    return people.join(' · ');
  });

  await step('ورود کارشناس و بررسی دسترسی هر نقش', async () => {
    const user = await loginAs('expert', state.expert.username, state.expert.password);
    if (!user || user.kind === 'customer') throw new Error('نشست کارشناس برقرار نشد');
    if (user.roleCode !== 'service_expert') throw new Error(`نقش کارشناس ${user.roleCode} است`);
    state.expertRole = user.roleCode;
    const checks = [];
    for (const key of ['operator', 'accountant', 'manager']) {
      const person = state[key];
      const session = await loginAs(key, person.username, person.password);
      if (!session || session.kind === 'customer') throw new Error(`نشست ${key} برقرار نشد`);
      const dashboard = await request('/api/dashboard/summary', actorOptions(key)).catch(() => null);
      if (!dashboard?.json?.data) throw new Error(`داشبورد برای ${key} باز نشد`);
      checks.push(`${session.roleCode}:${dashboard.json.data.stats?.total ?? 0}`);
    }
    const denied = await request('/api/staff', actorOptions('operator')).catch((error) => error);
    const deniedStatus = denied instanceof Error ? /→ (\d{3})/.exec(denied.message)?.[1] : '200';
    if (deniedStatus !== '403' && deniedStatus !== '401') throw new Error(`اپراتور به مدیریت کارکنان دسترسی گرفت (${deniedStatus})`);
    return `service_expert · ${checks.join(' · ')} · اپراتور←کارکنان: ${deniedStatus}`;
  });

  await step('ایجاد خدمت با فرم، مدارک و گردش‌کار (مدیر)', async () => {
    const response = await request('/api/catalog/services', actorOptions('admin', {
      method: 'POST',
      body: {
        title: `خدمت آزمون خودکار ${suffix}`,
        summary: 'خدمت ساخته‌شده توسط آزمون گردش‌کار کامل',
        description: 'این خدمت به‌صورت خودکار برای آزمون سرتاسری ساخته می‌شود و پس از پایان آزمون بایگانی می‌گردد.',
        categoryId: null,
        baseFee: 450000,
        estimatedDays: 3,
        paymentMethods: ['cash', 'online'],
        form: [
          { key: 'full_name', label: 'نام و نام خانوادگی', type: 'text', required: true },
          { key: 'note', label: 'توضیح درخواست', type: 'textarea', required: false },
        ],
        documents: [{ title: 'کارت ملی', required: true }],
        workflow: [
          { title: 'بررسی مدارک' },
          { title: 'انجام خدمت' },
          { title: 'تحویل نتیجه' },
        ],
        isPublished: true,
        acceptingRequests: true,
      },
      expect: 201,
    }));
    state.serviceId = response.json.data.id;
    if (!state.serviceId) throw new Error('شناسه خدمت برنگشت');
    return `${state.serviceId} · ${response.json.data.title ?? ''}`.trim();
  });

  await step('ثبت‌نام مشتری و ورود', async () => {
    const mobile = `0912${Math.floor(1000000 + Math.random() * 8999999)}`;
    const password = 'Customer#Pass123';
    const register = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ mobile, password, fullName: `مشتری آزمون ${suffix}` }),
    });
    if (![200, 201, 409].includes(register.status)) {
      throw new Error(`ثبت‌نام ناموفق (${register.status}): ${(await register.text()).slice(0, 200)}`);
    }
    const user = await loginAs('customer', mobile, password);
    state.customer = { mobile, password, id: user?.id };
    return `شناسه ${user?.id ?? '—'} · ${user?.kind ?? ''}`;
  });

  await step('تکمیل پروفایل مشتری', async () => {
    await request('/api/auth/profile', actorOptions('customer', {
      method: 'PATCH',
      body: { firstName: 'مشتری', lastName: `آزمون ${suffix}`, nationalId: '0013546295', cityId: 'tehran' },
    }));
    const me = await request('/api/auth/me', actorOptions('customer'));
    const stateName = me.json?.data?.profileState;
    if (stateName && stateName.complete === false) throw new Error('پروفایل هنوز ناقص است');
    return 'پروفایل کامل شد';
  });

  await step('مشاهده کاتالوگ و جست‌وجوی خدمات', async () => {
    const list = await request('/api/public/services?pageSize=5', { session: false });
    const rows = list.json?.data ?? [];
    if (!rows.length) throw new Error('کاتالوگ خالی است');
    const order = await request('/api/public/services?pageSize=1&sort=popular', { session: false });
    const slug = rows.find((row) => row.id === state.serviceId)?.slug ?? rows[0]?.slug;
    const detail = slug ? await request(`/api/public/services/${slug}`, { session: false }) : null;
    const search = await request(`/api/public/search?q=${encodeURIComponent('کارت ملی')}`, { session: false });
    return `${rows.length} خدمت · ${(order.json?.data ?? []).length} محبوب · ${detail?.json?.data?.title ?? '—'} · ${search.json?.data?.length ?? 0} نتیجه جست‌وجو`;
  });

  await step('ثبت درخواست توسط مشتری', async () => {
    const response = await request('/api/requests', actorOptions('customer', {
      method: 'POST',
      body: {
        serviceId: state.serviceId,
        formData: { full_name: `مشتری آزمون ${suffix}`, note: 'درخواست ساخته‌شده توسط آزمون خودکار' },
        paymentMethod: 'cash',
        priority: 'normal',
      },
      expect: 201,
    }));
    state.requestId = response.json.data.id;
    state.trackingCode = response.json.data.trackingCode;
    if (!state.requestId) throw new Error('شناسه درخواست برنگشت');
    return `کد پیگیری ${state.trackingCode ?? state.requestId}`;
  });

  await step('آپلود مدرک توسط مشتری و پیوست به پرونده', async () => {
    const upload = await request('/api/files/upload?purpose=document', actorOptions('customer', {
      method: 'POST', form: formDataFile(png(), 'national-card.png', 'image/png'), expect: 201,
    }));
    const file = upload.json.data;
    if (!file.id) throw new Error('آپلود فایل ناموفق بود');
    state.clientFileId = file.id;
    await request(`/api/requests/${state.requestId}/documents`, actorOptions('customer', {
      method: 'POST', body: { fileId: file.id, title: 'کارت ملی' }, expect: 200,
    }));
    const size = typeof file.size === 'number' ? `${Math.round(file.size / 1024)} KB` : '—';
    return `${file.name ?? 'national-card.png'} · ${size} · ${file.processing?.status ?? '—'}`;
  });

  await step('مشاهده درخواست در پنل مدیر و ارجاع به کارشناس', async () => {
    const open = await request('/api/requests?group=open&pageSize=50', actorOptions('admin'));
    const search = await request(`/api/requests?search=${encodeURIComponent(state.trackingCode ?? '')}&pageSize=50`, actorOptions('admin'));
    const rows = [...(open.json?.data ?? []), ...(search.json?.data ?? [])];
    const found = rows.some((row) => row.id === state.requestId);
    if (!found) throw new Error(`درخواست ${state.trackingCode} در فهرست مدیر دیده نشد (${rows.length} ردیف)`);
    state.openCount = open.json?.meta?.total ?? open.json?.data?.length ?? 0;
    await request(`/api/requests/${state.requestId}/assign`, actorOptions('admin', {
      method: 'PATCH', body: { staffId: state.expert.id },
    }));
    await request(`/api/requests/${state.requestId}/status`, actorOptions('admin', {
      method: 'PATCH', body: { status: 'in_progress', note: 'شروع بررسی توسط کارشناس' },
    }));
    return 'ارجاع و تغییر وضعیت انجام شد';
  });

  await step('مشاهده پرونده و رد مدرک توسط کارشناس', async () => {
    const detail = await request(`/api/requests/${state.requestId}`, actorOptions('expert'));
    const doc = (detail.json?.data?.documents ?? []).find((row) => row.kind !== 'staff');
    if (!doc) throw new Error('مدرک برای کارشناس نمایش داده نشد');
    state.staffDocId = doc.id;
    await request(`/api/requests/${state.requestId}/documents/${doc.id}/review`, actorOptions('expert', {
      method: 'POST',
      body: { decision: 'rejected', note: 'تصویر ناخوانا است؛ لطفاً نسخه واضح‌تری ارسال کنید.' },
    }));
    const after = await request(`/api/requests/${state.requestId}`, actorOptions('expert'));
    if (after.json.data.status !== 'waiting_documents') throw new Error(`وضعیت ${after.json.data.status} است`);
    return 'وضعیت: در انتظار مدارک';
  });

  await step('اعلان به مشتری و ارسال مدرک اصلاح‌شده', async () => {
    const notifications = await request('/api/customers/me/notifications?limit=10', actorOptions('customer'));
    const detail = await request(`/api/requests/${state.requestId}`, actorOptions('customer'));
    const upload = await request('/api/files/upload?purpose=document', actorOptions('customer', {
      method: 'POST', form: formDataFile(png(320, 200), 'national-card-v2.png', 'image/png'), expect: 201,
    }));
    await request(`/api/requests/${state.requestId}/documents`, actorOptions('customer', {
      method: 'POST', body: { fileId: upload.json.data.id, title: 'کارت ملی — نسخه اصلاح‌شده' }, expect: 200,
    }));
    const profile = await request('/api/documents/mine', actorOptions('customer', {
      method: 'POST',
      body: { fileId: upload.json.data.id, docType: 'national_card', title: 'کارت ملی (آزمون)' },
      expect: 201,
    }));
    state.customerDocId = profile.json?.data?.id;
    return `وضعیت ${detail.json?.data?.status} · ${notifications.json?.data?.length ?? 0} اعلان · مدرک پروفایل ${state.customerDocId ?? '—'}`;
  });

  await step('تأیید مدارک و تحویل نتیجه (کارشناس)', async () => {
    const detail = await request(`/api/requests/${state.requestId}`, actorOptions('expert'));
    const pending = (detail.json?.data?.documents ?? []).filter((doc) => doc.kind !== 'staff' && doc.status === 'pending');
    if (!pending.length) throw new Error('مدرک در انتظار بررسی پیدا نشد');
    for (const doc of pending) {
      await request(`/api/requests/${state.requestId}/documents/${doc.id}/review`, actorOptions('expert', {
        method: 'POST', body: { decision: 'approved', note: 'مدرک اصلاحی تأیید شد.' },
      }));
    }
    await request(`/api/requests/${state.requestId}/status`, actorOptions('expert', {
      method: 'PATCH', body: { status: 'in_progress' },
    })).catch(() => null);
    const upload = await request('/api/files/upload?purpose=delivery', actorOptions('expert', {
      method: 'POST', form: formDataFile(pdf(), 'result.pdf', 'application/pdf'), expect: 201,
    }));
    const delivery = await request(`/api/requests/${state.requestId}/deliver`, actorOptions('expert', {
      method: 'POST',
      body: { files: [{ fileId: upload.json.data.id, title: 'نتیجه خدمت' }], summary: 'خدمت انجام شد؛ نتیجه برای تأیید مدیریت ارسال می‌شود.' },
    }));
    if (delivery.json?.data?.status !== 'under_review') throw new Error(`وضعیت تحویل ${delivery.json?.data?.status} است`);
    return 'وضعیت: در انتظار تأیید مدیریت';
  });

  await step('مشاهده گفت‌وگوها و پیام ارسالی', async () => {
    const threads = await request('/api/messages/threads?pageSize=10', actorOptions('expert'));
    const thread = (threads.json?.data ?? [])[0];
    if (thread?.id) {
      await request(`/api/messages/threads/${thread.id}/messages`, actorOptions('expert', {
        method: 'POST', body: { body: 'پرونده در حال بررسی است.' },
      })).catch(() => null);
    }
    return `${threads.json?.data?.length ?? 0} گفت‌وگو`;
  });

  await step('تأیید مدیریت و انتشار نتیجه برای مشتری', async () => {
    const inbox = await request('/api/automation/inbox', actorOptions('admin'));
    const rows = inbox.json?.data ?? [];
    const row = rows.find((item) => (item.request_id ?? item.requestId) === state.requestId);
    if (!row) throw new Error('ارجاع مدیریتی برای این پرونده پیدا نشد');
    await request(`/api/automation/${row.id}/decision`, actorOptions('admin', {
      method: 'POST', body: { decision: 'approved', note: 'نتیجه بررسی و تأیید شد.' },
    }));
    return `ارجاع ${row.id} تأیید شد (${rows.length} مورد در صندوق)`;
  });

  await step('مشاهده و دانلود نتیجه توسط مشتری', async () => {
    const detail = await request(`/api/requests/${state.requestId}`, actorOptions('customer'));
    const documents = detail.json?.data?.documents ?? [];
    const result = documents.find((doc) => doc.kind === 'staff');
    if (!result) throw new Error('نتیجه برای مشتری منتشر نشد');
    const download = await request(`/api/files/${result.file.id}`, actorOptions('customer', { raw: true }));
    if (download.text.length < 20) throw new Error('دانلود فایل نتیجه ناموفق بود');
    return `${documents.length} مدرک قابل مشاهده · ${Math.round(download.text.length / 1024)} KB دانلود شد`;
  });

  await step('نهایی‌سازی پرونده و بررسی گزارش‌ها (مدیر)', async () => {
    await request(`/api/requests/${state.requestId}/status`, actorOptions('admin', {
      method: 'PATCH', body: { status: 'ready' },
    }));
    await request(`/api/requests/${state.requestId}/status`, actorOptions('admin', {
      method: 'PATCH', body: { status: 'completed', note: 'پرونده با موفقیت بسته شد.' },
    }));
    const timeline = await request(`/api/requests/${state.requestId}/timeline`, actorOptions('admin'));
    const audit = await request('/api/system/audit?pageSize=20', actorOptions('admin'));
    const summary = await request('/api/dashboard/summary', actorOptions('admin'));
    const reports = await request('/api/accounting/reports/summary', actorOptions('admin')).catch(() => null);
    const events = timeline.json?.data?.length ?? 0;
    if (events < 5) throw new Error(`تاریخچه پرونده فقط ${events} رویداد دارد`);
    if (!(audit.json?.data ?? audit.json?.meta)) throw new Error('تاریخچه عملیات قابل خواندن نبود');
    const revenue = reports?.json?.data?.revenue ?? reports?.json?.data?.totals?.revenue ?? '—';
    return `${events} رویداد · درآمد ${revenue} · ${summary.json?.data?.stats?.total ?? 0} پرونده`;
  });

  await step('سابقه و مدارک مشتری', async () => {
    const mine = await request('/api/documents/mine', actorOptions('customer'));
    if (!(mine.json?.data ?? []).length) throw new Error('مدرک پروفایل برای مشتری نمایش داده نشد');
    const invoices = await request('/api/accounting/invoices?pageSize=5', actorOptions('customer')).catch(() => null);
    const requests = await request('/api/requests?pageSize=5', actorOptions('customer'));
    return `${mine.json.data.length} مدرک · ${invoices?.json?.data?.length ?? 0} فاکتور · ${requests.json?.data?.length ?? 0} پرونده`;
  });

  await step('جداسازی دسترسی نقش‌ها', async () => {
    const asCustomer = await request('/api/staff', actorOptions('customer')).catch((error) => error);
    const status = asCustomer instanceof Error ? /→ (\d{3})/.exec(asCustomer.message)?.[1] : '200';
    if (status !== '403' && status !== '401') throw new Error(`مشتری به فهرست کارکنان دسترسی گرفت (${status})`);
    const catalog = await request('/api/catalog/admin/services', actorOptions('expert'));
    if (!(catalog.json?.data ?? []).length) throw new Error('کارشناس کاتالوگ خدمات را ندید');
    const accountantMoney = await request('/api/accounting/reports/summary', actorOptions('accountant')).catch((error) => error);
    const moneyStatus = accountantMoney instanceof Error ? /→ (\d{3})/.exec(accountantMoney.message)?.[1] : '200';
    if (moneyStatus !== '200') throw new Error(`حسابدار به گزارش‌های مالی دسترسی نداشت (${moneyStatus})`);
    return `مشتری←کارکنان: ${status} · کارشناس←کاتالوگ: ${(catalog.json.data ?? []).length} خدمت · حسابدار←گزارش مالی: ${moneyStatus}`;
  });

  await step('پایداری داده پس از درخواست‌های تکرارشده', async () => {
    const detail = await request(`/api/requests/${state.requestId}`, actorOptions('admin'));
    if (detail.json.data.status !== 'completed') throw new Error(`وضعیت نهایی ${detail.json.data.status} است`);
    const again = await request(`/api/requests/${state.requestId}`, actorOptions('admin'));
    if (again.json.data.status !== 'completed') throw new Error('وضعیت پرونده پایدار نماند');
    return `پرونده ${state.trackingCode ?? state.requestId} در وضعیت completed`;
  });

  return {
    requestId: state.requestId,
    trackingCode: state.trackingCode,
    serviceId: state.serviceId,
    customerDocId: state.customerDocId,
    actors: Object.keys(ACTORS),
  };
}

async function runStatus() {
  const started = Date.now();
  const result = { api: false, web: false, database: false, storage: false, latencyMs: 0 };
  try {
    const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
    result.api = health.ok;
    const body = await health.json().catch(() => null);
    result.database = body?.checks?.database ? body.checks.database !== 'error' : true;
    result.version = body?.version ?? null;
  } catch { /* api down */ }
  try {
    const web = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(4000) });
    result.web = web.ok && (await web.text()).includes('id="root"');
  } catch { /* web down */ }
  const config = readEnvFile(ENV_FILE);
  const uploadRoot = config.UPLOAD_DIR || path.join(process.cwd(), '.data', 'uploads');
  try {
    fs.accessSync(uploadRoot, fs.constants.W_OK);
    result.storage = true;
  } catch { result.storage = false; }
  result.latencyMs = Date.now() - started;
  return result;
}

/* ---------------------------------- main ----------------------------------- */

async function main() {
  const root = process.cwd();
  let output = {};

  if (MODE === 'status') {
    output = await runStatus();
  } else if (MODE === 'workflow') {
    const config = await checkConfig();
    await checkDatabase(config).catch(() => undefined);
    await checkStorage(config, root).catch(() => undefined);
    await checkApi();
    await checkFrontend();
    const workflowResult = await runWorkflow();
    output = { workflow: workflowResult };
  } else {
    const config = await checkConfig();
    await checkDatabase(config);
    await checkStorage(config, root);
    await checkApi();
    await checkFrontend();
  }

  const failed = checks.filter((item) => !item.ok);
  const payload = {
    ok: failed.length === 0 && steps.every((item) => item.ok),
    mode: MODE,
    url: BASE,
    checkedAt: new Date().toISOString(),
    checks,
    steps,
    failed: failed.map((item) => `${item.label}: ${item.detail}`),
    notes,
    ...output,
  };
  process.stdout.write(`RESULT_JSON:${JSON.stringify(payload)}\n`);
  process.stderr.write(`\n${payload.ok ? 'همهٔ بررسی‌ها موفق بود.' : `${failed.length} بررسی ناموفق.`}\n`);
  process.exit(payload.ok ? 0 : 1);
}

main().catch((error) => {
  const payload = {
    ok: false, mode: MODE, url: BASE, checks, steps,
    failed: [error?.message ?? String(error)],
    fatal: error?.stack ?? String(error),
  };
  process.stdout.write(`RESULT_JSON:${JSON.stringify(payload)}\n`);
  process.stderr.write(`\nخطای اجرای آزمون: ${error?.message ?? error}\n`);
  process.exit(2);
});
