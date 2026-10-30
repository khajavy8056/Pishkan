import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,Search, ArrowLeft, ShieldCheck, Clock, FileCheck2, Sparkles, MessageSquare, CreditCard,
  ClipboardList, Bell, UserRound, ChevronLeft, Star, Users, BadgeCheck,
} from 'lucide-react';
import { PublicLayout } from '../../components/public-layout';
import { useSite, type Service } from '../../lib/site';
import { useAuth,homeFor } from '../../lib/auth';
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
      <section className="civic-hero relative mb-10">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 pb-24 pt-12 sm:px-6 lg:grid-cols-[1fr_340px] lg:gap-16 lg:pb-28 lg:pt-16">
          <div className="relative z-10 text-white"><span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs"><ShieldCheck className="size-4" />سامانه هوشمند خدمات و اتوماسیون دفتر{setting('office.city') && <span className="mr-1 border-r border-white/30 pr-2">{setting('office.city')}، {setting('office.province')}</span>}</span><h1 className="text-3xl font-black leading-[1.7] sm:text-4xl">دسترسی آسان به خدمات<br /><span className="text-blue-200">پیگیری شفاف، از ثبت تا نتیجه</span></h1><p className="mt-4 max-w-lg text-sm leading-8 text-blue-100">{setting('site.welcome_message') || 'خدمت مورد نظر را انتخاب کنید، مدارک را امن ارسال کنید و مراحل انجام کار را از حساب خود دنبال کنید.'}</p>
          <form onSubmit={submitSearch} className="relative mt-7 max-w-xl"><div className="flex items-center gap-2 rounded-xl bg-white p-2 shadow-lg"><Search className="mr-2 size-5 shrink-0 text-navy-400" /><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="چه خدمتی نیاز دارید؟" aria-label="جست‌وجوی خدمات" className="min-w-0 flex-1 bg-transparent py-2 text-sm text-navy-900 outline-none" /><Button type="submit">جست‌وجو</Button></div>{query.trim().length>=2&&<div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl bg-white text-navy-900 shadow-xl">{searching&&<p className="p-4 text-xs">در حال جست‌وجو…</p>}{!searching&&results?.length===0&&<p className="p-4 text-xs">خدمتی یافت نشد. عبارت دیگری را امتحان کنید.</p>}{results?.map(item=><Link key={item.id} to={`/services/${item.slug}`} className="flex items-center justify-between border-b border-navy-100 px-4 py-3 text-sm hover:bg-brand-50">{item.title}<ChevronLeft className="size-4" /></Link>)}</div>}</form><p className="mt-6 flex flex-wrap gap-5 text-xs text-blue-100"><span className="flex items-center gap-2"><FileCheck2 className="size-4" />ارسال و بررسی مدارک</span><span className="flex items-center gap-2"><Clock className="size-4" />تاریخچه مراحل پرونده</span></p><p className="mt-6 text-[10px] text-white/55">تصویر ساختمان تزئینی و تولیدشده است؛ تصویر دفتر واقعی نیست.</p></div>
          <div className="relative z-10 rounded-2xl bg-white p-6 shadow-2xl"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Building2 className="size-8" /></div><h2 className="text-center text-lg font-bold text-navy-900">ورود به سامانه</h2><p className="mb-6 mt-2 text-center text-xs text-navy-500">یک سامانه، پنل‌های متناسب با نقش شما</p>{user?<Link to={homeFor(user)} className="btn-primary w-full">ورود به پنل من <ArrowLeft className="size-4" /></Link>:<div className="space-y-3"><Link to="/login?account=customer" className="btn-primary w-full"><UserRound className="size-4" />ورود مشتریان</Link><Link to="/login?account=staff" className="btn-soft w-full"><Users className="size-4" />ورود کارکنان و مدیران</Link><Link to="/register" className="btn-ghost w-full">ثبت‌نام مشتری جدید</Link></div>}<div className="mt-6 border-t border-navy-100 pt-4 text-center"><Link className="text-xs text-brand-700" to="/assistant">راهنما و دستیار خدمات <ChevronLeft className="inline size-3" /></Link><p className="mt-3 text-[10px] leading-5 text-navy-500">کارکنان، حسابداران و مدیران از یک درگاه وارد می‌شوند؛ امکانات بر اساس دسترسی حساب نمایش داده می‌شود.</p></div></div>
        </div>
        <div className="relative z-10 mx-auto -mt-10 max-w-5xl px-4"><div className="grid grid-cols-2 gap-3 rounded-2xl border border-navy-100 bg-white p-4 shadow-lg sm:flex sm:justify-around">{site?.categories.map(c=><Link key={c.id} to={`/services?category=${c.slug}`} className="flex flex-col items-center gap-2 rounded-xl px-4 py-2 text-center text-xs font-medium text-navy-700 transition hover:bg-brand-50"><span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700"><FileCheck2 className="size-5" /></span>{c.title}<small className="text-[10px] font-normal text-navy-400">{faNum(c.serviceCount)} خدمت</small></Link>)}</div></div>
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
