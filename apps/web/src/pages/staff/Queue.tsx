import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BellRing, CheckCircle2, Coins, Clock, Inbox, RefreshCw, Timer,
  FileText,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, StatCard, useToast } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faNum, rial } from '../../lib/format';

interface QueueItem {
  id: string;
  trackingCode: string;
  serviceTitle: string;
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

/* ------------------------------ push opt-in ------------------------------ */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

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
      const server = await api.get<{ data: { enabled: boolean; publicKey: string | null } }>('/api/push/public-key');
      if (!server.data.enabled || !server.data.publicKey) {
        notify('اعلان لحظه‌ای در تنظیمات سامانه خاموش است.', 'error');
        setState('off');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        notify('برای دریافت اعلان، اجازهٔ مرورگر لازم است.', 'error');
        setState('off');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(server.data.publicKey) as BufferSource,
      });
      await api.post('/api/push/subscribe', subscription.toJSON());
      setState('on');
      notify('اعلان این دستگاه فعال شد؛ پروندهٔ تازه که به صف بیاید خبرتان می‌کنیم.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'فعال‌سازی اعلان ناموفق بود.', 'error');
      setState('off');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => undefined);
        await subscription.unsubscribe().catch(() => undefined);
      }
      setState('off');
      notify('اعلان این دستگاه خاموش شد.', 'success');
    } catch {
      setState('on');
    } finally { setBusy(false); }
  };

  if (state === 'unsupported') return null;
  return (
    <Card className="mb-4">
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

export function EligibleQueue() {
  const [rows, setRows] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [conflict, setConflict] = useState<{ requestId: string; message: string } | null>(null);
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

  const commission = rows?.some((row) => row.cooperationType === 'commission') ?? false;

  return (
    <AppShell variant="staff">
      <PageHeader
        title="صف درخواست‌های آزاد"
        description="هر درخواستی که هنوز کسی آن را برنداشته در این صف است. با «می‌پذیرم» پرونده به شما سپرده می‌شود و همان لحظه از فهرست همه کارکنان دیگر حذف می‌شود."
        actions={<Button variant="ghost" onClick={load}><RefreshCw className="size-4" /> تازه‌سازی صف</Button>}
      />

      <PushToggle />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="درخواست آزاد" value={faNum(rows?.length ?? 0)} icon={<Inbox className="size-5" />} />
        <StatCard
          label="فوری"
          value={faNum(rows?.filter((row) => row.priority === 'high').length ?? 0)}
          tone="amber"
          icon={<AlertTriangle className="size-5" />}
        />
        <StatCard
          label="نزدیک واگذاری خودکار"
          value={faNum(rows?.filter((row) => (row.remainingMinutes ?? 9_999) < 120).length ?? 0)}
          tone="rose"
          icon={<Timer className="size-5" />}
          hint="اگر کسی نپذیرد، سیستم خودش به یک کارمند آزاد می‌دهد"
        />
        <StatCard
          label={commission ? 'سهم من از صف' : 'نوع همکاری من'}
          value={commission
            ? rial(rows?.reduce((sum, row) => sum + (row.earnings?.amount ?? 0), 0) ?? 0)
            : 'حقوق ثابت'}
          tone={commission ? 'emerald' : 'brand'}
          icon={commission ? <Coins className="size-5" /> : <Clock className="size-5" />}
          hint={commission ? 'برآورد؛ پس از پرداخت مشتری قطعی می‌شود' : 'درآمد درصدی برای شما تعریف نشده است'}
        />
      </div>

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

      <div className="grid gap-4 md:grid-cols-2">
        {rows?.map((item) => (
          <Card key={item.id} className={clsx('flex flex-col', item.priority === 'high' && 'ring-1 ring-rose-200')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Badge tone={item.priority === 'high' ? 'danger' : 'info'}>
                  {item.priority === 'high' ? 'فوری' : 'عادی'}
                </Badge>
                <h2 className="mt-3 truncate font-bold text-navy-900">{item.serviceTitle}</h2>
                <p className="mt-1 text-xs text-navy-500">کد پیگیری {item.trackingCode}</p>
              </div>
              {item.earnings ? (
                <div className="shrink-0 rounded-xl bg-emerald-50 px-3 py-2 text-center ring-1 ring-emerald-100">
                  <p className="text-[10px] text-emerald-800">سهم شما ({faNum(item.earnings.percent)}٪)</p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-900">{rial(item.earnings.amount)}</p>
                  <p className="mt-0.5 text-[10px] text-emerald-700">برآوردی</p>
                </div>
              ) : (
                <div className="shrink-0 rounded-xl bg-surface-3 px-3 py-2 text-center ring-1 ring-line">
                  <p className="text-[10px] text-navy-500">نوع همکاری</p>
                  <p className="mt-0.5 text-xs font-semibold text-navy-800">حقوق ثابت</p>
                </div>
              )}
            </div>

            <dl className="mt-4 space-y-1.5 text-xs text-navy-600">
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1"><Clock className="size-3.5" /> زمان ثبت</dt>
                <dd>{item.createdAt ? new Date(item.createdAt).toLocaleDateString('fa-IR') : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1"><Timer className="size-3.5" /> مهلت آزاد</dt>
                <dd className={clsx((item.remainingMinutes ?? 9_999) < 120 && 'font-semibold text-rose-700')}>
                  {remaining(item.forceAssignAt, item.remainingMinutes)}
                </dd>
              </div>
              {typeof item.serviceEstimatedMinutes === 'number' && item.serviceEstimatedMinutes > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1"><Timer className="size-3.5" /> زمان تقریبی خدمت</dt>
                  <dd>{item.serviceEstimatedMinutes >= 1440
                    ? `${faNum(Math.round(item.serviceEstimatedMinutes / 144) / 10)} روز`
                    : item.serviceEstimatedMinutes >= 60
                      ? `${faNum(Math.round(item.serviceEstimatedMinutes / 6) / 10)} ساعت`
                      : `${faNum(item.serviceEstimatedMinutes)} دقیقه`}</dd>
                </div>
              )}
              {(item.documentsTotal ?? 0) > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1"><FileText className="size-3.5" /> مدارک خدمت</dt>
                  <dd>{faNum(item.documentsRequired ?? 0)} الزامی از {faNum(item.documentsTotal ?? 0)} · بارگذاری‌شده: {faNum(item.documentsAttached ?? 0)}</dd>
                </div>
              )}
            </dl>

            <Button
              className="mt-4 w-full"
              loading={busy === item.id}
              onClick={() => accept(item)}
              icon={<CheckCircle2 className="size-4" />}
            >
              می‌پذیرم — این کار را انجام می‌دهم
            </Button>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-6 text-navy-500">
          اطلاعات هویتی مشتری تا لحظه پذیرش نمایش داده نمی‌شود. اگر دو همکار هم‌زمان بپذیرند، فقط یکی موفق می‌شود و
          به دیگری پیام روشن «توسط شخص دیگر پذیرفته شد» داده می‌شود.
        </p>
        <Link className="btn-soft" to="/staff/requests">پرونده‌های من</Link>
      </div>
    </AppShell>
  );
}
