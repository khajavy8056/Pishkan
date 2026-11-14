/**
 * A parallax band that answers to both axes of the pointer *and* to scroll.
 *
 * Move the mouse up and the near layer lifts while the far layer drops; scroll
 * and the whole stack travels at three different speeds. The effect is built
 * from one scroll-progress token (`--p`) plus the pointer tokens already
 * published by an ancestor (`--mx` / `--my`), so nothing here re-renders React.
 *
 * Used as a quiet divider between the catalogue and the journey: it gives the
 * page somewhere to breathe without another card.
 */
import { ShieldCheck, Clock, Headset, FileCheck2 } from 'lucide-react';
import { useRevealOnScroll, useScrollProgress } from './landing-motion';

const PILLARS = [
  { icon: FileCheck2, title: 'مدارک بدون کاغذ', text: 'بارگذاری، بررسی و آرشیو دیجیتال' },
  { icon: Clock, title: 'زمان‌بندی شفاف', text: 'مدت تقریبی هر خدمت از پیش مشخص' },
  { icon: ShieldCheck, title: 'حریم خصوصی', text: 'دسترسی محدود به کارشناس مسئول' },
  { icon: Headset, title: 'پاسخ‌گویی', text: 'گفت‌وگوی زنده با دفتر در ساعات کاری' },
];

export function ParallaxBand() {
  const ref = useScrollProgress<HTMLDivElement>({ start: -0.15, end: 1.15 });
  // Its own reveal container: the pillars below carry `data-reveal`, and
  // `[data-reveal]` starts at opacity:0. Without an observer on an ancestor the
  // cards would stay invisible for the life of the page.
  const reveal = useRevealOnScroll<HTMLElement>();

  return (
    <section ref={reveal} className="relative overflow-hidden py-10 sm:py-14" aria-label="چرا این سامانه">
      <div ref={ref} className="parallax-band relative mx-auto max-w-7xl px-4 sm:px-6">
        {/* three depth layers; each reads --p at a different multiplier */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="parallax-layer parallax-far absolute -top-8 right-[6%] size-56 rounded-full bg-brand-300/25 blur-2xl" />
          <div className="parallax-layer parallax-mid absolute bottom-0 left-[10%] size-72 rounded-full bg-emerald-300/20 blur-3xl" />
          <div className="parallax-layer parallax-near absolute top-1/3 left-1/2 size-40 rounded-full border border-brand-300/30" />
        </div>

        <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((pillar, index) => (
            <div
              key={pillar.title}
              data-reveal
              style={{ transitionDelay: `${index * 70}ms` }}
              className="group parallax-layer parallax-card rounded-[1.5rem] bg-surface/85 p-5 ring-1 ring-line backdrop-blur-sm transition hover:bg-surface hover:shadow-lg"
              data-index={index}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-accent transition duration-300 group-hover:scale-110">
                <pillar.icon className="size-5" />
              </span>
              <p className="mt-3 text-sm font-black text-navy-900">{pillar.title}</p>
              <p className="mt-1 text-xs leading-6 text-navy-500">{pillar.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
