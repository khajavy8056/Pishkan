import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, BellRing, Check, Coins, Clock, FileText, Inbox, Info, RefreshCw, Search, Timer, Wallet, X,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell } from '../../components/shell';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Pagination, Select, useToast } from '../../components/ui';
import { GlossyStat, HeroShell } from '../../components/panel';
import { CategoryArt } from '../../components/visual';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDate, faNum, relative, rial } from '../../lib/format';
import { disablePush, enablePush } from '../../lib/push';

interface QueueItem {
  id: string;
  trackingCode: string;
  serviceTitle: string;
  categoryIcon?: string | null;
  categoryColor?: string | null;
  categoryTitle?: string | null;
  priority: string;
  status: string;
  createdAt: string;
  estimatedCompletionAt: string | null;
  forceAssignAt: string | null;
  remainingMinutes: number | null;
  cooperationType: 'commission' | 'monthly' | 'none';
  earnings: { percent: number; officeRevenue: number; amount: number; estimate: boolean } | null;
  serviceEstimatedMinutes?: number;
  documentsRequired?: number;
  documentsTotal?: number;
  documentsAttached?: number;
}

/** Human readable remaining time from a minute count. */
function remaining(forceAssignAt: string | null, remainingMinutes: number | null) {
  if (!forceAssignAt) {
    return remainingMinutes === null ? 'بدون برآورد' : `${faNum(remainingMinutes)} دقیقه تا پایان برآورد`;
  }
  const minutes = Math.round((Date.parse(forceAssignAt) - Date.now()) / 60_000);
  if (minutes <= 0) return 'زمان پذیرش آزاد تمام شده است';
  if (minutes < 60) return `${faNum(minutes)} دقیقه تا واگذاری خودکار`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${faNum(hours)} ساعت تا واگذاری خودکار` : `${faNum(Math.round(hours / 24))} روز تا واگذاری خودکار`;
}

function serviceDuration(minutes?: number) {
  if (!minutes || minutes <= 0) return null;
  if (minutes >= 1440) return `${faNum(Math.round(minutes / 144) / 10)} روز`;
  if (minutes >= 60) return `${faNum(Math.round(minutes / 6) / 10)} ساعت`;
  return `${faNum(minutes)} دقیقه`;
}

const isToday = (iso: string) =>
  new Date(iso).toLocaleDateString('fa-IR') === new Date().toLocaleDateString('fa-IR');

/* ------------------------------ push opt-in ------------------------------ */

function PushToggle() {
  const { notify } = useToast();
  const [state, setState] = useState<'unsupported' | 'off' | 'on'>('off');
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    if (!supported) { setState('unsupported'); return; }
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      if (result === 'subscribed') {
        setState('on');
        notify('اعلان این دستگاه فعال شد؛ پروندهٔ تازه که به صف بیاید خبرتان می‌کنیم.', 'success');
      } else if (result === 'server-off') {
        notify('اعلان لحظه‌ای در تنظیمات سامانه خاموش است.', 'error');
        setState('off');
      } else if (result === 'denied') {
        notify('برای دریافت اعلان، اجازهٔ مرورگر لازم است.', 'error');
        setState('off');
      } else {
        notify('فعال‌سازی اعلان ناموفق بود.', 'error');
        setState('off');
      }
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disablePush();
      setState('off');
      notify('اعلان این دستگاه خاموش شد.', 'success');
    } catch {
      setState('on');
    } finally { setBusy(false); }
  };

  if (state === 'unsupported') return null;
  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <BellRing className="mt-0.5 size-5 text-brand-700" />
          <div>
            <p className="font-bold text-navy-900">اعلان لحظه‌ای پروندهٔ تازه</p>
            <p className="mt-0.5 text-xs leading-6 text-navy-500">
              {state === 'on'
                ? 'این دستگاه فعال است؛ به‌محض ورود پروندهٔ متناسب با شما به صف آزاد، اعلان می‌گیرید.'
                : 'با فعال‌کردن، لازم نیست مدام این صفحه را تازه کنید؛ پروندهٔ تازه خودش خبرتان می‌کند.'}
            </p>
          </div>
        </div>
        {state === 'on'
          ? <Button size="sm" variant="ghost" loading={busy} onClick={() => void disable()}>خاموش‌کردن روی این دستگاه</Button>
          : <Button size="sm" loading={busy} onClick={() => void enable()}>فعال‌کردن اعلان این دستگاه</Button>}
      </div>
    </Card>
  );
}

/* --------------------------------- page ---------------------------------- */

const PAGE_SIZE = 6;

export function EligibleQueue() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [conflict, setConflict] = useState<{ requestId: string; message: string } | null>(null);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState<'all' | 'high'>('all');
  const [todayOnly, setTodayOnly] = useState(false);
  const [sort, setSort] = useState<'deadline' | 'newest' | 'oldest'>('deadline');
  const [page, setPage] = useState(1);
  const { notify } = useToast();

  const load = () => {
    setError('');
    api.get<{ data: QueueItem[] }>('/api/requests/queue/eligible')
      .then((res) => setRows(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت صف'));
  };
  useEffect(load, []);

  const accept = async (item: QueueItem) => {
    setBusy(item.id);
    setConflict(null);
    try {
      await api.post(`/api/requests/${item.id}/claim`);
      notify('پرونده به شما سپرده شد و از صف سایر همکاران حذف شد.', 'success');
      load();
    } catch (err) {
      const message = err instanceof ApiFailure ? err.message : 'پذیرش پرونده ناموفق بود.';
      setConflict({ requestId: item.id, message });
      // Refresh immediately: the request is very likely gone from the pool now.
      load();
    } finally {
      setBusy('');
    }
  };

  const decline = async (item: QueueItem) => {
    setBusy(item.id);
    try {
      await api.post(`/api/requests/${item.id}/decline`);
      setRows((current) => (current ?? []).filter((row) => row.id !== item.id));
      notify('درخواست از صف شما حذف شد؛ همکاران دیگر همچنان آن را می‌بینند.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'رد درخواست ناموفق بود.', 'error');
      load();
    } finally {
      setBusy('');
    }
  };

  const commission = (rows?.[0]?.cooperationType ?? user?.cooperationType) === 'commission';

  const filtered = useMemo(() => {
    let list = [...(rows ?? [])];
    if (priority === 'high') list = list.filter((r) => r.priority === 'high');
    if (todayOnly) list = list.filter((r) => isToday(r.createdAt));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((r) => r.serviceTitle.toLowerCase().includes(q) || r.trackingCode.toLowerCase().includes(q));
    }
    if (sort === 'newest') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === 'oldest') list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else list.sort((a, b) => (a.remainingMinutes ?? 9_999_999) - (b.remainingMinutes ?? 9_999_999));
    return list;
  }, [rows, query, priority, todayOnly, sort]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <AppShell variant="staff">
      <HeroShell image="/images/queue-hero.jpg" aside={(
        <Button variant="ghost" className="bg-white/80" onClick={load}><RefreshCw className="size-4" /> تازه‌سازی صف</Button>
      )}>
        <span className="chip-soft mb-3 bg-white/70 text-brand-800">صف درخواست‌های آزاد</span>
        <h1 className="text-2xl font-black tracking-tight text-navy-900 sm:text-[1.8rem]">دریافت درخواست‌ها</h1>
        <p className="mt-2 max-w-xl text-sm leading-7 text-navy-600">
          درخواست‌هایی که هنوز کارشناس ندارند اینجایند؛ با «تأیید و قبول انجام» پرونده همان لحظه به شما سپرده
          می‌شود. با «رد کردن» فقط از صف شما کنار می‌رود و همکاران دیگر همچنان می‌توانند آن را بردارند.
        </p>
      </HeroShell>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <GlossyStat color="#2563eb" icon={<Inbox className="size-7" />} label="درخواست آزاد در صف"
          value={faNum(rows?.length ?? 0)} sub={`امروز ثبت شده: ${faNum(rows?.filter((r) => isToday(r.createdAt)).length ?? 0)}`} />
        <GlossyStat color="#e11d48" icon={<AlertTriangle className="size-7" />} label="فوری"
          value={faNum(rows?.filter((r) => r.priority === 'high').length ?? 0)} />
        <GlossyStat color="#d97706" icon={<Timer className="size-7" />} label="نزدیک واگذاری خودکار"
          value={faNum(rows?.filter((r) => (r.remainingMinutes ?? 9_999) < 120).length ?? 0)}
          sub="اگر کسی نپذیرد، سیستم خودش به یک کارمند آزاد می‌دهد" />
        {commission ? (
          <GlossyStat color="#16a34a" icon={<Coins className="size-7" />} label="سهم برآوردی من از صف"
            value={rial(rows?.reduce((sum, r) => sum + (r.earnings?.amount ?? 0), 0) ?? 0)}
            sub="برآورد؛ پس از پرداخت مشتری قطعی می‌شود" />
        ) : (
          <GlossyStat color="#334155" icon={<Wallet className="size-7" />} label="نوع همکاری من"
            value="حقوق ثابت" sub="درآمد درصدی برای شما تعریف نشده است" />
        )}
      </div>

      <PushToggle />

      <Card className="mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-surface-3 px-3.5 ring-1 ring-line">
            <Search className="size-4 shrink-0 text-navy-400" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="جست‌وجو بر اساس عنوان خدمت یا کد پیگیری…"
              className="w-full bg-transparent py-2.5 text-sm text-navy-900 outline-none placeholder:text-navy-400" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="اولویت" value={priority} onChange={(e) => { setPriority(e.target.value as 'all' | 'high'); setPage(1); }}
              options={[{ value: 'all', label: 'همهٔ اولویت‌ها' }, { value: 'high', label: 'فقط فوری' }]} className="w-40" />
            <Select aria-label="مرتب‌سازی" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
              options={[
                { value: 'deadline', label: 'نزدیک‌ترین مهلت' },
                { value: 'newest', label: 'تازه‌ترین' },
                { value: 'oldest', label: 'قدیمی‌ترین' },
              ]} className="w-40" />
            <button type="button" onClick={() => { setTodayOnly((v) => !v); setPage(1); }}
              className={clsx('rounded-full px-3.5 py-2 text-xs font-bold ring-1 transition',
                todayOnly ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
              فقط امروز
            </button>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-navy-400">نمایش {faNum(filtered.length)} از {faNum(rows?.length ?? 0)} درخواست در صف</p>
      </Card>

      {conflict && (
        <Card className="mb-5 border-amber-300 bg-amber-50/70">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 text-amber-700" />
            <div>
              <p className="font-semibold text-navy-900">پرونده پذیرفته نشد</p>
              <p className="mt-1 text-sm leading-6 text-navy-700">{conflict.message}</p>
              <p className="mt-1 text-xs text-navy-500">این پرونده از فهرست شما حذف شد؛ نیازی به تلاش دوباره نیست.</p>
            </div>
          </div>
        </Card>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!rows && !error && <Loading />}
      {rows?.length === 0 && (
        <EmptyState
          title="در حال حاضر درخواست آزادی در صف نیست"
          description="درخواست‌های تازه که هنوز پذیرفته نشده‌اند اینجا نمایش داده می‌شوند. اگر شیفت فعال و ظرفیت دارید، چند لحظه بعد دوباره سر بزنید."
        />
      )}
      {rows && rows.length > 0 && filtered.length === 0 && (
        <EmptyState title="با این فیلترها درخواستی پیدا نشد" description="جست‌وجو یا فیلترها را تغییر دهید تا بقیهٔ صف را ببینید." />
      )}

      <div className="space-y-4">
        {pageRows.map((item) => {
          const duration = serviceDuration(item.serviceEstimatedMinutes);
          return (
            <Card key={item.id} className={clsx('lift', item.priority === 'high' && 'ring-1 ring-rose-200')}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3.5">
                  <CategoryArt name={item.categoryIcon} color={item.categoryColor} className="size-16" glyphClassName="size-9" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={item.priority === 'high' ? 'danger' : 'info'}>
                        {item.priority === 'high' ? 'اولویت بالا' : 'عادی'}
                      </Badge>
                      {item.categoryTitle && <span className="text-[11px] text-navy-400">{item.categoryTitle}</span>}
                    </div>
                    <h2 className="mt-2 truncate text-base font-black text-navy-900">{item.serviceTitle}</h2>
                    <p className="mt-1 text-xs text-navy-500">کد پیگیری {faNum(item.trackingCode)} • هویت مشتری پس از پذیرش نمایش داده می‌شود</p>
                  </div>
                </div>

                <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-xs text-navy-600 sm:grid-cols-4 xl:w-[26rem]">
                  <div>
                    <dt className="flex items-center gap-1 text-navy-400"><Clock className="size-3.5" /> از زمان درخواست</dt>
                    <dd className="mt-1 font-bold text-navy-800">{relative(item.createdAt)}</dd>
                    <dd className="text-[10px] text-navy-400">{faDate(item.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-navy-400"><Timer className="size-3.5" /> مهلت آزاد</dt>
                    <dd className={clsx('mt-1 font-bold', (item.remainingMinutes ?? 9_999) < 120 ? 'text-rose-700' : 'text-navy-800')}>
                      {remaining(item.forceAssignAt, item.remainingMinutes)}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-navy-400"><FileText className="size-3.5" /> مدارک خدمت</dt>
                    <dd className="mt-1 font-bold text-navy-800">
                      {(item.documentsTotal ?? 0) > 0
                        ? `${faNum(item.documentsRequired ?? 0)} الزامی از ${faNum(item.documentsTotal ?? 0)}`
                        : 'بدون مدرک'}
                    </dd>
                    {(item.documentsTotal ?? 0) > 0 && <dd className="text-[10px] text-navy-400">بارگذاری‌شده: {faNum(item.documentsAttached ?? 0)}</dd>}
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-navy-400"><Timer className="size-3.5" /> زمان تقریبی خدمت</dt>
                    <dd className="mt-1 font-bold text-navy-800">{duration ?? '—'}</dd>
                  </div>
                </dl>

                {item.earnings ? (
                  <div className="shrink-0 rounded-[1.2rem] bg-gradient-to-b from-brand-700 to-brand-500 p-4 text-white shadow-soft xl:w-60">
                    <p className="flex items-center gap-1 text-[11px] text-white/80">
                      سهم درآمد شما از این خدمت
                      <Info className="size-3.5" aria-label="سهم شما از درآمد دفتر این خدمت است و پس از پرداخت مشتری قطعی می‌شود" />
                    </p>
                    <p className="mt-1 text-xl font-black">{rial(item.earnings.amount)}</p>
                    <p className="mt-1 text-[11px] text-white/85">درصد از تعرفهٔ خدمت: {faNum(item.earnings.percent)}٪</p>
                    <p className="mt-0.5 text-[10px] text-white/65">برآوردی؛ پس از پرداخت مشتری قطعی می‌شود</p>
                  </div>
                ) : (
                  <div className="shrink-0 rounded-[1.2rem] bg-surface-3 p-4 ring-1 ring-line xl:w-60">
                    <p className="text-[11px] text-navy-500">نوع همکاری</p>
                    <p className="mt-1 text-base font-black text-navy-900">حقوق ثابت</p>
                    <p className="mt-1 text-[11px] leading-5 text-navy-500">حقوق شما ماهانه طبق قرارداد پرداخت می‌شود؛ درآمد درصدی برای شما تعریف نشده است.</p>
                  </div>
                )}

                <div className="flex shrink-0 flex-col gap-2 sm:flex-row xl:w-44 xl:flex-col">
                  <button type="button" disabled={busy === item.id} onClick={() => void accept(item)}
                    className="btn btn-md flex-1 bg-gradient-to-b from-emerald-500 to-emerald-600 font-bold text-white shadow-[0_10px_20px_-10px_rgb(16_185_129/.8),inset_0_1px_0_rgb(255_255_255/.35)] transition hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-60">
                    <Check className="size-4" /> تأیید و قبول انجام
                  </button>
                  <button type="button" disabled={busy === item.id} onClick={() => void decline(item)}
                    className="btn btn-md flex-1 border border-rose-200 bg-rose-50 font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60">
                    <X className="size-4" /> رد کردن
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="mt-5 flex justify-center">
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-6 text-navy-500">
          اطلاعات هویتی مشتری تا لحظه پذیرش نمایش داده نمی‌شود. اگر دو همکار هم‌زمان بپذیرند، فقط یکی موفق می‌شود و
          به دیگری پیام روشن «توسط شخص دیگر پذیرفته شد» داده می‌شود. «رد کردن» فقط صف شما را تغییر می‌دهد.
        </p>
        <Link className="btn-soft" to="/staff/requests">پرونده‌های من</Link>
      </div>
    </AppShell>
  );
}
