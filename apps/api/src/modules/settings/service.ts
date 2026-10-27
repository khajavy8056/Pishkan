import { q, one, run, nowIso, jsonParse } from '../../db/index.js';
import { decryptSecret, encryptSecret, maskSecret } from '../../lib/crypto.js';
import { SETTINGS, SETTING_GROUPS, settingDef, type SettingDef, type SettingGroupCode } from './definitions.js';
import { HttpError, badRequest } from '../../http/errors.js';
import { writeAudit } from '../audit/service.js';

type Value = string | number | boolean;
let cache: Map<string, string> | null = null;

function decode(def: SettingDef | undefined, raw: string | null | undefined): Value {
  if (!def) return raw ?? '';
  if (raw === null || raw === undefined) return def.default;
  switch (def.type) {
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'number':
      return raw === '' ? Number(def.default) : Number(raw);
    default:
      return raw;
  }
}

function tooLong(raw: string, def: SettingDef) {
  // cheap DoS guard; individual field validation happens below
  if (raw.length > 200_000) throw badRequest(`مقدار «${def.label}» بیش از حد طولانی است.`);
}

function validate(def: SettingDef, value: Value): string {
  const str = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? '');
  tooLong(str, def);

  if (def.type === 'number') {
    const n = Number(str === '' ? def.default : str);
    if (!Number.isFinite(n)) throw badRequest(`«${def.label}» باید عدد باشد.`);
    if (def.min !== undefined && n < def.min) throw badRequest(`«${def.label}» نباید کمتر از ${def.min} باشد.`);
    if (def.max !== undefined && n > def.max) throw badRequest(`«${def.label}» نباید بیشتر از ${def.max} باشد.`);
    return String(n);
  }
  if (def.type === 'boolean') {
    return value === true || str === 'true' || str === '1' ? 'true' : 'false';
  }
  if (def.type === 'json') {
    try {
      JSON.parse(str || 'null');
    } catch {
      throw badRequest(`«${def.label}» باید JSON معتبر باشد.`);
    }
    return str === '' ? 'null' : str;
  }
  if (def.type === 'url' && str) {
    if (!/^https?:\/\/[^\s]+$/i.test(str)) throw badRequest(`«${def.label}» باید نشانی معتبر با http یا https باشد.`);
  }
  if (def.type === 'email' && str && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
    throw badRequest(`«${def.label}» ایمیل معتبر نیست.`);
  }
  if (def.type === 'color' && str && !/^#[0-9a-f]{6}$/i.test(str)) {
    throw badRequest(`«${def.label}» باید یک رنگ hex مانند #1d4ed8 باشد.`);
  }
  if (def.type === 'cron' && str) {
    const parts = str.trim().split(/\s+/);
    if (parts.length !== 5) throw badRequest(`«${def.label}» باید قالب cron پنج‌بخشی داشته باشد.`);
  }
  if (def.type === 'tel' && str && !/^[0-9+\-\s()]{6,20}$/.test(str)) {
    throw badRequest(`«${def.label}» شماره تماس معتبر نیست.`);
  }
  const maxLen = def.type === 'textarea' ? 20000 : def.type === 'text' || def.type === 'password' ? 2000 : 500;
  if (str.length > maxLen) throw badRequest(`«${def.label}» بیش از حد طولانی است.`);
  return str;
}

/** Load every setting into an in-process cache (invalidated on writes). */
async function loadCache(): Promise<Map<string, string>> {
  if (cache) return cache;
  const rows = await q<{ key: string; value: string | null }>('SELECT key, value FROM settings');
  cache = new Map(rows.map((r) => [r.key, r.value ?? '']));
  return cache;
}

/** Create missing rows from the catalogue. Safe to run on every boot. */
export async function ensureSettingDefaults(): Promise<number> {
  const existing = new Set((await q<{ key: string }>('SELECT key FROM settings')).map((r) => r.key));
  const ts = nowIso();
  let inserted = 0;
  for (const def of SETTINGS) {
    if (existing.has(def.key)) {
      if(def.secret){const row=await one<any>('SELECT value FROM settings WHERE key=?',[def.key]);if(row?.value && !row.value.startsWith('v1:'))await run('UPDATE settings SET value=?,is_secret=1 WHERE key=?',[encryptSecret(row.value),def.key]);}
      continue;
    }
    await run(
      'INSERT INTO settings (key, value, group_name, is_secret, updated_at) VALUES (?, ?, ?, ?, ?)',
      [def.key, String(def.default), def.group, def.secret ? 1 : 0, ts],
    );
    inserted += 1;
  }
  cache = null;
  return inserted;
}

/* --------------------------------- read API -------------------------------- */

/** Raw, decrypted value for internal use (may contain secrets). */
export async function getSetting(key: string): Promise<Value> {
  const map = await loadCache();
  const def = settingDef(key);
  return decode(def, map.get(key) ?? null);
}
export async function getString(key: string): Promise<string> {
  const v = await getSetting(key);
  return typeof v === 'string' ? v : String(v);
}
export async function getBool(key: string): Promise<boolean> {
  const v = await getSetting(key);
  return v === true || v === 'true';
}
export async function getNumber(key: string): Promise<number> {
  const v = await getSetting(key);
  return Number(v);
}
export async function getJson<T>(key: string, fallback: T): Promise<T> {
  const v = await getString(key);
  return jsonParse<T>(v, fallback);
}

/** Decrypted secret value (server side only). */
export async function getSecret(key: string): Promise<string> {
  const row = await one<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', [key]);
  return decryptSecret(row?.value ?? '');
}

/** Bulk read without secret decryption — used by internal services. */
export async function getMany(keys: string[]): Promise<Record<string, Value>> {
  const out: Record<string, Value> = {};
  for (const key of keys) out[key] = await getSetting(key);
  return out;
}

/** Everything a browser needs before login (branding, feature flags, legal texts). */
export async function publicSettings(): Promise<Record<string, Value>> {
  const out: Record<string, Value> = {};
  for (const def of SETTINGS) {
    if (!def.public) continue;
    out[def.key] = await getSetting(def.key);
  }
  return out;
}

export interface AdminSettingView {
  key: string;
  group: SettingGroupCode;
  type: SettingDef['type'];
  label: string;
  hint?: string;
  value: Value | '';
  hasValue: boolean;
  masked?: string;
  isSecret: boolean;
  options?: SettingDef['options'];
  min?: number;
  max?: number;
  placeholder?: string;
  critical?: boolean;
  defaultValue: Value;
}

/** Grouped view for the admin settings UI — secrets are masked, never exposed. */
export async function adminSettingsView(): Promise<{
  groups: typeof SETTING_GROUPS;
  settings: AdminSettingView[];
  lastUpdated: string | null;
}> {
  const rows = await q<{ key: string; value: string | null; updated_at: string }>('SELECT key, value, updated_at FROM settings');
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const settings: AdminSettingView[] = [];
  let lastUpdated = '';

  for (const def of SETTINGS) {
    const row = byKey.get(def.key);
    if (row && row.updated_at > lastUpdated) lastUpdated = row.updated_at;

    if (def.secret) {
      const clear = decryptSecret(row?.value ?? '');
      settings.push({
        key: def.key, group: def.group, type: def.type, label: def.label, hint: def.hint,
        value: '', hasValue: clear.length > 0, masked: maskSecret(clear), isSecret: true,
        options: def.options, min: def.min, max: def.max, placeholder: def.placeholder,
        critical: def.critical, defaultValue: def.default,
      });
      continue;
    }

    settings.push({
      key: def.key,
      group: def.group,
      type: def.type,
      label: def.label,
      hint: def.hint,
      value: decode(def, row?.value ?? null),
      hasValue: (row?.value ?? '').length > 0,
      isSecret: false,
      options: def.options,
      min: def.min,
      max: def.max,
      placeholder: def.placeholder,
      critical: def.critical,
      defaultValue: def.default,
    });
  }

  return { groups: SETTING_GROUPS, settings, lastUpdated: lastUpdated || null };
}

/* --------------------------------- write API ------------------------------- */

const protectedKeys = new Set(['auth.customer_otp_enabled', 'auth.customer_password_enabled']);

/**
 * Apply a patch of settings.
 *
 * Guards against locking the super admin out: at least one customer login method
 * must remain enabled and the global request intake can only change if an
 * explicit confirmation flag is passed.
 */
export async function updateSettings(
  patch: Record<string, unknown>,
  actor: { id: string; name: string; ip?: string },
  confirmations: { confirmCritical?: boolean } = {},
): Promise<{ updated: string[] }> {
  const entries = Object.entries(patch ?? {});
  if (entries.length === 0) return { updated: [] };

  const unknown = entries.filter(([k]) => !settingDef(k));
  if (unknown.length) throw badRequest(`تنظیم ناشناخته: ${unknown.map(([k]) => k).join(', ')}`);

  const normalized: [SettingDef, string][] = entries.map(([key, value]) => {
    const def = settingDef(key)!;
    if (def.secret) {
      const raw = typeof value === 'string' ? value.trim() : '';
      // empty string means "keep the stored secret"
      if (raw === '' || raw.startsWith('••')) return [def, '__KEEP__'];
      return [def, `__ENC__${encryptSecret(raw)}`];
    }
    return [def, validate(def, value as Value)];
  });

  const criticalChanged = normalized.some(([def]) => def.critical);
  if (criticalChanged && !confirmations.confirmCritical) {
    throw badRequest('این تنظیم حساس است. برای اعمال، گزینه تأیید را فعال کنید.');
  }

  // Safety: never allow every customer login method to be switched off.
  const booleanPatch = new Map(normalized.filter(([, v]) => v === 'true' || v === 'false').map(([d, v]) => [d.key, v === 'true']));
  for (const key of protectedKeys) {
    if (!booleanPatch.has(key)) booleanPatch.set(key, await getBool(key));
  }
  if (!booleanPatch.get('auth.customer_otp_enabled') && !booleanPatch.get('auth.customer_password_enabled')) {
    throw badRequest('حداقل یکی از روش‌های ورود مشتریان (کد یک‌بارمصرف یا رمز عبور) باید فعال بماند.');
  }

  /**
   * Lockout protection for administrators.
   *
   * Disabling staff password login leaves OTP as the only way in, so it is only
   * allowed when SMS is actually usable *and* at least one active administrator
   * has a mobile number. Otherwise the only super admin could be locked out with
   * no self-service recovery path.
   */
  if (booleanPatch.get('auth.staff_password_login') === false) {
    const smsEnabled = await getBool('sms.enabled');
    if (!(booleanPatch.get('auth.staff_otp_enabled') ?? await getBool('auth.staff_otp_enabled'))) throw badRequest('پیش از حذف ورود رمزی، ورود پیامکی کارکنان را فعال کنید.');
    const provider = await getString('sms.provider');
    const hasCredential = Boolean((await getSecret('sms.api_key')) || (await getSecret('sms.password')));
    const adminWithMobile = await one<{ id: string }>(
      `SELECT id FROM users WHERE kind = 'admin' AND status = 'active' AND mobile IS NOT NULL AND mobile <> '' LIMIT 1`,
    );
    if (!smsEnabled) {
      throw badRequest('پیش از غیرفعال‌کردن ورود با رمز، ارسال پیامک باید فعال باشد.');
    }
    if (provider === 'console' && process.env.NODE_ENV === 'production') {
      throw badRequest('حالت شبیه‌ساز پیامک در محیط تولید قابل استفاده برای بازیابی ورود نیست.');
    }
    if (provider !== 'console' && !hasCredential) {
      throw badRequest('تا زمانی که اعتبارنامه سرویس پیامک ثبت نشده است، ورود کارکنان با رمز عبور قابل غیرفعال‌سازی نیست.');
    }
    if (!adminWithMobile) {
      throw badRequest('پیش از غیرفعال‌کردن ورود با رمز، شماره موبایل یک مدیر کل فعال را ثبت کنید تا امکان ورود باقی بماند.');
    }
  }

  if(booleanPatch.get('auth.staff_mfa_required')===true || booleanPatch.get('security.require_mfa_finance')===true){
    const missing=await one<any>("SELECT id FROM users WHERE kind IN ('admin','staff') AND status='active' AND mfa_enabled=0 LIMIT 1");
    if(missing)throw badRequest('پیش از الزام تأیید دومرحله‌ای، حساب‌های فعال باید آن را فعال کنند.');
  }
  const ts = nowIso();
  const before = await adminSettingsView();
  const beforeValues = new Map(before.settings.map((s) => [s.key, s]));

  for (const [def, raw] of normalized) {
    if (raw === '__KEEP__') continue;
    const stored = raw.startsWith('__ENC__') ? raw.slice('__ENC__'.length) : raw;
    await run(
      `INSERT INTO settings (key, value, group_name, is_secret, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [def.key, stored, def.group, def.secret ? 1 : 0, ts, actor.id],
    );
  }

  cache = null;

  const changedKeys = normalized.filter(([, v]) => v !== '__KEEP__').map(([d]) => d.key);
  await writeAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: 'settings.update',
    entityType: 'settings',
    entityId: changedKeys.join(','),
    before: Object.fromEntries(changedKeys.map((k) => [k, beforeValues.get(k)?.isSecret ? '[secret]' : beforeValues.get(k)?.value])),
    after: Object.fromEntries(normalized.filter(([, v]) => v !== '__KEEP__').map(([d, v]) => [d.key, d.secret ? '[secret]' : v])),
    ip: actor.ip,
  });

  return { updated: changedKeys };
}

export async function resetSetting(key: string, actor: { id: string; name: string }): Promise<void> {
  const def = settingDef(key);
  if (!def) throw new HttpError(404, 'تنظیم یافت نشد.');
  await run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [String(def.default), nowIso(), key]);
  cache = null;
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'settings.reset',
    entityType: 'settings', entityId: key, after: { key, value: def.default },
  });
}

/** Called by tests / long-running workers after external writes. */
export function invalidateSettingsCache(): void {
  cache = null;
}
