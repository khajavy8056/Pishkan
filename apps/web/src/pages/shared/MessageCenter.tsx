import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Paperclip, Plus, Lock, Unlock, Link2, User, Search } from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import { Button, Card, EmptyState, Field, Input, Loading, Modal, Select, StatusBadge, useToast } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDateTime, faNum } from '../../lib/format';
import { bytes } from '../../components/documents';

export function MessageCenter({ variant }: { variant: 'staff' | 'admin' }) {
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const { notify } = useToast();
  const [threads, setThreads] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({ customerId: '', subject: '', message: '' });
  const fileInput = useRef<HTMLInputElement>(null);

  const loadThreads = async () => {
    const res = await api.list<any>('/api/messages/threads', { pageSize: 100 });
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
        const list = await loadThreads();
        if (requestId) {
          const created = await api.post<{ data: any }>('/api/messages/threads', { requestId });
          const fresh = await loadThreads();
          const thread = fresh.find((t: any) => t.id === created.data.id);
          if (thread) await openThread(thread);
        } else if (list[0]) {
          await openThread(list[0]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [requestId]);

  const refreshActive = async () => {
    if (!active) return;
    const res = await api.get<{ data: any }>(`/api/messages/threads/${active.id}`);
    setMessages(res.data.messages);
  };

  const send = async (fileId?: string) => {
    if (!active || (!text.trim() && !fileId)) return;
    setSending(true);
    try {
      await api.post(`/api/messages/threads/${active.id}/messages`, { body: text || 'فایل پیوست', fileId });
      setText('');
      await refreshActive();
      await loadThreads();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ارسال', 'error');
    } finally { setSending(false); }
  };

  const attach = async (file: File) => {
    try {
      const uploaded = await api.upload<{ data: { id: string; savingsPercent?: number; processing?: { status?: string } } }>('/api/files/upload', file, { purpose: 'chat' });
      if (uploaded.data.processing?.status === 'failed') {
        notify('پیوست ارسال شد اما بهینه‌سازی تصویر انجام نشد؛ نسخه اصلی سالم ذخیره شده است.', 'info');
      } else if ((uploaded.data.savingsPercent ?? 0) >= 5) {
        notify(`پیوست بهینه شد؛ ${faNum(Math.round(uploaded.data.savingsPercent ?? 0))}٪ کاهش حجم.`, 'success');
      }
      await send(uploaded.data.id);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در بارگذاری فایل', 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const toggleStatus = async () => {
    if (!active) return;
    try {
      await api.patch(`/api/messages/threads/${active.id}`, { status: active.status === 'open' ? 'closed' : 'open' });
      notify('وضعیت گفت‌وگو به‌روزرسانی شد.', 'success');
      const list = await loadThreads();
      const thread = list.find((t: any) => t.id === active.id);
      if (thread) setActive(thread);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const openCreate = async () => {
    setCreating(true);
    if (customers.length === 0) {
      const res = await api.list<any>('/api/customers', { pageSize: 200 }).catch(() => ({ data: [] } as any));
      setCustomers(res.data);
    }
  };

  const create = async () => {
    try {
      const res = await api.post<{ data: any }>('/api/messages/threads', form);
      const list = await loadThreads();
      const thread = list.find((t: any) => t.id === res.data.id);
      if (thread) await openThread(thread);
      setCreating(false);
      setForm({ customerId: '', subject: '', message: '' });
      notify('گفت‌وگو ایجاد شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const filtered = threads.filter((thread) => {
    if (!search.trim()) return true;
    const q = search.trim();
    return (thread.subject ?? '').includes(q) || (thread.customerName ?? '').includes(q) || (thread.lastMessage ?? '').includes(q);
  });

  return (
    <AppShell variant={variant}>
      <PageHeader title="گفت‌وگوها" description="پیام‌های مشتریان، گفت‌وگوی عمومی دفتر و مکالمه‌های مرتبط با پرونده."
        actions={<Button size="sm" onClick={openCreate}><Plus className="size-4" /> گفت‌وگوی جدید</Button>} />

      {loading && <Loading />}

      {!loading && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card pad={false} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search className="size-4 text-navy-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجو در گفت‌وگوها…" className="w-full bg-transparent py-1 text-sm outline-none" />
            </div>
            <div className="max-h-[62vh] overflow-y-auto scrollbar-thin">
              {filtered.length === 0 && <p className="px-4 py-6 text-sm text-navy-400">گفت‌وگویی یافت نشد.</p>}
              {filtered.map((thread) => (
                <button key={thread.id} onClick={() => openThread(thread)}
                  className={clsx('flex w-full items-start justify-between gap-2 border-b border-navy-900/5 px-4 py-3 text-right transition hover:bg-surface-3',
                    active?.id === thread.id && 'bg-brand-50/60')}>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      {thread.scope === 'request' && <Link2 className="size-3 text-accent" />}
                      <span className="truncate text-sm font-medium text-navy-900">{thread.subject}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-navy-500">{thread.customerName} • {thread.lastMessage ?? ''}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {thread.unread > 0 && <span className="badge bg-rose-600 text-white">{faNum(thread.unread)}</span>}
                    {thread.status === 'closed' && <Lock className="size-3 text-navy-400" />}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          <Card pad={false} className="flex h-[66vh] flex-col overflow-hidden">
            {!active ? (
              <div className="grid flex-1 place-items-center text-sm text-navy-400">یک گفت‌وگو را انتخاب کنید.</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-navy-900">{active.subject}</p>
                    <p className="text-[11px] text-navy-500">
                      {active.customerName} • {active.scope === 'request' ? 'مرتبط با پرونده' : 'گفت‌وگوی عمومی'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={active.status} />
                    <Button size="sm" variant="ghost" onClick={toggleStatus}>
                      {active.status === 'open' ? <><Lock className="size-3.5" /> بستن</> : <><Unlock className="size-3.5" /> بازگشایی</>}
                    </Button>
                  </div>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
                  {messages.map((message) => {
                    const mine = message.senderRole !== 'customer';
                    return (
                      <div key={message.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                        <div className={clsx('max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                          mine ? 'bg-brand-700 text-white' : 'bg-surface-3 text-navy-800')}>
                          <p className="whitespace-pre-wrap">{message.body}</p>
                          {message.fileId && (
                            <div className={clsx('mt-1.5 space-y-1', mine && 'text-white/80')}>
                              {String(message.file?.mime ?? '').startsWith('image/') && (
                                <a href={`/api/files/${message.fileId}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-black/10 bg-surface/70">
                                  <img
                                    src={`/api/files/${message.fileId}?variant=preview`}
                                    alt={message.file?.name ?? 'پیوست تصویری'}
                                    loading="lazy"
                                    className="max-h-48 w-auto object-contain"
                                  />
                                </a>
                              )}
                              <a href={`/api/files/${message.fileId}`} target="_blank" rel="noreferrer" className={clsx('inline-flex max-w-full items-center gap-1 text-[11px] underline', mine ? 'text-white/80' : 'text-accent')}>
                                <Paperclip className="size-3 shrink-0" />
                                <span className="truncate">{message.file?.name ?? 'فایل پیوست'}</span>
                                {message.file?.size ? <span className="shrink-0 opacity-70">({bytes(message.file.size)})</span> : null}
                              </a>
                            </div>
                          )}
                          <p className={clsx('mt-1 text-[10px]', mine ? 'text-white/80' : 'text-navy-400')}>
                            {message.senderName ?? 'کاربر'} • {faDateTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 border-t border-line p-3">
                  <input ref={fileInput} type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.pdf"
                    onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
                  <Button variant="ghost" onClick={() => fileInput.current?.click()} aria-label="پیوست فایل"><Paperclip className="size-4" /></Button>
                  <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder={active.status === 'closed' ? 'این گفت‌وگو بسته است.' : 'پاسخ خود را بنویسید…'}
                    disabled={active.status === 'closed'} className="input" aria-label="متن پیام" />
                  <Button onClick={() => send()} loading={sending} disabled={active.status === 'closed'}><Send className="size-4" /></Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="گفت‌وگوی جدید"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>انصراف</Button><Button onClick={create} disabled={!form.customerId}>ایجاد</Button></>}>
        <div className="space-y-3">
          <Field label="مشتری" required>
            <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} placeholder="انتخاب مشتری"
              options={customers.map((c) => ({ value: c.id, label: `${c.fullName} — ${c.mobile}` }))} />
          </Field>
          <Field label="موضوع" required><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="پیام اول"><Input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
        </div>
      </Modal>
    </AppShell>
  );
}
