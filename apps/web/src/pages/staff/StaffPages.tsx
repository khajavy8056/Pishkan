import { CaseAutomation } from '../shared/Automation';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList, FileText, Clock, AlertTriangle, CheckCircle2, UserPlus, UploadCloud, Send,
  Users, CalendarClock, ArrowRight, Wallet, RefreshCw, LogIn, LogOut, Search, MessageSquare,
  ShieldAlert, Download, BadgeCheck, FileCheck2, XCircle, Landmark, PackageCheck, Paperclip,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import { DocumentViewer, FileSummary, FileThumbnail } from '../../components/documents';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, StatCard,
  StatusBadge, Switch, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDate, faDateTime, faNum, relative, rial, STATUS_LABELS } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { formatDuration, STEP_KIND_LABELS, useSite } from '../../lib/site';

const BUCKET_LABELS: Record<string, string> = {
  action: 'نیازمند اقدام', in_progress: 'در حال انجام', waiting_customer: 'منتظر مشتری',
  waiting_organization: 'منتظر سازمان', followup: 'نیازمند پیگیری', completed: 'تکمیل‌شده', cancelled: 'لغوشده',
};
const BUCKET_TONES: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'default'> = {
  action: 'danger', in_progress: 'info', waiting_customer: 'warning',
  waiting_organization: 'warning', followup: 'warning', completed: 'success', cancelled: 'default',
};
const ASSIGNMENT_SOURCE_LABELS: Record<string, string> = {
  claimed: 'پذیرش از صف آزاد', auto: 'ارجاع خودکار سیستم', forced: 'واگذاری اجباری (گذشتن از موعد)', manual: 'ارجاع مدیریتی',
};

const SERVICE_DURATION_UNITS = [
  { value: 'minute', label: 'دقیقه', factor: 1 },
  { value: 'hour', label: 'ساعت', factor: 60 },
  { value: 'day', label: 'روز', factor: 1440 },
] as const;
const serviceDurationFactor = (unit: string) => SERVICE_DURATION_UNITS.find((item) => item.value === unit)?.factor ?? 1;

/* -------------------------------- workbench ------------------------------- */

/* ------------------------------ requests queue ---------------------------- */

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

export function StaffRequests({ variant = 'staff' }: { variant?: 'staff' | 'admin' }) {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const status = params.get('status') ?? '';
  const group = params.get('group') ?? 'open';
  const mine = params.get('mine') === 'true';
  const unassigned = params.get('unassigned') === 'true';
  const bucket = params.get('bucket') ?? '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      api.list<any>('/api/requests', {
        status: status || undefined,
        bucket: bucket || undefined,
        group: status ? undefined : group,
        mine: mine ? 'true' : undefined,
        unassigned: unassigned ? 'true' : undefined,
        search: search || undefined,
        page,
        pageSize: 15,
      })
        .then((res) => { setItems(res.data); setTotal(res.total); })
        .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت درخواست‌ها'))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [status, group, mine, unassigned, bucket, search, page]);

  return (
    <AppShell variant={variant}>
      <PageHeader title="درخواست‌ها" description="صف پرونده‌ها با فیلتر وضعیت، ارجاع و جست‌وجو."
        actions={<Link to={variant === 'admin' ? '/admin' : '/staff'} className="btn-ghost btn-sm">بازگشت به داشبورد</Link>} />

      <div className="card mb-4 space-y-3 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-3 px-3">
            <Search className="size-4 text-navy-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="جست‌وجو بر اساس کد پیگیری، نام مشتری یا موبایل…"
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
          </div>
          <Select
            aria-label="وضعیت"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
            options={[{ value: '', label: 'همه وضعیت‌ها' }, ...STATUS_OPTIONS]}
            className="sm:w-48"
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            { key: 'group', value: 'open', label: 'در جریان', active: group === 'open' && !status },
            { key: 'group', value: 'closed', label: 'بسته‌شده', active: group === 'closed' && !status },
            { key: 'group', value: 'all', label: 'همه', active: group === 'all' && !status },
          ].map((tab) => (
            <button key={tab.value} onClick={() => { setParam('group', tab.value); setParam('status', ''); }}
              className={clsx('rounded-full px-3 py-1.5 ring-1 transition',
                tab.active ? 'bg-shell text-shell-fg ring-shell' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
              {tab.label}
            </button>
          ))}
          <span className="mx-1 w-px bg-line" />
          <button onClick={() => setParam('mine', mine ? '' : 'true')}
            className={clsx('rounded-full px-3 py-1.5 ring-1 transition',
              mine ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
            فقط پرونده‌های من
          </button>
          <button onClick={() => setParam('unassigned', unassigned ? '' : 'true')}
            className={clsx('rounded-full px-3 py-1.5 ring-1 transition',
              unassigned ? 'bg-amber-600 text-white ring-amber-600' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
            بدون کارشناس
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-navy-500">دستهٔ کاری:</span>
          {[
            { value: '', label: 'همه دسته‌ها' },
            { value: 'action', label: 'نیازمند اقدام' },
            { value: 'in_progress', label: 'در حال انجام' },
            { value: 'waiting_customer', label: 'منتظر مشتری' },
            { value: 'waiting_organization', label: 'منتظر سازمان' },
            { value: 'followup', label: 'نیازمند پیگیری' },
            { value: 'completed', label: 'تکمیل‌شده' },
            { value: 'cancelled', label: 'لغوشده' },
          ].map((tab) => (
            <button key={tab.value || 'all'} onClick={() => {
              setParam('bucket', tab.value);
              setParam('status', '');
              setParam('group', ['completed', 'cancelled'].includes(tab.value) ? 'all' : 'open');
            }}
              className={clsx('rounded-full px-3 py-1.5 ring-1 transition',
                bucket === tab.value ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {loading && <Loading />}
      {!loading && !error && items.length === 0 && <EmptyState title="درخواستی مطابق فیلترها یافت نشد" />}

      <div className="space-y-2">
        {items.map((item) => (
          <Link key={item.id} to={`${variant === 'admin' ? '/admin' : '/staff'}/requests/${item.id}`}
            className="card flex flex-wrap items-center justify-between gap-3 p-4 transition hover:shadow-lg">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-navy-900">{item.serviceTitle}</p>
                {item.priority === 'high' && <Badge tone="danger">فوری</Badge>}
                {item.isCustom && <Badge tone="info">اختصاصی</Badge>}
              </div>
              <p className="mt-1 text-[11px] text-navy-500">
                {item.customerName} • {item.trackingCode} • {faDate(item.createdAt)}
                {item.assigneeName ? ` • کارشناس: ${item.assigneeName}` : ' • بدون کارشناس'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item.earnings && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-200">
                  سهم شما: {rial(item.earnings.amount)}
                  <span className="font-normal text-emerald-700"> ({item.earnings.state === 'finalized' ? 'قطعی' : 'برآوردی'})</span>
                </span>
              )}
              {item.workBucket && <Badge tone={BUCKET_TONES[item.workBucket] ?? 'default'}>{BUCKET_LABELS[item.workBucket] ?? item.workBucket}</Badge>}
              <StatusBadge status={item.paymentStatus} />
              <StatusBadge status={item.status} label={item.statusLabel} />
            </div>
          </Link>
        ))}
      </div>

      {total > 15 && (
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
          <span className="text-sm text-navy-500">صفحه {faNum(page)} از {faNum(Math.ceil(total / 15))}</span>
          <Button size="sm" variant="ghost" disabled={page * 15 >= total} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
        </div>
      )}
    </AppShell>
  );
}

/* ----------------------------- request detail ----------------------------- */

/* --------------------- commission split (manager only) --------------------- */

function CommissionSharesCard({ requestId }: { requestId: string }) {
  const { notify } = useToast();
  const [shares, setShares] = useState<{ userId: string; staffName?: string; sharePercent: number }[]>([]);
  const [locked, setLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [staffOptions, setStaffOptions] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<{ data: any }>(`/api/requests/${requestId}/shares`)
      .then((res) => { setShares(res.data.shares ?? []); setLocked(Boolean(res.data.locked)); })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
    api.list<any>('/api/staff', { pageSize: 200 }).then((res) => setStaffOptions(res.data ?? [])).catch(() => undefined);
  };
  useEffect(load, [requestId]);

  const total = shares.reduce((sum, row) => sum + (Number(row.sharePercent) || 0), 0);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put<{ data: any }>(`/api/requests/${requestId}/shares`, {
        shares: shares.map((row) => ({ userId: row.userId, sharePercent: Number(row.sharePercent) })),
      });
      setShares(res.data.shares ?? []);
      setLocked(Boolean(res.data.locked));
      notify(shares.length ? 'تقسیم سهم درآمد این پرونده ثبت شد.' : 'تقسیم سهم برداشته شد؛ کل سهم برای کارشناس مسئول است.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ثبت تقسیم سهم', 'error');
    } finally { setBusy(false); }
  };

  if (!loaded) return null;

  return (
    <Card>
      <h2 className="mb-1 font-bold text-navy-900">تقسیم سهم درآمد این پرونده</h2>
      <p className="mb-3 text-[11px] leading-6 text-navy-500">
        اگر چند نفر در انجام این خدمت نقش دارند، سهم درصدیِ هرکدام از پورسانت این پرونده را مشخص کنید (جمع باید ۱۰۰٪ شود).
        بدون تقسیم، کل سهم برای کارشناس مسئول پرونده است.
        {locked && <span className="font-bold text-amber-700"> سهم این پرونده قبلاً در دفتر درآمد ثبت شده و دیگر قابل تغییر نیست؛ اصلاح فقط با «اصلاحیه» ممکن است.</span>}
      </p>
      <div className="space-y-2">
        {shares.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select className="min-w-44 flex-1" value={row.userId} disabled={locked}
              onChange={(e) => setShares(shares.map((item, i) => (i === index ? { ...item, userId: e.target.value, staffName: staffOptions.find((st) => st.id === e.target.value)?.fullName } : item)))}
              options={[{ value: '', label: 'انتخاب کارمند' }, ...staffOptions.map((st) => ({ value: st.id, label: st.fullName }))]} />
            <Input type="number" min={1} max={100} className="w-24" dir="ltr" value={row.sharePercent} disabled={locked}
              onChange={(e) => setShares(shares.map((item, i) => (i === index ? { ...item, sharePercent: Number(e.target.value) } : item)))} />
            <span className="text-xs text-navy-500">٪</span>
            {!locked && (
              <Button size="sm" variant="ghost" aria-label="حذف" onClick={() => setShares(shares.filter((_, i) => i !== index))}>
                <XCircle className="size-4 text-rose-600" />
              </Button>
            )}
          </div>
        ))}
        {shares.length === 0 && <p className="text-xs text-navy-400">تقسیمی ثبت نشده است؛ ۱۰۰٪ سهم برای کارشناس مسئول محاسبه می‌شود.</p>}
      </div>
      {!locked && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShares([...shares, { userId: '', sharePercent: shares.length === 0 ? 100 : 0 }])}>افزودن نفر</Button>
          <span className={clsx('text-xs', shares.length === 0 || total === 100 ? 'text-emerald-700' : 'font-bold text-rose-700')}>
            جمع سهم‌ها: {faNum(total)}٪{shares.length > 0 && total !== 100 ? ' (باید ۱۰۰ شود)' : ''}
          </span>
          <Button size="sm" className="ms-auto" loading={busy} disabled={shares.some((row) => !row.userId) || (shares.length > 0 && total !== 100)} onClick={() => void save()}>
            ثبت تقسیم سهم
          </Button>
        </div>
      )}
    </Card>
  );
}

export function RequestDetail({ variant = 'staff' }: { variant?: 'staff' | 'admin' }) {
  const { id } = useParams();
  const { can,user } = useAuth();
  const office=['super_admin','manager','accountant'].includes(user?.roleCode??'');
  const { notify } = useToast();
  const [request, setRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [statusModal, setStatusModal] = useState(false);
  const [deliverModal, setDeliverModal] = useState(false);
  const [deliverSummary, setDeliverSummary] = useState('');
  const [deliverFiles, setDeliverFiles] = useState<{ fileId: string; title: string }[]>([]);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [externalModal, setExternalModal] = useState(false);
  const [externalForm, setExternalForm] = useState({ title: '', amount: 0, note: '' });
  const [deadlineModal, setDeadlineModal] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [assignModal, setAssignModal] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [nextStatus, setNextStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = variant === 'admin' ? '/admin' : '/staff';

  const load = () => {
    setLoading(true);
    api.get<{ data: any }>(`/api/requests/${id}`)
      .then((res) => setRequest(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'درخواست یافت نشد'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const moveStep = async (direction: 1 | -1) => {
    setBusy(true);
    try {
      const res = await api.post<{ data: any }>(`/api/requests/${id}/steps/${direction > 0 ? 'advance' : 'back'}`, {});
      setRequest(res.data);
      notify(direction > 0 ? 'مرحلهٔ پرونده جلو رفت.' : 'به مرحلهٔ قبل برگشتید.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در تغییر مرحله', 'error');
    } finally { setBusy(false); }
  };

  const createExternalInvoice = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ data: any }>(`/api/requests/${id}/external-invoices`, {
        title: externalForm.title.trim(),
        amount: Number(externalForm.amount),
        note: externalForm.note.trim() || undefined,
      });
      setRequest(res.data);
      setExternalModal(false);
      setExternalForm({ title: '', amount: 0, note: '' });
      notify('فاکتور هزینهٔ سازمانی صادر شد و پرونده در انتظار پرداخت مشتری قرار گرفت.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'صدور فاکتور ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  const changeStatus = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/requests/${id}/status`, { status: nextStatus, note: statusNote || undefined });
      notify(`وضعیت به «${STATUS_LABELS[nextStatus] ?? nextStatus}» تغییر کرد.`, 'success');
      setStatusModal(false);
      setStatusNote('');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(false); }
  };

  const uploadDeliverFiles = async (selected: FileList | null) => {
    const chosen = Array.from(selected ?? []);
    if (!chosen.length) return;
    if (deliverFiles.length + chosen.length > 10) { notify('حداکثر ۱۰ فایل مجاز است.', 'error'); return; }
    setDeliverBusy(true);
    const uploaded: { fileId: string; title: string }[] = [];
    try {
      for (const file of chosen) {
        const response = await api.upload<{ data: any }>('/api/files/upload', file, { purpose: 'delivery' });
        uploaded.push({ fileId: response.data.id, title: response.data.name });
      }
      setDeliverFiles((old) => [...old, ...uploaded]);
      notify(`${faNum(uploaded.length)} فایل آمادهٔ تحویل شد.`, 'success');
    } catch (err) {
      setDeliverFiles((old) => [...old, ...uploaded]);
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری فایل ناموفق بود.', 'error');
    } finally { setDeliverBusy(false); }
  };

  const submitDelivery = async () => {
    setDeliverBusy(true);
    try {
      const res = await api.post<{ data: any }>(`/api/requests/${id}/deliver`, {
        files: deliverFiles,
        summary: deliverSummary.trim(),
      });
      notify(res.data.mode === 'approval'
        ? 'نتیجه برای تأیید مدیر ارسال شد؛ پس از تأیید، برای مشتری منتشر می‌شود.'
        : 'پرونده تحویل مشتری شد و با موفقیت به پایان رسید.', 'success');
      setDeliverModal(false);
      setDeliverSummary('');
      setDeliverFiles([]);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت تحویل ناموفق بود.', 'error');
    } finally { setDeliverBusy(false); }
  };

  const openDeadline = () => {
    if (!request?.deadlineAt) setDeadlineInput('');
    else {
      const value = new Date(request.deadlineAt);
      setDeadlineInput(new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    }
    setDeadlineModal(true);
  };

  const saveDeadline = async (deadlineAt: string | null) => {
    setBusy(true);
    try {
      await api.patch(`/api/requests/${id}/deadline`, { deadlineAt });
      notify(deadlineAt ? 'مهلت قطعی ذخیره شد.' : 'مهلت قطعی برداشته شد.', 'success');
      setDeadlineModal(false);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ذخیره مهلت ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  const openAssign = async () => {
    setAssignModal(true);
    try {
      const res = await api.get<{ data: any[] }>(`/api/requests/${id}/candidates`);
      setCandidates(res.data);
    } catch {
      setCandidates([]);
    }
  };

  const assign = async (staffId: string | null) => {
    setBusy(true);
    try {
      await api.patch(`/api/requests/${id}/assign`, { staffId });
      notify(staffId ? 'پرونده ارجاع شد.' : 'ارجاع پرونده برداشته شد.', 'success');
      setAssignModal(false);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(false); }
  };

  const autoAssign = async () => {
    setBusy(true);
    try {
      await api.post(`/api/requests/${id}/auto-assign`);
      notify('ارجاع خودکار انجام شد.', 'success');
      setAssignModal(false);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'کارشناس واجد شرایطی یافت نشد.', 'error');
    } finally { setBusy(false); }
  };

  const reviewDoc = async (docId: string, decision: 'approved' | 'rejected') => {
    const noteText = decision === 'rejected' ? window.prompt('دلیل رد مدرک:') ?? '' : '';
    try {
      await api.post(`/api/requests/${id}/documents/${docId}/review`, { decision, note: noteText || undefined });
      notify(decision === 'approved' ? 'مدرک تأیید شد.' : 'مدرک رد شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const addNote = async (visibleToCustomer: boolean) => {
    if (!note.trim()) return;
    try {
      await api.post(`/api/requests/${id}/notes`, { message: note, visibleToCustomer });
      notify('یادداشت ثبت شد.', 'success');
      setNote('');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const upload = async (file: File) => {
    try {
      const uploaded = await api.upload<{ data: { id: string; name: string } }>('/api/files/upload', file, { purpose: 'document' });
      await api.post(`/api/requests/${id}/documents`, { fileId: uploaded.data.id, title: uploaded.data.name, kind: 'staff' });
      notify('مدرک پیوست شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (loading) return <AppShell variant={variant}><Loading /></AppShell>;
  if (error || !request) return <AppShell variant={variant}><ErrorState message={error || 'درخواست یافت نشد'} onRetry={load} /></AppShell>;

  const allowed = request.allowedStatuses ?? STATUS_OPTIONS.map(s=>s.value).filter(s=>!['ready','completed'].includes(s)||request.canApprove);

  return (
    <AppShell variant={variant}>
      <PageHeader
        title={request.serviceTitle}
        description={`کد پیگیری ${request.trackingCode} • ${request.customerName} • ثبت ${faDateTime(request.createdAt)}`}
        backTo={`${base}/requests`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('requests.edit') && ['assigned', 'in_progress', 'waiting_documents', 'waiting_customer'].includes(request.status) && <Button size="sm" onClick={() => setDeliverModal(true)}><PackageCheck className="size-4" /> تحویل به مشتری</Button>}
            {can('requests.edit')&&<Button size="sm" variant="ghost" onClick={() => { setNextStatus(request.status); setStatusModal(true); }}>تغییر وضعیت</Button>}
            {can('requests.edit')&&<Button size="sm" variant="ghost" onClick={openDeadline}><CalendarClock className="size-4" /> مهلت قطعی</Button>}
            {office&&can('requests.edit')&&<Button size="sm" variant="ghost" onClick={openAssign}><UserPlus className="size-4" /> ارجاع مسئول</Button>}
            <Link to={`${base}/messages?request=${request.id}`} className="btn-ghost btn-sm"><MessageSquare className="size-4" /> گفت‌وگو</Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={request.status} label={request.statusLabel} />
                <StatusBadge status={request.paymentStatus} />
                {request.estimatedCompletionAt && <span className="text-xs text-navy-500">برآورد پایان: {faDate(request.estimatedCompletionAt)}</span>}
                {request.deadlineAt && <span className="text-xs font-medium text-rose-700">مهلت قطعی: {faDate(request.deadlineAt)}</span>}
              </div>
              <span className="text-sm font-bold text-navy-900">{rial(request.total)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {request.workBucket && <Badge tone={BUCKET_TONES[request.workBucket] ?? 'default'}>{BUCKET_LABELS[request.workBucket] ?? request.workBucket}</Badge>}
              {request.assigneeName && <span className="text-xs text-navy-500">مسئول: {request.assigneeName}</span>}
              {request.assignmentSource && <span className="text-[11px] text-navy-400">({ASSIGNMENT_SOURCE_LABELS[request.assignmentSource] ?? request.assignmentSource})</span>}
              {request.nextStepTitle && <span className="text-[11px] text-navy-400">· اقدام بعدی: {request.nextStepTitle}</span>}
            </div>
            {request.earnings && (
              <div className={clsx('mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3 ring-1',
                request.earnings.state === 'finalized' ? 'bg-emerald-50 ring-emerald-200' : 'bg-surface-3 ring-line')}>
                <span className="text-xs font-bold text-navy-800">
                  سهم شما از این پرونده
                  {request.earnings.splitSharePercent
                    ? ` (${faNum(request.earnings.splitSharePercent)}٪ از پورسانت پرونده)`
                    : ` (${faNum(request.earnings.percent)}٪ از درآمد دفتر)`}
                </span>
                <span className="text-base font-black text-emerald-900">{rial(request.earnings.amount)}</span>
                <Badge tone={request.earnings.state === 'finalized' ? 'success' : 'warning'}>
                  {request.earnings.state === 'finalized' ? 'قطعی' : 'برآوردی'}
                </Badge>
                <span className="text-[11px] text-navy-500">
                  {request.earnings.state === 'finalized'
                    ? 'در دفتر درآمد شما ثبت شده است.'
                    : 'پس از پرداخت تأییدشدهٔ مشتری قطعی می‌شود؛ هنوز جزو درآمد قطعی شما نیست.'}
                </span>
              </div>
            )}
            {request.workflow?.length > 0 && (
              <ol className="mt-4 flex gap-1">
                {request.workflow.map((step: any, index: number) => (
                  <li key={`${step.title}-${index}`} className="flex-1">
                    <div className={clsx('h-1.5 rounded-full', index < request.currentStep ? 'bg-emerald-600' : index === request.currentStep ? 'bg-brand-600' : 'bg-navy-100')} />
                    <p className={clsx('mt-1 line-clamp-1 text-[10px]', index === request.currentStep ? 'font-bold text-navy-800' : 'text-navy-500')}>{step.title}</p>
                    <p className="text-[9px] text-navy-400">{STEP_KIND_LABELS[(step.kind ?? 'action') as keyof typeof STEP_KIND_LABELS] ?? ''}</p>
                  </li>
                ))}
              </ol>
            )}
            {can('requests.edit') && request.workflow?.length > 1 && !['completed', 'cancelled', 'rejected'].includes(request.status) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" disabled={busy || request.currentStep <= 0} onClick={() => void moveStep(-1)}>مرحلهٔ قبل</Button>
                {request.currentStep >= request.workflow.length - 1 || request.workflow[request.currentStep]?.kind === 'delivery' ? (
                  <Button size="sm" onClick={() => setDeliverModal(true)}>
                    <PackageCheck className="size-4" /> تحویل به مشتری و پایان کار
                  </Button>
                ) : (
                  <Button size="sm" loading={busy} onClick={() => void moveStep(1)}>
                    <CheckCircle2 className="size-4" />
                    {request.currentStepTitle ? `«${request.currentStepTitle}» انجام شد؛ مرحلهٔ بعد` : 'مرحلهٔ بعد'}
                  </Button>
                )}
                <span className="text-[11px] text-navy-400">جلو بردن مرحله، دستهٔ پرونده و ظرفیت کاری شما را خودکار به‌روز می‌کند.</span>
              </div>
            )}
          </Card>

          <CaseAutomation request={request} onChange={load} />
          {can('payroll.contracts.edit') && <CommissionSharesCard requestId={request.id} />}
          <Card>
            <h2 className="mb-3 font-bold text-navy-900">مدارک پرونده</h2>
            {request.documents.length === 0 && <p className="text-sm text-navy-400">مدرکی پیوست نشده است.</p>}
            <div className="space-y-2">
              {request.documents.map((doc: any) => (
                <div key={doc.id} className="flex gap-3 rounded-xl bg-surface-3 p-3">
                  <FileThumbnail file={doc.file} onOpen={() => setViewer(doc)} />
                  <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy-900">{doc.title}</p>
                      <p className="text-[10px] text-navy-500">
                        {faDate(doc.createdAt)} • {doc.kind === 'staff' ? 'کارکنان' : 'مشتری'}
                        {doc.customerDocumentId ? ' • از مدارک پروفایل' : ''}
                      </p>
                    </div>
                    <StatusBadge status={doc.status} />
                  </div>
                  {doc.reviewNote && <p className="mt-1 text-[11px] text-rose-700">{doc.reviewNote}</p>}
                  <FileSummary file={doc.file} technical />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setViewer(doc)}>
                      <Download className="size-3.5" /> مشاهده
                    </Button>
                    {doc.status === 'pending' && can('documents.approve') && (doc.kind!=='staff'||office) && (
                      <>
                        <button onClick={() => reviewDoc(doc.id, 'approved')} className="btn-sm rounded-lg bg-emerald-600 px-2.5 py-1 text-xs text-white hover:brightness-110">
                          <CheckCircle2 className="inline size-3.5" /> تأیید
                        </button>
                        <button onClick={() => reviewDoc(doc.id, 'rejected')} className="btn-sm rounded-lg bg-rose-600 px-2.5 py-1 text-xs text-white hover:brightness-110">
                          <XCircle className="inline size-3.5" /> رد
                        </button>
                      </>
                    )}
                  </div>
                  </div>
                </div>
              ))}
            </div>
            <input ref={fileInput} type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {can('requests.edit')&&<Button variant="ghost" className="mt-3 w-full" onClick={() => fileInput.current?.click()}>
              <UploadCloud className="size-4" /> پیوست مدرک تکمیلی (نیازمند تأیید)
            </Button>}
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-navy-900">تاریخچه و یادداشت‌ها</h2>
            <ol className="relative space-y-4 border-r border-navy-100 pr-4">
              {request.events.map((event: any) => (
                <li key={event.id} className="relative">
                  <span className="absolute -right-[21px] top-1.5 size-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                  <p className="text-sm text-navy-800">{event.message}</p>
                  <p className="text-[11px] text-navy-400">{faDateTime(event.createdAt)}{event.actorName ? ` • ${event.actorName}` : ''}</p>
                </li>
              ))}
            </ol>
            <div className="mt-4 space-y-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت داخلی یا توضیح برای مشتری…" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => addNote(true)} disabled={!note.trim()}><Send className="size-4" /> ثبت و اطلاع به مشتری</Button>
                <Button size="sm" variant="ghost" onClick={() => addNote(false)} disabled={!note.trim()}>یادداشت داخلی</Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-bold text-navy-900">مشخصات مشتری</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-navy-500">نام</dt><dd className="font-medium">{request.customerName}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-navy-500">موبایل</dt><dd dir="ltr">{request.customerMobile}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-navy-500">کد ملی</dt><dd dir="ltr">{request.customerNationalId ?? '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-navy-500">کارشناس</dt><dd>{request.assigneeName ?? 'بدون کارشناس'}</dd></div>
            </dl>
            {variant === 'admin' && (
              <Link to={`/admin/customers?search=${encodeURIComponent(request.customerMobile ?? '')}`} className="btn-ghost btn-sm mt-3 w-full">
                <Users className="size-4" /> پرونده مشتری
              </Link>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-navy-900">اطلاعات فرم</h2>
            <dl className="space-y-2">
              {Object.entries(request.formData ?? {}).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-surface-3 px-3 py-2">
                  <dt className="text-[10px] text-navy-500">{key}</dt>
                  <dd className="text-xs text-navy-800">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Wallet className="size-4 text-accent" /> مالی پرونده</h2>
            {request.invoices.length === 0 && <p className="text-xs text-navy-400">فاکتوری صادر نشده است.</p>}
            <div className="space-y-2">
              {request.invoices.map((invoice: any) => (
                <div key={invoice.id} className="rounded-xl bg-surface-3 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-navy-900">{invoice.number}</span>
                    <span className="flex items-center gap-1">
                      {invoice.purpose === 'external_cost' && <Badge tone="info">هزینهٔ سازمانی</Badge>}
                      <StatusBadge status={invoice.status} />
                    </span>
                  </div>
                  {invoice.title && <p className="mt-0.5 text-[11px] font-medium text-navy-700">{invoice.title}</p>}
                  <p className="mt-1 text-sm font-semibold text-navy-900">{rial(invoice.total)}</p>
                  <p className="text-[11px] text-navy-500">پرداخت‌شده: {rial(invoice.paidAmount)}</p>
                  {invoice.purpose === 'external_cost' && (
                    <p className="text-[10px] text-navy-400">مبلغ امانی سازمان است؛ جزو درآمد دفتر و پورسانت محاسبه نمی‌شود.</p>
                  )}
                </div>
              ))}
            </div>
            {can('requests.edit') && (request.externalCosts?.enabled || office)
              && !['completed', 'cancelled', 'rejected'].includes(request.status) && (
              <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => setExternalModal(true)}>
                <Landmark className="size-4" /> صدور فاکتور هزینهٔ سازمانی برای مشتری
              </Button>
            )}
            {variant === 'admin' && can('invoices.create') && (
              <Link to="/admin/finance" className="btn-ghost btn-sm mt-3 w-full">مدیریت فاکتورها</Link>
            )}
          </Card>
        </div>
      </div>

      <Modal open={deliverModal} onClose={() => setDeliverModal(false)} title="تحویل نهایی به مشتری"
        footer={<>
          <Button variant="ghost" onClick={() => setDeliverModal(false)}>انصراف</Button>
          <Button loading={deliverBusy}
            disabled={deliverSummary.trim().length < 5 || (Boolean(request.serviceRequiresApproval) && deliverFiles.length === 0)}
            onClick={() => void submitDelivery()}>
            <PackageCheck className="size-4" /> ثبت تحویل نهایی
          </Button>
        </>}>
        <div className="space-y-3">
          {request.serviceRequiresApproval ? (
            <p className="rounded-xl bg-amber-50 p-3 text-[11px] leading-6 text-amber-950 ring-1 ring-amber-200">
              این خدمت از موارد خاص است و تحویل آن نیازمند تأیید مدیر اصلی است؛ توضیحات و فایل‌های شما پس از تأیید مدیر برای مشتری منتشر می‌شود و تا آن زمان نزد مشتری دیده نمی‌شود.
            </p>
          ) : (
            <p className="rounded-xl bg-emerald-50 p-3 text-[11px] leading-6 text-emerald-950 ring-1 ring-emerald-200">
              با ثبت تحویل، توضیحات و فایل‌های نتیجه همان لحظه برای مشتری منتشر می‌شود، پرونده «تکمیل‌شده» می‌شود و برای مشتری اعلان و پیامک ارسال می‌گردد. نیازی به تأیید مدیر نیست.
            </p>
          )}
          <Field label="توضیحات تحویل برای مشتری" required hint="همان چیزی که مشتری باید بداند؛ مثلاً نتیجهٔ کار، نحوهٔ دریافت اصل مدرک یا قدم بعدی.">
            <Textarea value={deliverSummary} onChange={(e) => setDeliverSummary(e.target.value)} maxLength={2000}
              placeholder="مثلاً: گواهی صادر شد و تصویر آن پیوست است؛ اصل مدرک در دفتر آمادهٔ تحویل حضوری است." />
          </Field>
          <Field label={request.serviceRequiresApproval ? 'فایل‌های نتیجه (حداقل یک فایل)' : 'فایل‌های نتیجه (اختیاری)'} hint="PDF یا تصویر؛ حداکثر ۱۰ فایل.">
            <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple disabled={deliverBusy}
              onChange={(e) => { void uploadDeliverFiles(e.target.files); e.target.value = ''; }} />
          </Field>
          {deliverFiles.length > 0 && (
            <ul className="space-y-1.5">
              {deliverFiles.map((file) => (
                <li key={file.fileId} className="flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-2 text-xs text-navy-700">
                  <Paperclip className="size-3.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{file.title}</span>
                  <button type="button" className="shrink-0 text-rose-700" onClick={() => setDeliverFiles((old) => old.filter((item) => item.fileId !== file.fileId))}>حذف</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal open={statusModal} onClose={() => setStatusModal(false)} title="تغییر وضعیت پرونده"
        footer={<><Button variant="ghost" onClick={() => setStatusModal(false)}>انصراف</Button><Button loading={busy} onClick={changeStatus} disabled={!nextStatus}>ثبت تغییر</Button></>}>
        <div className="space-y-3">
          <Field label="وضعیت جدید" required>
            <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} options={allowed.map((value:string) => ({ value, label: STATUS_LABELS[value] ?? value }))} />
          </Field>
          <Field label="توضیح (برای مشتری نمایش داده می‌شود)">
            <Textarea value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="مثلاً: مدارک تأیید شد و پرونده برای ثبت ارسال شد." />
          </Field>
          {['ready', 'completed'].includes(nextStatus) && !can('requests.approve') && (
            <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">برای این وضعیت دسترسی «تأیید درخواست» لازم است.</p>
          )}
        </div>
      </Modal>

      <Modal open={externalModal} onClose={() => setExternalModal(false)} title="صدور فاکتور هزینهٔ سازمانی"
        footer={<><Button variant="ghost" onClick={() => setExternalModal(false)}>انصراف</Button>
          <Button loading={busy} disabled={externalForm.title.trim().length < 3 || Number(externalForm.amount) <= 0} onClick={() => void createExternalInvoice()}>
            صدور و ارسال برای مشتری
          </Button></>}>
        <div className="space-y-3">
          <p className="rounded-xl bg-sky-50 p-3 text-[11px] leading-6 text-sky-950 ring-1 ring-sky-200">
            این مبلغ هزینهٔ سازمان مربوطه است (مثل حق بیمه یا عوارض) و جزو حق‌الزحمهٔ دفتر و پورسانت نیست.
            پس از صدور، پرونده «منتظر مشتری» می‌شود، برای مشتری پیامک می‌رود و در صفحهٔ پرونده‌اش دکمهٔ پرداخت می‌بیند؛
            به‌محض پرداخت، شما خبردار می‌شوید و پرونده به جریان برمی‌گردد.
          </p>
          {(request.externalCosts?.items?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {request.externalCosts.items.map((item: any) => (
                <button key={item.title} type="button"
                  className="rounded-full bg-surface-3 px-3 py-1.5 text-[11px] text-navy-700 ring-1 ring-line transition hover:bg-sky-50"
                  onClick={() => setExternalForm({ ...externalForm, title: item.title, amount: item.amount })}>
                  {item.title} — {rial(item.amount)}
                </button>
              ))}
            </div>
          )}
          <Field label="عنوان هزینه" required>
            <Input value={externalForm.title} onChange={(e) => setExternalForm({ ...externalForm, title: e.target.value })}
              placeholder="مثلاً: حق بیمه تأمین اجتماعی — فروردین ۱۴۰۵" />
          </Field>
          <Field label="مبلغ (ریال)" required hint="دقیقاً همان مبلغی که سامانهٔ سازمان اعلام کرده است.">
            <Input type="number" min={1} dir="ltr" value={externalForm.amount}
              onChange={(e) => setExternalForm({ ...externalForm, amount: Number(e.target.value) })} />
          </Field>
          <Field label="توضیح برای مشتری (اختیاری)">
            <Textarea value={externalForm.note} onChange={(e) => setExternalForm({ ...externalForm, note: e.target.value })}
              placeholder="مثلاً: مبلغ اعلامی سامانهٔ تأمین اجتماعی برای کد ملی شما" />
          </Field>
        </div>
      </Modal>

      <Modal open={deadlineModal} onClose={() => setDeadlineModal(false)} title="تعیین مهلت قطعی"
        footer={<>
          <Button variant="ghost" onClick={() => setDeadlineModal(false)}>انصراف</Button>
          {request.deadlineAt && <Button variant="danger" loading={busy} onClick={() => saveDeadline(null)}>برداشتن مهلت</Button>}
          <Button loading={busy} onClick={() => {
            if (!deadlineInput) { notify('زمان مهلت را انتخاب کنید یا از گزینهٔ برداشتن مهلت استفاده کنید.', 'error'); return; }
            const value = new Date(deadlineInput);
            if (Number.isNaN(value.getTime())) { notify('تاریخ و ساعت معتبر نیست.', 'error'); return; }
            void saveDeadline(value.toISOString());
          }}>ثبت مهلت</Button>
        </>}>
        <div className="space-y-3">
          <Field label="تاریخ و ساعت مهلت قطعی" required>
            <Input type="datetime-local" value={deadlineInput} onChange={(event) => setDeadlineInput(event.target.value)} dir="ltr" />
          </Field>
          {request.estimatedCompletionAt && <p className="rounded-lg bg-surface-3 p-3 text-[11px] leading-6 text-navy-600">برآورد فعلی پایان خدمت: {faDateTime(request.estimatedCompletionAt)}. این مقدار جدا از مهلت قطعی عملیات است.</p>}
        </div>
      </Modal>

      <Modal open={assignModal} onClose={() => setAssignModal(false)} title="ارجاع پرونده"
        footer={<><Button variant="ghost" onClick={() => setAssignModal(false)}>بستن</Button><Button loading={busy} onClick={autoAssign}><RefreshCw className="size-4" /> ارجاع خودکار</Button></>}>
        <p className="mb-2 text-xs leading-6 text-navy-500">
          کارشناسان واجد شرایط بر اساس تخصص خدمت، شیفت فعال و ظرفیت کاری فهرست شده‌اند.
        </p>
        {request.assigneeName && (
          <button onClick={() => assign(null)} className="mb-2 w-full rounded-xl bg-rose-50 px-3 py-2 text-right text-xs text-rose-700 hover:bg-rose-100">
            برداشتن ارجاع فعلی ({request.assigneeName})
          </button>
        )}
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <button key={candidate.id} onClick={() => assign(candidate.id)} disabled={busy}
              className="flex w-full items-center justify-between rounded-xl bg-surface-3 px-3 py-2.5 text-right hover:bg-brand-50">
              <span className="text-sm font-medium text-navy-900">{candidate.name}</span>
              <span className="text-[11px] text-navy-500">بار کاری {faNum(candidate.load)} {candidate.onShift ? '• در شیفت' : ''}</span>
            </button>
          ))}
          {candidates.length === 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900">
              کارشناس واجد شرایطی با ظرفیت آزاد پیدا نشد. پرونده در صف انتظار باقی می‌ماند و با آزاد شدن ظرفیت قابل ارجاع است.
            </p>
          )}
        </div>
      </Modal>

      <DocumentViewer file={viewer?.file ?? null} title={viewer?.title ?? 'مدرک'} open={Boolean(viewer)} onClose={() => setViewer(null)} technical />
    </AppShell>
  );
}

/* ----------------------------- documents queue ---------------------------- */

export function StaffDocuments() {
  const { notify } = useToast();
  const { can } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyMine, setOnlyMine] = useState(false);
  const [viewer, setViewer] = useState<any>(null);

  const load = () => {
    setLoading(true);
    api.list<any>('/api/requests/pending-documents', { mine: onlyMine ? 'true' : undefined })
      .then((res) => setItems(res.data))
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [onlyMine]);

  const review = async (doc: any, decision: 'approved' | 'rejected') => {
    const note = decision === 'rejected' ? window.prompt('دلیل رد مدرک (حداقل ۳ نویسه):') : '';
    if (decision === 'rejected' && (note ?? '').trim().length < 3) {
      if (note !== null) notify('برای رد مدرک دلیل حداقل سه‌حرفی لازم است.', 'error');
      return;
    }
    const path = doc.recordType === 'profile'
      ? `/api/documents/${doc.id}/review`
      : `/api/requests/${doc.requestId}/documents/${doc.id}/review`;
    try {
      await api.post(path, { decision, note: note?.trim() || undefined });
      notify(decision === 'approved' ? 'مدرک تأیید شد.' : 'مدرک رد شد و دلیل برای مشتری ثبت شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="staff">
      <PageHeader title="بررسی مدارک" description="مدارک پرونده و پروفایل مشتری که در انتظار بررسی و ثبت تصمیم هستند."
        actions={<Button size="sm" variant={onlyMine ? 'primary' : 'ghost'} onClick={() => setOnlyMine((v) => !v)}>فقط پرونده‌های من</Button>} />
      {loading && <Loading />}
      {!loading && items.length === 0 && <EmptyState title="مدرکی در انتظار بررسی نیست" description="به‌محض بارگذاری مدرک جدید، در این فهرست نمایش داده می‌شود." />}
      <div className="space-y-3">
        {items.map((doc) => (
          <Card key={doc.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <FileThumbnail file={doc.file} onOpen={() => setViewer(doc)} />
                <div className="min-w-0">
                  <p className="font-medium text-navy-900">{doc.title}</p>
                  <p className="mt-0.5 text-xs text-navy-500">
                    {doc.customerName} • {doc.recordType === 'profile' ? `مدرک پروفایل${doc.docTypeLabel ? ` (${doc.docTypeLabel})` : ''}` : `${doc.serviceTitle} • ${doc.trackingCode}`} • {relative(doc.createdAt)}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-navy-400" dir="ltr">{doc.file.name}</p>
                  <FileSummary file={doc.file} technical />
                  {doc.file.processing?.status === 'failed' && (
                    <p className="mt-1 text-[11px] text-amber-700">پردازش تصویر انجام نشد؛ نسخه اصلی حفظ شده است.</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setViewer(doc)}><Download className="size-3.5" /> مشاهده</Button>
                {doc.requestId && <Link to={`/staff/requests/${doc.requestId}`} className="btn-ghost btn-sm"><ArrowRight className="size-3.5" /> پرونده</Link>}
                {can('documents.approve') && <>
                  <Button size="sm" onClick={() => review(doc, 'approved')}>تأیید</Button>
                  <Button size="sm" variant="danger" onClick={() => review(doc, 'rejected')}>رد</Button>
                </>}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <DocumentViewer file={viewer?.file ?? null} title={viewer?.title ?? 'مدرک'} open={Boolean(viewer)} onClose={() => setViewer(null)} technical />
    </AppShell>
  );
}

/* -------------------------------- customers ------------------------------- */

export function StaffCustomers() {
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [profileViewer, setProfileViewer] = useState<any>(null);
  const [form, setForm] = useState({ fullName: '', mobile: '', nationalId: '', email: '', password: '' });
  const { notify } = useToast();
  const { user } = useAuth();
  const can = (permission: string) => user?.permissions === '*' || Boolean(user?.permissions?.includes(permission));

  const reviewProfile = async (document: any, decision: 'approved' | 'rejected') => {
    const noteText = decision === 'rejected' ? window.prompt('دلیل رد مدرک پروفایل (حداقل ۳ نویسه):') : '';
    if (decision === 'rejected' && (noteText ?? '').trim().length < 3) {
      if (noteText !== null) notify('برای رد مدرک دلیل حداقل سه‌حرفی لازم است.', 'error');
      return;
    }
    try {
      await api.post(`/api/documents/${document.id}/review`, { decision, note: noteText || undefined });
      notify(decision === 'approved' ? 'مدرک پروفایل تأیید شد.' : 'مدرک پروفایل رد شد.', 'success');
      const res = await api.get<{ data: any }>(`/api/customers/${selected.id}`);
      setSelected(res.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      api.list<any>('/api/customers', { search: search || undefined })
        .then((res) => setItems(res.data))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const open = async (customer: any) => {
    const res = await api.get<{ data: any }>(`/api/customers/${customer.id}`);
    setSelected(res.data);
  };

  const create = async () => {
    try {
      await api.post('/api/customers', form);
      notify('مشتری جدید ایجاد شد.', 'success');
      setCreating(false);
      setForm({ fullName: '', mobile: '', nationalId: '', email: '', password: '' });
      setSearch('');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="staff">
      <PageHeader title="مشتریان" description="جست‌وجوی مشتری، مشاهده پرونده‌ها و ایجاد حساب جدید."
        actions={<Button size="sm" onClick={() => setCreating(true)}><UserPlus className="size-4" /> مشتری جدید</Button>} />

      <div className="card mb-4 flex items-center gap-2 p-3">
        <Search className="size-4 text-navy-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، موبایل یا کد ملی…" className="w-full bg-transparent py-1.5 text-sm outline-none" />
      </div>

      {loading && <Loading />}
      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>نام</th><th>موبایل</th><th>وضعیت</th><th>تعداد پرونده</th><th>بدهی</th><th /></tr></thead>
            <tbody>
              {items.map((customer) => (
                <tr key={customer.id}>
                  <td className="font-medium text-navy-900">{customer.fullName}</td>
                  <td dir="ltr" className="text-left">{customer.mobile}</td>
                  <td><StatusBadge status={customer.status} /></td>
                  <td>{faNum(customer.requestCount)}</td>
                  <td className={customer.outstanding > 0 ? 'text-rose-700' : 'text-navy-400'}>{rial(customer.outstanding)}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => open(customer)}>مشاهده</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && <EmptyState title="مشتری یافت نشد" />}
      </div>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.fullName ?? ''}>
        {selected && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-3 p-2"><dt className="text-[10px] text-navy-500">موبایل</dt><dd dir="ltr">{selected.mobile}</dd></div>
              <div className="rounded-lg bg-surface-3 p-2"><dt className="text-[10px] text-navy-500">کد ملی</dt><dd dir="ltr">{selected.nationalId ?? '—'}</dd></div>
              <div className="rounded-lg bg-surface-3 p-2"><dt className="text-[10px] text-navy-500">شهر</dt><dd>{selected.profile?.city ?? '—'}</dd></div>
              <div className="rounded-lg bg-surface-3 p-2"><dt className="text-[10px] text-navy-500">آخرین ورود</dt><dd>{selected.lastLoginAt ? faDateTime(selected.lastLoginAt) : '—'}</dd></div>
            </dl>
            <div>
              <p className="mb-1 text-xs font-semibold text-navy-800">پرونده‌ها</p>
              {selected.requests.length === 0 && <p className="text-xs text-navy-400">پرونده‌ای ندارد.</p>}
              <div className="space-y-1">
                {selected.requests.map((request: any) => (
                  <div key={request.id} className="flex items-center justify-between rounded-lg bg-surface-3 px-2 py-1.5 text-xs">
                    <span>{request.serviceTitle} — {request.trackingCode}</span>
                    <StatusBadge status={request.status} label={request.statusLabel} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-navy-800">مدارک پروفایل</p>
              {(selected.profileDocuments ?? []).length === 0 && <p className="text-xs text-navy-400">مدرکی در پروفایل ثبت نشده است.</p>}
              <div className="space-y-1">
                {(selected.profileDocuments ?? []).map((document: any) => (
                  <div key={document.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-3 px-2 py-1.5 text-xs">
                    <button type="button" className="flex min-w-0 items-center gap-2 text-right" onClick={() => setProfileViewer(document)}>
                      <FileThumbnail file={document.file} className="h-10 w-8" />
                      <span className="min-w-0">
                        <span className="block truncate">{document.docTypeLabel}</span>
                        <span className="block text-[10px] text-navy-500">
                          {document.expiresAt ? `اعتبار تا ${faDate(document.expiresAt)}` : 'بدون تاریخ انقضا'}
                        </span>
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-1">
                      <StatusBadge status={document.status} />
                      {document.status === 'pending' && can('documents.approve') && (
                        <>
                          <button onClick={() => reviewProfile(document, 'approved')} className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] text-white">تأیید</button>
                          <button onClick={() => reviewProfile(document, 'rejected')} className="rounded-lg bg-rose-600 px-2 py-1 text-[10px] text-white">رد</button>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-navy-800">فاکتورها</p>
              {selected.invoices.length === 0 && <p className="text-xs text-navy-400">فاکتوری ندارد.</p>}
              <div className="space-y-1">
                {selected.invoices.map((invoice: any) => (
                  <div key={invoice.id} className="flex items-center justify-between rounded-lg bg-surface-3 px-2 py-1.5 text-xs">
                    <span>{invoice.number} — {rial(invoice.total)}</span>
                    <StatusBadge status={invoice.status} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <DocumentViewer
        file={profileViewer?.file ?? null}
        title={profileViewer?.docTypeLabel ?? 'مدرک پروفایل'}
        open={Boolean(profileViewer)}
        onClose={() => setProfileViewer(null)}
        technical
      />

      <Modal open={creating} onClose={() => setCreating(false)} title="ایجاد حساب مشتری"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>انصراف</Button><Button onClick={create} disabled={form.fullName.length < 3 || form.mobile.length < 10}>ایجاد</Button></>}>
        <div className="space-y-3">
          <Field label="نام و نام خانوادگی" required><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="موبایل" required><Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} dir="ltr" className="text-left" /></Field>
          <Field label="کد ملی"><Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} dir="ltr" className="text-left" maxLength={10} /></Field>
          <Field label="ایمیل"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" className="text-left" /></Field>
          <Field label="رمز عبور اولیه (اختیاری)" hint="در صورت خالی بودن، مشتری با کد پیامکی وارد می‌شود.">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" className="text-left" />
          </Field>
        </div>
      </Modal>
    </AppShell>
  );
}

/* --------------------------- custom (private) service --------------------- */

export function StaffCustomService() {
  const { notify } = useToast();
  const [customers, setCustomers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const emptyForm = {
    customerId: '', title: '', description: '', baseFee: 0, estimatedMinutes: 4320, durationUnit: 'day',
    message: '', expiryHours: 72, documents: '', steps: '', assignment: 'pool', customRequestId: '',
    hasExternalCosts: false,
  };
  const [form, setForm] = useState(emptyForm);
  const [intakes, setIntakes] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/customers', { pageSize: 200 }),
      api.list<any>('/api/catalog/custom-services'),
      api.list<any>('/api/catalog/custom-requests').catch(() => ({ data: [] as any[] })),
    ]).then(([cust, svc, intakeRes]) => { setCustomers(cust.data); setServices(svc.data); setIntakes(intakeRes.data); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const priceIntake = (intake: any) => {
    setForm({
      ...emptyForm,
      customerId: intake.customerId,
      title: intake.title,
      description: intake.description,
      customRequestId: intake.id,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    notify('فرم با مشخصات درخواست مشتری پر شد؛ قیمت و جزئیات را کامل کنید.', 'info');
  };

  const rejectIntake = async (intake: any) => {
    const note = window.prompt('دلیل رد برای مشتری نوشته می‌شود:');
    if (!note || note.trim().length < 3) return;
    try {
      await api.post(`/api/catalog/custom-requests/${intake.id}/reject`, { note: note.trim() });
      notify('درخواست رد و به مشتری اطلاع داده شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const submit = async () => {
    setCreating(true);
    try {
      await api.post('/api/catalog/custom-services', {
        customerId: form.customerId,
        title: form.title,
        description: form.description,
        baseFee: Number(form.baseFee),
        estimatedMinutes: Number(form.estimatedMinutes),
        message: form.message,
        expiryHours: Number(form.expiryHours),
        documents: form.documents.split('\n').map((t) => t.trim()).filter(Boolean).map((title) => ({ title, required: true })),
        workflow: form.steps.split('\n').map((t) => t.trim()).filter(Boolean).map((title) => ({ title })),
        hasExternalCosts: form.hasExternalCosts,
        assignToCreator: form.assignment === 'self',
        customRequestId: form.customRequestId || undefined,
      });
      notify('خدمت اختصاصی ایجاد شد و پیشنهاد برای مشتری ارسال شد.', 'success');
      setForm(emptyForm);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setCreating(false); }
  };

  return (
    <AppShell variant="staff">
      <PageHeader title="خدمت اختصاصی" description="خدمتی که فقط برای یک مشتری تعریف می‌شود: پیشنهاد، فاکتور و گردش کار مستقل، بدون نمایش در کاتالوگ عمومی." />

      {intakes.some((intake) => intake.status === 'pending') && (
        <Card className="mb-6">
          <h2 className="mb-1 font-bold text-navy-900">درخواست‌های اختصاصی مشتریان (منتظر قیمت‌گذاری)</h2>
          <p className="mb-3 text-[11px] text-navy-500">این‌ها خواسته‌هایی هستند که مشتری در فهرست خدمات پیدا نکرده و خودش شرح داده است. با «قیمت‌گذاری» فرم پایین با مشخصاتش پر می‌شود.</p>
          <div className="space-y-2">
            {intakes.filter((intake) => intake.status === 'pending').map((intake) => (
              <div key={intake.id} className="rounded-xl bg-surface-3 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-900">{intake.title}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">{intake.customerName} • {intake.customerMobile} • {faDate(intake.createdAt)}</p>
                    <p className="mt-1 text-xs leading-6 text-navy-700">{intake.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => priceIntake(intake)}>قیمت‌گذاری</Button>
                    <Button size="sm" variant="ghost" onClick={() => void rejectIntake(intake)}>رد</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-bold text-navy-900">تعریف خدمت جدید</h2>
          <div className="space-y-3">
            <Field label="مشتری" required>
              <Select
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                placeholder="انتخاب مشتری"
                options={customers.map((c) => ({ value: c.id, label: `${c.fullName} — ${c.mobile}` }))}
              />
            </Field>
            <Field label="عنوان خدمت" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="مثلاً: پیگیری پرونده بیمه تکمیلی" /></Field>
            <Field label="توضیحات"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="هزینه (ریال)" required><Input type="number" value={form.baseFee} onChange={(e) => setForm({ ...form, baseFee: Number(e.target.value) })} /></Field>
              <Field label="زمان تخمینی">
                <div className="flex gap-2">
                  <Input type="number" min={1} step={form.durationUnit === 'minute' ? 1 : 0.5}
                    value={Math.round((Number(form.estimatedMinutes) / serviceDurationFactor(form.durationUnit)) * 100) / 100}
                    onChange={(e) => setForm({ ...form, estimatedMinutes: Number(e.target.value) * serviceDurationFactor(form.durationUnit) })} />
                  <Select value={form.durationUnit} onChange={(e) => setForm({ ...form, durationUnit: e.target.value })}
                    options={SERVICE_DURATION_UNITS.map((unit) => ({ value: unit.value, label: unit.label }))} className="w-32" />
                </div>
              </Field>
              <Field label="اعتبار پیشنهاد (ساعت)"><Input type="number" value={form.expiryHours} onChange={(e) => setForm({ ...form, expiryHours: Number(e.target.value) })} /></Field>
            </div>
            <Field label="پیام به مشتری"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="توضیح شرایط و مبلغ پیشنهادی…" /></Field>
            <Field label="مدارک مورد نیاز" hint="هر مورد در یک خط"><Textarea value={form.documents} onChange={(e) => setForm({ ...form, documents: e.target.value })} placeholder={'کارت ملی\nوکالت‌نامه'} /></Field>
            <Field label="مراحل انجام" hint="هر مرحله در یک خط"><Textarea value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} placeholder={'دریافت مدارک\nبررسی کارشناس\nثبت نهایی'} /></Field>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-3 px-3 py-2.5">
              <div>
                <p className="text-xs font-bold text-navy-800">هزینهٔ سازمانی حین انجام دارد</p>
                <p className="text-[10px] leading-5 text-navy-500">مبلغی متعلق به سازمان مربوطه که حین کار با فاکتور جداگانه از مشتری گرفته می‌شود (مثل حق بیمه).</p>
              </div>
              <Switch checked={form.hasExternalCosts} label={form.hasExternalCosts ? 'دارد' : 'ندارد'}
                onChange={(checked) => setForm({ ...form, hasExternalCosts: checked })} />
            </div>
            <Field label="پس از تأیید و پرداخت مشتری، انجام کار با کیست؟">
              <Select value={form.assignment} onChange={(e) => setForm({ ...form, assignment: e.target.value })}
                options={[
                  { value: 'pool', label: 'ارسال به صف آزاد کارکنان (هر کس واجد شرایط بود برمی‌دارد)' },
                  { value: 'self', label: 'خودم انجام می‌دهم (مستقیم به من واگذار می‌شود)' },
                ]} />
            </Field>
            {form.customRequestId && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] leading-6 text-sky-950 ring-1 ring-sky-200">
                این پیشنهاد در پاسخ به درخواست اختصاصی مشتری ثبت می‌شود و وضعیت آن درخواست به «قیمت‌گذاری شده» تغییر می‌کند.
              </p>
            )}
            <Button loading={creating} onClick={submit} disabled={!form.customerId || form.title.length < 3}>ایجاد و ارسال پیشنهاد</Button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-bold text-navy-900">خدمات اختصاصی ثبت‌شده</h2>
          {loading && <Loading />}
          {!loading && services.length === 0 && <EmptyState title="خدمت اختصاصی ثبت نشده" />}
          <div className="space-y-2">
            {services.map((service) => (
              <div key={service.id} className="rounded-xl bg-surface-3 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{service.title}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">{service.customerName} • {rial(service.baseFee)} • {formatDuration(service.estimatedMinutes, service.estimatedDays)}</p>
                  </div>
                  <StatusBadge status={service.offerStatus ?? 'draft'} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

/* --------------------------------- shifts --------------------------------- */

export function StaffShifts() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [shifts, setShifts] = useState<any[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [calendar, setCalendar] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [requestOpen, setRequestOpen] = useState(false);
  const [kind, setKind] = useState('leave');
  const [reason, setReason] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [requestedStart, setRequestedStart] = useState('09:00');
  const [requestedEnd, setRequestedEnd] = useState('17:00');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/shifts', { mine: 'true' }),
      api.list<any>('/api/shifts/change-requests'),
      api.get<{ data: any }>('/api/shifts/calendar').catch(() => null),
    ]).then(([sh, ch, cal]) => {
      setShifts(sh.data); setChanges(ch.data); setCalendar(cal?.data ?? null);
    }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submitRequest = async () => {
    try {
      await api.post('/api/shifts/change-requests', {
        kind, reason,
        shiftId: kind === 'add' ? undefined : shiftId || undefined,
        requestedDate: kind === 'leave' ? undefined : requestedDate || undefined,
        startTime: kind === 'add' ? requestedStart : undefined,
        endTime: kind === 'add' ? requestedEnd : undefined,
      });
      notify('درخواست ثبت شد و برای بررسی ارسال گردید.', 'success');
      setRequestOpen(false);
      setReason('');
      setShiftId('');
      setRequestedDate('');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await api.patch(`/api/shifts/change-requests/${id}`, { decision });
      notify('درخواست بررسی شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const weekDays = calendar ? Object.keys(calendar.days) : [];

  return (
    <AppShell variant="staff">
      <PageHeader title="شیفت و حضور" description="برنامه شیفت هفتگی، ثبت درخواست مرخصی یا جابه‌جایی و تاریخچه حضور."
        actions={<Button size="sm" onClick={() => setRequestOpen(true)}>درخواست تغییر شیفت</Button>} />

      {loading && <Loading />}

      {!loading && calendar && (
        <Card className="mb-6">
          <h2 className="mb-3 font-bold text-navy-900">هفته جاری</h2>
          <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {weekDays.map((day) => (
              <div key={day} className="rounded-xl bg-surface-3 p-3">
                <p className="text-[11px] font-medium text-navy-700">{faDate(day)}</p>
                <div className="mt-1.5 space-y-1">
                  {calendar.days[day].length === 0 && <p className="text-[10px] text-navy-400">—</p>}
                  {calendar.days[day].map((shift: any) => (
                    <p key={shift.id} className="rounded-lg bg-surface px-2 py-1 text-[10px] text-navy-700 ring-1 ring-line">
                      {shift.startTime}–{shift.endTime}
                      {shift.userName ? ` • ${shift.userName}` : ''}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold text-navy-900">شیفت‌های من</h2>
          {shifts.length === 0 && <p className="text-sm text-navy-400">شیفتی ثبت نشده است.</p>}
          <div className="space-y-2">
            {shifts.map((shift) => (
              <div key={shift.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-3 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-navy-900">{faDate(shift.date)}</p>
                  <p className="text-[11px] text-navy-500">{shift.startTime} تا {shift.endTime} {shift.userName && shift.userName !== '—' ? `• ${shift.userName}` : ''}</p>
                </div>
                <StatusBadge status={shift.status} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-bold text-navy-900">درخواست‌های شیفت</h2>
          {changes.length === 0 && <p className="text-sm text-navy-400">درخواستی ندارید.</p>}
          <div className="space-y-2">
            {changes.map((change) => (
              <div key={change.id} className="rounded-xl bg-surface-3 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-navy-900">
                      {change.kind === 'leave' ? 'مرخصی' : change.kind === 'swap' ? 'جابه‌جایی' : 'افزودن شیفت'}
                      {change.userName ? ` — ${change.userName}` : ''}
                    </p>
                    <p className="mt-0.5 text-[11px] text-navy-500">{change.reason}</p>
                    {change.shift && <p className="text-[10px] text-navy-400">شیفت {faDate(change.shift.date)} • {change.shift.startTime}–{change.shift.endTime}</p>}
                    {change.requestedDate && <p className="text-[10px] text-navy-400">درخواست برای {faDate(change.requestedDate)}{change.startTime ? ` • ${change.startTime}–${change.endTime}` : ''}</p>}
                  </div>
                  <StatusBadge status={change.status} />
                </div>
                {change.status === 'pending' && can('shifts.approve') && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => decide(change.id, 'approved')}>تأیید</Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(change.id, 'rejected')}>رد</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="درخواست تغییر شیفت"
        footer={<><Button variant="ghost" onClick={() => setRequestOpen(false)}>انصراف</Button><Button onClick={submitRequest} disabled={reason.length < 3 || (kind !== 'add' && !shiftId) || (kind !== 'leave' && !requestedDate) || (kind === 'add' && requestedStart >= requestedEnd)}>ثبت درخواست</Button></>}>
        <div className="space-y-3">
          <Field label="نوع درخواست">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} options={[
              { value: 'leave', label: 'مرخصی' },
              { value: 'swap', label: 'جابه‌جایی شیفت' },
              { value: 'add', label: 'افزودن شیفت' },
            ]} />
          </Field>
          {kind !== 'add' && <Field label="شیفت مرتبط" required>
            <Select value={shiftId} onChange={(e) => setShiftId(e.target.value)} placeholder="انتخاب شیفت"
              options={shifts.filter((s) => s.status === 'scheduled').map((s) => ({ value: s.id, label: `${faDate(s.date)} ${s.startTime}–${s.endTime}` }))} />
          </Field>}
          {kind !== 'leave' && <Field label={kind === 'swap' ? 'تاریخ جایگزین' : 'تاریخ شیفت جدید'} required>
            <Input type="date" value={requestedDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setRequestedDate(e.target.value)} />
          </Field>}
          {kind === 'add' && <div className="grid grid-cols-2 gap-3">
            <Field label="شروع" required><Input type="time" value={requestedStart} onChange={(e) => setRequestedStart(e.target.value)} /></Field>
            <Field label="پایان" required><Input type="time" value={requestedEnd} onChange={(e) => setRequestedEnd(e.target.value)} /></Field>
          </div>}
          <Field label="دلیل" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </AppShell>
  );
}

/* --------------------------------- finance -------------------------------- */


export function StaffPerformance() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    api.get<{ data: any }>(`/api/staff/${user.id}/performance`)
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <AppShell variant="staff">
      <PageHeader title="عملکرد من" description="آمار پرونده‌ها، میانگین زمان انجام و وضعیت حضور در ۳۰ روز گذشته." />
      {loading && <Loading />}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="تکمیل‌شده" value={faNum(data.completed)} tone="emerald" icon={<CheckCircle2 className="size-5" />} />
            <StatCard label="میانگین زمان انجام" value={data.averageCompletionHours !== null ? `${faNum(data.averageCompletionHours)} ساعت` : '—'} icon={<Clock className="size-5" />} />
            <StatCard label="درآمد منتسب" value={rial(data.revenue)} icon={<Wallet className="size-5" />} />
            <StatCard label="حضور" value={faNum(data.attendance.reduce((s: number, a: any) => s + a.count, 0))} icon={<CalendarClock className="size-5" />} />
          </div>
          <Card className="mt-6">
            <h2 className="mb-3 font-bold text-navy-900">توزیع وضعیت پرونده‌ها</h2>
            <div className="flex flex-wrap gap-2">
              {data.byStatus.map((row: any) => (
                <div key={row.status} className="rounded-xl bg-surface-3 px-4 py-2">
                  <p className="text-[11px] text-navy-500">{STATUS_LABELS[row.status] ?? row.status}</p>
                  <p className="text-lg font-bold text-navy-900">{faNum(row.count)}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}
