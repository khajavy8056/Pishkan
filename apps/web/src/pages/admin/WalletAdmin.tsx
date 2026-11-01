import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Ban, CheckCircle2, CreditCard, Gift, RefreshCw, Search,
  ShieldAlert, ShieldCheck, Wallet, Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Button, Card, EmptyState, Field, Input, Loading, Modal, Pagination, Select, StatCard, StatusBadge,
  Tabs, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum, rial } from '../../lib/format';

interface CustomerRow {
  id: string; fullName: string; mobile: string; status: string;
  walletId: string | null; balance: number; walletStatus: string;
}

interface WalletTx {
  id: string; type: string; typeLabel: string; direction: 'credit' | 'debit'; amount: number;
  balanceBefore: number; balanceAfter: number; source: string; status: string;
  trackingCode: string; description: string | null; reason: string | null;
  adminName: string | null; paymentId: string | null; requestId: string | null;
  reversesTransactionId: string | null; createdAt: string; customerName?: string;
}

const CREDIT_TYPES = [
  { value: 'admin_credit', label: 'شارژ توسط مدیر' },
  { value: 'gift', label: 'هدیه / اعتبار تشویقی' },
  { value: 'correction', label: 'اصلاحیه مالی' },
];

export function AdminWallet() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState<'customers' | 'transactions'>('customers');
  const [summary, setSummary] = useState<any>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txTotal, setTxTotal] = useState(0);
  const [txType, setTxType] = useState('');
  const [txSource, setTxSource] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditForm, setCreditForm] = useState({ amount: 100000, type: 'admin_credit', reason: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<WalletTx | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [statusTarget, setStatusTarget] = useState<any>(null);
  const [statusForm, setStatusForm] = useState({ status: 'active', reason: '' });

  const pageSize = 20;

  const loadSummary = () => {
    api.get<{ data: any }>('/api/wallet/admin/summary').then((res) => setSummary(res.data))
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در خلاصه کیف پول', 'error'));
  };

  const loadCustomers = () => {
    setLoading(true);
    api.list<CustomerRow>('/api/wallet/admin/customers', { search: search || undefined, page, pageSize })
      .then((res) => { setCustomers(res.data); setTotal(res.total); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در فهرست مشتریان', 'error'))
      .finally(() => setLoading(false));
  };

  const loadTransactions = () => {
    setLoading(true);
    api.list<WalletTx>('/api/wallet/admin/transactions', {
      page: txPage, pageSize, type: txType || undefined, source: txSource || undefined, search: search || undefined,
    }).then((res) => { setTxs(res.data); setTxTotal(res.total); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در تراکنش‌ها', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSummary(); }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tab === 'customers') loadCustomers(); else loadTransactions();
    }, 250);
    return () => clearTimeout(timer);
  }, [tab, search, page, txPage, txType, txSource]);

  const openDetail = async (customer: CustomerRow) => {
    setDetailLoading(true);
    setDetail({ customer });
    try {
      const res = await api.get<{ data: any }>(`/api/wallet/admin/customers/${customer.id}`);
      setDetail(res.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت کیف پول مشتری', 'error');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const reloadDetail = async () => {
    if (!detail?.customer?.id) return;
    const res = await api.get<{ data: any }>(`/api/wallet/admin/customers/${detail.customer.id}`);
    setDetail(res.data);
    loadSummary();
  };

  const credit = async () => {
    if (creditForm.reason.trim().length < 5) { notify('دلیل عملیات حداقل ۵ نویسه است.', 'error'); return; }
    if (!Number.isInteger(Number(creditForm.amount)) || Number(creditForm.amount) <= 0) { notify('مبلغ معتبر نیست.', 'error'); return; }
    setBusy(true);
    try {
      await api.post('/api/wallet/admin/credit', {
        customerId: detail.customer.id,
        amount: Number(creditForm.amount),
        type: creditForm.type,
        reason: creditForm.reason,
        description: creditForm.description || undefined,
      });
      notify('شارژ کیف پول ثبت شد.', 'success');
      setCreditOpen(false);
      await reloadDetail();
      if (tab === 'customers') loadCustomers(); else loadTransactions();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت شارژ ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reverse = async () => {
    if (!reverseTarget) return;
    if (reverseReason.trim().length < 5) { notify('دلیل اصلاحیه حداقل ۵ نویسه است.', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/api/wallet/admin/transactions/${reverseTarget.id}/reverse`, { reason: reverseReason });
      notify('اصلاحیه ثبت شد و ردیف اصلی حفظ شد.', 'success');
      setReverseTarget(null);
      setReverseReason('');
      await reloadDetail();
      loadTransactions();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت اصلاحیه ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async () => {
    if (!statusTarget) return;
    if (statusForm.reason.trim().length < 5) { notify('دلیل تغییر وضعیت الزامی است.', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/api/wallet/admin/customers/${statusTarget.id}/status`, statusForm);
      notify('وضعیت کیف پول تغییر کرد.', 'success');
      setStatusTarget(null);
      setStatusForm({ status: 'active', reason: '' });
      await reloadDetail();
      loadCustomers();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'تغییر وضعیت ناموفق بود', 'error');
    } finally {
      setBusy(false);
    }
  };

  const testTopUp = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ data: any }>('/api/wallet/admin/test-topup', { customerId: detail.customer.id, amount: 50000 });
      notify('تراکنش آزمایشی آغاز شد؛ در شبیه‌ساز درگاه تکمیل کنید.', 'info');
      window.open(res.data.paymentUrl, '_blank', 'noopener');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'آزمون درگاه ممکن نیست', 'error');
    } finally {
      setBusy(false);
    }
  };

  const totals = summary?.totals;
  const integrity = summary?.integrity;
  const gateway = summary?.gateway;
  const stats = useMemo(() => [
    { label: 'مجموع کیف پول مشتریان', value: rial(totals?.wallets?.custody ?? 0), hint: `${faNum(totals?.wallets?.count ?? 0)} کیف پول • ${faNum(totals?.wallets?.withBalance ?? 0)} دارای موجودی`, icon: <Wallet className="size-5" />, tone: 'brand' as const },
    { label: 'شارژ از درگاه', value: rial(totals?.topup ?? 0), hint: 'واریز مشتری، درآمد نیست', icon: <ArrowDownLeft className="size-5" />, tone: 'emerald' as const },
    { label: 'پرداخت خدمات', value: rial(totals?.spent ?? 0), hint: `بازپرداخت: ${rial(totals?.refunded ?? 0)}`, icon: <ArrowUpRight className="size-5" />, tone: 'amber' as const },
    { label: 'شارژ مدیریت و هدیه', value: rial((totals?.adminCredit ?? 0) + (totals?.gift ?? 0)), hint: `اصلاحیه بدهکار: ${rial(totals?.corrections?.debit ?? 0)}`, icon: <Gift className="size-5" />, tone: 'navy' as const },
  ], [totals]);

  return (
    <AppShell variant="admin">
      <PageHeader
        title="مدیریت کیف پول"
        description="دفتر کل کیف پول مشتریان: هر تغییر موجودی یک ردیف ثبت‌شده و قابل حسابرسی دارد و تاریخچه حذف نمی‌شود."
        actions={(
          <Button size="sm" variant="ghost" onClick={() => { loadSummary(); setSearch(search); }}>
            <RefreshCw className="size-4" /> تازه‌سازی
          </Button>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => <StatCard key={item.label} {...item} />)}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card className={clsx('border', integrity?.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/60')}>
          <div className="flex items-start gap-2">
            {integrity?.ok ? <ShieldCheck className="mt-0.5 size-4 text-emerald-700" /> : <ShieldAlert className="mt-0.5 size-4 text-rose-700" />}
            <div className="text-xs leading-6">
              <p className="font-bold text-navy-900">{integrity?.ok ? 'تطابق دفتر کل با موجودی‌ها' : 'اختلاف در دفتر کل'}</p>
              <p className="text-navy-600">
                مجموع موجودی: {rial(integrity?.cachedTotal ?? 0)} • مجموع دفتر کل: {rial(integrity?.ledgerTotal ?? 0)}
                {integrity?.mismatchedCount ? ` • ${faNum(integrity.mismatchedCount)} مورد اختلاف` : ''}
              </p>
            </div>
          </div>
        </Card>
        <Card className="border border-line">
          <div className="flex items-start gap-2">
            <CreditCard className="mt-0.5 size-4 text-accent" />
            <div className="text-xs leading-6">
              <p className="font-bold text-navy-900">درگاه پرداخت: {gateway?.configured ? 'پیکربندی‌شده' : 'پیکربندی‌نشده'}</p>
              <p className="text-navy-600">
                کد درگاه: {gateway?.code ?? '—'} {gateway?.sandbox ? '• حالت شبیه‌ساز' : ''} {gateway?.reason ? `• ${gateway.reason}` : ''}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[{ key: 'customers', label: 'کیف پول مشتریان' }, { key: 'transactions', label: 'همه تراکنش‌ها' }]}
          active={tab}
          onChange={(key) => { setTab(key as any); setPage(1); setTxPage(1); }}
        />
        <div className="flex items-center gap-2 rounded-xl bg-surface-3 px-3">
          <Search className="size-4 text-navy-400" />
          <input value={search} onChange={(e) => { setPage(1); setTxPage(1); setSearch(e.target.value); }}
            placeholder="نام، موبایل، کد ملی یا کد رهگیری…" className="w-60 bg-transparent py-2 text-sm outline-none" />
        </div>
      </div>

      {loading && <Loading />}

      {!loading && tab === 'customers' && (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>مشتری</th><th>موبایل</th><th>موجودی</th><th>وضعیت کیف پول</th><th /></tr></thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="text-xs font-medium text-navy-900">{customer.fullName}</td>
                    <td className="text-xs text-navy-500" dir="ltr">{customer.mobile}</td>
                    <td className="text-xs font-bold text-navy-900">{rial(customer.balance)}</td>
                    <td>
                      <StatusBadge status={customer.walletStatus === 'frozen' ? 'suspended' : customer.walletStatus === 'not_created' ? 'none' : 'active'}
                        label={customer.walletStatus === 'not_created' ? 'بدون کیف پول' : customer.walletStatus === 'frozen' ? 'مسدود' : 'فعال'} />
                    </td>
                    <td className="text-left">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(customer)}>مشاهده و عملیات</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {customers.length === 0 && <EmptyState title="مشتری‌ای یافت نشد" />}
          <div className="p-3"><Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} /></div>
        </Card>
      )}

      {!loading && tab === 'transactions' && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Select value={txType} onChange={(e) => { setTxPage(1); setTxType(e.target.value); }} aria-label="نوع تراکنش"
              options={[{ value: '', label: 'همه انواع' }, ...CREDIT_TYPES, { value: 'topup', label: 'شارژ از درگاه' }, { value: 'purchase', label: 'پرداخت خدمت' }, { value: 'refund', label: 'بازپرداخت' }]} />
            <Select value={txSource} onChange={(e) => { setTxPage(1); setTxSource(e.target.value); }} aria-label="منبع"
              options={[{ value: '', label: 'همه منابع' }, { value: 'gateway', label: 'درگاه' }, { value: 'wallet', label: 'کیف پول' }, { value: 'admin', label: 'مدیر' }, { value: 'system', label: 'سامانه' }]} />
          </div>
          <Card pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>تاریخ</th><th>مشتری</th><th>نوع / منبع</th><th>مبلغ</th><th>مانده</th><th>ثبت‌کننده</th><th>کد رهگیری</th><th /></tr></thead>
                <tbody>
                  {txs.map((tx) => (
                    <tr key={tx.id}>
                      <td className="whitespace-nowrap text-[11px] text-navy-500">{faDateTime(tx.createdAt)}</td>
                      <td className="text-xs text-navy-900">{tx.customerName ?? '—'}</td>
                      <td className="text-[11px] text-navy-600">{tx.typeLabel}<span className="mr-1 text-navy-400">({tx.source})</span></td>
                      <td className={clsx('text-xs font-bold', tx.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700')}>
                        {tx.direction === 'credit' ? '+' : '−'}{rial(tx.amount)}
                      </td>
                      <td className="text-[11px] text-navy-600">{rial(tx.balanceAfter)}</td>
                      <td className="text-[11px] text-navy-500">{tx.adminName ?? 'سامانه'}</td>
                      <td className="text-[10px] text-navy-400" dir="ltr">{tx.trackingCode}</td>
                      <td className="text-left">
                        {can('wallet.adjust') && tx.direction === 'credit' && tx.status === 'completed' && !tx.reversesTransactionId && (
                          <Button size="sm" variant="ghost" onClick={() => setReverseTarget(tx)} aria-label="اصلاحیه">
                            <Wrench className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {txs.length === 0 && <EmptyState title="تراکنشی یافت نشد" />}
            <div className="p-3"><Pagination page={txPage} pageSize={pageSize} total={txTotal} onChange={setTxPage} /></div>
          </Card>
        </>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} size="lg" title="کیف پول مشتری"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>بستن</Button>
            {can('wallet.credit') && (
              <>
                <Button variant="ghost" onClick={() => { setCreditForm({ amount: 100000, type: 'admin_credit', reason: '', description: '' }); setCreditOpen(true); }}>
                  <CreditCard className="size-4" /> شارژ / اصلاحیه
                </Button>
                <Button variant="ghost" onClick={testTopUp} loading={busy}><ShieldCheck className="size-4" /> آزمون درگاه</Button>
              </>
            )}
            {can('wallet.adjust') && detail?.customer && (
              <Button variant="ghost" onClick={() => { setStatusTarget(detail.customer); setStatusForm({ status: detail.wallet?.status === 'frozen' ? 'active' : 'frozen', reason: '' }); }}>
                <Ban className="size-4" /> {detail.wallet?.status === 'frozen' ? 'رفع مسدودی' : 'مسدودسازی'}
              </Button>
            )}
          </>
        )}
      >
        {detailLoading || !detail?.wallet ? <Loading /> : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-3 p-3"><p className="text-[10px] text-navy-500">مشتری</p><p className="text-sm font-bold text-navy-900">{detail.customer.fullName}</p><p className="text-[11px] text-navy-500" dir="ltr">{detail.customer.mobile}</p></div>
              <div className="rounded-xl bg-primary-soft p-3"><p className="text-[10px] text-navy-500">موجودی</p><p className="text-lg font-bold text-navy-900">{rial(detail.wallet.balance)}</p></div>
              <div className="rounded-xl bg-surface-3 p-3"><p className="text-[10px] text-navy-500">وضعیت / تطابق</p><p className="text-sm font-bold text-navy-900">{detail.wallet.status === 'frozen' ? 'مسدود' : 'فعال'}</p><p className="text-[11px] text-navy-500">دفتر کل: {detail.integrity === 'balanced' ? 'هم‌خوان' : 'ناهم‌خوان'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div>شارژ درگاه: <b>{rial(detail.wallet.totals.topup)}</b></div>
              <div>شارژ مدیر: <b>{rial(detail.wallet.totals.adminCredit)}</b></div>
              <div>هدیه: <b>{rial(detail.wallet.totals.gift)}</b></div>
              <div>پرداخت خدمات: <b>{rial(detail.wallet.totals.spent)}</b></div>
              <div>بازپرداخت: <b>{rial(detail.wallet.totals.refunded)}</b></div>
              <div>اصلاحیه‌ها: <b>{rial(detail.wallet.totals.corrections)}</b></div>
            </div>
            <div className="table-wrap max-h-72 overflow-y-auto">
              <table className="table">
                <thead><tr><th>تاریخ</th><th>نوع</th><th>مبلغ</th><th>مانده</th><th>دلیل</th><th>ثبت‌کننده</th></tr></thead>
                <tbody>
                  {detail.transactions.map((tx: WalletTx) => (
                    <tr key={tx.id}>
                      <td className="whitespace-nowrap text-[11px] text-navy-500">{faDateTime(tx.createdAt)}</td>
                      <td className="text-[11px]">{tx.typeLabel}{tx.status !== 'completed' && <span className="mr-1 text-[10px] text-rose-600">({tx.status === 'reversed' ? 'اصلاح‌شده' : tx.status})</span>}</td>
                      <td className={clsx('text-[11px] font-bold', tx.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700')}>{tx.direction === 'credit' ? '+' : '−'}{rial(tx.amount)}</td>
                      <td className="text-[11px] text-navy-600">{rial(tx.balanceAfter)}</td>
                      <td className="max-w-44 text-[10px] text-navy-500">{tx.reason ?? tx.description ?? '—'}</td>
                      <td className="text-[10px] text-navy-500">{tx.adminName ?? 'سامانه'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title="شارژ یا اصلاحیه کیف پول"
        footer={<><Button variant="ghost" onClick={() => setCreditOpen(false)}>انصراف</Button><Button onClick={credit} loading={busy}>ثبت عملیات</Button></>}>
        <div className="space-y-3">
          <div className="rounded-xl bg-amber-50 p-3 text-[11px] leading-6 text-amber-900">
            این عملیات با نام شما، زمان و دلیل در دفتر کل و گزارش حسابرسی ثبت می‌شود و قابل حذف نیست.
            برای اصلاح اشتباه، از «اصلاحیه» روی تراکنش استفاده کنید.
          </div>
          <Field label="نوع عملیات" required>
            <Select value={creditForm.type} onChange={(e) => setCreditForm({ ...creditForm, type: e.target.value })} options={CREDIT_TYPES} />
          </Field>
          <Field label="مبلغ (ریال)" required>
            <Input type="number" min={1} value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: Number(e.target.value) })} dir="ltr" className="text-left" />
          </Field>
          <Field label="دلیل عملیات" required hint="حداقل ۵ نویسه؛ در گزارش‌ها نمایش داده می‌شود.">
            <Textarea value={creditForm.reason} onChange={(e) => setCreditForm({ ...creditForm, reason: e.target.value })} />
          </Field>
          <Field label="توضیح تکمیلی">
            <Input value={creditForm.description} onChange={(e) => setCreditForm({ ...creditForm, description: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal open={Boolean(reverseTarget)} onClose={() => setReverseTarget(null)} title="ثبت اصلاحیه مالی"
        footer={<><Button variant="ghost" onClick={() => setReverseTarget(null)}>انصراف</Button><Button onClick={reverse} loading={busy}>ثبت اصلاحیه</Button></>}>
        {reverseTarget && (
          <div className="space-y-3">
            <p className="rounded-xl bg-surface-3 p-3 text-xs leading-6">
              تراکنش {reverseTarget.typeLabel} به مبلغ {rial(reverseTarget.amount)} برای {reverseTarget.customerName} در {faDateTime(reverseTarget.createdAt)}.
              ردیف اصلی حذف نمی‌شود؛ فقط یک ردیف معکوس ثبت می‌شود.
            </p>
            <Field label="دلیل اصلاحیه" required>
              <Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(statusTarget)} onClose={() => setStatusTarget(null)} title="تغییر وضعیت کیف پول"
        footer={<><Button variant="ghost" onClick={() => setStatusTarget(null)}>انصراف</Button><Button onClick={changeStatus} loading={busy}>ثبت</Button></>}>
        <div className="space-y-3">
          <Field label="وضعیت" required>
            <Select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}
              options={[{ value: 'active', label: 'فعال' }, { value: 'frozen', label: 'مسدود' }]} />
          </Field>
          <Field label="دلیل" required hint="حداقل ۵ نویسه؛ در گزارش حسابرسی ثبت می‌شود.">
            <Textarea value={statusForm.reason} onChange={(e) => setStatusForm({ ...statusForm, reason: e.target.value })} />
          </Field>
          <p className="flex items-center gap-1 text-[11px] text-navy-500"><CheckCircle2 className="size-3.5" /> مسدودسازی فقط مانع برداشت/شارژ می‌شود و تاریخچه را تغییر نمی‌دهد.</p>
        </div>
      </Modal>
    </AppShell>
  );
}
