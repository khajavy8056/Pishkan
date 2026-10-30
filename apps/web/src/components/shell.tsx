import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, Wallet, MessageSquare, User, Bell, LogOut, Menu, X, Search,
  Building2, Users, CalendarClock, FileText, Receipt, BarChart3, Settings, Database, ShieldCheck,
  LifeBuoy, Shapes, Sparkles, ChevronDown, Plus, BadgeCheck, ServerCog, ClipboardCheck, ArrowLeft,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth,homeFor } from '../lib/auth';
import { api } from '../lib/api';
import { relative, faNum } from '../lib/format';
import { Button, Spinner } from './ui';

export interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; permission?: string; badgeKey?: string }

const customerNav: NavItem[] = [
  { to: '/app', label: 'داشبورد', icon: <LayoutDashboard className="size-5" />, end: true },
  { to: '/app/services', label: 'خدمات', icon: <Shapes className="size-5" /> },
  { to: '/app/requests', label: 'درخواست‌های من', icon: <ClipboardList className="size-5" /> },
  { to: '/app/invoices', label: 'فاکتورها و پرداخت', icon: <Wallet className="size-5" /> },
  { to: '/app/offers', label: 'پیشنهادهای اختصاصی', icon: <Sparkles className="size-5" /> },
  { to: '/app/messages', label: 'پیام‌ها', icon: <MessageSquare className="size-5" /> },
  { to: '/app/profile', label: 'پروفایل', icon: <User className="size-5" /> },
  { to: '/assistant', label: 'دستیار هوشمند', icon: <LifeBuoy className="size-5" /> },
];

const staffNav: NavItem[] = [
  { to: '/staff', label: 'میز کار من', icon: <LayoutDashboard className="size-5" />, end: true },
  {to:'/staff/automation',label:'کارتابل و ارجاعات',icon:<ClipboardCheck className="size-5" />,permission:'requests.view'},
  { to: '/staff/requests', label: 'درخواست‌ها', icon: <ClipboardList className="size-5" />, permission: 'requests.view' },
  { to: '/staff/documents', label: 'بررسی مدارک', icon: <ClipboardCheck className="size-5" />, permission: 'documents.view' },
  { to: '/staff/customers', label: 'مشتریان', icon: <Users className="size-5" />, permission: 'customers.view' },
  { to: '/staff/custom-services', label: 'خدمت اختصاصی', icon: <Sparkles className="size-5" />, permission: 'services.create' },
  { to: '/staff/messages', label: 'پیام‌ها', icon: <MessageSquare className="size-5" />, permission: 'messages.view' },
  { to: '/staff/shifts', label: 'شیفت و حضور', icon: <CalendarClock className="size-5" /> },
  { to: '/staff/finance', label: 'حقوق و سهم من', icon: <Receipt className="size-5" /> },
  { to: '/staff/queue',label:'صف پذیرش',icon:<ClipboardList className="size-5" />,permission:'requests.view' },
];

const accountantNav: NavItem[] = [
 {to:'/staff/accounting',label:'حسابداری دفتر',icon:<Wallet className="size-5" />,permission:'invoices.view'},
 {to:'/staff/reports',label:'گزارش‌های مالی',icon:<BarChart3 className="size-5" />,permission:'reports.view'},
 {to:'/staff/payroll',label:'حقوق و تسویه کارکنان',icon:<Receipt className="size-5" />,permission:'invoices.view'},
];
const adminNav: NavItem[] = [
  {to:'/admin/automation',label:'کارتابل تأیید و ارجاع',icon:<ClipboardCheck className="size-5" />,permission:'requests.view'},
  { to: '/admin', label: 'داشبورد مدیریت', icon: <LayoutDashboard className="size-5" />, end: true },
  { to: '/admin/requests', label: 'درخواست‌ها', icon: <ClipboardList className="size-5" />, permission: 'requests.view' },
  { to: '/admin/services', label: 'خدمات و دسته‌ها', icon: <Shapes className="size-5" />, permission: 'services.view' },
  { to: '/admin/customers', label: 'مشتریان', icon: <Users className="size-5" />, permission: 'customers.view' },
  { to: '/admin/staff', label: 'کارکنان و نقش‌ها', icon: <BadgeCheck className="size-5" />, permission: 'staff.view' },
  { to: '/admin/shifts', label: 'شیفت و حضور', icon: <CalendarClock className="size-5" />, permission: 'shifts.view' },
  { to: '/admin/messages', label: 'گفت‌وگوها', icon: <MessageSquare className="size-5" />, permission: 'messages.view' },
  { to: '/admin/finance', label: 'حسابداری', icon: <Wallet className="size-5" />, permission: 'invoices.view' },
  { to: '/admin/payroll',label:'حقوق و سهم کارکنان',icon:<Users className="size-5" />,permission:'invoices.view' },
  { to: '/admin/reports', label: 'گزارش‌ها', icon: <BarChart3 className="size-5" />, permission: 'reports.view' },
  { to: '/admin/settings', label: 'تنظیمات سامانه', icon: <Settings className="size-5" />, permission: 'settings.view' },
  { to: '/admin/system', label: 'زیرساخت', icon: <ServerCog className="size-5" />, permission: 'system.view' },
  { to: '/admin/audit', label: 'تاریخچه عملیات', icon: <ShieldCheck className="size-5" />, permission: 'audit.view' },
];

export function navFor(kind: string) {
  return kind === 'customer' ? customerNav : kind === 'admin' ? adminNav : staffNav;
}

export function AppShell({ children, variant }: { children: ReactNode; variant: 'customer' | 'staff' | 'admin' }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  const nav = useMemo(() => {
    const list=navFor(user?.kind==='admin'?'admin':variant==='customer'?'customer':'staff');
    return user?.roleCode==='accountant'?[...accountantNav,...staffNav.filter(n=>!['/staff/custom-services','/staff/queue'].includes(n.to))]:list;
  }, [variant,user?.kind,user?.roleCode]);
  const visibleNav = nav.filter((item) => !item.permission || can(item.permission));

  useEffect(() => {
    setOpen(false);
    setNotificationsOpen(false);
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

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar */}
      <aside
        className={clsx(
          'app-sidebar fixed inset-y-0 right-0 z-40 flex w-64 shrink-0 flex-col bg-navy-900 text-white transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <Link to={brandHome} className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-600 font-black">پ</span>
            <span>
              <span className="block text-sm font-bold">دفتر پیشخوان</span>
              <span className="block text-[11px] text-navy-300">
                {user?.roleName ?? (variant === 'customer' ? 'پنل مشتریان' : 'پنل کارکنان')}
              </span>
            </span>
          </Link>
          <button className="rounded-lg p-2 text-navy-300 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="بستن منو">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active')}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="rounded-xl bg-white/5 p-3">
            <p className="truncate text-sm font-medium">{user?.fullName || 'کاربر'}</p>
            <p className="mt-0.5 truncate text-[11px] text-navy-300">
              {user?.roleName ?? (user?.kind === 'customer' ? 'مشتری' : 'کارمند')}
              {user?.mobile ? ` • ${user.mobile}` : ''}
            </p>
            <div className="mt-3 flex gap-2">
              <Link to={variant === 'customer' ? '/app/profile' : '/staff/shifts'} className="btn-ghost btn-sm flex-1 justify-center bg-white/10 text-white ring-white/10 hover:bg-white/20">
                <User className="size-3.5" /> حساب
              </Link>
              <button
                type="button"
                onClick={async () => { await logout(); navigate('/'); }}
                className="btn-ghost btn-sm flex-1 justify-center bg-white/10 text-white ring-white/10 hover:bg-rose-500/80"
              >
                <LogOut className="size-3.5" /> خروج
              </button>
            </div>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-navy-950/50 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-navy-900/8 bg-white/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button className="rounded-xl p-2 text-navy-700 hover:bg-navy-50 lg:hidden" onClick={() => setOpen(true)} aria-label="باز کردن منو">
              <Menu className="size-5" />
            </button>

            <Link to="/" className="hidden items-center gap-2 text-sm text-navy-500 hover:text-navy-800 sm:flex">
              <Building2 className="size-4" /> صفحه اصلی سامانه
            </Link>

            <div className="flex-1" />

            <Link to={user?.kind==='customer'?'/app/services':'/services'} className="btn-ghost btn-sm hidden sm:inline-flex">
              <Search className="size-4" /> جست‌وجوی خدمات
            </Link>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((v) => !v)}
                className="relative rounded-xl p-2 text-navy-700 hover:bg-navy-50"
                aria-label="اعلان‌ها"
              >
                <Bell className="size-5" />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 grid min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                    {faNum(unread)}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="animate-pop absolute left-0 top-12 w-80 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-navy-900/10">
                  <div className="flex items-center justify-between border-b border-navy-900/8 px-4 py-3">
                    <span className="text-sm font-semibold text-navy-900">اعلان‌ها</span>
                    {unread > 0 && <button className="text-xs text-brand-700 hover:underline" onClick={markAllRead}>خواندن همه</button>}
                  </div>
                  <div className="max-h-80 overflow-y-auto scrollbar-thin">
                    {notifications.length === 0 && <p className="px-4 py-6 text-center text-sm text-navy-400">اعلانی ندارید.</p>}
                    {notifications.map((n) => (
                      <Link
                        key={n.id}
                        to={n.link ?? '#'}
                        className={clsx('block border-b border-navy-900/5 px-4 py-3 hover:bg-navy-50/60', !n.readAt && 'bg-brand-50/40')}
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

            <div className="hidden items-center gap-2 rounded-xl bg-navy-50 px-3 py-1.5 sm:flex">
              <span className="grid size-7 place-items-center rounded-lg bg-navy-900 text-xs font-bold text-white">
                {user?.fullName?.slice(0, 1) ?? '؟'}
              </span>
              <span className="max-w-32 truncate text-xs font-medium text-navy-800">{user?.fullName}</span>
            </div>
          </div>
        </header>

        <main className="app-content mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 sm:px-6 lg:py-8">{children}</main>

        <nav aria-label="دسترسی سریع موبایل" className="mobile-dock fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-navy-100 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">{visibleNav.filter(n=>!n.to.includes('/assistant')).slice(0,4).map(n=><NavLink key={n.to} to={n.to} end={n.end} className={({isActive})=>clsx('flex min-h-16 min-w-14 flex-col items-center justify-center gap-1 text-[10px]',isActive?'font-bold text-brand-700':'text-navy-500')}>{n.icon}<span>{n.label}</span></NavLink>)}<button onClick={()=>setOpen(true)} className="flex min-w-14 flex-col items-center justify-center gap-1 text-[10px] text-navy-500"><Menu className="size-5" />همه بخش‌ها</button></nav>
        <footer className="border-t border-navy-900/8 px-6 py-4 text-center text-xs text-navy-400">
          سامانه جامع دفتر پیشخوان دولت — نسخه {import.meta.env.VITE_APP_VERSION ?? '1.0.0'}
        </footer>
      </div>
    </div>
  );
}

/* ----------------------------- reusable headers ---------------------------- */

export function PageHeader({ title, description, actions, backTo }: {
  title: string; description?: string; actions?: ReactNode; backTo?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {backTo && (
          <Link to={backTo} className="mb-2 inline-flex items-center gap-1 text-xs text-navy-500 hover:text-navy-800">
            <ArrowLeft className="size-3.5 rotate-180" /> بازگشت
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-navy-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Guard used by protected routes. */
export function RequireRole({ kinds, children,permission,office=false }: { kinds: string[]; children: ReactNode;permission?:string;office?:boolean }) {
  const { user, loading,can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate('/login', { replace: true });
    else if (!kinds.includes(user.kind)) navigate(homeFor(user), { replace: true });
    else if (user.kind === 'customer' && user.profileState?.complete === false && location.pathname !== '/app/profile') navigate('/app/profile', {replace:true});
  }, [user, loading, kinds, navigate, location.pathname]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex items-center gap-2 text-sm text-navy-500"><Spinner /> در حال بررسی دسترسی…</div>
      </div>
    );
  }
  if (!user || !kinds.includes(user.kind)) return null;
  if((permission&&!can(permission))||(office&&!(['super_admin','manager','accountant'].includes(user.roleCode??''))))return <div className="mx-auto max-w-lg p-8 text-center"><ShieldCheck className="mx-auto mb-4 size-12 text-brand-700" /><h1 className="text-xl font-bold">دسترسی به این بخش مجاز نیست</h1><p className="my-4 text-sm text-navy-500">امکانات پنل بر اساس نقش و مجوزهای حساب شما نمایش داده می‌شوند.</p><Link className="btn-primary" to={homeFor(user)}>بازگشت به پنل من</Link></div>;
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
