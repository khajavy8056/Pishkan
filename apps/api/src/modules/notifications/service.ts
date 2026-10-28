import { q, run, one, nowIso } from '../../db/index.js';
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
  email?: boolean;
}

/** Persist the in-app notice first; an SMS failure never drops the notice. */
export async function notifyUser(userId: string, input: NotifyInput): Promise<void> {
  const notificationId = id('ntf');
  const params = [notificationId, userId, input.title, input.body ?? null, input.kind ?? 'info', input.link ?? null, nowIso(), input.idempotencyKey ?? null];
  const inserted = input.idempotencyKey
    ? await run(
      `INSERT INTO notifications (id, user_id, title, body, kind, link, created_at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`, params,
    )
    : await run(
      `INSERT INTO notifications (id, user_id, title, body, kind, link, created_at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`, params.slice(0, 7),
    );
  if (!inserted.changes) return;

  if (input.sms && (await getBool('sms.notify_enabled'))) {
    const user = await one<{ mobile: string | null }>('SELECT mobile FROM users WHERE id = ?', [userId]);
    if (user?.mobile) {
      const smsKey = `${input.idempotencyKey ?? notificationId}:sms`;
      await sendEventNotificationSms(user.mobile, input.sms, smsKey).catch(() => undefined);
    }
  }
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
      readAt: r.read_at, createdAt: r.created_at,
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
