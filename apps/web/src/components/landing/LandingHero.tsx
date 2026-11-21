import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth, homeFor } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { formatDuration, useSite, type Service } from '../../lib/site';
import { faNum, rial } from '../../lib/format';
import { useExitProgress } from '../landing-motion';

export function LandingHero() {
  const heroRef = useExitProgress<HTMLElement>(0.8);
  const { user } = useAuth();
  const brand = useBrand();
  const { site, setting } = useSite();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Service[]>([]);
  const [searching, setSearching] = useState(false);
  const [openResults, setOpenResults] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const badgeText = setting('landing.hero_badge') || 'سامانه یکپارچه خدمات دولتی و اداری';
  const titleText =
    setting('landing.hero_title') || 'کارهای پیشخوانی را سریع، شفاف و از خانه انجام بده';
  const leadText =
    setting('landing.hero_lead') ||
    'از سابقهٔ بیمه و گواهی‌نامه تا امور مالیاتی و بانکی؛ با چند کلیک درخواست بدهید و مرحله به مرحله پیگیری کنید.';
  const primaryLabel = setting('landing.hero_primary_cta') || 'ثبت درخواست خدمت';
  const secondaryLabel = setting('landing.hero_secondary_cta') || 'مشاهده خدمات';
  const trustPoints = (
    setting('landing.trust_points') ||
    'پیگیری لحظه‌ای با کد رهگیری|پاسخ‌گویی کارشناسان دفتر|پرداخت شفاف آنلاین و کیف پول'
  )
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const heroImage = setting('landing.hero_image_url') || '/images/landing-hero-building.webp';
  const primaryLink = user ? homeFor(user) : '/login?next=%2Fapp%2Fservices';

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .list<Service>('/api/public/search', { q: trimmed, pageSize: 6 })
        .then((res) => {
          if (!cancelled) setResults(res.data);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setOpenResults(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const stats = site?.stats;

  return (
    <section
      ref={heroRef}
      id="top"
      className="relative px-4 pb-16 pt-24 sm:px-6 lg:pb-24 lg:pt-28"
      aria-label="معرفی سامانه"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-12">
        {/* ---------- text column ---------- */}
        <div className="hero-piece-text min-w-0">
          <span className="hero-kicker">
            <Sparkles className="size-3.5 text-[#d97706] dark:text-gold" />
            <span>{badgeText}</span>
          </span>

          <h1 className="hero-title mt-5">{titleText}</h1>

          <p className="mt-5 max-w-xl text-base leading-8 text-muted sm:text-[1.06rem]">{leadText}</p>

          {/* live search */}
          <div ref={searchWrapRef} className="relative mt-7 max-w-xl">
            <div className="glass flex items-center gap-2 rounded-2xl border border-line-strong px-3.5 py-2 shadow-xl shadow-slate-950/10 focus-within:border-cyan-400/70">
              <Search className="size-4.5 shrink-0 text-brand-text" />
              <input
                type="search"
                role="combobox"
                aria-expanded={Boolean(openResults && query.trim())}
                aria-controls="hero-search-results"
                aria-autocomplete="list"
                aria-label="جست‌وجوی خدمات"
                value={query}
                onFocus={() => setOpenResults(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpenResults(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('');
                    setResults([]);
                    setOpenResults(false);
                  }
                }}
                placeholder="جست‌وجوی خدمت… (مثلاً سابقه بیمه، خلافی، مفاصاحساب)"
                className="w-full bg-transparent py-1.5 text-sm text-text placeholder:text-faint focus:outline-none"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                  }}
                  aria-label="پاک کردن جست‌وجو"
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
                >
                  <X className="size-4" />
                </button>
              ) : null}
              <Link
                to={query.trim() ? `/services?q=${encodeURIComponent(query.trim())}` : '/services'}
                className="lp-btn lp-btn-primary lp-btn-sm shrink-0"
              >
                جست‌وجو
              </Link>
            </div>

            {openResults && query.trim() ? (
              <div
                id="hero-search-results"
                role="listbox"
                className="glass animate-pop absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-line-strong bg-surface/95 shadow-2xl backdrop-blur-xl"
              >
                {searching ? (
                  <p className="px-4 py-4 text-xs font-semibold text-muted">در حال جست‌وجو در خدمات…</p>
                ) : results.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-muted">
                    خدمتی با این عنوان پیدا نشد.{' '}
                    <Link to="/assistant" className="font-bold text-brand-text underline">
                      از دستیار هوشمند بپرسید
                    </Link>
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {results.map((svc) => (
                      <li key={svc.id}>
                        <Link
                          to={`/services/${svc.slug}`}
                          onClick={() => setOpenResults(false)}
                          className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition hover:bg-surface-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <img
                              src={svc.image || '/images/services/other.png'}
                              alt=""
                              loading="lazy"
                              className="size-10 shrink-0 rounded-xl border border-line object-cover shadow-sm"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-bold text-text">{svc.title}</p>
                              <p className="truncate text-[11px] text-muted">
                                {svc.categoryTitle ?? 'خدمت'} · {formatDuration(svc.estimatedMinutes, svc.estimatedDays)}
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-extrabold text-brand-text">
                            {rial(svc.finalFee)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          {/* CTAs */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link to={primaryLink} className="lp-btn lp-btn-primary">
              <span>{primaryLabel}</span>
              <ArrowLeft className="size-4" />
            </Link>
            <a href="#services" className="lp-btn lp-btn-soft">
              <span>{secondaryLabel}</span>
            </a>
          </div>

          {/* Trust list */}
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5 text-xs font-semibold text-muted">
            {trustPoints.map((point) => (
              <li key={point} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ---------- visual column ---------- */}
        <div className="hero-piece-media min-w-0">
          <div className="hero-media">
            <div className="hero-media-frame">
              <img
                src={heroImage}
                alt={brand.name}
                width={1024}
                height={1024}
                fetchPriority="high"
                className="aspect-[4/4] w-full object-cover sm:aspect-[5/4.6]"
              />
            </div>

            <div className="hero-media-tag">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-brand-600 text-white shadow-lg shadow-cyan-500/30">
                    <ShieldCheck className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-white">دفتر رسمی با پیگیری دیجیتال</p>
                    <p className="text-[11px] text-slate-300">
                      {stats
                        ? `${faNum(stats.services)}+ خدمت فعال · ${faNum(stats.completedRequests)}+ پرونده تکمیل‌شده`
                        : 'ثبت آنی · ارجاع خودکار به کارشناس'}
                    </p>
                  </div>
                </div>
                <span className="hidden rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-extrabold text-emerald-300 ring-1 ring-emerald-400/35 sm:inline-flex">
                  آنلاین ۲۴/۷
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
