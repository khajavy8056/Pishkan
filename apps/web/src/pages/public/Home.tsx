/**
 * Public landing page.
 *
 * Composition, top to bottom:
 *   hero (3D depth field + tilting scene) → search → categories → popular
 *   services → the journey (scroll-pinned) → the app (live phone demo) →
 *   trust/stats → CTA.
 *
 * Every animated section degrades to a readable static layout: reduced motion
 * removes the movement, a narrow viewport replaces the sticky panel and the 3D
 * phone with flat equivalents, and a missing IntersectionObserver simply shows
 * the content. The settings-driven copy (`landing.*`) still controls the text,
 * so the office can keep editing the page from the panel.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, BellRing, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Download, FileCheck2, FileText, Headset, MousePointerClick, Search, Send, ShieldCheck,
  Smartphone, Sparkles, Star, Wallet, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { formatDuration, isInternalLink, parseListSetting, useSite, type Service } from '../../lib/site';
import { useBrand, BrandMark } from '../../lib/brand';
import { useAuth, homeFor } from '../../lib/auth';
import { api } from '../../lib/api';
import { faNum, rial } from '../../lib/format';
import { Button } from '../../components/ui';
import { CategoryArt, CategoryIcon, CustomHtml, FeatureIcon, ShieldArt } from '../../components/visual';
import { HeroField } from '../../components/landing-hero-field';
import { HeroStage } from '../../components/landing-hero-stage';
import { AppDevice, AppDeviceCards } from '../../components/landing-app-device';
import { AppInstallNote, AppStoreButtons } from '../../components/app-store-buttons';
import { RequestStack } from '../../components/landing-stack';
import { ParallaxBand } from '../../components/landing-parallax-band';
import {
  usePointerTilt, usePrefersReducedMotion, useExitProgress, useRevealOnScroll, useScrollState,
} from '../../components/landing-motion';

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
  if (isInternalLink(to) && to.startsWith('/app')) {
    if (!user) href = `/login?next=${encodeURIComponent(to)}`;
    else if (user.kind !== 'customer') href = homeFor(user);
  }
  if (isInternalLink(href)) return <Link to={href} className={className}>{children}</Link>;
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}

/** Counts a number up when it first scrolls into view. */
function CountUp({ value, suffix = '', className }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) { setShown(value); return; }
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== 'function') { setShown(value); return; }
    let frame = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      const started = performance.now();
      const duration = 1100;
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        // easeOutExpo: fast start, soft landing — reads as "counting up".
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        setShown(Math.round(value * eased));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [value, reduced]);

  return <span ref={ref} className={clsx('stat-number', className)}>{faNum(shown)}{suffix}</span>;
}

export function HomePage() {
  const { site, setting } = useSite();
  const brand = useBrand();
  const { user } = useAuth();
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const isCustomer = user?.kind === 'customer';
  const servicesHref = isCustomer ? '/app/services' : '/services';
  const serviceHref = (slug: string) => (isCustomer ? `/app/services/${slug}` : `/services/${slug}`);
  const categoryHref = (slug: string) => (isCustomer ? `/app/services?category=${slug}` : `/services?category=${slug}`);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Service[] | null>(null);
  const [searching, setSearching] = useState(false);
  const catRailRef = useRef<HTMLDivElement>(null);

  // Pointer tokens live on the page root: the hero stage, the parallax band
  // and the phone all read `--mx`/`--my` from here instead of each running a
  // separate listener and a separate easing loop.
  const pageRef = usePointerTilt<HTMLDivElement>(1);
  const categoriesReveal = useRevealOnScroll<HTMLElement>();
  const servicesReveal = useRevealOnScroll<HTMLElement>();
  const appReveal = useRevealOnScroll<HTMLElement>();
  const statsReveal = useRevealOnScroll<HTMLElement>();
  const { scrolled, progress } = useScrollState(30);
  // Drives the hero's "leaving the viewport" motion: pieces lift at different
  // rates as the section scrolls away, which is what makes the depth read on
  // the way out and not just on pointer hover.
  const heroScroll = useExitProgress<HTMLElement>('--hero');

  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ data: Service[] }>('/api/public/search', { q: query, limit: 5 });
        setResults(res.data);
      } catch { setResults([]); } finally { setSearching(false); }
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

  const features = parseListSetting<LandingFeature>(setting('landing.features'), DEFAULT_FEATURES).filter((f) => f?.title);
  const heroTitle = setting('landing.hero_title') || brand.name;
  const featuresTitle = setting('landing.features_title') || `چرا ${brand.name}؟`;
  const appTitle = setting('landing.app_title') || `اپلیکیشن اندروید ${brand.name}`;
  // Three install destinations, each with its own setting. Empty means "not
  // published yet": the button still appears, as a disabled coming-soon card.
  const appLinks = {
    direct: setting('landing.app_android_url') || undefined,
    bazaar: setting('landing.app_bazaar_url') || undefined,
    myket: setting('landing.app_myket_url') || undefined,
    directLabel: setting('landing.app_button_label') || 'دانلود مستقیم',
    showComingSoon: setting('landing.app_coming_soon') !== 'false',
  };
  const showApp = setting('landing.show_app_section') !== 'false';
  const showStats = setting('landing.show_stats') !== 'false';
  const stats = site?.stats;
  const customersStat = setting('landing.stat_customers');
  const categoryBySlug = new Map((site?.categories ?? []).map((c) => [c.slug, c]));

  return (
    <PublicLayout>
      <div ref={pageRef} className="landing">
        {/* reading-progress hairline, pinned under the header */}
        <div
          aria-hidden="true"
          className={clsx('fixed inset-x-0 top-0 z-50 h-[3px] origin-right bg-gradient-to-l from-brand-400 via-sky-400 to-emerald-400 transition-opacity', scrolled ? 'opacity-100' : 'opacity-0')}
          style={{ transform: `scaleX(${progress})` }}
        />

        {/* ================================ HERO ================================ */}
        <section ref={heroScroll} className="hero-sky landing-stage relative overflow-hidden pb-10 sm:pb-16" aria-label="معرفی سامانه">
          {/* 3D particle depth field */}
          <HeroField
            className="pointer-events-none absolute inset-0 size-full opacity-70"
            lightness={0.62}
            density={1}
            reducedMotion={reduced}
          />
          <div aria-hidden="true" className="pointer-events-none absolute -top-32 right-[8%] size-[26rem] rounded-full border border-dashed border-brand-300/40" />
          <div aria-hidden="true" className="pointer-events-none absolute top-24 -left-24 size-80 rounded-full bg-brand-400/20 blur-3xl" />

          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8 lg:pt-16">
            {/* ------------------------------ copy ------------------------------ */}
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-surface/80 px-3.5 py-1.5 text-xs font-semibold text-accent shadow-xs backdrop-blur">
                <ShieldCheck className="size-4" />
                {setting('landing.hero_badge')}
                {(setting('office.city') || setting('office.province')) && (
                  <span className="border-r border-line-strong pr-2 text-navy-500">{setting('office.city')}، {setting('office.province')}</span>
                )}
              </span>

              <h1 className="mt-5 text-balance text-4xl font-black leading-[1.32] tracking-tight text-navy-950 sm:text-5xl sm:leading-[1.26] lg:text-[3.4rem]">
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
                <div className="flex items-center gap-2 rounded-full bg-surface p-1.5 shadow-xl shadow-navy-900/5 ring-1 ring-line transition focus-within:ring-2 focus-within:ring-brand-300">
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
                      <Link key={item.id} to={serviceHref(item.slug)}
                        className="flex items-center justify-between border-b border-line px-4 py-3 text-sm transition last:border-0 hover:bg-brand-50">
                        <span className="flex items-center gap-2">
                          <span className="grid size-8 place-items-center rounded-xl text-white" style={{ background: categoryBySlug.get(item.categorySlug ?? '')?.color ?? '#1d4ed8' }}>
                            <CategoryIcon name={item.icon || categoryBySlug.get(item.categorySlug ?? '')?.icon} className="size-4" />
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

            {/* --------------------------- 3D hero stage ----------------------- */}
            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <HeroStage heroImage={brand.heroImage} />

              {/* scroll cue */}
              <div className="mt-6 flex justify-center lg:justify-start">
                <span className="inline-flex items-center gap-2 rounded-full bg-surface/70 px-3.5 py-1.5 text-[11px] font-semibold text-navy-500 ring-1 ring-line backdrop-blur">
                  <MousePointerClick className="size-3.5" />
                  برای دیدن مسیر کامل، اسکرول کنید
                  <span className="relative flex h-4 w-2.5 items-start justify-center rounded-full border border-navy-300">
                    <span className="mt-0.5 size-1 animate-bounce rounded-full bg-navy-400" />
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ============================= CATEGORIES ============================= */}
        <section ref={categoriesReveal} className="mx-auto max-w-7xl px-4 pt-2 pb-2 sm:px-6" aria-label="دسته‌بندی خدمات">
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
              <div data-reveal>
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

            <div ref={catRailRef} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:gap-4 sm:px-6 md:[mask-image:linear-gradient(to_left,transparent,#000_2%,#000_98%,transparent)]">
              {(site?.categories ?? []).map((category, index) => (
                <Link
                  key={category.id}
                  to={categoryHref(category.slug)}
                  data-reveal="zoom"
                  style={{ animationDelay: `${index * 30}ms` }}
                  className="group w-[8.8rem] shrink-0 snap-start rounded-[1.6rem] bg-surface p-4 shadow-md shadow-navy-900/5 ring-1 ring-line transition duration-300 hover:-translate-y-1.5 hover:shadow-xl sm:w-40"
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

        {/* ========================== POPULAR SERVICES ========================= */}
        <section ref={servicesReveal} className="mx-auto max-w-7xl px-4 py-8 sm:px-6" aria-label="خدمات پرکاربرد">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div data-reveal>
              <h2 className="text-xl font-black text-navy-900 sm:text-2xl">خدمات پرکاربرد</h2>
              <p className="mt-1 text-sm text-navy-500">{setting('services.catalog_notice')}</p>
            </div>
            <Link to={servicesHref} className="btn-soft btn-sm" data-reveal="left">مشاهدهٔ همه <ArrowLeft className="size-4" /></Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(site?.popularServices ?? []).slice(0, 8).map((service, index) => {
              const category = categoryBySlug.get(service.categorySlug ?? '');
              const color = category?.color ?? '#1d4ed8';
              return (
                <Link
                  key={service.id}
                  to={serviceHref(service.slug)}
                  data-reveal
                  style={{ transitionDelay: `${Math.min(index, 6) * 55}ms` }}
                  className="group card flex flex-col gap-2 p-5 transition duration-300 hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="grid size-12 place-items-center rounded-2xl text-white shadow-md transition duration-300 group-hover:scale-110 group-hover:rotate-3"
                      style={{ background: `linear-gradient(150deg, color-mix(in oklab, ${color} 78%, #fff) 0%, ${color} 100%)` }}
                    >
                      <CategoryIcon name={service.icon || category?.icon} className="size-6" />
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

        {/* ========================= PARALLAX BAND ============================ */}
        <ParallaxBand />

        {/* ========================== THE LAYER STACK =========================== */}
        <RequestStack />

        {/* ================================ APP ================================ */}
        {(showApp || features.length > 0) && (
          <section ref={appReveal} className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
            {showApp && (
              <div className="relative overflow-hidden rounded-[2.4rem] bg-gradient-to-bl from-brand-700 via-brand-800 to-navy-950 px-5 py-9 shadow-2xl shadow-brand-950/30 sm:px-9 sm:py-12">
                <div aria-hidden="true" className="pointer-events-none absolute -top-32 -left-24 size-96 rounded-full bg-brand-400/25 blur-3xl" />
                <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-32 size-96 rounded-full bg-emerald-400/15 blur-3xl" />
                <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0 opacity-[0.07]" />

                <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-6">
                  {/* copy */}
                  <div className="order-2 lg:order-1">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/85 ring-1 ring-white/15">
                      <Smartphone className="size-3.5" /> اپلیکیشن اندروید
                    </span>
                    <h2 className="mt-3 text-2xl font-black leading-[1.35] text-white sm:text-[2rem]">{appTitle}</h2>
                    <p className="mt-3 max-w-lg text-sm leading-7 text-white/70">{setting('landing.app_text')}</p>

                    <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                      {[
                        { icon: Send, text: 'ثبت و پیگیری درخواست‌ها از هرجا' },
                        { icon: BellRing, text: 'اعلان لحظه‌ای تغییر وضعیت پرونده' },
                        { icon: Wallet, text: 'مدیریت کیف پول و پرداخت آنلاین' },
                        { icon: FileCheck2, text: 'آرشیو همیشگی مدارک و رسیدها' },
                      ].map((item) => (
                        <li key={item.text} className="flex items-center gap-2.5 text-[13px] font-semibold text-white/90">
                          <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-white/12 text-white ring-1 ring-white/15">
                            <item.icon className="size-3.5" />
                          </span>
                          {item.text}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-7">
                      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold text-white/50">
                        <Smartphone className="size-3.5" />
                        نصب روی اندروید
                      </p>
                      <AppStoreButtons links={appLinks} size="lg" className="max-w-lg" />
                    </div>
                    <AppInstallNote />
                  </div>

                  {/* phone */}
                  <div className="order-1 flex justify-center lg:order-2">
                    <div className="hidden w-full lg:block">
                      <AppDevice reducedMotion={reduced} />
                    </div>
                    <div className="w-full max-w-sm lg:hidden">
                      <AppDeviceCards reducedMotion={reduced} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* why us */}
            {features.length > 0 && (
              <div className="mt-6">
                <div className="mb-5 flex items-end justify-between gap-3" data-reveal>
                  <h2 className="text-xl font-black text-navy-900 sm:text-2xl">{featuresTitle}</h2>
                  <span className="hidden items-center gap-1.5 text-xs font-semibold text-navy-400 sm:flex">
                    <CheckCircle2 className="size-4 text-emerald-500" /> همه در یک سامانه
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {features.slice(0, 6).map((feature, index) => (
                    <div
                      key={feature.title}
                      data-reveal
                      style={{ transitionDelay: `${Math.min(index, 6) * 60}ms` }}
                      className="group relative overflow-hidden rounded-[1.6rem] bg-surface p-5 ring-1 ring-line transition duration-300 hover:-translate-y-1 hover:shadow-xl"
                    >
                      <div aria-hidden="true" className="absolute -top-10 -left-10 size-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                        style={{ background: FEATURE_COLORS[feature.icon] ?? '#2563eb' }} />
                      <span className="relative grid size-11 place-items-center rounded-2xl bg-surface shadow-md ring-1 ring-line transition duration-300 group-hover:scale-110 group-hover:-rotate-3"
                        style={{ color: FEATURE_COLORS[feature.icon] ?? '#2563eb' }}>
                        <FeatureIcon name={feature.icon} className="size-5.5" />
                      </span>
                      <p className="relative mt-3 text-sm font-black text-navy-900">{feature.title}</p>
                      <p className="relative mt-1 text-xs leading-6 text-navy-500">{feature.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* =============================== STATS =============================== */}
        {showStats && stats && (
          <section ref={statsReveal} className="mx-auto max-w-7xl px-4 py-6 sm:px-6" aria-label="آمار سامانه">
            <div className="card relative overflow-hidden">
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-brand-400 via-brand-600 to-brand-400" />
              <ShieldArt className="absolute -top-10 left-3 z-10 hidden w-24 sm:block lg:left-5 lg:w-28" />
              <div className="grid grid-cols-2 divide-x divide-line sm:pl-24 lg:grid-cols-4 lg:pl-36">
                <div className="stat-tile flex flex-col items-center gap-1 px-4 py-6 text-center" data-reveal>
                  <span className="grid size-14 place-items-center rounded-[1.2rem] bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-600/40 ring-1 ring-white/40">
                    <CheckCircle2 className="size-6" />
                  </span>
                  <span className="mt-2 text-base font-black text-navy-900 sm:text-lg">امن و قابل اعتماد</span>
                  <span className="text-xs text-navy-500">با استانداردهای روز</span>
                </div>
                <div className="stat-tile flex flex-col items-center gap-1 px-4 py-6 text-center" data-reveal style={{ transitionDelay: '80ms' }}>
                  <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-accent"><BadgeCheck className="size-5" /></span>
                  <CountUp value={stats.services} suffix="+" className="mt-2 text-xl font-black text-navy-900 sm:text-2xl" />
                  <span className="text-xs text-navy-500">خدمت متنوع</span>
                </div>
                <div className="stat-tile flex flex-col items-center gap-1 px-4 py-6 text-center" data-reveal style={{ transitionDelay: '160ms' }}>
                  <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-accent"><Sparkles className="size-5" /></span>
                  {customersStat
                    ? <span className="stat-number mt-2 text-xl font-black text-navy-900 sm:text-2xl">{customersStat}</span>
                    : <CountUp value={stats.customers} suffix="+" className="mt-2 text-xl font-black text-navy-900 sm:text-2xl" />}
                  <span className="text-xs text-navy-500">{setting('landing.stat_customers_label') || 'مشتری همراه'}</span>
                </div>
                <div className="stat-tile flex flex-col items-center gap-1 px-4 py-6 text-center" data-reveal style={{ transitionDelay: '240ms' }}>
                  <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-accent"><Headset className="size-5" /></span>
                  <span className="mt-2 text-base font-black text-navy-900 sm:text-lg">پشتیبانی</span>
                  <span className="text-xs text-navy-500">{setting('office.working_hours') || 'در تمام روزهای هفته'}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================================ CTA ================================ */}
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6" data-reveal="zoom">
          <div className="relative overflow-hidden rounded-[2.2rem] bg-gradient-to-l from-brand-600 via-brand-700 to-brand-800 px-6 py-10 text-center shadow-2xl shadow-brand-900/25 sm:px-10 sm:py-12">
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-1/4 size-72 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 left-1/4 size-80 rounded-full bg-emerald-400/20 blur-3xl" />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-2xl font-black leading-[1.4] text-white sm:text-3xl">همین حالا درخواستت را ثبت کن</h2>
              <p className="mt-3 text-sm leading-7 text-white/80">
                بدون صف، بدون رفت‌وآمد. مدارکت را آپلود کن و پیشرفت پرونده را لحظه‌به‌لحظه ببین.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <CtaLink to={setting('landing.primary_cta_link') || '/app/services'} className="btn-lg rounded-full bg-white px-7 font-black text-brand-800 shadow-xl transition hover:scale-[1.03] hover:bg-white">
                  <Send className="size-5 -scale-x-100" />
                  شروع کنید
                </CtaLink>
                <Link to={servicesHref} className="btn-lg rounded-full border-2 border-white/30 px-7 font-bold text-white transition hover:bg-white/10">
                  مرور خدمات
                  <ArrowLeft className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <CustomHtml html={setting('landing.custom_html')} className="mx-auto max-w-7xl px-4 py-6 sm:px-6" />
      </div>
    </PublicLayout>
  );
}
