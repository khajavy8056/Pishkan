/**
 * Persian, right-to-left email templates.
 *
 * Every system email is built here from a small, typed contract — never from
 * free HTML a caller assembles — so the office name, the footer and the safety
 * wording are identical everywhere, and no template can accidentally embed a
 * secret. Each template returns both HTML (RTL, table-based for Outlook/Gmail
 * compatibility) and a plain-text part for clients that prefer it.
 *
 * Variables are HTML-escaped; a customer's name containing `<script>` renders
 * as text, not markup. Links are only ever built from the configured public
 * URL plus a one-time token, never from request headers.
 */

export const EMAIL_TEMPLATE_CODES = [
  'test',
  'password_reset',
  'password_changed',
  'email_verify',
  'staff_welcome',
  'notification',
  'ticket_created',
  'ticket_reply',
  'security_alert',
  'monitoring_alert',
] as const;
export type EmailTemplateCode = (typeof EMAIL_TEMPLATE_CODES)[number];

/** Which per-user preference category a template belongs to. */
export const TEMPLATE_CATEGORY: Record<EmailTemplateCode, 'tickets' | 'cases' | 'payments' | 'security' | 'announcements' | 'account'> = {
  test: 'account',
  password_reset: 'account',
  password_changed: 'account',
  email_verify: 'account',
  staff_welcome: 'account',
  notification: 'cases',
  ticket_created: 'tickets',
  ticket_reply: 'tickets',
  security_alert: 'security',
  monitoring_alert: 'security',
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface BaseOptions {
  officeName: string;
  title: string;
  /** Pre-escaped-safe paragraphs (escaped here). */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** A code shown in a monospace box (verification codes). */
  code?: string;
  footerNote?: string;
}

/** Table-based RTL shell — the layout Gmail and Outlook actually render. */
function base(opts: BaseOptions): { html: string; text: string } {
  const office = escapeHtml(opts.officeName);
  const title = escapeHtml(opts.title);
  const paragraphs = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.9;color:#334155;font-size:14px;">${escapeHtml(p)}</p>`).join('\n');
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr><td style="border-radius:10px;background:#0f766e;">
         <a href="${escapeHtml(opts.button.url)}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(opts.button.label)}</a>
       </td></tr></table>
       <p style="margin:0 0 14px;line-height:1.9;color:#64748b;font-size:12px;">اگر دکمه کار نکرد، این نشانی را در مرورگر باز کنید:<br/><span dir="ltr" style="word-break:break-all;">${escapeHtml(opts.button.url)}</span></p>`
    : '';
  const code = opts.code
    ? `<div style="margin:18px 0;padding:14px 22px;background:#f1f5f9;border-radius:10px;text-align:center;">
         <span dir="ltr" style="font-family:Consolas,monospace;font-size:26px;letter-spacing:6px;color:#0f172a;font-weight:700;">${escapeHtml(opts.code)}</span>
       </div>`
    : '';
  const footerNote = opts.footerNote
    ? `<p style="margin:0 0 10px;line-height:1.9;color:#94a3b8;font-size:12px;">${escapeHtml(opts.footerNote)}</p>` : '';
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #e2e8f0;">
          <span style="font-size:16px;font-weight:800;color:#0f766e;">${office}</span>
        </td></tr>
        <tr><td style="padding:24px 28px;" dir="rtl">
          <h1 style="margin:0 0 16px;font-size:18px;color:#0f172a;">${title}</h1>
          ${paragraphs}
          ${code}
          ${button}
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;border-radius:0 0 14px 14px;">
          ${footerNote}
          <p style="margin:0;line-height:1.9;color:#94a3b8;font-size:12px;">این ایمیل به‌صورت خودکار از سوی «${office}» ارسال شده است. اگر این درخواست را شما نداده‌اید، این پیام را نادیده بگیرید؛ هیچ تغییری بدون اقدام شما انجام نمی‌شود.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const textParts = [opts.title, '', ...opts.paragraphs];
  if (opts.code) textParts.push('', `کد: ${opts.code}`);
  if (opts.button) textParts.push('', `${opts.button.label}: ${opts.button.url}`);
  textParts.push('', opts.footerNote ?? '', `— ${opts.officeName} (پیام خودکار)`);
  return { html, text: textParts.filter((p) => p !== undefined).join('\n') };
}

export interface TemplateInput {
  officeName: string;
  /** Absolute base URL of the system, no trailing slash. Empty = no links. */
  publicUrl: string;
  variables: Record<string, string>;
}

function link(base: string, path: string): string {
  return base ? `${base.replace(/\/+$/, '')}${path}` : '';
}

export function renderEmailTemplate(code: EmailTemplateCode, input: TemplateInput): RenderedEmail {
  const v = input.variables;
  const name = v.full_name || 'کاربر گرامی';
  const office = input.officeName || 'تک پیشخوان';
  switch (code) {
    case 'test': {
      const body = base({
        officeName: office,
        title: 'آزمایش ارسال ایمیل',
        paragraphs: [
          'این یک ایمیل آزمایشی است که از تنظیمات سامانه ارسال شد.',
          'دریافت این پیام یعنی پیکربندی SMTP درست است و ایمیل‌های سامانه (بازیابی رمز، تأیید ایمیل، اعلان‌ها) به دست گیرندگان می‌رسد.',
        ],
      });
      return { subject: `✅ آزمایش ایمیل — ${office}`, ...body };
    }
    case 'password_reset': {
      const url = link(input.publicUrl, `/reset-password?token=${encodeURIComponent(v.token ?? '')}`);
      const body = base({
        officeName: office,
        title: 'بازیابی رمز عبور',
        paragraphs: [
          `${name} عزیز، درخواست بازیابی رمز عبور حساب شما ثبت شد.`,
          `برای تعیین رمز جدید روی دکمهٔ زیر بزنید. این لینک فقط یک بار و تا ${v.expires_minutes || '30'} دقیقهٔ دیگر معتبر است.`,
          'اگر این درخواست را شما نداده‌اید، هیچ کاری لازم نیست؛ رمز فعلی شما بدون تغییر باقی می‌ماند.',
        ],
        button: url ? { label: 'تعیین رمز عبور جدید', url } : undefined,
        footerNote: 'پس از تعیین رمز جدید، همهٔ نشست‌های قبلی شما بسته می‌شود.',
      });
      return { subject: `بازیابی رمز عبور — ${office}`, ...body };
    }
    case 'password_changed': {
      const body = base({
        officeName: office,
        title: 'رمز عبور شما تغییر کرد',
        paragraphs: [
          `${name} عزیز، رمز عبور حساب شما با موفقیت تغییر کرد و همهٔ نشست‌های قبلی بسته شد.`,
          'اگر این تغییر را شما انجام نداده‌اید، فوراً از مسیر «فراموشی رمز» رمز تازه تعیین کنید و به مدیر سامانه اطلاع دهید.',
        ],
      });
      return { subject: `تغییر رمز عبور — ${office}`, ...body };
    }
    case 'email_verify': {
      const url = v.token ? link(input.publicUrl, `/verify-email?token=${encodeURIComponent(v.token)}`) : '';
      const body = base({
        officeName: office,
        title: 'تأیید نشانی ایمیل',
        paragraphs: [
          `${name} عزیز، برای تأیید این نشانی ایمیل، کد زیر را در سامانه وارد کنید${url ? ' یا روی دکمهٔ تأیید بزنید' : ''}.`,
          `این کد تا ${v.expires_minutes || '30'} دقیقهٔ دیگر معتبر است.`,
        ],
        code: v.code || undefined,
        button: url ? { label: 'تأیید ایمیل', url } : undefined,
      });
      return { subject: `کد تأیید ایمیل — ${office}`, ...body };
    }
    case 'staff_welcome': {
      const url = link(input.publicUrl, `/reset-password?token=${encodeURIComponent(v.token ?? '')}`);
      const body = base({
        officeName: office,
        title: 'حساب کاربری شما ساخته شد',
        paragraphs: [
          `${name} عزیز، برای شما در «${office}» حساب کاربری ساخته شد.`,
          `نام کاربری: ${v.username || '-'}`,
          'برای ورود، ابتدا رمز عبور شخصی خود را از دکمهٔ زیر تعیین کنید. این لینک فقط یک بار و تا ۲۴ ساعت معتبر است.',
        ],
        button: url ? { label: 'تعیین رمز عبور و ورود', url } : undefined,
        footerNote: 'رمز عبور خود را با کسی به اشتراک نگذارید؛ مدیر سامانه هرگز رمز شما را نمی‌پرسد.',
      });
      return { subject: `خوش آمدید — حساب شما در ${office}`, ...body };
    }
    case 'ticket_created': {
      const url = link(input.publicUrl, v.link || '/app/support');
      const body = base({
        officeName: office,
        title: 'تیکت پشتیبانی ثبت شد',
        paragraphs: [
          `${name} عزیز، تیکت «${v.ticket_title || '-'}» با شمارهٔ ${v.ticket_number || '-'} ثبت شد.`,
          'پاسخ‌های کارشناسان از همین مسیر و از طریق ایمیل به اطلاع شما می‌رسد.',
        ],
        button: url ? { label: 'مشاهدهٔ تیکت', url } : undefined,
      });
      return { subject: `تیکت ${v.ticket_number || ''} ثبت شد — ${office}`, ...body };
    }
    case 'ticket_reply': {
      const url = link(input.publicUrl, v.link || '/app/support');
      const body = base({
        officeName: office,
        title: 'پاسخ تازه برای تیکت شما',
        paragraphs: [
          `${name} عزیز، برای تیکت «${v.ticket_title || '-'}» پاسخ تازه‌ای ثبت شد.`,
          v.preview ? `بخشی از پاسخ: ${v.preview}` : 'برای خواندن پاسخ کامل به سامانه مراجعه کنید.',
        ],
        button: url ? { label: 'خواندن پاسخ', url } : undefined,
      });
      return { subject: `پاسخ تیکت ${v.ticket_number || ''} — ${office}`, ...body };
    }
    case 'security_alert': {
      const url = link(input.publicUrl, '/admin/guard');
      const body = base({
        officeName: office,
        title: '⚠️ هشدار امنیتی سامانه',
        paragraphs: [
          `رویداد: ${v.event_title || v.event_kind || 'رویداد امنیتی'}`,
          `شدت: ${v.severity || '-'}`,
          v.detail ? `شرح: ${v.detail}` : 'جزئیات کامل در پنل گارد تک پیشخوان قابل مشاهده است.',
          `زمان: ${v.occurred_at || '-'}`,
        ],
        button: url ? { label: 'مشاهده در پنل گارد', url } : undefined,
        footerNote: 'این هشدار طبق تنظیمات گارد برای مدیران ارسال می‌شود.',
      });
      return { subject: `⚠️ هشدار امنیتی: ${v.event_title || v.event_kind || ''} — ${office}`, ...body };
    }
    case 'monitoring_alert': {
      const url = link(input.publicUrl, '/admin/monitoring');
      const body = base({
        officeName: office,
        title: 'هشدار پایش سامانه',
        paragraphs: [
          `${v.alert_title || 'یک شاخص پایش از آستانه عبور کرد.'}`,
          v.detail ? `شرح: ${v.detail}` : '',
        ].filter(Boolean),
        button: url ? { label: 'مشاهدهٔ پایش', url } : undefined,
      });
      return { subject: `هشدار پایش: ${v.alert_title || ''} — ${office}`, ...body };
    }
    case 'notification':
    default: {
      const url = link(input.publicUrl, v.link || '/app');
      const body = base({
        officeName: office,
        title: v.title || 'اعلان سامانه',
        paragraphs: [`${name} عزیز،`, v.body || 'یک رویداد تازه در حساب شما ثبت شد.'],
        button: url ? { label: 'مشاهده در سامانه', url } : undefined,
      });
      return { subject: `${v.title || 'اعلان'} — ${office}`, ...body };
    }
  }
}
