import { useEffect, useRef, useState } from 'react';
import {
  Smartphone, RefreshCw, Plus, Trash2, Pencil, ArrowUp, ArrowDown, Eye, EyeOff,
  Users, Activity, History, Layers, Link2, Upload,
} from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select,
  StatCard, Switch, Tabs, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum, relative } from '../../lib/format';

interface Story {
  id: string;
  groupTitle: string | null;
  title: string;
  mediaType: 'image' | 'video';
  fileId: string | null;
  mediaUrl: string | null;
  externalMediaUrl: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  durationSeconds: number;
  sortOrder: number;
  startsAt: string | null;
  expiresAt: string | null;
  status: string;
  createdAt: string;
}

const emptyStory = {
  groupTitle: '', title: '', mediaType: 'image' as 'image' | 'video', fileId: '' as string,
  mediaUrl: '', linkUrl: '', linkLabel: '', durationSeconds: 6, startsAt: '', expiresAt: '',
  status: 'published' as 'draft' | 'published',
};

export function AdminAndroidApp() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState<'stories' | 'stats' | 'settings'>('stories');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stories, setStories] = useState<Story[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [mediaName, setMediaName] = useState('');
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingStory, setSavingStory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<{ data: Story[] }>('/api/app/admin/stories').catch(() => ({ data: [] as Story[] })),
      api.get<{ data: any }>('/api/app/admin/stats').catch(() => ({ data: null })),
      api.get<{ data: any }>('/api/settings/admin'),
    ]).then(([st, stat, settings]) => {
      setStories(st.data ?? []);
      setStats(stat.data);
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
        'app.stories_enabled', 'app.announcement', 'app.welcome_title',
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

  /* --------------------------------- stories -------------------------------- */

  const openEditor = (story?: Story | null) => {
    setMediaName('');
    setMediaPreview(story?.mediaUrl ?? null);
    setEditing(story ? {
      id: story.id,
      groupTitle: story.groupTitle ?? '',
      title: story.title,
      mediaType: story.mediaType,
      fileId: story.fileId ?? '',
      mediaUrl: story.externalMediaUrl ?? '',
      linkUrl: story.linkUrl ?? '',
      linkLabel: story.linkLabel ?? '',
      durationSeconds: story.durationSeconds,
      startsAt: story.startsAt ? story.startsAt.slice(0, 16) : '',
      expiresAt: story.expiresAt ? story.expiresAt.slice(0, 16) : '',
      status: story.status,
    } : { ...emptyStory });
  };

  const uploadMedia = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.upload<{ data: { id: string; name: string; mime: string } }>('/api/files/upload', file, { purpose: 'story' });
      const isVideo = (res.data.mime ?? '').startsWith('video/');
      setMediaPreview(URL.createObjectURL(file));
      setMediaName(res.data.name);
      setEditing((current: any) => ({
        ...current,
        fileId: res.data.id,
        mediaUrl: '',
        mediaType: isVideo ? 'video' : 'image',
      }));
      notify(isVideo ? 'ویدئوی استوری بارگذاری شد.' : 'تصویر استوری بارگذاری شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری رسانه ناموفق بود.', 'error');
    } finally { setUploading(false); }
  };

  const saveStory = async () => {
    if (!editing) return;
    setSavingStory(true);
    try {
      const payload = {
        groupTitle: editing.groupTitle || null,
        title: editing.title,
        mediaType: editing.mediaType,
        fileId: editing.fileId || null,
        mediaUrl: editing.mediaUrl || null,
        linkUrl: editing.linkUrl || null,
        linkLabel: editing.linkLabel || null,
        durationSeconds: Number(editing.durationSeconds) || 6,
        startsAt: editing.startsAt ? new Date(editing.startsAt).toISOString() : null,
        expiresAt: editing.expiresAt ? new Date(editing.expiresAt).toISOString() : null,
        status: editing.status,
      };
      if (editing.id) await api.patch(`/api/app/admin/stories/${editing.id}`, payload);
      else await api.post('/api/app/admin/stories', payload);
      notify('استوری ذخیره شد.', 'success');
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ذخیره استوری', 'error');
    } finally { setSavingStory(false); }
  };

  const removeStory = async (story: Story) => {
    if (!window.confirm(`استوری «${story.title}» حذف شود؟`)) return;
    try {
      await api.delete(`/api/app/admin/stories/${story.id}`);
      notify('استوری حذف شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در حذف', 'error');
    }
  };

  const moveStory = async (story: Story, delta: number) => {
    const ids = stories.map((s) => s.id);
    const index = ids.indexOf(story.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setStories(ids.map((id) => stories.find((s) => s.id === id)!));
    try {
      const res = await api.post<{ data: Story[] }>('/api/app/admin/stories/reorder', { ids });
      setStories(res.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ترتیب‌دهی', 'error');
      load();
    }
  };

  const tabs = [
    { key: 'stories', label: 'استوری‌ها و اطلاعیه' },
    { key: 'stats', label: 'آمار و همگام‌سازی' },
    { key: 'settings', label: 'تنظیمات و نسخه‌ها' },
  ];

  return (
    <AppShell variant="admin">
      <PageHeader title="اپ اندروید مشتریان" description="استوری و اطلاعیه، سیاست نسخه و به‌روزرسانی، روش‌های ورود به اپ و آمار استفاده — اپ از همین سامانه و پایگاه داده استفاده می‌کند."
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
                    <p>استوری‌های منتشرشده: <b>{faNum(stats?.stories.published ?? 0)}</b> • پیش‌نویس: <b>{faNum(stats?.stories.draft ?? 0)}</b></p>
                    <p className="text-[11px] leading-6 text-navy-500">
                      هر گوشی با ورود موفق و هر اجرای سرد اپ، حضورش را اینجا ثبت می‌کند.
                      کاتالوگ خدمات و استوری‌ها در خود اپ هم کش می‌شوند تا در اینترنت ضعیف هم کار کند.
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

          {tab === 'stories' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm leading-7 text-navy-600">
                  استوری‌ها در بالای صفحهٔ اصلی اپ مثل حلقه‌های اینستاگرام نشان داده می‌شوند. با «عنوان گروه» یکسان، چند استوری پشت‌سرهم در یک حلقه می‌نشینند.
                </p>
                {can('app.manage') && <Button onClick={() => openEditor(null)}><Plus className="size-4" /> استوری تازه</Button>}
              </div>
              {stories.length === 0 && <EmptyState title="استوری‌ای ثبت نشده است" description="اولین استوری (تصویر یا ویدئوی کوتاه عمودی) را بسازید تا در اپ دیده شود." />}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {stories.map((story, index) => (
                  <Card key={story.id} pad={false} className="overflow-hidden">
                    <div className="relative aspect-[9/16] max-h-64 w-full bg-navy-900">
                      {story.mediaType === 'video'
                        ? <video src={story.mediaUrl ?? undefined} className="size-full object-cover" muted loop playsInline preload="metadata" />
                        : story.mediaUrl
                          ? <img src={story.mediaUrl} alt={story.title} className="size-full object-cover" />
                          : <div className="flex size-full items-center justify-center text-navy-400"><Smartphone className="size-8" /></div>}
                      <span className="absolute right-2 top-2"><Badge tone={story.status === 'published' ? 'success' : 'warning'}>{story.status === 'published' ? 'منتشرشده' : 'پیش‌نویس'}</Badge></span>
                    </div>
                    <div className="space-y-1 p-3">
                      <p className="truncate text-sm font-bold text-navy-900">{story.title}</p>
                      <p className="text-[11px] text-navy-500">
                        {story.groupTitle ? `گروه: ${story.groupTitle} • ` : ''}{story.mediaType === 'video' ? 'ویدئو' : 'تصویر'} • ترتیب {faNum(index + 1)}
                      </p>
                      <p className="text-[11px] text-navy-500">
                        {story.expiresAt ? `انقضا: ${faDateTime(story.expiresAt)}` : 'بدون انقضا'}
                        {story.linkUrl && <span className="mr-2 inline-flex items-center gap-1"><Link2 className="size-3" />{story.linkLabel ?? 'پیوند'}</span>}
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button size="sm" variant="ghost" onClick={() => moveStory(story, -1)} disabled={index === 0}><ArrowUp className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => moveStory(story, 1)} disabled={index === stories.length - 1}><ArrowDown className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => openEditor(story)}><Pencil className="size-3.5" /> ویرایش</Button>
                        <Button size="sm" variant="ghost" onClick={() => removeStory(story)}><Trash2 className="size-3.5" /> حذف</Button>
                      </div>
                    </div>
                  </Card>
                ))}
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
                  <Switch checked={Boolean(values['app.stories_enabled'])} onChange={(v) => setValues({ ...values, 'app.stories_enabled': v })} label="نمایش ردیف استوری‌ها در صفحه اصلی اپ" />
                  <Switch checked={Boolean(values['auth.customer_password_enabled'])} onChange={(v) => setValues({ ...values, 'auth.customer_password_enabled': v })} label="ورود مشتری با موبایل و رمز عبور" />
                  <Switch checked={Boolean(values['auth.customer_otp_enabled'])} onChange={(v) => setValues({ ...values, 'auth.customer_otp_enabled': v })} label="ورود مشتری با کد یکبارمصرف پیامکی (OTP)" />
                  <Switch checked={Boolean(values['auth.customer_registration_open'])} onChange={(v) => setValues({ ...values, 'auth.customer_registration_open': v })} label="ثبت‌نام مشتری جدید از داخل اپ" />
                  <p className="text-[11px] leading-6 text-navy-500">
                    روش‌های ورود اپ و سایت یکی است و از همین کلیدها خوانده می‌شود؛ کاربر اپ اگر در سایت هم وارد شود، دقیقاً همان حساب، درخواست‌ها و کیف پول را می‌بیند.
                  </p>
                </div>
              </Card>
              <div className="lg:col-span-2"><Button loading={savingSettings} onClick={saveSettings}>ذخیره همه تنظیمات اپ</Button></div>
            </div>
          )}
        </>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'ویرایش استوری' : 'استوری تازه'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>انصراف</Button><Button loading={savingStory} onClick={saveStory} disabled={!editing?.title || (!editing?.fileId && !editing?.mediaUrl)}>ذخیره استوری</Button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="عنوان" required><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
              <Field label="عنوان گروه (حلقه)" hint="استوری‌های هم‌گروه پشت‌سرهم در یک حلقه می‌آیند."><Input value={editing.groupTitle} onChange={(e) => setEditing({ ...editing, groupTitle: e.target.value })} placeholder="مثلاً: پیشنهاد هفته" /></Field>
            </div>

            <Field label="رسانه (تصویر عمودی یا ویدئوی کوتاه — پیشنهاد ۹:۱۶)">
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMedia(f); e.target.value = ''; }} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}><Upload className="size-4" /> بارگذاری رسانه</Button>
                {mediaName && <span dir="ltr" className="text-[11px] text-navy-500">{mediaName}</span>}
                {mediaPreview && (editing.mediaType === 'video'
                  ? <video src={mediaPreview} className="h-36 w-auto rounded-xl ring-1 ring-line" muted loop playsInline autoPlay />
                  : <img src={mediaPreview} alt="پیش‌نمایش" className="h-36 w-auto rounded-xl object-cover ring-1 ring-line" />)}
              </div>
            </Field>
            <Field label="یا نشانی اینترنتی رسانه" hint="اگر رسانه روی اینترنت است (اختیاری). با بارگذاری فایل، این بخش خالی می‌شود.">
              <Input dir="ltr" className="text-left" value={editing.mediaUrl} onChange={(e) => setEditing({ ...editing, mediaUrl: e.target.value, fileId: '' })} placeholder="https://…" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="پیوند لمس استوری" hint="می‌تواند نشانی اینترنتی یا مسیر داخل اپ باشد."><Input dir="ltr" className="text-left" value={editing.linkUrl} onChange={(e) => setEditing({ ...editing, linkUrl: e.target.value })} placeholder="https://… یا /services" /></Field>
              <Field label="متن دکمه پیوند"><Input value={editing.linkLabel} onChange={(e) => setEditing({ ...editing, linkLabel: e.target.value })} placeholder="مشاهده خدمت" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="مدت نمایش تصویر (ثانیه)"><Input type="number" min={2} max={60} dir="ltr" className="text-left" value={editing.durationSeconds} onChange={(e) => setEditing({ ...editing, durationSeconds: Number(e.target.value) })} /></Field>
              <Field label="وضعیت"><Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} options={[{ value: 'published', label: 'منتشرشده' }, { value: 'draft', label: 'پیش‌نویس' }]} /></Field>
              <Field label="نوع رسانه"><Select value={editing.mediaType} onChange={(e) => setEditing({ ...editing, mediaType: e.target.value })} options={[{ value: 'image', label: 'تصویر' }, { value: 'video', label: 'ویدئو' }]} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="شروع نمایش (اختیاری)"><Input type="datetime-local" dir="ltr" className="text-left" value={editing.startsAt} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })} /></Field>
              <Field label="انقضا (اختیاری)"><Input type="datetime-local" dir="ltr" className="text-left" value={editing.expiresAt} onChange={(e) => setEditing({ ...editing, expiresAt: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
