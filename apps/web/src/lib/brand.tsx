import { useId } from 'react';
import clsx from 'clsx';
import { useSite } from './site';

/**
 * Single source of truth for the brand surface. Every header, sidebar,
 * footer, login screen and phone mockup reads the name / Latin name /
 * tagline / logo from here, so editing them once in «تنظیمات سامانه ←
 * صفحهٔ فرود و هویت بصری» rebrands the whole product at once.
 */
export function useBrand() {
  const { setting } = useSite();
  const logoFileId = setting('site.logo_file_id');
  return {
    name: setting('site.name') || 'تک پیشخوان',
    shortName: setting('site.short_name') || 'تک پیشخوان',
    nameEn: setting('site.name_en'),
    tagline: setting('site.tagline'),
    /** Uploaded/configured logo image; empty → built-in vector mark. */
    logoUrl: setting('site.logo_url') || (logoFileId ? '/api/public/brand-asset/logo' : ''),
    heroImage: setting('landing.hero_image_url') || '/images/hero-building.jpg',
    panelHero: setting('landing.panel_hero_url') || setting('landing.hero_image_url') || '/images/panel-hero.jpg',
    mascot: setting('landing.mascot_url') || '/images/mascot-robot.jpg',
  };
}

/** The brand glyph: configured logo image when present, else the vector mark. */
export function BrandMark({ className, imgClassName }: { className?: string; imgClassName?: string }) {
  const { logoUrl, name } = useBrand();
  const gid = useId().replace(/[:]/g, '');
  if (logoUrl) {
    return (
      <span className={clsx('grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/95 shadow-lg shadow-primary/25 ring-1 ring-white/40', className ?? 'size-11')}>
        <img src={logoUrl} alt={name} className={clsx('size-full object-contain p-1', imgClassName)} />
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={name}
      className={clsx('shrink-0', className ?? 'size-11')}
      style={{ filter: 'drop-shadow(0 3px 10px rgb(37 99 235 / .45))' }}
    >
      <defs>
        <linearGradient id={`bm-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.42" stopColor="#3b82f6" />
          <stop offset="0.78" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#172554" />
        </linearGradient>
        <clipPath id={`bm-clip-${gid}`}>
          <path d="M14 3h13.2c7.8 0 12.8 5.4 12.8 12.4 0 7.2-5.2 12.2-13.2 12.2H22V45h-8Z" />
        </clipPath>
      </defs>
      <path
        fillRule="evenodd"
        fill={`url(#bm-${gid})`}
        d="M14 3h13.2c7.8 0 12.8 5.4 12.8 12.4 0 7.2-5.2 12.2-13.2 12.2H22V45h-8Zm8 8h4.9c2.9 0 4.9 2 4.9 4.6 0 2.7-2 4.5-5 4.5H22Z"
      />
      <path d="M14 27.6h8l-8 8.6Z" fill="#172554" opacity="0.5" />
      <g clipPath={`url(#bm-clip-${gid})`}>
        <ellipse cx="17" cy="8" rx="16" ry="9" fill="#ffffff" opacity="0.28" transform="rotate(-18 17 8)" />
      </g>
    </svg>
  );
}

/** Logo + wordmark lockup used in the public header, sidebars and footer. */
export function BrandLockup({
  tone = 'dark',
  compact = false,
  subtitle,
}: {
  /** dark = text for light surfaces · light = text for navy surfaces */
  tone?: 'dark' | 'light';
  compact?: boolean;
  /** overrides the second line (defaults to the Latin name, else tagline) */
  subtitle?: string;
}) {
  const brand = useBrand();
  const sub = subtitle ?? (brand.nameEn || brand.tagline);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <BrandMark className={compact ? 'size-10' : 'size-12'} />
      <span className="min-w-0 leading-tight">
        <span className={clsx('block truncate font-black tracking-tight', compact ? 'text-base' : 'text-lg', tone === 'light' ? 'text-white' : 'text-navy-900')}>
          {brand.name}
        </span>
        {sub && (
          <span className={clsx('mt-0.5 block truncate text-[11px] font-medium', tone === 'light' ? 'text-white/65' : 'text-navy-500')} dir={brand.nameEn && !subtitle ? 'ltr' : undefined}>
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}
