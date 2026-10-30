import { CaseAutomation } from '../shared/Automation';
import { CompensationPage } from '../shared/Compensation';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList, FileText, Clock, AlertTriangle, CheckCircle2, UserPlus, UploadCloud, Send,
  Users, CalendarClock, ArrowRight, Wallet, RefreshCw, LogIn, LogOut, Search, MessageSquare,
  ShieldAlert, Download, BadgeCheck, FileCheck2, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import { DocumentViewer, FileSummary, FileThumbnail } from '../../components/documents';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, StatCard,
  StatusBadge, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDate, faDateTime, faNum, relative, rial, STATUS_LABELS } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useSite } from '../../lib/site';

/* -------------------------------- workbench ------------------------------- */

export function StaffWorkbench() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [summary, setSummary] = useState<any>(null);
  const [workload, setWorkload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [sum, wl] = await Promise.all([
        api.get<{ data: any }>('/api/dashboard/summary'),
        api.get<{ data: any }>('/api/staff/me/workload').catch(() => null),
      ]);
      setSummary(sum.data);
      setWorkload(wl?.data ?? null);
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

  if (loading) return <AppShell variant="staff"><Loading rows={4} /></AppShell>;

  return (
    <AppShell variant="staff">
      <PageHeader
        title={`میز کار ${user?.fullName ?? ''}`}
        description="پرونده‌های در دست شما، مدارک در انتظار بررسی و وضعیت شیفت امروز."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="size-4" /> به‌روزرسانی</Button>
            {workload?.attendance?.checkIn && !workload?.attendance?.checkOut
              ? <Button size="sm" variant="danger" loading={busy} onClick={checkOut}><LogOut className="size-4" /> ثبت خروج</Button>
              : <Button size="sm" loading={busy} onClick={checkIn}><LogIn className="size-4" /> ثبت ورود</Button>}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="پرونده‌های فعال من" value={faNum(workload?.activeCount ?? 0)} icon={<ClipboardList className="size-5" />} />
        <StatCard label="مدارک در انتظار" value={faNum(workload?.pendingDocuments?.length ?? 0)} tone="amber" icon={<FileCheck2 className="size-5" />} />
        <StatCard label="تکمیل‌شده (۳۰ روز)" value={faNum(workload?.completedLast30Days ?? 0)} tone="emerald" icon={<CheckCircle2 className="size-5" />} />
        <StatCard
          label="شیفت امروز"
          value={workload?.shift ? `${workload.shift.startTime} - ${workload.shift.endTime}` : 'بدون شیفت'}
          icon={<CalendarClock className="size-5" />}
          hint={workload?.attendance?.checkIn ? `ورود: ${faDateTime(workload.attendance.checkIn).split('،').pop()}` : 'هنوز ورود ثبت نشده'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-navy-900">پرونده‌های در دست من</h2>
            <Link to="/staff/requests" className="text-xs text-accent hover:underline">همه درخواست‌ها</Link>
          </div>
          {(!workload || workload.activeRequests.length === 0) ? (
            <EmptyState title="پرونده فعالی ندارید" description="از صف درخواست‌ها می‌توانید پرونده بردارید یا منتظر ارجاع خودکار بمانید." />
          ) : (
            <div className="space-y-2">
              {workload.activeRequests.map((item: any) => (
                <Link key={item.id} to={`/staff/requests/${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-3 px-4 py-3 transition hover:bg-brand-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{item.serviceTitle}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">
                      {item.customerName} • {item.trackingCode}
                      {item.dueAt ? ` • مهلت ${faDate(item.dueAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.priority === 'high' && <Badge tone="danger">فوری</Badge>}
                    <StatusBadge status={item.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><FileText className="size-4 text-accent" /> مدارک در انتظار بررسی</h2>
            {(!workload || workload.pendingDocuments.length === 0) ? (
              <p className="text-sm text-navy-400">مدرکی در انتظار بررسی نیست.</p>
            ) : (
              <div className="space-y-2">
                {workload.pendingDocuments.map((doc: any) => (
                  <Link key={doc.id} to={`/staff/requests/${doc.requestId}`} className="block rounded-xl bg-amber-50/70 px-3 py-2.5 hover:bg-amber-100/70">
                    <p className="truncate text-xs font-medium text-navy-900">{doc.title}</p>
                    <p className="mt-0.5 text-[10px] text-navy-500">{doc.trackingCode} • {relative(doc.createdAt)}</p>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-navy-900">وضعیت امروز دفتر</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-navy-500">بدون کارشناس</dt><dd className="font-semibold">{faNum(summary?.cards?.unassigned ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-navy-500">مدارک معلق</dt><dd className="font-semibold">{faNum(summary?.cards?.pendingDocuments ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-navy-500">پیام خوانده‌نشده</dt><dd className="font-semibold">{faNum(summary?.cards?.unreadMessages ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-navy-500">حاضر امروز</dt><dd className="font-semibold">{faNum(summary?.cards?.checkedInToday ?? 0)}</dd></div>
            </dl>
            <Link to="/staff/messages" className="btn-ghost btn-sm mt-3 w-full"><MessageSquare className="size-4" /> رفتن به پیام‌ها</Link>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

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
  }, [status, group, mine, unassigned, search, page]);

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
            <div className="flex items-center gap-2">
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
            {can('requests.edit')&&<Button size="sm" variant="ghost" onClick={() => { setNextStatus(request.status); setStatusModal(true); }}>تغییر وضعیت</Button>}
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
                {request.dueAt && <span className="text-xs text-navy-500">مهلت: {faDate(request.dueAt)}</span>}
              </div>
              <span className="text-sm font-bold text-navy-900">{rial(request.total)}</span>
            </div>
            {request.workflow?.length > 0 && (
              <ol className="mt-4 flex gap-1">
                {request.workflow.map((step: any, index: number) => (
                  <li key={step.title} className="flex-1">
                    <div className={clsx('h-1.5 rounded-full', index <= request.currentStep ? 'bg-brand-600' : 'bg-navy-100')} />
                    <p className="mt-1 line-clamp-1 text-[10px] text-navy-500">{step.title}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <CaseAutomation request={request} onChange={load} />
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
                  <FileSummary file={doc.file} />
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
                    <StatusBadge status={invoice.status} />
                  </div>
                  <p className="mt-1 text-sm font-semibold text-navy-900">{rial(invoice.total)}</p>
                  <p className="text-[11px] text-navy-500">پرداخت‌شده: {rial(invoice.paidAmount)}</p>
                </div>
              ))}
            </div>
            {variant === 'admin' && can('invoices.create') && (
              <Link to="/admin/finance" className="btn-ghost btn-sm mt-3 w-full">مدیریت فاکتورها</Link>
            )}
          </Card>
        </div>
      </div>

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

      <DocumentViewer file={viewer?.file ?? null} title={viewer?.title ?? 'مدرک'} open={Boolean(viewer)} onClose={() => setViewer(null)} />
    </AppShell>
  );
}

/* ----------------------------- documents queue ---------------------------- */

export function StaffDocuments() {
  const { notify } = useToast();
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
    const note = decision === 'rejected' ? window.prompt('دلیل رد مدرک:') ?? '' : '';
    try {
      await api.post(`/api/requests/${doc.requestId}/documents/${doc.id}/review`, { decision, note: note || undefined });
      notify(decision === 'approved' ? 'مدرک تأیید شد.' : 'مدرک رد شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="staff">
      <PageHeader title="بررسی مدارک" description="مدارک بارگذاری‌شده توسط مشتریان که در انتظار تأیید یا رد هستند."
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
                    {doc.customerName} • {doc.serviceTitle} • {doc.trackingCode} • {relative(doc.createdAt)}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-navy-400" dir="ltr">{doc.file.name}</p>
                  <FileSummary file={doc.file} />
                  {doc.file.processing?.status === 'failed' && (
                    <p className="mt-1 text-[11px] text-amber-700">پردازش تصویر انجام نشد؛ نسخه اصلی حفظ شده است.</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setViewer(doc)}><Download className="size-3.5" /> مشاهده</Button>
                <Link to={`/staff/requests/${doc.requestId}`} className="btn-ghost btn-sm"><ArrowRight className="size-3.5" /> پرونده</Link>
                <Button size="sm" onClick={() => review(doc, 'approved')}>تأیید</Button>
                <Button size="sm" variant="danger" onClick={() => review(doc, 'rejected')}>رد</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <DocumentViewer file={viewer?.file ?? null} title={viewer?.title ?? 'مدرک'} open={Boolean(viewer)} onClose={() => setViewer(null)} />
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
    const noteText = decision === 'rejected' ? window.prompt('دلیل رد مدرک پروفایل:') ?? '' : '';
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
                          {document.file.processing?.status === 'ready' ? ` • ${faNum(document.file.savingsPercent ?? 0)}٪ کم‌حجم‌تر` : ''}
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
  const [form, setForm] = useState({
    customerId: '', title: '', description: '', baseFee: 0, estimatedDays: 3,
    message: '', expiryHours: 72, documents: '', steps: '',
  });
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/customers', { pageSize: 200 }),
      api.list<any>('/api/catalog/custom-services'),
    ]).then(([cust, svc]) => { setCustomers(cust.data); setServices(svc.data); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async () => {
    setCreating(true);
    try {
      await api.post('/api/catalog/custom-services', {
        customerId: form.customerId,
        title: form.title,
        description: form.description,
        baseFee: Number(form.baseFee),
        estimatedDays: Number(form.estimatedDays),
        message: form.message,
        expiryHours: Number(form.expiryHours),
        documents: form.documents.split('\n').map((t) => t.trim()).filter(Boolean).map((title) => ({ title, required: true })),
        workflow: form.steps.split('\n').map((t) => t.trim()).filter(Boolean).map((title) => ({ title })),
      });
      notify('خدمت اختصاصی ایجاد شد و پیشنهاد برای مشتری ارسال شد.', 'success');
      setForm({ customerId: '', title: '', description: '', baseFee: 0, estimatedDays: 3, message: '', expiryHours: 72, documents: '', steps: '' });
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setCreating(false); }
  };

  return (
    <AppShell variant="staff">
      <PageHeader title="خدمت اختصاصی" description="خدمتی که فقط برای یک مشتری تعریف می‌شود: پیشنهاد، فاکتور و گردش کار مستقل، بدون نمایش در کاتالوگ عمومی." />

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
              <Field label="روز کاری"><Input type="number" value={form.estimatedDays} onChange={(e) => setForm({ ...form, estimatedDays: Number(e.target.value) })} /></Field>
              <Field label="اعتبار پیشنهاد (ساعت)"><Input type="number" value={form.expiryHours} onChange={(e) => setForm({ ...form, expiryHours: Number(e.target.value) })} /></Field>
            </div>
            <Field label="پیام به مشتری"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="توضیح شرایط و مبلغ پیشنهادی…" /></Field>
            <Field label="مدارک مورد نیاز" hint="هر مورد در یک خط"><Textarea value={form.documents} onChange={(e) => setForm({ ...form, documents: e.target.value })} placeholder={'کارت ملی\nوکالت‌نامه'} /></Field>
            <Field label="مراحل انجام" hint="هر مرحله در یک خط"><Textarea value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} placeholder={'دریافت مدارک\nبررسی کارشناس\nثبت نهایی'} /></Field>
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
                    <p className="mt-0.5 text-[11px] text-navy-500">{service.customerName} • {rial(service.baseFee)}</p>
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

export function StaffFinance(){return <CompensationPage />;}

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
