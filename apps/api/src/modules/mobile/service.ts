import { one, q, run, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../http/errors.js';
import { getBool, getString } from '../settings/service.js';
import { writeAudit } from '../audit/service.js';
import { getFile } from '../media/service.js';
import { env } from '../../env.js';

/**
 * Native Android customer app support: runtime config, stories/notices and
 * the device registry behind usage stats. Everything else in the app
 * (accounts, catalogue, requests, wallet, payments) reuses the very same
 * APIs as the web panel — one backend, one database, one set of users.
 */

export async function appConfig() {
  const siteName = await getString('site.name');
  const updateUrl = (await getString('app.update_url')) || (await getString('landing.app_android_url'));
  return {
    brand: {
      name: siteName,
      shortName: await getString('site.short_name'),
      tagline: await getString('site.tagline'),
      logoUrl: '/api/public/brand-asset/logo',
      welcomeTitle: (await getString('app.welcome_title')) || siteName,
    },
    auth: {
      password: await getBool('auth.customer_password_enabled'),
      otp: await getBool('auth.customer_otp_enabled'),
      registrationOpen: await getBool('auth.customer_registration_open'),
      passwordReset: await getBool('auth.allow_customer_password_reset'),
    },
    version: {
      latest: (await getString('app.latest_version')) || '1.0.0',
      min: (await getString('app.min_version')) || '1.0.0',
      updateUrl: updateUrl || '',
      forceUpdate: await getBool('app.force_update'),
    },
    announcement: (await getString('app.announcement')) || '',
    storiesEnabled: await getBool('app.stories_enabled'),
    supportPhone: (await getString('maintenance.support_phone')) || '',
    serverVersion: env.version,
    maintenance: await getBool('maintenance.mode'),
  };
}

/* --------------------------------- stories -------------------------------- */

function storyDto(row: any) {
  return {
    id: row.id,
    groupTitle: row.group_title ?? null,
    title: row.title,
    mediaType: row.media_type,
    fileId: row.file_id ?? null,
    mediaUrl: row.file_id ? `/api/app/stories/${row.id}/media` : (row.media_url ?? null),
    externalMediaUrl: row.media_url ?? null,
    linkUrl: row.link_url ?? null,
    linkLabel: row.link_label ?? null,
    durationSeconds: Number(row.duration_seconds ?? 6),
    sortOrder: Number(row.sort_order ?? 0),
    startsAt: row.starts_at ?? null,
    expiresAt: row.expires_at ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Stories for the app home screen, already grouped into rings. */
export async function storiesForCustomer() {
  if (!(await getBool('app.stories_enabled'))) return { groups: [] };
  const now = nowIso();
  const rows = await q<any>(
    `SELECT * FROM app_stories
     WHERE status = 'published'
       AND (starts_at IS NULL OR starts_at <= ?)
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY sort_order ASC, created_at ASC`,
    [now, now],
  );
  const defaultGroup = (await getString('site.short_name')) || 'اطلاعیه‌ها';
  const groups = new Map<string, { title: string; items: ReturnType<typeof storyDto>[] }>();
  for (const row of rows) {
    const item = storyDto(row);
    if (!item.mediaUrl) continue;
    const title = item.groupTitle || defaultGroup;
    if (!groups.has(title)) groups.set(title, { title, items: [] });
    groups.get(title)!.items.push(item);
  }
  return { groups: [...groups.values()] };
}

export async function storyMediaFile(storyId: string) {
  const story = await one<any>('SELECT * FROM app_stories WHERE id = ?', [storyId]);
  if (!story?.file_id) throw notFound('رسانهٔ این استوری یافت نشد.');
  const file = await getFile(story.file_id);
  if (!file) throw notFound('فایل رسانه یافت نشد.');
  return { story, file };
}

export async function adminListStories() {
  const rows = await q<any>('SELECT * FROM app_stories ORDER BY sort_order ASC, created_at DESC');
  return rows.map(storyDto);
}

export interface StoryInput {
  groupTitle?: string | null;
  title: string;
  mediaType: 'image' | 'video';
  fileId?: string | null;
  mediaUrl?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  durationSeconds?: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  status?: 'draft' | 'published';
}

async function assertStoryMedia(input: StoryInput) {
  if (!input.fileId && !input.mediaUrl) throw badRequest('برای استوری یک فایل رسانه یا نشانی اینترنتی رسانه لازم است.');
  if (input.fileId) {
    const file = await getFile(input.fileId);
    if (!file) throw badRequest('فایل رسانه یافت نشد؛ ابتدا آن را بارگذاری کنید.');
    const isImage = String(file.mime).startsWith('image/');
    const isVideo = String(file.mime).startsWith('video/');
    if (!isImage && !isVideo) throw badRequest('رسانهٔ استوری باید تصویر یا ویدئو باشد.');
    if (input.mediaType === 'image' && !isImage) throw badRequest('نوع رسانه «تصویر» انتخاب شده اما فایل ویدئو است.');
    if (input.mediaType === 'video' && !isVideo) throw badRequest('نوع رسانه «ویدئو» انتخاب شده اما فایل تصویر است.');
  }
  if (input.expiresAt && input.startsAt && input.expiresAt <= input.startsAt) {
    throw badRequest('تاریخ انقضا باید بعد از تاریخ شروع نمایش باشد.');
  }
}

export async function createStory(input: StoryInput, actor: { id: string; name: string; ip?: string }) {
  await assertStoryMedia(input);
  const max = await one<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM app_stories');
  const storyId = id('story');
  const ts = nowIso();
  await run(
    `INSERT INTO app_stories
      (id, group_title, title, media_type, file_id, media_url, link_url, link_label,
       duration_seconds, sort_order, starts_at, expires_at, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      storyId, input.groupTitle ?? null, input.title, input.mediaType,
      input.fileId ?? null, input.mediaUrl ?? null, input.linkUrl ?? null, input.linkLabel ?? null,
      input.durationSeconds ?? 6, Number(max?.m ?? 0) + 1,
      input.startsAt ?? null, input.expiresAt ?? null, input.status ?? 'published',
      actor.id, ts, ts,
    ],
  );
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.story.create',
    entityType: 'app_story', entityId: storyId, after: { title: input.title, mediaType: input.mediaType }, ip: actor.ip,
  });
  return storyDto(await one<any>('SELECT * FROM app_stories WHERE id = ?', [storyId]));
}

export async function updateStory(storyId: string, input: Partial<StoryInput> & { sortOrder?: number }, actor: { id: string; name: string; ip?: string }) {
  const current = await one<any>('SELECT * FROM app_stories WHERE id = ?', [storyId]);
  if (!current) throw notFound('استوری یافت نشد.');
  const merged: StoryInput = {
    groupTitle: input.groupTitle !== undefined ? input.groupTitle : current.group_title,
    title: input.title ?? current.title,
    mediaType: input.mediaType ?? current.media_type,
    fileId: input.fileId !== undefined ? input.fileId : current.file_id,
    mediaUrl: input.mediaUrl !== undefined ? input.mediaUrl : current.media_url,
    linkUrl: input.linkUrl !== undefined ? input.linkUrl : current.link_url,
    linkLabel: input.linkLabel !== undefined ? input.linkLabel : current.link_label,
    durationSeconds: input.durationSeconds ?? Number(current.duration_seconds),
    startsAt: input.startsAt !== undefined ? input.startsAt : current.starts_at,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : current.expires_at,
    status: input.status ?? current.status,
  };
  await assertStoryMedia(merged);
  await run(
    `UPDATE app_stories SET group_title = ?, title = ?, media_type = ?, file_id = ?, media_url = ?,
       link_url = ?, link_label = ?, duration_seconds = ?, sort_order = ?, starts_at = ?, expires_at = ?,
       status = ?, updated_at = ? WHERE id = ?`,
    [
      merged.groupTitle ?? null, merged.title, merged.mediaType, merged.fileId ?? null, merged.mediaUrl ?? null,
      merged.linkUrl ?? null, merged.linkLabel ?? null, merged.durationSeconds ?? 6,
      input.sortOrder ?? Number(current.sort_order), merged.startsAt ?? null, merged.expiresAt ?? null,
      merged.status ?? 'published', nowIso(), storyId,
    ],
  );
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.story.update',
    entityType: 'app_story', entityId: storyId, after: { title: merged.title, status: merged.status }, ip: actor.ip,
  });
  return storyDto(await one<any>('SELECT * FROM app_stories WHERE id = ?', [storyId]));
}

export async function deleteStory(storyId: string, actor: { id: string; name: string; ip?: string }) {
  const current = await one<any>('SELECT id, title FROM app_stories WHERE id = ?', [storyId]);
  if (!current) throw notFound('استوری یافت نشد.');
  await run('DELETE FROM app_stories WHERE id = ?', [storyId]);
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.story.delete',
    entityType: 'app_story', entityId: storyId, before: { title: current.title }, ip: actor.ip,
  });
  return { id: storyId, message: 'استوری حذف شد.' };
}

export async function reorderStories(orderedIds: string[], actor: { id: string; name: string; ip?: string }) {
  let order = 1;
  for (const storyId of orderedIds) {
    await run('UPDATE app_stories SET sort_order = ?, updated_at = ? WHERE id = ?', [order, nowIso(), storyId]);
    order += 1;
  }
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.story.reorder',
    entityType: 'app_story', after: { count: orderedIds.length }, ip: actor.ip,
  });
  return adminListStories();
}

/* --------------------------------- devices -------------------------------- */

export interface DeviceInput {
  deviceId: string;
  platform?: string;
  appVersion?: string;
  appBuild?: string;
  deviceModel?: string;
  pushToken?: string | null;
}

/** Called by the app after login and on every cold start while signed in. */
export async function registerDevice(userId: string, input: DeviceInput) {
  const ts = nowIso();
  const existing = await one<any>('SELECT id FROM app_devices WHERE user_id = ? AND device_id = ?', [userId, input.deviceId]);
  if (existing) {
    await run(
      `UPDATE app_devices SET platform = ?, app_version = ?, app_build = ?, device_model = ?,
         push_token = COALESCE(?, push_token), last_seen_at = ? WHERE id = ?`,
      [input.platform ?? 'android', input.appVersion ?? null, input.appBuild ?? null, input.deviceModel ?? null, input.pushToken ?? null, ts, existing.id],
    );
    return { id: existing.id, updated: true };
  }
  const deviceRowId = id('device');
  await run(
    `INSERT INTO app_devices (id, user_id, device_id, platform, app_version, app_build, device_model, push_token, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [deviceRowId, userId, input.deviceId, input.platform ?? 'android', input.appVersion ?? null, input.appBuild ?? null, input.deviceModel ?? null, input.pushToken ?? null, ts, ts],
  );
  return { id: deviceRowId, updated: false };
}

export async function appStats() {
  const now = Date.now();
  const since = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const total = await one<{ c: number }>('SELECT COUNT(*) AS c FROM app_devices');
  const users = await one<{ c: number }>('SELECT COUNT(DISTINCT user_id) AS c FROM app_devices');
  const active7 = await one<{ c: number }>('SELECT COUNT(*) AS c FROM app_devices WHERE last_seen_at >= ?', [since(7)]);
  const active30 = await one<{ c: number }>('SELECT COUNT(*) AS c FROM app_devices WHERE last_seen_at >= ?', [since(30)]);
  const newest = await one<{ t: string }>('SELECT MAX(last_seen_at) AS t FROM app_devices');
  const byVersion = await q<any>(
    `SELECT COALESCE(app_version, 'نامشخص') AS version, COUNT(*) AS c FROM app_devices GROUP BY app_version ORDER BY c DESC`,
  );
  const recent = await q<any>(
    `SELECT d.*, u.full_name AS user_name, u.mobile AS user_mobile
     FROM app_devices d JOIN users u ON u.id = d.user_id
     ORDER BY d.last_seen_at DESC LIMIT 20`,
  );
  const storyCounts = await one<{ published: number; draft: number }>(
    `SELECT COALESCE(SUM(status = 'published'), 0) AS published, COALESCE(SUM(status = 'draft'), 0) AS draft FROM app_stories`,
  );
  return {
    devices: {
      total: Number(total?.c ?? 0),
      users: Number(users?.c ?? 0),
      active7d: Number(active7?.c ?? 0),
      active30d: Number(active30?.c ?? 0),
      lastSeenAt: newest?.t ?? null,
      byVersion: byVersion.map((row) => ({ version: row.version, count: Number(row.c) })),
      recent: recent.map((row) => ({
        id: row.id, userName: row.user_name, userMobile: row.user_mobile,
        platform: row.platform, appVersion: row.app_version, appBuild: row.app_build,
        deviceModel: row.device_model, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
      })),
    },
    stories: { published: Number(storyCounts?.published ?? 0), draft: Number(storyCounts?.draft ?? 0) },
  };
}
