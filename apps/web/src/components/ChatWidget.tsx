import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight, CheckCheck, ExternalLink, Lock, MessagesSquare, Paperclip, Plus, Send, X,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiFailure } from '../lib/api';
import { useAuth } from '../lib/auth';
import { faNum, relative } from '../lib/format';
import { useToast } from './ui';

const STATUS_LABELS: Record<string, string> = {
  open: 'باز',
  answered: 'پاسخ داده‌شده',
  waiting_customer: 'در انتظار پاسخ شما',
  resolved: 'حل‌شده',
  closed: 'بسته‌شده',
};

const STATUS_TONES: Record<string, string> = {
  open: 'bg-amber-50 text-amber-800 ring-amber-200',
  answered: 'bg-sky-50 text-sky-800 ring-sky-200',
  waiting_customer: 'bg-violet-50 text-violet-800 ring-violet-200',
  resolved: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  closed: 'bg-navy-50 text-navy-500 ring-navy-100',
};

/**
 * Floating support chat, available on every authenticated page. Customers
 * talk to the office; staff see the whole queue and can answer several
 * customers in parallel — conversations are ordinary support tickets, so the
 * full-page message center and this widget always show the same data.
 */
export function ChatWidget() {
  const { user, can } = useAuth();
  const { notify } = useToast();
  const location = useLocation();
  const isCustomer = user?.kind === 'customer';
  const canSupport = isCustomer || can('support.view');

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'thread' | 'compose'>('list');
  const [tickets, setTickets] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [attach, setAttach] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = active?.id ?? null;

  const loadStats = useCallback(async () => {
    try {
      const res = await api.get<{ data: any }>('/api/support/stats');
      setUnreadTotal(Number(res.data?.unread ?? 0));
    } catch { /* non-critical */ }
  }, []);

  const loadTickets = useCallback(async () => {
    try {
      const res = await api.list<any>('/api/support/tickets?pageSize=40');
      setTickets(res.data);
    } catch { /* non-critical */ }
  }, []);

  const openTicket = useCallback(async (ticketId: string) => {
    try {
      const res = await api.get<{ data: any }>(`/api/support/tickets/${ticketId}`);
      setActive(res.data);
      setView('thread');
      setOpen(true);
      void loadStats();
      void loadTickets();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'گفت‌وگو باز نشد.', 'error');
    }
  }, [loadStats, loadTickets, notify]);

  // Badge polling (always), list/thread polling (while the panel is open).
  useEffect(() => {
    if (!canSupport) return;
    void loadStats();
    const timer = setInterval(loadStats, 20_000);
    return () => clearInterval(timer);
  }, [canSupport, loadStats]);

  useEffect(() => {
    if (!open) return;
    void loadTickets();
    const timer = setInterval(() => {
      void loadTickets();
      const id = activeIdRef.current;
      if (id) {
        api.get<{ data: any }>(`/api/support/tickets/${id}`)
          .then((res) => setActive(res.data))
          .catch(() => undefined);
      }
    }, 8_000);
    return () => clearInterval(timer);
  }, [open, loadTickets]);

  // Deep links: bell notifications ("pishkan:open-chat") and push clicks (?chat=).
  useEffect(() => {
    const handler = (event: Event) => {
      const ticketId = (event as CustomEvent<{ ticketId?: string }>).detail?.ticketId;
      if (ticketId) void openTicket(ticketId);
      else { setOpen(true); setView('list'); void loadTickets(); }
    };
    window.addEventListener('pishkan:open-chat', handler);
    return () => window.removeEventListener('pishkan:open-chat', handler);
  }, [openTicket, loadTickets]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ticketId = params.get('chat');
    if (ticketId) {
      void openTicket(ticketId);
      params.delete('chat');
      const rest = params.toString();
      window.history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
    }
    // Only react to the query string, not every location object change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [active?.messages?.length, view]);

  if (!user || !canSupport) return null;

  const uploadAttachment = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.upload<{ data: any }>('/api/files/upload', file, { purpose: 'support' });
      setAttach({ id: res.data.id, name: res.data.name });
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری پیوست ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  const sendReply = async () => {
    if (!active || draft.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: any }>(`/api/support/tickets/${active.id}/reply`, {
        body: draft.trim(),
        fileId: attach?.id,
        internal: !isCustomer && internal ? true : undefined,
      });
      setActive(res.data);
      setDraft('');
      setAttach(null);
      setInternal(false);
      void loadTickets();
      void loadStats();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ارسال پیام ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  const createConversation = async () => {
    if (composeBody.trim().length < 5) {
      notify('پیام خود را کمی کامل‌تر بنویسید (حداقل چند کلمه).', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: any }>('/api/support/tickets', {
        department: 'general',
        subject: composeSubject.trim() || 'گفت‌وگوی پشتیبانی',
        body: composeBody.trim(),
        fileId: attach?.id,
      });
      setActive(res.data);
      setView('thread');
      setComposeSubject('');
      setComposeBody('');
      setAttach(null);
      void loadTickets();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت گفت‌وگو ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  const setStatus = async (status: 'resolved' | 'closed' | 'open') => {
    if (!active) return;
    setBusy(true);
    try {
      const res = await api.patch<{ data: any }>(`/api/support/tickets/${active.id}`, { status });
      setActive(res.data);
      void loadTickets();
      notify(status === 'open' ? 'گفت‌وگو دوباره باز شد.' : 'وضعیت گفت‌وگو به‌روز شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'تغییر وضعیت ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  const fullPagePath = isCustomer ? '/app/support' : user.kind === 'admin' ? '/admin/support' : '/staff/support';
  const unreadOf = (ticket: any) => (isCustomer ? ticket.unreadForCustomer : ticket.unreadForStaff) ?? 0;

  return (
    <>
      {/* Floating action button */}
      <button
        type="button"
        aria-label="پیام‌ها و پشتیبانی"
        onClick={() => { setOpen((v) => !v); if (!open) { setView(active ? 'thread' : 'list'); void loadTickets(); } }}
        className="fixed bottom-20 left-4 z-40 grid size-14 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-shell text-white shadow-2xl ring-1 ring-white/30 transition hover:scale-105 lg:bottom-6 lg:left-6"
      >
        {open ? <X className="size-6" /> : <MessagesSquare className="size-6" />}
        {!open && unreadTotal > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-6 place-items-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] font-black text-white ring-2 ring-surface">
            {faNum(unreadTotal)}
          </span>
        )}
      </button>

      {open && (
        <section
          aria-label="پنجرهٔ گفت‌وگو"
          className="animate-pop fixed bottom-36 left-4 z-40 flex h-[min(34rem,calc(100dvh-10rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl lg:bottom-24 lg:left-6"
        >
          {/* Header */}
          <header className="flex items-center gap-2 bg-gradient-to-l from-brand-700 to-shell px-4 py-3 text-white">
            {view !== 'list' && (
              <button type="button" aria-label="بازگشت به فهرست گفت‌وگوها"
                className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/15"
                onClick={() => { setView('list'); setActive(null); void loadTickets(); void loadStats(); }}>
                <ArrowRight className="size-5" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">
                {view === 'thread' && active
                  ? (isCustomer ? active.subject : `${active.customerName ?? 'مشتری'} — ${active.subject}`)
                  : view === 'compose' ? 'گفت‌وگوی جدید' : 'پیام‌ها و پشتیبانی'}
              </p>
              <p className="truncate text-[10px] text-white/70">
                {view === 'thread' && active
                  ? `${active.number} · ${STATUS_LABELS[active.status] ?? active.status}${active.requestTrackingCode ? ` · پرونده ${active.requestTrackingCode}` : ''}`
                  : isCustomer ? 'پاسخ را در همین پنجره دریافت می‌کنید' : 'صف گفت‌وگوهای مشتریان'}
              </p>
            </div>
            <Link to={fullPagePath} aria-label="بازکردن صفحهٔ کامل پیام‌ها"
              className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/15"
              onClick={() => setOpen(false)}>
              <ExternalLink className="size-4" />
            </Link>
            <button type="button" aria-label="بستن پنجرهٔ گفت‌وگو"
              className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/15"
              onClick={() => setOpen(false)}>
              <X className="size-5" />
            </button>
          </header>

          {view === 'list' && (
            <>
              <div className="scrollbar-thin flex-1 overflow-y-auto">
                {tickets.length === 0 && (
                  <div className="px-6 py-12 text-center">
                    <MessagesSquare className="mx-auto size-10 text-navy-200" />
                    <p className="mt-3 text-sm font-medium text-navy-700">
                      {isCustomer ? 'هنوز گفت‌وگویی ندارید' : 'گفت‌وگویی در صف نیست'}
                    </p>
                    <p className="mt-1 text-xs leading-6 text-navy-400">
                      {isCustomer ? 'هر سؤال یا مسئله‌ای دارید، همین‌جا برای ما بنویسید.' : 'به‌محض پیام مشتری، اینجا نمایش داده می‌شود و خبردار می‌شوید.'}
                    </p>
                  </div>
                )}
                {tickets.map((ticket) => (
                  <button key={ticket.id} type="button" onClick={() => void openTicket(ticket.id)}
                    className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-right transition last:border-0 hover:bg-surface-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-black text-accent ring-1 ring-brand-100">
                      {(isCustomer ? 'پ' : ticket.customerName?.slice(0, 1)) ?? '؟'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={clsx('min-w-0 flex-1 truncate text-sm', unreadOf(ticket) > 0 ? 'font-black text-navy-950' : 'font-medium text-navy-800')}>
                          {isCustomer ? ticket.subject : `${ticket.customerName ?? 'مشتری'} · ${ticket.subject}`}
                        </span>
                        <span className="shrink-0 text-[10px] text-navy-400">{ticket.lastMessageAt ? relative(ticket.lastMessageAt) : ''}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-1 block text-xs text-navy-500">{ticket.lastMessage ?? ''}</span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <span className={clsx('rounded-full px-2 py-0.5 text-[9px] font-bold ring-1', STATUS_TONES[ticket.status] ?? STATUS_TONES.open)}>
                          {STATUS_LABELS[ticket.status] ?? ticket.status}
                        </span>
                        <span className="text-[9px] text-navy-400">{ticket.number}</span>
                        {!isCustomer && ticket.assigneeName && <span className="text-[9px] text-navy-400">مسئول: {ticket.assigneeName}</span>}
                      </span>
                    </span>
                    {unreadOf(ticket) > 0 && (
                      <span className="grid min-w-5 shrink-0 place-items-center self-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
                        {faNum(unreadOf(ticket))}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {isCustomer && (
                <div className="border-t border-line p-3">
                  <button type="button" onClick={() => setView('compose')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700">
                    <Plus className="size-4" /> گفت‌وگوی جدید
                  </button>
                </div>
              )}
            </>
          )}

          {view === 'compose' && (
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy-600">موضوع (اختیاری)</span>
                <input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} maxLength={160}
                  placeholder="مثلاً: سؤال دربارهٔ وضعیت پرونده‌ام"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </label>
              <label className="block flex-1">
                <span className="mb-1 block text-xs font-medium text-navy-600">پیام شما</span>
                <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={6} maxLength={5000}
                  placeholder="سلام، …"
                  className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              </label>
              {attach && (
                <p className="flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-2 text-xs text-navy-700">
                  <Paperclip className="size-3.5 text-accent" /> <span className="min-w-0 flex-1 truncate">{attach.name}</span>
                  <button type="button" className="text-rose-700" onClick={() => setAttach(null)}>حذف</button>
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
                  className="grid size-11 shrink-0 place-items-center rounded-xl border border-line text-navy-500 transition hover:bg-surface-3" aria-label="پیوست فایل">
                  <Paperclip className="size-5" />
                </button>
                <button type="button" disabled={busy || composeBody.trim().length < 5} onClick={() => void createConversation()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50">
                  <Send className="size-4 -scale-x-100" /> ارسال و شروع گفت‌وگو
                </button>
              </div>
            </div>
          )}

          {view === 'thread' && active && (
            <>
              <div ref={scrollRef} className="scrollbar-thin flex flex-1 flex-col gap-2 overflow-y-auto bg-surface-2 px-3 py-3">
                {(active.messages ?? []).map((message: any) => {
                  const mine = message.senderId === user.id;
                  return (
                    <div key={message.id} className={clsx('max-w-[85%] rounded-2xl px-3 py-2 shadow-xs', mine ? 'self-end rounded-bl-md bg-brand-600 text-white' : 'self-start rounded-br-md bg-surface text-navy-800 ring-1 ring-line', message.isInternal && 'bg-amber-50 text-amber-950 ring-amber-200')}>
                      {!mine && message.senderName && (
                        <p className="mb-0.5 text-[10px] font-bold text-accent">{message.senderName}{message.senderRole !== 'customer' ? ' · پشتیبانی' : ''}</p>
                      )}
                      {message.isInternal && (
                        <p className="mb-0.5 flex items-center gap-1 text-[9px] font-bold text-amber-700"><Lock className="size-3" /> یادداشت داخلی — مشتری نمی‌بیند</p>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                      {message.fileId && (
                        <a href={`/api/files/${message.fileId}`} target="_blank" rel="noreferrer"
                          className={clsx('mt-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ring-1', mine ? 'bg-white/15 ring-white/30' : 'bg-surface-3 ring-line')}>
                          <Paperclip className="size-3" /> مشاهدهٔ پیوست
                        </a>
                      )}
                      <p className={clsx('mt-1 flex items-center justify-end gap-1 text-[9px]', mine ? 'text-white/70' : 'text-navy-400')}>
                        {relative(message.createdAt)}
                        {mine && message.readAt && <CheckCheck className="size-3" />}
                      </p>
                    </div>
                  );
                })}
                {(active.messages ?? []).length === 0 && (
                  <p className="py-10 text-center text-xs text-navy-400">هنوز پیامی در این گفت‌وگو نیست.</p>
                )}
              </div>

              {!isCustomer && active.status !== 'closed' && (
                <div className="flex items-center gap-2 border-t border-line px-3 py-2">
                  {active.status !== 'resolved' && (
                    <button type="button" disabled={busy} onClick={() => void setStatus('resolved')}
                      className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100">حل شد</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => void setStatus('closed')}
                    className="rounded-lg bg-navy-50 px-2.5 py-1.5 text-[11px] font-bold text-navy-600 ring-1 ring-navy-100 transition hover:bg-navy-100">بستن گفت‌وگو</button>
                  <label className="ms-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-navy-500">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-3.5 accent-amber-600" />
                    یادداشت داخلی
                  </label>
                </div>
              )}
              {!isCustomer && active.status === 'closed' && (
                <div className="border-t border-line px-3 py-2">
                  <button type="button" disabled={busy} onClick={() => void setStatus('open')}
                    className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100">بازگشایی گفت‌وگو</button>
                </div>
              )}

              {attach && (
                <p className="flex items-center gap-2 border-t border-line bg-surface-3 px-3 py-2 text-xs text-navy-700">
                  <Paperclip className="size-3.5 shrink-0 text-accent" /> <span className="min-w-0 flex-1 truncate">{attach.name}</span>
                  <button type="button" className="shrink-0 text-rose-700" onClick={() => setAttach(null)}>حذف</button>
                </p>
              )}

              <div className="flex items-end gap-2 border-t border-line p-3">
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} aria-label="پیوست فایل"
                  className="grid size-10 shrink-0 place-items-center rounded-xl border border-line text-navy-500 transition hover:bg-surface-3">
                  <Paperclip className="size-5" />
                </button>
                <textarea value={draft} rows={1} maxLength={5000}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendReply(); } }}
                  placeholder={internal ? 'یادداشت داخلی بنویسید…' : 'پیام بنویسید… (Enter برای ارسال)'}
                  className="max-h-28 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <button type="button" disabled={busy || draft.trim().length < 2} onClick={() => void sendReply()} aria-label="ارسال پیام"
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-50">
                  <Send className="size-5 -scale-x-100" />
                </button>
              </div>
            </>
          )}

          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.zip"
            onChange={(e) => { void uploadAttachment(e.target.files?.[0]); e.target.value = ''; }} />
        </section>
      )}
    </>
  );
}
