/**
 * Enamad (نماد اعتماد الکترونیکی) embed sanitizer.
 *
 * The office pastes the official snippet from trustseal.enamad.ir into a
 * setting. We never store or render raw admin HTML: the snippet is parsed,
 * every URL must be https on enamad.ir, and the output is REBUILT from the
 * validated parts. Anything else (scripts, other hosts, event handlers,
 * data: URLs) is rejected with a clear message — so the stored value is safe
 * to render in the public footer without a CSP exception.
 */

const ALLOWED_HOSTS = new Set(['enamad.ir', 'www.enamad.ir', 'trustseal.enamad.ir', 'logo.enamad.ir']);

export interface EnamadParts {
  /** click-through verification URL (a[href] or iframe[src]) */
  clickUrl: string;
  /** logo image URL when the snippet is <a><img></a>; null for iframe form */
  logoUrl: string | null;
  id: string;
  code: string;
}

function parseEnamadUrl(raw: string): { id: string; code: string; isLogo: boolean } | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  const id = url.searchParams.get('id') ?? '';
  const code = url.searchParams.get('Code') ?? url.searchParams.get('code') ?? '';
  if (!/^\d{1,12}$/.test(id)) return null;
  // The official logo URL (Logo.aspx?id=…) carries only the id; the
  // click-through URL carries id AND Code. Code, when present, is validated.
  const isLogo = /logo\.aspx/i.test(url.pathname);
  if (code !== '' && !/^[A-Za-z0-9]{4,64}$/.test(code)) return null;
  if (!isLogo && code === '') return null;
  return { id, code, isLogo };
}

/**
 * Parse and validate the official snippet. Throws Error with a Persian,
 * actionable message when the snippet is not a recognizable Enamad embed.
 */
export function parseEnamadSnippet(input: string): EnamadParts {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('کد اینماد خالی است.');
  if (/<\s*script/i.test(text)) {
    throw new Error('کد اینماد نباید اسکریپت داشته باشد؛ قطعهٔ رسمی بدون script (پیوند+تصویر یا iframe) را از پنل اینماد کپی کنید.');
  }
  if (/\son\w+\s*=/i.test(text)) {
    throw new Error('کد اینماد نباید رویداد inline (onclick و…) داشته باشد.');
  }
  const urls = [...text.matchAll(/https:\/\/[^\s"'<>]+/gi)].map((m) => m[0].replace(/&amp;/g, '&'));
  if (urls.length === 0) {
    throw new Error('در کد واردشده هیچ نشانی https://…enamad.ir پیدا نشد. کد رسمی را کامل از پنل اینماد کپی کنید.');
  }
  const parsed = urls.map((u) => ({ u, parts: parseEnamadUrl(u) }));
  const bad = parsed.find((p) => !p.parts);
  if (bad) {
    throw new Error('همهٔ نشانی‌های کد اینماد باید https و روی دامنهٔ enamad.ir با شناسهٔ معتبر باشند.');
  }
  const first = parsed[0].parts!;
  if (parsed.some((p) => p.parts!.id !== first.id || (p.parts!.code !== '' && first.code !== '' && p.parts!.code !== first.code))) {
    throw new Error('شناسه/کد در نشانی‌های کد اینماد یکسان نیست؛ کد را دوباره از پنل اینماد کپی کنید.');
  }
  const isIframe = /<\s*iframe/i.test(text);
  const hasImg = /<\s*img/i.test(text);
  if (!isIframe && !hasImg) {
    throw new Error('ساختار کد اینماد شناخته نشد؛ باید iframe یا پیوند حاوی تصویر لوگو باشد.');
  }
  const logo = parsed.find((p) => p.parts!.isLogo);
  const click = parsed.find((p) => !p.parts!.isLogo) ?? parsed[0];
  const code = parsed.find((p) => p.parts!.code !== '')?.parts!.code ?? '';
  return {
    clickUrl: click.u,
    logoUrl: isIframe ? null : (logo?.u ?? parsed[0].u),
    id: first.id,
    code,
  };
}

/** Rebuild the embed strictly from validated parts — deterministic, XSS-free. */
export function renderEnamadHtml(parts: EnamadParts): string {
  if (parts.logoUrl === null) {
    return `<iframe src="${parts.clickUrl}" title="نماد اعتماد الکترونیکی" width="125" height="125" style="border:none;overflow:hidden" referrerpolicy="origin" loading="lazy"></iframe>`;
  }
  return `<a href="${parts.clickUrl}" referrerpolicy="origin" target="_blank" rel="noopener noreferrer">`
    + `<img src="${parts.logoUrl}" alt="نماد اعتماد الکترونیکی" style="width:125px;height:125px;border:none" loading="lazy" referrerpolicy="origin">`
    + `</a>`;
}

/** Convenience: sanitize on write. Empty input passes through as empty. */
export function sanitizeEnamadSetting(value: string): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return renderEnamadHtml(parseEnamadSnippet(text));
}
