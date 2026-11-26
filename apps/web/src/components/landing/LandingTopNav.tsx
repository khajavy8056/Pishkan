import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LogIn, Menu, Monitor, Moon, ShieldCheck, Sun, Wrench, X } from 'lucide-react';
import { useAuth, homeFor } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { useSite } from '../../lib/site';
import { useTheme, type ThemeMode } from '../../lib/theme';
import { useScrollState } from '../landing-motion';

const SECTION_LINKS = [
  { href: '#services', label: 'خدمات' },
  { href: '#journey', label: 'مسیر ثبت' },
  { href: '#app', label: 'اپلیکیشن' },
  { href: '#faq', label: 'پرسش‌ها' },
] as const;

const PAGE_LINKS = [
  { to: '/blog', label: 'بلاگ' },
  { to: '/assistant', label: 'دستیار هوشمند' },
] as const;

function LandingThemeToggle({ className = '' }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const options: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: 'روشن', Icon: Sun },
    { value: 'dark', label: 'تیره', Icon: Moon },
    { value: 'system', label: 'خودکار', Icon: Monitor },
  ];

  return (
    <div
      role="group"
      aria-label="پوسته ظاهری"
      className={`inline-flex items-center gap-0.5 rounded-full border border-line bg-ink/60 p-1 backdrop-blur-xl ${className}`}
    >
      {options.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={`relative grid size-7 place-items-center rounded-full transition-all duration-200 ${
              active
                ? 'text-cyan-600 shadow-[inset_0_0_0_1px_rgb(34_211_238/0.4)] dark:text-cyan-300'
                : 'text-muted hover:text-text'
            }`}
          >
            <Icon className="size-3.5" strokeWidth={2.2} />
            {active ? <span className="absolute inset-0 rounded-full bg-cyan-400/12" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function LandingTopNav({
  onOpenAuth,
}: {
  onOpenAuth: (tab?: 'login' | 'register') => void;
}) {
  const { progress } = useScrollState(24);
  const { user } = useAuth();
  const brand = useBrand();
  const { site, setting } = useSite();
  const [open, setOpen] = useState(false);

  const supportNotice = setting('site.support_notice');
  const tagline = brand.tagline || setting('site.tagline') || 'دفتر خدمات دولتی دیجیتال';

  return (
    <>
      <a href="#top" className="fixed inset-x-4 top-0 z-[75] h-[3px]" aria-hidden="true">
        <div
          className="scroll-hairline !relative !inset-auto !h-[3px]"
          style={{ width: `${(progress * 100).toFixed(2)}%`, opacity: progress > 0.01 ? 1 : 0 }}
        />
      </a>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60]">
        {supportNotice ? (
          <div className="pointer-events-auto border-b border-cyan-400/25 bg-gradient-to-l from-brand-700 via-brand-600 to-cyan-700 px-4 py-1.5 text-center text-xs font-bold text-white">
            {supportNotice}
          </div>
        ) : null}

        {site?.maintenance ? (
          <div className="pointer-events-auto flex items-center justify-center gap-2 border-b border-amber-400/30 bg-amber-500/20 px-4 py-1.5 text-xs font-bold text-[#78350f] backdrop-blur dark:text-[#fef3c7]">
            <Wrench className="size-4 shrink-0" />
            <span>{setting('site.maintenance_message') || 'سامانه موقتاً در حال به‌روزرسانی است.'}</span>
          </div>
        ) : null}

        <header className="glass lp-nav pointer-events-auto mt-3 rounded-2xl lg:mt-4">
          <div className="flex h-[58px] items-center gap-2.5 px-3.5 sm:gap-3 sm:px-4">
            <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-xl no-underline" aria-label="صفحه فرود">
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="size-9 shrink-0 rounded-xl border border-line bg-white/95 object-contain p-1 shadow-lg shadow-cyan-500/20"
                />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-brand-600 shadow-lg shadow-cyan-500/30">
                  <ShieldCheck className="size-5 text-white" strokeWidth={2.4} />
                </span>
              )}
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[0.92rem] font-black text-text">{brand.name}</span>
                <span className="hidden truncate text-[0.6rem] font-medium text-muted sm:block">{tagline}</span>
              </span>
            </Link>

            <nav className="mx-auto hidden items-center gap-1 lg:flex" aria-label="ناوبری اصلی">
              {SECTION_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-full px-3.5 py-2 text-[0.82rem] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  {item.label}
                </a>
              ))}
              {PAGE_LINKS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-full px-3.5 py-2 text-[0.82rem] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <LandingThemeToggle className="hidden sm:inline-flex" />

              {user ? (
                <Link to={homeFor(user)} className="lp-btn lp-btn-primary lp-btn-sm">
                  <span>پنل من</span>
                  <ArrowLeft className="size-4" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenAuth('login')}
                  className="lp-btn lp-btn-primary lp-btn-sm"
                  aria-label="ورود"
                >
                  <LogIn className="size-4" />
                  <span className="sm:hidden">ورود</span>
                  <span className="hidden sm:inline">ورود / ثبت‌نام</span>
                </button>
              )}

              <button
                type="button"
                className="lp-icon-btn lg:hidden"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="منو"
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>

          {open ? (
            <div className="animate-pop border-t border-line bg-ink/92 px-4 py-3 backdrop-blur-xl lg:hidden">
              <nav className="flex flex-col gap-1" aria-label="ناوبری موبایل">
                {SECTION_LINKS.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-2"
                  >
                    {item.label}
                  </a>
                ))}
                <Link
                  to="/services"
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-2"
                >
                  کاتالوگ خدمات
                </Link>
                {PAGE_LINKS.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-2"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5">
                  <span className="text-xs font-bold text-muted">حالت نمایش</span>
                  <LandingThemeToggle />
                </div>
                {user ? (
                  <Link
                    to={homeFor(user)}
                    onClick={() => setOpen(false)}
                    className="lp-btn lp-btn-primary lp-btn-sm mt-2 w-full justify-center"
                  >
                    ورود به پنل من
                  </Link>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setOpen(false); onOpenAuth('login'); }}
                      className="lp-btn lp-btn-soft lp-btn-sm"
                    >
                      ورود
                    </button>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); onOpenAuth('register'); }}
                      className="lp-btn lp-btn-primary lp-btn-sm"
                    >
                      ثبت‌نام
                    </button>
                  </div>
                )}
              </nav>
            </div>
          ) : null}
        </header>
      </div>
    </>
  );
}
