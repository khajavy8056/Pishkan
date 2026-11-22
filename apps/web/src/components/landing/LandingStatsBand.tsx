import { useEffect, useRef, useState } from 'react';
import { Award, CheckCircle2, Layers, Users } from 'lucide-react';
import { faNum } from '../../lib/format';
import { useSite } from '../../lib/site';
import { usePrefersReducedMotion, useRevealOnScroll } from '../landing-motion';

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const [val, setVal] = useState(to);
  const started = useRef(false);

  useEffect(() => {
    setVal(to);
  }, [to]);

  useEffect(() => {
    if (reduced || typeof IntersectionObserver !== 'function') {
      setVal(to);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let frame = 0;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return;
        started.current = true;
        io.disconnect();
        const t0 = performance.now();
        const dur = 1100;
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          setVal(Math.round(to * eased));
          if (p < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.25 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [to, reduced]);

  return (
    <span ref={ref} className="stat-figure">
      {faNum(val)}
      {suffix}
    </span>
  );
}

export function LandingStatsBand() {
  const revealRef = useRevealOnScroll<HTMLElement>();
  const { site, setting } = useSite();

  if (setting('landing.show_stats') === 'false') return null;

  const stats = site?.stats;
  const customCustomers = setting('landing.stat_customers');
  const customersLabel = setting('landing.stat_customers_label') || 'مشتری همراه';
  const workingHours = setting('office.working_hours') || 'در تمام روزهای کاری';

  return (
    <section ref={revealRef} className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="stat-grid">
        <div data-reveal="zoom" className="stat-tile">
          <Layers className="mx-auto mb-2 size-6 text-cyan-400" />
          <CountUp to={stats?.services ?? 0} suffix="+" />
          <div className="stat-label">خدمت رسمی و فعال</div>
          <div className="mt-1 text-[11px] text-faint">در همهٔ دسته‌های پیشخوان</div>
        </div>

        <div data-reveal="zoom" className="stat-tile">
          <Users className="mx-auto mb-2 size-6 text-emerald-400" />
          {customCustomers ? (
            <span className="stat-figure">{customCustomers}</span>
          ) : (
            <CountUp to={stats?.customers ?? 0} suffix="+" />
          )}
          <div className="stat-label">{customersLabel}</div>
          <div className="mt-1 text-[11px] text-faint">همراهان سامانهٔ آنلاین</div>
        </div>

        <div data-reveal="zoom" className="stat-tile">
          <CheckCircle2 className="mx-auto mb-2 size-6 text-gold" />
          <CountUp to={stats?.completedRequests ?? 0} suffix="+" />
          <div className="stat-label">پروندهٔ تکمیل‌شده</div>
          <div className="mt-1 text-[11px] text-faint">بررسی و تحویل‌شده</div>
        </div>

        <div data-reveal="zoom" className="stat-tile">
          <Award className="mx-auto mb-2 size-6 text-violet-300" />
          <span className="stat-figure">شفاف</span>
          <div className="stat-label">پیگیری و پشتیبانی لحظه‌ای</div>
          <div className="mt-1 text-[11px] text-faint">{workingHours}</div>
        </div>
      </div>
    </section>
  );
}
