import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Activity, ArrowLeft, Camera, Clapperboard, Clock, Download, Globe, House, Info, LayoutGrid, Mail, MapPin,
  Menu, MessageCircle, Newspaper, Phone, Send, ShieldCheck, Sparkles, UserRound, X,
} from 'lucide-react';
import clsx from 'clsx';
import { parseListSetting, useSite } from '../lib/site';
import { useAuth, homeFor } from '../lib/auth';
import { useBrand, BrandLockup } from '../lib/brand';
import { Skyline } from './visual';
import { ChatWidget } from './ChatWidget';
import { ThemeToggle } from '../lib/theme';

const links = [
  { to: '/', label: 'خانه', end: true, icon: <House className="size-4" /> },
  { to: '/services', label: 'خدمات', icon: <LayoutGrid className="size-4" /> },
  { to: '/blog', label: 'بلاگ', icon: <Newspaper className="size-4" /> },
  { to: '/assistant', label: 'دستیار هوشمند', icon: <Sparkles className="size-4" /> },
  { to: '/status', label: 'وضعیت سامانه', icon: <Activity className="size-4" /> },
  { to: '/legal', label: 'درباره و شرایط', icon: <Info className="size-4" /> },
];

function socialIcon(title: string) {
  if (title.includes('تلگرام')) return <Send className="size-4" />;
  if (title.includes('اینستا')) return <Camera className="size-4" />;
  if (title.includes('آپارات') || title.includes('ویدیو')) return <Clapperboard className="size-4" />;
  if (title.includes('ایتا') || title.includes('بله') || title.includes('واتساپ') || title.includes('سروش')) return <MessageCircle className="size-4" />;
  return <Globe className="size-4" />;
}

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
                  'flex items-center gap-1.5 rounded-full px-4 py-2 text-sm whitespace-nowrap transition',
                  isActive
                    ? 'bg-primary font-bold text-primary-fg shadow-md shadow-primary/30'
                    : 'text-navy-600 hover:bg-surface hover:text-navy-900',
                )}
              >
                {link.icon}
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
                    'flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition',
                    isActive ? 'bg-primary-soft font-bold text-accent' : 'text-navy-700 hover:bg-surface-3',
                  )}
                >
                  {link.icon}
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
        <div className="relative mx-auto max-w-7xl px-4 pt-12 pb-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-10 gap-y-7">
            <div>
              <BrandLockup tone="light" />
              <p className="mt-3 max-w-xs text-[13px] leading-6 text-shell-muted">{brand.tagline || setting('site.description') || 'آیندهٔ خدمات دولتی، همین‌جاست…'}</p>
            </div>

            <nav aria-label="پیوندهای فوتر" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
              {[
                { to: '/', label: 'خانه' },
                { to: '/services', label: 'خدمات' },
                { to: '/blog', label: 'بلاگ' },
                { to: '/assistant', label: 'دستیار هوشمند' },
                { to: '/status', label: 'وضعیت سامانه' },
                { to: '/legal', label: 'شرایط و حریم خصوصی' },
                { to: '/login', label: 'ورود مشتریان' },
              ].map((link, index, arr) => (
                <span key={link.to} className="flex items-center gap-2">
                  <Link to={link.to} className="rounded-lg px-2 py-1 transition hover:text-shell-fg">{link.label}</Link>
                  {index < arr.length - 1 && <span aria-hidden="true" className="h-3.5 w-px bg-white/15" />}
                </span>
              ))}
            </nav>

            {socials.length > 0 && (
              <div className="ms-auto flex items-center gap-2">
                {socials.map((social) => (
                  <a
                    key={`${social.title}-${social.url}`}
                    href={social.url}
                    target="_blank"
                    rel="noreferrer"
                    title={social.title}
                    aria-label={social.title}
                    className="grid size-10 place-items-center rounded-full border border-white/15 bg-white/5 text-shell-fg transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/10"
                  >
                    {socialIcon(social.title)}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-2.5 border-t border-white/10 pt-5 text-xs text-shell-muted">
            {setting('office.address') && <span className="flex items-center gap-1.5"><MapPin className="size-3.5 text-brand-300" />{setting('office.address')}</span>}
            {setting('office.phone') && (
              <a href={`tel:${setting('office.phone')}`} className="flex items-center gap-1.5 transition hover:text-shell-fg">
                <Phone className="size-3.5 text-brand-300" /> <span dir="ltr">{setting('office.phone')}</span>
              </a>
            )}
            {setting('office.email') && (
              <a href={`mailto:${setting('office.email')}`} className="flex items-center gap-1.5 transition hover:text-shell-fg">
                <Mail className="size-3.5 text-brand-300" /> <span dir="ltr">{setting('office.email')}</span>
              </a>
            )}
            {setting('office.working_hours') && <span className="flex items-center gap-1.5"><Clock className="size-3.5 text-brand-300" />{setting('office.working_hours')}</span>}
            {appUrl && (
              <a href={appUrl} target="_blank" rel="noreferrer" className="btn-primary btn-sm ms-auto">
                <Download className="size-4" /> {setting('landing.app_button_label') || 'دریافت اپلیکیشن'}
              </a>
            )}
          </div>
        </div>

        <Skyline className="relative block h-14 w-full text-white/[0.07]" />
        <div className="relative border-t border-shell-line px-4 py-4 text-center text-xs text-shell-muted">
          © {setting('site.footer_text')} – {brand.name}
        </div>
      </footer>
      <ChatWidget placement="page" />
    </div>
  );
}

