import { q, run, one, tx, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool } from '../settings/service.js';
import { sendEventNotificationSms } from '../sms/provider.js';
import type { SmsEvent } from '../sms/templates.js';

export interface NotifyInput {
  title: string;
  body?: string;
  kind?: 'info' | 'success' | 'warning' | 'error';
  link?: string;
  sms?: SmsEvent;
  idempotencyKey?: string;
  /** Also ring the user's subscribed devices (Web Push). */
  push?: boolean;
  email?: boolean;
  /** Stable machine-readable category, independent of localized text. */
  eventType?: string;
  /**
   * 0..1 completion of the thing this notice is about, when it has a natural
   * one (a case walking through its steps). Drawn as a determinate progress bar
   * on the phone's notification — the detail that makes a stage change read as
   * "my case is 60% done" instead of another row of text.
   *
   * Omitted for anything without a meaningful fraction, because a bar that
   * sits at 50% for a message about a reply is a lie the customer will notice.
   */
  progress?: number | null;
  /** Human name of the current step, shown next to the bar. */
  stageLabel?: string;
}

/** Persist the in-app notice first; an SMS failure never drops the notice. */
export async function notifyUser(userId: string, input: NotifyInput): Promise<void> {
  const notificationId = id('ntf');
  const params = [notificationId, userId, input.title, input.body ?? null, input.kind ?? 'info', input.link ?? null, nowIso(), input.idempotencyKey ?? null, input.eventType ?? null];
  const inserted = input.idempotencyKey
    ? await run(
      `INSERT INTO notifications (id, user_id, title, body, kind, link, created_at, dedupe_key, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`, params,
    )
    : await run(
      `INSERT INTO notifications (id, user_id, title, body, kind, link, created_at, dedupe_key, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`, [...params.slice(0, 7), input.eventType ?? null],
    );
  if (!inserted.changes) return;

  if (input.sms && (await getBool('sms.notify_enabled'))) {
    const user = await one<{ mobile: string | null }>('SELECT mobile FROM users WHERE id = ?', [userId]);
    if (user?.mobile) {
      const smsKey = `${input.idempotencyKey ?? notificationId}:sms`;
      await sendEventNotificationSms(user.mobile, input.sms, smsKey).catch(() => undefined);
    }
  }

  // Native push (FCM) is attempted for every persistent notice, not only the
  // ones flagged `push: true`. The flag predates this channel and only ever
  // meant "the old Web Push browser bell"; a customer who registered a phone
  // expects every notice in their feed to reach the tray, and a notification
  // that exists in the app but never buzzed is exactly the complaint that
  // started this work. Web Push stays behind its own flag so browsers that
  // were never subscribed are not queried for nothing.
  //
  // Best-effort and non-blocking with respect to the business flow: a phone
  // that cannot be reached must never fail the transaction that moved a case.
  try {
    const { pushToUsers } = await import('./fcm.js');
    await pushToUsers([userId], {
      title: input.title,
      body: (input.body ?? '').slice(0, 500),
      link: input.link ?? '',
      notificationId,
      tag: (input.idempotencyKey ?? notificationId).slice(0, 120),
      kind: input.kind ?? 'info',
      progress: typeof input.progress === 'number' ? input.progress : null,
      stageLabel: input.stageLabel ?? '',
    });
  } catch {
    // Never surfaced: push is a delivery channel, not part of the write.
  }

  // Web Push (the office's browser, the customer's PWA) is attempted for every
  // notice too, not only the ones carrying `push: true`. That flag was written
  // when this was a "ring the free queue" feature and was never extended, so a
  // customer reply, a support message and a referral all landed in the bell and
  // nowhere else — which is the whole reason staff say "برای کارمندها
  // نوتیفیکیشن کامل نمی‌آید". A device with no subscription costs one indexed
  // query, and sendPushToUsers is already best-effort.
  {
    const { sendPushToUsers } = await import('./push.js');
    const url = await pushTargetUrl(userId, input);
    await sendPushToUsers([userId], {
      title: input.title,
      body: (input.body ?? '').slice(0, 180),
      url,
      tag: (input.idempotencyKey ?? notificationId).slice(0, 64),
    }).catch(() => undefined);
  }
}

/**
 * Where a tapped browser notification goes.
 *
 * The stored `link` is written for the in-app bell and is not always a route:
 * support conversations use the machine pointer `chat:<ticketId>`, and notices
 * raised by scheduled sweeps sometimes carry no link at all. Falling back to
 * `/` — which the old code did for every one of those — is what staff meant by
 * «مقصد نوتیفیکیشن درست نیست؛ می‌رود صفحهٔ اصلی». So the target is resolved
 * from the link when it is a route, from the pointer when it is not, and from
 * the recipient's own panel otherwise, and it is always a place where the thing
 * being announced can actually be acted on.
 */
async function pushTargetUrl(userId: string, input: NotifyInput): Promise<string> {
  const link = String(input.link ?? '');
  const recipient = await one<{ kind: string | null }>('SELECT kind FROM users WHERE id = ?', [userId]).catch(() => null);
  const audience: 'customer' | 'staff' | 'admin' =
    recipient?.kind === 'customer' ? 'customer' : recipient?.kind === 'admin' ? 'admin' : 'staff';
  const home = audience === 'customer' ? '/app' : audience === 'admin' ? '/admin' : '/staff';
  if (link.startsWith('/')) return link;
  if (link.startsWith('chat:')) {
    // The floating support widget opens itself from this query on load.
    return `${home}?chat=${encodeURIComponent(link.slice(5))}`;
  }
  // No usable link: land on the panel section the event type belongs to rather
  // than on a marketing home page the recipient has to navigate out of.
  return panelHomeFor(input.eventType, audience);
}

/**
 * Panel section per audience, for the event types the system knows.
 *
 * A hardcoded string per role would have been the second half of the reported
 * bug: the admin panel has no `/admin/documents` and no `/admin/accounting`, so
 * a link built by prefixing the panel path lands on «۴۰۴». Every value here is a
 * route the web router registers, and
 * `apps/web/tests/notification-routes.test.tsx` asserts exactly that — so a
 * route rename breaks a test instead of quietly breaking a notification.
 */
const PANEL_SECTIONS: Record<string, { customer: string; staff: string; admin: string }> = {
  message: { customer: '/app/messages', staff: '/staff/messages', admin: '/admin/messages' },
  support: { customer: '/app/support', staff: '/staff/support', admin: '/admin/support' },
  request: { customer: '/app/requests', staff: '/staff/requests', admin: '/admin/requests' },
  // Reviewing documents is a staff screen; the admin reaches the same approval
  // from the case list, which is the only place it exists for them.
  document: { customer: '/app/documents', staff: '/staff/documents', admin: '/admin/requests' },
  invoice: { customer: '/app/invoices', staff: '/staff/accounting', admin: '/admin/finance' },
  wallet: { customer: '/app/wallet', staff: '/staff/finance', admin: '/admin/wallet' },
  payroll: { customer: '/app/wallet', staff: '/staff/payroll', admin: '/admin/payroll' },
  referral: { customer: '/app/referrals', staff: '/staff/referrals', admin: '/admin/referrals' },
};

/** Machine `event_type` → which section of the panel owns it. */
const EVENT_SECTION: Record<string, string> = {
  message: 'message',
  support: 'support', ticket: 'support', ticket_message: 'support',
  request: 'request', request_stage: 'request', document_requested: 'request', assignment: 'request',
  document_approved: 'document', document_submitted: 'document', document_review: 'document',
  invoice: 'invoice', payment: 'invoice', settlement: 'invoice', refund: 'invoice',
  wallet: 'wallet', topup: 'wallet',
  monthly: 'payroll', payroll: 'payroll',
  referral: 'referral', discount: 'referral',
};

function panelHomeFor(eventType: string | undefined, audience: 'customer' | 'staff' | 'admin'): string {
  const section = eventType ? EVENT_SECTION[eventType] : undefined;
  const table = section ? PANEL_SECTIONS[section] : undefined;
  if (!table) return audience === 'customer' ? '/app' : audience === 'admin' ? '/admin' : '/staff';
  return table[audience];
}

/** Atomic, idempotent approval aggregation per customer and request. */
export async function notifyDocumentApproval(userId: string, requestId: string, trackingCode: string, eventId: string): Promise<void> {
  const key = `document-approvals:${userId}:${requestId}`;
  await tx(async (db) => {
    const now = nowIso();
    const recorded = await db.run(`INSERT INTO notification_aggregation_events (event_id, notification_key, created_at)
      VALUES (?, ?, ?) ON CONFLICT(event_id) DO NOTHING`, [eventId, key, now]);
    if (!recorded.changes) return;
    await db.run(`INSERT INTO notifications (id, user_id, title, body, kind, link, created_at, dedupe_key, event_type, revision)
      VALUES (?, ?, ?, ?, 'success', ?, ?, ?, 'document_approved', 1)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        body = CAST(notifications.revision + 1 AS TEXT) || ' مدرک از پرونده ' || ? || ' تأیید شد.',
        revision = notifications.revision + 1, created_at = excluded.created_at, read_at = NULL`,
    [id('ntf'), userId, 'مدارک پرونده تأیید شد', `۱ مدرک از پرونده ${trackingCode} تأیید شد.`, `/app/requests/${requestId}`, now, key, trackingCode]);
  });
}

/**
 * Fan one notice out to a role.
 *
 * `exceptUserIds` skips the people who do not need to be told: always the
 * actor (nobody needs a notice about what they just did) and anyone receiving a
 * more specific notice for the same event, so a manager who owns the case is
 * not sent both a personal and a role copy.
 */
export async function notifyRole(roleCodes: string[], input: NotifyInput, options: { exceptUserIds?: (string | null | undefined)[] } = {}): Promise<void> {
  const placeholders = roleCodes.map(() => '?').join(',');
  const skip = (options.exceptUserIds ?? []).filter(Boolean) as string[];
  const clause = skip.length ? ` AND u.id NOT IN (${skip.map(() => '?').join(',')})` : '';
  const users = await q<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code IN (${placeholders}) AND u.status = 'active'${clause}`,
    skip.length ? [...roleCodes, ...skip] : roleCodes,
  );
  for (const user of users) {
    await notifyUser(user.id, {
      ...input,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:${user.id}` : undefined,
    });
  }
}

export async function listNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  const limit = Math.min(100, options.limit ?? 30);
  const rows = await q<any>(
    `SELECT * FROM notifications WHERE user_id = ? ${options.unreadOnly ? 'AND read_at IS NULL' : ''}
     ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
  const unread = await one<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
  return {
    unread: Number(unread?.c ?? 0),
    items: rows.map((r) => ({
      id: r.id, title: r.title, body: r.body, kind: r.kind, link: r.link,
      readAt: r.read_at, createdAt: r.created_at, eventType: r.event_type ?? null, revision: Number(r.revision ?? 1),
    })),
  };
}

export async function markRead(userId: string, notificationId?: string): Promise<void> {
  if (notificationId) {
    await run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [nowIso(), notificationId, userId]);
  } else {
    await run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [nowIso(), userId]);
  }
}
