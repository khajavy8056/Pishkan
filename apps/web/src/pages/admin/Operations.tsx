import { useEffect, useState } from 'react';
import {
  Plus, CalendarClock, RefreshCw, Database, ServerCog, ShieldCheck, Download, Trash2, Play,
  AlertTriangle, CheckCircle2, XCircle, Clock, HardDrive, Users, KeyRound, Globe, Search,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, StatCard,
  StatusBadge, Switch, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDate, faDateTime, faNum, relative, rial } from '../../lib/format';

/* --------------------------------- shifts --------------------------------- */

const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

export function AdminShifts() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [shifts, setShifts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [shiftModal, setShiftModal] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);
  const [form, setForm] = useState<any>({ userId: '', date: new Date().toISOString().slice(0, 10), startTime: '08:00', endTime: '16:00', note: '' });
  const [templateForm, setTemplateForm] = useState<any>({ title: '', startTime: '08:00', endTime: '16:00', weekdays: [6, 0, 1, 2, 3], capacity: 3 });

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/shifts'),
      api.list<any>('/api/shifts/templates').catch(() => ({ data: [] } as any)),
      api.list<any>('/api/shifts/attendance/list').catch(() => ({ data: [] } as any)),
      api.list<any>('/api/shifts/change-requests'),
      api.list<any>('/api/staff').catch(() => ({ data: [] } as any)),
    ]).then(([sh, tp, at, ch, st]) => {
      setShifts(sh.data); setTemplates(tp.data); setAttendance(at.data); setChanges(ch.data); setStaff(st.data);
    }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const createShift = async () => {
    try {
      await api.post('/api/shifts', form);
      notify('شیفت ثبت شد.', 'success');
      setShiftModal(false);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const createTemplate = async () => {
    try {
      await api.post('/api/shifts/templates', { ...templateForm, capacity: Number(templateForm.capacity) });
      notify('الگوی شیفت ایجاد شد.', 'success');
      setTemplateModal(false);
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

  const removeShift = async (shift: any) => {
    if (!window.confirm('این شیفت حذف شود؟')) return;
    try {
      await api.delete(`/api/shifts/${shift.id}`);
      notify('شیفت حذف شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="admin">
      <PageHeader title="شیفت و حضور" description="برنامه‌ریزی شیفت کارکنان، الگوهای تکرارشونده، حضور و غیاب و درخواست‌های تغییر."
        actions={
          <div className="flex gap-2">
            {can('shifts.create') && <Button size="sm" onClick={() => setShiftModal(true)}><Plus className="size-4" /> شیفت جدید</Button>}
            {can('shifts.create') && <Button size="sm" variant="ghost" onClick={() => setTemplateModal(true)}>الگوی شیفت</Button>}
          </div>
        } />

      {loading && <Loading />}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="شیفت‌های ثبت‌شده" value={faNum(shifts.length)} icon={<CalendarClock className="size-5" />} />
        <StatCard label="ثبت‌های حضور" value={faNum(attendance.length)} tone="emerald" icon={<Clock className="size-5" />} />
        <StatCard label="درخواست‌های در انتظار" value={faNum(changes.filter((c) => c.status === 'pending').length)} tone="amber" icon={<RefreshCw className="size-5" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold text-navy-900">شیفت‌های پیش‌رو</h2>
          {shifts.length === 0 && <EmptyState title="شیفتی ثبت نشده" />}
          <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin">
            {shifts.slice(0, 40).map((shift) => (
              <div key={shift.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-navy-900">{shift.userName ?? '—'}</p>
                  <p className="text-[11px] text-navy-500">{faDate(shift.date)} • {shift.startTime}–{shift.endTime} {shift.templateTitle ? `• ${shift.templateTitle}` : ''}</p>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge status={shift.status} />
                  {can('shifts.delete') && <Button size="sm" variant="ghost" onClick={() => removeShift(shift)} aria-label="حذف"><Trash2 className="size-3.5" /></Button>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-bold text-navy-900">الگوهای شیفت</h2>
          {templates.length === 0 && <p className="text-sm text-navy-400">الگویی تعریف نشده است.</p>}
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-3 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-navy-900">{template.title}</p>
                  <p className="text-[11px] text-navy-500">
                    {template.startTime}–{template.endTime} • ظرفیت {faNum(template.capacity)}
                    {Array.isArray(template.weekdays) && template.weekdays.length > 0 ? ` • ${template.weekdays.map((d: number) => WEEKDAYS[d]).join('، ')}` : ''}
                  </p>
                </div>
                {can('shifts.delete') && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!window.confirm('الگو حذف شود؟')) return;
                    await api.delete(`/api/shifts/templates/${template.id}`).catch(() => undefined);
                    load();
                  }} aria-label="حذف"><Trash2 className="size-3.5" /></Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-bold text-navy-900">درخواست‌های تغییر شیفت</h2>
          {changes.length === 0 && <p className="text-sm text-navy-400">درخواستی وجود ندارد.</p>}
          <div className="space-y-2">
            {changes.map((change) => (
              <div key={change.id} className="rounded-xl bg-surface-3 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-navy-900">
                      {change.userName} • {change.kind === 'leave' ? 'مرخصی' : change.kind === 'swap' ? 'جابه‌جایی' : 'افزودن شیفت'}
                    </p>
                    <p className="text-[11px] text-navy-500">{change.reason}</p>
                    {change.shift && <p className="text-[10px] text-navy-400">{faDate(change.shift.date)} • {change.shift.startTime}–{change.shift.endTime}</p>}
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

        <Card>
          <h2 className="mb-3 font-bold text-navy-900">آخرین ثبت‌های حضور</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>کارمند</th><th>ورود</th><th>خروج</th><th>وضعیت</th></tr></thead>
              <tbody>
                {attendance.slice(0, 20).map((row) => (
                  <tr key={row.id}>
                    <td className="text-xs">{row.userName}</td>
                    <td className="text-[11px]">{faDateTime(row.checkIn)}</td>
                    <td className="text-[11px]">{row.checkOut ? faDateTime(row.checkOut) : '—'}</td>
                    <td><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {attendance.length === 0 && <p className="text-sm text-navy-400">ثبتی وجود ندارد.</p>}
        </Card>
      </div>

      <Modal open={shiftModal} onClose={() => setShiftModal(false)} title="ثبت شیفت"
        footer={<><Button variant="ghost" onClick={() => setShiftModal(false)}>انصراف</Button><Button onClick={createShift} disabled={!form.userId}>ثبت</Button></>}>
        <div className="space-y-3">
          <Field label="کارمند" required>
            <Select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} placeholder="انتخاب کارمند"
              options={staff.map((s) => ({ value: s.id, label: `${s.fullName} (${s.roleName ?? s.roleCode})` }))} />
          </Field>
          <Field label="تاریخ" required><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} dir="ltr" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ساعت شروع"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} dir="ltr" /></Field>
            <Field label="ساعت پایان"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} dir="ltr" /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={templateModal} onClose={() => setTemplateModal(false)} title="الگوی شیفت"
        footer={<><Button variant="ghost" onClick={() => setTemplateModal(false)}>انصراف</Button><Button onClick={createTemplate} disabled={templateForm.title.length < 2}>ایجاد</Button></>}>
        <div className="space-y-3">
          <Field label="عنوان" required><Input value={templateForm.title} onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })} placeholder="شیفت صبح" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="شروع"><Input type="time" value={templateForm.startTime} onChange={(e) => setTemplateForm({ ...templateForm, startTime: e.target.value })} dir="ltr" /></Field>
            <Field label="پایان"><Input type="time" value={templateForm.endTime} onChange={(e) => setTemplateForm({ ...templateForm, endTime: e.target.value })} dir="ltr" /></Field>
          </div>
          <Field label="ظرفیت"><Input type="number" value={templateForm.capacity} onChange={(e) => setTemplateForm({ ...templateForm, capacity: Number(e.target.value) })} /></Field>
          <div>
            <p className="label">روزهای هفته</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day, index) => (
                <button key={day} type="button"
                  onClick={() => setTemplateForm({
                    ...templateForm,
                    weekdays: templateForm.weekdays.includes(index)
                      ? templateForm.weekdays.filter((d: number) => d !== index)
                      : [...templateForm.weekdays, index],
                  })}
                  className={clsx('rounded-lg px-2.5 py-1 text-xs ring-1 transition',
                    templateForm.weekdays.includes(index) ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line')}>
                  {day}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}

/* --------------------------------- system --------------------------------- */

export function AdminSystem() {
  const { notify } = useToast();
  const [status, setStatus] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [backups, setBackups] = useState<{ items: any[]; status?: any }>({ items: [] });
  const [sessions, setSessions] = useState<any[]>([]);
  const [domain, setDomain] = useState<any>(null);
  const [media, setMedia] = useState<any>(null);
  const [mediaDiagnostics, setMediaDiagnostics] = useState<any>(null);
  const [pruneResult, setPruneResult] = useState<any>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoreModal, setRestoreModal] = useState<any>(null);
  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<{ data: any }>('/api/system/status'),
      api.get<{ data: any }>('/api/settings/system-health').catch(() => null),
      api.list<any>('/api/system/backups').catch(() => ({ data: [] } as any)),
      api.list<any>('/api/system/sessions').catch(() => ({ data: [] } as any)),
      api.get<{ data: any }>('/api/settings/domain-check').catch(() => null),
      api.get<{ data: any }>('/api/files/media/stats').catch(() => null),
      api.get<{ data: any }>('/api/files/media/diagnostics').catch(() => null),
    ]).then(([st, hl, bk, ss, dm, md, mdg]) => {
      setStatus(st.data); setHealth(hl?.data ?? null);
      setBackups({ items: bk.data, status: (bk as any).meta ?? null });
      setSessions(ss.data); setDomain(dm?.data ?? null);
      setMedia(md?.data ?? null); setMediaDiagnostics(mdg?.data ?? null);
    }).catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت وضعیت'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const createBackup = async () => {
    setBusy(true);
    try {
      await api.post('/api/system/backups', { note: 'پشتیبان دستی از پنل مدیریت' });
      notify('نسخه پشتیبان ایجاد شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(false); }
  };

  const verifyBackup = async (backup: any) => {
    try {
      const res = await api.post<{ data: any }>(`/api/system/backups/${backup.id}/verify`);
      notify(res.data.valid ? 'صحت نسخه پشتیبان تأیید شد.' : 'نسخه پشتیبان معتبر نیست.', res.data.valid ? 'success' : 'error');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const restore = async () => {
    if (!restoreModal) return;
    setBusy(true);
    try {
      await api.post('/api/system/backups/restore', {
        backupId: restoreModal.id, confirmation: restoreConfirm, password: restorePassword,
      });
      notify('بازیابی انجام شد. سامانه را دوباره بررسی کنید.', 'success');
      setRestoreModal(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در بازیابی', 'error');
    } finally { setBusy(false); }
  };

  const previewPrune = async () => {
    setMediaBusy(true);
    try {
      const res = await api.post<{ data: any }>('/api/files/media/prune-originals', { dryRun: true });
      setPruneResult(res.data);
      notify(res.data.candidates ? `${faNum(res.data.candidates)} نسخه اصلی قدیمی و قابل حذف شناسایی شد (بدون حذف).` : 'نسخه اصلی قدیمی برای حذف وجود ندارد.', 'info');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در بررسی نسخه‌های اصلی', 'error');
    } finally { setMediaBusy(false); }
  };

  const revokeSession = async (session: any) => {
    try {
      await api.delete(`/api/system/sessions/${session.id}`);
      notify('نشست بسته شد.', 'success');
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="admin">
      <PageHeader title="زیرساخت و پشتیبان‌گیری" description="وضعیت سرویس، نسخه‌های پشتیبان، نشست‌های فعال و بررسی دامنه."
        actions={<Button size="sm" variant="ghost" onClick={load}><RefreshCw className="size-4" /> بازبینی</Button>} />

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={load} />}

      {status && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="نسخه سامانه" value={status.version} icon={<ServerCog className="size-5" />} hint={`Node ${status.node}`} />
            <StatCard label="زمان فعالیت" value={`${faNum(Math.floor(status.uptimeSeconds / 3600))} ساعت`} icon={<Clock className="size-5" />} />
            <StatCard label="حافظه مصرفی" value={`${faNum(status.memoryMb)} MB`} icon={<HardDrive className="size-5" />} hint={status.disk ? `دیسک آزاد ${faNum(status.disk.freeGb)} GB` : undefined} />
            <StatCard label="مایگریشن‌ها" value={faNum(status.migrations.count)} tone="emerald" icon={<Database className="size-5" />} hint={status.migrations.last?.name} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Database className="size-4 text-accent" /> پشتیبان‌گیری</h2>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button size="sm" loading={busy} onClick={createBackup}>ایجاد نسخه پشتیبان</Button>
                <span className="self-center text-[11px] text-navy-500">
                  {backups.status?.lastBackupAt ? `آخرین نسخه: ${relative(backups.status.lastBackupAt)}` : 'هنوز نسخه‌ای ایجاد نشده است.'}
                </span>
              </div>
              {backups.items.length === 0 && <p className="text-sm text-navy-400">نسخه پشتیبانی وجود ندارد.</p>}
              <div className="space-y-2">
                {backups.items.map((backup) => (
                  <div key={backup.id} className="rounded-xl bg-surface-3 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p dir="ltr" className="truncate text-right text-xs font-medium text-navy-900">{backup.filename}</p>
                        <p className="text-[10px] text-navy-500">{faDateTime(backup.createdAt)} • {faNum(Math.round((backup.size ?? 0) / 1024))} KB</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => verifyBackup(backup)}>بررسی</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setRestoreModal(backup); setRestoreConfirm(''); setRestorePassword(''); }}>بازیابی</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] leading-5 text-amber-900">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                بازیابی، داده‌های جاری را با نسخه پشتیبان جایگزین می‌کند. قبل از بازیابی، از داده‌های فعلی نسخه پشتیبان بگیرید.
                نسخه‌ها باید در مقصد خارج از سرور اصلی (S3/سرور پشتیبان) هم نگهداری شوند.
              </p>
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><HardDrive className="size-4 text-accent" /> پردازش تصاویر و مدارک</h2>
              {!media && <p className="text-sm text-navy-400">آمار رسانه در دسترس نیست.</p>}
              {media && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">فایل‌های خصوصی</p><p className="font-bold text-navy-900">{faNum(media.totalFiles)}</p></div>
                    <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">میانگین کاهش حجم</p><p className="font-bold text-emerald-700">{faNum(media.averageSavingsPercent)}٪</p></div>
                    <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">حجم ورودی اصلی</p><p className="font-bold text-navy-900">{faNum(Math.round(media.originalBytes / 1048576))} MB</p></div>
                    <div className="rounded-xl bg-surface-3 p-2"><p className="text-[10px] text-navy-500">حجم نسخه نمایشی</p><p className="font-bold text-navy-900">{faNum(Math.round(media.servedBytes / 1048576))} MB</p></div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-navy-600">
                    {Object.entries(media.byStatus ?? {}).map(([status, count]) => (
                      <span key={status} className="rounded-lg bg-surface-3 px-2 py-1">{status}: {faNum(count as number)}</span>
                    ))}
                  </div>
                  {mediaDiagnostics?.queue && (
                    <p className="mt-2 text-[10px] text-navy-500">
                      صف پردازش: {faNum(mediaDiagnostics.queue.active)} فعال، {faNum(mediaDiagnostics.queue.queued)} در انتظار
                      {mediaDiagnostics.config ? ` • سیاست: ${mediaDiagnostics.config.qualityMode}` : ''}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" loading={mediaBusy} onClick={previewPrune}>بررسی حذف نسخه‌های اصلی قدیمی</Button>
                    {pruneResult && (
                      <span className="text-[10px] text-navy-500">
                        {faNum(pruneResult.candidates)} مورد واجد شرایط؛ حذف واقعی فقط با تأیید متنی در API انجام می‌شود.
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[10px] leading-5 text-navy-500">
                    نسخه اصلی مدارک به‌صورت پیش‌فرض دائمی نگهداری می‌شود؛ حذف خودکار انجام نمی‌شود تا بازیابی و بازبینی انسانی همیشه ممکن باشد.
                  </p>
                </>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><Globe className="size-4 text-accent" /> بررسی دامنه و HTTPS</h2>
              {!domain && <p className="text-sm text-navy-400">اطلاعات دامنه در دسترس نیست.</p>}
              {domain && (
                <>
                  <div className="space-y-2">
                    {domain.checks.map((check: any) => (
                      <div key={check.key} className="flex items-start gap-2 rounded-xl bg-surface-3 px-3 py-2">
                        {check.status === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-700" />
                          : check.status === 'warning' ? <AlertTriangle className="mt-0.5 size-4 text-amber-700" />
                            : <XCircle className="mt-0.5 size-4 text-rose-700" />}
                        <div>
                          <p className="text-xs font-medium text-navy-900">{check.label}</p>
                          <p className="text-[11px] text-navy-500">{check.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <details className="mt-3 rounded-xl bg-brand-50/60 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-brand-900">گام‌های اتصال دامنه در Cloudflare</summary>
                    <ol className="mt-2 list-inside list-decimal space-y-1 text-[11px] leading-6 text-brand-900">
                      {domain.steps.map((step: string, index: number) => <li key={index}>{step}</li>)}
                    </ol>
                  </details>
                </>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><KeyRound className="size-4 text-accent" /> نشست‌های فعال</h2>
              {sessions.length === 0 && <p className="text-sm text-navy-400">نشست فعالی نیست.</p>}
              <div className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-navy-900">{session.userName} <Badge tone="default">{session.kind === 'customer' ? 'مشتری' : 'کارمند'}</Badge></p>
                      <p dir="ltr" className="text-right text-[10px] text-navy-500">{session.ip} • {relative(session.lastSeenAt)}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => revokeSession(session)}>بستن</Button>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center gap-2 font-bold text-navy-900"><ShieldCheck className="size-4 text-emerald-700" /> سلامت سرویس</h2>
              {!health && <p className="text-sm text-navy-400">اطلاعات سلامت در دسترس نیست.</p>}
              {health && (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-navy-500">محیط اجرا</dt><dd>{health.environment}</dd></div>
                  <div className="flex justify-between"><dt className="text-navy-500">پایگاه داده</dt><dd dir="ltr">{health.driver}</dd></div>
                  <div className="flex justify-between"><dt className="text-navy-500">پیامک</dt><dd>{health.sms.enabled ? `فعال (${health.sms.provider})` : 'غیرفعال'}</dd></div>
                  <div className="flex justify-between"><dt className="text-navy-500">درگاه پرداخت</dt><dd>{health.payment.online ? health.payment.gateway : 'غیرفعال'}</dd></div>
                  <div className="flex justify-between"><dt className="text-navy-500">آخرین تغییر تنظیمات</dt><dd>{health.settingsLastUpdated ? faDateTime(health.settingsLastUpdated) : '—'}</dd></div>
                </dl>
              )}
              {health && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {Object.entries(health.records ?? {}).map(([key, value]) => (
                    <div key={key} className="rounded-lg bg-surface-3 p-2 text-center">
                      <p className="text-[10px] text-navy-500">{key}</p>
                      <p className="text-sm font-semibold text-navy-900">{faNum(Number(value))}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <Modal open={Boolean(restoreModal)} onClose={() => setRestoreModal(null)} title="بازیابی از نسخه پشتیبان"
        footer={<><Button variant="ghost" onClick={() => setRestoreModal(null)}>انصراف</Button><Button variant="danger" loading={busy} onClick={restore} disabled={restoreConfirm !== 'RESTORE' || restorePassword.length < 1}>بازیابی</Button></>}>
        <div className="space-y-3">
          <p className="rounded-xl bg-rose-50 p-3 text-xs leading-6 text-rose-900">
            این عملیات داده‌های فعلی (مشتریان، فاکتورها، تنظیمات) را با نسخه انتخابی جایگزین می‌کند.
            برای ادامه عبارت <code dir="ltr" className="font-bold">RESTORE</code> را وارد کنید و رمز عبور خود را تأیید نمایید.
          </p>
          <Field label="عبارت تأیید" required><Input value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} dir="ltr" className="text-left" /></Field>
          <Field label="رمز عبور شما" required><Input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} dir="ltr" className="text-left" /></Field>
        </div>
      </Modal>
    </AppShell>
  );
}

/* ---------------------------------- audit --------------------------------- */

export function AdminAudit() {
  const { notify } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');

  const load = () => {
    setLoading(true);
    api.list<any>('/api/system/audit', { page, pageSize: 30, action: action || undefined })
      .then((res) => { setItems(res.data); setTotal(res.total); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page, action]);

  return (
    <AppShell variant="admin">
      <PageHeader title="تاریخچه عملیات" description="هر تغییر حساس با کاربر، زمان و IP ثبت می‌شود." />
      <div className="card mb-4 flex items-center gap-2 p-3">
        <Search className="size-4 text-navy-400" />
        <input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="فیلتر بر اساس نوع عملیات (مثلاً invoice.create)…" className="w-full bg-transparent py-1.5 text-sm outline-none" dir="ltr" />
      </div>

      {loading && <Loading />}
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>زمان</th><th>کاربر</th><th>عملیات</th><th>موجودیت</th><th>IP</th></tr></thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="text-[11px]">{faDateTime(row.createdAt ?? row.created_at)}</td>
                  <td className="text-xs">{row.actorName ?? row.actor_name ?? 'سیستم'}</td>
                  <td dir="ltr" className="text-left text-[11px] font-medium text-accent">{row.action}</td>
                  <td className="text-[11px] text-navy-500">{row.entityType ?? row.entity_type} {row.entityId ?? row.entity_id ? `• ${(row.entityId ?? row.entity_id).slice(0, 10)}…` : ''}</td>
                  <td dir="ltr" className="text-left text-[11px] text-navy-400">{row.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && <EmptyState title="رکوردی یافت نشد" />}
      </Card>

      {total > 30 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
          <span className="text-sm text-navy-500">صفحه {faNum(page)} از {faNum(Math.ceil(total / 30))}</span>
          <Button size="sm" variant="ghost" disabled={page * 30 >= total} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
        </div>
      )}
    </AppShell>
  );
}
