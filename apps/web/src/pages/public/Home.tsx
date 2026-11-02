import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, BellRing, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Download, FileCheck2, FileText, Headset, Search, Send, ShieldCheck, Sparkles, Wallet, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { formatDuration, isInternalLink, parseListSetting, useSite, type Service } from '../../lib/site';
import { useBrand, BrandMark } from '../../lib/brand';
import { useAuth, homeFor } from '../../lib/auth';
import { api } from '../../lib/api';
import { faNum, rial } from '../../lib/format';
import { Button } from '../../components/ui';
import { CategoryArt, CategoryIcon, CustomHtml, FeatureIcon, PhoneMockup, ShieldArt, Tilt } from '../../components/visual';

interface LandingFeature { icon: string; title: string; text: string }

const DEFAULT_FEATURES: LandingFeature[] = [
  { icon: 'zap', title: 'سرعت بالا', text: 'ثبت و پیگیری درخواست در چند دقیقه، بدون مراجعهٔ غیرضروری.' },
  { icon: 'shield-check', title: 'امنیت پیشرفته', text: 'مدارک و اطلاعات شما فقط در دسترس کارشناس مسئول است.' },
  { icon: 'headset', title: 'پشتیبانی قوی', text: 'گفت‌وگوی زنده با دفتر و پاسخ‌گویی کارشناسان در ساعات کاری.' },
  { icon: 'heart-handshake', title: 'رضایت مشتریان', text: 'شفافیت کامل هزینه و مراحل، از ثبت تا تحویل نهایی.' },
  { icon: 'cpu', title: 'مدیریت هوشمند', text: 'ارجاع خودکار پرونده به کارشناس مناسب و یادآوری‌های به‌موقع.' },
  { icon: 'badge-check', title: 'رعایت استانداردها', text: 'فرایندها مطابق ضوابط دفاتر پیشخوان دولت و قابل حسابرسی.' },
];

const FEATURE_COLORS: Record<string, string> = {
  zap: '#f59e0b',
  'shield-check': '#059669',
  shield: '#059669',
  headset: '#0284c7',
  'heart-handshake': '#e11d48',
  cpu: '#7c3aed',
  'badge-check': '#2563eb',
};

function CtaLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  const { user } = useAuth();
  let href = to;
  // Anything inside the customer panel goes through the login door first for
  // guests; after signing in they land exactly where the button promised.
  if (isInternalLink(to) && to.startsWith('/app')) {
    if (!user) href = `/login?next=${encodeURIComponent(to)}`;
    else if (user.kind !== 'customer') href = homeFor(user);
  }
  if (isInternalLink(href)) return <Link to={href} className={className}>{children}</Link>;
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}

export function HomePage() {
  const { site, setting } = useSite();
  const brand = useBrand();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isCustomer = user?.kind === 'customer';
  const servicesHref = isCustomer ? '/app/services' : '/services';
  const serviceHref = (slug: string) => (isCustomer ? `/app/services/${slug}` : `/services/${slug}`);
  const categoryHref = (slug: string) => (isCustomer ? `/app/services?category=${slug}` : `/services?category=${slug}`);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Service[] | null>(null);
  const [searching, setSearching] = useState(false);
  const catRailRef = useRef<HTMLDivElement>(null);

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

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    navigate(`${servicesHref}?q=${encodeURIComponent(query)}`);
  };

  const scrollCats = (direction: 1 | -1) => {
    catRailRef.current?.scrollBy({ left: direction * 340, behavior: 'smooth' });
  };

  const features = parseListSetting<LandingFeature>(setting('landing.features'), DEFAULT_FEATURES)
    .filter((f) => f?.title);
  const heroTitle = setting('landing.hero_title') || brand.name;
  const featuresTitle = setting('landing.features_title') || `چرا ${brand.name}؟`;
  const appTitle = setting('landing.app_title') || `اپلیکیشن اندروید ${brand.name}`;
  const appUrl = setting('landing.app_android_url');
  const showApp = setting('landing.show_app_section') !== 'false';
  const showStats = setting('landing.show_stats') !== 'false';
  const stats = site?.stats;
  const customersStat = setting('landing.stat_customers') || (stats ? `${faNum(stats.customers)}+` : '—');

  const categoryBySlug = new Map((site?.categories ?? []).map((c) => [c.slug, c]));

  return (
    <PublicLayout>
      {/* ------------------------------- hero -------------------------------- */}
      <section className="hero-sky relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-[12%] size-72 rounded-full border-2 border-dashed border-brand-300/40" />
        <div aria-hidden="true" className="pointer-events-none absolute top-40 -left-20 size-64 rounded-full bg-brand-400/15 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pt-10 pb-14 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:pt-16 lg:pb-20">
          {/* copy */}
          <div className="animate-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-surface/80 px-3.5 py-1.5 text-xs font-semibold text-accent shadow-xs backdrop-blur">
              <ShieldCheck className="size-4" />
              {setting('landing.hero_badge')}
              {(setting('office.city') || setting('office.province')) && (
                <span className="border-r border-line-strong pr-2 text-navy-500">{setting('office.city')}، {setting('office.province')}</span>
              )}
            </span>

            <h1 className="mt-5 text-4xl font-black leading-[1.35] tracking-tight text-navy-950 sm:text-5xl sm:leading-[1.3]">
              {heroTitle}
            </h1>
            <p className="mt-3 text-lg font-bold text-accent sm:text-xl">{setting('landing.hero_subtitle')}</p>
            <p className="mt-3 max-w-xl text-sm leading-8 text-navy-600 sm:text-[15px]">{setting('landing.hero_text')}</p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <CtaLink to={setting('landing.primary_cta_link') || '/app/services'} className="btn-primary btn-lg animate-shine">
                <Send className="size-5 -scale-x-100" />
                {setting('landing.primary_cta_label') || 'ثبت درخواست خدمت'}
              </CtaLink>
              {setting('landing.secondary_cta_link') && (
                <CtaLink to={setting('landing.secondary_cta_link')} className="btn-soft btn-lg shadow-xl shadow-navy-900/10 ring-1 ring-white/70">
                  <Search className="size-5" />
                  {setting('landing.secondary_cta_label') || 'پیگیری درخواست'}
                </CtaLink>
              )}
            </div>

            <form onSubmit={submitSearch} className="relative mt-6 max-w-xl">
              <div className="flex items-center gap-2 rounded-full bg-surface p-1.5 shadow-xl shadow-navy-900/5 ring-1 ring-line">
                <Search className="mr-2 size-5 shrink-0 text-navy-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="چه خدمتی نیاز دارید؟ مثلاً: تعویض پلاک…"
                  aria-label="جست‌وجوی خدمات"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-navy-900 outline-none placeholder:text-navy-400"
                />
                <Button type="submit" className="rounded-full">جست‌وجو</Button>
              </div>
              {query.trim().length >= 2 && (
                <div className="animate-pop absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-3xl bg-surface text-navy-900 shadow-2xl ring-1 ring-line">
                  {searching && <p className="p-4 text-xs text-navy-500">در حال جست‌وجو…</p>}
                  {!searching && results?.length === 0 && <p className="p-4 text-xs text-navy-500">خدمتی یافت نشد. عبارت دیگری را امتحان کنید.</p>}
                  {results?.map((item) => (
                    <Link
                      key={item.id}
                      to={serviceHref(item.slug)}
                      className="flex items-center justify-between border-b border-line px-4 py-3 text-sm transition last:border-0 hover:bg-brand-50"
                    >
                      <span className="flex items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-xl text-white" style={{ background: categoryBySlug.get(item.categorySlug ?? '')?.color ?? '#1d4ed8' }}>
                          <CategoryIcon name={categoryBySlug.get(item.categorySlug ?? '')?.icon ?? item.icon} className="size-4" />
                        </span>
                        {item.title}
                      </span>
                      <ChevronLeft className="size-4 text-navy-400" />
                    </Link>
                  ))}
                </div>
              )}
            </form>

            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-navy-500">
              <li className="flex items-center gap-1.5"><FileCheck2 className="size-4 text-brand-600" /> ارسال و بررسی آنلاین مدارک</li>
              <li className="flex items-center gap-1.5"><Clock className="size-4 text-brand-600" /> تاریخچهٔ کامل مراحل پرونده</li>
              <li className="flex items-center gap-1.5"><BellRing className="size-4 text-brand-600" /> اعلان لحظه‌ای تغییر وضعیت</li>
            </ul>
          </div>

          {/* 3D scene */}
          <div className="perspective-1200 relative mx-auto w-full max-w-xl animate-in lg:max-w-none">
            <div aria-hidden="true" className="absolute inset-x-8 -bottom-5 h-10 rounded-[50%] bg-navy-950/15 blur-xl" />
            <div aria-hidden="true" className="absolute inset-x-16 -bottom-8 h-12 rounded-[50%] bg-brand-500/25 blur-2xl" />
            <div aria-hidden="true" className="absolute inset-x-2 -bottom-9 h-16 rounded-[50%] border-2 border-brand-400/35" />
            <div aria-hidden="true" className="absolute -inset-x-3 -bottom-12 h-20 rounded-[50%] border border-brand-300/25" />
            <Tilt maxX={6} maxY={8}>
              <div className="t3d relative">
                <div className="animate-shine relative overflow-hidden rounded-[2rem] shadow-2xl shadow-brand-900/25 ring-1 ring-white/50">
                  <img
                    src={brand.heroImage}
                    alt={`ساختمان ${brand.name}`}
                    className="aspect-[16/10.5] w-full object-cover sm:aspect-[16/9.5]"
                  />
                  <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-navy-950/35 to-transparent" />
                  <div className="absolute right-4 bottom-4 flex items-center gap-2 rounded-2xl bg-shell/55 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-md">
                    <Sparkles className="size-4 text-amber-300" />
                    {brand.tagline || 'سریع • مطمئن • آسان'}
                  </div>
                </div>

                <div
                  aria-hidden="true"
                  className="absolute bottom-2 left-3 hidden h-9 w-60 rounded-[50%] sm:block lg:left-5 lg:w-72"
                  style={{
                    transform: 'translateZ(26px)',
                    background: 'radial-gradient(50% 50% at 50% 42%, rgb(219 234 254 / .95) 0%, rgb(147 197 253 / .55) 45%, rgb(59 130 246 / .18) 72%, transparent 100%)',
                    boxShadow: '0 0 0 6px rgb(147 197 253 / .18), 0 18px 34px -12px rgb(37 99 235 / .5)',
                  }}
                />
                <div
                  className="absolute top-1/2 left-5 hidden w-52 rounded-[1.8rem] bg-white/85 p-5 text-center shadow-2xl shadow-navy-950/25 ring-1 ring-white/70 backdrop-blur-md sm:block lg:left-8 lg:w-60 lg:p-6"
                  style={{ transform: 'translateY(-47%) translateZ(92px) rotateY(8deg) rotateX(2deg)' }}
                >
                  <BrandMark className="mx-auto size-16 lg:size-20" />
                  <p className="mt-3 truncate text-lg font-black text-navy-950 lg:text-xl">{brand.name}</p>
                  {brand.nameEn && <p dir="ltr" className="mt-0.5 truncate text-xs font-semibold tracking-wide text-navy-500">{brand.nameEn}</p>}
                  <p className="mt-3 border-t border-navy-900/10 pt-2.5 text-xs font-bold text-accent">{brand.tagline || 'سریع • مطمئن • آسان'}</p>
                </div>

                <div className="glass-chip animate-floaty absolute -top-5 left-8 sm:left-14" style={{ transform: 'translateZ(64px)' }}>
                  <span className="grid size-9 place-items-center rounded-xl bg-emerald-500 text-white shadow-md shadow-emerald-600/40">
                    <ShieldCheck className="size-5" />
                  </span>
                  امن و معتبر
                </div>
                <div className="glass-chip animate-floaty-delay absolute top-[30%] -left-2 sm:-left-4" style={{ transform: 'translateZ(76px)' }}>
                  <span className="grid size-9 place-items-center rounded-xl bg-amber-500 text-white shadow-md shadow-amber-600/40">
                    <Zap className="size-5" />
                  </span>
                  سریع و آسان
                </div>
                <div className="glass-chip animate-floaty-slow absolute top-[15%] right-4 sm:right-6" style={{ transform: 'translateZ(60px)' }}>
                  <span className="grid size-9 place-items-center rounded-xl bg-sky-500 text-white shadow-md shadow-sky-600/40">
                    <Headset className="size-5" />
                  </span>
                  پشتیبانی حرفه‌ای
                </div>
                <div className="glass-chip animate-floaty-delay absolute right-[27%] bottom-[16%] hidden md:flex" style={{ transform: 'translateZ(52px)' }}>
                  <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-700/40">
                    <FileText className="size-5" />
                  </span>
                  ثبت آنلاین مدارک
                </div>
              </div>
            </Tilt>
          </div>
        </div>
      </section>

      {/* ---------------------------- categories ----------------------------- */}
      <section className="mx-auto max-w-7xl px-4 pt-4 pb-2 sm:px-6" aria-label="دسته‌بندی خدمات">
        <div className="relative rounded-[2rem] bg-gradient-to-b from-surface via-surface to-brand-50/70 px-4 py-5 shadow-xl shadow-navy-900/5 ring-1 ring-line sm:px-6 sm:py-6">
        <button type="button" onClick={() => scrollCats(1)} aria-label="دسته‌های قبلی"
          className="absolute top-1/2 -right-2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-surface text-navy-700 shadow-xl ring-1 ring-line transition hover:scale-105 md:grid">
          <ChevronRight className="size-5" />
        </button>
        <button type="button" onClick={() => scrollCats(-1)} aria-label="دسته‌های بعدی"
          className="absolute top-1/2 -left-2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-surface text-navy-700 shadow-xl ring-1 ring-line transition hover:scale-105 md:grid">
          <ChevronLeft className="size-5" />
        </button>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-navy-900 sm:text-2xl">دسته‌بندی خدمات</h2>
            <p className="mt-1 text-sm text-navy-500">دسترسی سریع به پرکاربردترین خدمات دولتی</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => scrollCats(1)} className="icon-btn border border-line bg-surface shadow-xs md:hidden" aria-label="دسته‌های قبلی">
              <ChevronRight className="size-5" />
            </button>
            <button type="button" onClick={() => scrollCats(-1)} className="icon-btn border border-line bg-surface shadow-xs md:hidden" aria-label="دسته‌های بعدی">
              <ChevronLeft className="size-5" />
            </button>
            <Link to={servicesHref} className="btn-ghost btn-sm">همهٔ خدمات <ArrowLeft className="size-4" /></Link>
          </div>
        </div>

        <div
          ref={catRailRef}
          className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:gap-4 sm:px-6"
        >
          {(site?.categories ?? []).map((category, index) => (
            <Link
              key={category.id}
              to={categoryHref(category.slug)}
              className="group w-[8.8rem] shrink-0 snap-start rounded-[1.6rem] bg-surface p-4 shadow-md shadow-navy-900/5 ring-1 ring-line transition duration-300 hover:-translate-y-1.5 hover:shadow-xl sm:w-40"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <CategoryArt name={category.icon} color={category.color} className="mx-auto size-[4.2rem] transition duration-300 group-hover:scale-110 group-hover:-rotate-3" glyphClassName="size-10" />
              <span className="mt-3 block text-center text-[13px] leading-6 font-bold text-navy-900">{category.title}</span>
              <span className="mt-0.5 block text-center text-[11px] text-navy-500">{faNum(category.serviceCount)} خدمت</span>
            </Link>
          ))}
          {(site?.categories ?? []).length === 0 && (
            <p className="px-2 py-6 text-sm text-navy-400">در حال بارگذاری دسته‌ها…</p>
          )}
        </div>
        </div>
      </section>

      {/* ------------------------- popular services -------------------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6" aria-label="خدمات پرکاربرد">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-navy-900 sm:text-2xl">خدمات پرکاربرد</h2>
            <p className="mt-1 text-sm text-navy-500">{setting('services.catalog_notice')}</p>
          </div>
          <Link to={servicesHref} className="btn-soft btn-sm">مشاهدهٔ همه <ArrowLeft className="size-4" /></Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(site?.popularServices ?? []).slice(0, 8).map((service) => {
            const category = categoryBySlug.get(service.categorySlug ?? '');
            const color = category?.color ?? '#1d4ed8';
            return (
              <Link
                key={service.id}
                to={serviceHref(service.slug)}
                className="group card flex flex-col gap-2 p-5 transition duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="grid size-12 place-items-center rounded-2xl text-white shadow-md transition duration-300 group-hover:scale-110 group-hover:rotate-3"
                    style={{ background: `linear-gradient(150deg, color-mix(in oklab, ${color} 78%, #fff) 0%, ${color} 100%)` }}
                  >
                    <CategoryIcon name={category?.icon ?? service.icon} className="size-6" />
                  </span>
                  {service.categoryTitle && <span className="badge bg-surface-3 text-navy-600">{service.categoryTitle}</span>}
                </div>
                <h3 className="text-sm leading-6 font-bold text-navy-900">{service.title}</h3>
                <p className="line-clamp-2 text-xs leading-5 text-navy-500">{service.summary}</p>
                <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[11px] text-navy-500">
                  <span className="flex items-center gap-1"><Clock className="size-3.5" /> {formatDuration(service.estimatedMinutes, service.estimatedDays)}</span>
                  <span className="text-xs font-bold text-navy-900">{rial(service.finalFee)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* --------------------------- app + why us ---------------------------- */}
      {(showApp || features.length > 0) && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className={clsx('grid gap-5', showApp && features.length > 0 ? 'lg:grid-cols-5' : '')}>
            {showApp && (
              <div className="card relative overflow-hidden lg:col-span-3">
                <div aria-hidden="true" className="pointer-events-none absolute -top-20 -left-16 size-64 rounded-full bg-brand-400/15 blur-3xl" />
                <div className="relative grid items-center gap-6 p-6 sm:grid-cols-[auto_1fr] sm:p-8">
                  <div className="relative order-2 mx-auto sm:order-1 sm:mx-0">
                    <Tilt maxX={8} maxY={10}>
                      <PhoneMockup />
                    </Tilt>
                    <img
                      src="/images/android-mascot.jpg"
                      alt="ربات اندروید"
                      loading="lazy"
                      className="animate-floaty-slow absolute -bottom-4 -left-4 hidden w-24 rotate-6 rounded-[1.5rem] shadow-2xl ring-4 ring-surface sm:block"
                    />
                  </div>
                  <div className="order-1 sm:order-2">
                    <h2 className="text-xl font-black text-navy-900 sm:text-2xl">{appTitle}</h2>
                    <p className="mt-2 text-sm leading-7 text-navy-600">{setting('landing.app_text')}</p>
                    <ul className="mt-4 space-y-2.5 text-sm font-semibold text-navy-800">
                      {[
                        'ثبت و پیگیری درخواست‌ها از هرجا',
                        'مشاهدهٔ اعلان‌ها و پیام‌های کارشناس',
                        'مدیریت کیف پول و پرداخت آنلاین',
                      ].map((text) => (
                        <li key={text} className="flex items-center gap-2.5">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-md shadow-brand-600/35"><Check className="size-3.5" strokeWidth={3} /></span>
                          {text}
                        </li>
                      ))}
                    </ul>
                    {appUrl ? (
                      <a
                        href={appUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-primary btn-lg mt-6"
                        style={{
                          backgroundImage: 'linear-gradient(180deg,#34d399 0%,#059669 55%,#047857 100%)',
                          boxShadow: '0 14px 28px -10px rgb(5 150 105 / .55), inset 0 1px 0 rgb(255 255 255 / .4), inset 0 -2px 0 rgb(0 0 0 / .15)',
                        }}
                      >
                        <Download className="size-5" />
                        {setting('landing.app_button_label') || 'دریافت اپلیکیشن'}
                      </a>
                    ) : (
                      <p className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                        <Sparkles className="size-4" /> نسخهٔ اندروید به‌زودی منتشر می‌شود؛ فعلاً از همین وب‌سایت روی گوشی استفاده کنید.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {features.length > 0 && (
              <div className={clsx('card p-6 sm:p-8', showApp ? 'lg:col-span-2' : '')}>
                <h2 className="text-xl font-black text-navy-900">{featuresTitle}</h2>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {features.slice(0, 6).map((feature) => (
                    <div key={feature.title} className="group rounded-3xl bg-surface-2 p-4 text-center ring-1 ring-line transition duration-300 hover:-translate-y-1 hover:bg-surface hover:shadow-lg">
                      <span
                        className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface shadow-md ring-1 ring-line transition duration-300 group-hover:scale-110 group-hover:-rotate-3"
                        style={{ color: FEATURE_COLORS[feature.icon] ?? '#2563eb' }}
                      >
                        <FeatureIcon name={feature.icon} className="size-6" />
                      </span>
                      <p className="mt-3 text-sm font-bold text-navy-900">{feature.title}</p>
                      <p className="mt-1 text-[11px] leading-5 text-navy-500">{feature.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------- stats -------------------------------- */}
      {showStats && stats && (
        <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6" aria-label="آمار سامانه">
          <div className="card relative">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-brand-400 via-brand-600 to-brand-400" />
            <ShieldArt className="absolute -top-10 left-3 z-10 hidden w-24 sm:block lg:left-5 lg:w-28" />
            <div className="grid grid-cols-2 divide-x divide-line sm:pl-24 lg:grid-cols-4 lg:pl-36">
              {(([
                { icon: <CheckCircle2 className="size-6" />, value: 'امن و قابل اعتماد', label: 'با استانداردهای روز', big: true },
                { icon: <BadgeCheck className="size-5" />, value: `${faNum(stats.services)}+`, label: 'خدمت متنوع' },
                { icon: <Sparkles className="size-5" />, value: customersStat, label: setting('landing.stat_customers_label') || 'مشتری همراه' },
                { icon: <Headset className="size-5" />, value: 'پشتیبانی', label: setting('office.working_hours') || 'در تمام روزهای هفته' },
              ] as { icon: React.ReactNode; value: string; label: string; big?: boolean }[])).map((item) => (
                <div key={item.label} className="flex flex-col items-center gap-1 px-4 py-6 text-center">
                  <span className={clsx(
                    'grid place-items-center',
                    item.big
                      ? 'size-14 rounded-[1.2rem] bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-600/40 ring-1 ring-white/40'
                      : 'size-11 rounded-2xl bg-primary-soft text-accent',
                  )}>{item.icon}</span>
                  <span className="mt-2 text-xl font-black text-navy-900 sm:text-2xl">{item.value}</span>
                  <span className="text-xs text-navy-500">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* --------------------------- custom HTML ------------------------------ */}
      <CustomHtml html={setting('landing.custom_html')} className="mx-auto max-w-7xl px-4 py-6 sm:px-6" />
    </PublicLayout>
  );
}
