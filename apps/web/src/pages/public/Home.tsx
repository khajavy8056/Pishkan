import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, ArrowLeft, ShieldCheck, Clock, FileCheck2, Sparkles, MessageSquare, CreditCard,
  ClipboardList, Bell, UserRound, ChevronLeft, Star, Users, BadgeCheck,
} from 'lucide-react';
import { PublicLayout } from '../../components/public-layout';
import { useSite, type Service } from '../../lib/site';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { faNum, rial } from '../../lib/format';
import { Button } from '../../components/ui';

export function HomePage() {
  const { site, setting } = useSite();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Service[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ data: Service[] }>('/api/public/search', { q: query, limit: 5 });
        setResults(res.data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/services?q=${encodeURIComponent(query)}`);
  };

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="hero-grid relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_300px_at_85%_-10%,#dbeafe_0%,transparent_70%)]" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div className="animate-in">
            <span className="badge bg-brand-50 text-brand-800 ring-1 ring-brand-200">
              <Sparkles className="size-3.5" /> پیشکان · یک مسیر روشن تا انجام کار
            </span>
            <h1 className="mt-4 text-3xl font-black leading-[1.35] text-navy-900 sm:text-4xl lg:text-[2.75rem]">
              وقت شما ارزشمند است.<br />
              <span className="text-brand-700">کارهایتان را ساده‌تر</span> پیش ببرید.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-8 text-navy-600 sm:text-base">
              {setting('site.welcome_message')}
            </p>

            <form onSubmit={submitSearch} className="relative mt-7 max-w-xl">
              <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-[var(--shadow-card)] ring-1 ring-navy-900/8">
                <Search className="mr-2 size-5 shrink-0 text-navy-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="نام خدمت را بنویسید؛ مثلاً «سابقه بیمه» یا «ثبت شرکت»"
                  className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-navy-400"
                  aria-label="جست‌وجوی خدمات"
                />
                <Button type="submit" className="shrink-0">جست‌وجو</Button>
              </div>

              {query.trim().length >= 2 && (
                <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-navy-900/10">
                  {searching && <p className="px-4 py-3 text-sm text-navy-500">در حال جست‌وجو…</p>}
                  {!searching && results?.length === 0 && (
                    <p className="px-4 py-3 text-sm text-navy-500">
                      خدمتی با این عنوان پیدا نشد. می‌توانید از <Link className="text-brand-700 underline" to="/assistant">دستیار هوشمند</Link> کمک بگیرید.
                    </p>
                  )}
                  {results?.map((service) => (
                    <Link key={service.id} to={`/services/${service.slug}`} className="flex items-center justify-between gap-3 border-b border-navy-900/5 px-4 py-3 hover:bg-navy-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-navy-900">{service.title}</span>
                        <span className="block truncate text-xs text-navy-500">{service.summary}</span>
                      </span>
                      <ChevronLeft className="size-4 shrink-0 text-navy-400" />
                    </Link>
                  ))}
                </div>
              )}
            </form>

            <div className="mt-6 flex flex-wrap gap-2 text-xs text-navy-600">
              <span className="text-navy-400">جست‌وجوهای پرتکرار:</span>
              {site?.popularServices.slice(0,4).map((item) => (
                <Link key={item.id} to={`/services/${item.slug}`} className="rounded-full bg-white/80 px-3 py-1.5 ring-1 ring-navy-900/8 hover:bg-brand-50">{item.title}</Link>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-navy-500">
              <span className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-emerald-600" /> ارسال امن مدارک</span>
              <span className="flex items-center gap-1.5"><Clock className="size-4 text-brand-600" /> پیگیری لحظه‌ای وضعیت</span>
              <span className="flex items-center gap-1.5"><BadgeCheck className="size-4 text-navy-700" /> کارشناس اختصاصی هر پرونده</span>
            </div>
          </div>

          {/* Actual catalogue data — no fictional personal requests or tracking codes. */}
          <div className="relative animate-in lg:pr-7">
            <div className="journey-panel overflow-hidden rounded-[2rem] border border-white/20 bg-navy-900 p-6 text-white shadow-2xl sm:p-8">
              <div className="flex items-center justify-between"><span className="text-xs tracking-wide text-white/60">میز خدمت دیجیتال</span><span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px]"><span className="size-1.5 rounded-full bg-teal-300" />همراه شما، قدم‌به‌قدم</span></div>
              <h2 className="mt-7 text-2xl font-bold leading-relaxed">از انتخاب خدمت<br /><span className="text-teal-200">تا تحویل نتیجه.</span></h2>
              <div className="my-7 grid grid-cols-3 gap-2 text-center text-xs text-white/70">{[['۱','انتخاب خدمت'],['۲','ثبت و بررسی'],['۳','پیگیری نتیجه']].map(([n,t])=><div key={n}><span className="mx-auto mb-2 grid size-9 place-items-center rounded-xl border border-white/15 bg-white/5 font-bold text-teal-200">{n}</span>{t}</div>)}</div>
              <div className="rounded-2xl bg-white p-4 text-navy-900"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold">از کجا شروع کنیم؟</span><span className="text-[10px] text-navy-500">خدمات موجود در سامانه</span></div>
                {site?.popularServices.slice(0,3).map(item=><Link key={item.id} to={`/services/${item.slug}`} className="group flex items-center gap-3 border-t border-navy-100 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><FileCheck2 className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{item.title}</span><span className="mt-1 block text-[10px] text-navy-500">{item.categoryTitle ?? 'مشاهده جزئیات و شرایط'}</span></span><ChevronLeft className="size-4 text-navy-400 group-hover:text-brand-700" /></Link>)}
                {!site?.popularServices.length&&<Link to="/services" className="btn-soft w-full">مرور فهرست خدمات <ArrowLeft className="size-4" /></Link>}
              </div>
              <p className="mt-5 flex items-center gap-2 text-[11px] text-white/60"><ShieldCheck className="size-4 text-teal-200" />مدارک و گفت‌وگوهای شما در حساب کاربری خودتان</p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-navy-900">دسته‌بندی خدمات</h2>
            <p className="mt-1 text-sm text-navy-500">دسته مورد نظر خود را انتخاب کنید تا خدمات مرتبط را ببینید.</p>
          </div>
          <Link to="/services" className="btn-ghost btn-sm">همه خدمات <ArrowLeft className="size-4" /></Link>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {site?.categories.map((category) => (
            <Link
              key={category.id}
              to={`/services?category=${category.slug}`}
              className="group card overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="relative h-36 overflow-hidden bg-navy-50">
                {category.image ? (
                  <img src={category.image} alt={category.title} className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" />
                ) : (
                  <div className="size-full bg-gradient-to-br from-brand-100 to-navy-100" />
                )}
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-navy-900">{category.title}</h3>
                  <span className="badge bg-navy-50 text-navy-600">{faNum(category.serviceCount)} خدمت</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-6 text-navy-500">{category.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700">
                  مشاهده خدمات <ChevronLeft className="size-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Popular services */}
      <section className="bg-white/70 py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-navy-900">خدمات پرکاربرد</h2>
              <p className="mt-1 text-sm text-navy-500">{setting('services.catalog_notice')}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {site?.popularServices.slice(0, 8).map((service) => (
              <Link key={service.id} to={`/services/${service.slug}`}
                className="group card flex flex-col gap-2 p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <FileCheck2 className="size-5" />
                </span>
                <h3 className="text-sm font-semibold leading-6 text-navy-900">{service.title}</h3>
                <p className="line-clamp-2 text-xs leading-5 text-navy-500">{service.summary}</p>
                <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-navy-500">
                  <span>{service.estimatedDays ? `${faNum(service.estimatedDays)} روز کاری` : '—'}</span>
                  <span className="font-medium text-navy-800">{rial(service.finalFee)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="text-center text-xl font-bold text-navy-900">در سه گام ساده</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            { icon: <Search className="size-6" />, title: 'خدمت را پیدا کنید', text: 'با جست‌وجوی هوشمند یا دستیار، خدمت مناسب را انتخاب کنید.' },
            { icon: <ClipboardList className="size-6" />, title: 'درخواست را ثبت کنید', text: 'فرم اختصاصی خدمت را پر کنید و مدارک را بارگذاری کنید.' },
            { icon: <CreditCard className="size-6" />, title: 'پیگیری و پرداخت', text: 'وضعیت را زنده ببینید و هزینه را آنلاین یا حضوری پرداخت کنید.' },
          ].map((step, index) => (
            <div key={step.title} className="card card-pad">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700">{step.icon}</span>
                <div>
                  <p className="text-xs text-navy-400">گام {faNum(index + 1)}</p>
                  <p className="font-semibold text-navy-900">{step.title}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-7 text-navy-600">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Customer panel preview */}
      {!user && (
        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
          <div className="card overflow-hidden lg:grid lg:grid-cols-2">
            <div className="bg-gradient-to-l from-brand-700 to-navy-900 p-8 text-white lg:p-10">
              <h2 className="text-xl font-bold">پنل اختصاصی مشتری</h2>
              <p className="mt-2 text-sm leading-7 text-brand-100">
                پس از ورود، همه چیز در یک صفحه: درخواست‌های در جریان، فاکتورها، پیام‌های کارشناس و اعلان‌ها.
              </p>
              <ul className="mt-5 space-y-3 text-sm">
                {[
                  { icon: <ClipboardList className="size-4" />, text: 'پیگیری لحظه‌ای مراحل پرونده' },
                  { icon: <Bell className="size-4" />, text: 'اعلان تغییر وضعیت و پیام جدید' },
                  { icon: <CreditCard className="size-4" />, text: 'پرداخت آنلاین و مشاهده سابقه مالی' },
                  { icon: <UserRound className="size-4" />, text: 'ذخیره اطلاعات پرتکرار برای درخواست‌های بعدی' },
                ].map((item) => (
                  <li key={item.text} className="flex items-center gap-2 text-brand-50">
                    <span className="grid size-7 place-items-center rounded-lg bg-white/10">{item.icon}</span>
                    {item.text}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-2">
                <Link to="/login" className="btn bg-white text-navy-900 hover:bg-brand-50">ورود به پنل</Link>
                <Link to="/register" className="btn bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20">ایجاد حساب</Link>
              </div>
            </div>
            <div className="p-8 lg:p-10">
              <div className="flex items-center gap-2 text-sm font-medium text-navy-900">
                <Star className="size-4 text-amber-500" /> چرا مشتریان ما این سامانه را انتخاب می‌کنند؟
              </div>
              <div className="mt-4 space-y-4">
                {[
                  ['شفافیت کامل هزینه‌ها', 'هر مبلغ، پیش از پرداخت مشخص است و تغییرات در تاریخچه ثبت می‌شود.'],
                  ['نبود مراجعه حضوری غیرضروری', 'مدارک را آنلاین ارسال کنید و فقط برای امور الزامی مراجعه کنید.'],
                  ['پاسخ‌گویی کارشناس', 'گفت‌وگوی هر پرونده جدا از گفت‌وگوی عمومی است و تاریخچه دارد.'],
                ].map(([title, text]) => (
                  <div key={title} className="rounded-xl bg-navy-50/70 p-4">
                    <p className="text-sm font-semibold text-navy-900">{title}</p>
                    <p className="mt-1 text-xs leading-6 text-navy-600">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </PublicLayout>
  );
}
