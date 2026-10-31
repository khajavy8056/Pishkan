import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowUpRight, CreditCard, ReceiptText, ShieldCheck, Wallet as WalletIcon, RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Pagination, StatCard, StatusBadge, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDateTime, faNum, rial } from '../../lib/format';

interface WalletSummary {
  id: string;
  balance: number;
  currency: string;
  status: string;
  enabled: boolean;
  totals: { topup: number; adminCredit: number; gift: number; spent: number; refunded: number; corrections: number };
  counts: { transactions: number; pendingTopups: number };
  updatedAt: string;
}

interface WalletMeta {
  enabled: boolean;
  allowPayment: boolean;
  minTopUp: number;
  maxTopUp: number;
  maxBalance: number;
  gateway: { code: string; configured: boolean; sandbox: boolean };
  types: { value: string; label: string }[];
}

interface WalletTransaction {
  id: string;
  type: string;
  typeLabel: string;
  direction: 'credit' | 'debit';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  source: string;
  status: string;
  trackingCode: string;
  description: string | null;
  reason: string | null;
  requestId: string | null;
  invoiceId: string | null;
  createdAt: string;
}

const PRESETS = [100_000, 250_000, 500_000, 1_000_000];

export function CustomerWallet() {
  const { notify } = useToast();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [meta, setMeta] = useState<WalletMeta | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState<number>(PRESETS[1]);
  const [busy, setBusy] = useState(false);

  const pageSize = 15;

  const loadSummary = () => {
    Promise.all([api.get<{ data: WalletSummary }>('/api/wallet/my'), api.get<{ data: WalletMeta }>('/api/wallet/meta')])
      .then(([wallet, info]) => { setSummary(wallet.data); setMeta(info.data); })
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت کیف پول'));
  };

  const loadTransactions = () => {
    setLoading(true);
    api.list<WalletTransaction>('/api/wallet/my/transactions', { page, pageSize, type: type || undefined })
      .then((res) => { setTransactions(res.data); setTotal(res.total); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت تراکنش‌ها', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(loadSummary, []);
  useEffect(loadTransactions, [page, type]);

  const startTopUp = async () => {
    if (!Number.isInteger(amount) || amount <= 0) { notify('مبلغ شارژ باید عدد صحیح ریالی باشد.', 'error'); return; }
    setBusy(true);
    try {
      const res = await api.post<{ data: { paymentId: string; paymentUrl: string; sandbox: boolean; message?: string } }>(
        '/api/wallet/my/topup', { amount },
      );
      notify(res.data.message ?? 'در حال انتقال به درگاه پرداخت…', 'info');
      window.location.href = res.data.paymentUrl;
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'شروع شارژ ناموفق بود', 'error');
      setBusy(false);
    }
  };

  if (error) return <AppShell variant="customer"><ErrorState message={error} onRetry={loadSummary} /></AppShell>;
  if (!summary) return <AppShell variant="customer"><Loading rows={4} /></AppShell>;

  const frozen = summary.status !== 'active';

  return (
    <AppShell variant="customer">
      <PageHeader
        title="کیف پول من"
        description="موجودی، شارژ آنلاین و پرداخت هزینه خدمات بدون ورود مکرر اطلاعات بانکی."
        actions={<Button onClick={() => setTopUpOpen(true)} disabled={frozen || !summary.enabled}><CreditCard className="size-4" /> شارژ کیف پول</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="موجودی قابل استفاده" value={rial(summary.balance)} hint={`آخرین به‌روزرسانی ${faDateTime(summary.updatedAt)}`} icon={<WalletIcon className="size-5" />} />
        <StatCard label="مجموع شارژ از درگاه" value={rial(summary.totals.topup)} hint={`${faNum(summary.counts.transactions)} تراکنش ثبت‌شده`} tone="emerald" icon={<ArrowDownLeft className="size-5" />} />
        <StatCard label="پرداخت خدمات" value={rial(summary.totals.spent)} hint="کسر مستقیم از کیف پول" tone="amber" icon={<ArrowUpRight className="size-5" />} />
        <StatCard label="شارژ توسط مدیریت" value={rial(summary.totals.adminCredit)} hint={`هدیه: ${rial(summary.totals.gift)} • اصلاحیه: ${rial(summary.totals.corrections)}`} tone="navy" icon={<ShieldCheck className="size-5" />} />
      </div>

      {!summary.enabled && (
        <Card className="mt-4 border-amber-200 bg-amber-50/70">
          <p className="text-sm text-amber-900">کیف پول در حال حاضر توسط مدیریت غیرفعال شده است؛ پرداخت آنلاین همچنان در دسترس است.</p>
        </Card>
      )}
      {frozen && (
        <Card className="mt-4 border-rose-200 bg-rose-50/70">
          <p className="text-sm text-rose-900">کیف پول شما موقتاً مسدود است. برای رفع محدودیت با پشتیبانی تماس بگیرید.</p>
        </Card>
      )}
      {summary.counts.pendingTopups > 0 && (
        <Card className="mt-4 border-brand-200 bg-primary-soft/60">
          <p className="text-sm text-navy-800">
            {faNum(summary.counts.pendingTopups)} شارژ در انتظار پرداخت دارید. اگر پرداخت را نیمه‌کاره رها کرده‌اید، می‌توانید دوباره تلاش کنید.
          </p>
        </Card>
      )}

      <Card className="mt-6" pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="font-bold text-navy-900">تاریخچه تراکنش‌ها</h2>
            <p className="mt-0.5 text-xs text-navy-500">سابقه مالی قابل حذف نیست؛ هر ردیف با کد رهگیری و مانده قبل/بعد ثبت می‌شود.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={type}
              onChange={(e) => { setPage(1); setType(e.target.value); }}
              aria-label="نوع تراکنش"
              className="input h-9 w-44 text-xs"
            >
              <option value="">همه تراکنش‌ها</option>
              {meta?.types.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={() => { loadSummary(); loadTransactions(); }} aria-label="تازه‌سازی">
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>

        {loading ? <div className="p-4"><Loading /></div> : transactions.length === 0 ? (
          <EmptyState
            title="هنوز تراکنشی ثبت نشده است"
            description="با شارژ کیف پول، اولین تراکنش شما ثبت می‌شود."
            action={<Button size="sm" onClick={() => setTopUpOpen(true)}>شارژ کیف پول</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>تاریخ</th><th>نوع</th><th>مبلغ</th><th>مانده پس از تراکنش</th><th>کد رهگیری</th><th>توضیح</th><th /></tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="whitespace-nowrap text-xs text-navy-500">{faDateTime(tx.createdAt)}</td>
                    <td className="text-xs">
                      <span className="font-medium text-navy-900">{tx.typeLabel}</span>
                      <span className={clsx('mr-1.5 inline-flex items-center gap-0.5 text-[10px]',
                        tx.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700')}>
                        {tx.direction === 'credit' ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
                        {tx.direction === 'credit' ? 'واریز' : 'برداشت'}
                      </span>
                    </td>
                    <td className={clsx('text-xs font-bold', tx.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700')}>
                      {tx.direction === 'credit' ? '+' : '−'}{rial(tx.amount)}
                    </td>
                    <td className="text-xs text-navy-700">{rial(tx.balanceAfter)}</td>
                    <td className="text-[11px] text-navy-500" dir="ltr">{tx.trackingCode}</td>
                    <td className="max-w-56 text-[11px] text-navy-500">
                      {tx.description ?? tx.reason ?? '—'}
                      {tx.status !== 'completed' && <span className="mr-1 inline-flex"><StatusBadge status={tx.status} /></span>}
                    </td>
                    <td className="text-left">
                      {tx.requestId && <Link to={`/app/requests/${tx.requestId}`} className="text-[11px] text-brand-700 hover:underline">پرونده</Link>}
                      {!tx.requestId && tx.invoiceId && <Link to="/app/invoices" className="text-[11px] text-brand-700 hover:underline"><ReceiptText className="inline size-3" /> فاکتور</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > pageSize && (
          <div className="border-t border-line p-3">
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          </div>
        )}
      </Card>

      <Modal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        title="شارژ کیف پول"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setTopUpOpen(false)}>انصراف</Button>
            <Button onClick={startTopUp} loading={busy} disabled={!meta?.gateway.configured}>
              <CreditCard className="size-4" /> انتقال به درگاه پرداخت
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-primary-soft/70 p-3 text-xs leading-6 text-navy-700">
            پس از پرداخت در درگاه، مبلغ به‌صورت خودکار و پس از استعلام سمت سرور به کیف پول شما اضافه می‌شود.
            بازگشت از درگاه بدون تأیید سرور، موجودی را تغییر نمی‌دهد.
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setAmount(value)}
                className={clsx('rounded-xl border px-2 py-2 text-xs font-semibold transition',
                  amount === value ? 'border-brand-700 bg-brand-700 text-white' : 'border-line bg-surface text-navy-700 hover:bg-surface-3')}
              >
                {rial(value)}
              </button>
            ))}
          </div>
          <Field label="مبلغ شارژ (ریال)" required hint={meta ? `حداقل ${rial(meta.minTopUp)} و حداکثر ${rial(meta.maxTopUp)}` : undefined}>
            <Input type="number" min={meta?.minTopUp ?? 10000} max={meta?.maxTopUp ?? undefined} step={1000}
              value={amount} onChange={(e) => setAmount(Number(e.target.value))} dir="ltr" className="text-left" />
          </Field>
          <div className="flex items-center justify-between rounded-xl bg-surface-3 p-3 text-xs">
            <span className="text-navy-500">موجودی پس از شارژ</span>
            <span className="font-bold text-navy-900">{rial((summary.balance ?? 0) + (Number.isFinite(amount) ? amount : 0))}</span>
          </div>
          {!meta?.gateway.configured && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              درگاه پرداخت هنوز پیکربندی نشده است؛ شارژ آنلاین پس از تنظیم درگاه توسط مدیر فعال می‌شود.
            </p>
          )}
          {meta?.gateway.sandbox && (
            <p className="rounded-xl bg-brand-50 p-3 text-xs text-brand-800">
              سامانه در حالت شبیه‌ساز درگاه است؛ هیچ پول واقعی جابه‌جا نمی‌شود.
            </p>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}
