import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Sparkles, TrendingUp } from 'lucide-react';
import { formatDuration, useSite, type Category, type Service } from '../../lib/site';
import { faNum, rial } from '../../lib/format';
import { useHoverTilt, useReveal } from '../landing-motion';
import { resolveGradient } from './LandingIcons';

function isImagePath(value?: string | null): value is string {
  return Boolean(value && (/^\/(images|uploads)\//.test(value) || /^https?:\/\//.test(value)));
}

function resolveCategoryImage(cat: Category): string {
  if (isImagePath(cat.icon)) return cat.icon;
  if (isImagePath(cat.image)) return cat.image;
  return '/images/services/other.png';
}

function resolveServiceImage(service: Service, category?: Category): string {
  if (isImagePath(service.icon)) return service.icon;
  if (isImagePath(service.image)) return service.image;
  if (category) return resolveCategoryImage(category);
  return '/images/services/other.png';
}

/* ---------------------------------- ticker -------------------------------- */

export function LandingTicker() {
  const { site } = useSite();
  const categories = site?.categories ?? [];
  if (categories.length === 0) return null;

  const loop = [...categories, ...categories];

  return (
    <div className="border-y border-line/60 bg-surface-2/65 py-3 backdrop-blur-md" aria-label="دسته‌های خدمات">
      <div className="ticker-wrap">
        <div className="ticker-track">
          {loop.map((cat, idx) => (
            <Link
              key={`${cat.id}-${idx}`}
              to={`/services?category=${encodeURIComponent(cat.slug)}`}
              className="ticker-item"
            >
              <img
                src={resolveCategoryImage(cat)}
                alt=""
                loading="lazy"
                className="size-5 shrink-0 rounded-md object-cover"
              />
              <span>{cat.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- category rail ----------------------------- */

export function LandingCategoryRail() {
  const { site, setting } = useSite();
  const railRef = useRef<HTMLDivElement>(null);
  const revealRef = useReveal<HTMLElement>();

  const categories = site?.categories ?? [];
  const title = setting('landing.categories_title') || 'همهٔ خدمات در یک نگاه';
  const subtitle = setting('landing.categories_subtitle') || 'دستهٔ مورد نظرتان را انتخاب کنید';

  const scrollByDir = (dir: -1 | 1) => {
    const node = railRef.current;
    if (!node) return;
    node.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  return (
    <section ref={revealRef} className={site && categories.length === 0 ? 'hidden' : 'py-14 sm:py-16'} aria-label="دسته‌بندی خدمات">
      {!site || categories.length > 0 ? (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4" data-reveal="">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-text">
                <Sparkles className="size-3.5" />
                دسته‌بندی‌های تخصصی
              </span>
              <h2 className="mt-1.5 text-2xl font-black text-text sm:text-3xl">{title}</h2>
              <p className="mt-1 text-sm text-muted">{subtitle}</p>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={() => scrollByDir(1)}
                aria-label="دسته‌های قبلی"
                className="lp-icon-btn"
              >
                <ChevronRight className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollByDir(-1)}
                aria-label="دسته‌های بعدی"
                className="lp-icon-btn"
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>
          </div>

          <div
            ref={railRef}
            className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {categories.map((cat, idx) => {
              const [g0] = resolveGradient(cat.slug, cat.color, idx);
              return (
                <Link
                  key={cat.id}
                  to={`/services?category=${encodeURIComponent(cat.slug)}`}
                  data-reveal=""
                  className="group w-[8.6rem] shrink-0 snap-start rounded-3xl border border-line bg-ink/65 p-4 text-center backdrop-blur-md transition duration-300 hover:-translate-y-1.5 hover:border-cyan-400/45 hover:shadow-xl hover:shadow-cyan-500/10 sm:w-40"
                >
                  <div
                    className="mx-auto grid size-16 place-items-center overflow-hidden rounded-2xl border border-white/25 bg-surface-2 shadow-lg transition-transform duration-300 group-hover:scale-105"
                    style={{ boxShadow: `0 12px 26px -10px ${g0}66` }}
                  >
                    <img
                      src={resolveCategoryImage(cat)}
                      alt={cat.title}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </div>
                  <p className="mt-3 line-clamp-2 min-h-[2.3rem] text-xs font-extrabold leading-[1.35rem] text-text transition-colors group-hover:text-brand-text">
                    {cat.title}
                  </p>
                  {typeof cat.serviceCount === 'number' ? (
                    <span className="mt-1.5 inline-block rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[10px] font-bold text-muted">
                      {faNum(cat.serviceCount)} خدمت
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ----------------------------- service card ----------------------------- */

function ServiceCard({
  service,
  category,
  index,
  isPopular,
}: {
  service: Service;
  category?: Category;
  index: number;
  isPopular: boolean;
}) {
  const tiltRef = useHoverTilt<HTMLAnchorElement>(7);
  const [g0] = resolveGradient(category?.slug, category?.color, index);
  const imageSrc = resolveServiceImage(service, category);

  return (
    <Link
      ref={tiltRef}
      to={`/services/${service.slug}`}
      data-reveal=""
      className="svc-card group"
    >
      <div
        className="svc-media"
        style={{ '--svc-tint': g0 } as React.CSSProperties}
      >
        <div
          className="relative z-[1] grid size-[5.25rem] place-items-center overflow-hidden rounded-[1.35rem] border border-white/70 bg-surface shadow-xl transition-transform duration-500 group-hover:scale-110 group-hover:-translate-y-1 dark:border-white/25 dark:bg-white/10"
          style={{
            boxShadow: `0 16px 32px -12px ${g0}66`,
          }}
        >
          <img
            src={imageSrc}
            alt={service.title}
            loading="lazy"
            className="size-full object-cover"
          />
        </div>

        <span className="absolute right-3 top-3 z-[2] rounded-full bg-white/92 px-2.5 py-1 text-[10px] font-bold text-[#0d1c30] ring-1 ring-black/10 backdrop-blur-md dark:bg-[#081226]/85 dark:text-[#eef4ff] dark:ring-white/20">
          {service.categoryTitle ?? category?.title ?? 'خدمت'}
        </span>

        {isPopular ? (
          <span className="absolute left-3 top-3 z-[2] inline-flex items-center gap-1 rounded-full bg-amber-100/95 px-2.5 py-1 text-[10px] font-extrabold text-[#78350f] ring-1 ring-amber-400/45 backdrop-blur-md dark:bg-[#2a1c05]/90 dark:text-[#fde68a] dark:ring-amber-300/35">
            <TrendingUp className="size-3" />
            پرکاربرد
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-2 text-[0.98rem] font-extrabold leading-7 text-text transition-colors group-hover:text-brand-text">
          {service.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 flex-1 text-xs leading-6 text-muted">
          {service.summary || 'ثبت آنلاین درخواست با پیگیری مرحله به مرحله در پیشخوان'}
        </p>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
          <span className="inline-flex items-center gap-1 font-semibold text-muted">
            <Clock className="size-3.5" />
            {formatDuration(service.estimatedMinutes, service.estimatedDays)}
          </span>
          <span className="font-black text-[#b45309] dark:text-gold">
            {rial(service.finalFee)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ----------------------------- services section ----------------------------- */

export function LandingServicesSection() {
  const { site, setting } = useSite();
  const revealRef = useReveal<HTMLElement>();
  const [tab, setTab] = useState<'popular' | 'newest'>('popular');

  const categoriesById = new Map((site?.categories ?? []).map((c) => [c.id, c]));
  const popular = site?.popularServices ?? [];
  const newest = site?.newestServices ?? [];
  const activeList = tab === 'newest' && newest.length > 0 ? newest : popular;

  const title = setting('landing.popular_title') || 'خدمات پرتقاضا و فوری';
  const subtitle =
    setting('landing.popular_subtitle') || 'محبوب‌ترین خدمات آنلاین مشتریان با کمترین زمان انتظار';

  return (
    <section ref={revealRef} id="services" className="scroll-mt-24 py-12 sm:py-16" aria-label="خدمات پرکاربرد">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4" data-reveal="">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-text">
              <TrendingUp className="size-3.5" />
              کاتالوگ آنلاین
            </span>
            <h2 className="mt-1.5 text-2xl font-black text-text sm:text-3xl">{title}</h2>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {newest.length > 0 ? (
              <div className="flex rounded-full border border-line bg-surface-2 p-1">
                <button
                  type="button"
                  onClick={() => setTab('popular')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold transition ${
                    tab === 'popular' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  پرکاربردترین
                </button>
                <button
                  type="button"
                  onClick={() => setTab('newest')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-extrabold transition ${
                    tab === 'newest' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  جدیدترین
                </button>
              </div>
            ) : null}

            <Link to="/services" className="lp-btn lp-btn-soft lp-btn-sm">
              <span>همهٔ خدمات</span>
              <ArrowLeft className="size-4" />
            </Link>
          </div>
        </div>

        {activeList.length === 0 ? (
          <div className="rounded-3xl border border-line bg-surface-2/70 p-8 text-center" data-reveal="">
            <p className="text-sm font-bold text-text">هنوز خدمتی در فهرست پرکاربرد منتشر نشده است.</p>
            <p className="mt-1 text-xs text-muted">می‌توانید از کاتالوگ کامل خدمات، خدمت مورد نیازتان را پیدا کنید.</p>
            <Link to="/services" className="lp-btn lp-btn-primary lp-btn-sm mt-4 inline-flex">
              مشاهده همهٔ خدمات
            </Link>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {activeList.slice(0, 6).map((svc, idx) => (
              <ServiceCard
                key={svc.id}
                service={svc}
                category={svc.categoryId ? categoriesById.get(svc.categoryId) : undefined}
                index={idx}
                isPopular={tab === 'popular'}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
