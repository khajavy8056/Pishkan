/**
 * "How a request is filed" — a stack of layers that assembles as you scroll.
 *
 * The section is tall, and its inner panel sticks to the viewport while the
 * visitor scrolls through it. Scroll position is published as one number, `--j`,
 * on the section element. Every layer then computes *its own* progress in CSS:
 *
 *     --lp: clamp(0, (var(--j) - var(--start)) * var(--rate), 1)
 *
 * so a sheet drops in, lands flat, and stays. No React state, no per-frame
 * work, and the whole choreography can be read from one line of CSS per layer.
 *
 * The metaphor is the point of the section: a request is not one opaque blob,
 * it is five layers — the request, the folder, the review, the identity, the
 * seal — and each one lands on top of the last. Nothing is skipped, nothing is
 * lost, and by the end the visitor is looking at a finished dossier. Layering
 * is also the most legible way to say "simple": every step is a single sheet of
 * paper, not a form-filling ordeal.
 *
 * On narrow screens the pinned deck is dropped entirely (`stack-mobile`): a
 * 100vh sticky panel inside a 640px viewport is unusable. The list there still
 * carries the same five steps, in the same order, with the same copy.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ClipboardList, FileCheck2, Fingerprint, ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
import clsx from 'clsx';

export interface JourneyStep {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  hint: string;
  /** The short, concrete qualifier shown at the end of the ledger row. */
  note: string;
}

export const DEFAULT_JOURNEY: JourneyStep[] = [
  {
    icon: ClipboardList,
    title: 'خدمت را انتخاب کنید',
    body: 'از فهرست دسته‌بندی‌ها خدمت مورد نیازتان را انتخاب می‌کنید. هزینه و زمان تقریبی همان‌جا نوشته شده است؛ بدون تماس و بدون پرسیدن.',
    hint: 'لایهٔ ۱ · درخواست',
    note: 'هزینهٔ شفاف از ابتدا',
  },
  {
    icon: FileCheck2,
    title: 'پرونده ساخته می‌شود',
    body: 'سامانه یک پروندهٔ دیجیتال برای شما باز می‌کند و همهٔ قدم‌های بعدی داخل همان پرونده ثبت می‌شود.',
    hint: 'لایهٔ ۲ · پرونده',
    note: 'یک پرونده، تا آخر',
  },
  {
    icon: Camera,
    title: 'مدارک را بارگذاری می‌کنید',
    body: 'عکس مدارک را با دوربین گوشی می‌گیرید یا فایل را می‌کشید. نوع و کیفیت هر مدرک همان لحظه بررسی می‌شود، پس دوباره و دوباره فرستادن لازم نیست.',
    hint: 'لایهٔ ۳ · مدارک',
    note: 'بررسی خودکار فایل',
  },
  {
    icon: UserCheck,
    title: 'کارشناس پرونده را می‌گیرد',
    body: 'پروندهٔ کامل به کارشناس آزاد با کمترین بار کاری ارجاع می‌شود؛ نه در صف می‌ماند و نه دست‌به‌دست می‌شود.',
    hint: 'لایهٔ ۴ · کارشناس',
    note: 'ارجاع خودکار',
  },
  {
    icon: ShieldCheck,
    title: 'مُهر تأیید و تحویل',
    body: 'نتیجهٔ خدمت را تحویل می‌گیرید و رسید دیجیتال در آرشیو مدارک شما می‌ماند. هر تغییری هم همان لحظه اعلان می‌شود.',
    hint: 'لایهٔ ۵ · تحویل',
    note: 'رسید و آرشیو همیشگی',
  },
];

/** Scroll distance between two layers landing, matching the CSS stagger. */
const SPACING = 0.11;

/** Small idle rotations so the pile never looks typed, only hand-stacked. */
const IDLE_ROTATION = ['-2.4deg', '1.6deg', '-1.1deg', '2.2deg', '-0.7deg'];

function Layers() {
  return (
    <>
      {/* layer 1 — the request itself: a filled sheet */}
      <div className="stack-sheet" data-kind="paper" data-i="0">
        <div className="stack-paper px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black text-navy-400">درخواست خدمت</span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[8px] font-bold text-brand-700">سریع</span>
          </div>
          <p className="mt-1.5 text-[13px] font-black text-navy-900">سابقهٔ بیمه تأمین اجتماعی</p>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <span className="stack-field" />
            <span className="stack-field" />
            <span className="stack-field col-span-2" />
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-navy-200 pt-2">
            <span className="text-[8px] font-semibold text-navy-400">زمان تقریبی</span>
            <span className="text-[9px] font-black text-navy-800">همان روز</span>
          </div>
        </div>
      </div>

      {/* layer 2 — the folder the request is filed into */}
      <div className="stack-sheet" data-kind="object" data-i="1">
        <picture>
          <source srcSet="/images/landing/dossier.webp" type="image/webp" />
          <img src="/images/landing/dossier.png" alt="" aria-hidden="true" className="stack-object w-[74%]" loading="lazy" decoding="async" draggable={false} />
        </picture>
      </div>

      {/* layer 3 — documents, checked the moment they land */}
      <div className="stack-sheet" data-kind="paper" data-i="2">
        <div className="stack-paper px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black text-navy-400">مدارک پیوست</span>
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[8px] font-bold text-emerald-700">
              <Check className="size-2.5" strokeWidth={4} />
              بررسی شد
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {['کارت ملی', 'شناسنامه', 'عکس'].map((label) => (
              <div key={label} className="rounded-lg bg-navy-50/80 p-1.5 text-center ring-1 ring-navy-900/5">
                <span className="mx-auto block h-7 w-full rounded bg-gradient-to-b from-white to-navy-100 ring-1 ring-navy-900/5" />
                <span className="mt-1 block text-[7px] font-bold text-navy-500">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand-50/80 px-2 py-1.5">
            <Sparkles className="size-2.5 text-brand-600" />
            <span className="text-[8px] font-semibold text-brand-800">هیچ مدرکی کم نیست</span>
          </div>
        </div>
      </div>

      {/* layer 4 — identity, the piece the expert verifies against */}
      <div className="stack-sheet" data-kind="object" data-i="3">
        <picture>
          <source srcSet="/images/landing/idcard.webp" type="image/webp" />
          <img src="/images/landing/idcard.png" alt="" aria-hidden="true" className="stack-object w-[52%]" loading="lazy" decoding="async" draggable={false} />
        </picture>
        <span className="stack-pin" aria-hidden="true">
          <Fingerprint className="size-3" />
          مطابقت هویت
        </span>
      </div>

      {/* layer 5 — the stamp that closes it */}
      <div className="stack-sheet" data-kind="object" data-i="4">
        <picture>
          <source srcSet="/images/landing/seal.webp" type="image/webp" />
          <img src="/images/landing/seal.png" alt="" aria-hidden="true" className="stack-object w-[34%]" loading="lazy" decoding="async" draggable={false} />
        </picture>
      </div>

      {/* the desk the pile lands on */}
      <div aria-hidden="true" className="stack-floor" />
    </>
  );
}

export function RequestStack({ steps = DEFAULT_JOURNEY }: { steps?: JourneyStep[] }) {
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
      // The ledger row only needs to know which layer is landing now; the
      // sheets themselves are pure CSS and never re-render.
      const index = Math.min(steps.length - 1, Math.max(0, Math.round((p - 0.02) / SPACING)));
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
    <section ref={sectionRef} className="stack-track relative" aria-labelledby="stack-heading">
      <div className="stack-sticky">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="stack-panel relative overflow-hidden rounded-[2.4rem] px-5 py-8 shadow-2xl shadow-navy-950/25 ring-1 ring-white/10 sm:px-9 sm:py-10">
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand-400/20 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-emerald-400/10 blur-3xl" />
            <div aria-hidden="true" className="stack-grid pointer-events-none absolute inset-0 opacity-[0.06]" />

            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/80 ring-1 ring-white/15">
                  <Sparkles className="size-3.5" />
                  مسیر یک درخواست
                </span>
                <h2 id="stack-heading" className="mt-3 text-2xl font-black text-white sm:text-3xl">
                  یک کار دولتی، پنج لایه — تا لحظهٔ تحویل
                </h2>
                <p className="mt-2 max-w-xl text-[13px] leading-7 text-white/60">
                  هر مرحله یک لایه است که روی لایهٔ قبلی می‌نشیند. هیچ قدمی جا نمی‌افتد و هیچ مدرکی گم نمی‌شود.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-white/60">
                <Check className="size-4 text-emerald-300" />
                بدون کاغذبازی و مراجعهٔ اضافه
              </div>
            </div>

            {/* the rail fills layer by layer, not smoothly: five discrete clicks */}
            <div className="relative mt-6 h-1 overflow-hidden rounded-full bg-white/12">
              <div className="stack-rail-fill absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-emerald-400 via-sky-400 to-brand-400" />
            </div>

            <div className="relative mt-7 grid items-center gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10">
              {/* --------------------------- the pile --------------------------- */}
              <div className="stack-stage relative order-2 mx-auto w-full max-w-[26rem] lg:order-1">
                <div className="stack-deck">
                  <Layers />
                </div>
              </div>

              {/* --------------------------- the ledger ------------------------- */}
              <ol className="order-1 space-y-1.5 lg:order-2">
                {steps.map((step, index) => {
                  const state = index < active ? 'done' : index === active ? 'active' : 'next';
                  return (
                    <li key={step.title}>
                      <div
                        className={clsx(
                          'stack-row flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-all duration-500',
                          state === 'active' && 'bg-white/12 ring-1 ring-white/20',
                        )}
                        data-state={state}
                      >
                        <span
                          className={clsx(
                            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl text-[11px] font-black transition-all duration-500',
                            state === 'done' && 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/30',
                            state === 'active' && 'scale-110 bg-white text-navy-950 shadow-xl',
                            state === 'next' && 'bg-white/10 text-white/60 ring-1 ring-white/15',
                          )}
                        >
                          {state === 'done' ? <Check className="size-4" strokeWidth={3.5} /> : step.icon ? <step.icon className="size-4" /> : index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className={clsx('text-sm font-black transition-colors', state === 'active' ? 'text-white' : 'text-white/75')}>
                            {step.title}
                          </p>
                          <p className={clsx(
                            'mt-1 text-[11px] leading-5 transition-colors',
                            state === 'next' ? 'text-white/35' : 'text-white/60',
                          )}>
                            {step.body}
                          </p>
                          <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[9.5px] font-bold text-white/55">
                            {step.hint}
                            <span className="text-white/25">·</span>
                            <span className="text-emerald-300/90">{step.note}</span>
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- narrow viewports: the same five layers, as a list ---------- */}
      <div className="stack-mobile mx-auto max-w-3xl px-4 pb-4 sm:px-6">
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold text-brand-700">
            <Sparkles className="size-3.5" /> مسیر یک درخواست
          </span>
          <h2 className="mt-3 text-xl font-black text-navy-950 sm:text-2xl">یک کار دولتی، پنج لایه</h2>
          <p className="mt-2 text-xs leading-6 text-navy-500">هر مرحله یک لایه روی لایهٔ قبلی؛ هیچ قدمی جا نمی‌افتد.</p>
        </div>
        <ol className="relative space-y-3 border-r-2 border-dashed border-brand-200 pr-5">
          {steps.map((step, index) => (
            <li key={step.title} className="relative" data-reveal style={{ animationDelay: `${index * 70}ms` }}>
              <span className="absolute top-4 -right-[2.05rem] grid size-9 place-items-center rounded-xl bg-white text-brand-600 shadow-md ring-1 ring-line">
                <step.icon className="size-4.5" />
              </span>
              <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
                <div className="h-1 bg-gradient-to-l from-brand-500 to-sky-400" style={{ opacity: 1 - index * 0.12 }} />
                <div className="p-4">
                  <p className="text-[10.5px] font-bold text-brand-600">{step.hint}</p>
                  <p className="mt-1 text-sm font-black text-navy-900">{step.title}</p>
                  <p className="mt-1 text-xs leading-6 text-navy-600">{step.body}</p>
                  <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    <Check className="size-3" strokeWidth={3} />
                    {step.note}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
