import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, ChevronLeft, Clock3, Eye, Flame, Link2, Mail, MessageSquare,
  Search, Send, Tag, User,
} from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { CategoryArt } from '../../components/visual';
import { Button, EmptyState, ErrorState, Input, Loading, Pagination, Textarea, useToast } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { faDate, faNum, relative } from '../../lib/format';
import { useSeo } from '../../lib/seo';
import { sanitizeHtml } from '../../lib/sanitize';

interface BlogCategory {
  id: string; slug: string; title: string; description: string | null;
  icon: string | null; color: string | null; postsCount?: number;
}

interface BlogPost {
  id: string; slug: string; title: string; subtitle: string | null; excerpt: string;
  content?: string;
  categoryId: string | null; categoryTitle: string | null; categorySlug: string | null;
  categoryIcon: string | null; categoryColor: string | null;
  tags: string[]; coverUrl: string | null; coverAlt: string | null;
  authorName: string | null; status: string; publishedAt: string | null;
  seoTitle: string | null; seoDescription: string | null; canonicalUrl: string | null; noindex: boolean;
  allowComments: boolean; featured: boolean; readingMinutes: number; viewsCount: number;
  commentsCount: number; createdAt: string; updatedAt: string;
}

interface BlogComment {
  id: string; parentId: string | null; authorName: string; body: string; createdAt: string;
  isStaff: boolean; replies?: BlogComment[];
}

const PAGE_SIZE = 9;

function PostCover({ post, className, glyphClassName }: { post: BlogPost; className?: string; glyphClassName?: string }) {
  if (post.coverUrl) {
    return <img src={post.coverUrl} alt={post.coverAlt ?? post.title} loading="lazy" className={clsx('object-cover', className)} />;
  }
  return (
    <span className={clsx('grid place-items-center bg-gradient-to-b from-brand-50 to-brand-100/60', className)}>
      <CategoryArt name={post.categoryIcon} color={post.categoryColor} className="size-20" glyphClassName={glyphClassName ?? 'size-11'} />
    </span>
  );
}

function PostCard({ post }: { post: BlogPost }) {
  return (
    <article className="lift group flex flex-col overflow-hidden rounded-[1.4rem] bg-surface shadow-soft ring-1 ring-navy-900/5">
      <Link to={`/blog/${encodeURIComponent(post.slug)}`} className="relative block">
        <PostCover post={post} className="h-44 w-full transition duration-500 group-hover:scale-[1.03]" />
        {post.categoryTitle && (
          <span className="absolute right-3 top-3 rounded-full bg-shell/85 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
            {post.categoryTitle}
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <Link to={`/blog/${encodeURIComponent(post.slug)}`}>
          <h3 className="line-clamp-2 min-h-12 text-[15px] font-black leading-7 text-navy-900 transition group-hover:text-brand-700">{post.title}</h3>
        </Link>
        <p className="mt-1.5 line-clamp-2 text-xs leading-6 text-navy-500">{post.excerpt}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <Link to={`/blog/${encodeURIComponent(post.slug)}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-100">
            مطالعه بیشتر <ArrowLeft className="size-3.5" />
          </Link>
          <span className="flex items-center gap-2.5 text-[11px] text-navy-400">
            <span className="flex items-center gap-1"><Eye className="size-3.5" /> {faNum(post.viewsCount)}</span>
            <span className="flex items-center gap-1"><CalendarDays className="size-3.5" /> {faDate(post.publishedAt ?? post.createdAt)}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

function NewsletterCard() {
  const { notify } = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ data: { already: boolean } }>('/api/public/blog/subscribe', { email });
      notify(res.data.already ? 'این ایمیل قبلاً در خبرنامه عضو شده است.' : 'عضویت شما در خبرنامه ثبت شد؛ تازه‌ترین مطالب را دریافت می‌کنید.', 'success');
      setEmail('');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت عضویت ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };
  return (
    <section className="overflow-hidden rounded-[1.4rem] bg-gradient-to-b from-brand-700 to-brand-500 p-5 text-white shadow-soft">
      <span className="grid size-12 place-items-center rounded-2xl bg-white/15"><Mail className="size-6" /></span>
      <h3 className="mt-3 text-lg font-black">عضویت در خبرنامه</h3>
      <p className="mt-1.5 text-xs leading-6 text-white/80">برای دریافت جدیدترین مطالب و آموزش‌ها، ایمیل خود را وارد کنید.</p>
      <form onSubmit={submit} className="mt-4 space-y-2">
        <Input type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="ایمیل شما…" className="border-white/25 bg-white/95 text-left text-navy-900" aria-label="ایمیل خبرنامه" />
        <Button type="submit" loading={busy} className="w-full border border-white/30 bg-white font-bold text-brand-800 hover:bg-white/90">
          <Send className="size-4" /> عضویت
        </Button>
      </form>
    </section>
  );
}

export function BlogHome() {
  const brand = useBrand();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const category = params.get('category') ?? '';
  const tag = params.get('tag') ?? '';
  const query = params.get('q') ?? '';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const [searchInput, setSearchInput] = useState(query);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [total, setTotal] = useState(0);
  const [popular, setPopular] = useState<BlogPost[]>([]);
  const [error, setError] = useState('');

  useSeo({
    title: `بلاگ ${brand.name} | آموزش، راهنما و اخبار خدمات`,
    description: `تازه‌ترین آموزش‌ها، راهنمای خدمات و اخبار ${brand.name} را در بلاگ ما بخوانید.`,
  });

  useEffect(() => {
    api.get<{ data: BlogCategory[] }>('/api/public/blog/categories').then((r) => setCategories(r.data)).catch(() => undefined);
    api.get<{ data: BlogPost[] }>('/api/public/blog/popular?limit=5').then((r) => setPopular(r.data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    setError('');
    api.list<BlogPost>('/api/public/blog/posts', {
      category: category || undefined, tag: tag || undefined, q: query || undefined, page, pageSize: PAGE_SIZE,
    }).then((res) => { if (active) { setPosts(res.data); setTotal(res.total); } })
      .catch((err) => { if (active) setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت مطالب'); });
    return () => { active = false; };
  }, [category, tag, query, page]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const activeCategory = categories.find((c) => c.slug === category);

  return (
    <PublicLayout>
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        {/* hero */}
        <section className="relative isolate mt-4 overflow-hidden rounded-[1.8rem] shadow-soft ring-1 ring-navy-900/5">
          <img src="/images/blog-hero.jpg" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-left" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-l from-white/85 via-white/45 to-transparent" />
          <div className="relative max-w-2xl p-6 sm:p-10">
            <span className="chip-soft bg-white/75 text-brand-800">بلاگ و آموزش</span>
            <h1 className="mt-3 text-3xl font-black leading-snug tracking-tight text-navy-900 sm:text-4xl">بلاگ {brand.name}</h1>
            <p className="mt-2 text-base font-bold text-navy-700">دانش، تجربه و نکات کاربردی برای موفقیت بیشتر</p>
            <p className="mt-2 max-w-xl text-sm leading-7 text-navy-600">
              با ما همراه باشید و از جدیدترین مطالب، راهنمای قدم‌به‌قدم خدمات و آموزش‌ها باخبر شوید.
            </p>
            <a href="#articles" className="btn-gradient btn-md mt-5">مشاهده همه مقالات <ArrowLeft className="size-4" /></a>
          </div>
        </section>

        {/* toolbar: search + categories */}
        <div className="mt-7 flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pe-1.5 ps-4 shadow-xs lg:w-80"
            onSubmit={(e) => { e.preventDefault(); setParam('q', searchInput.trim()); }}
            role="search"
          >
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="جستجو در مقالات…" aria-label="جستجو در مقالات"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-navy-900 outline-none placeholder:text-navy-400" />
            <button type="submit" aria-label="جستجو" className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700">
              <Search className="size-4" />
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setParam('category', '')}
              className={clsx('rounded-full px-4 py-2 text-xs font-bold ring-1 transition',
                !category ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
              همه مطالب
            </button>
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => setParam('category', c.slug)}
                className={clsx('rounded-full px-4 py-2 text-xs font-bold ring-1 transition',
                  category === c.slug ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}>
                {c.title}{typeof c.postsCount === 'number' ? ` (${faNum(c.postsCount)})` : ''}
              </button>
            ))}
          </div>
        </div>

        {(tag || query || activeCategory) && (
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-navy-500">
            نتیجه برای:
            {activeCategory && <span className="rounded-full bg-brand-50 px-2.5 py-1 font-bold text-brand-800">دستهٔ {activeCategory.title}</span>}
            {tag && <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 font-bold text-brand-800"><Tag className="size-3" /> {tag}</span>}
            {query && <span className="rounded-full bg-brand-50 px-2.5 py-1 font-bold text-brand-800">«{query}»</span>}
            <button type="button" className="font-bold text-brand-700 hover:underline"
              onClick={() => { setParams(new URLSearchParams(), { replace: true }); setSearchInput(''); }}>
              پاک کردن فیلترها
            </button>
          </p>
        )}

        <div id="articles" className="mt-6 grid scroll-mt-28 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {error && <ErrorState message={error} />}
            {!posts && !error && <Loading rows={4} />}
            {posts?.length === 0 && (
              <EmptyState title="هنوز مقاله‌ای اینجا نیست"
                description={query || category || tag ? 'برای این فیلتر مطلبی پیدا نشد؛ فیلترها را تغییر دهید.' : 'به‌زودی نخستین مطالب بلاگ منتشر می‌شود.'} />
            )}
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {posts?.map((post) => <PostCard key={post.id} post={post} />)}
            </div>
            {total > PAGE_SIZE && (
              <div className="mt-7 flex justify-center">
                <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => setParam('page', String(p))} />
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <section className="rounded-[1.4rem] bg-surface p-5 shadow-soft ring-1 ring-navy-900/5">
              <h3 className="mb-4 flex items-center gap-2 font-black text-navy-900"><Flame className="size-5 text-rose-500" /> محبوب‌ترین مطالب</h3>
              {popular.length === 0 ? (
                <p className="text-sm text-navy-400">هنوز مطلبی منتشر نشده است.</p>
              ) : (
                <ol className="space-y-3">
                  {popular.map((post, i) => (
                    <li key={post.id}>
                      <Link to={`/blog/${encodeURIComponent(post.slug)}`} className="group flex items-center gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">{faNum(i + 1)}</span>
                        <PostCover post={post} className="h-11 w-16 shrink-0 rounded-xl" glyphClassName="size-5" />
                        <span className="min-w-0">
                          <span className="line-clamp-2 text-[13px] font-bold leading-6 text-navy-800 transition group-hover:text-brand-700">{post.title}</span>
                          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-navy-400"><Eye className="size-3" /> {faNum(post.viewsCount)} بازدید</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <NewsletterCard />
          </aside>
        </div>
      </main>
    </PublicLayout>
  );
}

/* ------------------------------------------------------------- post page */

function CommentNode({ comment, onReply, depth = 0 }: { comment: BlogComment; onReply: (c: BlogComment) => void; depth?: number }) {
  return (
    <li className={clsx(depth > 0 && 'me-6 border-r-2 border-brand-100 pe-4')}>
      <div className="rounded-2xl bg-surface-3/70 px-4 py-3 ring-1 ring-navy-900/5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">
            {comment.authorName.trim().charAt(0) || '؟'}
          </span>
          <span className="text-[13px] font-bold text-navy-900">{comment.authorName}</span>
          {comment.isStaff && <span className="rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-bold text-white">تیم پیشخوان</span>}
          <span className="text-[11px] text-navy-400">{relative(comment.createdAt)}</span>
          <button type="button" onClick={() => onReply(comment)} className="ms-auto text-[11px] font-bold text-brand-700 hover:underline">پاسخ</button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-navy-700">{comment.body}</p>
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <ul className="mt-2 space-y-2">
          {comment.replies.map((reply) => <CommentNode key={reply.id} comment={reply} onReply={onReply} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export function BlogPostPage() {
  const { slug = '' } = useParams();
  const brand = useBrand();
  const { user } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<{ post: BlogPost; related: BlogPost[]; comments: BlogComment[] } | null>(null);
  const [error, setError] = useState('');
  const [popular, setPopular] = useState<BlogPost[]>([]);
  const [form, setForm] = useState({ name: '', email: '', body: '' });
  const [replyTo, setReplyTo] = useState<BlogComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const load = () => {
    setError('');
    api.get<{ data: any }>(`/api/public/blog/posts/${encodeURIComponent(slug)}`)
      .then((r) => setData(r.data))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت مطلب'));
  };
  useEffect(load, [slug]);
  useEffect(() => {
    api.get<{ data: BlogPost[] }>('/api/public/blog/popular?limit=5').then((r) => setPopular(r.data)).catch(() => undefined);
  }, []);

  const post = data?.post;
  const safeContent = useMemo(() => sanitizeHtml(post?.content ?? ''), [post?.content]);
  useSeo(post ? {
    title: post.seoTitle || `${post.title} | بلاگ ${brand.name}`,
    description: post.seoDescription || post.subtitle || post.excerpt,
    canonical: post.canonicalUrl || `/blog/${encodeURIComponent(post.slug)}`,
    image: post.coverUrl || undefined,
    type: 'article',
    noindex: post.noindex,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.seoDescription || post.excerpt,
      image: post.coverUrl ? [new URL(post.coverUrl, window.location.origin).toString()] : undefined,
      datePublished: post.publishedAt ?? post.createdAt,
      dateModified: post.updatedAt,
      author: { '@type': 'Person', name: post.authorName ?? brand.name },
      publisher: { '@type': 'Organization', name: brand.name },
      mainEntityOfPage: window.location.href.split('#')[0],
    },
  } : null);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('پیوند مطلب کپی شد.', 'success');
    } catch {
      notify('کپی پیوند ممکن نشد.', 'error');
    }
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/public/blog/posts/${encodeURIComponent(slug)}/comments`, {
        name: user ? undefined : form.name || undefined,
        email: form.email || undefined,
        body: form.body,
        parentId: replyTo?.id,
      });
      setSent(true);
      setForm({ name: '', email: '', body: '' });
      setReplyTo(null);
      notify('نظر شما ثبت شد و پس از تأیید مدیر نمایش داده می‌شود.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت نظر ناموفق بود.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <PublicLayout>
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        {error && <div className="mt-8"><ErrorState message={error} onRetry={load} /></div>}
        {!post && !error && <div className="mt-8"><Loading rows={6} /></div>}
        {post && data && (
          <div className="mt-6 grid gap-8 lg:grid-cols-3">
            <article className="lg:col-span-2">
              <nav aria-label="مسیر" className="flex flex-wrap items-center gap-1.5 text-xs text-navy-400">
                <Link to="/" className="hover:text-navy-700">خانه</Link>
                <ChevronLeft className="size-3.5" />
                <Link to="/blog" className="hover:text-navy-700">بلاگ</Link>
                {post.categorySlug && (
                  <>
                    <ChevronLeft className="size-3.5" />
                    <Link to={`/blog?category=${encodeURIComponent(post.categorySlug)}`} className="hover:text-navy-700">{post.categoryTitle}</Link>
                  </>
                )}
                <ChevronLeft className="size-3.5" />
                <span className="max-w-64 truncate font-medium text-navy-600">{post.title}</span>
              </nav>

              {post.categoryTitle && (
                <Link to={`/blog?category=${encodeURIComponent(post.categorySlug ?? '')}`}
                  className="mt-4 inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800">
                  {post.categoryTitle}
                </Link>
              )}
              <h1 className="mt-3 text-3xl font-black leading-snug tracking-tight text-navy-900 sm:text-4xl">{post.title}</h1>
              {post.subtitle && <p className="mt-3 text-base font-medium leading-8 text-navy-600">{post.subtitle}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-3 text-xs text-navy-500">
                <span className="flex items-center gap-1.5"><User className="size-4 text-accent" /> {post.authorName ?? brand.name}</span>
                <span className="flex items-center gap-1.5"><CalendarDays className="size-4 text-accent" /> {faDate(post.publishedAt ?? post.createdAt)}</span>
                <span className="flex items-center gap-1.5"><Clock3 className="size-4 text-accent" /> {faNum(post.readingMinutes)} دقیقه مطالعه</span>
                <span className="flex items-center gap-1.5"><Eye className="size-4 text-accent" /> {faNum(post.viewsCount)} بازدید</span>
                <button type="button" onClick={() => void share()} className="ms-auto flex items-center gap-1.5 font-bold text-brand-700 hover:underline">
                  <Link2 className="size-4" /> اشتراک‌گذاری
                </button>
              </div>

              {post.coverUrl && (
                <img src={post.coverUrl} alt={post.coverAlt ?? post.title}
                  className="mt-5 max-h-[26rem] w-full rounded-[1.4rem] object-cover shadow-soft ring-1 ring-navy-900/5" />
              )}

              <div className="blog-content mt-6 text-[15.5px] leading-9 text-navy-800" dangerouslySetInnerHTML={{ __html: safeContent }} />

              {post.tags.length > 0 && (
                <div className="mt-8 flex flex-wrap items-center gap-2">
                  <Tag className="size-4 text-navy-400" />
                  {post.tags.map((t) => (
                    <button key={t} type="button" onClick={() => navigate(`/blog?tag=${encodeURIComponent(t)}`)}
                      className="rounded-full bg-surface-3 px-3 py-1.5 text-xs font-bold text-navy-700 ring-1 ring-line transition hover:bg-brand-50 hover:text-brand-800">
                      {t}
                    </button>
                  ))}
                </div>
              )}

              {/* comments */}
              <section className="mt-10">
                <h2 className="flex items-center gap-2 text-xl font-black text-navy-900">
                  <MessageSquare className="size-5 text-accent" /> دیدگاه‌ها
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-black text-brand-700">{faNum(post.commentsCount)}</span>
                </h2>

                {post.allowComments ? (
                  <form onSubmit={submitComment} className="card card-pad mt-4">
                    <p className="font-bold text-navy-900">{replyTo ? `پاسخ به ${replyTo.authorName}` : 'نظر شما چیست؟'}</p>
                    {replyTo && (
                      <button type="button" onClick={() => setReplyTo(null)} className="mt-1 text-[11px] font-bold text-rose-600 hover:underline">
                        لغو پاسخ
                      </button>
                    )}
                    {!user && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="نام و نام خانوادگی *" aria-label="نام" />
                        <Input type="email" dir="ltr" className="text-left" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ایمیل (اختیاری)" aria-label="ایمیل" />
                      </div>
                    )}
                    <Textarea required rows={4} className="mt-3" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                      placeholder="دیدگاهتان را بنویسید…" aria-label="متن نظر" />
                    {sent && <p className="mt-2 text-xs font-bold text-emerald-700">نظرتان ثبت شد و پس از تأیید مدیر همین‌جا دیده می‌شود.</p>}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-navy-400">
                        {user ? `با نام ${user.fullName} نظر می‌دهید.` : 'نظرات پس از تأیید مدیر منتشر می‌شوند.'}
                      </p>
                      <Button type="submit" loading={busy} className="btn-gradient"><Send className="size-4" /> ثبت دیدگاه</Button>
                    </div>
                  </form>
                ) : (
                  <p className="card card-pad mt-4 text-sm text-navy-500">ثبت دیدگاه برای این مطلب بسته است.</p>
                )}

                {data.comments.length === 0 ? (
                  <p className="mt-5 text-sm text-navy-400">هنوز دیدگاهی برای این مطلب ثبت نشده است؛ اولین نفر باشید.</p>
                ) : (
                  <ul className="mt-5 space-y-3">
                    {data.comments.map((c) => <CommentNode key={c.id} comment={c} onReply={(cm) => { setReplyTo(cm); window.scrollBy({ top: -400, behavior: 'smooth' }); }} />)}
                  </ul>
                )}
              </section>
            </article>

            <aside className="space-y-5">
              <section className="rounded-[1.4rem] bg-surface p-5 shadow-soft ring-1 ring-navy-900/5">
                <h3 className="mb-4 flex items-center gap-2 font-black text-navy-900"><Flame className="size-5 text-rose-500" /> محبوب‌ترین مطالب</h3>
                <ol className="space-y-3">
                  {popular.filter((p) => p.id !== post.id).slice(0, 5).map((p, i) => (
                    <li key={p.id}>
                      <Link to={`/blog/${encodeURIComponent(p.slug)}`} className="group flex items-center gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">{faNum(i + 1)}</span>
                        <PostCover post={p} className="h-11 w-16 shrink-0 rounded-xl" glyphClassName="size-5" />
                        <span className="line-clamp-2 text-[13px] font-bold leading-6 text-navy-800 transition group-hover:text-brand-700">{p.title}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>

              {data.related.length > 0 && (
                <section className="rounded-[1.4rem] bg-surface p-5 shadow-soft ring-1 ring-navy-900/5">
                  <h3 className="mb-4 font-black text-navy-900">مطالب مرتبط</h3>
                  <div className="space-y-3">
                    {data.related.map((p) => (
                      <Link key={p.id} to={`/blog/${encodeURIComponent(p.slug)}`} className="group flex items-center gap-3">
                        <PostCover post={p} className="h-12 w-20 shrink-0 rounded-xl" glyphClassName="size-5" />
                        <span className="min-w-0">
                          <span className="line-clamp-2 text-[13px] font-bold leading-6 text-navy-800 transition group-hover:text-brand-700">{p.title}</span>
                          <span className="text-[10px] text-navy-400">{faDate(p.publishedAt ?? p.createdAt)}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <NewsletterCard />
            </aside>
          </div>
        )}
      </main>
    </PublicLayout>
  );
}
