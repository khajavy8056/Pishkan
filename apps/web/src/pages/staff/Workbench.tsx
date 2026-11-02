import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, BadgePercent, Bell, CalendarClock, CheckCircle2, Coins, Eye, FileText, FolderOpen,
  Headphones, LogIn, LogOut, Medal, PiggyBank, RefreshCw, ShoppingCart, Coffee, Trophy, Wallet,
} from 'lucide-react';
import { AppShell } from '../../components/shell';
import { Badge, Button, Card, EmptyState, Loading, StatusBadge, Switch, Tabs, useToast } from '../../components/ui';
import {
  Donut, GlossyStat, HeroShell, LineChart, MoreLink, PanelCard, QuickTile, Ring, SoftBars, Sparkline,
} from '../../components/panel';
import { CategoryArt } from '../../components/visual';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { daysAgo, faDate, faDateShort, faNum, faTime, relative, rial } from '../../lib/format';

/* ------------------------------------------------------------------ types */

interface Payroll {
  cooperationType: 'commission' | 'monthly' | 'none';
  cooperationLabel: string;
  performance: {
    total: number; completed: number; completedToday: number; completedWeek: number; completedMonth: number;
    inProgress: number; awaitingOrganization: number; awaitingCustomer: number; needsAction: number;
    cancelled: number; averageCompletionMinutes: number;
  };
  profile: { employeeCode: string | null; position: string | null; hiredAt: string | null } | null;
  contract: { commissionPercent: number; monthlyTarget: number | null; startsOn: string; endsOn: string | null } | null;
  goal: { target: number; achieved: number; percent: number } | null;
  rank: { position: number | null; total: number } | null;
  income: {
    today: number; week: number; month: number; definite: number; pendingEstimate: number;
    withdrawable: number; requested: number; withdrawn: number; paidOut: number;
  } | null;
  balance: { available: number; future: number; reserved: number; canRequest: boolean } | null;
  withdrawals: {
    id: string; amount: number; status: string; statusLabel: string; requestedAt: string; paidAt: string | null;
  }[];
  salary: {
    contract: { monthlyAmount: number; startsOn: string; endsOn: string | null } | null;
    months: { period: string; accrued: number; paid: number; remaining: number; status: string; statusLabel: string }[];
    outstanding: number;
    payments: { id: string; amount: number; paidAt: string }[];
  } | null;
}

interface Ctx {
  user: any;
  brandName: string;
  payroll: Payroll | null;
  workload: any;
  summary: any;
  busy: boolean;
  checkIn: () => void;
  checkOut: () => void;
  toggleAvailability: () => void;
  reload: () => void;
}

/* ---------------------------------------------------------------- helpers */

const firstName = (name?: string | null) => (name ?? '').trim().split(' ')[0] || 'همکار';

function hmToMinutes(hm?: string | null): number | null {
  if (!hm) return null;
  const [h, m] = hm.split(':').map((x) => Number(x));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  if (h <= 0) return `${faNum(m)} دقیقه`;
  return m ? `${faNum(h)} ساعت و ${faNum(m)} دقیقه` : `${faNum(h)} ساعت`;
}

const openChat = () => window.dispatchEvent(new CustomEvent('pishkan:open-chat', { detail: {} }));

/* ------------------------------------------------------------- shared bits */

function AvailabilityStrip({ ctx }: { ctx: Ctx }) {
  const open = ctx.workload?.acceptsNewCases !== false;
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-navy-900">وضعیت پذیرش پروندهٔ جدید</p>
          <p className="mt-1 text-xs leading-6 text-navy-500">
            {open
              ? 'پذیرش شما باز است؛ پرونده‌های متناسب با تخصص و ظرفیتتان در صف آزاد دیده می‌شوند.'
              : 'پذیرش شما بسته است؛ پروندهٔ تازه‌ای از صف آزاد یا واگذاری خودکار به شما نمی‌رسد.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={ctx.reload}><RefreshCw className="size-4" /> به‌روزرسانی</Button>
          <Switch checked={open} label={open ? 'باز' : 'بسته'} onChange={ctx.toggleAvailability} />
        </div>
      </div>
    </Card>
  );
}

function NoticesCard({ summary }: { summary: any }) {
  const items: any[] = summary?.notifications ?? [];
  return (
    <PanelCard title={<span className="flex items-center gap-2"><Bell className="size-4 text-accent" /> اطلاعیه‌ها</span>}
      action={items.length > 0 ? <MoreLink to="/staff/messages" /> : undefined}>
      {items.length === 0 ? (
        <p className="text-sm text-navy-400">اطلاعیه تازه‌ای ندارید.</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 5).map((n) => {
            const body = (
              <>
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-navy-200' : 'bg-brand-600'}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold text-navy-900">{n.title}</span>
                  {n.body && <span className="mt-0.5 block truncate text-[11px] text-navy-500">{n.body}</span>}
                  <span className="mt-0.5 block text-[10px] text-navy-400">{relative(n.createdAt)}</span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {n.link && !String(n.link).startsWith('chat:')
                  ? <Link to={n.link} className="flex gap-2.5 rounded-xl bg-surface-3 px-3 py-2.5 transition hover:bg-brand-50">{body}</Link>
                  : <div className="flex gap-2.5 rounded-xl bg-surface-3 px-3 py-2.5">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

function PendingDocsCard({ workload }: { workload: any }) {
  const docs: any[] = workload?.pendingDocuments ?? [];
  if (!docs.length) return null;
  return (
    <PanelCard title={<span className="flex items-center gap-2"><FileText className="size-4 text-accent" /> مدارک در انتظار بررسی</span>}>
      <div className="space-y-2">
        {docs.slice(0, 5).map((doc) => (
          <Link key={`${doc.recordType}:${doc.id}`}
            to={doc.recordType === 'profile' ? '/staff/documents' : `/staff/requests/${doc.requestId}`}
            className="block rounded-xl bg-amber-50/70 px-3 py-2.5 transition hover:bg-amber-100/70">
            <p className="truncate text-xs font-medium text-navy-900">{doc.title}</p>
            <p className="mt-0.5 text-[10px] text-navy-500">{doc.recordType === 'profile' ? 'مدرک پروفایل' : doc.trackingCode} • {relative(doc.createdAt)}</p>
          </Link>
        ))}
      </div>
    </PanelCard>
  );
}

function AttendanceCard({ ctx }: { ctx: Ctx }) {
  const wl = ctx.workload;
  const att = wl?.attendance;
  const shift = wl?.shift;
  const checkInMs = att?.checkIn ? Date.parse(att.checkIn) : null;
  const checkOutMs = att?.checkOut ? Date.parse(att.checkOut) : null;
  const worked = checkInMs ? Math.max(0, Math.round(((checkOutMs ?? Date.now()) - checkInMs) / 60_000)) : 0;
  const startMin = hmToMinutes(shift?.startTime), endMin = hmToMinutes(shift?.endTime);
  const planned = startMin !== null && endMin !== null && endMin > startMin ? endMin - startMin : null;
  const percent = planned ? Math.min(100, Math.round((worked / planned) * 100)) : (checkOutMs ? 100 : checkInMs ? 50 : 0);
  return (
    <PanelCard title="وضعیت حضور و غیاب" action={<MoreLink to="/staff/shifts">مشاهده جزئیات شیفت</MoreLink>}>
      <div className="flex items-center justify-between gap-4">
        <dl className="min-w-0 flex-1 space-y-2.5 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-navy-500"><LogIn className="size-4 text-emerald-600" /> ساعت ورود</dt>
            <dd className="font-bold text-navy-900">{att?.checkIn ? faTime(att.checkIn) : '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-navy-500"><LogOut className="size-4 text-rose-500" /> ساعت خروج</dt>
            <dd className="font-bold text-navy-900">{att?.checkOut ? faTime(att.checkOut) : '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-navy-500"><CalendarClock className="size-4 text-brand-600" /> ساعات کاری</dt>
            <dd className="font-bold text-navy-900">{checkInMs ? durationText(worked) : '—'}</dd>
          </div>
          {shift && <p className="text-[11px] text-navy-400">شیفت امروز: {faNum(shift.startTime)} تا {faNum(shift.endTime)}</p>}
        </dl>
        <Ring percent={percent} size={118} thickness={11} color="#2563eb" center={(
          <div>
            <p className="text-lg font-black leading-6 text-navy-900">امروز</p>
            <p className={`text-[11px] font-bold ${checkInMs ? 'text-emerald-600' : 'text-navy-400'}`}>
              {checkInMs ? (checkOutMs ? 'خروج ثبت شده' : 'حاضر') : 'ثبت نشده'}
            </p>
          </div>
        )} />
      </div>
      <div className="mt-4">
        {att?.checkIn && !att?.checkOut
          ? <Button variant="danger" className="w-full" loading={ctx.busy} onClick={ctx.checkOut}><LogOut className="size-4" /> ثبت خروج</Button>
          : <Button className="btn-gradient w-full" loading={ctx.busy} onClick={ctx.checkIn} disabled={Boolean(att?.checkOut)}><LogIn className="size-4" /> {att?.checkOut ? 'حضور امروز کامل است' : 'ثبت ورود'}</Button>}
      </div>
    </PanelCard>
  );
}

function EmployeeInfoCard({ ctx }: { ctx: Ctx }) {
  const p = ctx.payroll?.profile;
  const user = ctx.user;
  const rows: [string, string][] = [
    ['کد پرسنلی', p?.employeeCode ? faNum(p.employeeCode) : '—'],
    ['سمت سازمانی', p?.position || user?.roleName || '—'],
    ['نقش سیستمی', user?.roleName || '—'],
    ['نوع استخدام', ctx.payroll?.cooperationLabel || '—'],
    ['تاریخ استخدام', p?.hiredAt ? faDate(p.hiredAt) : '—'],
  ];
  return (
    <PanelCard title="اطلاعات کاربری">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-b from-brand-500 to-brand-700 text-xl font-black text-white shadow-soft">
          {(user?.fullName ?? 'ک').trim().charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-black text-navy-900">{user?.fullName}</p>
          <p className="mt-0.5 text-xs text-navy-500">{faNum(user?.mobile ?? '')}</p>
        </div>
      </div>
      <dl className="space-y-2.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0 last:pb-0">
            <dt className="text-navy-500">{k}</dt>
            <dd className="font-bold text-navy-900">{k === 'نوع استخدام'
              ? <Badge tone="info">{v}</Badge> : v}
            </dd>
          </div>
        ))}
      </dl>
      <Link to="/staff/shifts" className="btn-gradient mt-4 w-full">پروفایل کاری و شیفت‌های من</Link>
    </PanelCard>
  );
}

function LatestRequests({ summary }: { summary: any }) {
  const rows: any[] = summary?.recentRequests ?? [];
  return (
    <PanelCard title="آخرین درخواست‌ها" action={<MoreLink to="/staff/requests" />}>
      {rows.length === 0 ? (
        <EmptyState title="هنوز پرونده‌ای به شما سپرده نشده است" description="از «دریافت درخواست‌ها» می‌توانید پروندهٔ تازه بردارید." />
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 5).map((r) => (
            <Link key={r.id} to={`/staff/requests/${r.id}`}
              className="lift flex flex-wrap items-center gap-3 rounded-2xl bg-surface-3/70 px-3.5 py-3 ring-1 ring-navy-900/5 transition hover:bg-brand-50/70">
              <CategoryArt name={r.categoryIcon} color={r.categoryColor} className="size-11" glyphClassName="size-6" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-navy-900">{r.serviceTitle}</span>
                <span className="mt-0.5 block text-[11px] text-navy-500">
                  مشتری: {r.customerName ?? '—'} • کد پیگیری: {faNum(r.trackingCode)} • {faDate(r.createdAt)}
                </span>
              </span>
              <StatusBadge status={r.status} label={r.statusLabel} />
            </Link>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

/* ------------------------------------------------------------- fixed home */

function FixedHome({ ctx }: { ctx: Ctx }) {
  const perf = ctx.payroll?.performance;
  const salary = ctx.payroll?.salary;
  const wl = ctx.workload;
  const att = wl?.attendance;
  const paidTotal = salary?.payments?.reduce((s, p) => s + p.amount, 0) ?? 0;
  const monthBars = useMemo(() => {
    const months = [...(salary?.months ?? [])].slice(0, 6).reverse();
    return months.map((m, i) => ({
      label: new Date(`${m.period}-15T00:00:00Z`).toLocaleDateString('fa-IR', { month: 'long' }),
      value: m.accrued,
      highlight: i === months.length - 1,
    }));
  }, [salary]);
  const avgSalary = monthBars.length ? Math.round(monthBars.reduce((s, b) => s + b.value, 0) / monthBars.length) : 0;
  const lastPayment = salary?.payments?.[0] ?? null;

  return (
    <>
      <HeroShell image="/images/staff-fixed-hero.jpg">
        <span className="chip-soft mb-3 bg-white/70 text-brand-800"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> پنل کارمندی</span>
        <h1 className="text-2xl font-black tracking-tight text-navy-900 sm:text-[1.8rem]">
          سلام {firstName(ctx.user?.fullName)} عزیز، خوش آمدید!
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-7 text-navy-600">
          به پنل کارمندی {ctx.brandName} خوش آمدید؛ پرونده‌های فعال، حضور امروز و حقوق ماه جاری را از همین‌جا دنبال کنید.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/staff/requests" className="btn-gradient btn-md">مشاهده پرونده‌های فعال <ArrowLeft className="size-4" /></Link>
          <Link to="/staff/shifts" className="btn-soft btn-md bg-white/80">حضور و غیاب</Link>
        </div>
      </HeroShell>

      <AvailabilityStrip ctx={ctx} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlossyStat color="#f59e0b" icon={<Medal className="size-7" />} label="پرونده‌های تکمیل این ماه"
          value={faNum(perf?.completedMonth ?? 0)} to="/staff/performance"
          sub={`امروز ${faNum(perf?.completedToday ?? 0)} · این هفته ${faNum(perf?.completedWeek ?? 0)}`} />
        <GlossyStat color="#2563eb" icon={<FolderOpen className="size-7" />} label="پرونده‌های فعال"
          value={faNum(wl?.activeCount ?? perf?.inProgress ?? 0)} to="/staff/requests"
          sub={`نیازمند اقدام: ${faNum(perf?.needsAction ?? 0)}`} />
        <GlossyStat color="#16a34a" icon={<CalendarClock className="size-7" />} label="حضور امروز"
          value={att?.checkIn ? 'حاضر' : wl?.shift ? 'ثبت نشده' : 'بدون شیفت'} to="/staff/shifts"
          sub={att?.checkIn ? `ورود: ${faTime(att.checkIn)}` : wl?.shift ? `شیفت: ${faNum(wl.shift.startTime)} تا ${faNum(wl.shift.endTime)}` : 'برای امروز شیفتی تعریف نشده'} />
        <GlossyStat color="#7c3aed" icon={<Wallet className="size-7" />} label="حقوق ماه جاری"
          value={salary?.contract ? rial(salary.contract.monthlyAmount) : '—'} to="/staff/finance"
          sub={salary?.contract ? `پرداخت‌شده: ${rial(paidTotal)} · مانده: ${rial(salary.outstanding)}` : 'قرارداد حقوق فعالی ثبت نشده است'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PanelCard title="دسترسی‌های سریع">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QuickTile color="#2563eb" icon={<Eye className="size-7" />} label="مشاهده پرونده‌ها" to="/staff/requests" />
              <QuickTile color="#db2777" icon={<Coffee className="size-7" />} label="درخواست مرخصی" to="/staff/shifts" />
              <QuickTile color="#7c3aed" icon={<Wallet className="size-7" />} label="مشاهده حقوق" to="/staff/finance" />
              <QuickTile color="#16a34a" icon={<Headphones className="size-7" />} label="ارتباط با پشتیبانی" onClick={openChat} />
            </div>
          </PanelCard>

          <LatestRequests summary={ctx.summary} />

          <PanelCard title="نمودار حقوق و مزایا" action={<MoreLink to="/staff/finance">مشاهده جزئیات</MoreLink>}>
            <SoftBars data={monthBars} format={rial} />
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-3 px-3 py-2.5">
                <PiggyBank className="size-5 shrink-0 text-accent" />
                <span className="min-w-0"><span className="block text-[11px] text-navy-500">میانگین حقوق ماهانه</span>
                  <span className="font-bold text-navy-900">{avgSalary ? rial(avgSalary) : '—'}</span></span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-3 px-3 py-2.5">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                <span className="min-w-0"><span className="block text-[11px] text-navy-500">آخرین واریز حقوق</span>
                  <span className="font-bold text-navy-900">{lastPayment ? `${rial(lastPayment.amount)} · ${faDate(lastPayment.paidAt)}` : '—'}</span></span>
              </div>
            </div>
          </PanelCard>
        </div>

        <div className="space-y-6">
          <AttendanceCard ctx={ctx} />
          <EmployeeInfoCard ctx={ctx} />
          <PendingDocsCard workload={wl} />
          <NoticesCard summary={ctx.summary} />
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- percent home */

interface EarningEntry {
  amount: number; basisAmount: number; recordedAt: string; status: string;
}

function PercentHome({ ctx }: { ctx: Ctx }) {
  const payroll = ctx.payroll;
  const income = payroll?.income;
  const [range, setRange] = useState<'week' | 'month' | 'quarter'>('month');
  const [entries, setEntries] = useState<EarningEntry[]>([]);

  useEffect(() => {
    let active = true;
    api.get<{ data: { entries: EarningEntry[] } }>(`/api/payroll/me/earnings?from=${daysAgo(95)}&to=`)
      .then((res) => { if (active) setEntries(res.data.entries ?? []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const agg = useMemo(() => {
    const now = new Date();
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const curMonth = monthKey(now);
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = monthKey(prevMonthDate);
    let monthBasis = 0, prevShare = 0;
    const byDay = new Map<string, { share: number; basis: number }>();
    const byMonth = new Map<string, { share: number; basis: number; at: Date }>();
    for (const e of entries) {
      const at = new Date(e.recordedAt);
      if (Number.isNaN(at.getTime())) continue;
      const mk = monthKey(at);
      const basis = e.status === 'reversal' ? 0 : Number(e.basisAmount ?? 0);
      if (mk === curMonth) monthBasis += basis;
      if (mk === prevMonth) prevShare += Number(e.amount ?? 0);
      const dk = e.recordedAt.slice(0, 10);
      const d = byDay.get(dk) ?? { share: 0, basis: 0 };
      d.share += Number(e.amount ?? 0); d.basis += basis; byDay.set(dk, d);
      const m = byMonth.get(mk) ?? { share: 0, basis: 0, at };
      m.share += Number(e.amount ?? 0); m.basis += basis; byMonth.set(mk, m);
    }
    const dayPoints = (days: number) => {
      const out: { label: string; value: number }[] = [];
      const bars: { label: string; value: number }[] = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const label = faDateShort(d.toISOString());
        const v = byDay.get(key) ?? { share: 0, basis: 0 };
        out.push({ label, value: v.share });
        bars.push({ label, value: v.basis });
      }
      return { points: out, bars };
    };
    const monthPoints = () => {
      const out: { label: string; value: number }[] = [];
      const bars: { label: string; value: number }[] = [];
      for (let i = 2; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const v = byMonth.get(monthKey(d)) ?? { share: 0, basis: 0 };
        const label = d.toLocaleDateString('fa-IR', { month: 'long' });
        out.push({ label, value: v.share });
        bars.push({ label, value: v.basis });
      }
      return { points: out, bars };
    };
    const spark: number[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      spark.push(byDay.get(key)?.share ?? 0);
    }
    return { monthBasis, prevShare, dayPoints, monthPoints, spark };
  }, [entries]);

  const shareMonth = income?.month ?? 0;
  const officeMonth = Math.max(0, agg.monthBasis - shareMonth);
  const effectivePercent = agg.monthBasis > 0 ? Math.round((shareMonth / agg.monthBasis) * 1000) / 10 : 0;
  const deltaPrev = agg.prevShare > 0 ? Math.round(((shareMonth - agg.prevShare) / agg.prevShare) * 1000) / 10 : (shareMonth > 0 ? 100 : 0);
  const chart = range === 'week' ? agg.dayPoints(7) : range === 'month' ? agg.dayPoints(30) : agg.monthPoints();
  const chartPoints = range === 'month' ? chart.points.filter((_, i) => i % 3 === 0 || i === chart.points.length - 1) : chart.points;
  const chartBars = range === 'month' ? chart.bars.filter((_, i) => i % 3 === 0 || i === chart.bars.length - 1) : chart.bars;
  const goal = payroll?.goal;
  const withdrawals = payroll?.withdrawals ?? [];

  return (
    <>
      <HeroShell image="/images/staff-percent-hero.jpg" dark>
        <span className="chip-soft mb-3 border border-white/25 bg-white/10 text-white">پنل کارمندی درصدی</span>
        <h1 className="text-2xl font-black tracking-tight text-white sm:text-[1.8rem]">داشبورد درآمد و کمیسیون</h1>
        <p className="mt-2 max-w-xl text-sm leading-7 text-white/80">
          {firstName(ctx.user?.fullName)} عزیز، فروش دوره، سهم درآمد و پرداخت‌های شما بر پایهٔ درصد قرارداد و درآمد دفتر همین‌جا محاسبه می‌شود.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/staff/finance" className="btn btn-md border border-white/30 bg-white font-bold text-navy-900 hover:bg-white/90">گزارش درآمد <ArrowLeft className="size-4" /></Link>
          <Link to="/staff/finance" className="btn btn-md border border-white/30 bg-white/10 font-bold text-white hover:bg-white/20">درخواست برداشت</Link>
        </div>
      </HeroShell>

      <AvailabilityStrip ctx={ctx} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlossyStat color="#f59e0b" icon={<Trophy className="size-7" />} label="رتبهٔ عملکرد این ماه"
          value={payroll?.rank?.position ? `رتبهٔ ${faNum(payroll.rank.position)}` : '—'} to="/staff/performance"
          sub={payroll?.rank?.total ? `از میان ${faNum(payroll.rank.total)} کارمند درصدی` : 'درآمد قطعی این ماه مبنای رتبه است'} />
        <GlossyStat color="#2563eb" icon={<ShoppingCart className="size-7" />} label="فروش کل دوره (ماه جاری)"
          value={rial(agg.monthBasis)} to="/staff/finance" sub="مبنای محاسبهٔ کمیسیون (درآمد دفتر)">
          <Sparkline values={agg.spark} color="#2563eb" className="mt-2" />
        </GlossyStat>
        <GlossyStat color="#16a34a" icon={<BadgePercent className="size-7" />} label="درصد پایهٔ قرارداد"
          value={`${faNum(payroll?.contract?.commissionPercent ?? 0)}٪`} to="/staff/finance"
          sub="برای برخی خدمات، درصد جدا تعریف می‌شود" />
        <GlossyStat color="#7c3aed" icon={<Coins className="size-7" />} label="درآمد سهم شما (ماه جاری)"
          value={rial(shareMonth)} to="/staff/finance" delta={deltaPrev} sub="نسبت به ماه قبل">
          <Sparkline values={agg.spark} color="#7c3aed" className="mt-2" />
        </GlossyStat>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PanelCard title="نمودار عملکرد و درآمد" action={(
            <Tabs active={range} onChange={(k) => setRange(k as typeof range)} tabs={[
              { key: 'week', label: 'هفتهٔ جاری' },
              { key: 'month', label: 'ماه جاری' },
              { key: 'quarter', label: 'سه ماه اخیر' },
            ]} />
          )}>
            <LineChart points={chartPoints} bars={chartBars} format={rial} />
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-navy-500">
              <span className="flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-brand-600" aria-hidden="true" /> سهم شما (درآمد قطعی)</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand-600/25" aria-hidden="true" /> فروش (مبنای کمیسیون)</span>
            </div>
          </PanelCard>

          <PanelCard title="تاریخچهٔ پرداخت‌ها" action={<MoreLink to="/staff/finance">مشاهده همهٔ تراکنش‌ها</MoreLink>}>
            {withdrawals.length === 0 ? (
              <p className="text-sm text-navy-400">هنوز برداشت یا پرداختی ثبت نشده است.</p>
            ) : (
              <div className="space-y-2">
                {withdrawals.slice(0, 5).map((w) => (
                  <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-3/70 px-3.5 py-3 ring-1 ring-navy-900/5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-navy-900">برداشت درآمد</span>
                      <span className="mt-0.5 block text-[11px] text-navy-500">
                        درخواست: {faDate(w.requestedAt)}{w.paidAt ? ` • پرداخت: ${faDate(w.paidAt)}` : ''}
                      </span>
                    </span>
                    <span className="font-black text-navy-900">{rial(w.amount)}</span>
                    {w.status === 'paid'
                      ? <Badge tone="success"><CheckCircle2 className="size-3.5" /> پرداخت شده</Badge>
                      : <Badge tone="warning">{w.statusLabel}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </PanelCard>
        </div>

        <div className="space-y-6">
          <PanelCard title="جزئیات سهم و کمیسیون">
            <div className="flex flex-col items-center gap-4">
              <Donut size={164} thickness={17} segments={[
                { value: shareMonth, color: '#2563eb', label: 'سهم شما' },
                { value: officeMonth, color: '#93c5fd', label: 'سهم دفتر' },
              ]} center={(
                <div>
                  <p className="text-[11px] text-navy-500">سهم شما</p>
                  <p className="text-2xl font-black text-navy-900">{faNum(effectivePercent)}٪</p>
                </div>
              )} />
              <dl className="w-full space-y-2 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-navy-600"><span className="size-2.5 rounded-sm bg-brand-600" aria-hidden="true" /> سهم شما</dt>
                  <dd className="font-bold text-navy-900">{rial(shareMonth)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-navy-600"><span className="size-2.5 rounded-sm bg-brand-300" aria-hidden="true" /> سهم دفتر</dt>
                  <dd className="font-bold text-navy-900">{rial(officeMonth)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                  <dt className="text-navy-600">فروش کل دوره</dt>
                  <dd className="font-black text-navy-900">{rial(agg.monthBasis)}</dd>
                </div>
              </dl>
            </div>
            <Link to="/staff/finance" className="btn-soft mt-4 w-full">مشاهده جزئیات بیشتر</Link>
          </PanelCard>

          {goal ? (
            <PanelCard title="وضعیت کمیسیون">
              <div className="flex flex-col items-center gap-4">
                <Ring percent={goal.percent} size={128} thickness={12} color="#16a34a" center={(
                  <div>
                    <p className="text-xl font-black text-navy-900">{faNum(goal.percent)}٪</p>
                    <p className="text-[10px] text-navy-500">از هدف ماه</p>
                  </div>
                )} />
                <dl className="w-full space-y-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2"><dt className="text-navy-600">هدف ماهانه</dt><dd className="font-bold text-navy-900">{rial(goal.target)}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt className="text-navy-600">تحقق‌یافته</dt><dd className="font-bold text-emerald-700">{rial(goal.achieved)}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt className="text-navy-600">مانده تا هدف</dt><dd className="font-bold text-navy-900">{rial(Math.max(0, goal.target - goal.achieved))}</dd></div>
                </dl>
                <p className="text-center text-xs leading-6 text-navy-500">
                  {goal.percent >= 100 ? 'هدف این ماه کامل شد؛ آفرین!' : 'ادامه دهید، به هدف نزدیک می‌شوید!'}
                </p>
              </div>
            </PanelCard>
          ) : (
            <PanelCard title="وضعیت برداشت">
              <dl className="space-y-2.5 text-[13px]">
                <div className="flex items-center justify-between gap-2"><dt className="text-navy-600">قابل برداشت</dt><dd className="font-black text-emerald-700">{rial(payroll?.balance?.available ?? 0)}</dd></div>
                <div className="flex items-center justify-between gap-2"><dt className="text-navy-600">در انتظار پایان دوره</dt><dd className="font-bold text-amber-700">{rial(payroll?.balance?.future ?? 0)}</dd></div>
                <div className="flex items-center justify-between gap-2"><dt className="text-navy-600">برآوردی (پرداخت‌نشده)</dt><dd className="font-bold text-navy-900">{rial(income?.pendingEstimate ?? 0)}</dd></div>
              </dl>
              <Link to="/staff/finance" className="btn-gradient mt-4 w-full">درخواست برداشت درآمد</Link>
            </PanelCard>
          )}

          <PendingDocsCard workload={ctx.workload} />
          <NoticesCard summary={ctx.summary} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ shell */

export function StaffWorkbench() {
  const { user } = useAuth();
  const brand = useBrand();
  const { notify } = useToast();
  const [summary, setSummary] = useState<any>(null);
  const [workload, setWorkload] = useState<any>(null);
  // Cooperation-aware payroll summary: income exists only for percentage staff.
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [sum, wl, pay] = await Promise.all([
        api.get<{ data: any }>('/api/dashboard/summary'),
        api.get<{ data: any }>('/api/staff/me/workload').catch(() => null),
        api.get<{ data: Payroll }>('/api/payroll/me/summary').catch(() => null),
      ]);
      setSummary(sum.data);
      setWorkload(wl?.data ?? null);
      setPayroll(pay?.data ?? null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const checkIn = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ data: any }>('/api/shifts/attendance/check-in');
      notify(res.data.status === 'late' ? `ورود ثبت شد (${faNum(res.data.minutesLate)} دقیقه تأخیر).` : 'ورود شما ثبت شد.', 'success');
      void load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(false); }
  };

  const checkOut = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ data: any }>('/api/shifts/attendance/check-out');
      notify(`خروج ثبت شد. مدت حضور: ${faNum(Math.round(res.data.workedMinutes / 60))} ساعت`, 'success');
      void load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(false); }
  };

  const toggleAvailability = async () => {
    try {
      const res = await api.post<{ data: { acceptsNewCases: boolean } }>(`/api/staff/${user?.id}/toggle-availability`, {});
      setWorkload((current: any) => ({ ...current, acceptsNewCases: res.data.acceptsNewCases }));
      notify(res.data.acceptsNewCases ? 'پذیرش پروندهٔ جدید برای شما باز شد.' : 'پذیرش پروندهٔ جدید بسته شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  if (loading) return <AppShell variant="staff"><Loading rows={4} /></AppShell>;

  const ctx: Ctx = {
    user, brandName: brand.name, payroll, workload, summary, busy,
    checkIn: () => void checkIn(), checkOut: () => void checkOut(),
    toggleAvailability: () => void toggleAvailability(), reload: () => void load(),
  };

  return (
    <AppShell variant="staff">
      {payroll?.cooperationType === 'commission' ? <PercentHome ctx={ctx} /> : <FixedHome ctx={ctx} />}
    </AppShell>
  );
}
