import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, Wallet, MessageSquare, User, Bell, LogOut, Menu, X, Search,
  Building2, Users, CalendarClock, FileText, Receipt, BarChart3, Settings, Database, ShieldCheck,
  LifeBuoy, Shapes, Sparkles, ChevronDown, Plus, BadgeCheck, ServerCog, ClipboardCheck, ArrowLeft,
  Moon, Sun, Monitor,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth, homeFor } from '../lib/auth';
import { api } from '../lib/api';
import { relative, faNum } from '../lib/format';
import { ThemeToggle, useTheme } from '../lib/theme';
import { Button, Spinner } from './ui';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  permission?: string;
  badgeKey?: string;
  section?: string;
}

const SECTION_WORK = 'فضای کار';
const SECTION_ACCOUNT = 'حساب و ارتباط';
const SECTION_OPS = 'عملیات روزانه';
const SECTION_MANAGE = 'مدیریت';
const SECTION_SYSTEM = 'مالی و سامانه';
const SECTION_MORE = 'سایر بخش‌ها';
const SECTION_SUPPORT = 'پشتیبانی';

const customerNav: NavItem[] = [
  { to: '/app', label: 'داشبورد', icon: <LayoutDashboard className="size-5" />, end: true, section: SECTION_WORK },
  { to: '/app/services', label: 'خدمات', icon: <Shapes className="size-5" />, section: SECTION_WORK },
  { to: '/app/requests', label: 'درخواست‌های من', icon: <ClipboardList className="size-5" />, section: SECTION_WORK },
  { to: '/app/documents', label: 'مدارک من', icon: <FileText className="size-5" />, section: SECTION_WORK },
  { to: '/app/invoices', label: 'فاکتورها و پرداخت', icon: <Wallet className="size-5" />, section: SECTION_ACCOUNT },
  { to: '/app/offers', label: 'پیشنهادهای اختصاصی', icon: <Sparkles className="size-5" />, section: SECTION_ACCOUNT },
  { to: '/app/messages', label: 'پیام‌ها', icon: <MessageSquare className="size-5" />, section: SECTION_ACCOUNT },
  { to: '/app/profile', label: 'پروفایل', icon: <User className="size-5" />, section: SECTION_ACCOUNT },
  { to: '/assistant', label: 'دستیار هوشمند', icon: <LifeBuoy className="size-5" />, section: SECTION_SUPPORT },
];

const staffNav: NavItem[] = [
  { to: '/staff', label: 'میز کار من', icon: <LayoutDashboard className="size-5" />, end: true, section: SECTION_OPS },
  { to: '/staff/automation', label: 'کارتابل و ارجاعات', icon: <ClipboardCheck className="size-5" />, permission: 'requests.view', section: SECTION_OPS },
  { to: '/staff/requests', label: 'درخواست‌ها', icon: <ClipboardList className="size-5" />, permission: 'requests.view', section: SECTION_OPS },
  { to: '/staff/documents', label: 'بررسی مدارک', icon: <ClipboardCheck className="size-5" />, permission: 'documents.view', section: SECTION_OPS },
  { to: '/staff/customers', label: 'مشتریان', icon: <Users className="size-5" />, permission: 'customers.view', section: SECTION_OPS },
  { to: '/staff/queue', label: 'صف پذیرش', icon: <ClipboardList className="size-5" />, permission: 'requests.view', section: SECTION_OPS },
  { to: '/staff/custom-services', label: 'خدمت اختصاصی', icon: <Sparkles className="size-5" />, permission: 'services.create', section: SECTION_MORE },
  { to: '/staff/messages', label: 'پیام‌ها', icon: <MessageSquare className="size-5" />, permission: 'messages.view', section: SECTION_MORE },
  { to: '/staff/shifts', label: 'شیفت و حضور', icon: <CalendarClock className="size-5" />, section: SECTION_MORE },
  { to: '/staff/finance', label: 'حقوق و سهم من', icon: <Receipt className="size-5" />, section: SECTION_MORE },
];

const accountantNav: NavItem[] = [
  { to: '/staff/accounting', label: 'حسابداری دفتر', icon: <Wallet className="size-5" />, permission: 'invoices.view', section: SECTION_SYSTEM },
  { to: '/staff/reports', label: 'گزارش‌های مالی', icon: <BarChart3 className="size-5" />, permission: 'reports.view', section: SECTION_SYSTEM },
  { to: '/staff/payroll', label: 'حقوق و تسویه کارکنان', icon: <Receipt className="size-5" />, permission: 'invoices.view', section: SECTION_SYSTEM },
];

const adminNav: NavItem[] = [
  { to: '/admin/automation', label: 'کارتابل تأیید و ارجاع', icon: <ClipboardCheck className="size-5" />, permission: 'requests.view', section: SECTION_OPS },
  { to: '/admin', label: 'داشبورد مدیریت', icon: <LayoutDashboard className="size-5" />, end: true, section: SECTION_OPS },
  { to: '/admin/requests', label: 'درخواست‌ها', icon: <ClipboardList className="size-5" />, permission: 'requests.view', section: SECTION_OPS },
  { to: '/admin/services', label: 'خدمات و دسته‌ها', icon: <Shapes className="size-5" />, permission: 'services.view', section: SECTION_MANAGE },
  { to: '/admin/customers', label: 'مشتریان', icon: <Users className="size-5" />, permission: 'customers.view', section: SECTION_MANAGE },
  { to: '/admin/staff', label: 'کارکنان و نقش‌ها', icon: <BadgeCheck className="size-5" />, permission: 'staff.view', section: SECTION_MANAGE },
  { to: '/admin/shifts', label: 'شیفت و حضور', icon: <CalendarClock className="size-5" />, permission: 'shifts.view', section: SECTION_MANAGE },
  { to: '/admin/messages', label: 'گفت‌وگوها', icon: <MessageSquare className="size-5" />, permission: 'messages.view', section: SECTION_MANAGE },
  { to: '/admin/finance', label: 'حسابداری', icon: <Wallet className="size-5" />, permission: 'invoices.view', section: SECTION_SYSTEM },
  { to: '/admin/payroll', label: 'حقوق و سهم کارکنان', icon: <Users className="size-5" />, permission: 'invoices.view', section: SECTION_SYSTEM },
  { to: '/admin/reports', label: 'گزارش‌ها', icon: <BarChart3 className="size-5" />, permission: 'reports.view', section: SECTION_SYSTEM },
  { to: '/admin/settings', label: 'تنظیمات سامانه', icon: <Settings className="size-5" />, permission: 'settings.view', section: SECTION_SYSTEM },
  { to: '/admin/system', label: 'زیرساخت', icon: <ServerCog className="size-5" />, permission: 'system.view', section: SECTION_SYSTEM },
  { to: '/admin/audit', label: 'تاریخچه عملیات', icon: <ShieldCheck className="size-5" />, permission: 'audit.view', section: SECTION_SYSTEM },
];

export function navFor(kind: string) {
  return kind === 'customer' ? customerNav : kind === 'admin' ? adminNav : staffNav;
}

function groupNav(items: NavItem[]): { section: string; items: NavItem[] }[] {
  const groups: { section: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const section = item.section ?? SECTION_MORE;
    const group = groups.find((entry) => entry.section === section);
    if (group) group.items.push(item);
    else groups.push({ section, items: [item] });
  }
  return groups;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={clsx(
        'relative grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 via-brand-700 to-shell font-black text-white shadow-lg shadow-primary/30',
        compact ? 'size-9 text-sm' : 'size-10 text-base',
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,.45),transparent_60%)]" />
      <span className="relative">پ</span>
    </span>
  );
}

export function AppShell({ children, variant }: { children: ReactNode; variant: 'customer' | 'staff' | 'admin' }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  const nav = useMemo(() => {
    const list = navFor(user?.kind === 'admin' ? 'admin' : variant === 'customer' ? 'customer' : 'staff');
    return user?.roleCode === 'accountant'
      ? [...accountantNav, ...staffNav.filter((n) => !['/staff/custom-services', '/staff/queue'].includes(n.to))]
      : list;
  }, [variant, user?.kind, user?.roleCode]);
  const visibleNav = nav.filter((item) => !item.permission || can(item.permission));
  const groups = useMemo(() => groupNav(visibleNav), [visibleNav]);
  const activeItem = useMemo(() => {
    const matches = visibleNav
      .filter((item) => (item.end ? location.pathname === item.to : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)))
      .sort((a, b) => b.to.length - a.to.length);
    return matches[0];
  }, [visibleNav, location.pathname]);

  useEffect(() => {
    setOpen(false);
    setNotificationsOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await api.list<any>('/api/customers/me/notifications?limit=8');
        if (!active) return;
        setNotifications(res.data);
        setUnread(Number((res as any).meta?.unread ?? 0));
      } catch {
        /* notifications are non-critical */
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [location.pathname]);

  const markAllRead = async () => {
    await api.post('/api/customers/me/notifications/read', {});
    setUnread(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
  };

  const brandHome = homeFor(user);
  const roleLabel = user?.roleName ?? (variant === 'customer' ? 'پنل مشتریان' : 'پنل کارکنان');

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-fg"
      >
        پرش به محتوای اصلی
      </a>

      {/* Sidebar */}
      <aside
        className={clsx(
          'app-sidebar fixed inset-y-0 right-0 z-40 flex w-[17.5rem] shrink-0 flex-col text-shell-fg shadow-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 lg:shadow-none',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-label="منوی اصلی"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-5">
          <Link to={brandHome} className="group flex min-w-0 items-center gap-3 rounded-xl p-1 transition hover:bg-white/5">
            <BrandMark />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">دفتر پیشخوان</span>
              <span className="mt-0.5 block truncate text-[11px] text-shell-muted">{roleLabel}</span>
            </span>
          </Link>
          <button className="icon-btn text-shell-muted hover:bg-white/10 hover:text-shell-fg lg:hidden" onClick={() => setOpen(false)} aria-label="بستن منو">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {groups.map((group, index) => (
            <div key={group.section} className={index === 0 ? '' : 'pt-1'}>
              <p className="nav-group-label">{group.section}</p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => clsx('nav-link group relative', isActive && 'nav-link-active')}
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          aria-hidden="true"
                          className={clsx(
                            'absolute inset-y-2 right-0 w-1 rounded-full bg-white/90 transition-opacity',
                            isActive ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className={clsx('shrink-0 transition-transform group-hover:scale-110', isActive && 'text-white')}>{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-shell-line p-3">
          <div className="rounded-2xl border border-shell-line bg-white/5 p-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-sm font-bold text-shell-fg">
                {user?.fullName?.slice(0, 1) ?? '؟'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.fullName || 'کاربر'}</p>
                <p className="mt-0.5 truncate text-[11px] text-shell-muted">
                  {user?.roleName ?? (user?.kind === 'customer' ? 'مشتری' : 'کارمند')}
                  {user?.mobile ? ` • ${user.mobile}` : ''}
                </p>
              </div>
              <ThemeToggle tone="on-dark" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to={variant === 'customer' ? '/app/profile' : '/staff/shifts'} className="btn-ghost btn-sm justify-center border-white/15 bg-white/5 text-shell-fg hover:border-white/30 hover:bg-white/10">
                <User className="size-3.5" /> حساب
              </Link>
              <button
                type="button"
                onClick={async () => { await logout(); navigate('/'); }}
                className="btn-ghost btn-sm justify-center border-transparent bg-white/5 text-shell-fg hover:bg-rose-500/80 hover:text-white"
              >
                <LogOut className="size-3.5" /> خروج
              </button>
            </div>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-scrim backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20">
          <div className="flex items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
            <button className="icon-btn lg:hidden" onClick={() => setOpen(true)} aria-label="باز کردن منو">
              <Menu className="size-5" />
            </button>

            <div className="hidden min-w-0 items-center gap-2 text-xs text-navy-500 sm:flex">
              <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-surface-3 hover:text-navy-800">
                <Building2 className="size-4" /> صفحه اصلی
              </Link>
              {activeItem && (
                <>
                  <span className="text-navy-500">/</span>
                  <span className="truncate font-medium text-navy-700">{activeItem.label}</span>
                </>
              )}
            </div>

            <div className="flex-1" />

            <Link to={user?.kind === 'customer' ? '/app/services' : '/services'} className="btn-ghost btn-sm hidden sm:inline-flex">
              <Search className="size-4" /> جست‌وجوی خدمات
            </Link>

            <ThemeToggle />

            <div className="relative">
              <button
                type="button"
                onClick={() => { setNotificationsOpen((v) => !v); setAccountOpen(false); }}
                className="icon-btn relative"
                aria-label="اعلان‌ها"
                aria-expanded={notificationsOpen}
              >
                <Bell className="size-5" />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 grid min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-surface">
                    {faNum(unread)}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="animate-pop absolute left-0 top-12 w-[21rem] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <span className="text-sm font-semibold text-navy-900">اعلان‌ها</span>
                    {unread > 0 && <button className="text-xs font-medium text-accent hover:underline" onClick={markAllRead}>خواندن همه</button>}
                  </div>
                  <div className="max-h-80 overflow-y-auto scrollbar-thin">
                    {notifications.length === 0 && <p className="px-4 py-8 text-center text-sm text-navy-400">اعلانی ندارید.</p>}
                    {notifications.map((n) => (
                      <Link
                        key={n.id}
                        to={n.link ?? '#'}
                        className={clsx('block border-b border-line px-4 py-3 transition last:border-0 hover:bg-surface-3', !n.readAt && 'bg-brand-50/70')}
                      >
                        <p className="text-sm font-medium text-navy-900">{n.title}</p>
                        {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-navy-500">{n.body}</p>}
                        <p className="mt-1 text-[10px] text-navy-400">{relative(n.createdAt)}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => { setAccountOpen((v) => !v); setNotificationsOpen(false); }}
                className="flex items-center gap-2 rounded-xl border border-line bg-surface py-1.5 pr-1.5 pl-2.5 text-right shadow-xs transition hover:bg-surface-3"
                aria-label="حساب کاربری"
                aria-expanded={accountOpen}
              >
                <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-brand-600 to-shell text-xs font-bold text-white">
                  {user?.fullName?.slice(0, 1) ?? '؟'}
                </span>
                <span className="hidden max-w-28 truncate text-xs font-medium text-navy-800 sm:block">{user?.fullName}</span>
                <ChevronDown className="size-3.5 text-navy-400" />
              </button>

              {accountOpen && (
                <div className="animate-pop absolute left-0 top-12 w-64 overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-2xl">
                  <div className="rounded-xl bg-surface-2 px-3 py-2">
                    <p className="truncate text-sm font-semibold text-navy-900">{user?.fullName}</p>
                    <p className="mt-0.5 truncate text-[11px] text-navy-500">{roleLabel}</p>
                  </div>
                  <p className="px-2 pt-3 pb-1 text-[10px] font-semibold tracking-wide text-navy-400">حالت نمایش</p>
                  <ThemeMenu />
                  <div className="mt-2 border-t border-line pt-2">
                    <Link to={variant === 'customer' ? '/app/profile' : '/staff/shifts'} className="block rounded-lg px-3 py-2 text-sm text-navy-700 hover:bg-surface-3">
                      حساب کاربری
                    </Link>
                    <button
                      type="button"
                      onClick={async () => { await logout(); navigate('/'); }}
                      className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                    >
                      <LogOut className="size-4" /> خروج از حساب
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" className="app-content mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-28 sm:px-6 lg:py-8 lg:pb-10">{children}</main>

        <nav aria-label="دسترسی سریع موبایل" className="mobile-dock fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line px-2 pt-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
          {visibleNav.filter((n) => !n.to.includes('/assistant')).slice(0, 4).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx(
                'relative flex min-h-16 min-w-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] transition',
                isActive ? 'font-bold text-accent' : 'text-navy-500 hover:text-navy-800',
              )}
            >
              {({ isActive }) => (
                <>
                  <span aria-hidden="true" className={clsx('absolute top-0 h-0.5 w-6 rounded-full bg-brand-700 transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
                  {item.icon}
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)} className="flex min-w-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] text-navy-500 transition hover:text-navy-800">
            <Menu className="size-5" /> همه بخش‌ها
          </button>
        </nav>

        <footer className="border-t border-line px-6 py-4 text-center text-xs text-navy-400">
          سامانه جامع دفتر پیشخوان دولت — نسخه {import.meta.env.VITE_APP_VERSION ?? '1.2.0'}
        </footer>
      </div>
    </div>
  );
}

/** Compact light/dark/system picker used inside the account popover. */
function ThemeMenu() {
  const { mode, setMode } = useTheme();
  const options = [
    { value: 'light' as const, label: 'روشن', icon: Sun },
    { value: 'dark' as const, label: 'تیره', icon: Moon },
    { value: 'system' as const, label: 'سیستم', icon: Monitor },
  ];
  return (
    <div role="group" aria-label="حالت نمایش" className="grid grid-cols-3 gap-1">
      {options.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setMode(option.value)}
            className={clsx(
              'flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition',
              active
                ? 'border-primary/40 bg-primary-soft font-semibold text-accent'
                : 'border-line bg-surface text-navy-600 hover:bg-surface-3',
            )}
          >
            <Icon className="size-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- reusable headers ---------------------------- */

export function PageHeader({ title, description, actions, backTo, eyebrow }: {
  title: string; description?: string; actions?: ReactNode; backTo?: string; eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {backTo && (
          <Link to={backTo} className="mb-2 inline-flex items-center gap-1 text-xs text-navy-500 transition hover:text-navy-800">
            <ArrowLeft className="size-3.5 rotate-180" /> بازگشت
          </Link>
        )}
        {eyebrow && <p className="mb-1 text-[11px] font-semibold tracking-wide text-accent">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-navy-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Guard used by protected routes. */
export function RequireRole({ kinds, children, permission, office = false }: { kinds: string[]; children: ReactNode; permission?: string; office?: boolean }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate('/login', { replace: true });
    else if (!kinds.includes(user.kind)) navigate(homeFor(user), { replace: true });
    else if (user.kind === 'customer' && user.profileState?.complete === false && location.pathname !== '/app/profile') navigate('/app/profile', { replace: true });
  }, [user, loading, kinds, navigate, location.pathname]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex items-center gap-2 text-sm text-navy-500"><Spinner /> در حال بررسی دسترسی…</div>
      </div>
    );
  }
  if (!user || !kinds.includes(user.kind)) return null;
  if ((permission && !can(permission)) || (office && !(['super_admin', 'manager', 'accountant'].includes(user.roleCode ?? '')))) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-accent">
          <ShieldCheck className="size-7" />
        </span>
        <h1 className="text-xl font-bold text-navy-900">دسترسی به این بخش مجاز نیست</h1>
        <p className="my-4 text-sm leading-relaxed text-navy-500">امکانات پنل بر اساس نقش و مجوزهای حساب شما نمایش داده می‌شوند.</p>
        <Link className="btn-primary" to={homeFor(user)}>بازگشت به پنل من</Link>
      </div>
    );
  }
  return <>{children}</>;
}

export function QuickActions({ items }: { items: { to: string; label: string; icon?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link key={item.to} to={item.to} className="btn-ghost btn-sm">
          {item.icon ?? <Plus className="size-4" />} {item.label}
        </Link>
      ))}
    </div>
  );
}

export { FileText, Database, ChevronDown };
