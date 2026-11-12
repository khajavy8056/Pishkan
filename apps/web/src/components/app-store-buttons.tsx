/**
 * Android install buttons.
 *
 * Three ways to install, side by side, because Iranian customers expect all
 * three: a direct APK from this server, and the two stores the app is
 * published on (Café Bazaar and Myket).
 *
 * Each destination has its own setting (`landing.app_android_url`,
 * `landing.app_bazaar_url`, `landing.app_myket_url`). Until a link is filled
 * in — which is the state today, before release — that button renders as a
 * disabled "coming soon" card instead of a dead link. Nothing has to be
 * rewired when the links arrive: fill them in the admin panel and the same
 * component starts emitting real anchors.
 *
 * The store glyphs are drawn here as inline SVG rather than shipped as image
 * files. They are simplified marks — a shop bag for Bazaar, a rounded "m" for
 * Myket — deliberately not reproductions of the official logos, so nothing in
 * the repo is a copied trademark. Swap in the real assets from each store's
 * press kit once the app is listed there.
 */
import { Check, Download, Store } from 'lucide-react';
import clsx from 'clsx';

export interface AppLinks {
  /** Direct APK. */
  direct?: string;
  bazaar?: string;
  myket?: string;
  /** Label for the direct button. */
  directLabel?: string;
  /** Render "coming soon" cards for stores that have no link. */
  showComingSoon?: boolean;
}

type Destination = {
  id: 'direct' | 'bazaar' | 'myket';
  href?: string;
  label: string;
  hint: string;
  /** Tailwind-free inline colours so the surface reads as each store at a glance. */
  style: { backgroundImage: string; boxShadow: string };
  glyph: React.ReactNode;
};

/** Café Bazaar's mark: a shopping bag with a handle. */
function BazaarGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.15em]">
      <path
        d="M6.2 8.4h11.6a1.6 1.6 0 0 1 1.59 1.44l.7 8.1A2.2 2.2 0 0 1 17.9 20.4H6.1a2.2 2.2 0 0 1-2.19-2.46l.7-8.1A1.6 1.6 0 0 1 6.2 8.4Z"
        fill="currentColor"
      />
      <path
        d="M8.7 9.2V7.1a3.3 3.3 0 0 1 6.6 0v2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Myket's mark: a rounded lowercase "m" in its blue. */
function MyketGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.15em]">
      <path
        d="M4 18V9.6a1 1 0 0 1 1.7-.7l2.9 2.9a1.4 1.4 0 0 0 2 0l2.9-2.9a1 1 0 0 1 1.7.7V18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="18.2" cy="15.4" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** A neutral badge for the direct download. */
function DirectGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.15em]">
      <path d="M12 4v9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7.6 9.6 12 14l4.4-4.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17.4h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function AppStoreButtons({
  links,
  className,
  size = 'md',
}: {
  links: AppLinks;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const destinations: Destination[] = [
    {
      id: 'direct',
      href: links.direct,
      label: links.directLabel || 'دانلود مستقیم',
      hint: 'فایل APK',
      style: {
        backgroundImage: 'linear-gradient(180deg,#34d399 0%,#059669 55%,#047857 100%)',
        boxShadow: '0 16px 30px -14px rgb(5 150 105 / .6), inset 0 1px 0 rgb(255 255 255 / .4), inset 0 -2px 0 rgb(0 0 0 / .16)',
      },
      glyph: <DirectGlyph />,
    },
    {
      id: 'bazaar',
      href: links.bazaar,
      label: 'کافه‌بازار',
      hint: 'نصب از بازار',
      style: {
        backgroundImage: 'linear-gradient(180deg,#3ddc84 0%,#00b34a 58%,#008a39 100%)',
        boxShadow: '0 16px 30px -14px rgb(0 140 60 / .6), inset 0 1px 0 rgb(255 255 255 / .45), inset 0 -2px 0 rgb(0 0 0 / .18)',
      },
      glyph: <BazaarGlyph />,
    },
    {
      id: 'myket',
      href: links.myket,
      label: 'مایکت',
      hint: 'نصب از مایکت',
      style: {
        backgroundImage: 'linear-gradient(180deg,#4cc9ff 0%,#0091ea 58%,#0069b3 100%)',
        boxShadow: '0 16px 30px -14px rgb(0 120 200 / .6), inset 0 1px 0 rgb(255 255 255 / .5), inset 0 -2px 0 rgb(0 0 0 / .18)',
      },
      glyph: <MyketGlyph />,
    },
  ];

  const visible = destinations.filter((item) => item.href || links.showComingSoon !== false);
  if (!visible.length) return null;

  return (
    <div className={clsx('flex flex-wrap items-stretch gap-2.5', className)}>
      {visible.map((item) => {
        const coming = !item.href;
        const base = clsx(
          'app-store-btn group relative flex min-w-[9.5rem] flex-1 items-center gap-2.5 overflow-hidden rounded-2xl px-4 text-white transition-all duration-200',
          size === 'lg' ? 'py-3' : 'py-2.5',
          coming && 'app-store-btn--soon cursor-default',
        );

        const inner = (
          <>
            {/* glossy top light, so the button matches the existing pill buttons */}
            <span aria-hidden="true" className="app-store-btn-gloss" />
            <span
              className={clsx(
                'relative grid size-9 shrink-0 place-items-center rounded-xl bg-white/20 ring-1 ring-white/25',
                coming && 'opacity-60',
              )}
              style={{ fontSize: size === 'lg' ? '1rem' : '0.9rem' }}
            >
              {item.glyph}
            </span>
            <span className="relative min-w-0 text-right leading-tight">
              <span className={clsx('block truncate font-black', size === 'lg' ? 'text-[13.5px]' : 'text-[12.5px]')}>
                {item.label}
              </span>
              <span className="block truncate text-[10px] font-medium text-white/75">
                {coming ? 'به‌زودی' : item.hint}
              </span>
            </span>
            {!coming && (
              <Download className="relative mr-auto size-4 shrink-0 text-white/70 transition group-hover:translate-y-0.5" />
            )}
          </>
        );

        if (coming) {
          return (
            <span key={item.id} className={base} style={{ backgroundImage: 'linear-gradient(180deg,#64748b 0%,#475569 58%,#334155 100%)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .18), inset 0 -2px 0 rgb(0 0 0 / .2)' }} aria-disabled="true">
              {inner}
            </span>
          );
        }

        return (
          <a
            key={item.id}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            className={base}
            style={item.style}
            aria-label={`${item.label} — ${item.hint}`}
          >
            {inner}
          </a>
        );
      })}
    </div>
  );
}

/**
 * The one-line status under the buttons: tells the visitor what will happen
 * when a store button is not live yet, without pretending it is.
 */
export function AppInstallNote({ className }: { className?: string }) {
  return (
    <p className={clsx('mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-white/55', className)}>
      <span className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-300" /> نصب رایگان</span>
      <span className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-300" /> بدون تبلیغات</span>
      <span className="flex items-center gap-1.5"><Store className="size-3.5 text-emerald-300" /> اندروید ۸ به بالا</span>
    </p>
  );
}
