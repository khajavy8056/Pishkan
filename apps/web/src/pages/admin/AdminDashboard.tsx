import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Wallet, Users, AlertTriangle, TrendingUp, TrendingDown, ArrowLeft, BadgeCheck,
  FileWarning, MessageSquare, Clock, RefreshCw,
} from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import { BarChart, Card, EmptyState, ErrorState, Loading, StatCard, StatusBadge } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDate, faNum, relative, rial } from '../../lib/format';

export function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get<{ data: any }>('/api/dashboard/summary')
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت اطلاعات'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <AppShell variant="admin"><Loading rows={5} /></AppShell>;
  if (error) return <AppShell variant="admin"><ErrorState message={error} onRetry={load} /></AppShell>;

  const finance = data.finance ?? {};

  return (
    <AppShell variant="admin">
      <PageHeader
        title="داشبورد مدیریت"
        description="نمای کلی پرونده‌ها، عملکرد کارکنان و وضعیت مالی دفتر."
        actions={<Link to="/admin/reports" className="btn-primary btn-sm">گزارش‌های کامل <ArrowLeft className="size-4" /></Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="پرونده‌های در جریان" value={faNum(data.stats.open)} hint={`مجموع ${faNum(data.stats.total)} پرونده`} icon={<ClipboardList className="size-5" />} />
        <StatCard label="درآمد دریافتی (کل)" value={rial(finance.revenue ?? 0)} tone="emerald" icon={<TrendingUp className="size-5" />} hint={`${faNum(finance.paymentsCount ?? 0)} پرداخت تأییدشده`} />
        <StatCard label="مطالبات باز" value={rial(finance.receivable ?? 0)} tone="amber" icon={<Wallet className="size-5" />} />
        <StatCard label="سود عملیاتی" value={rial(finance.operatingProfit ?? 0)} tone={(finance.operatingProfit ?? 0) >= 0 ? 'emerald' : 'rose'} icon={<TrendingDown className="size-5" />} hint={`حاشیه ${faNum(finance.margin ?? 0)}٪`} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/admin/requests?unassigned=true" className="card flex items-center gap-3 p-4 transition hover:shadow-lg">
          <span className="grid size-10 place-items-center rounded-xl bg-rose-50 text-rose-600"><AlertTriangle className="size-5" /></span>
          <span><span className="block text-lg font-bold text-navy-900">{faNum(data.cards.unassigned)}</span><span className="text-[11px] text-navy-500">بدون کارشناس</span></span>
        </Link>
        <Link to="/staff/documents" className="card flex items-center gap-3 p-4 transition hover:shadow-lg">
          <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><FileWarning className="size-5" /></span>
          <span><span className="block text-lg font-bold text-navy-900">{faNum(data.cards.pendingDocuments)}</span><span className="text-[11px] text-navy-500">مدرک در انتظار</span></span>
        </Link>
        <Link to="/admin/messages" className="card flex items-center gap-3 p-4 transition hover:shadow-lg">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><MessageSquare className="size-5" /></span>
          <span><span className="block text-lg font-bold text-navy-900">{faNum(data.cards.unreadMessages)}</span><span className="text-[11px] text-navy-500">پیام خوانده‌نشده</span></span>
        </Link>
        <div className="card flex items-center gap-3 p-4">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><BadgeCheck className="size-5" /></span>
          <span><span className="block text-lg font-bold text-navy-900">{faNum(data.cards.checkedInToday)}</span><span className="text-[11px] text-navy-500">حاضر امروز</span></span>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-navy-900">روند ثبت درخواست (۱۴ روز)</h2>
            <button onClick={load} className="text-[11px] text-navy-500 hover:text-navy-800"><RefreshCw className="inline size-3" /> به‌روزرسانی</button>
          </div>
          <BarChart data={data.charts.daily.map((d: any) => ({ label: faDate(d.day), value: d.count }))} />
        </Card>

        <Card>
          <h2 className="mb-3 font-bold text-navy-900">توزیع وضعیت</h2>
          <div className="space-y-2">
            {data.charts.byStatus.map((row: any) => (
              <div key={row.status} className="flex items-center justify-between gap-2">
                <StatusBadge status={row.status} label={row.label} />
                <span className="text-sm font-semibold text-navy-900">{faNum(row.count)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-bold text-navy-900">آخرین پرونده‌ها</h2>
          {data.recentRequests.length === 0 && <EmptyState title="پرونده‌ای ثبت نشده است" />}
          <div className="space-y-2">
            {data.recentRequests.map((request: any) => (
              <Link key={request.id} to={`/admin/requests/${request.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-50/60 px-3 py-2.5 hover:bg-brand-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-navy-900">{request.serviceTitle}</span>
                  <span className="block text-[11px] text-navy-500">{request.customerName} • {request.trackingCode} • {relative(request.createdAt)}</span>
                </span>
                <StatusBadge status={request.status} label={request.statusLabel} />
              </Link>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Clock className="size-4 text-rose-600" /> پرونده‌های عقب‌افتاده</h2>
            {data.urgent.length === 0 ? <p className="text-sm text-navy-400">موردی نیست.</p> : (
              <div className="space-y-2">
                {data.urgent.map((request: any) => (
                  <Link key={request.id} to={`/admin/requests/${request.id}`} className="block rounded-xl bg-rose-50/70 px-3 py-2 hover:bg-rose-100/70">
                    <p className="truncate text-xs font-medium text-rose-900">{request.serviceTitle}</p>
                    <p className="text-[10px] text-rose-700">{request.customerName} • مهلت {faDate(request.dueAt)}</p>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Users className="size-4 text-brand-700" /> بار کاری کارکنان</h2>
            <div className="space-y-2">
              {data.staffLoad.map((staff: any) => {
                const max = Math.max(...data.staffLoad.map((s: any) => s.active), 1);
                return (
                  <div key={staff.id}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-navy-700">{staff.fullName}</span>
                      <span className="text-navy-500">{faNum(staff.active)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-navy-100">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (staff.active / max) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
              {data.staffLoad.length === 0 && <p className="text-sm text-navy-400">کارمندی ثبت نشده است.</p>}
            </div>
            <Link to="/admin/staff" className="btn-ghost btn-sm mt-3 w-full">مدیریت کارکنان</Link>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
