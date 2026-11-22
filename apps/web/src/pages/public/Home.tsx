import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { House, LayoutGrid, Newspaper, Sparkles, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { homeFor, useAuth } from '../../lib/auth';
import { ChatWidget } from '../../components/ChatWidget';
import { LandingTopNav } from '../../components/landing/LandingTopNav';
import { LandingAuthModal } from '../../components/landing/LandingAuthModal';
import { LandingPreloader } from '../../components/landing/LandingPreloader';
import { LandingHero } from '../../components/landing/LandingHero';
import {
  LandingCategoryRail,
  LandingServicesSection,
  LandingTicker,
} from '../../components/landing/LandingServices';
import { LandingStatsBand } from '../../components/landing/LandingStatsBand';
import { LandingJourney } from '../../components/landing/LandingJourney';
import { LandingAppSection } from '../../components/landing/LandingAppSection';
import {
  LandingCtaSection,
  LandingFaqSection,
  LandingFeaturesSection,
  LandingFooter,
} from '../../components/landing/LandingFaqCtaFooter';

export function HomePage() {
  const { user } = useAuth();
  const panelLink = homeFor(user);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');

  const openAuth = (tab: 'login' | 'register' = 'login') => {
    setAuthTab(tab);
    setAuthOpen(true);
  };

  const dockLinks: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
    { to: '/', label: 'خانه', icon: <House className="size-5" />, end: true },
    { to: '/services', label: 'خدمات', icon: <LayoutGrid className="size-5" /> },
    { to: '/blog', label: 'بلاگ', icon: <Newspaper className="size-5" /> },
    { to: '/assistant', label: 'دستیار', icon: <Sparkles className="size-5" /> },
  ];

  return (
    <>
      <div className="landing-shell">
        <div className="landing-bg-stage" aria-hidden="true">
          <div className="aurora">
            <div className="aurora-blob a1" />
            <div className="aurora-blob a2" />
            <div className="aurora-blob a3" />
          </div>
          <div className="dot-grid" />
          <div className="grain" />
        </div>

        <LandingPreloader />
        <LandingTopNav onOpenAuth={openAuth} />

        <main id="main-content">
          <LandingHero />
          <LandingTicker />
          <LandingCategoryRail />
          <LandingServicesSection />
          <LandingStatsBand />
          <LandingJourney />
          <LandingAppSection />
          <LandingFeaturesSection />
          <LandingFaqSection />
          <LandingCtaSection />
        </main>

        <LandingFooter />
      </div>

      <LandingAuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialTab={authTab} />

      <nav
        aria-label="دسترسی سریع موبایل"
        className="mobile-dock fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line px-2 pt-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {dockLinks.map((item) => (
          <NavLink
            key={`${item.to}-${item.label}`}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              clsx(
                'relative flex min-h-14 min-w-14 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 text-[10px] transition',
                isActive ? 'bg-primary-soft font-bold text-accent shadow-inner' : 'text-navy-500 hover:text-navy-800',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden="true"
                  className={clsx(
                    'absolute top-0 h-0.5 w-6 rounded-full bg-brand-700 transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {item.icon}
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}

        {user ? (
          <NavLink
            to={panelLink}
            className={({ isActive }) =>
              clsx(
                'relative flex min-h-14 min-w-14 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 text-[10px] transition',
                isActive ? 'bg-primary-soft font-bold text-accent shadow-inner' : 'text-navy-500 hover:text-navy-800',
              )
            }
          >
            <UserRound className="size-5" />
            <span>پنل من</span>
          </NavLink>
        ) : (
          <button
            type="button"
            onClick={() => openAuth('login')}
            className="relative flex min-h-14 min-w-14 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 text-[10px] text-navy-500 transition hover:text-navy-800"
          >
            <UserRound className="size-5" />
            <span>ورود</span>
          </button>
        )}
      </nav>

      <ChatWidget placement="page" />
    </>
  );
}
