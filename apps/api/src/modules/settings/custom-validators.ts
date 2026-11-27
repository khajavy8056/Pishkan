/**
 * Per-key setting validators beyond the generic type checks.
 *
 * Keys here are validated (and for Enamad, rewritten to a safe canonical
 * form) at write time, so everything stored is already safe to serve.
 */
import { sanitizeEnamadSetting } from './enamad.js';

type Validator = (value: string) => string;

function fail(message: string): never {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = 400;
  throw err;
}

export const CUSTOM_VALIDATORS: Record<string, Validator> = {
  'site.enamad_code': (value) => {
    try {
      return sanitizeEnamadSetting(value);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'کد اینماد معتبر نیست.');
    }
  },
  'seo.ga_measurement_id': (value) => {
    const v = value.trim();
    if (v && !/^G-[A-Z0-9]{6,12}$/.test(v)) fail('شناسهٔ Google Analytics باید قالب G-XXXXXXXXXX داشته باشد.');
    return v;
  },
  'seo.gtm_container_id': (value) => {
    const v = value.trim();
    if (v && !/^GTM-[A-Z0-9]{4,10}$/.test(v)) fail('شناسهٔ Google Tag Manager باید قالب GTM-XXXXXXX داشته باشد.');
    return v;
  },
  'seo.google_site_verification': (value) => {
    const v = value.trim();
    if (v && !/^[A-Za-z0-9_-]{8,120}$/.test(v)) fail('توکن تأیید Search Console فقط شامل حروف، عدد، خط تیره و زیرخط است.');
    return v;
  },
  'seo.bing_site_verification': (value) => {
    const v = value.trim();
    if (v && !/^[A-Za-z0-9_-]{8,120}$/.test(v)) fail('توکن تأیید Bing معتبر نیست.');
    return v;
  },
  'seo.canonical_base': (value) => {
    const v = value.trim().replace(/\/+$/, '');
    if (v && !/^https:\/\/[^\s/]+(\.[^\s/]+)+(:\d+)?$/.test(v)) fail('نشانیٔ Canonical باید https://domain باشد (بدون مسیر).');
    return v;
  },
  'seo.robots_extra': (value) => {
    const v = value.trim();
    if (v.length > 4000) fail('متن robots.txt بیش از حد طولانی است.');
    // Only directive lines; never allow HTML or script fragments into a text/plain file.
    for (const line of v.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (!/^(User-agent|Disallow|Allow|Sitemap|Crawl-delay|Host)\s*:/i.test(t) && !t.startsWith('#')) {
        fail(`خط «${t.slice(0, 60)}» یک دستور معتبر robots.txt نیست.`);
      }
    }
    return v;
  },
  'seo.org_json_ld': (value) => {
    const v = value.trim();
    if (!v) return '';
    let parsed: unknown;
    try { parsed = JSON.parse(v); } catch { return fail('JSON-LD باید JSON معتبر باشد.'); }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('JSON-LD باید یک آبجکت باشد.');
    if (v.length > 8000) fail('JSON-LD بیش از حد طولانی است.');
    return v;
  },
  'guard.sms_events': (value) => {
    const v = value.trim();
    if (!v) return '[]';
    let parsed: unknown;
    try { parsed = JSON.parse(v); } catch { return fail('فهرست رویدادهای پیامکی باید JSON معتبر باشد.'); }
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string' || !/^[a-z_]{2,40}$/.test(x))) {
      fail('فهرست رویدادهای پیامکی باید آرایه‌ای از نام kindها باشد، مثل ["auth_bruteforce","suspicious_upload"].');
    }
    return JSON.stringify(parsed);
  },
  'guard.trusted_ips': (value) => {
    const v = value.trim();
    if (!v) return '';
    const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (!/^[0-9a-fA-F:.]{3,45}$/.test(part)) fail(`«${part}» یک IP معتبر نیست.`);
    }
    return parts.join(',');
  },
  'backup.external_path': (value) => {
    const v = value.trim() || 'pishkan-backups';
    if (v.includes('..') || /[\\<>"|?*]/.test(v) || v.length > 200) fail('مسیر مقصد بکاپ نامعتبر است.');
    return v;
  },
  'backup.gdrive_folder_id': (value) => {
    const v = value.trim();
    if (v && !/^[A-Za-z0-9_-]{10,80}$/.test(v)) fail('شناسهٔ پوشه Google Drive معتبر نیست.');
    return v;
  },
};
