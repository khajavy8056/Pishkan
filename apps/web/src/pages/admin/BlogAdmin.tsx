import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarClock, Check, Eye, FileText, Globe, ImagePlus, Loader2, Mail, MessageSquare,
  Newspaper, Pencil, Plus, Search, Send, ShieldAlert, Tag, Trash2, X,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Pagination, Select,
  Switch, Tabs, Textarea, useToast,
} from '../../components/ui';
import { GlossyStat, PanelCard } from '../../components/panel';
import { RichTextEditor, estimateReading } from '../../components/RichTextEditor';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDate, faNum, relative } from '../../lib/format';

/**
 * Blog studio (WordPress-style), shared by the admin and staff shells.
 * Everything is permission-driven (`blog.*`): the super admin and the seeded
 * content-manager role see it all; any other employee sees it only when the
 * admin grants blog permissions to their role — and then, without
 * `blog.manage`, only their own posts (the API scopes the list).
 */

type Variant = 'admin' | 'staff';
const baseOf = (variant: Variant) => (variant === 'admin' ? '/admin/blog' : '/staff/blog');

interface Post {
  id: string; slug: string; title: string; subtitle: string | null; excerpt: string; content: string;
  categoryId: string | null; categoryTitle: string | null; tags: string[];
  coverUrl: string | null; coverAlt: string | null; authorId: string; authorName: string | null;
  status: 'draft' | 'published' | 'archived'; statusLabel: string; scheduled: boolean;
  publishedAt: string | null; seoTitle: string | null; seoDescription: string | null;
  canonicalUrl: string | null; noindex: boolean; allowComments: boolean; featured: boolean;
  readingMinutes: number; viewsCount: number; commentsCount: number; pendingComments: number;
  createdAt: string; updatedAt: string;
}

interface Category {
  id: string; slug: string; title: string; description: string | null; icon: string | null;
  color: string | null; sortOrder: number; isActive: boolean; postsCount?: number;
}

interface BlogCommentRow {
  id: string; postId: string; postTitle: string; postSlug: string; authorName: string;
  authorEmail: string | null; body: string; status: string; statusLabel: string; createdAt: string;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'default' | 'info'> = {
  published: 'success', draft: 'warning', archived: 'default',
};

/* ------------------------------------------------------------------ posts */

function PostsTab({ variant }: { variant: Variant }) {
  const base = baseOf(variant);
  const { can, user } = useAuth();
  const { notify } = useToast();
  const [rows, setRows] = useState<Post[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [toDelete, setToDelete] = useState<Post | null>(null);

  const load = useCallback(() => {
    setError('');
    api.list<Post>('/api/blog/posts', { status: status || undefined, q: query || undefined, page, pageSize: 15 })
      .then((res) => { setRows(res.data); setTotal(res.total); })
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت مطالب'));
  }, [status, query, page]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (post: Post, action: 'publish' | 'unpublish') => {
    setBusy(post.id);
    try {
      await api.post(`/api/blog/posts/${post.id}/${action}`);
      notify(action === 'publish' ? 'مطلب منتشر شد.' : 'مطلب از انتشار خارج و پیش‌نویس شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(''); }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(toDelete.id);
    try {
      await api.delete(`/api/blog/posts/${toDelete.id}`);
      notify('مطلب و نظراتش حذف شدند.', 'success');
      setToDelete(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'حذف ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-2xl bg-surface-3 px-3.5 ring-1 ring-line">
          <Search className="size-4 shrink-0 text-navy-400" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="جست‌وجو در عنوان یا پیوند یکتا…"
            className="w-full bg-transparent py-2.5 text-sm text-navy-900 outline-none placeholder:text-navy-400" />
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { value: '', label: 'همه' },
            { value: 'published', label: 'منتشرشده' },
            { value: 'draft', label: 'پیش‌نویس' },
            { value: 'archived', label: 'بایگانی' },
          ].map((s) => (
            <button key={s.value} type="button" onClick={() => { setStatus(s.value); setPage(1); }}
              className={clsx('rounded-full px-3.5 py-2 text-xs font-bold ring-1 transition',
                status === s.value ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
              {s.label}
            </button>
          ))}
        </div>
        {can('blog.create') && (
          <Link to={`${base}/new`} className="btn-gradient btn-md shrink-0"><Plus className="size-4" /> مطلب تازه</Link>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!rows && !error && <Loading rows={4} />}
      {rows?.length === 0 && (
        <EmptyState title="هنوز مطلبی نوشته نشده است"
          description={can('blog.create') ? 'با «مطلب تازه» نخستین مقالهٔ بلاگ را بنویسید.' : 'برای نوشتن مطلب، مجوز ایجاد بلاگ لازم است.'} />
      )}
      {rows && rows.length > 0 && (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr><th>مطلب</th><th>نویسنده</th><th>وضعیت</th><th>بازدید / نظر</th><th>به‌روزرسانی</th><th className="text-left">اقدام</th></tr>
            </thead>
            <tbody>
              {rows.map((post) => (
                <tr key={post.id}>
                  <td>
                    <span className="flex items-center gap-3">
                      {post.coverUrl
                        ? <img src={post.coverUrl} alt="" className="h-10 w-14 shrink-0 rounded-lg object-cover" />
                        : <span className="grid h-10 w-14 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Newspaper className="size-5" /></span>}
                      <span className="min-w-0">
                        <Link to={`${base}/${post.id}/edit`} className="block max-w-72 truncate font-bold text-navy-900 hover:text-brand-700">{post.title}</Link>
                        <span className="block text-[11px] text-navy-400">/blog/{post.slug}{post.categoryTitle ? ` · ${post.categoryTitle}` : ''}</span>
                      </span>
                    </span>
                  </td>
                  <td className="text-xs text-navy-600">{post.authorName}{post.authorId === user?.id ? ' (شما)' : ''}</td>
                  <td>
                    <Badge tone={post.scheduled ? 'info' : STATUS_TONE[post.status]}>{post.statusLabel}</Badge>
                    {post.scheduled && <span className="mt-1 block text-[10px] text-navy-400">{faDate(post.publishedAt)}</span>}
                  </td>
                  <td className="text-xs text-navy-600">
                    <span className="flex items-center gap-1"><Eye className="size-3.5" /> {faNum(post.viewsCount)}</span>
                    <span className="mt-0.5 flex items-center gap-1">
                      <MessageSquare className="size-3.5" /> {faNum(post.commentsCount)}
                      {post.pendingComments > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{faNum(post.pendingComments)} در انتظار</span>}
                    </span>
                  </td>
                  <td className="text-xs text-navy-500">{relative(post.updatedAt)}</td>
                  <td>
                    <span className="flex flex-wrap justify-end gap-1">
                      <Link to={`${base}/${post.id}/edit`} className="btn-ghost btn-sm" title="ویرایش"><Pencil className="size-4" /></Link>
                      {post.status === 'published' && !post.scheduled && (
                        <Link to={`/blog/${encodeURIComponent(post.slug)}`} target="_blank" className="btn-ghost btn-sm" title="مشاهده در سایت"><Globe className="size-4" /></Link>
                      )}
                      {can('blog.publish') && (post.status === 'published'
                        ? <button type="button" className="btn-ghost btn-sm" disabled={busy === post.id} onClick={() => void act(post, 'unpublish')} title="لغو انتشار"><X className="size-4" /></button>
                        : <button type="button" className="btn-ghost btn-sm text-emerald-700" disabled={busy === post.id} onClick={() => void act(post, 'publish')} title="انتشار"><Send className="size-4" /></button>)}
                      {can('blog.delete') && (
                        <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={() => setToDelete(post)} title="حذف"><Trash2 className="size-4" /></button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > 15 && (
        <div className="mt-4 flex justify-center"><Pagination page={page} pageSize={15} total={total} onChange={setPage} /></div>
      )}

      <Modal open={Boolean(toDelete)} onClose={() => setToDelete(null)} title="حذف مطلب"
        footer={<>
          <Button variant="ghost" onClick={() => setToDelete(null)}>انصراف</Button>
          <Button variant="danger" loading={busy === toDelete?.id} onClick={() => void remove()}>حذف قطعی</Button>
        </>}>
        <p className="text-sm leading-7 text-navy-700">
          مطلب «{toDelete?.title}» با همهٔ نظراتش برای همیشه حذف می‌شود و پیوند آن در سایت ۴۰۴ خواهد شد.
        </p>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------- categories */

function CategoriesTab() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('blog.categories');

  const load = useCallback(() => {
    setError('');
    api.get<{ data: Category[] }>('/api/blog/categories').then((r) => setRows(r.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت دسته‌بندی‌ها'));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!editing?.title?.trim()) { notify('عنوان دسته لازم است.', 'error'); return; }
    setBusy(true);
    try {
      const payload = {
        title: editing.title, slug: editing.slug || undefined, description: editing.description || undefined,
        icon: editing.icon || undefined, color: editing.color || undefined,
        sortOrder: Number(editing.sortOrder ?? 0), isActive: editing.isActive !== false,
      };
      if (editing.id) await api.patch(`/api/blog/categories/${editing.id}`, payload);
      else await api.post('/api/blog/categories', payload);
      notify('دسته‌بندی ذخیره شد.', 'success');
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ذخیره ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.delete(`/api/blog/categories/${toDelete.id}`);
      notify('دسته‌بندی حذف شد؛ مطالب آن بدون دسته ماندند.', 'success');
      setToDelete(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'حذف ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-xs leading-6 text-navy-500">دسته‌ها در صفحهٔ بلاگ به‌صورت فیلتر و روی کارت هر مطلب نمایش داده می‌شوند.</p>
        {canManage && (
          <Button className="btn-gradient" size="sm" onClick={() => setEditing({ title: '', slug: '', description: '', icon: '', color: '#2563eb', sortOrder: 0, isActive: true })}>
            <Plus className="size-4" /> دستهٔ تازه
          </Button>
        )}
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!rows && !error && <Loading rows={3} />}
      {rows?.length === 0 && <EmptyState title="دسته‌بندی‌ای تعریف نشده است" />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows?.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-black text-navy-900">
                  <span className="size-3 shrink-0 rounded-full ring-1 ring-navy-900/10" style={{ background: c.color ?? '#2563eb' }} aria-hidden="true" />
                  {c.title}
                </p>
                <p className="mt-1 text-[11px] text-navy-400" dir="ltr">/blog?category={c.slug}</p>
                {c.description && <p className="mt-1 line-clamp-2 text-xs leading-6 text-navy-500">{c.description}</p>}
                <p className="mt-2 text-[11px] text-navy-400">{faNum(c.postsCount ?? 0)} مطلب{!c.isActive ? ' · غیرفعال در سایت' : ''}</p>
              </div>
              {canManage && (
                <span className="flex shrink-0 gap-1">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing({ ...c })} title="ویرایش"><Pencil className="size-4" /></button>
                  <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={() => setToDelete(c)} title="حذف"><Trash2 className="size-4" /></button>
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'ویرایش دسته‌بندی' : 'دسته‌بندی تازه'}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>انصراف</Button>
          <Button className="btn-gradient" loading={busy} onClick={() => void save()}>ذخیره دسته</Button>
        </>}>
        {editing && (
          <div className="space-y-3">
            <Field label="عنوان دسته" required>
              <Input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="مثلاً آموزش و راهنما" />
            </Field>
            <Field label="پیوند یکتا (slug)" hint="خالی بگذارید تا از عنوان ساخته شود؛ در نشانی فیلتر سایت می‌آید.">
              <Input dir="ltr" className="text-left" value={editing.slug ?? ''} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="guides" />
            </Field>
            <Field label="توضیح">
              <Textarea rows={2} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="نام آیکن" hint="مثل shield یا car-front">
                <Input dir="ltr" className="text-left" value={editing.icon ?? ''} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} />
              </Field>
              <Field label="رنگ">
                <Input type="color" value={editing.color ?? '#2563eb'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
              </Field>
              <Field label="ترتیب نمایش">
                <Input type="number" dir="ltr" className="text-left" value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
              </Field>
            </div>
            <Switch checked={editing.isActive !== false} onChange={() => setEditing({ ...editing, isActive: editing.isActive === false })} label="فعال در سایت" />
          </div>
        )}
      </Modal>

      <Modal open={Boolean(toDelete)} onClose={() => setToDelete(null)} title="حذف دسته‌بندی"
        footer={<>
          <Button variant="ghost" onClick={() => setToDelete(null)}>انصراف</Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>حذف قطعی</Button>
        </>}>
        <p className="text-sm leading-7 text-navy-700">دستهٔ «{toDelete?.title}» حذف می‌شود؛ مطالب داخل آن حذف نمی‌شوند و فقط بدون دسته می‌مانند.</p>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- comments */

function CommentsTab({ variant }: { variant: Variant }) {
  const { notify } = useToast();
  const [rows, setRows] = useState<BlogCommentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    setError('');
    api.list<BlogCommentRow>('/api/blog/comments', { status: status || undefined, page, pageSize: 20 })
      .then((res) => { setRows(res.data); setTotal(res.total); })
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت نظرات'));
  }, [status, page]);
  useEffect(load, [load]);

  const decide = async (row: BlogCommentRow, next: string) => {
    setBusy(row.id);
    try {
      await api.post(`/api/blog/comments/${row.id}/decision`, { status: next });
      notify(next === 'approved' ? 'نظر تأیید و در سایت منتشر شد.' : 'تصمیم ثبت شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(''); }
  };

  const remove = async (row: BlogCommentRow) => {
    setBusy(row.id);
    try {
      await api.delete(`/api/blog/comments/${row.id}`);
      notify('نظر حذف شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'حذف ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { value: 'pending', label: 'در انتظار بررسی' },
          { value: 'approved', label: 'تأییدشده' },
          { value: 'rejected', label: 'ردشده' },
          { value: 'spam', label: 'هرزنامه' },
          { value: '', label: 'همه' },
        ].map((s) => (
          <button key={s.value} type="button" onClick={() => { setStatus(s.value); setPage(1); }}
            className={clsx('rounded-full px-3.5 py-2 text-xs font-bold ring-1 transition',
              status === s.value ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
            {s.label}
          </button>
        ))}
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!rows && !error && <Loading rows={4} />}
      {rows?.length === 0 && <EmptyState title="نظری در این وضعیت نیست" />}
      <div className="space-y-3">
        {rows?.map((row) => (
          <Card key={row.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">{row.authorName.trim().charAt(0) || '؟'}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-navy-900">{row.authorName}{row.authorEmail ? <span className="ms-2 text-[11px] font-normal text-navy-400" dir="ltr">{row.authorEmail}</span> : null}</span>
                <span className="block text-[11px] text-navy-400">
                  روی مطلب «{row.postTitle}» · {faDate(row.createdAt)} ({relative(row.createdAt)})
                </span>
              </span>
              <Badge tone={row.status === 'approved' ? 'success' : row.status === 'pending' ? 'warning' : 'danger'}>{row.statusLabel}</Badge>
              <span className="ms-auto flex flex-wrap gap-1">
                {row.status !== 'approved' && (
                  <button type="button" className="btn btn-sm bg-emerald-600 font-bold text-white hover:bg-emerald-700" disabled={busy === row.id} onClick={() => void decide(row, 'approved')}>
                    <Check className="size-4" /> تأیید
                  </button>
                )}
                {row.status !== 'rejected' && (
                  <button type="button" className="btn-soft btn-sm" disabled={busy === row.id} onClick={() => void decide(row, 'rejected')}>رد</button>
                )}
                {row.status !== 'spam' && (
                  <button type="button" className="btn-ghost btn-sm" disabled={busy === row.id} onClick={() => void decide(row, 'spam')} title="هرزنامه"><ShieldAlert className="size-4" /></button>
                )}
                <button type="button" className="btn-ghost btn-sm text-rose-600" disabled={busy === row.id} onClick={() => void remove(row)} title="حذف"><Trash2 className="size-4" /></button>
              </span>
            </div>
            <p className="mt-2.5 whitespace-pre-wrap text-sm leading-7 text-navy-700">{row.body}</p>
          </Card>
        ))}
      </div>
      {total > 20 && <div className="mt-4 flex justify-center"><Pagination page={page} pageSize={20} total={total} onChange={setPage} /></div>}
    </div>
  );
}

/* ------------------------------------------------------------- subscribers */

function SubscribersTab() {
  const { notify } = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api.list<any>('/api/blog/subscribers', { pageSize: 100 }).then((res) => setRows(res.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت مشترکان'));
  }, []);
  useEffect(load, [load]);
  const toggle = async (row: any) => {
    try {
      await api.patch(`/api/blog/subscribers/${row.id}`, { isActive: !row.isActive });
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };
  return (
    <div>
      <p className="mb-4 text-xs leading-6 text-navy-500">ایمیل‌هایی که از باکس «عضویت در خبرنامه» صفحهٔ بلاگ ثبت شده‌اند.</p>
      {error && <ErrorState message={error} onRetry={load} />}
      {!rows && !error && <Loading rows={3} />}
      {rows?.length === 0 && <EmptyState title="هنوز مشترکی ثبت نشده است" />}
      {rows && rows.length > 0 && (
        <div className="table-wrap card">
          <table className="table">
            <thead><tr><th>ایمیل</th><th>تاریخ عضویت</th><th>وضعیت</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td dir="ltr" className="text-left font-medium text-navy-800">{r.email}</td>
                  <td className="text-xs text-navy-500">{faDate(r.createdAt)}</td>
                  <td><Switch checked={r.isActive} onChange={() => void toggle(r)} label={r.isActive ? 'فعال' : 'غیرفعال'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- admin */

export function BlogAdmin({ variant }: { variant: Variant }) {
  const { can } = useAuth();
  const [tab, setTab] = useState('posts');
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.get<{ data: any }>('/api/blog/stats').then((r) => setStats(r.data)).catch(() => undefined);
  }, [tab]);

  const tabs = [
    { key: 'posts', label: 'مطالب', count: stats?.posts?.total },
    { key: 'categories', label: 'دسته‌بندی‌ها' },
    ...(can('blog.comments') ? [{ key: 'comments', label: 'نظرات', count: stats?.pendingComments }] : []),
    ...(can('blog.manage') ? [{ key: 'subscribers', label: 'خبرنامه', count: stats?.subscribers }] : []),
  ];

  return (
    <AppShell variant={variant}>
      <PageHeader
        title="بلاگ و تولید محتوا"
        description="مطلب بنویسید، منتشر کنید، نظرات را مدیریت کنید و برای موتورهای جست‌وجو آماده باشید — مثل وردپرس، داخل خودِ سامانه."
        actions={can('blog.create') ? <Link to={`${baseOf(variant)}/new`} className="btn-gradient btn-md"><Plus className="size-4" /> مطلب تازه</Link> : undefined}
      />

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <GlossyStat color="#2563eb" icon={<Newspaper className="size-7" />} label="کل مطالب" value={faNum(stats.posts.total)}
            sub={`منتشرشده: ${faNum(stats.posts.published)} · پیش‌نویس: ${faNum(stats.posts.draft)}`} />
          <GlossyStat color="#16a34a" icon={<Eye className="size-7" />} label="مجموع بازدیدها" value={faNum(stats.totalViews)} />
          <GlossyStat color="#d97706" icon={<MessageSquare className="size-7" />} label="نظرات در انتظار بررسی" value={faNum(stats.pendingComments)} />
          <GlossyStat color="#7c3aed" icon={<Mail className="size-7" />} label="مشترکان خبرنامه" value={faNum(stats.subscribers)} />
        </div>
      )}

      <div className="mb-5">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {tab === 'posts' && <PostsTab variant={variant} />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'comments' && can('blog.comments') && <CommentsTab variant={variant} />}
      {tab === 'subscribers' && can('blog.manage') && <SubscribersTab />}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ editor */

const slugPreview = (title: string) => title.trim().toLowerCase().replace(/[\u200c\u200d]/g, '-').replace(/[^a-z0-9\u0600-\u06FF]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120);

export function BlogEditor({ variant }: { variant: Variant }) {
  const base = baseOf(variant);
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [slugTouched, setSlugTouched] = useState(Boolean(id));
  const [form, setForm] = useState({
    title: '', subtitle: '', slug: '', excerpt: '', content: '',
    categoryId: '', tags: [] as string[], coverUrl: '', coverAlt: '',
    status: 'draft' as 'draft' | 'published' | 'archived', publishedAt: '',
    seoTitle: '', seoDescription: '', canonicalUrl: '', noindex: false,
    allowComments: true, featured: false,
  });
  const [meta, setMeta] = useState<{ viewsCount: number; authorName: string | null } | null>(null);

  useEffect(() => {
    api.get<{ data: Category[] }>('/api/blog/categories').then((r) => setCategories(r.data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get<{ data: Post }>(`/api/blog/posts/${id}`)
      .then((r) => {
        const p = r.data;
        setMeta({ viewsCount: p.viewsCount, authorName: p.authorName });
        setForm({
          title: p.title, subtitle: p.subtitle ?? '', slug: p.slug, excerpt: p.excerpt ?? '',
          content: p.content ?? '', categoryId: p.categoryId ?? '', tags: p.tags ?? [],
          coverUrl: p.coverUrl ?? '', coverAlt: p.coverAlt ?? '',
          status: p.status, publishedAt: p.publishedAt ? p.publishedAt.slice(0, 16) : '',
          seoTitle: p.seoTitle ?? '', seoDescription: p.seoDescription ?? '',
          canonicalUrl: p.canonicalUrl ?? '', noindex: p.noindex,
          allowComments: p.allowComments, featured: p.featured,
        });
      })
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت مطلب'))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const reading = useMemo(() => estimateReading(form.content), [form.content]);

  const uploadCover = async (file: File) => {
    setCoverBusy(true);
    try {
      const res = await api.upload<{ data: { id: string } }>('/api/files/upload', file, { purpose: 'blog' });
      set({ coverUrl: `/api/public/blog/media/${res.data.id}` });
      notify('تصویر شاخص بارگذاری شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری ناموفق بود.', 'error');
    } finally { setCoverBusy(false); }
  };

  const addTag = () => {
    const value = tagInput.trim().replace(/،$/, '');
    if (value && !form.tags.includes(value)) set({ tags: [...form.tags, value].slice(0, 30) });
    setTagInput('');
  };

  const save = async (statusOverride?: 'draft' | 'published') => {
    if (form.title.trim().length < 3) { notify('عنوان مطلب لازم است.', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        slug: form.slug.trim() || undefined,
        excerpt: form.excerpt.trim() || null,
        content: form.content,
        categoryId: form.categoryId || null,
        tags: form.tags,
        coverUrl: form.coverUrl.trim() || null,
        coverAlt: form.coverAlt.trim() || null,
        status: statusOverride ?? form.status,
        publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
        seoTitle: form.seoTitle.trim() || null,
        seoDescription: form.seoDescription.trim() || null,
        canonicalUrl: form.canonicalUrl.trim() || null,
        noindex: form.noindex,
        allowComments: form.allowComments,
        featured: form.featured,
      };
      if (id) {
        const res = await api.patch<{ data: Post }>(`/api/blog/posts/${id}`, payload);
        set({ status: res.data.status, slug: res.data.slug });
        setSlugTouched(true);
        notify('مطلب ذخیره شد.', 'success');
      } else {
        const res = await api.post<{ data: Post }>('/api/blog/posts', payload);
        notify(res.data.status === 'published' ? 'مطلب منتشر شد.' : 'پیش‌نویس ذخیره شد.', 'success');
        navigate(`${base}/${res.data.id}/edit`, { replace: true });
      }
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ذخیره ناموفق بود.', 'error');
    } finally { setSaving(false); }
  };

  if (loading) return <AppShell variant={variant}><Loading rows={6} /></AppShell>;
  if (error) return <AppShell variant={variant}><ErrorState message={error} /></AppShell>;

  const effectiveSlug = form.slug.trim() || slugPreview(form.title);
  const seoTitleText = form.seoTitle || form.title || 'عنوان مطلب';
  const seoDescText = form.seoDescription || form.excerpt || 'توضیح متا در نتایج جست‌وجو و اشتراک‌گذاری نمایش داده می‌شود.';

  return (
    <AppShell variant={variant}>
      <PageHeader
        title={id ? 'ویرایش مطلب' : 'مطلب تازه'}
        description={id ? `نویسنده: ${meta?.authorName ?? '—'} · بازدید: ${faNum(meta?.viewsCount ?? 0)}` : 'عنوان، متن و تصویر شاخص را آماده کنید؛ اول می‌توانید پیش‌نویس ذخیره کنید.'}
        backTo={base}
        actions={<>
          {form.status === 'published' && (
            <Link to={`/blog/${encodeURIComponent(effectiveSlug)}`} target="_blank" className="btn-soft btn-md"><Globe className="size-4" /> مشاهده در سایت</Link>
          )}
          <Button variant="ghost" loading={saving} onClick={() => void save('draft')}>ذخیره پیش‌نویس</Button>
          {can('blog.publish')
            ? <Button className="btn-gradient" loading={saving} onClick={() => void save('published')}><Send className="size-4" /> {form.status === 'published' ? 'به‌روزرسانی انتشار' : 'انتشار'}</Button>
            : <Button className="btn-gradient" loading={saving} onClick={() => void save()}>ذخیره</Button>}
        </>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <Field label="عنوان مطلب" required>
              <Input value={form.title} className="text-lg font-black" placeholder="عنوان جذاب و روشن بنویسید…"
                onChange={(e) => {
                  const title = e.target.value;
                  set(slugTouched ? { title } : { title, slug: slugPreview(title) });
                }} />
            </Field>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="زیرعنوان" hint="یک جملهٔ تکمیلی زیر عنوان در صفحهٔ مطلب">
                <Input value={form.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
              </Field>
              <Field label="پیوند یکتا (slug)" hint={`نشانی نهایی: /blog/${effectiveSlug || '…'}`}>
                <Input dir="ltr" className="text-left" value={form.slug}
                  onChange={(e) => { setSlugTouched(true); set({ slug: e.target.value }); }} />
              </Field>
            </div>
            <div className="mt-4">
              <RichTextEditor value={form.content} onChange={(html) => set({ content: html })} />
              <p className="mt-2 text-[11px] text-navy-400">
                {faNum(reading.words)} واژه · زمان مطالعهٔ تقریبی: {faNum(reading.minutes)} دقیقه
              </p>
            </div>
            <div className="mt-4">
              <Field label="چکیده" hint="روی کارت مطلب و در پیش‌فرضِ توضیح متا می‌آید؛ خالی باشد از ابتدای متن ساخته می‌شود.">
                <Textarea rows={3} value={form.excerpt} onChange={(e) => set({ excerpt: e.target.value })} />
              </Field>
            </div>
          </Card>

          <PanelCard title="سئو (SEO)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`عنوان سئو (${faNum((form.seoTitle || form.title).length)} نویسه)`} hint="خالی = همان عنوان مطلب؛ پیشنهاد: زیر ۶۰ نویسه.">
                <Input value={form.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
              </Field>
              <Field label="نشانی canonical (اختیاری)" hint="فقط اگر نسخهٔ اصلی این محتوا جای دیگری است.">
                <Input dir="ltr" className="text-left" value={form.canonicalUrl} onChange={(e) => set({ canonicalUrl: e.target.value })} placeholder="https://…" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label={`توضیح متا (${faNum((form.seoDescription || form.excerpt).length)} نویسه)`} hint="پیشنهاد: ۱۲۰ تا ۱۶۰ نویسه با کلیدواژهٔ اصلی.">
                <Textarea rows={2} value={form.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3 rounded-2xl bg-surface-3 p-3.5 ring-1 ring-line">
              <p className="mb-1 text-[10px] font-bold text-navy-400">پیش‌نمایش در نتایج جست‌وجو</p>
              <p className="truncate text-[13px] font-bold text-[#1a0dab]">{seoTitleText}</p>
              <p className="truncate text-[11px] text-emerald-700" dir="ltr">/blog/{effectiveSlug || '…'}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-6 text-navy-500">{seoDescText}</p>
            </div>
            <div className="mt-3">
              <Switch checked={form.noindex} onChange={() => set({ noindex: !form.noindex })}
                label="مخفی از موتورهای جست‌وجو (noindex)" hint="مطلب در نقشهٔ سایت نمی‌آید و برچسب noindex می‌گیرد." />
            </div>
          </PanelCard>
        </div>

        <div className="space-y-5">
          <PanelCard title="انتشار">
            <Field label="وضعیت">
              <Select value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}
                options={[
                  { value: 'draft', label: 'پیش‌نویس' },
                  { value: 'published', label: can('blog.publish') ? 'منتشرشده' : 'منتشرشده (نیازمند مجوز انتشار)' },
                  { value: 'archived', label: 'بایگانی' },
                ]} />
            </Field>
            <div className="mt-3">
              <Field label="تاریخ انتشار" hint="آینده انتخاب کنید تا مطلب زمان‌بندی شود؛ خالی = همین حالا.">
                <Input type="datetime-local" dir="ltr" className="text-left" value={form.publishedAt}
                  onChange={(e) => set({ publishedAt: e.target.value })} />
              </Field>
            </div>
            <div className="mt-4 space-y-3">
              <Switch checked={form.featured} onChange={() => set({ featured: !form.featured })} label="مطلب برگزیده" />
              <Switch checked={form.allowComments} onChange={() => set({ allowComments: !form.allowComments })} label="امکان ثبت نظر برای خوانندگان" hint="نظرات همیشه پس از تأیید مدیر منتشر می‌شوند." />
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" className="flex-1" loading={saving} onClick={() => void save('draft')}>پیش‌نویس</Button>
              {can('blog.publish') && (
                <Button className="btn-gradient flex-1" loading={saving} onClick={() => void save('published')}>
                  <CalendarClock className="size-4" /> انتشار
                </Button>
              )}
            </div>
          </PanelCard>

          <PanelCard title="دسته‌بندی و برچسب‌ها">
            <Field label="دسته‌بندی">
              <Select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}
                options={[{ value: '', label: 'بدون دسته' }, ...categories.map((c) => ({ value: c.id, label: c.title }))]} />
            </Field>
            <div className="mt-4">
              <Field label="برچسب‌ها" hint="برچسب را بنویسید و Enter بزنید؛ برای سئو و فیلتر سایت استفاده می‌شود.">
                <div className="flex gap-2">
                  <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
                    placeholder="مثلاً: تعویض پلاک" />
                  <Button variant="ghost" onClick={addTag}><Plus className="size-4" /></Button>
                </div>
              </Field>
              {form.tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {form.tags.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-800">
                      <Tag className="size-3" /> {t}
                      <button type="button" aria-label={`حذف ${t}`} onClick={() => set({ tags: form.tags.filter((x) => x !== t) })}><X className="size-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </PanelCard>

          <PanelCard title="تصویر شاخص">
            {form.coverUrl ? (
              <img src={form.coverUrl} alt={form.coverAlt || ''} className="h-40 w-full rounded-2xl object-cover ring-1 ring-line" />
            ) : (
              <div className="grid h-40 place-items-center rounded-2xl bg-surface-3 text-navy-300 ring-1 ring-line"><FileText className="size-10" /></div>
            )}
            <label className="btn-soft btn-md mt-3 w-full cursor-pointer">
              {coverBusy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} بارگذاری تصویر
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCover(f); e.target.value = ''; }} />
            </label>
            <div className="mt-3 space-y-3">
              <Field label="یا نشانی تصویر">
                <Input dir="ltr" className="text-left" value={form.coverUrl} onChange={(e) => set({ coverUrl: e.target.value })} placeholder="https://… یا /images/…" />
              </Field>
              <Field label="متن جایگزین (alt)" hint="برای سئو و دسترس‌پذیری تصویر شاخص.">
                <Input value={form.coverAlt} onChange={(e) => set({ coverAlt: e.target.value })} />
              </Field>
              {form.coverUrl && (
                <button type="button" className="text-xs font-bold text-rose-600 hover:underline" onClick={() => set({ coverUrl: '' })}>
                  حذف تصویر شاخص
                </button>
              )}
            </div>
            <Link to={base} className="mt-4 flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline">
              بازگشت به فهرست مطالب <ArrowLeft className="size-3.5" />
            </Link>
          </PanelCard>
        </div>
      </div>
    </AppShell>
  );
}
