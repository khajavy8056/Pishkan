import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BellRing, CheckCircle2, Cpu, Database, Download, Gauge, HardDrive,
  MemoryStick, RefreshCw, Search, ServerCog, ShieldAlert, Trash2, Wifi,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Button, Card, EmptyState, Field, Input, Loading, Modal, Pagination, Select, StatCard, StatusBadge,
  Tabs, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum, faTime, rial } from '../../lib/format';

interface SeriesPoint { key: string; value: number }
interface ComponentRow { key: string; label: string; status: string; value: string; detail?: string; updatedAt: string }
interface Health {
  status: string; generatedAt: string; version: string; environment: string; driver: string;
  uptimeSeconds: number; node: string; platform: string;
  components: ComponentRow[];
  database: { ok: boolean; latencyMs: number; migrations: number; lastMigrationAt: string | null };
  api: { requests: { count: number; avgMs: number; p95Ms: number }; totals: { total: number; serverErrors: number; clientErrors: number }; recentErrors: any[] };
  resources: { memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number } | null; disk: { usedPercent: number; freeGb: number } | null; cpuPercent: number | null };
  sessions: { active: number; online15m: number };
  requests: { open: number; pendingDocuments: number; unassigned: number };
  finance: Record<string, number>;
  logs: Record<string, number>;
  gateway: { code: string; configured: boolean; sandbox: boolean; label?: string };
  wallet: any;
  alerts: any;
}

interface LogRow {
  id: string; createdAt: string; level: string; category: string; action: string;
  actorName: string | null; actorRole: string | null; ip: string | null;
  requestId: string | null; correlationId: string | null; transactionId?: string | null;
  result: string; message: string | null; errorCode: string | null; durationMs: number | null;
  details: unknown; entityType: string | null; entityId: string | null;
}

const STATUS_TONE: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50/60 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50/70 text-amber-900',
  critical: 'border-rose-200 bg-rose-50/70 text-rose-900',
  unknown: 'border-line bg-surface-3 text-navy-700',
};
const STATUS_LABEL: Record<string, string> = { ok: 'سالم', warning: 'هشدار', critical: 'بحرانی', unknown: 'نامشخص' };
const LEVEL_TONE: Record<string, string> = {
  DEBUG: 'text-navy-500', INFO: 'text-emerald-700', WARNING: 'text-amber-700',
  ERROR: 'text-rose-700', CRITICAL: 'text-rose-800 font-bold', SECURITY: 'text-fuchsia-700 font-semibold',
};
const CATEGORY_LABEL: Record<string, string> = {
  auth: 'احراز هویت', admin: 'مدیریت', staff: 'کارکنان', request: 'درخواست', document: 'مدرک',
  payment: 'پرداخت', wallet: 'کیف پول', api: 'API', server: 'سرور', database: 'پایگاه داده',
  gateway: 'درگاه', file: 'فایل', settings: 'تنظیمات', security: 'امنیت', network: 'شبکه',
  background: 'پس‌زمینه', backup: 'پشتیبان‌گیری',
};

function LineChart({ points, unit = '', tone = 'brand' }: { points: SeriesPoint[]; unit?: string; tone?: 'brand' | 'emerald' | 'rose' }) {
  if (!points.length) return <p className="py-6 text-center text-xs text-navy-400">داده‌ای برای این بازه ثبت نشده است.</p>;
  const values = points.map((point) => Number(point.value) || 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const width = 320;
  const height = 90;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((point, index) => {
    const x = index * step;
    const y = height - ((Number(point.value) - min) / span) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = tone === 'emerald' ? '#047857' : tone === 'rose' ? '#be123c' : '#1d4ed8';
  const area = `0,${height} ${coords.join(' ')} ${width},${height}`;
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label="نمودار روند">
        <polygon points={area} fill={stroke} opacity="0.08" />
        <polyline points={coords.join(' ')} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-navy-400">
        <span>{points[0]?.key}</span>
        <span>حداکثر {faNum(Math.round(max))}{unit}</span>
        <span>{points[points.length - 1]?.key}</span>
      </div>
    </div>
  );
}

function SeriesCard({ title, points, unit, icon, tone }: { title: string; points: SeriesPoint[]; unit?: string; icon?: React.ReactNode; tone?: 'brand' | 'emerald' | 'rose' }) {
  const total = points.reduce((sum, point) => sum + Number(point.value || 0), 0);
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-navy-900">{icon}{title}</h3>
        <span className="text-[10px] text-navy-500">جمع: {faNum(Math.round(total * 100) / 100)}{unit}</span>
      </div>
      <LineChart points={points} unit={unit} tone={tone} />
    </Card>
  );
}

export function AdminMonitoring() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState<'overview' | 'charts' | 'logs' | 'alerts'>('overview');
  const [health, setHealth] = useState<Health | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [bucket, setBucket] = useState('day');
  const [rangeKey, setRangeKey] = useState('7');
  const [charts, setCharts] = useState<any>(null);
  const [chartGroup, setChartGroup] = useState<'infrastructure' | 'activity' | 'finance' | 'security'>('activity');
  const [chartLoading, setChartLoading] = useState(false);

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logLevel, setLogLevel] = useState('');
  const [logCategory, setLogCategory] = useState('');
  const [logResult, setLogResult] = useState('');
  const [search, setSearch] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogRow | null>(null);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneBusy, setPruneBusy] = useState(false);

  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertSummary, setAlertSummary] = useState<any>(null);
  const [alertBusy, setAlertBusy] = useState(false);

  const pageSize = 25;

  const loadHealth = () => {
    setLoading(true);
    Promise.all([api.get<{ data: Health }>('/api/monitoring/health'), api.get<{ data: any }>('/api/monitoring/meta')])
      .then(([res, info]) => { setHealth(res.data); setMeta(info.data); setError(''); })
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت وضعیت سامانه'))
      .finally(() => setLoading(false));
  };

  const loadCharts = () => {
    setChartLoading(true);
    const from = new Date(Date.now() - Number(rangeKey) * 86_400_000).toISOString();
    api.get<{ data: any }>('/api/monitoring/charts', { bucket, from, to: new Date().toISOString() })
      .then((res) => setCharts(res.data))
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در نمودارها', 'error'))
      .finally(() => setChartLoading(false));
  };

  const loadLogs = () => {
    setLogLoading(true);
    api.list<LogRow>('/api/monitoring/logs', {
      page: logPage, pageSize,
      level: logLevel || undefined,
      category: logCategory || undefined,
      result: logResult || undefined,
      search: search || undefined,
    }).then((res) => { setLogs(res.data); setLogTotal(res.total); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت لاگ‌ها', 'error'))
      .finally(() => setLogLoading(false));
  };

  const loadAlerts = () => {
    Promise.all([
      api.list<any>('/api/monitoring/alerts', { pageSize: 50 }),
      api.get<{ data: any }>('/api/monitoring/alerts/summary'),
    ]).then(([res, summary]) => { setAlerts(res.data); setAlertSummary(summary.data); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت هشدارها', 'error'));
  };

  useEffect(loadHealth, []);
  useEffect(() => { if (tab === 'charts') loadCharts(); }, [tab, bucket, rangeKey]);
  useEffect(() => {
    if (tab !== 'logs') return;
    const timer = setTimeout(loadLogs, 250);
    return () => clearTimeout(timer);
  }, [tab, logPage, logLevel, logCategory, logResult, search]);
  useEffect(() => { if (tab === 'alerts') loadAlerts(); }, [tab]);

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (logLevel) params.set('level', logLevel);
      if (logCategory) params.set('category', logCategory);
      if (logResult) params.set('result', logResult);
      if (search) params.set('search', search);
      const response = await fetch(`/api/monitoring/logs/export?${params.toString()}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pishkan-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify('خروجی CSV آماده شد و در گزارش حسابرسی ثبت شد.', 'success');
    } catch {
      notify('تهیه خروجی ناموفق بود.', 'error');
    }
  };

  const prune = async () => {
    setPruneBusy(true);
    try {
      const res = await api.delete<{ data: any }>('/api/monitoring/logs/prune', { confirmation: 'PRUNE' });
      notify(`${faNum(res.data.removed)} لاگ قدیمی‌تر از ${faNum(res.data.retentionDays)} روز حذف شد.`, 'success');
      setPruneOpen(false);
      loadLogs();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'پاک‌سازی ناموفق بود', 'error');
    } finally {
      setPruneBusy(false);
    }
  };

  const evaluate = async () => {
    setAlertBusy(true);
    try {
      const res = await api.post<{ data: any }>('/api/monitoring/alerts/evaluate');
      notify(`ارزیابی انجام شد: ${faNum(res.data.opened)} هشدار جدید، ${faNum(res.data.resolved)} رفع‌شده.`, 'success');
      loadAlerts();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ارزیابی ناموفق بود', 'error');
    } finally {
      setAlertBusy(false);
    }
  };

  const actOnAlert = async (id: string, action: 'acknowledge' | 'resolve') => {
    try {
      await api.post(`/api/monitoring/alerts/${id}/${action}`, {});
      notify(action === 'acknowledge' ? 'هشدار تأیید شد.' : 'هشدار رفع شد.', 'success');
      loadAlerts();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'عملیات ناموفق بود', 'error');
    }
  };

  const iconFor = (key: string) => {
    const map: Record<string, React.ReactNode> = {
      database: <Database className="size-4" />, api: <Activity className="size-4" />, gateway: <Wifi className="size-4" />,
      wallet: <Gauge className="size-4" />, storage: <HardDrive className="size-4" />, disk: <HardDrive className="size-4" />,
      memory: <MemoryStick className="size-4" />, cpu: <Cpu className="size-4" />, notifications: <BellRing className="size-4" />,
      queue: <ServerCog className="size-4" />, alerts: <AlertTriangle className="size-4" />,
    };
    return map[key] ?? <ServerCog className="size-4" />;
  };

  const groups = useMemo(() => [
    { key: 'infrastructure', label: 'زیرساخت', data: charts?.infrastructure ?? {} },
    { key: 'activity', label: 'فعالیت', data: charts?.activity ?? {} },
    { key: 'finance', label: 'مالی', data: charts?.finance ?? {} },
    { key: 'security', label: 'امنیت', data: charts?.security ?? {} },
  ], [charts]);

  if (error) return <AppShell variant="admin"><Card><p className="text-sm text-rose-700">{error}</p><Button className="mt-3" onClick={loadHealth}>تلاش دوباره</Button></Card></AppShell>;
  if (loading && !health) return <AppShell variant="admin"><Loading rows={6} /></AppShell>;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="مرکز پایش سامانه"
        description="سلامت سرویس‌ها، منابع سرور، درگاه پرداخت، کیف پول، صف کارها و لاگ‌های ساختاریافته — همه از داده واقعی و بدون سری‌سازی."
        actions={(
          <>
            <Button size="sm" variant="ghost" onClick={() => { loadHealth(); api.post('/api/monitoring/sample').catch(() => null); }}>
              <RefreshCw className="size-4" /> نمونه‌گیری و تازه‌سازی
            </Button>
          </>
        )}
      />

      <Tabs
        tabs={[
          { key: 'overview', label: 'نمای کلی' },
          { key: 'charts', label: 'نمودارهای تحلیلی' },
          { key: 'logs', label: 'لاگ‌ها' },
          { key: 'alerts', label: 'هشدارها', count: health?.alerts?.active ?? undefined },
        ]}
        active={tab}
        onChange={(key) => setTab(key as any)}
      />

      {tab === 'overview' && health && (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="وضعیت کل سامانه" value={STATUS_LABEL[health.status] ?? health.status} hint={`نسخه ${health.version} • ${health.driver} • ${health.environment}`} icon={<ShieldAlert className="size-5" />} tone={health.status === 'ok' ? 'emerald' : health.status === 'critical' ? 'rose' : 'amber'} />
            <StatCard label="درخواست‌های API" value={faNum(health.api.requests.count)} hint={`میانگین ${faNum(Math.round(health.api.requests.avgMs))}ms • p95 ${faNum(Math.round(health.api.requests.p95Ms))}ms`} icon={<Activity className="size-5" />} tone="brand" />
            <StatCard label="کاربران آنلاین (۱۵ دقیقه)" value={faNum(health.sessions.online15m)} hint={`${faNum(health.sessions.active)} نشست فعال`} icon={<Wifi className="size-5" />} tone="navy" />
            <StatCard label="خطاهای ۲۴ ساعت" value={faNum(health.logs?.errors24h ?? 0)} hint={`امنیت: ${faNum(health.logs?.security24h ?? 0)} • کل رویدادها: ${faNum(health.logs?.total24h ?? 0)}`} icon={<AlertTriangle className="size-5" />} tone={(health.logs?.errors24h ?? 0) > 0 ? 'amber' : 'emerald'} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {health.components.map((component) => (
              <div key={component.key} className={clsx('rounded-2xl border p-3', STATUS_TONE[component.status] ?? STATUS_TONE.unknown)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-bold">{iconFor(component.key)} {component.label}</span>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold">{STATUS_LABEL[component.status] ?? component.status}</span>
                </div>
                <p className="mt-2 text-sm font-bold">{component.value}</p>
                {component.detail && <p className="mt-0.5 text-[10px] leading-5 opacity-80">{component.detail}</p>}
                <p className="mt-1 text-[9px] opacity-60">به‌روزرسانی {faTime(component.updatedAt)}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <h3 className="mb-2 text-sm font-bold text-navy-900">مالی (۲۴ ساعت گذشته)</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">پرداخت‌های تأییدشده</p><p className="font-bold">{faNum(health.finance.paidCount24h)} • {rial(health.finance.paidAmount24h)}</p></div>
                <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">پرداخت ناموفق</p><p className="font-bold">{faNum(health.finance.failedCount24h)}</p></div>
                <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">شارژ کیف پول</p><p className="font-bold">{rial(health.finance.topUpAmount24h)}</p></div>
                <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">پرداخت از کیف پول</p><p className="font-bold">{rial(health.finance.walletSpend24h)}</p></div>
                <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">مانده امانی کیف پول‌ها</p><p className="font-bold">{rial(health.finance.walletCustody)}</p></div>
                <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">درگاه / کیف پول</p><p className="font-bold">{health.gateway.configured ? 'درگاه فعال' : 'درگاه پیکربندی‌نشده'} • {health.wallet?.ok === false ? 'اختلاف دفتر کل' : 'دفتر کل هم‌خوان'}</p></div>
              </div>
            </Card>
            <Card>
              <h3 className="mb-2 text-sm font-bold text-navy-900">آخرین خطاها و رویدادهای امنیتی</h3>
              {health.api.recentErrors.length === 0 ? <p className="text-xs text-navy-400">خطایی ثبت نشده است.</p> : (
                <ul className="space-y-1.5">
                  {health.api.recentErrors.map((row) => (
                    <li key={row.id} className="rounded-xl bg-surface-3 p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className={clsx('font-semibold', LEVEL_TONE[row.level] ?? 'text-navy-700')}>{row.level}</span>
                        <span className="text-[10px] text-navy-500">{faDateTime(row.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-navy-800">{row.message ?? row.action}</p>
                      <p className="text-[10px] text-navy-500">{row.category} • {row.action}{row.requestId ? ` • ${row.requestId}` : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <h3 className="mb-2 text-sm font-bold text-navy-900">زیرساخت و صف کار</h3>
            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">پایگاه داده</p><p className="font-bold">{health.database.ok ? 'متصل' : 'قطع'} • {faNum(health.database.latencyMs)}ms • {faNum(health.database.migrations)} مایگریشن</p></div>
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">حافظه</p><p className="font-bold">{health.resources.memory ? `${faNum(health.resources.memory.rssMb)}MB (${faNum(health.resources.memory.heapUsedMb)}/${faNum(health.resources.memory.heapTotalMb)})` : 'نامشخص'}</p></div>
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">دیسک</p><p className="font-bold">{health.resources.disk ? `${faNum(health.resources.disk.usedPercent)}٪ • ${faNum(health.resources.disk.freeGb)}GB آزاد` : 'نامشخص'}</p></div>
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">CPU / آپ‌تایم</p><p className="font-bold">{health.resources.cpuPercent === null ? 'نامشخص' : `${faNum(health.resources.cpuPercent)}٪`} • {faNum(Math.round(health.uptimeSeconds / 3600))} ساعت</p></div>
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">پرونده‌های باز</p><p className="font-bold">{faNum(health.requests.open)} • {faNum(health.requests.unassigned)} بدون مسئول</p></div>
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">مدارک در انتظار بررسی</p><p className="font-bold">{faNum(health.requests.pendingDocuments)}</p></div>
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">Node / پلتفرم</p><p className="font-bold" dir="ltr">{health.node} • {health.platform}</p></div>
              <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">آخرین مایگریشن</p><p className="font-bold">{health.database.lastMigrationAt ? faDateTime(health.database.lastMigrationAt) : 'ثبت نشده'}</p></div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'charts' && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} aria-label="بازه"
              options={[{ value: '1', label: '۲۴ ساعت گذشته' }, { value: '7', label: '۷ روز گذشته' }, { value: '30', label: '۳۰ روز گذشته' }, { value: '180', label: '۶ ماه گذشته' }]} className="w-44" />
            <Select value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="تجمیع"
              options={[{ value: 'hour', label: 'ساعتی' }, { value: 'day', label: 'روزانه' }, { value: 'week', label: 'هفتگی' }, { value: 'month', label: 'ماهانه' }]} className="w-36" />
            <Button size="sm" variant="ghost" onClick={loadCharts} loading={chartLoading}><RefreshCw className="size-4" /> به‌روزرسانی</Button>
            <span className="text-[10px] text-navy-400">
              بازه: {charts?.range ? `${faDateTime(charts.range.from)} تا ${faDateTime(charts.range.to)}` : '—'}
            </span>
          </div>
          <Tabs tabs={groups.map((group) => ({ key: group.key, label: group.label }))} active={chartGroup} onChange={(key) => setChartGroup(key as any)} />
          {chartLoading && <Loading />}
          {!chartLoading && charts && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(groups.find((group) => group.key === chartGroup)?.data ?? {}).map(([key, points]) => (
                <SeriesCardkey key={key} titleKey={key} points={points as SeriesPoint[]} />
              ))}
            </div>
          )}
          {!chartLoading && !charts && <EmptyState title="نموداری برای نمایش نیست" description="ابتدا نمونه‌گیری متریک‌ها را اجرا کنید." />}
        </div>
      )}

      {tab === 'logs' && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-3 px-3">
              <Search className="size-4 text-navy-400" />
              <input value={search} onChange={(e) => { setLogPage(1); setSearch(e.target.value); }}
                placeholder="جست‌وجو در پیام، عملیات، کاربر یا شناسه‌ها…" className="w-full bg-transparent py-2 text-sm outline-none" />
            </div>
            <Select value={logLevel} onChange={(e) => { setLogPage(1); setLogLevel(e.target.value); }} aria-label="سطح"
              options={[{ value: '', label: 'همه سطوح' }, ...(meta?.levels ?? []).map((level: string) => ({ value: level, label: level }))]} className="w-36" />
            <Select value={logCategory} onChange={(e) => { setLogPage(1); setLogCategory(e.target.value); }} aria-label="دسته"
              options={[{ value: '', label: 'همه دسته‌ها' }, ...(meta?.categories ?? []).map((category: string) => ({ value: category, label: CATEGORY_LABEL[category] ?? category }))]} className="w-40" />
            <Select value={logResult} onChange={(e) => { setLogPage(1); setLogResult(e.target.value); }} aria-label="نتیجه"
              options={[{ value: '', label: 'همه نتایج' }, { value: 'success', label: 'موفق' }, { value: 'failure', label: 'ناموفق' }, { value: 'denied', label: 'رد دسترسی' }]} className="w-36" />
            {can('logs.export') && <Button size="sm" variant="ghost" onClick={exportCsv}><Download className="size-4" /> CSV</Button>}
            {can('logs.delete') && <Button size="sm" variant="ghost" onClick={() => setPruneOpen(true)}><Trash2 className="size-4" /> پاک‌سازی</Button>}
          </div>

          {logLoading ? <Loading /> : (
            <Card pad={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>زمان</th><th>سطح</th><th>دسته</th><th>عملیات</th><th>کاربر</th><th>نتیجه</th><th>شناسه همبستگی</th><th /></tr></thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="whitespace-nowrap text-[11px] text-navy-500">{faDateTime(log.createdAt)}</td>
                        <td className={clsx('text-[10px] font-semibold', LEVEL_TONE[log.level])}>{log.level}</td>
                        <td className="text-[11px] text-navy-600">{CATEGORY_LABEL[log.category] ?? log.category}</td>
                        <td className="max-w-56 truncate text-[11px] text-navy-800" title={log.action}>{log.action}</td>
                        <td className="text-[11px] text-navy-500">{log.actorName ?? 'سامانه'}</td>
                        <td className="text-[10px]"><StatusBadge status={log.result === 'success' ? 'confirmed' : log.result === 'denied' ? 'rejected' : 'failed'} label={log.result === 'success' ? 'موفق' : log.result === 'denied' ? 'رد دسترسی' : 'ناموفق'} /></td>
                        <td className="text-[10px] text-navy-400" dir="ltr">{log.requestId ?? log.correlationId ?? '—'}</td>
                        <td className="text-left"><Button size="sm" variant="ghost" onClick={() => setSelectedLog(log)}>جزئیات</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {logs.length === 0 && <EmptyState title="لاگی با این فیلترها یافت نشد" />}
              <div className="p-3"><Pagination page={logPage} pageSize={pageSize} total={logTotal} onChange={setLogPage} /></div>
            </Card>
          )}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-xl bg-rose-50 px-3 py-1.5 text-rose-800">بحرانی فعال: {faNum(alertSummary?.criticalActive ?? 0)}</span>
              <span className="rounded-xl bg-amber-50 px-3 py-1.5 text-amber-800">هشدار فعال: {faNum(alertSummary?.warningActive ?? 0)}</span>
              <span className="rounded-xl bg-emerald-50 px-3 py-1.5 text-emerald-800">رفع‌شده: {faNum(alertSummary?.resolved ?? 0)}</span>
            </div>
            {can('alerts.edit') && <Button size="sm" onClick={evaluate} loading={alertBusy}><RefreshCw className="size-4" /> ارزیابی فوری شرایط</Button>}
          </div>
          {alerts.length === 0 ? <EmptyState title="هشدار فعالی نیست" description="شرایط هشدار به‌صورت خودکار توسط سامانه پایش می‌شود." /> : (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <Card key={alert.id} className={clsx('border', alert.severity === 'critical' ? 'border-rose-200' : alert.severity === 'warning' ? 'border-amber-200' : 'border-line')}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-navy-900">{alert.title}</p>
                      <p className="mt-1 text-xs text-navy-600">{alert.message}</p>
                      <p className="mt-1 text-[10px] text-navy-400">
                        {alert.category} • {faNum(alert.occurrences)} بار • آخرین مشاهده {faDateTime(alert.lastSeenAt)}
                        {alert.acknowledgedAt ? ` • تأییدشده توسط ${alert.acknowledgedBy ?? '—'}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={alert.status === 'active' ? 'failed' : alert.status === 'acknowledged' ? 'pending' : 'confirmed'}
                        label={alert.status === 'active' ? 'فعال' : alert.status === 'acknowledged' ? 'تأییدشده' : 'رفع‌شده'} />
                      {can('alerts.edit') && alert.status !== 'resolved' && (
                        <>
                          {alert.status === 'active' && (
                            <Button size="sm" variant="ghost" onClick={() => actOnAlert(alert.id, 'acknowledge')}><CheckCircle2 className="size-3.5" /> تأیید</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => actOnAlert(alert.id, 'resolve')}>رفع</Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={Boolean(selectedLog)} onClose={() => setSelectedLog(null)} title="جزئیات لاگ" size="lg">
        {selectedLog && (
          <div className="space-y-2 text-xs">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><span className="text-navy-500">زمان:</span> {faDateTime(selectedLog.createdAt)}</div>
              <div><span className="text-navy-500">سطح:</span> <span className={LEVEL_TONE[selectedLog.level]}>{selectedLog.level}</span></div>
              <div><span className="text-navy-500">دسته:</span> {CATEGORY_LABEL[selectedLog.category] ?? selectedLog.category}</div>
              <div><span className="text-navy-500">عملیات:</span> {selectedLog.action}</div>
              <div><span className="text-navy-500">کاربر:</span> {selectedLog.actorName ?? 'سامانه'} {selectedLog.actorRole ? `(${selectedLog.actorRole})` : ''}</div>
              <div><span className="text-navy-500">IP:</span> <span dir="ltr">{selectedLog.ip ?? '—'}</span></div>
              <div><span className="text-navy-500">شناسه درخواست:</span> <span dir="ltr">{selectedLog.requestId ?? '—'}</span></div>
              <div><span className="text-navy-500">شناسه همبستگی:</span> <span dir="ltr">{selectedLog.correlationId ?? '—'}</span></div>
              <div><span className="text-navy-500">موجودیت:</span> <span dir="ltr">{selectedLog.entityType ?? '—'} {selectedLog.entityId ?? ''}</span></div>
              <div><span className="text-navy-500">مدت:</span> {selectedLog.durationMs === null ? '—' : `${faNum(selectedLog.durationMs)}ms`}</div>
            </div>
            <p className="rounded-xl bg-surface-3 p-3 leading-6">{selectedLog.message ?? '—'}</p>
            <div>
              <p className="mb-1 text-navy-500">جزئیات ساختاریافته (کلیدهای حساس پوشانده شده‌اند)</p>
              <pre dir="ltr" className="max-h-64 overflow-auto rounded-xl bg-navy-900 p-3 text-[10px] leading-5 text-emerald-100">
                {JSON.stringify(selectedLog.details ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={pruneOpen} onClose={() => setPruneOpen(false)} title="پاک‌سازی لاگ‌های قدیمی"
        footer={<><Button variant="ghost" onClick={() => setPruneOpen(false)}>انصراف</Button><Button onClick={prune} loading={pruneBusy}>تأیید پاک‌سازی</Button></>}>
        <p className="text-sm leading-7 text-navy-700">
          فقط لاگ‌های قدیمی‌تر از دوره نگهداری ({faNum(meta?.retention?.logsDays ?? 0)} روز) حذف می‌شوند.
          این عملیات در گزارش حسابرسی با نام شما ثبت می‌شود.
        </p>
      </Modal>
    </AppShell>
  );
}

/** Small wrapper so each series card keeps a stable, readable title. */
function SeriesCardkey({ titleKey, points }: { titleKey: string; points: SeriesPoint[] }) {
  const labels: Record<string, string> = {
    cpuPercent: 'مصرف CPU', memoryMb: 'حافظه (MB)', diskPercent: 'دیسک', dbLatencyMs: 'تأخیر پایگاه داده',
    apiRequests: 'درخواست‌های API', apiErrors: 'خطاهای API', apiP95Ms: 'میانه۹۵ تأخیر API',
    requestsCreated: 'درخواست‌های ایجادشده', requestsCompleted: 'تکمیل‌شده', requestsFailed: 'ناموفق/لغوشده', requestsUnassigned: 'بدون مسئول',
    paymentsConfirmed: 'پرداخت تأییدشده', paymentsFailed: 'پرداخت ناموفق', walletTopUp: 'شارژ کیف پول',
    walletSpend: 'پرداخت از کیف پول', adminCredit: 'شارژ مدیریت', refunds: 'بازپرداخت',
    loginsSuccess: 'ورود موفق', loginsFailed: 'ورود ناموفق', unauthorized: 'رد دسترسی', settingsChanges: 'تغییر تنظیمات',
  };
  const money = ['paymentsConfirmed', 'walletTopUp', 'walletSpend', 'adminCredit', 'refunds'];
  return <SeriesCard title={labels[titleKey] ?? titleKey} points={points} unit={money.includes(titleKey) ? ' ریال' : ''} tone={titleKey.includes('Failed') || titleKey.includes('Error') ? 'rose' : titleKey.includes('Completed') || titleKey.includes('Success') ? 'emerald' : 'brand'} />;
}
