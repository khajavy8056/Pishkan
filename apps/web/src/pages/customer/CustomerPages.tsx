import { MobileVerification } from '../../components/mobile-verification';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList, Wallet, MessageSquare, User, Sparkles, UploadCloud, Download, CheckCircle2,
  Clock, FileText, Send, Plus, CreditCard, ReceiptText, ShieldCheck, AlertTriangle, Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, StatCard, StatusBadge, Textarea, useToast } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDate, faDateTime, faNum, relative, rial, STATUS_LABELS } from '../../lib/format';
import { useSite, type FormField } from '../../lib/site';
import { DynamicField } from '../public/Services';

/* ------------------------------- dashboard -------------------------------- */

export function CustomerDashboard() {
  const { user } = useAuth();
  const { setting } = useSite();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get<{ data: any }>('/api/dashboard/summary')
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت داشبورد'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <AppShell variant="customer"><Loading rows={4} /></AppShell>;
  if (error) return <AppShell variant="customer"><ErrorState message={error} onRetry={load} /></AppShell>;

  return (
    <AppShell variant="customer">
      <PageHeader
        title={`سلام ${user?.fullName?.split(' ')[0] ?? ''} 👋`}
        description={setting('site.welcome_message')}
        actions={<Link to="/services" className="btn-primary btn-sm"><Plus className="size-4" /> درخواست جدید</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="پرونده‌های در جریان" value={faNum(data.stats.open)} icon={<ClipboardList className="size-5" />} hint={`از ${faNum(data.stats.total)} درخواست`} />
        <StatCard label="تکمیل‌شده" value={faNum(data.stats.completed)} tone="emerald" icon={<CheckCircle2 className="size-5" />} />
        <StatCard label="مانده پرداخت" value={rial(data.stats.outstandingAmount)} tone="amber" icon={<Wallet className="size-5" />} />
        <StatCard label="اعلان خوانده‌نشده" value={faNum(data.unreadNotifications)} tone="rose" icon={<Sparkles className="size-5" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-navy-900">درخواست‌های اخیر</h2>
            <Link to="/app/requests" className="text-xs text-brand-700 hover:underline">همه درخواست‌ها</Link>
          </div>
          {data.recentRequests.length === 0 ? (
            <EmptyState title="هنوز درخواستی ثبت نکرده‌اید" description="از فهرست خدمات، خدمت مورد نظر را انتخاب کنید."
              action={<Link to="/services" className="btn-primary btn-sm">مشاهده خدمات</Link>} />
          ) : (
            <div className="space-y-2">
              {data.recentRequests.map((request: any) => (
                <Link key={request.id} to={`/app/requests/${request.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl bg-navy-50/60 px-4 py-3 transition hover:bg-brand-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{request.serviceTitle}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">کد پیگیری {request.trackingCode} • {faDate(request.createdAt)}</p>
                  </div>
                  <StatusBadge status={request.status} label={request.statusLabel} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-navy-900">اعلان‌ها</h2>
              <Link to="/app/profile" className="text-xs text-brand-700 hover:underline">تنظیمات</Link>
            </div>
            {data.notifications.length === 0 && <p className="text-sm text-navy-400">اعلانی ندارید.</p>}
            <div className="space-y-2">
              {data.notifications.map((n: any) => (
                <div key={n.id} className={clsx('rounded-xl p-3', n.readAt ? 'bg-navy-50/50' : 'bg-brand-50/70')}>
                  <p className="text-sm font-medium text-navy-900">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-navy-500">{n.body}</p>}
                  <p className="mt-1 text-[10px] text-navy-400">{relative(n.createdAt)}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-navy-900">فاکتورهای اخیر</h2>
            {data.invoices.length === 0 && <p className="text-sm text-navy-400">فاکتوری ندارید.</p>}
            <div className="space-y-2">
              {data.invoices.map((invoice: any) => (
                <Link key={invoice.id} to="/app/invoices" className="flex items-center justify-between gap-2 rounded-xl bg-navy-50/60 px-3 py-2.5 hover:bg-brand-50">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-navy-900">{invoice.title}</span>
                    <span className="block text-[10px] text-navy-500">{invoice.number}</span>
                  </span>
                  <span className="shrink-0 text-left">
                    <span className="block text-xs font-semibold text-navy-900">{rial(invoice.total)}</span>
                    <StatusBadge status={invoice.status} />
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { to: '/services', label: 'ثبت درخواست جدید', icon: <Plus className="size-5" /> },
          { to: '/assistant', label: 'پرسیدن از دستیار', icon: <Sparkles className="size-5" /> },
          { to: '/app/messages', label: 'گفت‌وگو با دفتر', icon: <MessageSquare className="size-5" /> },
          { to: '/app/profile', label: 'تکمیل پروفایل', icon: <User className="size-5" /> },
        ].map((action) => (
          <Link key={action.to} to={action.to} className="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">{action.icon}</span>
            <span className="text-sm font-medium text-navy-800">{action.label}</span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

/* -------------------------------- requests -------------------------------- */

export function CustomerRequests() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const group = params.get('group') ?? 'all';
  // `group` is mirrored into the URL so links/back-navigation keep the filter.
  const setGroup = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('group', value);
    setParams(next, { replace: true });
    setPage(1);
  };

  useEffect(() => {
    setLoading(true);
    api.list<any>('/api/requests', { group, page, pageSize: 10 })
      .then((res) => { setItems(res.data); setTotal(res.total); })
      .finally(() => setLoading(false));
  }, [group, page]);

  return (
    <AppShell variant="customer">
      <PageHeader title="درخواست‌های من" description="وضعیت هر پرونده، تاریخچه و مدارک را در یک نگاه ببینید."
        actions={<Link to="/services" className="btn-primary btn-sm"><Plus className="size-4" /> درخواست جدید</Link>} />

      <div className="mb-4 flex gap-1 rounded-xl bg-white p-1 ring-1 ring-navy-900/8 sm:w-fit">
        {[
          { key: 'all', label: 'همه' },
          { key: 'open', label: 'در جریان' },
          { key: 'closed', label: 'بسته‌شده' },
        ].map((tab) => (
          <button key={tab.key} onClick={() => setGroup(tab.key)}
            className={clsx('rounded-lg px-4 py-1.5 text-sm transition', group === tab.key ? 'bg-brand-700 text-white' : 'text-navy-600 hover:bg-navy-50')}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {!loading && items.length === 0 && (
        <EmptyState title="درخواستی در این دسته وجود ندارد" description="می‌توانید از میان خدمات، درخواست جدید ثبت کنید."
          action={<Link to="/services" className="btn-soft btn-sm">انتخاب خدمت</Link>} />
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <Link key={item.id} to={`/app/requests/${item.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-4 transition hover:shadow-lg">
            <div className="min-w-0">
              <p className="font-medium text-navy-900">{item.serviceTitle}</p>
              <p className="mt-0.5 text-xs text-navy-500">
                کد پیگیری {item.trackingCode} • ثبت {faDate(item.createdAt)}
                {item.assigneeName ? ` • کارشناس: ${item.assigneeName}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={item.paymentStatus} />
              <StatusBadge status={item.status} label={item.statusLabel} />
            </div>
          </Link>
        ))}
      </div>

      {total > 10 && (
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
          <span className="text-sm text-navy-500">صفحه {faNum(page)}</span>
          <Button size="sm" variant="ghost" disabled={page * 10 >= total} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
        </div>
      )}
    </AppShell>
  );
}

export function CustomerRequestDetail() {
  const { id } = useParams();
  const { notify } = useToast();
  const [request, setRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [paying, setPaying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = (showLoading = true) => {
    if (showLoading) setLoading(true);
    api.get<{ data: any }>(`/api/requests/${id}`)
      .then((res) => { setRequest(res.data); setError(''); })
      .catch((err) => { if (showLoading) setError(err instanceof ApiFailure ? err.message : 'خطا'); })
      .finally(() => { if (showLoading) setLoading(false); });
  };
  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(false), 20_000);
    const refreshOnFocus = () => { if (document.visibilityState === 'visible') load(false); };
    window.addEventListener('focus', refreshOnFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshOnFocus); };
  }, [id]);

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/api/requests/${id}/notes`, { message: note });
      setNote('');
      notify('یادداشت ثبت شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await api.upload<{ data: { id: string; name: string } }>('/api/files/upload', file, { purpose: 'document' });
      await api.post(`/api/requests/${id}/documents`, { fileId: uploaded.data.id, title: uploaded.data.name });
      notify('مدرک بارگذاری شد و در انتظار بررسی است.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در بارگذاری', 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const pay = async (invoiceId: string) => {
    setPaying(true);
    try {
      const res = await api.post<{ data: any }>(`/api/accounting/my/invoices/${invoiceId}/pay`);
      notify(res.data.message ?? 'درخواست پرداخت ایجاد شد.', 'info');
      if (res.data.paymentUrl) window.location.href = res.data.paymentUrl;
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در شروع پرداخت', 'error');
    } finally {
      setPaying(false);
    }
  };

  const cancel = async () => {
    const reason = window.prompt('دلیل لغو درخواست را وارد کنید:');
    if (!reason) return;
    try {
      await api.post(`/api/requests/${id}/cancel`, { reason });
      notify('درخواست لغو شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  if (loading) return <AppShell variant="customer"><Loading /></AppShell>;
  if (error || !request) return <AppShell variant="customer"><ErrorState message={error || 'درخواست یافت نشد'} onRetry={load} /></AppShell>;

  const steps = request.workflow ?? [];
  const canCancel = ['new', 'assigned', 'waiting_documents', 'waiting_customer'].includes(request.status);

  return (
    <AppShell variant="customer">
      <PageHeader
        title={request.serviceTitle}
        description={`کد پیگیری ${request.trackingCode} — ثبت‌شده در ${faDateTime(request.createdAt)}`}
        backTo="/app/requests"
        actions={
          <div className="flex gap-2">
            <Link to={`/app/messages?request=${request.id}`} className="btn-ghost btn-sm"><MessageSquare className="size-4" /> گفت‌وگو</Link>
            {canCancel && <Button size="sm" variant="danger" onClick={cancel}>لغو درخواست</Button>}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={request.status} label={request.statusLabel} />
                <StatusBadge status={request.paymentStatus} />
                {request.dueAt && <span className="text-xs text-navy-500">مهلت تخمینی: {faDate(request.dueAt)}</span>}
              </div>
              <span className="text-sm font-semibold text-navy-900">{rial(request.total)}</span>
            </div>

            {steps.length > 0 && (
              <div className="mt-5">
                <div className="flex items-center justify-between text-[11px] text-navy-400">
                  <span>مراحل رسیدگی</span>
                  <span>{faNum(Math.min(request.currentStep + 1, steps.length))} از {faNum(steps.length)}</span>
                </div>
                <ol className="mt-2 flex gap-1">
                  {steps.map((step: any, index: number) => (
                    <li key={step.title} className="flex-1">
                      <div className={clsx('h-1.5 rounded-full', index <= request.currentStep ? 'bg-brand-600' : 'bg-navy-100')} title={step.title} />
                      <p className="mt-1.5 line-clamp-1 text-[10px] text-navy-500">{step.title}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-4 font-bold text-navy-900">تاریخچه پرونده</h2>
            <ol className="relative space-y-4 border-r border-navy-100 pr-4">
              {request.events.map((event: any) => (
                <li key={event.id} className="relative">
                  <span className="absolute -right-[21px] top-1.5 size-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                  <p className="text-sm text-navy-800">{event.message}</p>
                  <p className="mt-0.5 text-[11px] text-navy-400">
                    {faDateTime(event.createdAt)} {event.actorName ? `• ${event.actorName}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-navy-900">اطلاعات فرم</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              {Object.entries(request.formData ?? {}).map(([key, value]) => (
                <div key={key} className="rounded-xl bg-navy-50/60 px-3 py-2">
                  <dt className="text-[11px] text-navy-500">{key}</dt>
                  <dd className="mt-0.5 text-sm text-navy-800">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><FileText className="size-4 text-brand-700" /> مدارک</h2>
            <div className="space-y-2">
              {request.documents.map((doc: any) => (
                <div key={doc.id} className="rounded-xl bg-navy-50/60 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-navy-900">{doc.title}</span>
                      <span className="block text-[10px] text-navy-500">{faDate(doc.createdAt)}</span>
                    </span>
                    <StatusBadge status={doc.status} />
                  </div>
                  {doc.reviewNote && <p className="mt-1 text-[11px] text-rose-600">{doc.reviewNote}</p>}
                  <a href={`/api/files/${doc.file.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline">
                    <Download className="size-3" /> مشاهده فایل
                  </a>
                </div>
              ))}
              {request.documents.length === 0 && <p className="text-xs text-navy-400">مدرکی بارگذاری نشده است.</p>}
            </div>

            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button variant="ghost" className="mt-3 w-full" loading={uploading} onClick={() => fileInput.current?.click()}>
              <UploadCloud className="size-4" /> بارگذاری مدرک
            </Button>
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Wallet className="size-4 text-brand-700" /> فاکتورها</h2>
            <div className="space-y-2">
              {request.invoices.map((invoice: any) => (
                <div key={invoice.id} className="rounded-xl bg-navy-50/60 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-navy-900">{invoice.number}</span>
                    <StatusBadge status={invoice.status} />
                  </div>
                  <p className="mt-1 text-sm font-semibold text-navy-900">{rial(invoice.total)}</p>
                  <p className="text-[11px] text-navy-500">پرداخت‌شده: {rial(invoice.paidAmount)}</p>
                  {invoice.status !== 'paid' && invoice.status !== 'void' && (
                    <Button size="sm" className="mt-2 w-full" loading={paying} onClick={() => pay(invoice.id)}>
                      <CreditCard className="size-4" /> پرداخت
                    </Button>
                  )}
                </div>
              ))}
              {request.invoices.length === 0 && <p className="text-xs text-navy-400">فاکتوری صادر نشده است.</p>}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-navy-900">یادداشت به کارشناس</h2>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="سؤال یا توضیح خود را بنویسید…" />
            <Button className="mt-2 w-full" onClick={addNote} disabled={!note.trim()}><Send className="size-4" /> ارسال یادداشت</Button>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------- invoices -------------------------------- */

export function CustomerInvoices() {
  const { notify } = useToast();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/accounting/my/invoices'),
      api.list<any>('/api/accounting/my/payments'),
    ]).then(([inv, pay]) => { setInvoices(inv.data); setPayments(pay.data); }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const pay = async (invoice: any) => {
    try {
      const res = await api.post<{ data: any }>(`/api/accounting/my/invoices/${invoice.id}/pay`);
      notify(res.data.message ?? 'درخواست پرداخت ثبت شد.', 'info');
      if (res.data.paymentUrl) window.location.href = res.data.paymentUrl;
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="customer">
      <PageHeader title="فاکتورها و پرداخت‌ها" description="سابقه مالی و وضعیت تسویه درخواست‌های شما." />

      {loading && <Loading />}
      {!loading && invoices.length === 0 && <EmptyState title="فاکتوری ندارید" description="پس از ثبت درخواست، فاکتور مربوطه در این بخش نمایش داده می‌شود." />}

      <div className="grid gap-4 lg:grid-cols-2">
        {invoices.map((invoice) => (
          <Card key={invoice.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-navy-900">{invoice.title}</p>
                <p className="mt-0.5 text-xs text-navy-500">{invoice.number} • {faDate(invoice.createdAt)}</p>
              </div>
              <StatusBadge status={invoice.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-navy-50/70 p-2">
                <p className="text-[10px] text-navy-500">مبلغ کل</p>
                <p className="mt-0.5 text-xs font-semibold text-navy-900">{rial(invoice.total)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50/70 p-2">
                <p className="text-[10px] text-emerald-700">پرداخت‌شده</p>
                <p className="mt-0.5 text-xs font-semibold text-emerald-800">{rial(invoice.paidAmount)}</p>
              </div>
              <div className="rounded-xl bg-amber-50/70 p-2">
                <p className="text-[10px] text-amber-700">باقی‌مانده</p>
                <p className="mt-0.5 text-xs font-semibold text-amber-800">{rial(invoice.remaining)}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(invoice)}><ReceiptText className="size-4" /> جزئیات</Button>
              {invoice.remaining > 0 && invoice.status !== 'void' && (
                <Button size="sm" onClick={() => pay(invoice)}><CreditCard className="size-4" /> پرداخت آنلاین</Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 font-bold text-navy-900">تراکنش‌ها</h2>
        {payments.length === 0 ? <p className="text-sm text-navy-400">تراکنشی ثبت نشده است.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>تاریخ</th><th>مبلغ</th><th>روش</th><th>وضعیت</th><th>شماره پیگیری</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{faDateTime(payment.createdAt)}</td>
                    <td>{rial(payment.amount)}</td>
                    <td>{STATUS_LABELS[payment.method] ?? payment.method}</td>
                    <td><StatusBadge status={payment.status} /></td>
                    <td className="text-xs text-navy-500">{payment.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={`فاکتور ${selected?.number ?? ''}`}>
        {selected && (
          <div className="space-y-3 text-sm">
            <p><span className="text-navy-500">عنوان:</span> {selected.title}</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>شرح</th><th>تعداد</th><th>مبلغ</th></tr></thead>
                <tbody>
                  {selected.items.map((item: any, index: number) => (
                    <tr key={index}><td>{item.title}</td><td>{faNum(item.qty)}</td><td>{rial(item.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl bg-navy-50/70 p-3">
              <div className="flex justify-between"><span>جمع</span><span>{rial(selected.subtotal)}</span></div>
              <div className="flex justify-between"><span>تخفیف</span><span>{rial(selected.discount)}</span></div>
              <div className="flex justify-between"><span>مالیات</span><span>{rial(selected.tax)}</span></div>
              <div className="mt-1 flex justify-between border-t border-navy-900/10 pt-1 font-bold"><span>مبلغ نهایی</span><span>{rial(selected.total)}</span></div>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

/* ------------------------------- custom offers ---------------------------- */

export function CustomerOffers() {
  const { notify } = useToast();
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<any>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [service, setService] = useState<any>(null);

  const load = () => {
    setLoading(true);
    api.list<any>('/api/catalog/offers').then((res) => setOffers(res.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openAccept = async (offer: any) => {
    setAccepting(offer);
    setValues({});
    try {
      const res = await api.get<{ data: any }>(`/api/public/services/${offer.title ? '' : ''}`).catch(() => null);
      void res;
      const detail = await api.get<{ data: any }>(`/api/catalog/custom-services`);
      const item = detail.data.find((s: any) => s.id === offer.serviceId);
      setService(item ?? null);
    } catch {
      setService(null);
    }
  };

  const accept = async () => {
    if (!accepting) return;
    try {
      const res = await api.post<{ data: any }>(`/api/catalog/offers/${accepting.id}/accept`, { formData: values });
      notify('پیشنهاد پذیرفته شد و گردش کار آغاز شد.', 'success');
      setAccepting(null);
      load();
      if (res.data?.request?.id) window.location.href = `/app/requests/${res.data.request.id}`;
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const decline = async (offer: any) => {
    const reason = window.prompt('دلیل رد پیشنهاد (اختیاری):') ?? '';
    try {
      await api.post(`/api/catalog/offers/${offer.id}/decline`, { reason });
      notify('پیشنهاد رد شد.', 'info');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="customer">
      <PageHeader title="پیشنهادهای خدمت اختصاصی" description="خدماتی که کارشناس دفتر مخصوص شما تعریف کرده است." />
      {loading && <Loading />}
      {!loading && offers.length === 0 && (
        <EmptyState title="پیشنهاد اختصاصی ندارید" description="اگر خدمت مورد نیاز شما در کاتالوگ نیست، با دفتر تماس بگیرید تا پیشنهاد اختصاصی برای شما ثبت شود." />
      )}

      <div className="space-y-3">
        {offers.map((offer) => (
          <Card key={offer.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-navy-900">{offer.title}</p>
                <p className="mt-1 text-xs leading-6 text-navy-500">{offer.description}</p>
                {offer.message && <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">{offer.message}</p>}
                <p className="mt-2 text-[11px] text-navy-400">
                  مبلغ: {rial(offer.amount)} • اعتبار تا {faDate(offer.expiresAt)}
                </p>
              </div>
              <StatusBadge status={offer.expired && offer.status === 'pending' ? 'expired' : offer.status} />
            </div>
            {offer.status === 'pending' && !offer.expired && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => openAccept(offer)}>پذیرش پیشنهاد</Button>
                <Button size="sm" variant="ghost" onClick={() => decline(offer)}>رد پیشنهاد</Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal open={Boolean(accepting)} onClose={() => setAccepting(null)} title="تأیید پیشنهاد خدمت"
        footer={<><Button variant="ghost" onClick={() => setAccepting(null)}>انصراف</Button><Button onClick={accept}>تأیید و شروع</Button></>}>
        <p className="text-sm leading-7 text-navy-700">
          با تأیید این پیشنهاد، فاکتور مربوطه قابل پرداخت می‌شود و گردش کار پرونده آغاز خواهد شد.
        </p>
      </Modal>
    </AppShell>
  );
}

/* -------------------------------- messages -------------------------------- */

export function CustomerMessages() {
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const { notify } = useToast();
  const [threads, setThreads] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadThreads = async () => {
    const res = await api.list<any>('/api/messages/threads');
    setThreads(res.data);
    return res.data;
  };

  const openThread = async (thread: any) => {
    setActive(thread);
    const res = await api.get<{ data: any }>(`/api/messages/threads/${thread.id}`);
    setMessages(res.data.messages);
    setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unread: 0 } : t)));
  };

  useEffect(() => {
    (async () => {
      try {
        let list = await loadThreads();
        if (requestId) {
          const created = await api.post<{ data: any }>('/api/messages/threads', { requestId });
          list = await loadThreads();
          const thread = list.find((t: any) => t.id === created.data.id);
          if (thread) await openThread(thread);
        } else if (list[0]) {
          await openThread(list[0]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [requestId]);

  const send = async () => {
    if (!text.trim() || !active) return;
    setSending(true);
    try {
      await api.post(`/api/messages/threads/${active.id}/messages`, { body: text });
      setText('');
      const res = await api.get<{ data: any }>(`/api/messages/threads/${active.id}`);
      setMessages(res.data.messages);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ارسال پیام', 'error');
    } finally {
      setSending(false);
    }
  };

  const newThread = async () => {
    const subject = window.prompt('موضوع گفت‌وگو:');
    if (!subject) return;
    try {
      const res = await api.post<{ data: any }>('/api/messages/threads', { subject, message: subject });
      const list = await loadThreads();
      const thread = list.find((t: any) => t.id === res.data.id);
      if (thread) await openThread(thread);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="customer">
      <PageHeader title="پیام‌ها" description="گفت‌وگوی عمومی با دفتر و گفت‌وگوی هر پرونده جداگانه نگهداری می‌شود."
        actions={<Button size="sm" variant="ghost" onClick={newThread}><Plus className="size-4" /> گفت‌وگوی جدید</Button>} />

      {loading && <Loading />}
      {!loading && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card pad={false} className="overflow-hidden">
            <div className="border-b border-navy-900/8 px-4 py-3 text-sm font-semibold text-navy-900">گفت‌وگوها</div>
            <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
              {threads.length === 0 && <p className="px-4 py-6 text-sm text-navy-400">گفت‌وگویی ندارید.</p>}
              {threads.map((thread) => (
                <button key={thread.id} onClick={() => openThread(thread)}
                  className={clsx('flex w-full items-start justify-between gap-2 border-b border-navy-900/5 px-4 py-3 text-right transition hover:bg-navy-50',
                    active?.id === thread.id && 'bg-brand-50/60')}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-navy-900">{thread.subject}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-navy-500">{thread.lastMessage ?? ''}</span>
                  </span>
                  {thread.unread > 0 && <span className="badge bg-rose-600 text-white">{faNum(thread.unread)}</span>}
                </button>
              ))}
            </div>
          </Card>

          <Card pad={false} className="flex h-[62vh] flex-col overflow-hidden">
            {!active ? (
              <div className="grid flex-1 place-items-center text-sm text-navy-400">یک گفت‌وگو را انتخاب کنید.</div>
            ) : (
              <>
                <div className="border-b border-navy-900/8 px-4 py-3">
                  <p className="text-sm font-semibold text-navy-900">{active.subject}</p>
                  <p className="text-[11px] text-navy-500">
                    {active.scope === 'request' ? 'مرتبط با پرونده' : 'گفت‌وگوی عمومی'} • وضعیت: {STATUS_LABELS[active.status] ?? active.status}
                  </p>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
                  {messages.map((message) => (
                    <div key={message.id} className={clsx('flex', message.senderRole === 'customer' ? 'justify-start' : 'justify-end')}>
                      <div className={clsx('max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                        message.senderRole === 'customer' ? 'bg-brand-700 text-white' : 'bg-navy-50 text-navy-800')}>
                        <p className="whitespace-pre-wrap">{message.body}</p>
                        <p className={clsx('mt-1 text-[10px]', message.senderRole === 'customer' ? 'text-brand-100' : 'text-navy-400')}>
                          {message.senderName ?? 'دفتر'} • {faDateTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 border-t border-navy-900/8 p-3">
                  <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder="پیام خود را بنویسید…" className="input" aria-label="متن پیام" />
                  <Button onClick={send} loading={sending}><Send className="size-4" /></Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}

/* --------------------------------- profile -------------------------------- */

export function CustomerProfile() {
  const { user, refresh, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [cities, setCities] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ firstName:'',lastName:'',cityId:'', fullName: '', email: '', nationalId: '', address: '', postalCode: '', city: '', province: '', jobTitle: '' });
  const [records, setRecords] = useState<{ key: string; label: string; value: string }[]>([]);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ data: any }>('/api/auth/me').then((res) => {
      const profile=res.data.profileState?.profile ?? {};
      setForm({
        firstName:profile.first_name ?? '',lastName:profile.last_name ?? '',cityId:profile.city_id ?? '',
        fullName: res.data.fullName ?? '', email: res.data.email ?? '', nationalId: res.data.nationalId ?? '',
        address:profile.address ?? '',postalCode:profile.postal_code ?? '',city:profile.city ?? '',province:profile.province ?? '',jobTitle:profile.job_title ?? '',
      });
    });
    api.get<{data:any[]}>('/api/public/cities').then(r=>setCities(r.data)).catch(()=>notify('دریافت فهرست شهرها ناموفق بود.','error'));
    api.get<{ data: any[] }>('/api/customers/me/records').then((res) => setRecords(res.data.map((r) => ({ key: r.key, label: r.label ?? '', value: r.value ?? '' })))).catch(() => undefined);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/api/auth/profile', form);
      await refresh();
      notify('پروفایل ذخیره شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveRecords = async () => {
    try {
      await api.put('/api/customers/me/records', { records });
      notify('اطلاعات پرتکرار ذخیره شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const changePassword = async () => {
    try {
      await api.post('/api/auth/password/change', passwords);
      notify('رمز عبور تغییر کرد. دوباره وارد شوید.', 'success');
      await logout();
      navigate('/login');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="customer">
      <PageHeader title="پروفایل من" description="اطلاعات حساب خود را کامل نگه دارید تا ثبت درخواست‌ها سریع‌تر شود." />

      {user?.profileState?.complete === false && <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">برای ادامه، {user.profileState.missing.join('، ')} را تکمیل کنید. اعتبار قالب کد ملی به معنی احراز هویت رسمی نیست.</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-bold text-navy-900">اطلاعات حساب</h2>
          <MobileVerification />
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="نام" required><Input value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})} autoComplete="given-name" /></Field><Field label="نام خانوادگی" required><Input value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})} autoComplete="family-name" /></Field></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="موبایل" hint="شماره موبایل از طرف پشتیبانی قابل تغییر است.">
                <Input value={user?.mobile ?? ''} disabled dir="ltr" className="text-left" />
              </Field>
              <Field label="کد ملی"><Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} dir="ltr" className="text-left" maxLength={10} /></Field>
            </div>
            <Field label="ایمیل"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" className="text-left" /></Field>
            <Field label="نشانی"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="شهر محل سکونت" required hint="اگر شهر شما در فهرست نیست، از مدیر دفتر بخواهید آن را به مرجع شهرها اضافه کند."><Select value={form.cityId} onChange={e=>setForm({...form,cityId:e.target.value})} options={[{value:'',label:'انتخاب استان و شهر'},...cities.map(c=>({value:c.id,label:`${c.province} · ${c.name}`}))]} /></Field>
              <Field label="کد پستی"><Input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} dir="ltr" className="text-left" maxLength={10} /></Field>
            </div>
            <Button loading={saving} onClick={save}>ذخیره پروفایل</Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-1 font-bold text-navy-900">اطلاعات پرتکرار</h2>
            <p className="mb-3 text-xs leading-6 text-navy-500">
              این مقادیر برای پر کردن سریع فرم‌ها استفاده می‌شوند و اطلاعـات ثبت‌شده در پرونده‌های قبلی را تغییر نمی‌دهند.
            </p>
            <div className="space-y-2">
              {records.map((record, index) => (
                <div key={index} className="flex gap-2">
                  <Input value={record.label} placeholder="عنوان (مثلاً شماره بیمه)"
                    onChange={(e) => setRecords(records.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))} />
                  <Input value={record.value} placeholder="مقدار"
                    onChange={(e) => setRecords(records.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))} />
                  <Button size="sm" variant="ghost" onClick={() => setRecords(records.filter((_, i) => i !== index))} aria-label="حذف">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRecords([...records, { key: `field_${Date.now()}`, label: '', value: '' }])}>
                <Plus className="size-4" /> افزودن
              </Button>
              <Button size="sm" onClick={saveRecords} disabled={records.length === 0}>ذخیره</Button>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><ShieldCheck className="size-4 text-emerald-600" /> امنیت حساب</h2>
            <div className="space-y-3">
              <Field label="رمز عبور فعلی"><Input type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} dir="ltr" className="text-left" /></Field>
              <Field label="رمز عبور جدید" hint="حداقل ۸ کاراکتر شامل حرف و رقم."><Input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} dir="ltr" className="text-left" /></Field>
              <Button variant="ghost" onClick={changePassword} disabled={passwords.newPassword.length < 8}>تغییر رمز عبور</Button>
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-6 text-amber-900">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              اگر رمز عبور ندارید، ورود با کد پیامکی همیشه فعال است (در صورت فعال بودن توسط دفتر).
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 font-bold text-navy-900">وضعیت حساب</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-navy-500">وضعیت</dt><dd><StatusBadge status={user?.status ?? 'active'} /></dd></div>
              <div className="flex justify-between"><dt className="text-navy-500">تأیید موبایل</dt><dd>{user?.mobileVerified ? 'تأیید‌شده' : 'تأیید نشده'}</dd></div>
              <div className="flex justify-between"><dt className="text-navy-500">ورود دومرحله‌ای</dt><dd>{user?.mfaEnabled ? 'فعال' : 'غیرفعال'}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
