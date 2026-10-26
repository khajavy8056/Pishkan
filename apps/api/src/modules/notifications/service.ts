import { q, run, one, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { getBool } from '../settings/service.js';
import { sendNotificationSms } from '../sms/provider.js';

export interface NotifyInput {
  title: string;
  body?: string;
  kind?: 'info' | 'success' | 'warning' | 'error';
  link?: string;
  sms?: string[];
  email?: boolean;
}

/** In-app notification (+ optional SMS pattern) for a single user. */
export async function notifyUser(userId: string, input: NotifyInput): Promise<void> {
  await run(
    `INSERT INTO notifications (id, user_id, title, body, kind, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id('ntf'), userId, input.title, input.body ?? null, input.kind ?? 'info', input.link ?? null, nowIso()],
  );

  if (input.sms?.length && (await getBool('sms.notify_enabled'))) {
    const user = await one<{ mobile: string | null }>('SELECT mobile FROM users WHERE id = ?', [userId]);
    if (user?.mobile) {
      await sendNotificationSms(user.mobile, input.sms, 'notification').catch(() => undefined);
    }
  }
}

export async function notifyRole(roleCodes: string[], input: NotifyInput): Promise<void> {
  const placeholders = roleCodes.map(() => '?').join(',');
  const users = await q<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code IN (${placeholders}) AND u.status = 'active'`,
    roleCodes,
  );
  for (const user of users) await notifyUser(user.id, input);
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
