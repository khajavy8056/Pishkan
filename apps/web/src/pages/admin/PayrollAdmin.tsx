import { useEffect, useState } from 'react';
import {
  Banknote, CheckCircle2, Coins, FileText, RefreshCw, Search, Users, Wallet, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, StatCard, StatusBadge,
  Tabs, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDate, faDateTime, faNum, rial } from '../../lib/format';

interface Overview {
  commissionStaff: { id: string; fullName: string; percent: number }[];
  monthlyStaff: { id: string; fullName: string; monthlyAmount: number }[];
  pendingWithdrawals: { count: number; total: number };
  paidWithdrawals: number;
  salary: { userId: string; fullName: string; accrued: number; paid: number; outstanding: number }[];
  commission: { earned: number; reversed: number };
}

interface Withdrawal {
  id: string; userId: string; staffName: string | null; amount: number; status: string; statusLabel: string;
  requestedAt: string; periodStart: string | null; periodEnd: string | null; note: string | null;
  decisionNote: string | null; paidAt: string | null; paymentMethod: string | null; trackingCode: string | null;
}

interface StaffRow { id: string; fullName: string; roleCode: string | null; cooperationType: 'commission' | 'monthly' | 'none' }

interface StaffFile {
  staff: any;
  cooperationType: string;
  cooperationLabel: string;
  contract: any;
  contractHistory: any[];
  performance: any;
  recentRequests: any[];
  income: any;
  entries: any[];
  balance: any;
  withdrawals: Withdrawal[];
  salary: any;
}

const ACTIONS: Record<string, { label: string; tone?: 'danger' | 'success' }> = {
  review: { label: 'ارسال به بررسی حسابداری' },
  approve: { label: 'تأیید درخواست' },
  reject: { label: 'رد درخواست', tone: 'danger' },
};

/**
 * Per-service commission override editor (spec: a manager may set a special
 * percent for one person on one service). Loaded inside the staff file.
 */
function ServicePercentsEditor({ staffId }: { staffId: string }) {
  const { can } = useAuth();
  const { notify } = useToast();
  const [items, setItems] = useState<{ serviceId: string; percent: number }[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = can('payroll.contracts.edit');

  useEffect(() => {
    api.get<{ data: any }>(`/api/payroll/staff/${staffId}/service-percents`)
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
    api.list<any>('/api/catalog/admin/services', { pageSize: 200 })
      .then((res) => setServices(res.data ?? []))
      .catch(() => undefined);
  }, [staffId]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put<{ data: any }>(`/api/payroll/staff/${staffId}/service-percents`, {
        items: items.filter((item) => item.serviceId).map((item) => ({ serviceId: item.serviceId, percent: Number(item.percent) })),
      });
      setItems(Array.isArray(res.data) ? res.data : []);
      notify('درصدهای ویژهٔ خدمت ذخیره شد. روی درآمدهای قطعی گذشته اثری ندارد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ذخیره', 'error');
    } finally { setBusy(false); }
  };

  if (!loaded) return <Loading rows={1} />;

  return (
    <div>
      <h3 className="mb-1 font-semibold">درصد ویژه به‌ازای خدمت</h3>
      <p className="mb-2 text-[11px] leading-6 text-navy-500">
        برای خدمت‌های خاص، به‌جای درصد کلی قرارداد. هر خدمتی که اینجا نباشد با درصد کلی قرارداد محاسبه می‌شود.
      </p>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select className="min-w-52 flex-1" value={item.serviceId} disabled={!editable}
              onChange={(e) => setItems(items.map((row, i) => (i === index ? { ...row, serviceId: e.target.value } : row)))}
              options={[{ value: '', label: 'انتخاب خدمت' }, ...services.map((svc) => ({ value: svc.id, label: svc.title }))]} />
            <Input type="number" min={0} max={100} className="w-24" dir="ltr" value={item.percent} disabled={!editable}
              onChange={(e) => setItems(items.map((row, i) => (i === index ? { ...row, percent: Number(e.target.value) } : row)))} />
            <span className="text-xs text-navy-500">٪</span>
            {editable && (
              <Button size="sm" variant="ghost" aria-label="حذف" onClick={() => setItems(items.filter((_, i) => i !== index))}>
                <XCircle className="size-4 text-rose-600" />
              </Button>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-navy-400">درصد ویژه‌ای تعریف نشده است.</p>}
      </div>
      {editable && (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setItems([...items, { serviceId: '', percent: 0 }])}>افزودن خدمت</Button>
          <Button size="sm" className="ms-auto" loading={busy} disabled={items.some((item) => !item.serviceId)} onClick={() => void save()}>
            ذخیره درصدهای ویژه
          </Button>
        </div>
      )}
    </div>
  );
}

export function AdminPayroll() {
  const { notify } = useToast();
  const [tab, setTab] = useState('withdrawals');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [status, setStatus] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [file, setFile] = useState<StaffFile | null>(null);
  const [payModal, setPayModal] = useState<Withdrawal | null>(null);
  const [payForm, setPayForm] = useState({ method: 'bank_transfer', trackingCode: '', note: '' });
  const [rejectModal, setRejectModal] = useState<Withdrawal | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [salaryModal, setSalaryModal] = useState<StaffRow | null>(null);
  const [salaryFile, setSalaryFile] = useState<any>(null);
  const [salaryForm, setSalaryForm] = useState({ periodMonth: new Date().toISOString().slice(0, 7), amount: 0, method: 'bank_transfer', trackingCode: '', note: '' });
  const [reports, setReports] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [contractOpen, setContractOpen] = useState<StaffRow | null>(null);
  const [contractForm, setContractForm] = useState({
    kind: 'commission' as 'monthly' | 'commission', monthlyAmount: 0, commissionPercent: 10,
    startsOn: new Date().toISOString().slice(0, 10), settlementPeriod: 'monthly' as 'daily' | 'weekly' | 'monthly' | 'custom',
    settlementDays: 0, minWithdrawal: 0, note: '',
  });

  const loadOverview = () => {
    api.get<{ data: Overview }>('/api/payroll/overview').then((res) => setOverview(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت خلاصه'));
  };
  const loadWithdrawals = () => {
    setWithdrawals(null);
    api.get<{ data: { items: Withdrawal[] } }>(
      `/api/payroll/withdrawals?status=${status}&userId=${staffFilter}`
    ).then((res) => setWithdrawals(res.data.items))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت درخواست‌ها'));
  };
  const loadStaff = () => {
    api.get<{ data: StaffRow[] }>('/api/payroll/staff').then((res) => setStaff(res.data)).catch(() => undefined);
  };
  const loadReports = () => {
    api.get<{ data: any }>('/api/payroll/reports').then((res) => setReports(res.data)).catch(() => undefined);
  };

  useEffect(() => { setError(''); loadOverview(); loadStaff(); }, []);
  useEffect(() => { if (tab === 'withdrawals') loadWithdrawals(); }, [tab, status, staffFilter]);
  useEffect(() => { if (tab === 'reports') loadReports(); }, [tab]);

  const act = async (row: Withdrawal, action: string, note?: string) => {
    setBusy(row.id);
    try {
      await api.post(`/api/payroll/withdrawals/${row.id}/decision`, { action, note });
      notify('وضعیت درخواست به‌روزرسانی شد.', 'success');
      setRejectModal(null);
      setRejectNote('');
      loadWithdrawals();
      loadOverview();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'عملیات ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const pay = async () => {
    if (!payModal) return;
    setBusy(payModal.id);
    try {
      await api.post(`/api/payroll/withdrawals/${payModal.id}/pay`, { ...payForm, note: payForm.note || undefined });
      notify('پرداخت ثبت شد و در سوابق کارمند نمایش داده می‌شود.', 'success');
      setPayModal(null);
      setPayForm({ method: 'bank_transfer', trackingCode: '', note: '' });
      loadWithdrawals();
      loadOverview();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت پرداخت ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const openFile = async (row: StaffRow) => {
    setFile(null);
    try {
      const res = await api.get<{ data: StaffFile }>(`/api/payroll/staff/${row.id}/file`);
      setFile(res.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'دریافت پرونده ناموفق بود.', 'error');
    }
  };

  const openSalary = async (row: StaffRow) => {
    setSalaryModal(row);
    setSalaryFile(null);
    try {
      const res = await api.get<{ data: any }>(`/api/payroll/salary-payments?userId=${row.id}`);
      setSalaryFile(res.data);
      const month = res.data?.months?.find((item: any) => item.status !== 'paid');
      setSalaryForm({
        periodMonth: month?.period ?? new Date().toISOString().slice(0, 7),
        amount: month?.remaining ?? 0, method: 'bank_transfer', trackingCode: '', note: '',
      });
    } catch { setSalaryFile({ months: [], payments: [] }); }
  };

  const submitSalary = async () => {
    if (!salaryModal) return;
    setBusy('salary');
    try {
      await api.post('/api/payroll/salary-payments', { ...salaryForm, userId: salaryModal.id, note: salaryForm.note || undefined });
      notify('پرداخت حقوق ثبت شد.', 'success');
      setSalaryModal(null);
      loadOverview();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت حقوق ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const submitContract = async () => {
    if (!contractOpen) return;
    setBusy('contract');
    try {
      await api.post('/api/payroll/contracts', {
        userId: contractOpen.id, ...contractForm,
        endsOn: undefined,
        settlementDays: contractForm.settlementPeriod === 'custom' ? contractForm.settlementDays : undefined,
        note: contractForm.note || undefined,
      });
      notify('قرارداد ثبت شد. تغییر درصد فقط روی درآمدهای آینده اثر دارد.', 'success');
      setContractOpen(null);
      loadStaff();
      loadOverview();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت قرارداد ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const tabs = [
    { key: 'withdrawals', label: 'درخواست‌های برداشت', count: overview?.pendingWithdrawals.count },
    { key: 'salaries', label: 'حقوق کارکنان ثابت' },
    { key: 'staff', label: 'پروندهٔ کارکنان' },
    { key: 'reports', label: 'گزارش‌ها' },
  ];

  return (
    <AppShell variant="admin">
      <PageHeader
        title="حقوق و تسویه کارکنان"
        description="درآمد کارکنان درصدی، درخواست‌های برداشت، حقوق کارکنان ثابت و پروندهٔ مالی هر کارمند — همه بر پایهٔ اسناد واقعی سامانه."
        actions={<Button variant="ghost" onClick={() => { loadOverview(); loadWithdrawals(); loadStaff(); }}><RefreshCw className="size-4" /> به‌روزرسانی</Button>}
      />

      {error && <ErrorState message={error} onRetry={loadOverview} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="کارکنان درصدی" value={faNum(overview?.commissionStaff.length ?? 0)} icon={<Coins className="size-5" />} />
        <StatCard label="کارکنان حقوق ثابت" value={faNum(overview?.monthlyStaff.length ?? 0)} icon={<Users className="size-5" />} />
        <StatCard
          label="درخواست برداشت در انتظار"
          value={rial(overview?.pendingWithdrawals.total ?? 0)}
          hint={`${faNum(overview?.pendingWithdrawals.count ?? 0)} درخواست`}
          tone="amber"
          icon={<Banknote className="size-5" />}
        />
        <StatCard label="مجموع برداشت پرداخت‌شده" value={rial(overview?.paidWithdrawals ?? 0)} tone="emerald" icon={<Wallet className="size-5" />} />
      </div>

      <div className="mb-5"><Tabs tabs={tabs} active={tab} onChange={setTab} /></div>

      {tab === 'withdrawals' && (
        <Card>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="وضعیت" className="w-48">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: '', label: 'همه' },
                  { value: 'submitted', label: 'ثبت‌شده' },
                  { value: 'reviewing', label: 'در انتظار بررسی' },
                  { value: 'approved', label: 'تأییدشده' },
                  { value: 'paid', label: 'پرداخت‌شده' },
                  { value: 'rejected', label: 'ردشده' },
                  { value: 'cancelled', label: 'لغوشده' },
                ]}
              />
            </Field>
            <Field label="کارمند" className="w-56">
              <Select
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                options={[{ value: '', label: 'همه کارکنان' }, ...staff.map((row) => ({ value: row.id, label: row.fullName }))]}
              />
            </Field>
          </div>
          {!withdrawals && <Loading rows={3} />}
          {withdrawals?.length === 0 && <EmptyState title="درخواستی با این فیلتر نیست" />}
          {!!withdrawals?.length && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>کارمند</th><th>مبلغ</th><th>ثبت</th><th>دوره</th><th>وضعیت</th><th>اقدام</th></tr>
                </thead>
                <tbody>
                  {withdrawals.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button className="font-medium text-accent hover:underline" onClick={() => setDetail(row)}>{row.staffName ?? '—'}</button>
                        {row.note && <p className="text-[11px] text-navy-500">{row.note}</p>}
                      </td>
                      <td className="font-semibold">{rial(row.amount)}</td>
                      <td>{faDateTime(row.requestedAt)}</td>
                      <td className="text-xs">{row.periodStart ? `${faDate(row.periodStart)} تا ${row.periodEnd ? faDate(row.periodEnd) : '—'}` : '—'}</td>
                      <td>
                        <StatusBadge status={row.status} label={row.statusLabel} />
                        {row.trackingCode && <p className="mt-1 text-[11px] text-navy-500">پیگیری {row.trackingCode}</p>}
                        {row.decisionNote && <p className="mt-1 text-[11px] text-rose-700">{row.decisionNote}</p>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {['submitted'].includes(row.status) && (
                            <Button size="sm" variant="ghost" loading={busy === row.id} onClick={() => act(row, 'review')}>بررسی</Button>
                          )}
                          {['submitted', 'reviewing'].includes(row.status) && (
                            <>
                              <Button size="sm" variant="ghost" loading={busy === row.id} onClick={() => act(row, 'approve')}>تأیید</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRejectModal(row)}>رد</Button>
                            </>
                          )}
                          {row.status === 'approved' && (
                            <Button size="sm" onClick={() => setPayModal(row)}>ثبت پرداخت</Button>
                          )}
                          {row.status === 'paid' && <span className="text-xs text-navy-500">{row.paymentMethod}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'salaries' && (
        <Card>
          <h2 className="mb-4 font-bold text-navy-900">حقوق کارکنان حقوق ثابت</h2>
          <p className="mb-4 text-xs leading-6 text-navy-500">
            محاسبهٔ ماهانه با دکمهٔ «محاسبه ماه» در بخش قرارداد یا از مسیر حسابداری انجام می‌شود؛ سپس پرداخت واقعی اینجا ثبت می‌شود.
          </p>
          {overview?.salary.length === 0 && <EmptyState title="حقوقی محاسبه نشده است" description="ابتدا برای کارکنان حقوق ثابت، ماه مورد نظر را محاسبه کنید." />}
          <div className="table-wrap">
            {!!overview?.salary.length && (
              <table className="table">
                <thead><tr><th>کارمند</th><th>محاسبه‌شده</th><th>پرداخت‌شده</th><th>مانده</th><th>اقدام</th></tr></thead>
                <tbody>
                  {overview?.salary.map((row) => (
                    <tr key={row.userId}>
                      <td className="font-medium">{row.fullName}</td>
                      <td>{rial(row.accrued)}</td>
                      <td>{rial(row.paid)}</td>
                      <td className={row.outstanding > 0 ? 'font-semibold text-amber-700' : ''}>{rial(row.outstanding)}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => {
                          const target = staff.find((item) => item.id === row.userId) ?? { id: row.userId, fullName: row.fullName, roleCode: null, cooperationType: 'monthly' as const };
                          void openSalary(target);
                        }}>ثبت پرداخت حقوق</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {tab === 'staff' && (
        <Card>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="جست‌وجوی کارمند" className="w-64">
              <div className="flex items-center gap-2">
                <Search className="size-4 text-navy-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام کارمند" />
              </div>
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>کارمند</th><th>نوع همکاری</th><th>نقش</th><th>اقدام</th></tr></thead>
              <tbody>
                {staff.filter((row) => !search || row.fullName.includes(search)).map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.fullName}</td>
                    <td>
                      <Badge tone={row.cooperationType === 'commission' ? 'success' : row.cooperationType === 'monthly' ? 'info' : 'default'}>
                        {row.cooperationType === 'commission' ? 'درصدی' : row.cooperationType === 'monthly' ? 'حقوق ثابت' : 'بدون قرارداد'}
                      </Badge>
                    </td>
                    <td className="text-xs text-navy-500">{row.roleCode ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void openFile(row)}><FileText className="size-4" /> پرونده</Button>
                        <Button size="sm" variant="ghost" onClick={() => setContractOpen(row)}>قرارداد</Button>
                        {row.cooperationType === 'monthly' && (
                          <Button size="sm" variant="ghost" onClick={() => void openSalary(row)}>حقوق</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'reports' && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-navy-900">گزارش مالی و عملکرد کارکنان (۳۰ روز اخیر)</h2>
            <a className="btn-ghost btn-sm" href="/api/payroll/reports/export.csv">
              خروجی اکسل (CSV)
            </a>
          </div>
          {!reports && <Loading rows={3} />}
          {reports && (
            <>
              <div className="mb-5 grid gap-4 sm:grid-cols-3">
                <StatCard label="درآمد دفتر (بدون مالیات)" value={rial(reports.office.officeRevenue)} />
                <StatCard label="سهم پرداختی کارکنان" value={rial(reports.office.staffShare)} tone="amber" />
                <StatCard label="وصول‌شده از مشتریان" value={rial(reports.office.collected)} tone="emerald" />
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>کارمند</th><th>نوع همکاری</th><th>خدمات</th><th>مبنای درآمد</th><th>سهم کارمند</th></tr></thead>
                  <tbody>
                    {reports.staff.map((row: any) => (
                      <tr key={row.userId}>
                        <td className="font-medium">{row.fullName}</td>
                        <td>{row.cooperationType === 'commission' ? 'درصدی' : row.cooperationType === 'monthly' ? 'حقوق ثابت' : '—'}</td>
                        <td>{faNum(row.services)}</td>
                        <td>{rial(row.basis)}</td>
                        <td className={row.income < 0 ? 'text-rose-700' : ''}>{rial(row.income)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6">
                <h3 className="mb-2 font-semibold text-navy-900">عملکرد پرونده‌ای و مقایسهٔ کارکنان</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>کارمند</th><th>پرونده‌های دریافتی</th><th>تکمیل‌شده در بازه</th><th>میانگین زمان انجام</th></tr></thead>
                    <tbody>
                      {(reports.performance ?? []).map((row: any) => (
                        <tr key={row.userId}>
                          <td className="font-medium">{row.fullName ?? row.userId}</td>
                          <td>{faNum(row.received)}</td>
                          <td>{faNum(row.completed)}</td>
                          <td>{row.completed > 0 ? `${faNum(row.averageCompletionMinutes)} دقیقه` : '—'}</td>
                        </tr>
                      ))}
                      {(reports.performance ?? []).length === 0 && (
                        <tr><td colSpan={4} className="text-center text-xs text-navy-500">در این بازه پرونده‌ای ثبت نشده است.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-5">
                <h3 className="mb-2 font-semibold text-navy-900">درخواست‌های برداشت</h3>
                <div className="flex flex-wrap gap-2">
                  {reports.withdrawals.map((row: any) => (
                    <span key={row.status} className="badge bg-surface-3 text-navy-700">
                      {row.statusLabel}: {faNum(row.count)} — {rial(row.total)}
                    </span>
                  ))}
                  {reports.withdrawals.length === 0 && <span className="text-xs text-navy-500">در این بازه درخواستی ثبت نشده است.</span>}
                </div>
              </div>
            </>
          )}
        </Card>
      )}

      {/* ------------------------------- detail -------------------------------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="جزئیات درخواست برداشت" size="lg">
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p><span className="text-navy-500">کارمند: </span>{detail.staffName}</p>
              <p><span className="text-navy-500">مبلغ: </span><b>{rial(detail.amount)}</b></p>
              <p><span className="text-navy-500">وضعیت: </span>{detail.statusLabel}</p>
              <p><span className="text-navy-500">ثبت: </span>{faDateTime(detail.requestedAt)}</p>
              {detail.periodStart && <p><span className="text-navy-500">دوره: </span>{faDate(detail.periodStart)} تا {detail.periodEnd ? faDate(detail.periodEnd) : '—'}</p>}
              {detail.trackingCode && <p><span className="text-navy-500">پیگیری: </span>{detail.trackingCode}</p>}
            </div>
            {detail.note && <p className="rounded-xl bg-surface-3 px-3 py-2 text-xs">توضیح کارمند: {detail.note}</p>}
            {detail.decisionNote && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">تصمیم: {detail.decisionNote}</p>}
            <div>
              <h3 className="mb-2 font-semibold">تاریخچهٔ اقدامات</h3>
              <ol className="space-y-2">
                {detail.events?.map((event: any) => (
                  <li key={event.id} className="rounded-xl bg-surface-3 px-3 py-2 text-xs">
                    <span className="font-medium">{event.action}</span> → {event.toStatus ?? '—'}
                    {event.actorName ? ` · ${event.actorName}` : ''} · {faDateTime(event.createdAt)}
                    {event.note ? ` — ${event.note}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------ reject -------------------------------- */}
      <Modal
        open={!!rejectModal}
        onClose={() => setRejectModal(null)}
        title="رد درخواست برداشت"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectModal(null)}>انصراف</Button>
            <Button variant="danger" loading={busy === rejectModal?.id} disabled={rejectNote.trim().length < 3} onClick={() => rejectModal && act(rejectModal, 'reject', rejectNote)}>
              <XCircle className="size-4" /> ثبت رد
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs leading-6 text-navy-500">
          علت رد برای کارمند نمایش داده می‌شود و در تاریخچه ثبت می‌گردد. مبلغ رزروشده آزاد می‌شود.
        </p>
        <Field label="علت رد" required>
          <Input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="مثلاً اطلاعات حساب ناقص است" />
        </Field>
      </Modal>

      {/* -------------------------------- pay --------------------------------- */}
      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title="ثبت پرداخت درخواست برداشت"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayModal(null)}>انصراف</Button>
            <Button
              loading={busy === payModal?.id}
              disabled={payForm.trackingCode.trim().length < 3}
              onClick={pay}
            >
              <CheckCircle2 className="size-4" /> ثبت پرداخت
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="rounded-xl bg-surface-3 px-3 py-2 text-xs">
            مبلغ {rial(payModal?.amount ?? 0)} برای {payModal?.staffName ?? 'کارمند'} — پرداخت فقط پس از واریز واقعی ثبت شود.
          </p>
          <Field label="روش پرداخت" required>
            <Select
              value={payForm.method}
              onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
              options={[
                { value: 'bank_transfer', label: 'انتقال بانکی / شبا' },
                { value: 'cash', label: 'نقدی' },
                { value: 'pos', label: 'کارت‌خوان' },
                { value: 'other', label: 'سایر' },
              ]}
            />
          </Field>
          <Field label="شناسه پیگیری / شماره سند" required>
            <Input value={payForm.trackingCode} onChange={(e) => setPayForm({ ...payForm, trackingCode: e.target.value })} />
          </Field>
          <Field label="توضیح حسابداری">
            <Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* ------------------------------- salary ------------------------------- */}
      <Modal open={!!salaryModal} onClose={() => setSalaryModal(null)} title={`حقوق ${salaryModal?.fullName ?? ''}`} size="lg">
        {!salaryFile ? <Loading rows={2} /> : (
          <div className="space-y-4">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>دوره</th><th>محاسبه</th><th>پرداخت</th><th>مانده</th><th>وضعیت</th></tr></thead>
                <tbody>
                  {salaryFile.months.map((row: any) => (
                    <tr key={row.period}>
                      <td>{row.period}</td>
                      <td>{rial(row.accrued)}</td>
                      <td>{rial(row.paid)}</td>
                      <td>{rial(row.remaining)}</td>
                      <td><Badge tone={row.status === 'paid' ? 'success' : row.status === 'overdue' ? 'danger' : 'warning'}>{row.statusLabel}</Badge></td>
                    </tr>
                  ))}
                  {salaryFile.months.length === 0 && <tr><td colSpan={5} className="text-center text-xs text-navy-500">دوره‌ای محاسبه نشده است</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="دوره (YYYY-MM)" required>
                <Input value={salaryForm.periodMonth} onChange={(e) => setSalaryForm({ ...salaryForm, periodMonth: e.target.value })} />
              </Field>
              <Field label="مبلغ (ریال)" required>
                <Input type="number" min={1} value={salaryForm.amount} onChange={(e) => setSalaryForm({ ...salaryForm, amount: Number(e.target.value) })} />
              </Field>
              <Field label="روش پرداخت" required>
                <Select
                  value={salaryForm.method}
                  onChange={(e) => setSalaryForm({ ...salaryForm, method: e.target.value })}
                  options={[{ value: 'bank_transfer', label: 'انتقال بانکی' }, { value: 'cash', label: 'نقدی' }, { value: 'pos', label: 'کارت‌خوان' }]}
                />
              </Field>
              <Field label="شناسه پیگیری" required>
                <Input value={salaryForm.trackingCode} onChange={(e) => setSalaryForm({ ...salaryForm, trackingCode: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button loading={busy === 'salary'} onClick={submitSalary}><Banknote className="size-4" /> ثبت پرداخت حقوق</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------- contract ----------------------------- */}
      <Modal
        open={!!contractOpen}
        onClose={() => setContractOpen(null)}
        title={`قرارداد ${contractOpen?.fullName ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setContractOpen(null)}>انصراف</Button>
            <Button loading={busy === 'contract'} onClick={submitContract}>ثبت قرارداد</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="نوع همکاری" required>
            <Select
              value={contractForm.kind}
              onChange={(e) => setContractForm({ ...contractForm, kind: e.target.value as any })}
              options={[{ value: 'commission', label: 'درصدی (سهم از درآمد دفتر)' }, { value: 'monthly', label: 'حقوق ثابت ماهانه' }]}
            />
          </Field>
          {contractForm.kind === 'commission' ? (
            <Field label="درصد همکاری" required hint="مثلاً ۱۰ یعنی ۱۰٪ از درآمد دفتر هر خدمت">
              <Input type="number" min={0} max={100} value={contractForm.commissionPercent} onChange={(e) => setContractForm({ ...contractForm, commissionPercent: Number(e.target.value) })} />
            </Field>
          ) : (
            <Field label="حقوق ماهانه (ریال)" required>
              <Input type="number" min={0} value={contractForm.monthlyAmount} onChange={(e) => setContractForm({ ...contractForm, monthlyAmount: Number(e.target.value) })} />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="شروع همکاری" required>
              <Input type="date" value={contractForm.startsOn} onChange={(e) => setContractForm({ ...contractForm, startsOn: e.target.value })} />
            </Field>
            <Field label="دوره تسویه این کارمند">
              <Select
                value={contractForm.settlementPeriod}
                onChange={(e) => setContractForm({ ...contractForm, settlementPeriod: e.target.value as any })}
                options={[
                  { value: 'daily', label: 'روزانه' }, { value: 'weekly', label: 'هفتگی' },
                  { value: 'monthly', label: 'ماهانه' }, { value: 'custom', label: 'دوره اختصاصی' },
                ]}
              />
            </Field>
            {contractForm.settlementPeriod === 'custom' && (
              <Field label="طول دوره (روز)">
                <Input type="number" min={1} max={365} value={contractForm.settlementDays} onChange={(e) => setContractForm({ ...contractForm, settlementDays: Number(e.target.value) })} />
              </Field>
            )}
            <Field label="حداقل برداشت (ریال)" hint="۰ یعنی از تنظیمات کلی استفاده شود">
              <Input type="number" min={0} value={contractForm.minWithdrawal} onChange={(e) => setContractForm({ ...contractForm, minWithdrawal: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="توضیح">
            <Input value={contractForm.note} onChange={(e) => setContractForm({ ...contractForm, note: e.target.value })} />
          </Field>
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-6 text-amber-800">
            قراردادهای هم‌پوشان پذیرفته نمی‌شوند. برای تغییر درصد یا حقوق، ابتدا قرارداد فعلی را در پروندهٔ کارمند ببندید؛
            درآمدهای ثبت‌شدهٔ گذشته با این تغییر بازنویسی نمی‌شوند.
          </p>
        </div>
      </Modal>

      {/* ------------------------------ staff file ---------------------------- */}
      <Modal open={!!file} onClose={() => setFile(null)} title={`پروندهٔ ${file?.staff?.fullName ?? ''}`} size="lg">
        {file && (
          <div className="space-y-5 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p><span className="text-navy-500">نوع همکاری: </span><b>{file.cooperationLabel}</b></p>
              <p><span className="text-navy-500">نقش: </span>{file.staff.roleName ?? '—'}</p>
              <p><span className="text-navy-500">کد پرسنلی: </span>{file.staff.employeeCode ?? '—'}</p>
              <p><span className="text-navy-500">وضعیت: </span>{file.staff.status}</p>
              <p><span className="text-navy-500">شیفت امروز: </span>{file.staff.shift ? `${file.staff.shift.startTime} - ${file.staff.shift.endTime}` : 'بدون شیفت'}</p>
              <p><span className="text-navy-500">قرارداد فعلی: </span>
                {file.contract
                  ? file.contract.kind === 'commission'
                    ? `${faNum(file.contract.commissionPercent)}٪ از ${faDate(file.contract.startsOn)}`
                    : `${rial(file.contract.monthlyAmount)} ماهانه از ${faDate(file.contract.startsOn)}`
                  : 'بدون قرارداد فعال'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-3 px-3 py-2"><p className="text-[11px] text-navy-500">تکمیل‌شده</p><p className="font-semibold">{faNum(file.performance.completed)}</p></div>
              <div className="rounded-xl bg-surface-3 px-3 py-2"><p className="text-[11px] text-navy-500">در حال انجام</p><p className="font-semibold">{faNum(file.performance.inProgress)}</p></div>
              <div className="rounded-xl bg-surface-3 px-3 py-2"><p className="text-[11px] text-navy-500">میانگین زمان انجام</p><p className="font-semibold">{faNum(file.performance.averageCompletionMinutes)} دقیقه</p></div>
            </div>

            {file.cooperationType === 'commission' && file.income && (
              <div>
                <h3 className="mb-2 font-semibold">درآمد و تسویه</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-emerald-50 px-3 py-2"><p className="text-[11px] text-emerald-800">درآمد قطعی</p><p className="font-semibold text-emerald-900">{rial(file.income.definite)}</p></div>
                  <div className="rounded-xl bg-surface-3 px-3 py-2"><p className="text-[11px] text-navy-500">قابل برداشت</p><p className="font-semibold">{rial(file.balance?.available ?? 0)}</p></div>
                  <div className="rounded-xl bg-surface-3 px-3 py-2"><p className="text-[11px] text-navy-500">برداشت‌شده</p><p className="font-semibold">{rial(file.balance?.withdrawn ?? 0)}</p></div>
                </div>
                <div className="mt-3 table-wrap">
                  <table className="table">
                    <thead><tr><th>درخواست</th><th>مبلغ</th><th>وضعیت</th><th>ثبت</th></tr></thead>
                    <tbody>
                      {file.withdrawals.map((row) => (
                        <tr key={row.id}>
                          <td>{row.trackingCode ?? row.id.slice(-6)}</td>
                          <td>{rial(row.amount)}</td>
                          <td>{row.statusLabel}</td>
                          <td>{faDate(row.requestedAt)}</td>
                        </tr>
                      ))}
                      {file.withdrawals.length === 0 && <tr><td colSpan={4} className="text-center text-xs text-navy-500">درخواستی ثبت نشده</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {file.cooperationType !== 'commission' && file.salary && (
              <div>
                <h3 className="mb-2 font-semibold">حقوق ثابت</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-surface-3 px-3 py-2"><p className="text-[11px] text-navy-500">حقوق محاسبه‌شده</p><p className="font-semibold">{rial(file.salary.months.reduce((sum: number, row: any) => sum + row.accrued, 0))}</p></div>
                  <div className="rounded-xl bg-surface-3 px-3 py-2"><p className="text-[11px] text-navy-500">پرداخت‌شده</p><p className="font-semibold">{rial(file.salary.payments.reduce((sum: number, row: any) => sum + row.amount, 0))}</p></div>
                  <div className="rounded-xl bg-amber-50 px-3 py-2"><p className="text-[11px] text-amber-800">معوق</p><p className="font-semibold text-amber-900">{rial(file.salary.outstanding)}</p></div>
                </div>
              </div>
            )}

            <div>
              <h3 className="mb-2 font-semibold">تاریخچهٔ قرارداد</h3>
              <div className="space-y-1">
                {file.contractHistory.map((row) => (
                  <div key={row.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-surface-3 px-3 py-2 text-xs">
                    <span>{row.kind === 'commission' ? 'درصدی' : 'حقوق ثابت'}</span>
                    <span>{row.kind === 'commission' ? `${faNum(row.commissionPercent)}٪` : rial(row.monthlyAmount)}</span>
                    <span>{faDate(row.startsOn)} تا {row.endsOn ? faDate(row.endsOn) : 'اکنون'}</span>
                  </div>
                ))}
              </div>
            </div>

            {file.cooperationType === 'commission' && file.staff?.id && (
              <ServicePercentsEditor staffId={file.staff.id} />
            )}

            <div>
              <h3 className="mb-2 font-semibold">آخرین پرونده‌ها</h3>
              <div className="space-y-1">
                {file.recentRequests.map((row) => (
                  <div key={row.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-surface-3 px-3 py-2 text-xs">
                    <span className="font-medium">{row.serviceTitle}</span>
                    <span>{row.trackingCode}</span>
                    <StatusBadge status={row.status} />
                  </div>
                ))}
                {file.recentRequests.length === 0 && <p className="text-xs text-navy-500">پرونده‌ای ثبت نشده است.</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
