import { useEffect, useRef, useState } from 'react';
import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import { faNum } from '../../lib/format';
import { useSite } from '../../lib/site';
import { usePrefersReducedMotion } from '../landing-motion';

/* ------------------------- paper contents ------------------------------- */

function PaperOne() {
  return (
    <div className="paper-card">
      <div className="paper-kicker">
        <span>درخواست جدید</span>
        <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[9px] font-extrabold text-kicker-cyan ring-1 ring-cyan-400/35">
          ثبت فوری
        </span>
      </div>
      <p className="paper-title">سابقهٔ بیمه تأمین اجتماعی</p>
      <div className="paper-row">
        <span className="truncate rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-paper-muted">
          علی رضایی
        </span>
        <span className="truncate rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-paper-muted">
          کد ملی: ۰۰۴۲…
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-400/10 px-2.5 py-1.5 ring-1 ring-emerald-400/25">
        <ShieldCheck className="size-3.5 shrink-0 text-emerald-500" />
        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-300">
          کارت ملی پیوست شد
        </span>
      </div>
    </div>
  );
}

function PaperTwo() {
  return (
    <div className="paper-card">
      <div className="paper-kicker">
        <span>پرونده</span>
        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[9px] text-paper-muted">
          #PK-2841
        </span>
      </div>
      <p className="paper-title">پرونده باز شد و در زنجیرهٔ خدمات قرار گرفت</p>
      <div className="paper-row">
        <span className="rounded-full bg-cyan-400/12 px-2.5 py-1 text-[9px] font-extrabold text-kicker-cyan ring-1 ring-cyan-400/30">
          در انتظار کارشناس
        </span>
      </div>
    </div>
  );
}

function PaperThree() {
  return (
    <div className="paper-card">
      <div className="paper-kicker">
        <span>مدارک بارگذاری‌شده</span>
        <span className="flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-0.5 text-[9px] font-extrabold text-emerald-600 ring-1 ring-emerald-400/30 dark:text-emerald-300">
          <Check className="size-3" strokeWidth={4} /> بررسی شد
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {['کارت ملی', 'شناسنامه', 'عکس'].map((label) => (
          <div key={label} className="rounded-lg bg-surface-2 px-1 py-1.5 text-center ring-1 ring-line">
            <span className="mx-auto block h-6 w-full rounded-md bg-gradient-to-b from-white/40 to-transparent" />
            <span className="mt-1 block text-[8px] font-bold text-paper-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaperFour() {
  return (
    <div className="paper-card">
      <div className="paper-kicker">
        <span>کارشناس مسئول</span>
        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[9px] text-paper-muted">
          آزاد
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-400 to-brand-600 text-[10px] font-black text-white ring-2 ring-violet-300/40">
          م
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.78rem] font-extrabold text-paper-text">مهندس رضا محمدی</p>
          <p className="text-[9px] text-paper-muted">ارجاع فوری · کمترین بار کاری</p>
        </div>
      </div>
      <div className="mt-2.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div className="h-full w-2/3 rounded-full bg-gradient-to-l from-cyan-400 to-emerald-400" />
        </div>
        <p className="mt-1 text-[9px] font-semibold text-paper-muted">در حال بررسی مدارک · ۶۶٪</p>
      </div>
    </div>
  );
}

function PaperFive() {
  return (
    <div className="paper-card" style={{ borderColor: 'rgb(246 196 83 / 0.5)' }}>
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#fde68a] via-gold to-[#f59e0b] shadow-lg shadow-amber-500/35 ring-2 ring-[#fde68a]/60">
          <Check className="size-6 text-amber-950" strokeWidth={3.5} />
        </span>
        <div className="min-w-0">
          <p className="paper-kicker" style={{ color: '#b45309' }}>
            مُهر تأیید نهایی
          </p>
          <p className="paper-title" style={{ color: '#d97706' }}>
            نتیجه تحویل شد
          </p>
        </div>
      </div>
      <p className="mt-2 text-[9px] leading-4 text-paper-muted">
        رسید دیجیتال در آرشیو مدارک شما ذخیره شد.
      </p>
    </div>
  );
}

const PAPER_CONTENT = [PaperOne, PaperTwo, PaperThree, PaperFour, PaperFive];
const ROTATIONS = [-2.6, 1.7, -1.3, 2.4, -0.8];
const LIFTS = [0, 22, 40, 56, 70];
const STARTS = [-0.13, 0.02, 0.22, 0.42, 0.62];

const DEFAULT_STEPS = [
  {
    id: 'step-1',
    title: 'انتخاب خدمت و پر کردن فرم',
    body: 'خدمت را پیدا کنید، فرم ساده را پر کنید و تصویر مدارک را بارگذاری نمایید.',
    tag: 'کمتر از ۲ دقیقه',
  },
  {
    id: 'step-2',
    title: 'ایجاد خودکار پرونده دیجیتال',
    body: 'بلافاصله کد رهگیری یکتا صادر می‌شود و پرونده در صف بررسی قرار می‌گیرد.',
    tag: 'کد رهگیری آنی',
  },
  {
    id: 'step-3',
    title: 'بررسی و تطبیق مدارک',
    body: 'کیفیت و کامل بودن مدارک شما کنترل می‌شود تا بدون نقص ارسال شوند.',
    tag: 'کنترل کیفیت',
  },
  {
    id: 'step-4',
    title: 'ارجاع هوشمند به کارشناس',
    body: 'کارشناس متخصص پرونده را برعهده می‌گیرد و وضعیت را لحظه‌ای به‌روزرسانی می‌کند.',
    tag: 'پاسخ‌گویی مستقیم',
  },
  {
    id: 'step-5',
    title: 'تحویل نهایی و گواهی دیجیتال',
    body: 'نتیجه، قبض یا سند نهایی در پنل و پیامک برای شما ارسال و آرشیو می‌شود.',
    tag: 'آرشیو دائمی',
  },
];

/* -------------------------- the journey section -------------------------- */

export function LandingJourney() {
  const { setting } = useSite();
  const trackRef = useRef<HTMLElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const paperRefs = useRef<(HTMLDivElement | null)[]>([]);
  const railRef = useRef<HTMLDivElement>(null);
  const railMobileRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const reduced = usePrefersReducedMotion();

  const journeyTitle = setting('landing.journey_title') || 'از ثبت تا تحویل، همه‌چیز در یک زنجیرهٔ روشن';
  const journeySubtitle =
    setting('landing.journey_subtitle') ||
    'با اسکرول به پایین ببینید پروندهٔ شما چطور در پیشخوان شکل می‌گیرد و تحویل داده می‌شود.';

  const steps = DEFAULT_STEPS.map((fallback, idx) => ({
    ...fallback,
    title: setting(`landing.step${idx + 1}_title`) || fallback.title,
    body: setting(`landing.step${idx + 1}_body`) || fallback.body,
  }));

  const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let frame = 0;
    const read = () => {
      frame = 0;
      const desktop = isDesktop();

      if (!desktop) {
        const total = track.offsetHeight - window.innerHeight * 0.45;
        const start = track.getBoundingClientRect().top + window.scrollY;
        const p = total <= 0 ? 0 : Math.min(1, Math.max(0, (window.scrollY - start) / total));
        if (railMobileRef.current) railMobileRef.current.style.width = `${(p * 100).toFixed(1)}%`;

        let idx = 0;
        stepRefs.current.forEach((el, i) => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.top < window.innerHeight * 0.48) idx = i;
        });
        setActiveIndex((prev) => (prev === idx ? prev : idx));
        return;
      }

      const total = track.offsetHeight - window.innerHeight;
      const start = track.getBoundingClientRect().top + window.scrollY;
      const p = total <= 0 ? 0 : Math.min(1, Math.max(0, (window.scrollY - start) / total));

      paperRefs.current.forEach((paper, i) => {
        if (!paper) return;
        const startI = reduced ? -0.13 : STARTS[i];
        const span = 0.13;
        const t = Math.min(1, Math.max(0, (p - startI) / span));
        const arenaHeight = arenaRef.current?.offsetHeight ?? 380;
        const drop = (1 - t) * (arenaHeight * 1.7);
        paper.style.opacity = String(Math.min(1, Math.max(0, t)));
        paper.style.transform = `translateX(-50%) translateY(${LIFTS[i] - drop}px) rotate(${ROTATIONS[i]}deg) translateZ(${i * 110}px)`;
      });

      if (railRef.current) railRef.current.style.width = `${p * 100}%`;

      const index = Math.min(steps.length - 1, Math.max(0, Math.floor(p * steps.length)));
      setActiveIndex((prev) => (prev === index ? prev : index));
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [steps.length, reduced]);

  const jumpToStep = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    if (isDesktop()) {
      const total = track.offsetHeight - window.innerHeight;
      const start = track.getBoundingClientRect().top + window.scrollY;
      const targetP = Math.min(0.95, Math.max(0, (index + 0.35) / steps.length));
      window.scrollTo({ top: start + total * targetP, behavior: 'smooth' });
    } else {
      const el = stepRefs.current[index];
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 165;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <section
      ref={trackRef}
      id="journey"
      className="journey-track relative border-y border-line/40 bg-canvas-2/60"
      aria-label="مسیر ثبت یک درخواست"
    >
      <div className="journey-sticky lp-container">
        <header className="max-w-2xl">
          <span className="journey-eyebrow">
            <Sparkles className="size-3.5 text-[#d97706] dark:text-gold" />
            مسیر ثبت یک درخواست
          </span>
          <h2 className="journey-heading">{journeyTitle}</h2>
          <p className="mt-2 text-sm leading-7 text-muted">{journeySubtitle}</p>
        </header>

        {/* desktop: inline rail inside the pinned viewport */}
        <div className="progress-rail mt-5 hidden lg:block" aria-hidden="true">
          <div ref={railRef} />
        </div>

        <div className="journey-body py-4 lg:py-6">
          {/* ---------------- the layered dossier (desktop) ---------------- */}
          <div className="relative order-first hidden self-stretch lg:order-last lg:block" aria-hidden="true">
            <div ref={arenaRef} className="stack-arena">
              <div className="stack-desk" />
              <div className="stack-orbit" />
              {PAPER_CONTENT.map((Paper, index) => (
                <div
                  key={index}
                  ref={(el) => {
                    paperRefs.current[index] = el;
                  }}
                  className="paper-layer"
                  style={{ zIndex: index + 1 }}
                >
                  <Paper />
                </div>
              ))}
            </div>
          </div>

          {/* ---------------- the stepper ---------------- */}
          <div className="order-last min-w-0 lg:order-first">
            {/* mobile: sticky rail above the steps */}
            <div className="journey-mobile-rail" aria-hidden="true">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.72rem] font-extrabold text-brand-text">
                  مرحله {faNum(activeIndex + 1)} از {faNum(steps.length)}
                </span>
                <span className="truncate text-[0.68rem] font-semibold text-muted">
                  {steps[activeIndex]?.title}
                </span>
              </div>
              <div className="progress-rail mt-2">
                <div ref={railMobileRef} style={{ width: '0%' }} />
              </div>
            </div>

            <ol className="step-list mt-1 lg:mt-0">
              {steps.map((step, index) => {
                const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'next';
                return (
                  <li
                    key={step.id}
                    ref={(el) => {
                      stepRefs.current[index] = el;
                    }}
                    onClick={() => jumpToStep(index)}
                    className={`step-item cursor-pointer is-${state}`}
                  >
                    <span className="step-num">
                      {state === 'done' ? <Check className="size-4" strokeWidth={3.5} /> : faNum(index + 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="step-title">{step.title}</p>
                      <p className="step-body">{step.body}</p>
                      <span className="step-tag">{step.tag}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
