/**
 * Guard notification layer: in-app notice to administrators + SMS through the
 * office's existing SMS provider, with an hourly budget so an attack cannot
 * drain the SMS credit.
 */
import { q, run, nowIso } from '../../db/index.js';
import { getBool, getNumber, getString, getJson } from '../settings/service.js';
import { notifyRole } from '../notifications/service.js';
import { sendNotificationSms, isValidMobile, normalizeMobile } from '../sms/provider.js';
import { logEvent } from '../logging/service.js';
import { severityAtLeast, getState, setState, type GuardEventRow, type GuardSeverity } from './service.js';

const SEVERITY_LABEL: Record<GuardSeverity, string> = { info: 'اطلاع', warning: 'هشدار', critical: 'بحرانی' };

async function smsBudgetLeft(): Promise<boolean> {
  const max = await getNumber('guard.sms_max_per_hour');
  const sent = await getState<string[]>('sms_sent_at', []);
  const hourAgo = Date.now() - 3_600_000;
  const recent = sent.filter((t) => new Date(t).getTime() > hourAgo);
  if (recent.length >= max) {
    await setState('sms_sent_at', recent);
    return false;
  }
  return true;
}

async function markSmsSent(): Promise<void> {
  const sent = await getState<string[]>('sms_sent_at', []);
  const hourAgo = Date.now() - 3_600_000;
  const recent = sent.filter((t) => new Date(t).getTime() > hourAgo);
  recent.push(nowIso());
  await setState('sms_sent_at', recent);
}

/**
 * Shared SMS pipeline for security AND operational alerts (backup failure,
 * SSL expiry, DB/service down…). Same per-event toggles (guard.sms_events),
 * same hourly budget, same admin number — one place to reason about.
 * Returns true when an SMS was actually sent.
 */
export async function sendGuardSms(kind: string, severity: GuardSeverity, message: string, refId?: string): Promise<boolean> {
  if (!(await getBool('guard.sms_enabled'))) return false;
  const minSeverity = (await getString('guard.sms_min_severity')) as GuardSeverity;
  if (!severityAtLeast(severity, minSeverity === 'warning' ? 'warning' : 'critical')) return false;
  const kinds = await getJson<string[]>('guard.sms_events', []);
  if (Array.isArray(kinds) && kinds.length > 0 && !kinds.includes(kind)) return false;
  const mobileRaw = await getString('guard.sms_mobile');
  if (!mobileRaw || !isValidMobile(mobileRaw)) {
    void logEvent({
      level: 'WARNING', category: 'security', action: 'guard.sms_skipped', result: 'failure',
      message: 'شمارهٔ مدیر برای هشدار امنیتی تنظیم نشده است.', details: { kind, refId },
    });
    return false;
  }
  if (!(await smsBudgetLeft())) {
    void logEvent({
      level: 'WARNING', category: 'security', action: 'guard.sms_budget', result: 'failure',
      message: 'سقف ساعتی پیامک امنیتی پر شد؛ این هشدار فقط در پنل ثبت شد.', details: { kind, refId },
    });
    return false;
  }
  const siteName = await getString('site.name');
  const templateOverride = await getString('guard.sms_template_id');
  const result = await sendNotificationSms(
    normalizeMobile(mobileRaw),
    [siteName || 'تک پیشخوان', SEVERITY_LABEL[severity], message.slice(0, 120)],
    'guard-alert',
    templateOverride,
  );
  if (result.ok) {
    await markSmsSent();
    return true;
  }
  void logEvent({
    level: 'WARNING', category: 'security', action: 'guard.sms_failed', result: 'failure',
    message: `پیامک هشدار امنیتی ارسال نشد: ${result.error ?? result.errorCode ?? 'نامشخص'}`,
    details: { kind, refId, errorCode: result.errorCode },
  });
  return false;
}

/* ------------------------------- guard email ------------------------------ */

async function emailBudgetLeft(): Promise<boolean> {
  const max = await getNumber('guard.sms_max_per_hour');
  const sent = await getState<string[]>('email_sent_at', []);
  const hourAgo = Date.now() - 3_600_000;
  const recent = sent.filter((t) => new Date(t).getTime() > hourAgo);
  if (recent.length >= max) {
    await setState('email_sent_at', recent);
    return false;
  }
  return true;
}

async function markEmailSent(): Promise<void> {
  const sent = await getState<string[]>('email_sent_at', []);
  const hourAgo = Date.now() - 3_600_000;
  const recent = sent.filter((t) => new Date(t).getTime() > hourAgo);
  recent.push(nowIso());
  await setState('email_sent_at', recent);
}

/**
 * Email twin of sendGuardSms: same severity/event policy and hourly budget,
 * but delivered to every active manager/super-admin with an email address,
 * each through their own alarm preferences. One place to reason about.
 */
export async function sendGuardEmail(kind: string, severity: GuardSeverity, message: string, refId?: string): Promise<boolean> {
  if (!(await getBool('guard.email_enabled'))) return false;
  const minSeverity = (await getString('guard.sms_min_severity')) as GuardSeverity;
  if (!severityAtLeast(severity, minSeverity === 'warning' ? 'warning' : 'critical')) return false;
  const kinds = await getJson<string[]>('guard.sms_events', []);
  if (Array.isArray(kinds) && kinds.length > 0 && !kinds.includes(kind)) return false;
  if (!(await emailBudgetLeft())) {
    void logEvent({
      level: 'WARNING', category: 'security', action: 'guard.email_budget', result: 'failure',
      message: 'سقف ساعتی ایمیل امنیتی پر شد؛ این هشدار فقط در پنل ثبت شد.', details: { kind, refId },
    });
    return false;
  }
  const admins = await q<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.code IN ('super_admin','manager') AND u.status = 'active' AND u.email IS NOT NULL`,
  );
  if (!admins.length) return false;
  const { sendNotificationEmail } = await import('../email/service.js');
  let anySent = false;
  for (const admin of admins) {
    const result = await sendNotificationEmail(admin.id, {
      template: 'security_alert',
      variables: {
        event_kind: kind, event_title: kind, severity: SEVERITY_LABEL[severity],
        detail: message.slice(0, 300), occurred_at: nowIso(),
      },
      idempotencyKey: `guard-email:${refId ?? kind}:${admin.id}`,
    }).catch(() => ({ ok: false }));
    if (result.ok) anySent = true;
  }
  if (anySent) await markEmailSent();
  return anySent;
}

/** Decide + deliver notifications for one recorded event. Never throws. */
export async function notifyGuardEvent(event: GuardEventRow): Promise<void> {
  try {
    if (event.severity === 'info') return;
    // In-app notice for the management roles (deduped per event).
    if (event.severity === 'critical') {
      await notifyRole(['super_admin', 'manager'], {
        title: `گارد امنیتی: ${event.kind}`,
        body: event.message.slice(0, 300),
        kind: 'error',
        link: '/admin/guard',
        eventType: 'guard_alert',
        idempotencyKey: `guard:${event.id}`,
        push: true,
      }).catch(() => undefined);
    }
    const sent = await sendGuardSms(event.kind, event.severity, event.message, event.id);
    if (sent) {
      await run('UPDATE guard_events SET action_taken = ? WHERE id = ?', [
        event.action_taken ? `${event.action_taken}+sms` : 'sms', event.id,
      ]);
    }
    const emailed = await sendGuardEmail(event.kind, event.severity, event.message, event.id);
    if (emailed) {
      const current = await q<{ action_taken: string | null }>('SELECT action_taken FROM guard_events WHERE id = ?', [event.id]);
      const taken = current[0]?.action_taken ?? event.action_taken;
      await run('UPDATE guard_events SET action_taken = ? WHERE id = ?', [
        taken ? `${taken}+email` : 'email', event.id,
      ]);
    }
  } catch (error) {
    void logEvent({
      level: 'WARNING', category: 'security', action: 'guard.notify_failed', result: 'failure',
      message: 'اطلاع‌رسانی رویداد امنیتی ناموفق بود.',
      details: { error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) },
    });
  }
}

/** Admin-triggered test SMS (route rate-limits repeats). */
export async function sendGuardTestSms(): Promise<{ ok: boolean; message: string }> {
  const mobileRaw = await getString('guard.sms_mobile');
  if (!mobileRaw || !isValidMobile(mobileRaw)) return { ok: false, message: 'شمارهٔ مدیر (guard.sms_mobile) تنظیم نشده است.' };
  if (!(await getBool('guard.sms_enabled'))) return { ok: false, message: 'پیامک هشدار امنیتی خاموش است (guard.sms_enabled).' };
  const siteName = await getString('site.name');
  const templateOverride = await getString('guard.sms_template_id');
  const result = await sendNotificationSms(
    normalizeMobile(mobileRaw),
    [siteName || 'تک پیشخوان', 'آزمون', 'این پیامک آزمایشی گارد تک پیشخوان است.'],
    'guard-alert-test',
    templateOverride,
  );
  return { ok: result.ok, message: result.ok ? 'پیامک آزمایشی ارسال شد.' : (result.error ?? 'ارسال ناموفق بود.') };
}
