import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  ArrowLeft, Clock, Download, Globe, LayoutGrid, Mail, MapPin, Menu, Phone, ShieldCheck, Sparkles, UserRound, X,
} from 'lucide-react';
import clsx from 'clsx';
import { parseListSetting, useSite } from '../lib/site';
import { useAuth, homeFor } from '../lib/auth';
import { useBrand, BrandLockup } from '../lib/brand';
import { Skyline } from './visual';
import { ChatWidget } from './ChatWidget';
import { ThemeToggle } from '../lib/theme';

const links = [
  { to: '/', label: 'خانه', end: true },
  { to: '/services', label: 'خدمات' },
  { to: '/assistant', label: 'دستیار هوشمند' },
  { to: '/status', label: 'وضعیت سامانه' },
  { to: '/legal', label: 'درباره و شرایط' },
];

interface SocialLink { title: string; url: string }

export function PublicLayout({ children }: { children: ReactNode }) {
  const { site, setting } = useSite();
  const { user } = useAuth();
  const brand = useBrand();
  const [open, setOpen] = useState(false);

  const socials = parseListSetting<SocialLink>(setting('site.social_links'), [])
    .filter((item) => item?.title && item?.url);
  const appUrl = setting('landing.app_android_url');
  const panelLink = homeFor(user);

  return (
    <div className="flex min-h-dvh flex-col">
      {setting('site.support_notice') && (
        <div className="bg-shell px-4 py-2 text-center text-xs leading-6 text-shell-fg">
          {setting('site.support_notice')}
        </div>
      )}

      <header className="glass sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="shrink-0 rounded-2xl transition hover:opacity-90" aria-label={brand.name}>
            <BrandLockup compact />
          </Link>

          <nav className="mx-auto hidden items-center gap-1 rounded-full border border-line bg-surface-2/80 p-1 shadow-xs lg:flex" aria-label="ناوبری اصلی">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => clsx(
                  'rounded-full px-4 py-2 text-sm whitespace-nowrap transition',
                  isActive
                    ? 'bg-primary font-bold text-primary-fg shadow-md shadow-primary/30'
                    : 'text-navy-600 hover:bg-surface hover:text-navy-900',
                )}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1 lg:hidden" />

          {setting('office.phone') && (
            <a href={`tel:${setting('office.phone')}`} className="hidden items-center gap-1.5 text-sm font-medium text-navy-600 transition hover:text-navy-900 xl:flex">
              <Phone className="size-4" /> <span dir="ltr">{setting('office.phone')}</span>
            </a>
          )}

          <ThemeToggle className="shrink-0" />

          {user ? (
            <Link to={panelLink} className="btn-primary btn-sm shrink-0">
              پنل من <ArrowLeft className="size-4" />
            </Link>
          ) : (
            <Link to="/login" className="btn-primary btn-sm hidden shrink-0 sm:inline-flex">
              <UserRound className="size-4" /> ورود / ثبت‌نام
            </Link>
          )}

          <button className="icon-btn lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="منو" aria-expanded={open}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open && (
          <div className="animate-pop border-t border-line bg-surface px-4 py-3 lg:hidden">
            <div className="flex flex-col gap-1">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => clsx(
                    'rounded-xl px-3 py-2.5 text-sm transition',
                    isActive ? 'bg-primary-soft font-bold text-accent' : 'text-navy-700 hover:bg-surface-3',
                  )}
                >
                  {link.label}
                </NavLink>
              ))}
              {!user && (
                <div className="mt-2 flex gap-2">
                  <Link to="/login" className="btn-primary flex-1 justify-center" onClick={() => setOpen(false)}>ورود</Link>
                  <Link to="/register" className="btn-ghost flex-1 justify-center" onClick={() => setOpen(false)}>ثبت‌نام</Link>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {site?.maintenance && (
        <div className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-800 ring-1 ring-amber-200">
          سامانه در حال به‌روزرسانی است؛ برخی بخش‌ها موقتاً در دسترس نیستند.
        </div>
      )}

      <main className="flex-1">{children}</main>

      <footer className="relative mt-16 overflow-hidden bg-shell text-shell-muted">
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 left-1/4 size-80 rounded-full bg-brand-500/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pt-14 pb-8 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.1fr]">
          <div>
            <BrandLockup tone="light" />
            <p className="mt-4 max-w-md text-sm leading-7 text-shell-muted">{setting('site.description')}</p>
            <div className="mt-5 space-y-2.5 text-sm">
              {setting('office.address') && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-brand-300" />{setting('office.address')}</p>}
              {setting('office.working_hours') && <p className="flex items-center gap-2"><Clock className="size-4 shrink-0 text-brand-300" />{setting('office.working_hours')}</p>}
            </div>
            {socials.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {socials.map((social) => (
                  <a
                    key={`${social.title}-${social.url}`}
                    href={social.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-shell-fg transition hover:border-white/30 hover:bg-white/10"
                  >
                    <Globe className="size-3.5" /> {social.title}
                  </a>
                ))}
              </div>
            )}
          </div>

          <nav aria-label="دسترسی سریع">
            <h4 className="mb-4 text-sm font-bold text-shell-fg">دسترسی سریع</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link className="transition hover:text-shell-fg" to="/services">فهرست خدمات</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/assistant">دستیار هوشمند</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/login">ورود مشتریان</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/register">ثبت‌نام مشتری جدید</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/status">وضعیت سامانه</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/legal">شرایط و حریم خصوصی</Link></li>
            </ul>
          </nav>

          <div>
            <h4 className="mb-4 text-sm font-bold text-shell-fg">تماس با ما</h4>
            <ul className="space-y-2.5 text-sm">
              {setting('office.phone') && (
                <li>
                  <a href={`tel:${setting('office.phone')}`} className="flex items-center gap-2 transition hover:text-shell-fg">
                    <Phone className="size-4 text-brand-300" /> <span dir="ltr">{setting('office.phone')}</span>
                  </a>
                </li>
              )}
              {setting('office.mobile') && (
                <li>
                  <a href={`tel:${setting('office.mobile')}`} className="flex items-center gap-2 transition hover:text-shell-fg">
                    <Phone className="size-4 text-brand-300" /> <span dir="ltr">{setting('office.mobile')}</span>
                  </a>
                </li>
              )}
              {setting('office.email') && (
                <li>
                  <a href={`mailto:${setting('office.email')}`} className="flex items-center gap-2 transition hover:text-shell-fg">
                    <Mail className="size-4 text-brand-300" /> <span dir="ltr">{setting('office.email')}</span>
                  </a>
                </li>
              )}
              {(setting('office.city') || setting('office.province')) && (
                <li className="flex items-center gap-2">
                  <MapPin className="size-4 text-brand-300" /> {setting('office.province')}، {setting('office.city')}
                </li>
              )}
            </ul>
            {appUrl && (
              <a
                href={appUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-primary btn-sm mt-5"
              >
                <Download className="size-4" /> {setting('landing.app_button_label') || 'دریافت اپلیکیشن'}
              </a>
            )}
          </div>

          <div>
            <h4 className="mb-4 text-sm font-bold text-shell-fg">با خیال آسوده</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300"><ShieldCheck className="size-4" /></span>
                <span><b className="block font-semibold text-shell-fg">ارسال امن مدارک</b>دسترسی هر مدرک فقط برای کارشناس مسئول پرونده</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-400/15 text-brand-200"><LayoutGrid className="size-4" /></span>
                <span><b className="block font-semibold text-shell-fg">پیگیری شفاف پرونده</b>هر مرحله با تاریخ و مسئول آن ثبت می‌شود</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-200"><Sparkles className="size-4" /></span>
                <span><b className="block font-semibold text-shell-fg">راهنمای هوشمند خدمات</b>پیداکردن خدمت درست در چند ثانیه</span>
              </li>
            </ul>
          </div>
        </div>

        <Skyline className="relative block h-14 w-full text-white/[0.07]" />
        <div className="relative border-t border-shell-line px-4 py-4 text-center text-xs text-shell-muted">
          © {setting('site.footer_text')} — {setting('office.name') || brand.name} · نسخه {site?.version ?? '1.4.0'}
        </div>
      </footer>
      <ChatWidget placement="page" />
    </div>
  );
}

