import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X, Phone, MapPin, Clock, ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { useSite } from '../lib/site';
import { useAuth,homeFor } from '../lib/auth';
import { ThemeToggle } from '../lib/theme';

const links = [
  { to: '/', label: 'خانه', end: true },
  { to: '/services', label: 'خدمات' },
  { to: '/assistant', label: 'دستیار هوشمند' },
  { to: '/status', label: 'وضعیت سامانه' },
];

export function PublicLayout({ children }: { children: ReactNode }) {
  const { site, setting } = useSite();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const panelLink = homeFor(user);
  void location;

  return (
    <div className="flex min-h-dvh flex-col">
      {setting('site.support_notice') && (
        <div className="bg-shell px-4 py-2 text-center text-xs text-shell-fg">
          {setting('site.support_notice')}
        </div>
      )}

      <header className="glass sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-shell text-lg font-black text-white">پ</span>
            <span className="leading-tight">
              <span className="block text-sm font-bold text-navy-900">{setting('site.name') || 'دفتر پیشخوان دولت'}</span>
              <span className="block text-[11px] text-navy-500">{setting('site.tagline')}</span>
            </span>
          </Link>

          <nav className="mr-4 hidden items-center gap-1 lg:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => clsx(
                  'rounded-lg px-3 py-2 text-sm transition',
                  isActive ? 'bg-primary-soft font-semibold text-accent' : 'text-navy-600 hover:bg-surface-3 hover:text-navy-900',
                )}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {setting('office.phone') && (
            <a href={`tel:${setting('office.phone')}`} className="hidden items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900 sm:flex">
              <Phone className="size-4" /> {setting('office.phone')}
            </a>
          )}

          <ThemeToggle className="shrink-0" />

          {user ? (
            <Link to={panelLink} className="btn-primary btn-sm">
              ورود به پنل <ArrowLeft className="size-4" />
            </Link>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link to="/login" className="btn-ghost btn-sm">ورود</Link>
              <Link to="/register" className="btn-primary btn-sm">ثبت‌نام</Link>
            </div>
          )}

          <button className="icon-btn lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="منو">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open && (
          <div className="border-t border-line bg-surface px-4 py-3 lg:hidden">
            <div className="flex flex-col gap-1">
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-navy-700 hover:bg-surface-3">{link.label}</NavLink>
              ))}
              {!user && (
                <div className="mt-2 flex gap-2">
                  <Link to="/login" className="btn-ghost btn-sm flex-1 justify-center" onClick={() => setOpen(false)}>ورود</Link>
                  <Link to="/register" className="btn-primary btn-sm flex-1 justify-center" onClick={() => setOpen(false)}>ثبت‌نام</Link>
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

      <footer className="mt-12 border-t border-shell-line bg-shell text-shell-muted">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-600 font-black text-white">پ</span>
              <span className="font-bold text-shell-fg">{setting('office.name') || setting('site.name')}</span>
            </div>
            <p className="mt-3 max-w-md text-sm leading-7 text-shell-muted">{setting('site.description')}</p>
            <div className="mt-4 space-y-2 text-sm">
              {setting('office.address') && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" />{setting('office.address')}</p>}
              {setting('office.phone') && <p className="flex items-center gap-2"><Phone className="size-4" />{setting('office.phone')}</p>}
              {setting('office.working_hours') && <p className="flex items-center gap-2"><Clock className="size-4" />{setting('office.working_hours')}</p>}
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-shell-fg">دسترسی سریع</h4>
            <ul className="space-y-2 text-sm">
              <li><Link className="transition hover:text-shell-fg" to="/services">فهرست خدمات</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/assistant">دستیار هوشمند</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/login">ورود مشتریان</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/status">وضعیت سامانه</Link></li>
              <li><Link className="transition hover:text-shell-fg" to="/legal">شرایط و حریم خصوصی</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-shell-fg">اطمینان خاطر</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-400" /> ارسال امن مدارک</li>
              <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-400" /> پیگیری شفاف پرونده</li>
              <li className="flex items-center gap-2"><Sparkles className="size-4 text-brand-400" /> راهنمای هوشمند خدمات</li>
            </ul>
            <p className="mt-4 text-xs leading-6 text-shell-muted">
              هزینه‌ها و شرایط نمایش‌داده‌شده نمونه است و پس از بررسی مدارک توسط دفتر تأیید می‌شود.
            </p>
          </div>
        </div>
        <div className="border-t border-shell-line px-4 py-4 text-center text-xs text-shell-muted">
          {setting('site.footer_text')} — نسخه {site?.version ?? '1.1.0'}
        </div>
      </footer>
    </div>
  );
}
