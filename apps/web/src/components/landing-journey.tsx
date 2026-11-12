/**
 * "How a request is filed" — a scroll-driven timeline.
 *
 * The section is tall; its inner panel sticks to the viewport while the visitor
 * scrolls through it. A single progress value (`--p`) drives: which step is
 * active, how far the rail has filled, and how each step's card has assembled.
 * There is no scroll-jacking — the page scrolls normally, and the section simply
 * holds still and changes while it passes.
 *
 * On narrow screens the sticky panel is dropped in favour of a plain vertical
 * list with reveal-on-enter: sticky + 100vh of tall content is a bad experience
 * when the viewport is 640px tall and the address bar resizes it.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ClipboardList, Clock, FileCheck2, Sparkles, UserCheck } from 'lucide-react';
import clsx from 'clsx';

export interface JourneyStep {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  hint: string;
}

export const DEFAULT_JOURNEY: JourneyStep[] = [
  {
    icon: ClipboardList,
    title: 'خدمت را انتخاب کنید',
    body: 'از میان دسته‌بندی‌های دفتر پیشخوان، خدمت مورد نیازتان را پیدا کنید. همهٔ هزینه و زمان‌بندی پیش از ثبت مشخص است.',
    hint: 'مرحلهٔ ۱ · انتخاب',
  },
  {
    icon: Camera,
    title: 'مدارک را بارگذاری کنید',
    body: 'عکس مدارک را با دوربین گوشی بگیرید یا فایل را بکشید. سامانه نوع و کیفیت هر مدرک را همان لحظه بررسی می‌کند.',
    hint: 'مرحلهٔ ۲ · مدارک',
  },
  {
    icon: UserCheck,
    title: 'کارشناس پرونده را می‌گیرد',
    body: 'پرونده به‌صورت خودکار به کارشناس آزاد با کمترین بار کاری ارجاع می‌شود؛ نه در صف می‌ماند و نه جابه‌جا گم می‌شود.',
    hint: 'مرحلهٔ ۳ · ارجاع',
  },
  {
    icon: FileCheck2,
    title: 'پیشرفت را زنده ببینید',
    body: 'هر تغییر وضعیت همان لحظه در پنل و در اعلان‌های گوشی شما می‌آید. کد پیگیری همیشه در دسترس است.',
    hint: 'مرحلهٔ ۴ · پیگیری',
  },
  {
    icon: Check,
    title: 'تحویل نهایی',
    body: 'نتیجهٔ خدمت را تحویل بگیرید و رسید دیجیتال را در آرشیو مدارک خود نگه دارید. همه‌چیز قابل حسابرسی است.',
    hint: 'مرحلهٔ ۵ · تحویل',
  },
];

export function JourneyTimeline({ steps = DEFAULT_JOURNEY }: { steps?: JourneyStep[] }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    if (typeof window.matchMedia === 'function'
      && !window.matchMedia('(min-width: 1024px)').matches) return;

    let frame = 0;
    const read = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const track = node.offsetHeight - window.innerHeight;
      if (track <= 0) return;
      const p = Math.min(1, Math.max(0, -rect.top / track));
      node.style.setProperty('--j', p.toFixed(4));
      // Split the progress into one slot per step, but start already on step 1
      // so the first card is live the moment the section pins.
      const index = Math.min(steps.length - 1, Math.floor(p * steps.length * 1.02));
      setActive((prev) => (prev === index ? prev : index));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [steps.length]);

  return (
    <section
      ref={sectionRef}
      className="journey-track relative"
      style={{ ['--steps' as string]: steps.length }}
      aria-labelledby="journey-heading"
    >
      <div className="journey-sticky">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="journey-panel relative overflow-hidden rounded-[2.2rem] px-5 py-8 shadow-2xl shadow-navy-950/25 ring-1 ring-white/10 sm:px-9 sm:py-11">
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand-400/20 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-emerald-400/10 blur-3xl" />

            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/80 ring-1 ring-white/15">
                  <Sparkles className="size-3.5" />
                  مسیر یک درخواست
                </span>
                <h2 id="journey-heading" className="mt-3 text-2xl font-black text-white sm:text-3xl">
                  از انتخاب خدمت تا تحویل، در پنج قدم
                </h2>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-white/60">
                <Clock className="size-4" />
                میانگین رسیدگی: ۲۴ ساعت کاری
              </div>
            </div>

            {/* progress rail */}
            <div className="relative mt-7 h-1 overflow-hidden rounded-full bg-white/12">
              <div className="journey-rail-fill absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-emerald-400 via-sky-400 to-brand-400" />
            </div>

            <div className="relative mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-10">
              {/* step list */}
              <ol className="relative space-y-1.5">
                {steps.map((step, index) => {
                  const state = index < active ? 'done' : index === active ? 'active' : 'next';
                  return (
                    <li key={step.title}>
                      <div
                        className={clsx(
                          'journey-step flex items-center gap-3.5 rounded-2xl px-3 py-2.5 transition-all duration-500',
                          state === 'active' && 'bg-white/12 ring-1 ring-white/20',
                          state === 'next' && 'opacity-45',
                        )}
                        data-state={state}
                      >
                        <span
                          className={clsx(
                            'grid size-10 shrink-0 place-items-center rounded-xl transition-all duration-500',
                            state === 'done' && 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/30',
                            state === 'active' && 'scale-110 bg-white text-navy-950 shadow-xl',
                            state === 'next' && 'bg-white/10 text-white/70 ring-1 ring-white/15',
                          )}
                        >
                          {state === 'done'
                            ? <Check className="size-5" strokeWidth={3.5} />
                            : <step.icon className="size-5" />}
                        </span>
                        <div className="min-w-0">
                          <p className={clsx(
                            'text-sm font-black transition-colors',
                            state === 'active' ? 'text-white' : 'text-white/75',
                          )}>{step.title}</p>
                          <p className="text-[10.5px] font-medium text-white/45">{step.hint}</p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* active card — re-keyed so it re-animates on every change */}
              <div className="journey-card relative min-h-[13rem]">
                <div
                  key={steps[active]?.title}
                  className="animate-[fadeUp_.45s_cubic-bezier(.22,1,.36,1)_both] rounded-[1.8rem] bg-white/95 p-6 shadow-2xl shadow-navy-950/30 backdrop-blur sm:p-7"
                >
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold text-brand-700">
                    {steps[active]?.hint}
                  </span>
                  <p className="mt-4 text-lg font-black text-navy-950 sm:text-xl">{steps[active]?.title}</p>
                  <p className="mt-2 text-sm leading-7 text-navy-600">{steps[active]?.body}</p>
                  <div className="mt-5 flex items-center gap-1.5">
                    {steps.map((step, index) => (
                      <span
                        key={step.title}
                        className={clsx(
                          'h-1.5 rounded-full transition-all duration-300',
                          index === active ? 'w-8 bg-brand-600' : index < active ? 'w-1.5 bg-emerald-500' : 'w-1.5 bg-navy-200',
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- mobile / tablet: a plain, readable vertical list ---------- */}
      <div className="journey-mobile mx-auto max-w-3xl px-4 pb-4 sm:px-6">
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold text-brand-700">
            <Sparkles className="size-3.5" /> مسیر یک درخواست
          </span>
          <h2 className="mt-3 text-xl font-black text-navy-950 sm:text-2xl">از انتخاب خدمت تا تحویل، در پنج قدم</h2>
        </div>
        <ol className="relative space-y-3 border-r-2 border-dashed border-brand-200 pr-5">
          {steps.map((step, index) => (
            <li key={step.title} className="relative" data-reveal style={{ animationDelay: `${index * 70}ms` }}>
              <span className="absolute top-4 -right-[2.05rem] grid size-9 place-items-center rounded-xl bg-white text-brand-600 shadow-md ring-1 ring-line">
                <step.icon className="size-4.5" />
              </span>
              <div className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line">
                <p className="text-[10.5px] font-bold text-brand-600">{step.hint}</p>
                <p className="mt-1 text-sm font-black text-navy-900">{step.title}</p>
                <p className="mt-1 text-xs leading-6 text-navy-600">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
