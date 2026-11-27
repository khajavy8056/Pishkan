/**
 * The policy layer between an event and the SMTP transport.
 *
 * Three gates, all of them real settings someone can flip:
 *  1. the system toggle for the event category (`email.notify_*`),
 *  2. the person's own alarm preferences («کدام هشدارها به ایمیل من برسد»),
 *  3. a verified-or-at least-present email address on the account.
 *
 * Account emails (password reset, verification, welcome) are transactional:
 * they skip gates 1–2 because the person asked for them by acting, but they
 * still obey the master `email.enabled` switch inside the provider.
 */
import { getBool } from '../settings/service.js';
import { one, run, nowIso } from '../../db/index.js';
import { sendTemplateEmail, type EmailResult } from './provider.js';
import { TEMPLATE_CATEGORY, type EmailTemplateCode } from './templates.js';

export interface EmailPrefs {
  emailEnabled: boolean;
  tickets: boolean;
  cases: boolean;
  payments: boolean;
  security: boolean;
  announcements: boolean;
}

const DEFAULT_PREFS: EmailPrefs = {
  emailEnabled: true, tickets: true, cases: true, payments: true, security: true, announcements: true,
};

export async function emailPrefsFor(userId: string): Promise<EmailPrefs> {
  const row = await one<any>('SELECT * FROM user_notification_prefs WHERE user_id = ?', [userId]);
  if (!row) return { ...DEFAULT_PREFS };
  return {
    emailEnabled: Boolean(row.email_enabled),
    tickets: Boolean(row.email_tickets),
    cases: Boolean(row.email_cases),
    payments: Boolean(row.email_payments),
    security: Boolean(row.email_security),
    announcements: Boolean(row.email_announcements),
  };
}

export async function setEmailPrefs(userId: string, prefs: Partial<EmailPrefs>): Promise<EmailPrefs> {
  const current = await emailPrefsFor(userId);
  const next: EmailPrefs = { ...current, ...prefs };
  await run(
    `INSERT INTO user_notification_prefs (user_id, email_enabled, email_tickets, email_cases, email_payments, email_security, email_announcements, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email_enabled=excluded.email_enabled, email_tickets=excluded.email_tickets, email_cases=excluded.email_cases,
       email_payments=excluded.email_payments, email_security=excluded.email_security, email_announcements=excluded.email_announcements,
       updated_at=excluded.updated_at`,
    [userId, next.emailEnabled ? 1 : 0, next.tickets ? 1 : 0, next.cases ? 1 : 0, next.payments ? 1 : 0, next.security ? 1 : 0, next.announcements ? 1 : 0, nowIso()],
  );
  return next;
}

/** The system-level toggle for a template's category. */
async function categoryEnabled(category: EmailCategory): Promise<boolean> {
  switch (category) {
    case 'tickets': return getBool('email.notify_tickets');
    case 'cases': return getBool('email.notify_status_change');
    case 'payments': return getBool('email.notify_payment');
    case 'security': return getBool('email.notify_security');
    case 'announcements': return getBool('email.notify_new_request');
    case 'account': return true; // transactional — gated only by email.enabled
  }
}

export type EmailCategory = 'tickets' | 'cases' | 'payments' | 'security' | 'announcements' | 'account';

export interface NotificationEmailInput {
  template: EmailTemplateCode;
  variables?: Record<string, string>;
  idempotencyKey?: string;
  /** Override the template's default category when a generic template carries
   * a specific event (a payment notice rendered through 'notification'). */
  category?: EmailCategory;
}

/**
 * Send an event email to one user if every gate allows it. Best-effort: a
 * refused or failed send is a ledger row, never an exception in the business
 * flow that raised the event.
 */
export async function sendNotificationEmail(userId: string, input: NotificationEmailInput): Promise<EmailResult> {
  const category = input.category ?? TEMPLATE_CATEGORY[input.template];
  if (!(await categoryEnabled(category))) {
    return { ok: false, error: 'ایمیل این دستهٔ رویداد در تنظیمات خاموش است.', errorCode: 'category_disabled', provider: 'none' };
  }
  if (category !== 'account') {
    const prefs = await emailPrefsFor(userId);
    if (!prefs.emailEnabled || !prefs[category as keyof Omit<EmailPrefs, 'emailEnabled'>]) {
      return { ok: false, error: 'کاربر دریافت ایمیل این دسته را خاموش کرده است.', errorCode: 'user_disabled', provider: 'none' };
    }
  }
  const user = await one<{ email: string | null; full_name: string }>('SELECT email, full_name FROM users WHERE id = ?', [userId]);
  if (!user?.email) {
    return { ok: false, error: 'برای این حساب ایمیلی ثبت نشده است.', errorCode: 'no_email', provider: 'none' };
  }
  return sendTemplateEmail({
    to: user.email,
    template: input.template,
    variables: { full_name: user.full_name ?? '', ...(input.variables ?? {}) },
    userId,
    idempotencyKey: input.idempotencyKey,
    transactional: category === 'account',
  });
}
