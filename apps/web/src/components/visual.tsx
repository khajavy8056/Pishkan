import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Backpack, BadgeCheck, BookOpen, Building2, Calculator, CarFront, Cpu, GraduationCap,
  HandCoins, Headset, HeartHandshake, House, Landmark, LayoutGrid, MessagesSquare, Scale,
  Shield, ShieldCheck, ShieldPlus, Store, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { BrandMark, useBrand } from '../lib/brand';

/* ------------------------------- 3D tilt ---------------------------------- */

function motionOk() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * Mouse-reactive 3D tilt: the card leans toward the pointer while children
 * can float on different Z layers (give them inline `translateZ` styles
 * inside a `.t3d` parent). Quietly inert on touch devices and for users who
 * prefer reduced motion.
 */
export function Tilt({
  children, className, maxX = 7, maxY = 9, scale = 1.015,
}: {
  children: ReactNode; className?: string; maxX?: number; maxY?: number; scale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<string>('perspective(1200px)');
  const [gliding, setGliding] = useState(true);

  const onMove = (event: React.MouseEvent) => {
    const node = ref.current;
    if (!node || !motionOk()) return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setGliding(false);
    setTransform(`perspective(1200px) rotateX(${(-py * maxX).toFixed(2)}deg) rotateY(${(px * maxY).toFixed(2)}deg) scale(${scale})`);
  };
  const onLeave = () => {
    setGliding(true);
    setTransform('perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1)');
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={clsx('t3d', className)}
      style={{ transform, transition: gliding ? 'transform .5s cubic-bezier(.22,1,.36,1)' : 'transform .08s linear' }}
    >
      {children}
    </div>
  );
}

/* ---------------------------- category icons ------------------------------- */

const CATEGORY_ICONS: Record<string, typeof LayoutGrid> = {
  'shield-plus': ShieldPlus,
  'building-2': Building2,
  'hand-coins': HandCoins,
  'car-front': CarFront,
  calculator: Calculator,
  scale: Scale,
  'graduation-cap': GraduationCap,
  house: House,
  home: House,
  landmark: Landmark,
  shield: Shield,
  'shield-check': ShieldCheck,
  'book-open': BookOpen,
  store: Store,
  backpack: Backpack,
  'messages-square': MessagesSquare,
  'layout-grid': LayoutGrid,
  zap: Zap,
  headset: Headset,
  'heart-handshake': HeartHandshake,
  cpu: Cpu,
  'badge-check': BadgeCheck,
};

/** Maps the catalogue's Lucide icon names to components (safe fallback). */
export function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  if (name && (/^\/uploads\/public\//.test(name) || /^https?:\/\//.test(name))) return <img src={name} alt="" className={clsx(className ?? 'size-6', 'rounded object-cover')} />;
  if (name && /[\p{Extended_Pictographic}]/u.test(name)) return <span className={clsx(className ?? 'size-6', 'inline-flex items-center justify-center leading-none')} aria-hidden="true">{name}</span>;
  const Icon = (name && CATEGORY_ICONS[name]) || LayoutGrid;
  return <Icon className={className ?? 'size-6'} aria-hidden="true" />;
}

/** Icon component for landing feature lists (same Lucide vocabulary). */
export function FeatureIcon({ name, className }: { name?: string; className?: string }) {
  return <CategoryIcon name={name} className={className} />;
}

/**
 * Glossy "3D object" category art, drawn after the approved design
 * reference: a coloured glyph floating over a pastel radial disc with a
 * soft cast shadow and a top gloss highlight. Pure CSS/SVG, so it stays
 * crisp (and theme-safe) at any size — used by the landing category band,
 * the customer quick-access tiles and request rows.
 */
export function CategoryArt({ name, color, className, glyphClassName }: {
  name?: string | null; color?: string | null; className?: string; glyphClassName?: string;
}) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#2563eb';
  const Icon = (name && CATEGORY_ICONS[name]) || LayoutGrid;
  return (
    <span className={clsx('relative grid shrink-0 place-items-center', className ?? 'size-16')} aria-hidden="true">
      <span
        className="absolute inset-0 rounded-[1.35rem]"
        style={{
          background: `radial-gradient(120% 120% at 30% 18%, color-mix(in oklab, ${c} 22%, #fff) 0%, color-mix(in oklab, ${c} 10%, var(--surface)) 55%, color-mix(in oklab, ${c} 24%, var(--surface)) 100%)`,
          boxShadow: `inset 0 2px 3px rgb(255 255 255 / .65), inset 0 -6px 12px color-mix(in oklab, ${c} 18%, transparent), 0 14px 24px -14px color-mix(in oklab, ${c} 55%, transparent)`,
        }}
      />
      <Icon className={clsx('absolute translate-y-[3px] opacity-30 blur-[1.5px]', glyphClassName ?? 'size-9')} style={{ color: c }} strokeWidth={2.4} />
      <Icon
        className={clsx('relative', glyphClassName ?? 'size-9')}
        style={{ color: c, filter: `drop-shadow(0 3px 4px color-mix(in oklab, ${c} 40%, transparent))` }}
        strokeWidth={2.1}
      />
      <span className="pointer-events-none absolute inset-x-3 top-1.5 h-3.5 rounded-full bg-white/55 blur-[3px]" />
    </span>
  );
}

/** Big glossy trust shield used by the hero banners and the stats band. */
export function ShieldArt({ className }: { className?: string }) {
  const gid = useId().replace(/[:]/g, '');
  return (
    <svg viewBox="0 0 100 112" aria-hidden="true" className={className} style={{ filter: 'drop-shadow(0 14px 22px rgb(29 78 216 / .45))' }}>
      <defs>
        <linearGradient id={`sa-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="0.5" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={`sb-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbeafe" />
          <stop offset="1" stopColor="#93c5fd" />
        </linearGradient>
      </defs>
      <path d="M50 3 89 15v37c0 26-16.5 44.5-39 57C27.5 96.5 11 78 11 52V15Z" fill={`url(#sa-${gid})`} />
      <path d="M50 12 80 21.6V52c0 21-13.2 36.3-30 47C33.2 88.3 20 73 20 52V21.6Z" fill={`url(#sb-${gid})`} opacity="0.92" />
      <path d="M50 20 72 27v25c0 16.6-9.8 28.8-22 37-12.2-8.2-22-20.4-22-37V27Z" fill={`url(#sa-${gid})`} />
      <path d="M35 55.5 46 66l20-23" fill="none" stroke="#fff" strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="38" cy="22" rx="20" ry="9" fill="#fff" opacity="0.3" transform="rotate(-14 38 22)" />
    </svg>
  );
}

/* ----------------------------- phone mockup -------------------------------- */

/**
 * A CSS phone whose screen always shows the *configured* brand (logo, name
 * and hero image from settings), so the app promo rebrands itself.
 */
export function PhoneMockup({ className }: { className?: string }) {
  const brand = useBrand();
  return (
    <div className={clsx('relative mx-auto w-52 sm:w-60', className)} dir="rtl">
      <div className="absolute -inset-6 rounded-[3rem] bg-brand-500/25 blur-2xl" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-[2.4rem] border-[6px] border-navy-950/90 bg-navy-950 shadow-2xl">
        <div className="relative aspect-[9/18.5] overflow-hidden bg-gradient-to-b from-brand-600 via-brand-700 to-shell">
          <img src={brand.heroImage} alt="" className="absolute inset-x-0 bottom-0 h-[46%] w-full object-cover opacity-90" loading="lazy" />
          <div className="absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-transparent via-transparent to-brand-700" aria-hidden="true" />
          <div className="relative flex flex-col items-center px-4 pt-9 text-center">
            <BrandMark className="size-14" />
            <p className="mt-3 text-base font-black text-white">{brand.name}</p>
            {brand.nameEn && <p className="mt-0.5 text-[10px] font-medium tracking-wide text-white/70" dir="ltr">{brand.nameEn}</p>}
            <div className="mt-5 w-full space-y-2">
              {['ثبت درخواست جدید', 'پیگیری پرونده‌ها', 'کیف پول و پرداخت'].map((label, i) => (
                <div key={label} className={clsx('flex items-center gap-2 rounded-xl px-3 py-2 text-right text-[11px] font-semibold', i === 0 ? 'bg-white text-navy-900 shadow-lg' : 'bg-white/12 text-white ring-1 ring-white/15')}>
                  <span className={clsx('size-1.5 rounded-full', i === 0 ? 'bg-emerald-500' : 'bg-white/60')} />
                  {label}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-navy-950/90" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- skyline ----------------------------------- */

/** Stylised Tehran skyline silhouette (Tehran + towers) for dark footers. */
export function Skyline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M0 120 V92 h38 V70 h24 V92 h30 V58 h18 V40 h10 v18 h14 v34 h34 V64 h22 V92 h40 V76 h16 V52 h3 l7-26 7 26 h3 v24 h16 v16 h36 V66 h20 V92 h30 V84 h28 V92 h44 V60 h14 V44 h8 v16 h12 v32 h30 V72 h24 v20 h38 V56 h4 l10-40 10 40 h4 v36 h32 V68 h18 v24 h42 V78 h26 v14 h30 V50 h12 v42 h34 V70 h22 v22 h38 V62 h16 V38 h6 v-10 h4 v10 h6 v24 h14 v30 h36 V74 h24 v18 h30 V58 h20 v34 h40 V80 h26 v12 h34 V64 h18 v28 h44 V72 h22 v20 h1200 Z"
      />
    </svg>
  );
}

/* ------------------------------ custom HTML -------------------------------- */

/**
 * Admin-supplied raw HTML for the landing page («HTML سفارشی» setting).
 * Scripts are re-created so they actually run; this is intentionally the
 * site owner's own code on their own public page.
 */
export function CustomHtml({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = html;
    host.querySelectorAll('script').forEach((old) => {
      const script = document.createElement('script');
      for (const attr of Array.from(old.attributes)) script.setAttribute(attr.name, attr.value);
      script.textContent = old.textContent;
      old.replaceWith(script);
    });
    return () => { host.innerHTML = ''; };
  }, [html]);

  if (!html?.trim()) return null;
  return <div ref={ref} className={className} />;
}
