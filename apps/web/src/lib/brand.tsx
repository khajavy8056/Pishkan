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
    name: setting('site.name') || 'دفتر پیشخوان دولت',
    shortName: setting('site.short_name') || 'پیشخوان',
    nameEn: setting('site.name_en'),
    tagline: setting('site.tagline'),
    /** Uploaded/configured logo image; empty → built-in vector mark. */
    logoUrl: setting('site.logo_url') || (logoFileId ? '/api/public/brand-asset/logo' : ''),
    heroImage: setting('landing.hero_image_url') || '/images/hero-building.jpg',
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
    <svg viewBox="0 0 48 48" role="img" aria-label={name} className={clsx('shrink-0 drop-shadow-lg', className ?? 'size-11')}>
      <defs>
        <linearGradient id={`bm-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="0.55" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#0b2b5b" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#bm-${gid})`} />
      <rect x="2" y="2" width="44" height="22" rx="11" fill="#ffffff" opacity="0.14" />
      <path d="M18 35.5v-23h8.6a7.4 7.4 0 0 1 0 14.8H18" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="33.5" cy="33.5" r="2.6" fill="#7dd3fc" />
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
