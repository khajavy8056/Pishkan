import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, CalendarRange, Coins, Hourglass, Landmark, ReceiptText, RefreshCw, TrendingUp, Wallet,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, StatCard, StatusBadge, Tabs, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDate, faDateTime, faNum, rial } from '../../lib/format';

interface Dashboard {
  cooperationType: 'commission' | 'monthly' | 'none';
  cooperationLabel: string;
  performance: {
    total: number; completed: number; completedToday: number; completedWeek: number; completedMonth: number;
    inProgress: number; awaitingOrganization: number; awaitingCustomer: number; needsAction: number;
    cancelled: number; averageCompletionMinutes: number; avgMinutesSample: number;
  };
  income: {
    today: number; week: number; month: number; definite: number; pendingEstimate: number;
    withdrawable: number; requested: number; withdrawn: number; paidOut: number;
  } | null;
  balance: {
    available: number; eligible: number; future: number; reserved: number; withdrawn: number;
    minWithdrawal: number; period: 'daily' | 'weekly' | 'monthly' | 'custom'; periodDays: number;
    currentWindow: { start: string; end: string }; enabled: boolean; canRequest: boolean;
  } | null;
  withdrawals: Withdrawal[];
  openWithdrawal: number;
  salary: {
    contract: { monthlyAmount: number; startsOn: string; endsOn: string | null } | null;
    months: { period: string; accrued: number; paid: number; remaining: number; status: string; statusLabel: string }[];
    outstanding: number;
    payments: { id: string; periodMonth: string; amount: number; method: string; trackingCode: string; paidAt: string; note?: string }[];
    history: { id: string; kind: string; monthlyAmount: number; commissionPercent: number; startsOn: string; endsOn: string | null }[];
  } | null;
}

interface EarningRow {
  id: string; kindLabel: string; amount: number; basisAmount: number; percent: number;
  trackingCode: string | null; serviceTitle: string | null; customerName: string | null;
  performedAt: string | null; recordedAt: string; withdrawableAt: string | null;
  status: 'withdrawable' | 'pending_settlement' | 'withdrawn' | 'reversal';
  note: string | null;
}

interface Withdrawal {
  id: string; amount: number; status: string; statusLabel: string; requestedAt: string;
  paidAt: string | null; trackingCode: string | null; decisionNote: string | null; periodStart: string | null;
  receiptUrl?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  withdrawable: 'قابل برداشت', pending_settlement: 'در انتظار پایان دوره',
  withdrawn: 'برداشت‌شده', reversal: 'برگشت سهم',
};

const PERIOD_LABEL: Record<string, string> = {
  daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه', custom: 'دوره اختصاصی',
};

const RANGES = [
  { key: 'today', label: 'امروز' },
  { key: 'yesterday', label: 'دیروز' },
  { key: 'week', label: 'هفته جاری' },
  { key: 'month', label: 'ماه جاری' },
  { key: 'custom', label: 'بازه دلخواه' },
];

function rangeOf(key: string, custom: { from: string; to: string }) {
  const start = (date: Date) => `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const now = new Date();
  if (key === 'today') return { from: start(now), to: undefined };
  if (key === 'yesterday') {
    const y = new Date(now.getTime() - 86_400_000);
    return { from: start(y), to: `${now.toISOString().slice(0, 10)}T00:00:00.000Z` };
  }
  if (key === 'week') return { from: start(new Date(now.getTime() - 6 * 86_400_000)), to: undefined };
  if (key === 'month') return { from: start(new Date(now.getTime() - 29 * 86_400_000)), to: undefined };
  return {
    from: custom.from ? `${custom.from}T00:00:00.000Z` : undefined,
    to: custom.to ? `${custom.to}T23:59:59.000Z` : undefined,
  };
}

export function StaffEarnings() {
  const { notify } = useToast();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('performance');
  const [rangeKey, setRangeKey] = useState('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [entries, setEntries] = useState<EarningRow[] | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError('');
    api.get<{ data: Dashboard }>('/api/payroll/me/summary')
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت اطلاعات درآمد'));
  };
  useEffect(load, []);

  const loadEntries = () => {
    const range = rangeOf(rangeKey, custom);
    setEntries(null);
    api.get<{ data: { entries: EarningRow[] } }>(`/api/payroll/me/earnings?from=${range.from ?? ''}&to=${range.to ?? ''}`)
      .then((res) => setEntries(res.data.entries))
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت گردش درآمد', 'error'));
  };
  useEffect(() => { if (data?.cooperationType === 'commission' && tab === 'income') loadEntries(); }, [data?.cooperationType, tab, rangeKey]);

  const submitWithdrawal = async () => {
    setBusy(true);
    try {
      await api.post('/api/payroll/me/withdrawals', { amount, note: note || undefined });
      notify('درخواست برداشت ثبت شد و برای بررسی حسابداری ارسال گردید.', 'success');
      setRequestOpen(false);
      setAmount(0);
      setNote('');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت درخواست ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelWithdrawal = async (id: string) => {
    setBusy(true);
    try {
      await api.post(`/api/payroll/me/withdrawals/${id}/cancel`, {});
      notify('درخواست برداشت لغو شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'لغو ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  if (error) return <AppShell variant="staff"><ErrorState message={error} onRetry={load} /></AppShell>;
  if (!data) return <AppShell variant="staff"><Loading rows={4} /></AppShell>;

  const commission = data.cooperationType === 'commission';
  const tabs = commission
    ? [{ key: 'performance', label: 'عملکرد' }, { key: 'income', label: 'درآمد و برداشت' }, { key: 'history', label: 'تاریخچه تسویه' }]
    : [{ key: 'performance', label: 'عملکرد' }, { key: 'history', label: 'حقوق و پرداخت‌ها', count: data.salary?.months.length }];

  return (
    <AppShell variant="staff">
      <PageHeader
        title={commission ? 'درآمد و تسویه‌حساب من' : 'عملکرد و حقوق من'}
        description={commission
          ? 'سهم شما از هر خدمت، مبلغ قابل برداشت و درخواست‌های برداشت — همه از اسناد واقعی سامانه.'
          : 'تعداد خدمات انجام‌شده و سوابق حقوق ثابت. شما درآمد درصدی ندارید، بنابراین بخش برداشت برای شما نمایش داده نمی‌شود.'}
        actions={<Button variant="ghost" onClick={load}><RefreshCw className="size-4" /> به‌روزرسانی</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        <Badge tone={commission ? 'success' : 'info'}>نوع همکاری: {data.cooperationLabel}</Badge>
      </div>

      {tab === 'performance' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="تکمیل‌شده امروز" value={faNum(data.performance.completedToday)} tone="emerald" icon={<Coins className="size-5" />} />
            <StatCard label="تکمیل‌شده این هفته" value={faNum(data.performance.completedWeek)} icon={<CalendarRange className="size-5" />} />
            <StatCard label="تکمیل‌شده این ماه" value={faNum(data.performance.completedMonth)} icon={<TrendingUp className="size-5" />} />
            <StatCard label="کل خدمات انجام‌شده" value={faNum(data.performance.completed)} icon={<ReceiptText className="size-5" />} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="در حال انجام" value={faNum(data.performance.inProgress)} tone="amber" icon={<Hourglass className="size-5" />} />
            <StatCard label="منتظر پاسخ سازمان" value={faNum(data.performance.awaitingOrganization)} tone="amber" />
            <StatCard label="منتظر پاسخ مشتری" value={faNum(data.performance.awaitingCustomer)} />
            <StatCard label="نیازمند اقدام من" value={faNum(data.performance.needsAction)} tone="rose" />
          </div>
          <Card className="mt-5">
            <h2 className="mb-2 font-bold text-navy-900">میانگین زمان انجام</h2>
            <p className="text-sm text-navy-600">
              {data.performance.avgMinutesSample > 0
                ? `${faNum(data.performance.averageCompletionMinutes)} دقیقه، بر پایه ${faNum(data.performance.avgMinutesSample)} پروندهٔ تکمیل‌شده`
                : 'هنوز پروندهٔ تکمیل‌شده‌ای با زمان ثبت‌شده ندارید.'}
            </p>
          </Card>

          {commission && data.income && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="درآمد امروز" value={rial(data.income.today)} tone="emerald" icon={<Wallet className="size-5" />} />
              <StatCard label="درآمد این ماه" value={rial(data.income.month)} icon={<TrendingUp className="size-5" />} />
              <StatCard label="درآمد قطعی کل" value={rial(data.income.definite)} />
              <StatCard label="قابل برداشت" value={rial(data.income.withdrawable)} tone="emerald" icon={<Banknote className="size-5" />} />
            </div>
          )}
        </>
      )}

      {tab === 'income' && commission && data.income && data.balance && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="درآمد قطعی" value={rial(data.income.definite)} hint="از پرداخت‌های تأییدشده" />
            <StatCard label="برآورد در انتظار قطعی" value={rial(data.income.pendingEstimate)} tone="amber" hint="پرونده‌های باز؛ قطعی نیست" />
            <StatCard label="قابل برداشت" value={rial(data.balance.available)} tone="emerald" />
            <StatCard label="در انتظار بررسی" value={rial(data.balance.reserved)} tone="amber" />
            <StatCard label="برداشت‌شده" value={rial(data.balance.withdrawn)} />
            <StatCard label="پرداخت‌شده" value={rial(data.income.paidOut)} />
          </div>

          <Card className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-navy-900">درخواست برداشت</h2>
                <p className="mt-1 text-xs leading-6 text-navy-500">
                  دوره تسویه: {PERIOD_LABEL[data.balance.period] ?? data.balance.period} · حداقل برداشت {rial(data.balance.minWithdrawal)} ·
                  دورهٔ جاری {faDate(data.balance.currentWindow.start)} تا {faDate(data.balance.currentWindow.end)}
                </p>
              </div>
              <Button
                disabled={!data.balance.enabled || data.balance.available < Math.max(1, data.balance.minWithdrawal)}
                onClick={() => { setAmount(data.balance!.available); setRequestOpen(true); }}
                icon={<Banknote className="size-4" />}
              >
                ثبت درخواست برداشت
              </Button>
            </div>
            {!data.balance.enabled && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">ثبت درخواست برداشت توسط مدیر غیرفعال شده است.</p>
            )}
            {data.balance.enabled && data.balance.available < Math.max(1, data.balance.minWithdrawal) && (
              <p className="mt-3 rounded-xl bg-surface-3 px-3 py-2 text-xs text-navy-600">
                موجودی قابل برداشت شما ({rial(data.balance.available)}) کمتر از حداقل مجاز ({rial(data.balance.minWithdrawal)}) است.
                درآمدهای جدید پس از پایان دورهٔ تسویه به این مبلغ اضافه می‌شوند.
              </p>
            )}
          </Card>

          <Card className="mt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold text-navy-900">جزئیات درآمد</h2>
              <div className="flex flex-wrap items-center gap-2">
                {RANGES.map((range) => (
                  <button
                    key={range.key}
                    onClick={() => setRangeKey(range.key)}
                    className={clsx('rounded-lg px-2.5 py-1 text-xs ring-1 transition',
                      rangeKey === range.key ? 'bg-brand-50 text-accent ring-brand-200' : 'text-navy-600 ring-line hover:bg-surface-3')}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>
            {rangeKey === 'custom' && (
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Field label="از تاریخ"><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
                <Field label="تا تاریخ"><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
              </div>
            )}
            {!entries && <Loading rows={3} />}
            {entries?.length === 0 && <EmptyState title="در این بازه درآمدی ثبت نشده است" description="درآمد پس از تأیید پرداخت مشتری و با سهم همان لحظه ثبت می‌شود." />}
            {!!entries?.length && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>خدمت / کد پیگیری</th>
                      <th>تاریخ ثبت</th>
                      <th>درآمد دفتر</th>
                      <th>درصد</th>
                      <th>سهم من</th>
                      <th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <p className="font-medium text-navy-900">{row.serviceTitle ?? '—'}</p>
                          <p className="text-[11px] text-navy-500">{row.trackingCode ?? 'بدون پرونده'}{row.customerName ? ` · ${row.customerName}` : ''}</p>
                        </td>
                        <td>{faDateTime(row.recordedAt)}</td>
                        <td>{rial(row.basisAmount)}</td>
                        <td>{faNum(row.percent)}٪</td>
                        <td className={row.amount < 0 ? 'font-semibold text-rose-700' : 'font-semibold text-emerald-700'}>{rial(row.amount)}</td>
                        <td>
                          <span className={clsx('badge', row.status === 'withdrawable' && 'bg-emerald-50 text-emerald-800',
                            row.status === 'pending_settlement' && 'bg-amber-50 text-amber-800',
                            row.status === 'withdrawn' && 'bg-brand-50 text-accent',
                            row.status === 'reversal' && 'bg-rose-50 text-rose-800')}>
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'history' && commission && (
        <Card>
          <h2 className="mb-4 font-bold text-navy-900">درخواست‌های برداشت من</h2>
          {data.withdrawals.length === 0 && <EmptyState title="درخواست برداشتی ثبت نکرده‌اید" />}
          <div className="space-y-2">
            {data.withdrawals.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-3 px-4 py-3">
                <div>
                  <p className="font-semibold text-navy-900">{rial(row.amount)}</p>
                  <p className="mt-0.5 text-[11px] text-navy-500">
                    ثبت {faDateTime(row.requestedAt)}
                    {row.periodStart ? ` · دوره ${faDate(row.periodStart)}` : ''}
                    {row.trackingCode ? ` · پیگیری ${row.trackingCode}` : ''}
                    {row.receiptUrl && (
                      <> · <a className="font-medium text-accent underline" href={row.receiptUrl} target="_blank" rel="noreferrer">رسید پرداخت</a></>
                    )}
                  </p>
                  {row.decisionNote && <p className="mt-1 text-[11px] text-rose-700">علت: {row.decisionNote}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={row.status} label={row.statusLabel} />
                  {['submitted', 'reviewing'].includes(row.status) && (
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => cancelWithdrawal(row.id)}>لغو</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'history' && !commission && data.salary && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="حقوق ماهانه قرارداد" value={data.salary.contract ? rial(data.salary.contract.monthlyAmount) : '—'} icon={<Landmark className="size-5" />} />
            <StatCard label="حقوق پرداخت‌شده" value={rial(data.salary.payments.reduce((sum, row) => sum + row.amount, 0))} tone="emerald" />
            <StatCard label="مانده حقوق (معوق)" value={rial(data.salary.outstanding)} tone="amber" />
          </div>
          <Card className="mt-5">
            <h2 className="mb-4 font-bold text-navy-900">دوره‌های حقوق</h2>
            {data.salary.months.length === 0 && <EmptyState title="هنوز دوره حقوقی محاسبه نشده است" />}
            <div className="table-wrap">
              {!!data.salary.months.length && (
                <table className="table">
                  <thead><tr><th>دوره</th><th>حقوق محاسبه‌شده</th><th>پرداخت‌شده</th><th>باقی‌مانده</th><th>وضعیت</th></tr></thead>
                  <tbody>
                    {data.salary.months.map((row) => (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        <td>{rial(row.accrued)}</td>
                        <td>{rial(row.paid)}</td>
                        <td>{rial(row.remaining)}</td>
                        <td>
                          <span className={clsx('badge', row.status === 'paid' && 'bg-emerald-50 text-emerald-800',
                            row.status === 'pending' && 'bg-amber-50 text-amber-800',
                            row.status === 'overdue' && 'bg-rose-50 text-rose-800')}>{row.statusLabel}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
          <Card className="mt-5">
            <h2 className="mb-4 font-bold text-navy-900">سوابق پرداخت</h2>
            {data.salary.payments.length === 0 && <EmptyState title="پرداختی ثبت نشده است" />}
            <div className="space-y-2">
              {data.salary.payments.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-navy-900">{rial(row.amount)}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">دوره {row.periodMonth} · پیگیری {row.trackingCode} · {faDate(row.paidAt)}</p>
                  </div>
                  <Badge tone="success">پرداخت‌شده</Badge>
                </div>
              ))}
            </div>
          </Card>
          {data.salary.history.length > 0 && (
            <Card className="mt-5">
              <h2 className="mb-3 font-bold text-navy-900">تاریخچه قرارداد و حقوق</h2>
              <div className="space-y-2">
                {data.salary.history.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-3 px-4 py-3 text-sm">
                    <span>{row.kind === 'monthly' ? 'حقوق ثابت' : 'درصدی'}</span>
                    <span className="font-semibold">{row.kind === 'monthly' ? rial(row.monthlyAmount) : `${faNum(row.commissionPercent)}٪`}</span>
                    <span className="text-xs text-navy-500">{faDate(row.startsOn)} تا {row.endsOn ? faDate(row.endsOn) : 'نامشخص'}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <Modal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        title="ثبت درخواست برداشت درآمد"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRequestOpen(false)}>انصراف</Button>
            <Button loading={busy} disabled={!amount} onClick={submitWithdrawal}>ثبت درخواست</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-surface-3 px-3 py-2 text-xs leading-6 text-navy-600">
            موجودی قابل برداشت: <b>{rial(data.balance?.available ?? 0)}</b> · حداقل مجاز: <b>{rial(data.balance?.minWithdrawal ?? 0)}</b>
          </p>
          <Field label="مبلغ (ریال)" required>
            <Input
              type="number" min={data.balance?.minWithdrawal ?? 1} max={data.balance?.available ?? 0}
              value={amount} onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
          <Field label="توضیح (اختیاری)" hint="مثلاً شماره شبا یا توضیح برای حسابداری">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="text-xs leading-6 text-navy-500">
            پس از ثبت، مبلغ از موجودی قابل برداشت شما رزرو می‌شود، برای حسابداری ارسال می‌گردد و پس از تأیید و ثبت پرداخت،
            در سوابق شما با کد پیگیری ثبت می‌شود.
          </p>
        </div>
      </Modal>
    </AppShell>
  );
}
