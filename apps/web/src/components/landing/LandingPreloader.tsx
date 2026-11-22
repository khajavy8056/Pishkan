import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useBrand } from '../../lib/brand';
import { useSite } from '../../lib/site';

export function LandingPreloader() {
  const { site, setting } = useSite();
  const brand = useBrand();

  const isTestEnv =
    import.meta.env.MODE === 'test' ||
    (typeof navigator !== 'undefined' && navigator.webdriver === true);

  const [ready, setReady] = useState(isTestEnv);
  const [hidden, setHidden] = useState(isTestEnv);

  const heroSrc = setting('landing.hero_image_url') || '/images/landing-hero-building.webp';

  useEffect(() => {
    if (isTestEnv || ready) return;
    if (!site) return;

    let cancelled = false;
    const done = () => {
      if (!cancelled) setReady(true);
    };

    // Wait for hero image + web fonts, capped so slow networks never stall entry.
    const maxTimer = window.setTimeout(done, 1500);

    const imgPromise = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = heroSrc;
      if (img.complete) resolve();
    });

    const fontsPromise =
      typeof document !== 'undefined' && document.fonts?.ready
        ? document.fonts.ready.catch(() => undefined)
        : Promise.resolve();

    Promise.all([imgPromise, fontsPromise]).then(() => {
      window.clearTimeout(maxTimer);
      // Small frame cushion so hydrated cards & counters settle before curtain lifts.
      window.setTimeout(done, 140);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(maxTimer);
    };
  }, [site, heroSrc, isTestEnv, ready]);

  useEffect(() => {
    if (!ready || hidden) return;
    const t = window.setTimeout(() => setHidden(true), 450);
    return () => window.clearTimeout(t);
  }, [ready, hidden]);

  if (hidden) return null;

  return (
    <div
      aria-hidden={ready}
      aria-label="در حال بارگذاری صفحه اصلی"
      className={`fixed inset-0 z-[120] flex flex-col items-center justify-center bg-canvas/82 px-6 backdrop-blur-2xl transition-opacity duration-500 ${
        ready ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="relative flex flex-col items-center text-center">
        <div className="relative grid size-20 place-items-center rounded-[1.75rem] bg-gradient-to-br from-cyan-400 via-sky-500 to-brand-700 text-white shadow-2xl shadow-cyan-500/35">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt="" className="size-12 rounded-xl object-contain" />
          ) : (
            <ShieldCheck className="size-10" strokeWidth={2.2} />
          )}
          <span
            aria-hidden="true"
            className="absolute -inset-2 animate-ping rounded-[2rem] border border-cyan-400/35 opacity-40"
          />
        </div>

        <p className="mt-5 text-lg font-black text-text">{brand.name}</p>
        <p className="mt-1 text-xs font-semibold text-muted">در حال آماده‌سازی خدمات و سامانه…</p>

        <div className="mt-5 h-1.5 w-44 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full w-2/3 animate-[lpLoadSlide_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-l from-cyan-400 via-sky-400 to-emerald-400" />
        </div>
      </div>
    </div>
  );
}
