import { FormEvent, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  Headset, Inbox, MessageSquareText, Paperclip, Plus, SendHorizonal, Star, StickyNote,
  CheckCircle2, UserRound, X,
} from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, SectionTitle, Select,
  StatCard, Tabs, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum } from '../../lib/format';

type Mode = 'customer' | 'staff' | 'admin';

const STATUS_LABELS: Record<string, string> = {
  open: 'باز', answered: 'پاسخ داده‌شده', waiting_customer: 'منتظر پاسخ مشتری',
  resolved: 'حل‌شده', closed: 'بسته‌شده',
};
const STATUS_TONES: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  open: 'warning', answered: 'info', waiting_customer: 'warning', resolved: 'success', closed: 'default',
};
const PRIORITY_LABELS: Record<string, string> = { low: 'کم', normal: 'معمولی', high: 'زیاد', urgent: 'فوری' };

function SupportCore({ mode }: { mode: Mode }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const staffSide = mode !== 'customer';

  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('open');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [attach, setAttach] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ subject: '', department: 'general', priority: 'normal', requestId: '', body: '' });
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [rating, setRating] = useState(0);
  const [ratingNote, setRatingNote] = useState('');

  const loadTickets = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { pageSize: 50 };
      if (tab === 'mine') params.mine = 'true';
      else if (tab === 'unassigned') params.unassigned = 'true';
      else if (tab !== 'all') params.status = tab;
      if (search.trim()) params.q = search.trim();
      const res = await api.list<any>('/api/support/tickets', params);
      setTickets(res.data ?? []);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'دریافت تیکت‌ها ناموفق بود.', 'error');
    } finally { setLoading(false); }
  };

  const loadDetail = async (id: string) => {
    try {
      const res = await api.get<{ data: any }>(`/api/support/tickets/${id}`);
      setDetail(res.data);
      setRating(0);
      setRatingNote('');
      setTickets((current) => current.map((t) => (t.id === id
        ? { ...t, unreadForStaff: staffSide ? 0 : t.unreadForStaff, unreadForCustomer: staffSide ? t.unreadForCustomer : 0 }
        : t)));
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت گفت‌وگو', 'error');
      setSelectedId(null);
    }
  };

  const loadStats = async () => {
    if (!staffSide) return;
    try {
      const res = await api.get<{ data: any }>('/api/support/stats');
      setStats(res.data);
    } catch { /* stats are best-effort */ }
  };

  useEffect(() => { void loadTickets(); }, [tab]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId]);
  useEffect(() => {
    void loadStats();
    api.get<{ data: any }>('/api/support/meta').then((r) => setMeta(r.data)).catch(() => undefined);
    if (!staffSide) {
      api.list<any>('/api/requests', { pageSize: 50 }).then((r) => setMyRequests(r.data ?? [])).catch(() => undefined);
    }
  }, []);

  const sendReply = async () => {
    if (!detail || !reply.trim()) return;
    setBusy('reply');
    try {
      const res = await api.post<{ data: any }>(`/api/support/tickets/${detail.id}/reply`, {
        body: reply.trim(),
        internal: staffSide && internal,
        fileId: attach?.id,
      });
      setDetail(res.data);
      setReply('');
      setAttach(null);
      void loadTickets();
      void loadStats();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ارسال پاسخ ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const patchTicket = async (patch: Record<string, unknown>, label: string) => {
    if (!detail) return;
    setBusy(label);
    try {
      const res = await api.patch<{ data: any }>(`/api/support/tickets/${detail.id}`, patch);
      setDetail(res.data);
      notify('تیکت به‌روزرسانی شد.', 'success');
      void loadTickets();
      void loadStats();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(''); }
  };

  const uploadAttachment = async (file: File) => {
    setBusy('upload');
    try {
      const res = await api.upload<{ data: { id: string; name?: string; originalName?: string } }>('/api/files', file, { category: 'support' });
      setAttach({ id: res.data.id, name: res.data.originalName ?? res.data.name ?? file.name });
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری فایل ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('create');
    try {
      const res = await api.post<{ data: any }>('/api/support/tickets', {
        department: createForm.department,
        subject: createForm.subject.trim(),
        body: createForm.body.trim(),
        priority: createForm.priority,
        requestId: createForm.requestId || null,
      });
      setCreateOpen(false);
      setCreateForm({ subject: '', department: 'general', priority: 'normal', requestId: '', body: '' });
      notify(`تیکت ${res.data.number} ثبت شد؛ پاسخ کارشناسان در همین صفحه اطلاع‌رسانی می‌شود.`, 'success');
      setTab('open');
      void loadTickets();
      setSelectedId(res.data.id);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت تیکت ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const submitRating = async () => {
    if (!detail || rating < 1) return;
    setBusy('rate');
    try {
      const res = await api.post<{ data: any }>(`/api/support/tickets/${detail.id}/rate`, {
        rating, note: ratingNote.trim() || undefined,
      });
      setDetail(res.data);
      notify('امتیاز شما ثبت شد؛ ممنون از بازخوردتان.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(''); }
  };

  const tabs = staffSide
    ? [
        { key: 'open', label: 'باز (نیازمند پاسخ)' },
        { key: 'answered', label: 'پاسخ داده‌شده' },
        { key: 'mine', label: 'اختصاص به من' },
        { key: 'unassigned', label: 'بدون کارشناس' },
        { key: 'resolved', label: 'حل‌شده' },
        { key: 'closed', label: 'بسته‌شده' },
        { key: 'all', label: 'همه' },
      ]
    : [
        { key: 'open', label: 'باز' },
        { key: 'answered', label: 'پاسخ داده‌شده' },
        { key: 'resolved', label: 'حل‌شده' },
        { key: 'closed', label: 'بسته‌شده' },
        { key: 'all', label: 'همه' },
      ];

  const ticketClosed = detail?.status === 'closed';
  const canRate = !staffSide && detail && detail.status === 'resolved' && !detail.rating;
  const unreadOf = (ticket: any) => (staffSide ? ticket.unreadForStaff : ticket.unreadForCustomer) ?? 0;

  return (
    <div>
      {staffSide && stats && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="تیکت باز" value={faNum(stats.open ?? 0)} icon={<Inbox className="size-5" />} />
          <StatCard label="بدون کارشناس" value={faNum(stats.unassigned ?? 0)} icon={<UserRound className="size-5" />} />
          <StatCard label="اختصاص به من (باز)" value={faNum(stats.mine ?? 0)} icon={<Headset className="size-5" />} />
          <StatCard label="پیام خوانده‌نشدهٔ مشتری" value={faNum(stats.unread ?? 0)} icon={<MessageSquareText className="size-5" />} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Tabs tabs={tabs} active={tab} onChange={(key) => { setTab(key); setSelectedId(null); }} />
            {!staffSide && (
              <Button size="sm" className="ms-auto" onClick={() => setCreateOpen(true)} disabled={meta?.enabled === false}>
                <Plus className="size-4" /> تیکت جدید
              </Button>
            )}
          </div>
          {!staffSide && meta?.enabled === false && (
            <p className="mb-3 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900 ring-1 ring-amber-200">
              ثبت تیکت جدید در حال حاضر از طرف دفتر غیرفعال است.
            </p>
          )}
          <div className="mb-3 flex gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو در عنوان یا شماره تیکت…" />
            <Button variant="ghost" onClick={() => void loadTickets()}>جستجو</Button>
          </div>
          {loading ? <Loading rows={4} /> : tickets.length === 0 ? (
            <EmptyState title="تیکتی در این وضعیت نیست." description={staffSide ? 'تیکت‌های جدید مشتریان اینجا نمایش داده می‌شوند.' : 'با دکمه «تیکت جدید» اولین پرسشتان را بپرسید.'} icon={<Inbox className="size-6" />} />
          ) : (
            <ul className="divide-y divide-line">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <button type="button" onClick={() => setSelectedId(ticket.id)}
                    className={clsx('flex w-full flex-col gap-1 rounded-xl px-3 py-3 text-start transition',
                      selectedId === ticket.id ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-surface-3')}>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-bold text-navy-900">{ticket.subject}</span>
                      {unreadOf(ticket) > 0 && <span className="badge bg-rose-600 text-white">{faNum(unreadOf(ticket))} جدید</span>}
                      {ticket.priority === 'urgent' && <Badge tone="warning">فوری</Badge>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-[11px] text-navy-500">
                      <span dir="ltr">{ticket.number}</span>
                      {staffSide && <span>{ticket.customerName}</span>}
                      <span>{ticket.departmentLabel}</span>
                      <span className="ms-auto"><Badge tone={STATUS_TONES[ticket.status] ?? 'default'}>{STATUS_LABELS[ticket.status] ?? ticket.status}</Badge></span>
                    </span>
                    {ticket.lastMessage && <span className="line-clamp-1 text-xs text-navy-500">{ticket.lastMessage}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          {!detail ? (
            <EmptyState title="یک تیکت را انتخاب کنید." description="گفت‌وگو و جزئیات تیکت اینجا نمایش داده می‌شود." icon={<MessageSquareText className="size-6" />} />
          ) : (
            <div>
              <div className="flex flex-wrap items-start gap-3 border-b border-line pb-3">
                <div className="flex-1">
                  <h2 className="font-bold text-navy-900">{detail.subject}</h2>
                  <p className="mt-1 text-[11px] leading-5 text-navy-500">
                    <span dir="ltr">{detail.number}</span> · {detail.customerName} · {detail.departmentLabel} ·
                    اولویت {PRIORITY_LABELS[detail.priority] ?? detail.priority} · ثبت: {faDateTime(detail.createdAt)}
                    {detail.assigneeName && <> · کارشناس: {detail.assigneeName}</>}
                    {detail.requestTrackingCode && <> · پروندهٔ <span dir="ltr">{detail.requestTrackingCode}</span></>}
                  </p>
                </div>
                <Badge tone={STATUS_TONES[detail.status] ?? 'default'}>{STATUS_LABELS[detail.status] ?? detail.status}</Badge>
                {detail.rating && (
                  <span className="flex items-center gap-1 text-xs text-amber-600">
                    <Star className="size-4 fill-amber-400 text-amber-400" /> {faNum(detail.rating)} از ۵
                  </span>
                )}
              </div>

              {staffSide && (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-surface-3 p-3">
                  <Field label="وضعیت">
                    <Select value={detail.status} onChange={(e) => void patchTicket({ status: e.target.value }, 'status')}
                      options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
                  </Field>
                  <Field label="اولویت">
                    <Select value={detail.priority} onChange={(e) => void patchTicket({ priority: e.target.value }, 'priority')}
                      options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} />
                  </Field>
                  <Field label="بخش">
                    <Select value={detail.department} onChange={(e) => void patchTicket({ department: e.target.value }, 'department')}
                      options={(meta?.departments ?? []).map((d: any) => ({ value: d.value, label: d.label }))} />
                  </Field>
                  {detail.assignedTo !== user?.id && (
                    <Button size="sm" variant="ghost" loading={busy === 'assign'} onClick={() => void patchTicket({ assignedTo: user?.id }, 'assign')}>
                      <UserRound className="size-4" /> اختصاص به من
                    </Button>
                  )}
                  {detail.status !== 'resolved' && detail.status !== 'closed' && (
                    <Button size="sm" variant="ghost" onClick={() => void patchTicket({ status: 'resolved' }, 'resolve')}>
                      <CheckCircle2 className="size-4" /> حل‌شده
                    </Button>
                  )}
                </div>
              )}

              <div className="mt-4 space-y-3">
                {(detail.messages ?? []).map((message: any) => {
                  const fromCustomer = message.senderRole === 'customer';
                  const mine = staffSide ? !fromCustomer : fromCustomer;
                  return (
                    <div key={message.id} className={clsx('flex', mine ? 'justify-start' : 'justify-end')}>
                      <div className={clsx('max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-7',
                        message.isInternal
                          ? 'border border-amber-300 bg-amber-50 text-amber-950'
                          : mine ? 'bg-brand-50 text-navy-900' : 'bg-surface-3 text-navy-900')}>
                        <p className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-navy-500">
                          <b className="text-navy-700">{message.senderName ?? (fromCustomer ? 'مشتری' : 'پشتیبانی')}</b>
                          {message.isInternal && <span className="flex items-center gap-1 font-bold text-amber-700"><StickyNote className="size-3" /> یادداشت داخلی — مشتری نمی‌بیند</span>}
                          <span>{faDateTime(message.createdAt)}</span>
                        </p>
                        <p className="whitespace-pre-wrap">{message.body}</p>
                        {message.fileId && (
                          <a href={`/api/files/${message.fileId}/download`} target="_blank" rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-[11px] font-bold text-brand-700 ring-1 ring-line hover:bg-white">
                            <Paperclip className="size-3" /> مشاهدهٔ پیوست
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {canRate && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm font-bold text-emerald-900">مسئلهٔ شما حل شد؛ از کیفیت پشتیبانی راضی بودید؟</p>
                  <div className="mt-2 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star} type="button" aria-label={`امتیاز ${star}`} onClick={() => setRating(star)} className="p-0.5">
                        <Star className={clsx('size-6', star <= rating ? 'fill-amber-400 text-amber-400' : 'text-navy-300')} />
                      </button>
                    ))}
                  </div>
                  <Textarea className="mt-2" rows={2} value={ratingNote} onChange={(e) => setRatingNote(e.target.value)} placeholder="نظر شما (اختیاری)" />
                  <Button size="sm" className="mt-2" loading={busy === 'rate'} disabled={rating < 1} onClick={() => void submitRating()}>ثبت امتیاز</Button>
                </div>
              )}

              {!ticketClosed || staffSide ? (
                <div className="mt-4 border-t border-line pt-3">
                  {ticketClosed && staffSide && (
                    <p className="mb-2 text-[11px] text-navy-400">تیکت بسته است؛ فقط یادداشت داخلی می‌توانید اضافه کنید.</p>
                  )}
                  {staffSide && (
                    <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-bold text-amber-800">
                      <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-4 accent-amber-600" />
                      یادداشت داخلی (فقط همکاران)
                    </label>
                  )}
                  <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
                    placeholder={internal ? 'یادداشت داخلی برای همکاران…' : staffSide ? 'پاسخ به مشتری…' : 'پیام خود را بنویسید…'} />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="btn btn-ghost btn-sm cursor-pointer">
                      <Paperclip className="size-4" /> پیوست
                      <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadAttachment(e.target.files[0])} />
                    </label>
                    {attach && (
                      <span className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-[11px] text-navy-700">
                        {attach.name}
                        <button type="button" aria-label="حذف پیوست" onClick={() => setAttach(null)}><X className="size-3.5" /></button>
                      </span>
                    )}
                    <Button className="ms-auto" loading={busy === 'reply' || busy === 'upload'}
                      disabled={!reply.trim() || (ticketClosed && staffSide && !internal)}
                      onClick={() => void sendReply()}>
                      <SendHorizonal className="size-4" /> ارسال{internal ? ' یادداشت' : ''}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-surface-3 p-3 text-center text-xs text-navy-500">
                  این تیکت بسته شده است؛ برای موضوع جدید یک تیکت تازه ثبت کنید.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="ثبت تیکت پشتیبانی"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>انصراف</Button>
            <Button type="submit" form="support-create-form" loading={busy === 'create'}>ارسال تیکت</Button>
          </>
        )}>
        <form id="support-create-form" onSubmit={submitCreate} className="space-y-4">
          <Field label="عنوان" required>
            <Input value={createForm.subject} onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })} placeholder="موضوع را کوتاه بنویسید" maxLength={160} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="بخش مربوط" required>
              <Select value={createForm.department} onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })}
                options={(meta?.departments ?? []).map((d: any) => ({ value: d.value, label: d.label }))} />
            </Field>
            <Field label="اولویت">
              <Select value={createForm.priority} onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}
                options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} />
            </Field>
          </div>
          <Field label="دربارهٔ کدام پرونده؟" hint="اگر پرسشتان دربارهٔ یک درخواست خاص است آن را انتخاب کنید تا کارشناس سریع‌تر بررسی کند.">
            <Select value={createForm.requestId} onChange={(e) => setCreateForm({ ...createForm, requestId: e.target.value })}
              options={[{ value: '', label: 'مرتبط با پرونده‌ای نیست' }, ...myRequests.map((r) => ({ value: r.id, label: `${r.trackingCode ?? r.code ?? ''} — ${r.serviceTitle ?? ''}` }))]} />
          </Field>
          <Field label="شرح درخواست" required>
            <Textarea rows={4} value={createForm.body} onChange={(e) => setCreateForm({ ...createForm, body: e.target.value })} required minLength={5} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

export function CustomerSupportPage() {
  return (
    <AppShell variant="customer">
      <PageHeader title="پشتیبانی" description="پرسش‌ها و درخواست‌های شما در قالب تیکت ثبت و پاسخ کارشناسان اینجا و با اعلان به شما می‌رسد." />
      <SupportCore mode="customer" />
    </AppShell>
  );
}

export function StaffSupportPage() {
  return (
    <AppShell variant="staff">
      <PageHeader title="تیکت‌های پشتیبانی" description="پاسخ‌گویی به مشتریان، یادداشت داخلی و مدیریت وضعیت تیکت‌ها." />
      <SupportCore mode="staff" />
    </AppShell>
  );
}

export function AdminSupportPage() {
  return (
    <AppShell variant="admin">
      <PageHeader title="مدیریت پشتیبانی" description="نظارت بر همهٔ تیکت‌ها و کیفیت پاسخ‌گویی به مشتریان." />
      <SectionTitle title="پشتیبانی" description="روشن/خاموش‌کردن بخش پشتیبانی از تنظیمات سامانه (گروه «پشتیبانی») انجام می‌شود." />
      <SupportCore mode="admin" />
    </AppShell>
  );
}
