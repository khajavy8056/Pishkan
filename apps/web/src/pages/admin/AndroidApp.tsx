import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Smartphone, RefreshCw, Plus, Trash2, Pencil, ArrowUp, ArrowDown, Eye, EyeOff,
  Users, Activity, History, Layers, Link2, Upload, Image as ImageIcon,
  Megaphone, Info, BadgePercent, Sparkles, Bell,
} from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select,
  StatCard, Switch, Tabs, Textarea, useToast,
} from '../../components/ui';
import QRCode from 'qrcode';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum, relative } from '../../lib/format';

/**
 * The customer app's banners.
 *
 * These replaced stories wholesale. A story was a vertical slideshow you had
 * to build one card at a time and group into rings; a banner is one wide card
 * on the home screen with a title, a picture and — the part that matters — a
 * destination that can be a specific catalogue service. The admin surface
 * follows that model: one list, ordered by the office, each row carrying its
 * own schedule, on/off switch and optional notification.
 */
interface Banner {
  id: string;
  kind: 'general' | 'info' | 'ad' | 'service';
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  externalImageUrl: string | null;
  accentColor: string | null;
  destinationKind: 'none' | 'service' | 'url';
  destinationSlug: string | null;
  destinationUrl: string | null;
  actionLabel: string | null;
  sortOrder: number;
  startsAt: string | null;
  expiresAt: string | null;
  status: string;
  notifyCustomers: boolean;
  createdAt: string;
}

interface BannerTarget {
  slug: string;
  title: string;
  category: string | null;
}

const KIND_META: Record<Banner['kind'], { label: string; icon: ReactNode; hint: string }> = {
  general: { label: 'عمومی', icon: <Sparkles className="size-4" />, hint: 'معرفی کلی سامانه یا کمپین' },
  service: { label: 'معرفی خدمت', icon: <Megaphone className="size-4" />, hint: 'به یک خدمت مشخص اشاره می‌کند' },
  info: { label: 'اطلاعیه', icon: <Info className="size-4" />, hint: 'اطلاع‌رسانی یا راهنما' },
  ad: { label: 'تبلیغاتی', icon: <BadgePercent className="size-4" />, hint: 'پیشنهاد یا تخفیف' },
};

/**
 * Sentinel for "this banner already has an uploaded file; do not touch it".
 *
 * The file id itself is deliberately never sent to the browser (the app gets a
 * streamed URL instead), so the editor cannot repopulate the upload field. It
 * sends this marker instead and the server keeps the existing file; choosing a
 * new picture, or typing a URL, replaces it.
 */
const KEEP_IMAGE = '__keep__';

const emptyBanner = {
  id: '',
  kind: 'service' as Banner['kind'],
  title: '',
  subtitle: '',
  imageFileId: '',
  imageUrl: '',
  accentColor: '#1F6FEE',
  destinationKind: 'service' as Banner['destinationKind'],
  destinationSlug: '',
  destinationUrl: '',
  actionLabel: 'شروع',
  startsAt: '',
  expiresAt: '',
  status: 'published' as 'draft' | 'published',
  notifyCustomers: false,
};

/** The in-app pages a banner may point at without naming a service. */
const IN_APP_PAGES = [
  { value: '/app/services', label: 'فهرست خدمات' },
  { value: '/app/requests', label: 'درخواست‌های من' },
  { value: '/app/documents', label: 'مدارک من' },
];

export function AdminAndroidApp() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState<'banners' | 'stats' | 'settings'>('banners');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banners, setBanners] = useState<Banner[]>([]);
  const [targets, setTargets] = useState<BannerTarget[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [imageName, setImageName] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<{ data: Banner[] }>('/api/app/admin/banners').catch(() => ({ data: [] as Banner[] })),
      api.get<{ data: BannerTarget[] }>('/api/app/admin/banner-targets').catch(() => ({ data: [] as BannerTarget[] })),
      api.get<{ data: any }>('/api/app/admin/stats').catch(() => ({ data: null })),
      api.get<{ data: any }>('/api/settings/admin'),
      api.get<{ data: any }>('/api/app/admin/connection').catch(() => ({ data: null })),
    ]).then(async ([bn, tg, stat, settings, conn]) => {
      setBanners(bn.data ?? []);
      setTargets(tg.data ?? []);
      setStats(stat.data);
      setConnection(conn.data);
      // Pre-render one scannable QR per LAN address for the connection card;
      // the payload is exactly the plain http URL the app's scanner expects.
      const urls: string[] = conn.data?.urls ?? [];
      const rendered: Record<string, string> = {};
      for (const url of urls) {
        try { rendered[url] = await QRCode.toDataURL(url, { width: 220, margin: 1 }); } catch { /* text stays usable */ }
      }
      setQrImages(rendered);
      const next: Record<string, any> = {};
      for (const item of (settings.data?.settings ?? [])) next[item.key] = item.isSecret ? '' : item.value;
      setValues(next);
    }).catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت اطلاعات اپ'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  /* -------------------------------- settings -------------------------------- */

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const keys = [
        'app.latest_version', 'app.min_version', 'app.update_url', 'app.force_update',
        'app.banners_enabled', 'app.announcement', 'app.welcome_title',
        'auth.customer_password_enabled', 'auth.customer_otp_enabled', 'auth.customer_registration_open',
      ];
      const picked: Record<string, any> = {};
      for (const key of keys) picked[key] = values[key];
      await api.put('/api/settings/admin', { values: picked, confirmCritical: true });
      notify('تنظیمات اپ ذخیره شد و در اجرای بعدی اپ مشتریان اعمال می‌شود.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ذخیره تنظیمات', 'error');
    } finally { setSavingSettings(false); }
  };

  /* --------------------------------- banners -------------------------------- */

  const openEditor = (banner?: Banner | null) => {
    setImageName('');
    setImagePreview(banner?.imageUrl ?? null);
    setEditing(banner ? {
      id: banner.id,
      kind: banner.kind,
      title: banner.title,
      subtitle: banner.subtitle ?? '',
      // Keep whichever source the banner already has. A banner whose picture
      // was uploaded has no `externalImageUrl`, and editing its title used to
      // leave both fields empty — the save would then silently strip the image.
      imageFileId: banner.externalImageUrl ? '' : KEEP_IMAGE,
      imageUrl: banner.externalImageUrl ?? '',
      accentColor: banner.accentColor ?? '#1F6FEE',
      destinationKind: banner.destinationKind,
      destinationSlug: banner.destinationSlug ?? '',
      destinationUrl: banner.destinationUrl ?? '',
      actionLabel: banner.actionLabel ?? 'مشاهده',
      startsAt: banner.startsAt ? banner.startsAt.slice(0, 16) : '',
      expiresAt: banner.expiresAt ? banner.expiresAt.slice(0, 16) : '',
      status: banner.status as 'draft' | 'published',
      notifyCustomers: banner.notifyCustomers,
    } : { ...emptyBanner });
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.upload<{ data: { id: string; name: string; mime: string } }>(
        '/api/files/upload', file, { purpose: 'banner' },
      );
      if (!(res.data.mime ?? '').startsWith('image/')) {
        notify('تصویر بنر باید فایل تصویری باشد.', 'error');
        return;
      }
      setImagePreview(URL.createObjectURL(file));
      setImageName(res.data.name);
      // Clearing the URL field is deliberate: the payload sends it as ''
      // when a file is attached, which is what tells the server to drop any
      // previously stored external address instead of keeping both.
      setEditing((current: any) => ({ ...current, imageFileId: res.data.id, imageUrl: '' }));
      notify('تصویر بنر بارگذاری شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری تصویر ناموفق بود.', 'error');
    } finally { setUploading(false); }
  };

  const saveBanner = async () => {
    if (!editing) return;
    setSavingBanner(true);
    try {
      const payload = {
        kind: editing.kind,
        title: editing.title,
        subtitle: editing.subtitle || null,
        // Exactly one image source. An explicit upload wins; the sentinel
        // means "keep whatever is stored", which for PATCH is expressed by
        // omitting the key entirely; and a typed URL replaces both.
        imageFileId: editing.imageFileId === KEEP_IMAGE
          ? undefined
          : (editing.imageFileId || null),
        imageUrl: editing.imageFileId && editing.imageFileId !== KEEP_IMAGE ? '' : editing.imageUrl,
        accentColor: editing.accentColor || null,
        destinationKind: editing.destinationKind,
        destinationSlug: editing.destinationKind === 'service' ? (editing.destinationSlug || null) : null,
        destinationUrl: editing.destinationKind === 'url' ? (editing.destinationUrl || null) : null,
        actionLabel: editing.actionLabel || null,
        startsAt: editing.startsAt ? new Date(editing.startsAt).toISOString() : null,
        expiresAt: editing.expiresAt ? new Date(editing.expiresAt).toISOString() : null,
        status: editing.status,
        notifyCustomers: Boolean(editing.notifyCustomers),
      };
      if (editing.id) await api.patch(`/api/app/admin/banners/${editing.id}`, payload);
      else await api.post('/api/app/admin/banners', payload);
      notify(
        editing.notifyCustomers && editing.status === 'published'
          ? 'بنر ذخیره شد و برای مشتری‌ها اعلان ساخته می‌شود.'
          : 'بنر ذخیره شد.',
        'success',
      );
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ذخیره بنر', 'error');
    } finally { setSavingBanner(false); }
  };

  const removeBanner = async (banner: Banner) => {
    if (!window.confirm(`بنر «${banner.title}» حذف شود؟`)) return;
    try {
      await api.delete(`/api/app/admin/banners/${banner.id}`);
      notify('بنر حذف شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در حذف', 'error');
    }
  };

  const moveBanner = async (banner: Banner, delta: number) => {
    const ids = banners.map((b) => b.id);
    const index = ids.indexOf(banner.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBanners(ids.map((id) => banners.find((b) => b.id === id)!));
    try {
      const res = await api.post<{ data: Banner[] }>('/api/app/admin/banners/reorder', { ids });
      setBanners(res.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ترتیب‌دهی', 'error');
      load();
    }
  };

  /** One-click on/off, so pulling a campaign does not mean opening its form. */
  const togglePublished = async (banner: Banner) => {
    const next = banner.status === 'published' ? 'draft' : 'published';
    try {
      await api.patch(`/api/app/admin/banners/${banner.id}`, { status: next });
      notify(next === 'published' ? 'بنر منتشر شد.' : 'بنر از انتشار خارج شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در تغییر وضعیت', 'error');
    }
  };

  /** Grouped service picker labels: a flat list of 193 titles is unusable. */
  const targetOptions = useMemo(() => {
    const groups = new Map<string, BannerTarget[]>();
    for (const target of targets) {
      const key = target.category ?? 'سایر';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(target);
    }
    return [...groups.entries()].map(([category, items]) => ({
      label: category,
      options: items.map((item) => ({ value: item.slug, label: item.title })),
    }));
  }, [targets]);

  const tabs = [
    { key: 'banners', label: 'بنرها' },
    { key: 'stats', label: 'آمار و همگام‌سازی' },
    { key: 'settings', label: 'تنظیمات و نسخه‌ها' },
  ];

  return (
    <AppShell variant="admin">
      <PageHeader title="اپ اندروید مشتریان" description="بنرهای صفحهٔ اصلی، سیاست نسخه و به‌روزرسانی، روش‌های ورود به اپ و آمار استفاده — اپ از همین سامانه و پایگاه داده استفاده می‌کند."
        actions={<Button variant="ghost" onClick={load}><RefreshCw className="size-4" /> به‌روزرسانی</Button>} />

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <Loading />}

      {!loading && !error && (
        <>
          <div className="mb-5"><Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as any)} /></div>

          {tab === 'stats' && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="دستگاه‌های ثبت‌شده" value={faNum(stats?.devices.total ?? 0)} icon={<Smartphone className="size-5" />} />
                <StatCard label="مشتری‌های دارای اپ" value={faNum(stats?.devices.users ?? 0)} icon={<Users className="size-5" />} />
                <StatCard label="فعال در ۷ روز" value={faNum(stats?.devices.active7d ?? 0)} tone="emerald" icon={<Activity className="size-5" />} />
                <StatCard label="فعال در ۳۰ روز" value={faNum(stats?.devices.active30d ?? 0)} tone="amber" icon={<History className="size-5" />} />
              </div>
              <div className="grid gap-5 lg:grid-cols-3">
                <Card>
                  <h3 className="mb-3 font-bold text-navy-900">وضعیت همگام‌سازی</h3>
                  <div className="space-y-2 text-sm text-navy-700">
                    <p>آخرین حضور ثبت‌شده از اپ: <b>{stats?.devices.lastSeenAt ? relative(stats.devices.lastSeenAt) : 'هنوز هیچ دستگاهی متصل نشده است'}</b></p>
                    <p>بنرهای منتشرشده: <b>{faNum(stats?.banners?.published ?? 0)}</b> • پیش‌نویس: <b>{faNum(stats?.banners?.draft ?? 0)}</b></p>
                    <p className="text-[11px] leading-6 text-navy-500">
                      هر گوشی با ورود موفق و هر اجرای سرد اپ، حضورش را اینجا ثبت می‌کند.
                      کاتالوگ خدمات و بنرها در خود اپ هم کش می‌شوند تا در اینترنت ضعیف هم کار کند.
                    </p>
                  </div>
                </Card>
                <Card>
                  <h3 className="mb-3 font-bold text-navy-900">توزیع نسخه‌های اپ</h3>
                  {(stats?.devices.byVersion ?? []).length === 0 && <p className="text-sm text-navy-400">داده‌ای نیست.</p>}
                  <div className="space-y-2">
                    {(stats?.devices.byVersion ?? []).map((row: any) => (
                      <div key={row.version} className="flex items-center justify-between rounded-xl bg-surface-3 px-3 py-2 text-sm">
                        <span dir="ltr" className="font-medium text-navy-900">{row.version}</span>
                        <Badge tone="default">{faNum(row.count)} دستگاه</Badge>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <h3 className="mb-3 font-bold text-navy-900">آخرین دستگاه‌های فعال</h3>
                  {(stats?.devices.recent ?? []).length === 0 && <p className="text-sm text-navy-400">هنوز دستگاهی وصل نشده است.</p>}
                  <div className="space-y-2">
                    {(stats?.devices.recent ?? []).slice(0, 8).map((row: any) => (
                      <div key={row.id} className="rounded-xl bg-surface-3 px-3 py-2">
                        <p className="text-xs font-semibold text-navy-900">{row.userName} <span dir="ltr" className="text-navy-400">({row.userMobile})</span></p>
                        <p className="text-[11px] text-navy-500">{row.deviceModel ?? 'گوشی اندرویدی'} • نسخه {row.appVersion ?? '—'} • {relative(row.lastSeenAt)}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {tab === 'banners' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="max-w-3xl text-sm leading-7 text-navy-600">
                  بنرها در بالای صفحهٔ اصلی اپ، به‌ترتیب همین فهرست نمایش داده می‌شوند. برای هر بنر می‌توانید تصویر،
                  زمان نمایش و مقصد لمس را تعیین کنید؛ اگر مقصد «خدمت» باشد، لمس بنر مستقیم صفحهٔ همان خدمت را
                  در اپ باز می‌کند.
                </p>
                {can('app.manage') && <Button onClick={() => openEditor(null)}><Plus className="size-4" /> بنر تازه</Button>}
              </div>
              {banners.length === 0 && <EmptyState title="بنری ثبت نشده است" description="اولین بنر (تصویر افقی) را بسازید تا در بالای صفحهٔ اصلی اپ دیده شود." />}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {banners.map((banner, index) => {
                  const meta = KIND_META[banner.kind] ?? KIND_META.general;
                  const targetService = banner.destinationKind === 'service'
                    ? targets.find((t) => t.slug === banner.destinationSlug)
                    : null;
                  return (
                    <Card key={banner.id} pad={false} className="overflow-hidden">
                      <div className="relative aspect-[16/9] w-full bg-navy-900">
                        {banner.imageUrl
                          ? <img src={banner.imageUrl} alt={banner.title} className="size-full object-cover" />
                          : <div className="flex size-full items-center justify-center text-navy-400"><ImageIcon className="size-8" /></div>}
                        <span className="absolute right-2 top-2 flex gap-1">
                          <Badge tone={banner.status === 'published' ? 'success' : 'warning'}>
                            {banner.status === 'published' ? 'منتشرشده' : 'پیش‌نویس'}
                          </Badge>
                          <Badge tone="default">{meta.label}</Badge>
                        </span>
                      </div>
                      <div className="space-y-1 p-3">
                        <p className="truncate text-sm font-bold text-navy-900">{banner.title}</p>
                        {banner.subtitle && <p className="line-clamp-2 text-[11px] leading-5 text-navy-500">{banner.subtitle}</p>}
                        <p className="text-[11px] text-navy-500">
                          ترتیب {faNum(index + 1)} • {banner.expiresAt ? `انقضا: ${faDateTime(banner.expiresAt)}` : 'بدون انقضا'}
                        </p>
                        <p className="flex items-center gap-1 text-[11px] text-navy-500">
                          <Link2 className="size-3" />
                          {banner.destinationKind === 'service'
                            ? `خدمت: ${targetService?.title ?? banner.destinationSlug}`
                            : banner.destinationKind === 'url'
                              ? `مقصد: ${banner.destinationUrl}`
                              : 'بدون مقصد (فقط اطلاع‌رسانی)'}
                        </p>
                        {banner.notifyCustomers && (
                          <p className="flex items-center gap-1 text-[11px] text-amber-600">
                            <Bell className="size-3" /> با انتشار، به مشتری‌ها اعلان می‌شود
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 pt-1">
                          <Button size="sm" variant="ghost" onClick={() => moveBanner(banner, -1)} disabled={index === 0}><ArrowUp className="size-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => moveBanner(banner, 1)} disabled={index === banners.length - 1}><ArrowDown className="size-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => togglePublished(banner)}>
                            {banner.status === 'published' ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                            {banner.status === 'published' ? 'خروج از انتشار' : 'انتشار'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEditor(banner)}><Pencil className="size-3.5" /> ویرایش</Button>
                          <Button size="sm" variant="ghost" onClick={() => removeBanner(banner)}><Trash2 className="size-3.5" /> حذف</Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>

              <Card>
                <h3 className="mb-2 flex items-center gap-2 font-bold text-navy-900">{values['app.announcement'] ? <Eye className="size-4 text-accent" /> : <EyeOff className="size-4 text-navy-400" />} اطلاعیه سراسری داخل اپ</h3>
                <p className="mb-3 text-[11px] leading-6 text-navy-500">این متن بالای صفحه اصلی اپ برای همه مشتری‌ها نمایش داده می‌شود. ذخیره‌اش در تب «تنظیمات و نسخه‌ها» انجام می‌شود.</p>
                <Textarea value={values['app.announcement'] ?? ''} onChange={(e) => setValues({ ...values, 'app.announcement': e.target.value })} placeholder="مثلاً: دفتر در روزهای تعطیل رسمی پاسخ‌گوی تلفنی نیست؛ درخواست آنلاین شما طبق نوبت رسیدگی می‌شود." />
                <div className="mt-3"><Button size="sm" loading={savingSettings} onClick={saveSettings}>ذخیره اطلاعیه و تنظیمات</Button></div>
              </Card>
            </div>
          )}

          {tab === 'settings' && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <h3 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Layers className="size-4 text-accent" /> نسخه و به‌روزرسانی</h3>
                <div className="space-y-3">
                  <Field label="آخرین نسخه منتشرشده"><Input dir="ltr" className="text-left" value={values['app.latest_version'] ?? ''} onChange={(e) => setValues({ ...values, 'app.latest_version': e.target.value })} placeholder="1.0.0" /></Field>
                  <Field label="حداقل نسخه مجاز"><Input dir="ltr" className="text-left" value={values['app.min_version'] ?? ''} onChange={(e) => setValues({ ...values, 'app.min_version': e.target.value })} placeholder="1.0.0" /></Field>
                  <Field label="پیوند دریافت نسخه تازه" hint="خالی یعنی از پیوند دانلود اپ اندروید در تنظیمات صفحه فرود استفاده شود."><Input dir="ltr" className="text-left" value={values['app.update_url'] ?? ''} onChange={(e) => setValues({ ...values, 'app.update_url': e.target.value })} placeholder="https://…/pishkan.apk" /></Field>
                  <Switch checked={Boolean(values['app.force_update'])} onChange={(v) => setValues({ ...values, 'app.force_update': v })} label="به‌روزرسانی اجباری برای نسخه‌های قدیمی‌تر از حداقل" />
                  <p className="text-[11px] leading-6 text-navy-500">
                    هر نسخه اپ با تگ <span dir="ltr">android-vX.Y.Z</span> روی گیت‌هاب به‌صورت خودکار ساخته و APK/AAB آن در
                    <a className="mx-1 text-accent hover:underline" href="https://github.com/khajavy8056/Pishkan/releases" target="_blank" rel="noreferrer">GitHub Releases</a>
                    منتشر می‌شود. پس از هر انتشار، «آخرین نسخه» را همین‌جا به‌روز کنید.
                  </p>
                </div>
              </Card>
              <Card>
                <h3 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Smartphone className="size-4 text-accent" /> ورود و نمایش اپ</h3>
                <div className="space-y-3">
                  <Field label="عنوان خوشامد اپ" hint="خالی یعنی نام سامانه."><Input value={values['app.welcome_title'] ?? ''} onChange={(e) => setValues({ ...values, 'app.welcome_title': e.target.value })} /></Field>
                  <Switch checked={Boolean(values['app.banners_enabled'])} onChange={(v) => setValues({ ...values, 'app.banners_enabled': v })} label="نمایش ردیف بنرها در صفحه اصلی اپ" />
                  <Switch checked={Boolean(values['auth.customer_password_enabled'])} onChange={(v) => setValues({ ...values, 'auth.customer_password_enabled': v })} label="ورود مشتری با موبایل و رمز عبور" />
                  <Switch checked={Boolean(values['auth.customer_otp_enabled'])} onChange={(v) => setValues({ ...values, 'auth.customer_otp_enabled': v })} label="ورود مشتری با کد یکبارمصرف پیامکی (OTP)" />
                  <Switch checked={Boolean(values['auth.customer_registration_open'])} onChange={(v) => setValues({ ...values, 'auth.customer_registration_open': v })} label="ثبت‌نام مشتری جدید از داخل اپ" />
                  <p className="text-[11px] leading-6 text-navy-500">
                    روش‌های ورود اپ و سایت یکی است و از همین کلیدها خوانده می‌شود؛ کاربر اپ اگر در سایت هم وارد شود، دقیقاً همان حساب، درخواست‌ها و کیف پول را می‌بیند.
                  </p>
                </div>
              </Card>
              <Card className="lg:col-span-2">
                <h3 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Link2 className="size-4 text-accent" /> اتصال اپ در شبکه دفتر (Wi‑Fi)</h3>
                {connection?.lanEnabled ? (
                  <div className="space-y-3">
                    <p className="text-[12px] leading-6 text-navy-600">{connection.hint}</p>
                    <div className="flex flex-wrap gap-4">
                      {(connection.urls ?? []).map((url: string) => (
                        <div key={url} className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-line">
                          {qrImages[url]
                            ? <img src={qrImages[url]} alt={`QR آدرس ${url}`} className="size-36 rounded-xl bg-white p-1 ring-1 ring-line" />
                            : <div className="flex size-36 items-center justify-center rounded-xl bg-white text-[11px] text-navy-400 ring-1 ring-line">QR ساخته نشد</div>}
                          <code dir="ltr" className="text-[12px] font-bold text-navy-800">{url}</code>
                          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(url).catch(() => undefined); notify('آدرس اتصال کپی شد.', 'success'); }}>کپی آدرس</Button>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] leading-6 text-navy-500">{connection.note}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[12px] leading-6 text-navy-600">{connection?.hint ?? 'در حال بررسی وضعیت شبکه…'}</p>
                    <p className="text-[11px] leading-6 text-navy-500">
                      در نصب ویندوزی، از «Pishkan Manager» دکمهٔ «دسترسی موبایل / QR» و سپس «📱 باز کردن فایروال برای موبایل» را بزنید؛ با یک تأیید Windows قانون فایروال ساخته می‌شود و گوشی‌های روی همان Wi‑Fi وصل می‌شوند. روی سرور ابری، اپ را مستقیم به دامنهٔ HTTPS وصل کنید و این کارت لازم نیست.
                    </p>
                  </div>
                )}
              </Card>
              <div className="lg:col-span-2"><Button loading={savingSettings} onClick={saveSettings}>ذخیره همه تنظیمات اپ</Button></div>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'ویرایش بنر' : 'بنر تازه'}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>انصراف</Button>
          <Button
            loading={savingBanner}
            onClick={saveBanner}
            disabled={
              !editing?.title
              // KEEP_IMAGE means an uploaded picture is already attached.
              || !editing?.imageFileId && !editing?.imageUrl
              || (editing?.destinationKind === 'service' && !editing?.destinationSlug)
              || (editing?.destinationKind === 'url' && !editing?.destinationUrl)
            }
          >ذخیره بنر</Button>
        </>}
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="عنوان" required><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="مثلاً: تعویض پلاک، بدون صف" /></Field>
              <Field label="نوع بنر" hint={KIND_META[editing.kind as Banner['kind']]?.hint}>
                <Select
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                  options={(Object.keys(KIND_META) as Banner['kind'][]).map((key) => ({ value: key, label: KIND_META[key].label }))}
                />
              </Field>
            </div>
            <Field label="زیرعنوان" hint="یک جملهٔ کوتاه که زیر عنوان می‌نشیند؛ خالی باشد فقط عنوان دیده می‌شود.">
              <Textarea value={editing.subtitle} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} placeholder="مثلاً: نوبت و مدارک را همین‌جا انجام دهید؛ پیگیری تا تحویل با ما." />
            </Field>

            <Field label="تصویر بنر (افقی — پیشنهاد ۱۶:۹)">
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ''; }} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}><Upload className="size-4" /> بارگذاری تصویر</Button>
                {imageName && <span dir="ltr" className="text-[11px] text-navy-500">{imageName}</span>}
                {imagePreview && <img src={imagePreview} alt="پیش‌نمایش" className="h-28 w-auto rounded-xl object-cover ring-1 ring-line" />}
              </div>
            </Field>
            <Field label="یا نشانی تصویر" hint="برای تصاویر داخل خود سامانه (مثل /images/services/…) یا تصویری روی اینترنت. با بارگذاری فایل، این بخش نادیده گرفته می‌شود.">
              <Input dir="ltr" className="text-left" value={editing.imageUrl} onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value, imageFileId: '' })} placeholder="https://… یا /images/services/…" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="مقصد لمس">
                <Select
                  value={editing.destinationKind}
                  onChange={(e) => setEditing({ ...editing, destinationKind: e.target.value })}
                  options={[
                    { value: 'service', label: 'باز کردن یک خدمت' },
                    { value: 'url', label: 'باز کردن یک صفحه' },
                    { value: 'none', label: 'بدون مقصد (اطلاع‌رسانی)' },
                  ]}
                />
              </Field>
              <Field label="متن دکمه" hint="روی کارت بنر، این متن در دکمهٔ کوچک پایین نوشته می‌شود.">
                <Input value={editing.actionLabel} onChange={(e) => setEditing({ ...editing, actionLabel: e.target.value })} placeholder="مشاهده خدمت" />
              </Field>
            </div>

            {editing.destinationKind === 'service' && (
              <Field label="خدمت مقصد" required hint="لمس بنر، مستقیماً صفحهٔ همین خدمت را در اپ باز می‌کند.">
                <Select
                  value={editing.destinationSlug}
                  onChange={(e) => setEditing({ ...editing, destinationSlug: e.target.value })}
                  options={targetOptions}
                />
              </Field>
            )}

            {editing.destinationKind === 'url' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="صفحهٔ داخلی اپ">
                  <Select
                    value={IN_APP_PAGES.some((p) => p.value === editing.destinationUrl) ? editing.destinationUrl : ''}
                    onChange={(e) => setEditing({ ...editing, destinationUrl: e.target.value })}
                    placeholder="— انتخاب صفحه —"
                    options={IN_APP_PAGES}
                  />
                </Field>
                <Field label="یا نشانی دلخواه" hint="نشانی اینترنتی کامل، یا مسیر /services/<slug>.">
                  <Input dir="ltr" className="text-left" value={editing.destinationUrl} onChange={(e) => setEditing({ ...editing, destinationUrl: e.target.value })} placeholder="/app/requests یا https://…" />
                </Field>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="شروع نمایش (اختیاری)" hint="خالی یعنی از همین حالا."><Input type="datetime-local" dir="ltr" className="text-left" value={editing.startsAt} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })} /></Field>
              <Field label="پایان نمایش (اختیاری)" hint="خالی یعنی بدون انقضا."><Input type="datetime-local" dir="ltr" className="text-left" value={editing.expiresAt} onChange={(e) => setEditing({ ...editing, expiresAt: e.target.value })} /></Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="وضعیت">
                <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} options={[{ value: 'published', label: 'منتشرشده' }, { value: 'draft', label: 'پیش‌نویس' }]} />
              </Field>
              <Field label="رنگ تأکید" hint="رنگ دکمه و در صورت نداشتن تصویر، رنگ پس‌زمینه.">
                <Input dir="ltr" className="text-left" value={editing.accentColor} onChange={(e) => setEditing({ ...editing, accentColor: e.target.value })} placeholder="#1F6FEE" />
              </Field>
            </div>

            <div className="rounded-2xl bg-surface-3 p-3">
              <Switch
                checked={Boolean(editing.notifyCustomers)}
                onChange={(v) => setEditing({ ...editing, notifyCustomers: v })}
                label="انتشار این بنر برای مشتری‌ها اعلان بسازد"
              />
              <p className="mt-2 text-[11px] leading-6 text-navy-500">
                فقط یک بار و در اولین انتشار ساخته می‌شود؛ اگر بنر را بعداً ویرایش کنید اعلان تازه‌ای نمی‌رود.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
