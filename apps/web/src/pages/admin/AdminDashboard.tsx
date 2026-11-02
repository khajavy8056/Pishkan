import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, Check, ClipboardList, Clock, Database, Eye, FileWarning, Headphones,
  MessageSquare, Server, Settings, Shapes, Users, Wallet, X,
} from 'lucide-react';
import { AppShell } from '../../components/shell';
import { Badge, Button, EmptyState, ErrorState, Loading, Modal, StatusBadge, Tabs, Textarea, useToast } from '../../components/ui';
import { Donut, GlossyStat, HeroShell, LineChart, MoreLink, PanelCard, QuickTile } from '../../components/panel';
import { CategoryArt } from '../../components/visual';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { faDate, faDateShort, faNum, relative, rial } from '../../lib/format';

/** Management approval (handoff) decision with a mandatory note. */
function DecisionModal({ item, decision, onClose, onDone }: {
  item: any; decision: 'approved' | 'returned'; onClose: () => void; onDone: () => void;
}) {
  const { notify } = useToast();
  const [note, setNote] = useState(decision === 'approved' ? 'بررسی و تأیید شد.' : '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (note.trim().length < 3) { notify('یادداشت تصمیم (دست‌کم چند نویسه) لازم است.', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/api/automation/${item.handoffId}/decision`, { decision, note: note.trim() });
      notify(decision === 'approved' ? 'درخواست تأیید شد.' : 'درخواست با یادداشت شما برگشت داده شد.', 'success');
      onDone();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت تصمیم ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={decision === 'approved' ? 'تأیید درخواست' : 'برگشت درخواست'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button className={decision === 'approved' ? 'btn-gradient' : ''} variant={decision === 'approved' ? 'primary' : 'danger'}
            loading={busy} onClick={() => void submit()}>
            {decision === 'approved' ? 'ثبت تأیید' : 'ثبت برگشت'}
          </Button>
        </>
      )}>
      <p className="text-sm leading-7 text-navy-700">
        «{item.serviceTitle}» برای مشتری {item.customerName} (کد پیگیری {faNum(item.trackingCode)}) در کارتابل مدیریت منتظر تصمیم شماست.
      </p>
      <label className="mt-4 block text-sm font-bold text-navy-800" htmlFor="decision-note">یادداشت تصمیم</label>
      <Textarea id="decision-note" className="mt-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={decision === 'returned' ? 'دلیل برگشت را برای کارشناس بنویسید…' : 'یادداشت تأیید…'} />
    </Modal>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const brand = useBrand();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<'week' | 'month'>('month');
  const [decision, setDecision] = useState<{ item: any; kind: 'approved' | 'returned' } | null>(null);

  const load = () => {
    setLoading(true);
    api.get<{ data: any }>('/api/dashboard/summary')
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت اطلاعات'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const chartPoints = useMemo(() => {
    const daily: any[] = data?.charts?.daily ?? [];
    const sliced = range === 'week' ? daily.slice(-7) : daily;
    return sliced.map((d) => ({ label: faDateShort(d.day), value: d.count }));
  }, [data, range]);

  if (loading) return <AppShell variant="admin"><Loading rows={5} /></AppShell>;
  if (error) return <AppShell variant="admin"><ErrorState message={error} onRetry={load} /></AppShell>;

  const finance = data.finance ?? {};
  const totals = data.totals ?? { users: 0, openTickets: 0 };
  const deltas = data.deltas ?? {};
  const staffStatus = data.staffStatus ?? { total: 0, active: 0, checkedInToday: 0, onLeaveToday: 0 };
  const activeNotChecked = Math.max(0, staffStatus.active - staffStatus.onLeaveToday - staffStatus.checkedInToday);
  const alerts = data.workforceAlerts;

  return (
    <AppShell variant="admin">
      <HeroShell image={brand.panelHero}>
        <span className="chip-soft mb-3 bg-white/70 text-brand-800"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> پنل مدیریت ارشد سیستم</span>
        <h1 className="text-2xl font-black tracking-tight text-navy-900 sm:text-[1.8rem]">خوش آمدید، {user?.fullName}</h1>
        <p className="mt-2 max-w-xl text-sm leading-7 text-navy-600">خلاصهٔ وضعیت فعلی سیستم و عملکرد کلی {brand.name} را مشاهده می‌کنید.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/admin/reports" className="btn-gradient btn-md">مشاهده گزارش‌ها <ArrowLeft className="size-4" /></Link>
          <Link to="/admin/automation" className="btn-soft btn-md bg-white/80"><ClipboardList className="size-4" /> کارتابل تأیید</Link>
        </div>
      </HeroShell>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlossyStat color="#16a34a" icon={<Wallet className="size-7" />} label="درآمد کل سیستم"
          value={rial(finance.revenue ?? 0)} delta={deltas.revenue} to="/admin/finance"
          sub="رشد دریافتی تأییدشده در ۳۰ روز اخیر" />
        <GlossyStat color="#2563eb" icon={<Users className="size-7" />} label="کل کاربران سیستم"
          value={faNum(totals.users)} delta={deltas.users} to="/admin/customers"
          sub="رشد ثبت‌نام در ۳۰ روز اخیر" />
        <GlossyStat color="#7c3aed" icon={<ClipboardList className="size-7" />} label="درخواست‌های فعال"
          value={faNum(data.stats.open)} delta={deltas.requests} to="/admin/requests"
          sub={`از مجموع ${faNum(data.stats.total)} پرونده · روند ثبت ماه اخیر`} />
        <GlossyStat color="#db2777" icon={<Headphones className="size-7" />} label="تیکت‌های پشتیبانی باز"
          value={faNum(totals.openTickets)} delta={deltas.tickets} deltaInvert to="/admin/support"
          sub="روند ثبت تیکت در ۳۰ روز اخیر" />
      </div>

      {alerts && (
        <PanelCard className="mt-6" title={<span className="flex items-center gap-2"><Users className="size-4 text-accent" /> وضعیت زندهٔ نیروی کار</span>}
          action={<span className="text-[11px] text-navy-400">برای اقدام، روی هر مورد بزنید.</span>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link to="/admin/requests?unassigned=true" className="rounded-2xl bg-rose-50 px-4 py-3 ring-1 ring-rose-100 transition hover:shadow">
              <p className="text-lg font-black text-rose-800">{faNum(alerts.overdueUnassigned)}</p>
              <p className="text-[11px] leading-5 text-rose-700">پروندهٔ بدون کارشناس که از موعد واگذاری گذشته</p>
            </Link>
            <Link to="/admin/requests?unassigned=true" className="rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-100 transition hover:shadow">
              <p className="text-lg font-black text-amber-800">{faNum(alerts.unassigned)}</p>
              <p className="text-[11px] leading-5 text-amber-700">کل پرونده‌های هنوز بدون کارشناس</p>
            </Link>
            <Link to="/admin/requests?bucket=waiting_customer&group=open" className="rounded-2xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100 transition hover:shadow">
              <p className="text-lg font-black text-sky-800">{faNum(alerts.waitingCases)}</p>
              <p className="text-[11px] leading-5 text-sky-700">پروندهٔ منتظر مشتری/سازمان یا نیازمند پیگیری</p>
            </Link>
            <Link to="/staff/documents" className="rounded-2xl bg-orange-50 px-4 py-3 ring-1 ring-orange-100 transition hover:shadow">
              <p className="flex items-center gap-1.5 text-lg font-black text-orange-800"><FileWarning className="size-4" /> {faNum(data.cards.pendingDocuments)}</p>
              <p className="text-[11px] leading-5 text-orange-700">مدرک در انتظار بررسی</p>
            </Link>
            <Link to="/admin/messages" className="rounded-2xl bg-brand-50 px-4 py-3 ring-1 ring-brand-100 transition hover:shadow">
              <p className="flex items-center gap-1.5 text-lg font-black text-brand-800"><MessageSquare className="size-4" /> {faNum(data.cards.unreadMessages)}</p>
              <p className="text-[11px] leading-5 text-brand-700">پیام خوانده‌نشدهٔ مشتریان</p>
            </Link>
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-100">
              <p className="text-lg font-black text-emerald-800">{faNum(alerts.onlineStaff)}</p>
              <p className="text-[11px] leading-5 text-emerald-700">کارمند آنلاین در ۱۰ دقیقهٔ اخیر</p>
            </div>
          </div>
        </PanelCard>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PanelCard title="دسترسی‌های سریع">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QuickTile color="#f59e0b" icon={<Shapes className="size-7" />} label="مدیریت خدمات" to="/admin/services" />
              <QuickTile color="#2563eb" icon={<BarChart3 className="size-7" />} label="گزارش‌گیری" to="/admin/reports" />
              <QuickTile color="#7c3aed" icon={<Users className="size-7" />} label="مدیریت کاربران" to="/admin/customers" />
              <QuickTile color="#475569" icon={<Settings className="size-7" />} label="تنظیمات سیستم" to="/admin/settings" />
            </div>
          </PanelCard>

          <PanelCard title={(
            <span className="flex items-center gap-2">
              درخواست‌های نیازمند بررسی و تأیید
              {data.pendingApprovalsCount > 0 && <Badge tone="warning">{faNum(data.pendingApprovalsCount)} مورد</Badge>}
            </span>
          )} action={<MoreLink to="/admin/automation">کارتابل تأیید</MoreLink>}>
            {(data.pendingApprovals ?? []).length === 0 ? (
              <p className="text-sm text-navy-400">در حال حاضر موردی در کارتابل مدیریت منتظر تصمیم نیست.</p>
            ) : (
              <div className="space-y-2">
                {data.pendingApprovals.map((item: any) => (
                  <div key={item.handoffId} className="lift flex flex-wrap items-center gap-3 rounded-2xl bg-surface-3/70 px-3.5 py-3 ring-1 ring-navy-900/5">
                    <CategoryArt name={item.categoryIcon} color={item.categoryColor} className="size-11" glyphClassName="size-6" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-navy-900">{item.serviceTitle}</span>
                      <span className="mt-0.5 block text-[11px] text-navy-500">
                        متقاضی: {item.customerName} • کد {faNum(item.trackingCode)} • {faDate(item.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status={item.status} label={item.statusLabel} />
                    <span className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setDecision({ item, kind: 'approved' })}
                        className="btn btn-sm bg-gradient-to-b from-emerald-500 to-emerald-600 font-bold text-white shadow-[0_8px_16px_-8px_rgb(16_185_129/.8)] transition hover:from-emerald-600 hover:to-emerald-700">
                        <Check className="size-4" /> تأیید
                      </button>
                      <button type="button" onClick={() => setDecision({ item, kind: 'returned' })}
                        className="btn btn-sm border border-rose-200 bg-rose-50 font-bold text-rose-700 transition hover:bg-rose-100">
                        <X className="size-4" /> رد
                      </button>
                      <Link to={`/admin/requests/${item.id}`} className="btn-ghost btn-sm" aria-label="مشاهده پرونده"><Eye className="size-4" /></Link>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </PanelCard>

          <PanelCard title="عملکرد سیستم" action={(
            <Tabs active={range} onChange={(k) => setRange(k as typeof range)} tabs={[
              { key: 'week', label: 'هفتگی' },
              { key: 'month', label: 'ماهانه' },
            ]} />
          )}>
            <LineChart points={chartPoints} format={(v) => faNum(v)} />
            <p className="mb-2 mt-4 text-[11px] font-bold text-navy-500">توزیع وضعیت پرونده‌ها</p>
            <div className="flex flex-wrap gap-2">
              {data.charts.byStatus.map((row: any) => (
                <span key={row.status} className="flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 ring-1 ring-line">
                  <StatusBadge status={row.status} label={row.label} />
                  <span className="text-xs font-black text-navy-800">{faNum(row.count)}</span>
                </span>
              ))}
            </div>
          </PanelCard>
        </div>

        <div className="space-y-6">
          <PanelCard title="آخرین فعالیت‌ها" action={<MoreLink to="/admin/audit">مشاهده گزارش فعالیت‌ها</MoreLink>}>
            {(data.activity ?? []).length === 0 ? (
              <p className="text-sm text-navy-400">فعالیتی ثبت نشده است.</p>
            ) : (
              <ul className="space-y-3">
                {data.activity.map((a: any) => (
                  <li key={a.id} className="flex items-start gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">
                      {(a.actorName ?? 'س').trim().charAt(0)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-navy-700">
                        <b className="text-navy-900">{a.actorName ?? 'سیستم'}</b> {a.actionLabel}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-navy-400">{relative(a.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <PanelCard title="وضعیت کارکنان">
            <div className="flex flex-col items-center gap-4">
              <Donut size={158} thickness={16} segments={[
                { value: staffStatus.checkedInToday, color: '#16a34a', label: 'حاضر امروز' },
                { value: activeNotChecked, color: '#2563eb', label: 'فعال (حاضر نشده)' },
                { value: staffStatus.onLeaveToday, color: '#7c3aed', label: 'در مرخصی امروز' },
                { value: Math.max(0, staffStatus.total - staffStatus.active), color: '#94a3b8', label: 'غیرفعال' },
              ]} center={(
                <div>
                  <p className="text-2xl font-black text-navy-900">{faNum(staffStatus.total)}</p>
                  <p className="text-[11px] text-navy-500">کل کارکنان</p>
                </div>
              )} />
              <dl className="w-full space-y-2 text-[13px]">
                {[
                  ['حاضر امروز', staffStatus.checkedInToday, '#16a34a'],
                  ['فعال (حاضر نشده)', activeNotChecked, '#2563eb'],
                  ['در مرخصی امروز', staffStatus.onLeaveToday, '#7c3aed'],
                  ['غیرفعال', Math.max(0, staffStatus.total - staffStatus.active), '#94a3b8'],
                ].map(([label, value, color]) => (
                  <div key={label as string} className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1.5 text-navy-600">
                      <span className="size-2.5 rounded-sm" style={{ background: color as string }} aria-hidden="true" /> {label}
                    </dt>
                    <dd className="font-bold text-navy-900">{faNum(value as number)} نفر</dd>
                  </div>
                ))}
              </dl>
            </div>
            <Link to="/admin/staff" className="btn-soft mt-4 w-full">مدیریت کارکنان</Link>
          </PanelCard>

          <PanelCard title="وضعیت سیستم">
            <dl className="space-y-3 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-navy-600"><Server className="size-4 text-accent" /> وضعیت API سرور</dt>
                <dd className="flex items-center gap-1.5 font-bold text-emerald-700"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" /> فعال</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-navy-600"><Database className="size-4 text-accent" /> اتصال پایگاه داده</dt>
                <dd className={`flex items-center gap-1.5 font-bold ${data.system?.dbOk ? 'text-emerald-700' : 'text-rose-700'}`}>
                  <span className={`size-2 rounded-full ${data.system?.dbOk ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden="true" />
                  {data.system?.dbOk ? 'فعال' : 'خطا'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-navy-600"><Clock className="size-4 text-accent" /> آخرین نسخهٔ پشتیبان</dt>
                <dd className="font-bold text-navy-900">{data.system?.lastBackupAt ? relative(data.system.lastBackupAt) : 'ثبت نشده'}</dd>
              </div>
            </dl>
            <Link to="/admin/system" className="btn-soft mt-4 w-full">مدیریت زیرساخت و پشتیبان‌گیری</Link>
          </PanelCard>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <PanelCard className="lg:col-span-2" title="آخرین پرونده‌ها" action={<MoreLink to="/admin/requests" />}>
          {data.recentRequests.length === 0 && <EmptyState title="پرونده‌ای ثبت نشده است" />}
          <div className="space-y-2">
            {data.recentRequests.map((request: any) => (
              <Link key={request.id} to={`/admin/requests/${request.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-3/70 px-3.5 py-3 ring-1 ring-navy-900/5 transition hover:bg-brand-50/70">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-navy-900">{request.serviceTitle}</span>
                  <span className="block text-[11px] text-navy-500">{request.customerName} • {request.trackingCode} • {relative(request.createdAt)}</span>
                </span>
                <StatusBadge status={request.status} label={request.statusLabel} />
              </Link>
            ))}
          </div>
        </PanelCard>

        <div className="space-y-6">
          <PanelCard title={<span className="flex items-center gap-2"><Clock className="size-4 text-rose-700" /> پرونده‌های عقب‌افتاده</span>}>
            {data.urgent.length === 0 ? <p className="text-sm text-navy-400">موردی نیست.</p> : (
              <div className="space-y-2">
                {data.urgent.map((request: any) => (
                  <Link key={request.id} to={`/admin/requests/${request.id}`} className="block rounded-2xl bg-rose-50/70 px-3 py-2.5 ring-1 ring-rose-100 transition hover:bg-rose-100/70">
                    <p className="truncate text-xs font-bold text-rose-900">{request.serviceTitle}</p>
                    <p className="text-[10px] text-rose-700">{request.customerName} • مهلت {faDate(request.dueAt)}</p>
                  </Link>
                ))}
              </div>
            )}
          </PanelCard>

          <PanelCard title={<span className="flex items-center gap-2"><Users className="size-4 text-accent" /> بار کاری کارکنان</span>}>
            <div className="space-y-2.5">
              {data.staffLoad.map((staff: any) => {
                const max = Math.max(...data.staffLoad.map((s: any) => s.active), 1);
                return (
                  <div key={staff.id}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-navy-700">{staff.fullName}</span>
                      <span className="text-navy-500">{faNum(staff.active)} پرونده</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-navy-100">
                      <div className="h-full rounded-full bg-gradient-to-l from-brand-700 to-brand-400" style={{ width: `${Math.min(100, (staff.active / max) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
              {data.staffLoad.length === 0 && <p className="text-sm text-navy-400">کارمندی ثبت نشده است.</p>}
            </div>
            <Link to="/admin/staff" className="btn-ghost btn-sm mt-3 w-full">مدیریت کارکنان</Link>
          </PanelCard>
        </div>
      </div>

      {decision && (
        <DecisionModal item={decision.item} decision={decision.kind}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); load(); }} />
      )}
    </AppShell>
  );
}
