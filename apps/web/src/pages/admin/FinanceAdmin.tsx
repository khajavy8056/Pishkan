import { useEffect, useState } from 'react';
import {
  Plus, Search, Trash2, Download, Receipt, Wallet, TrendingUp, TrendingDown, CheckCircle2,
  RotateCcw, Ban, FileSpreadsheet, BarChart3,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  BarChart, Button, Card, EmptyState, Field, Input, Loading, Modal, Select, StatCard, StatusBadge,
  Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDate, faDateTime, faNum, rial, STATUS_LABELS } from '../../lib/format';

/* --------------------------------- finance -------------------------------- */

export function AdminFinance() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState<'invoices' | 'payments' | 'expenses'>('invoices');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoiceForm, setInvoiceForm] = useState<any>({ customerId: '', title: '', items: [{ title: '', qty: 1, unitPrice: 0 }], discount: 0, taxPercent: 0, notes: '', issue: true });
  const [expenseForm, setExpenseForm] = useState<any>({ title: '', amount: 0, categoryId: '', spentOn: new Date().toISOString().slice(0, 10), method: 'cash', note: '' });
  const [paymentModal, setPaymentModal] = useState<any>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: 0, method: 'cash', reference: '' });

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/accounting/invoices', { search: search || undefined, status: status || undefined, pageSize: 50 }),
      api.list<any>('/api/accounting/payments', { pageSize: 50 }),
      api.list<any>('/api/accounting/expenses', { pageSize: 50 }),
      api.list<any>('/api/accounting/expenses/categories'),
      api.get<{ data: any }>('/api/accounting/reports/summary').catch(() => null),
    ]).then(([inv, pay, exp, cats, sum]) => {
      setInvoices(inv.data); setPayments(pay.data); setExpenses(exp.data);
      setExpenseCategories(cats.data); setSummary(sum?.data ?? null);
    }).catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [search, status]);

  const ensureCustomers = async () => {
    if (customers.length) return;
    const res = await api.list<any>('/api/customers', { pageSize: 200 });
    setCustomers(res.data);
  };

  const openInvoiceModal = async () => {
    await ensureCustomers();
    setInvoiceModal(true);
  };

  const createInvoice = async () => {
    try {
      await api.post('/api/accounting/invoices', {
        ...invoiceForm,
        items: invoiceForm.items.filter((i: any) => i.title && i.unitPrice >= 0),
        discount: Number(invoiceForm.discount),
        taxPercent: Number(invoiceForm.taxPercent),
      });
      notify('فاکتور صادر شد.', 'success');
      setInvoiceModal(false);
      setInvoiceForm({ customerId: '', title: '', items: [{ title: '', qty: 1, unitPrice: 0 }], discount: 0, taxPercent: 0, notes: '', issue: true });
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const voidInvoice = async (invoice: any) => {
    const reason = window.prompt('دلیل لغو فاکتور:');
    if (!reason) return;
    try {
      await api.post(`/api/accounting/invoices/${invoice.id}/void`, { reason });
      notify('فاکتور لغو شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const confirmPayment = async (payment: any) => {
    try {
      await api.post(`/api/accounting/payments/${payment.id}/confirm`, {});
      notify('پرداخت تأیید و به حساب درآمد منظور شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const refundPayment = async (payment: any) => {
    const reason = window.prompt('دلیل بازپرداخت:');
    if (!reason) return;
    try {
      await api.post(`/api/accounting/payments/${payment.id}/refund`, { reason });
      notify('بازپرداخت ثبت شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const registerPayment = async () => {
    if (!paymentModal) return;
    try {
      await api.post('/api/accounting/payments', {
        customerId: paymentModal.customerId,
        invoiceId: paymentModal.id,
        amount: Number(paymentForm.amount),
        method: paymentForm.method,
        reference: paymentForm.reference || undefined,
      });
      notify('پرداخت ثبت شد.', 'success');
      setPaymentModal(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const createExpense = async () => {
    try {
      await api.post('/api/accounting/expenses', {
        ...expenseForm, amount: Number(expenseForm.amount), categoryId: expenseForm.categoryId || undefined,
      });
      notify('هزینه ثبت شد.', 'success');
      setExpenseModal(false);
      setExpenseForm({ title: '', amount: 0, categoryId: '', spentOn: new Date().toISOString().slice(0, 10), method: 'cash', note: '' });
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const exportCsv = (type: 'invoices' | 'payments' | 'expenses') => {
    window.location.href = `/api/accounting/reports/export?type=${type}`;
  };

  return (
    <AppShell variant="admin">
      <PageHeader
        title="حسابداری"
        description="فاکتورها، پرداخت‌ها، هزینه‌ها و گزارش‌های مالی دفتر."
        actions={
          <div className="flex gap-2">
            {can('invoices.create') && <Button size="sm" onClick={openInvoiceModal}><Plus className="size-4" /> فاکتور جدید</Button>}
            {can('expenses.create') && <Button size="sm" variant="ghost" onClick={() => setExpenseModal(true)}>ثبت هزینه</Button>}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="درآمد دریافتی" value={rial(summary?.summary?.revenue ?? 0)} tone="emerald" icon={<TrendingUp className="size-5" />} />
        <StatCard label="مطالبات" value={rial(summary?.summary?.receivable ?? 0)} tone="amber" icon={<Wallet className="size-5" />} />
        <StatCard label="هزینه‌ها" value={rial(summary?.summary?.expenses ?? 0)} tone="rose" icon={<TrendingDown className="size-5" />} />
        <StatCard label="سود عملیاتی" value={rial(summary?.summary?.operatingProfit ?? 0)} tone={(summary?.summary?.operatingProfit ?? 0) >= 0 ? 'emerald' : 'rose'} icon={<BarChart3 className="size-5" />} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1 rounded-xl bg-white p-1 ring-1 ring-navy-900/8 sm:w-fit">
        {[
          { key: 'invoices', label: `فاکتورها (${faNum(invoices.length)})` },
          { key: 'payments', label: `پرداخت‌ها (${faNum(payments.length)})` },
          { key: 'expenses', label: `هزینه‌ها (${faNum(expenses.length)})` },
        ].map((item) => (
          <button key={item.key} onClick={() => setTab(item.key as any)}
            className={clsx('rounded-lg px-4 py-1.5 text-sm transition', tab === item.key ? 'bg-brand-700 text-white' : 'text-navy-600 hover:bg-navy-50')}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <>
          <div className="card my-4 flex flex-col gap-2 p-3 sm:flex-row">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-navy-50 px-3">
              <Search className="size-4 text-navy-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="شماره فاکتور، عنوان یا نام مشتری…" className="w-full bg-transparent py-2 text-sm outline-none" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="وضعیت" className="sm:w-44"
              options={[{ value: '', label: 'همه وضعیت‌ها' }, { value: 'issued', label: 'صادرشده' }, { value: 'partially_paid', label: 'پرداخت جزئی' }, { value: 'paid', label: 'تسویه‌شده' }, { value: 'void', label: 'لغو‌شده' }]} />
            <Button size="sm" variant="ghost" onClick={() => exportCsv('invoices')}><Download className="size-4" /> CSV</Button>
          </div>
          {loading && <Loading />}
          <Card pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>شماره</th><th>مشتری</th><th>عنوان</th><th>مبلغ</th><th>پرداخت‌شده</th><th>وضعیت</th><th>تاریخ</th><th /></tr></thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="text-xs font-medium">{invoice.number}</td>
                      <td className="text-xs">{invoice.customerName}</td>
                      <td className="max-w-52 truncate text-xs text-navy-600">{invoice.title}</td>
                      <td className="text-xs">{rial(invoice.total)}</td>
                      <td className="text-xs">{rial(invoice.paidAmount)}</td>
                      <td><StatusBadge status={invoice.status} /></td>
                      <td className="text-[11px] text-navy-500">{faDate(invoice.createdAt)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {invoice.remaining > 0 && invoice.status !== 'void' && can('payments.create') && (
                            <Button size="sm" variant="ghost" onClick={() => { setPaymentModal(invoice); setPaymentForm({ amount: invoice.remaining, method: 'cash', reference: '' }); }}>
                              پرداخت
                            </Button>
                          )}
                          {invoice.status !== 'void' && invoice.status !== 'paid' && can('invoices.cancel') && (
                            <Button size="sm" variant="ghost" onClick={() => voidInvoice(invoice)} aria-label="لغو"><Ban className="size-3.5" /></Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && invoices.length === 0 && <EmptyState title="فاکتوری یافت نشد" />}
          </Card>
        </>
      )}

      {tab === 'payments' && (
        <>
          <div className="my-4 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => exportCsv('payments')}><Download className="size-4" /> خروجی CSV</Button>
          </div>
          {loading && <Loading />}
          <Card pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>تاریخ</th><th>مبلغ</th><th>روش</th><th>وضعیت</th><th>پیگیری</th><th /></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="text-[11px]">{faDateTime(payment.createdAt)}</td>
                      <td className="text-xs font-medium">{rial(payment.amount)}</td>
                      <td className="text-xs">{STATUS_LABELS[payment.method] ?? payment.method}</td>
                      <td><StatusBadge status={payment.status} /></td>
                      <td dir="ltr" className="text-left text-[11px] text-navy-500">{payment.reference ?? '—'}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {payment.status === 'pending' && can('payments.approve') && (
                            <Button size="sm" variant="ghost" onClick={() => confirmPayment(payment)}><CheckCircle2 className="size-3.5" /> تأیید</Button>
                          )}
                          {['pending', 'confirmed'].includes(payment.status) && can('payments.cancel') && (
                            <Button size="sm" variant="ghost" onClick={() => refundPayment(payment)}><RotateCcw className="size-3.5" /> بازپرداخت</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && payments.length === 0 && <EmptyState title="پرداختی ثبت نشده است" />}
          </Card>
        </>
      )}

      {tab === 'expenses' && (
        <>
          <div className="my-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => exportCsv('expenses')}><Download className="size-4" /> خروجی CSV</Button>
            {can('expenses.create') && <Button size="sm" onClick={() => setExpenseModal(true)}><Plus className="size-4" /> هزینه جدید</Button>}
          </div>
          {loading && <Loading />}
          <Card pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>تاریخ</th><th>عنوان</th><th>دسته</th><th>مبلغ</th><th>روش</th></tr></thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="text-[11px]">{faDate(expense.spentOn)}</td>
                      <td className="text-xs font-medium">{expense.title}</td>
                      <td className="text-xs text-navy-500">{expense.categoryTitle ?? '—'}</td>
                      <td className="text-xs">{rial(expense.amount)}</td>
                      <td className="text-xs">{STATUS_LABELS[expense.method] ?? expense.method ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && expenses.length === 0 && <EmptyState title="هزینه‌ای ثبت نشده است" description="برای محاسبه سود عملیاتی، هزینه‌های دفتر را ثبت کنید." />}
          </Card>
        </>
      )}

      <Modal open={invoiceModal} onClose={() => setInvoiceModal(false)} title="صدور فاکتور" size="lg"
        footer={<><Button variant="ghost" onClick={() => setInvoiceModal(false)}>انصراف</Button><Button onClick={createInvoice} disabled={!invoiceForm.customerId || !invoiceForm.title}>صدور فاکتور</Button></>}>
        <div className="space-y-3">
          <Field label="مشتری" required>
            <Select value={invoiceForm.customerId} onChange={(e) => setInvoiceForm({ ...invoiceForm, customerId: e.target.value })} placeholder="انتخاب مشتری"
              options={customers.map((c) => ({ value: c.id, label: `${c.fullName} — ${c.mobile}` }))} />
          </Field>
          <Field label="عنوان فاکتور" required><Input value={invoiceForm.title} onChange={(e) => setInvoiceForm({ ...invoiceForm, title: e.target.value })} /></Field>
          <div>
            <p className="label">اقلام</p>
            <div className="space-y-2">
              {invoiceForm.items.map((item: any, index: number) => (
                <div key={index} className="flex gap-2">
                  <Input value={item.title} placeholder="شرح خدمت"
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, items: invoiceForm.items.map((i: any, k: number) => (k === index ? { ...i, title: e.target.value } : i)) })} />
                  <Input type="number" value={item.qty} className="w-20"
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, items: invoiceForm.items.map((i: any, k: number) => (k === index ? { ...i, qty: Number(e.target.value) } : i)) })} />
                  <Input type="number" value={item.unitPrice} className="w-32" placeholder="مبلغ واحد"
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, items: invoiceForm.items.map((i: any, k: number) => (k === index ? { ...i, unitPrice: Number(e.target.value) } : i)) })} />
                  <Button size="sm" variant="ghost" onClick={() => setInvoiceForm({ ...invoiceForm, items: invoiceForm.items.filter((_: any, k: number) => k !== index) })}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setInvoiceForm({ ...invoiceForm, items: [...invoiceForm.items, { title: '', qty: 1, unitPrice: 0 }] })}>
              <Plus className="size-3.5" /> افزودن قلم
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تخفیف (ریال)"><Input type="number" value={invoiceForm.discount} onChange={(e) => setInvoiceForm({ ...invoiceForm, discount: Number(e.target.value) })} /></Field>
            <Field label="مالیات (درصد)" hint="در صورت خالی بودن، مقدار پیش‌فرض تنظیمات استفاده می‌شود.">
              <Input type="number" value={invoiceForm.taxPercent} onChange={(e) => setInvoiceForm({ ...invoiceForm, taxPercent: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="توضیحات"><Textarea value={invoiceForm.notes} onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(paymentModal)} onClose={() => setPaymentModal(null)} title="ثبت پرداخت"
        footer={<><Button variant="ghost" onClick={() => setPaymentModal(null)}>انصراف</Button><Button onClick={registerPayment}>ثبت</Button></>}>
        {paymentModal && (
          <div className="space-y-3">
            <p className="rounded-xl bg-navy-50/70 p-3 text-sm">فاکتور {paymentModal.number} — باقی‌مانده {rial(paymentModal.remaining)}</p>
            <Field label="مبلغ (ریال)" required><Input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })} /></Field>
            <Field label="روش">
              <Select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                options={[{ value: 'cash', label: 'نقدی' }, { value: 'pos', label: 'کارت‌خوان' }, { value: 'transfer', label: 'کارت به کارت' }]} />
            </Field>
            <Field label="شماره پیگیری"><Input value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} dir="ltr" className="text-left" /></Field>
          </div>
        )}
      </Modal>

      <Modal open={expenseModal} onClose={() => setExpenseModal(false)} title="ثبت هزینه"
        footer={<><Button variant="ghost" onClick={() => setExpenseModal(false)}>انصراف</Button><Button onClick={createExpense} disabled={!expenseForm.title || Number(expenseForm.amount) <= 0}>ثبت هزینه</Button></>}>
        <div className="space-y-3">
          <Field label="عنوان" required><Input value={expenseForm.title} onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="مبلغ (ریال)" required><Input type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: Number(e.target.value) })} /></Field>
            <Field label="دسته">
              <Select value={expenseForm.categoryId} onChange={(e) => setExpenseForm({ ...expenseForm, categoryId: e.target.value })} placeholder="بدون دسته"
                options={expenseCategories.map((c) => ({ value: c.id, label: c.title }))} />
            </Field>
            <Field label="تاریخ"><Input type="date" value={expenseForm.spentOn} onChange={(e) => setExpenseForm({ ...expenseForm, spentOn: e.target.value })} dir="ltr" /></Field>
            <Field label="روش پرداخت">
              <Select value={expenseForm.method} onChange={(e) => setExpenseForm({ ...expenseForm, method: e.target.value })}
                options={[{ value: 'cash', label: 'نقدی' }, { value: 'pos', label: 'کارت‌خوان' }, { value: 'transfer', label: 'کارت به کارت' }]} />
            </Field>
          </div>
          <Field label="توضیح"><Textarea value={expenseForm.note} onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })} /></Field>
        </div>
      </Modal>
    </AppShell>
  );
}

/* --------------------------------- reports -------------------------------- */

export function AdminReports() {
  const [data, setData] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'summary' | 'service' | 'staff' | 'ledger'>('summary');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ data: any }>('/api/accounting/reports/summary', { from: from || undefined, to: to || undefined }),
      api.list<any>('/api/accounting/reports/transactions', { pageSize: 100 }),
    ]).then(([sum, tx]) => { setData(sum.data); setTransactions(tx.data); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [from, to]);

  return (
    <AppShell variant="admin">
      <PageHeader title="گزارش‌ها" description="گزارش درآمد، تفکیک خدمت و کارمند، و دفتر تراکنش‌ها."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => { window.location.href = '/api/accounting/reports/export?type=invoices'; }}>
              <FileSpreadsheet className="size-4" /> فاکتورها (CSV)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { window.location.href = '/api/accounting/reports/export?type=payments'; }}>
              <Download className="size-4" /> پرداخت‌ها (CSV)
            </Button>
          </div>
        } />

      <div className="card mb-4 flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
        <Field label="از تاریخ" className="flex-1"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" /></Field>
        <Field label="تا تاریخ" className="flex-1"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" /></Field>
        <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>حذف فیلتر</Button>
      </div>

      {loading && <Loading />}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="درآمد خالص" value={rial(data.summary.revenue)} tone="emerald" icon={<Receipt className="size-5" />} />
            <StatCard label="مبلغ فاکتورشده" value={rial(data.summary.invoiced)} icon={<FileSpreadsheet className="size-5" />} />
            <StatCard label="مطالبات" value={rial(data.summary.receivable)} tone="amber" icon={<Wallet className="size-5" />} />
            <StatCard label="سود عملیاتی" value={rial(data.summary.operatingProfit)} tone={data.summary.operatingProfit >= 0 ? 'emerald' : 'rose'} icon={<TrendingUp className="size-5" />} hint={`حاشیه ${faNum(data.summary.margin)}٪`} />
          </div>

          <div className="mt-4 flex gap-1 rounded-xl bg-white p-1 ring-1 ring-navy-900/8 sm:w-fit">
            {[
              { key: 'summary', label: 'روند ماهانه' },
              { key: 'service', label: 'درآمد به تفکیک خدمت' },
              { key: 'staff', label: 'عملکرد کارکنان' },
              { key: 'ledger', label: 'دفتر تراکنش' },
            ].map((item) => (
              <button key={item.key} onClick={() => setTab(item.key as any)}
                className={clsx('rounded-lg px-3 py-1.5 text-xs transition', tab === item.key ? 'bg-brand-700 text-white' : 'text-navy-600 hover:bg-navy-50')}>
                {item.label}
              </button>
            ))}
          </div>

          <Card className="mt-4">
            {tab === 'summary' && (
              <>
                <h2 className="mb-3 font-bold text-navy-900">درآمد ماهانه</h2>
                <BarChart data={data.monthly.map((m: any) => ({ label: m.month, value: m.total }))} />
              </>
            )}
            {tab === 'service' && (
              <>
                <h2 className="mb-3 font-bold text-navy-900">درآمد و سهم دفتر</h2>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>خدمت</th><th>تعداد پرداخت</th><th>درآمد</th></tr></thead>
                    <tbody>
                      {data.byService.map((row: any) => (
                        <tr key={row.title}><td className="text-xs">{row.title}</td><td>{faNum(row.paymentCount)}</td><td className="text-xs font-medium">{rial(row.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.byService.length === 0 && <EmptyState title="داده‌ای در این بازه نیست" />}
              </>
            )}
            {tab === 'staff' && (
              <>
                <h2 className="mb-3 font-bold text-navy-900">درآمد منتسب به کارکنان</h2>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>کارمند</th><th>تعداد پرونده</th><th>درآمد</th></tr></thead>
                    <tbody>
                      {data.byStaff.map((row: any, index: number) => (
                        <tr key={index}><td className="text-xs">{row.name}</td><td>{faNum(row.requestCount)}</td><td className="text-xs font-medium">{rial(row.amount)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.byStaff.length === 0 && <EmptyState title="داده‌ای در این بازه نیست" />}
              </>
            )}
            {tab === 'ledger' && (
              <>
                <h2 className="mb-3 font-bold text-navy-900">دفتر تراکنش‌ها</h2>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>تاریخ</th><th>حساب</th><th>نوع</th><th>مبلغ</th><th>شرح</th></tr></thead>
                    <tbody>
                      {transactions.map((row) => (
                        <tr key={row.id}>
                          <td className="text-[11px]">{faDate(row.date)}</td>
                          <td dir="ltr" className="text-[11px]">{row.account}</td>
                          <td className="text-xs">{row.direction === 'debit' ? 'بدهکار' : 'بستانکار'}</td>
                          <td className="text-xs">{rial(row.amount)}</td>
                          <td className="max-w-72 truncate text-[11px] text-navy-500">{row.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {transactions.length === 0 && <EmptyState title="تراکنشی ثبت نشده است" />}
              </>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}
