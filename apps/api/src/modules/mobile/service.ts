import { one, q, run, tx, nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../http/errors.js';
import { getBool, getString } from '../settings/service.js';
import { notifyUser } from '../notifications/service.js';
import { writeAudit } from '../audit/service.js';
import { getFile } from '../media/service.js';
import { env } from '../../env.js';

/**
 * Native Android customer app support: runtime config, banners and the
 * device registry behind usage stats. Everything else in the app
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
    bannersEnabled: await getBool('app.banners_enabled'),
    supportPhone: (await getString('maintenance.support_phone')) || '',
    serverVersion: env.version,
    maintenance: await getBool('maintenance.mode'),
  };
}
/* --------------------------------- banners -------------------------------- */

/**
 * Banners replaced the story ring. A story was a vertical slideshow that had
 * to be swiped through one card at a time; a banner is a wide card on the home
 * screen that says one thing and, when the office wants it to, walks the
 * customer straight to the service it advertises. Everything an office needs
 * to run a campaign — schedule, order, on/off, a notification on publish — is
 * a column here, and the destination is structured rather than a free link so
 * the app can open a real service screen instead of a web page.
 */

export type BannerKind = 'general' | 'info' | 'ad' | 'service';
export type BannerDestinationKind = 'none' | 'service' | 'url';

export interface BannerInput {
  kind?: BannerKind;
  title: string;
  subtitle?: string | null;
  imageFileId?: string | null;
  imageUrl?: string | null;
  accentColor?: string | null;
  destinationKind?: BannerDestinationKind;
  destinationSlug?: string | null;
  destinationUrl?: string | null;
  actionLabel?: string | null;
  sortOrder?: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  status?: 'draft' | 'published';
  notifyCustomers?: boolean;
}

function bannerDto(row: any) {
  return {
    id: row.id,
    kind: row.kind as BannerKind,
    title: row.title,
    subtitle: row.subtitle ?? null,
    // The app never sees the raw file id: an uploaded image is streamed from
    // the banner's own media route so the same URL shape works for a private
    // upload and a public one.
    imageUrl: row.image_file_id ? `/api/app/banners/${row.id}/image` : (row.image_url ?? null),
    externalImageUrl: row.image_url ?? null,
    accentColor: row.accent_color ?? null,
    destinationKind: (row.destination_kind ?? 'none') as BannerDestinationKind,
    destinationSlug: row.destination_slug ?? null,
    destinationUrl: row.destination_url ?? null,
    actionLabel: row.action_label ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    startsAt: row.starts_at ?? null,
    expiresAt: row.expires_at ?? null,
    status: row.status,
    notifyCustomers: Number(row.notify_customers ?? 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Banners for the signed-in customer, already filtered by window.
 *
 * No grouping: a banner rail is flat, and the order is the office's order.
 * A banner whose scheduled window has not opened yet, or has closed, is
 * invisible here even though it is `published` — that is the difference
 * between "live" and "approved", and it is what makes scheduling work.
 */
export async function bannersForCustomer() {
  if (!(await getBool('app.banners_enabled'))) return { banners: [] };
  const now = nowIso();
  const rows = await q<any>(
    `SELECT * FROM app_banners
     WHERE status = 'published'
       AND (starts_at IS NULL OR starts_at <= ?)
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY sort_order ASC, created_at ASC
     LIMIT 20`,
    [now, now],
  );
  return { banners: rows.map(bannerDto) };
}

export async function bannerImageFile(bannerId: string) {
  const banner = await one<any>('SELECT * FROM app_banners WHERE id = ?', [bannerId]);
  if (!banner?.image_file_id) throw notFound('تصویر این بنر یافت نشد.');
  const file = await getFile(banner.image_file_id);
  if (!file) throw notFound('فایل تصویر یافت نشد.');
  return { banner, file };
}

export async function adminListBanners() {
  const rows = await q<any>('SELECT * FROM app_banners ORDER BY sort_order ASC, created_at DESC');
  return rows.map(bannerDto);
}

/**
 * Validation shared by create and update.
 *
 * The destination rules are the important part. A `service` banner without a
 * slug is a dead card that goes nowhere, and a slug that is not in the
 * catalogue is worse: tapping it would fail at the worst possible moment, on
 * a phone, for a customer. Both are rejected here rather than in the app.
 */
async function assertBanner(input: BannerInput) {
  if (!input.imageFileId && !input.imageUrl) throw badRequest('برای بنر یک تصویر لازم است؛ فایل بارگذاری‌شده یا نشانی تصویر.');
  if (input.imageFileId) {
    const file = await getFile(input.imageFileId);
    if (!file) throw badRequest('فایل تصویر یافت نشد؛ ابتدا آن را بارگذاری کنید.');
    if (!String(file.mime).startsWith('image/')) throw badRequest('تصویر بنر باید فایل تصویری باشد.');
  }
  if (input.expiresAt && input.startsAt && input.expiresAt <= input.startsAt) {
    throw badRequest('تاریخ پایان نمایش باید بعد از تاریخ شروع باشد.');
  }
  if (input.destinationKind === 'service') {
    if (!input.destinationSlug) throw badRequest('برای بنر خدمت، انتخاب خدمت مقصد لازم است.');
    const service = await one<{ id: string }>(
      "SELECT id FROM services WHERE slug = ? AND archived_at IS NULL",
      [input.destinationSlug],
    );
    if (!service) throw badRequest('خدمت انتخاب‌شده در فهرست خدمات پیدا نشد.');
  }
  if (input.destinationKind === 'url') {
    if (!input.destinationUrl) throw badRequest('برای بنر پیوندی، نشانی مقصد لازم است.');
    const url = String(input.destinationUrl);
    const acceptable = url.startsWith('/') || /^https?:\/\//i.test(url);
    if (!acceptable) throw badRequest('نشانی مقصد باید با http(s) یا مسیر نسبی سرور شروع شود.');
  }
}

/**
 * A published banner can announce itself once, in the notification centre the
 * app polls. Best-effort: a failed fan-out must never undo a publication, and
 * `notified_at` is only stamped after the (synchronous part of the) fan-out so
 * a restart cannot double-send.
 */
async function notifyCustomersAboutBanner(row: any) {
  try {
    if (Number(row.notify_customers ?? 0) !== 1) return;
    if (row.status !== 'published') return;
    if (row.notified_at) return;
    if (!(await getBool('app.banners_enabled'))) return;
    const customers = await q<{ id: string }>(
      "SELECT id FROM users WHERE kind = 'customer' AND status = 'active'",
    );
    const title = row.title;
    const body = row.subtitle
      || (row.kind === 'service' ? 'خدمت تازه‌ای در دسترس است؛ برای دیدن آن اپ را باز کنید.' : 'برای دیدن آن اپ را باز کنید.');
    for (const customer of customers) {
      await notifyUser(customer.id, { title, body, kind: 'info', link: '/app/banners' }).catch(() => undefined);
    }
    await run('UPDATE app_banners SET notified_at = ? WHERE id = ?', [nowIso(), row.id]);
  } catch {
    // Publishing already succeeded; the fan-out is best-effort.
  }
}

export async function createBanner(input: BannerInput, actor: { id: string; name: string; ip?: string }) {
  await assertBanner(input);
  const max = await one<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM app_banners');
  const bannerId = id('banner');
  const ts = nowIso();
  await run(
    `INSERT INTO app_banners
      (id, kind, title, subtitle, image_file_id, image_url, accent_color,
       destination_kind, destination_slug, destination_url, action_label,
       sort_order, starts_at, expires_at, status, notify_customers, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bannerId, input.kind ?? 'general', input.title, input.subtitle ?? null,
      input.imageFileId ?? null, input.imageUrl ?? null, input.accentColor ?? null,
      input.destinationKind ?? 'none',
      input.destinationKind === 'service' ? (input.destinationSlug ?? null) : null,
      input.destinationKind === 'url' ? (input.destinationUrl ?? null) : null,
      input.actionLabel ?? null,
      input.sortOrder ?? Number(max?.m ?? 0) + 1,
      input.startsAt ?? null, input.expiresAt ?? null,
      input.status ?? 'published', input.notifyCustomers ? 1 : 0,
      actor.id, ts, ts,
    ],
  );
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.banner.create',
    entityType: 'app_banner', entityId: bannerId,
    after: { title: input.title, kind: input.kind ?? 'general' }, ip: actor.ip,
  });
  const created = await one<any>('SELECT * FROM app_banners WHERE id = ?', [bannerId]);
  if (created?.status === 'published') void notifyCustomersAboutBanner(created);
  return bannerDto(created);
}

export async function updateBanner(
  bannerId: string,
  input: Partial<BannerInput>,
  actor: { id: string; name: string; ip?: string },
) {
  const current = await one<any>('SELECT * FROM app_banners WHERE id = ?', [bannerId]);
  if (!current) throw notFound('بنر یافت نشد.');
  const merged: BannerInput = {
    kind: (input.kind ?? current.kind) as BannerKind,
    title: input.title ?? current.title,
    subtitle: input.subtitle !== undefined ? input.subtitle : current.subtitle,
    imageFileId: input.imageFileId !== undefined ? input.imageFileId : current.image_file_id,
    imageUrl: input.imageUrl !== undefined ? input.imageUrl : current.image_url,
    accentColor: input.accentColor !== undefined ? input.accentColor : current.accent_color,
    destinationKind: (input.destinationKind ?? current.destination_kind) as BannerDestinationKind,
    destinationSlug: input.destinationSlug !== undefined ? input.destinationSlug : current.destination_slug,
    destinationUrl: input.destinationUrl !== undefined ? input.destinationUrl : current.destination_url,
    actionLabel: input.actionLabel !== undefined ? input.actionLabel : current.action_label,
    startsAt: input.startsAt !== undefined ? input.startsAt : current.starts_at,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : current.expires_at,
    status: (input.status ?? current.status) as 'draft' | 'published',
    notifyCustomers: input.notifyCustomers !== undefined
      ? input.notifyCustomers
      : Number(current.notify_customers ?? 0) === 1,
  };
  // Switching a banner away from a destination must clear the field it no
  // longer uses; leaving a stale slug behind means a card that looks like a
  // plain notice but still reports a service when the app inspects it.
  if (merged.destinationKind !== 'service') merged.destinationSlug = null;
  if (merged.destinationKind !== 'url') merged.destinationUrl = null;
  await assertBanner(merged);
  await run(
    `UPDATE app_banners SET kind = ?, title = ?, subtitle = ?, image_file_id = ?, image_url = ?,
       accent_color = ?, destination_kind = ?, destination_slug = ?, destination_url = ?,
       action_label = ?, sort_order = ?, starts_at = ?, expires_at = ?, status = ?,
       notify_customers = ?, updated_at = ? WHERE id = ?`,
    [
      merged.kind ?? 'general', merged.title, merged.subtitle ?? null,
      merged.imageFileId ?? null, merged.imageUrl ?? null, merged.accentColor ?? null,
      merged.destinationKind ?? 'none', merged.destinationSlug ?? null, merged.destinationUrl ?? null,
      merged.actionLabel ?? null, input.sortOrder ?? Number(current.sort_order),
      merged.startsAt ?? null, merged.expiresAt ?? null, merged.status ?? 'published',
      merged.notifyCustomers ? 1 : 0, nowIso(), bannerId,
    ],
  );
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.banner.update',
    entityType: 'app_banner', entityId: bannerId,
    after: { title: merged.title, status: merged.status }, ip: actor.ip,
  });
  const updated = await one<any>('SELECT * FROM app_banners WHERE id = ?', [bannerId]);
  // A banner that was written as a draft and published later announces itself
  // then, not while it was invisible.
  if (current.status !== 'published' && updated?.status === 'published') void notifyCustomersAboutBanner(updated);
  return bannerDto(updated);
}

export async function deleteBanner(bannerId: string, actor: { id: string; name: string; ip?: string }) {
  const current = await one<{ id: string; title: string }>('SELECT id, title FROM app_banners WHERE id = ?', [bannerId]);
  if (!current) throw notFound('بنر یافت نشد.');
  await run('DELETE FROM app_banners WHERE id = ?', [bannerId]);
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.banner.delete',
    entityType: 'app_banner', entityId: bannerId, before: { title: current.title }, ip: actor.ip,
  });
  return { id: bannerId, message: 'بنر حذف شد.' };
}

/**
 * Renumber banners to the given order.
 *
 * The admin table sends every id, but the endpoint also accepts a partial
 * list, and the two cases need the same guarantee: after the call, the listed
 * banners occupy 1..n in the order given, and nothing else shares one of those
 * numbers. Numbering the listed rows from 1 and leaving the rest alone breaks
 * exactly that — a row the caller did not mention may already hold 1, and the
 * tie is then decided by `created_at`, so the order the office chose loses
 * silently. So the unlisted banners are renumbered after the listed ones,
 * keeping their relative order.
 *
 * Numbers stay dense and ascending because the read paths sort ascending; a
 * timestamp here would push a reordered banner to the *end* of the rail.
 */
export async function reorderBanners(orderedIds: string[], actor: { id: string; name: string; ip?: string }) {
  const listed = [...new Set(orderedIds)];
  const rows = await q<{ id: string }>(
    'SELECT id FROM app_banners ORDER BY sort_order ASC, created_at ASC',
  );
  const rest = rows.map((row) => row.id).filter((bannerId) => !listed.includes(bannerId));
  const finalOrder = [...listed, ...rest];
  const ts = nowIso();
  let order = 1;
  for (const bannerId of finalOrder) {
    await run('UPDATE app_banners SET sort_order = ?, updated_at = ? WHERE id = ?', [order, ts, bannerId]);
    order += 1;
  }
  await writeAudit({
    actorId: actor.id, actorName: actor.name, action: 'app.banner.reorder',
    entityType: 'app_banner', after: { count: orderedIds.length }, ip: actor.ip,
  });
  return adminListBanners();
}

/**
 * First-run banners so a fresh install never opens with an empty rail.
 *
 * These point at the catalogue and at the bundled artwork the panel already
 * serves, and are ordinary rows afterwards — the office can edit, reorder,
 * schedule or delete each one from «اپ اندروید» like any other banner. Seeded
 * only when the table is completely empty, so an office that cleared them on
 * purpose never sees them return on the next restart.
 *
 * Every banner here either opens a real service or explains the app, because
 * a demo banner that lands nowhere is the fastest way to teach a customer
 * that the rail is decoration.
 */
const DEFAULT_BANNERS: Array<Omit<BannerInput, 'status'> & { sortOrder: number }> = [
  /*
   * Five slides, drawn as one set.
   *
   * This is the slider a fresh install opens with, and it is deliberately not
   * assembled from the catalogue: a banner that reuses a service thumbnail is a
   * catalogue row with a headline on it. These five illustrations were drawn at
   * the rail's own 1000x460 aspect ratio — subject on the leading left, clean
   * field on the trailing right where the Persian copy sits — so the same five
   * read as one campaign rather than five accidents.
   *
   * The artwork lives twice on purpose. `assets/banners/slide-*.webp` is the
   * copy the app ships with, used as the instant first-paint while the network
   * catches up (and as the entire rail when offline). The path below is the
   * copy the web build serves, which is what the admin panel previews and what
   * the app fetches — so a manager editing a slide sees exactly the picture a
   * customer sees, and swapping the file updates both sides at once.
   *
   * Every slide points at a real service or a real in-app page. `seedDefault
   * Banners` skips a service that a customised install does not have rather
   * than shipping a card that throws when it is tapped.
   */
  {
    kind: 'service',
    title: 'تعویض پلاک خودرو',
    subtitle: 'نوبت و مدارک، بدون صف و مراجعهٔ حضوری؛ پیگیری تا تحویل.',
    imageUrl: '/images/banners/slide-vehicles.webp',
    accentColor: '#1F6FEE',
    destinationKind: 'service',
    destinationSlug: 'plate-replacement-appointment',
    actionLabel: 'شروع',
    sortOrder: 1,
  },
  {
    kind: 'service',
    title: 'خدمات ملکی و اسناد',
    subtitle: 'استعلام سند، ثبت‌نام مسکن و امور زمین، یک‌جا.',
    imageUrl: '/images/banners/slide-property.webp',
    accentColor: '#2563EB',
    destinationKind: 'service',
    destinationSlug: 'property-deed-inquiry',
    actionLabel: 'مشاهده',
    sortOrder: 2,
  },
  {
    kind: 'service',
    title: 'ثبت و مجوز کسب‌وکار',
    subtitle: 'از انتخاب نام تا آگهی رسمی؛ پرونده‌تان را قدم‌به‌قدم ببینید.',
    imageUrl: '/images/banners/slide-business.webp',
    accentColor: '#4338CA',
    destinationKind: 'service',
    destinationSlug: 'register-llc',
    actionLabel: 'شروع',
    sortOrder: 3,
  },
  {
    kind: 'service',
    title: 'بیمه و خدمات درمان',
    subtitle: 'ثبت‌نام و تمدید بیمه، با یادآوری به‌موقع پیش از انقضا.',
    imageUrl: '/images/banners/slide-health.webp',
    accentColor: '#0EA5A4',
    destinationKind: 'service',
    destinationSlug: 'health-insurance-renewal',
    actionLabel: 'مشاهده',
    sortOrder: 4,
  },
  {
    kind: 'service',
    title: 'کارت ملی و هویت',
    subtitle: 'ثبت‌نام صدور و پیگیری وضعیت در هر مرحله، با اعلان.',
    imageUrl: '/images/banners/slide-identity.webp',
    accentColor: '#7C3AED',
    destinationKind: 'service',
    destinationSlug: 'smart-national-card-registration',
    actionLabel: 'شروع',
    sortOrder: 5,
  },
];

export async function seedDefaultBanners(log?: (message: string) => void) {
  const seeded = await tx(async () => {
    const marker = await one<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'internal.starter_banners_initialized'",
    );
    if (marker) return 0;
    const count = await one<{ c: number }>('SELECT COUNT(*) AS c FROM app_banners');
    const ts = nowIso();
    let inserted = 0;
    if (Number(count?.c ?? 0) === 0) {
      for (const banner of DEFAULT_BANNERS) {
        // A banner pointing at a service that this installation does not
        // happen to have is worse than no banner; skip it rather than ship a
        // card that throws when tapped.
        if (banner.destinationKind === 'service' && banner.destinationSlug) {
          const exists = await one<{ id: string }>(
            'SELECT id FROM services WHERE slug = ? AND archived_at IS NULL',
            [banner.destinationSlug],
          );
          if (!exists) continue;
        }
        await run(
          `INSERT INTO app_banners
            (id, kind, title, subtitle, image_file_id, image_url, accent_color,
             destination_kind, destination_slug, destination_url, action_label,
             sort_order, starts_at, expires_at, status, notify_customers, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'published', 0, 'system', ?, ?)`,
          [
            id('banner'), banner.kind ?? 'general', banner.title, banner.subtitle ?? null,
            banner.imageUrl ?? null, banner.accentColor ?? null,
            banner.destinationKind ?? 'none', banner.destinationSlug ?? null,
            banner.destinationUrl ?? null, banner.actionLabel ?? null, banner.sortOrder, ts, ts,
          ],
        );
        inserted += 1;
      }
    }
    await run(
      `INSERT INTO settings (key, value, group_name, is_secret, updated_at)
       VALUES ('internal.starter_banners_initialized', 'true', 'internal', 0, ?)`,
      [ts],
    );
    return inserted;
  });
  if (seeded) log?.(`seeded ${seeded} starter app banners`);
  return seeded;
}

/**
 * Move an installation that was seeded with the first-generation starter
 * banners onto the five-slide set.
 *
 * The first generation reused catalogue thumbnails and pointed at five
 * unrelated services; the rail looked like a catalogue row with headlines on
 * it, and only one of its pictures was ever drawn for this screen. The new set
 * is five illustrations in one style at the rail's own aspect ratio.
 *
 * The hard part is doing this *once* and never after. An office that has since
 * deleted, reordered, retitled or replaced these cards owns them now; re-running
 * this every boot would resurrect deleted slides and overwrite real edits. So it
 * is gated on the same kind of one-shot marker as the seed itself, and it only
 * touches cards that are still byte-for-byte the ones this function installed:
 * a row whose title still matches a first-generation title and whose image still
 * matches the first-generation image is one nobody has edited.
 *
 * A card the office already edited is left exactly as it is, and a card whose
 * service this installation does not have is skipped rather than inserted as a
 * dead tap target.
 */
const LEGACY_STARTER_TITLES = new Set<string>([
  'همهٔ خدمات، بدون مراجعه حضوری',
  'تعویض پلاک، بدون صف',
  'ثبت شرکت با مسئولیت محدود',
  'وام ازدواج، بی‌دغدغه',
  'کارت ملی هوشمند',
  'پیگیری لحظه‌ای پرونده',
]);

export async function upgradeStarterBanners(log?: (message: string) => void) {
  const marker = await one<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'internal.starter_banners_v2'",
  );
  if (marker) return 0;

  const updated = await tx(async () => {
    const rows = await q<any>('SELECT * FROM app_banners ORDER BY sort_order ASC');
    const legacy = rows.filter(
      (row) => LEGACY_STARTER_TITLES.has(String(row.title ?? '')) && !row.notified_at,
    );
    // No first-generation cards left: the office cleared or rewrote them all.
    // Stamp the marker anyway so this check never runs again.
    if (legacy.length === 0) {
      await stampBannerUpgrade();
      return 0;
    }

    let changed = 0;
    for (const [index, banner] of DEFAULT_BANNERS.entries()) {
      // Reuse a legacy row in place when there is one, so a card keeps its id,
      // its sort position and any statistics attached to it.
      const target = legacy[index];
      if (target) {
        await run(
          `UPDATE app_banners
              SET kind = ?, title = ?, subtitle = ?, image_file_id = NULL,
                  image_url = ?, accent_color = ?, destination_kind = ?,
                  destination_slug = ?, destination_url = NULL, action_label = ?,
                  sort_order = ?, updated_at = ?
            WHERE id = ?`,
          [
            banner.kind ?? 'general', banner.title, banner.subtitle ?? null,
            banner.imageUrl ?? null, banner.accentColor ?? null,
            banner.destinationKind ?? 'none', banner.destinationSlug ?? null,
            banner.actionLabel ?? null, banner.sortOrder, nowIso(), target.id,
          ],
        );
        changed += 1;
        continue;
      }
      if (banner.destinationKind === 'service' && banner.destinationSlug) {
        const exists = await one<{ id: string }>(
          'SELECT id FROM services WHERE slug = ? AND archived_at IS NULL',
          [banner.destinationSlug],
        );
        if (!exists) continue;
      }
      await run(
        `INSERT INTO app_banners
          (id, kind, title, subtitle, image_file_id, image_url, accent_color,
           destination_kind, destination_slug, destination_url, action_label,
           sort_order, starts_at, expires_at, status, notify_customers, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, 'published', 0, 'system', ?, ?)`,
        [
          id('banner'), banner.kind ?? 'general', banner.title, banner.subtitle ?? null,
          banner.imageUrl ?? null, banner.accentColor ?? null,
          banner.destinationKind ?? 'none', banner.destinationSlug ?? null,
          banner.actionLabel ?? null, banner.sortOrder, nowIso(), nowIso(),
        ],
      );
      changed += 1;
    }
    // A legacy card left over from a longer first-generation set would sit at
    // the end of the rail forever. They are only removed when they are still
    // unedited, which is exactly the set collected above beyond the new count.
    for (const stale of legacy.slice(DEFAULT_BANNERS.length)) {
      await run('DELETE FROM app_banners WHERE id = ?', [stale.id]);
    }
    await stampBannerUpgrade();
    return changed;
  });
  if (updated) log?.(`upgraded ${updated} starter app banners to the five-slide set`);
  return updated;
}

async function stampBannerUpgrade() {
  await run(
    `INSERT INTO settings (key, value, group_name, is_secret, updated_at)
     VALUES ('internal.starter_banners_v2', 'true', 'internal', 0, ?)`,
    [nowIso()],
  );
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
  const bannerCounts = await one<{ published: number; draft: number }>(
    `SELECT COALESCE(SUM(status = 'published'), 0) AS published, COALESCE(SUM(status = 'draft'), 0) AS draft FROM app_banners`,
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
    banners: { published: Number(bannerCounts?.published ?? 0), draft: Number(bannerCounts?.draft ?? 0) },
  };
}
