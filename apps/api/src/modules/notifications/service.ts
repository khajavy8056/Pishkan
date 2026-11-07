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

  if (input.push) {
    const { sendPushToUsers } = await import('./push.js');
    // In-app "chat:<ticketId>" pointers become a real URL for the device:
    // the recipient lands in their panel with the conversation auto-opened.
    let url = '/';
    if (input.link && input.link.startsWith('/')) url = input.link;
    else if (input.link && input.link.startsWith('chat:')) {
      const target = await one<{ kind: string }>('SELECT kind FROM users WHERE id = ?', [userId]).catch(() => null);
      const home = target?.kind === 'customer' ? '/app' : target?.kind === 'admin' ? '/admin' : '/staff';
      url = `${home}?chat=${encodeURIComponent(input.link.slice(5))}`;
    }
    await sendPushToUsers([userId], {
      title: input.title,
      body: (input.body ?? '').slice(0, 180),
      url,
      tag: (input.idempotencyKey ?? notificationId).slice(0, 64),
    }).catch(() => undefined);
  }
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

export async function notifyRole(roleCodes: string[], input: NotifyInput): Promise<void> {
  const placeholders = roleCodes.map(() => '?').join(',');
  const users = await q<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code IN (${placeholders}) AND u.status = 'active'`,
    roleCodes,
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
