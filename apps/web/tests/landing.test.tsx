/**
 * Landing page contract.
 *
 * Verifies the structural anchors, backend/context wiring, accessibility
 * attributes, fail-open scroll reveals, mobile/reduced-motion CSS guards, and
 * Android install route behavior of the redesigned landing page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteContext, SiteProvider } from '../src/lib/site';
import { ThemeProvider } from '../src/lib/theme';
import { ToastProvider } from '../src/components/ui';
import { HomePage } from '../src/pages/public/Home';
import { AppStoreButtons } from '../src/components/app-store-buttons';

function renderAt(routePath: string, element: React.ReactElement) {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <SiteProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={[routePath]}>{element}</MemoryRouter>
          </ToastProvider>
        </SiteProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

function renderWithSettings(overrides: Record<string, string>) {
  const base = { ...BOOTSTRAP_SETTINGS };
  return render(
    <ThemeProvider>
      <AuthProvider>
        <SiteContext.Provider
          value={{
            site: { ...BOOTSTRAP_SITE, settings: { ...base, ...overrides } } as never,
            loading: false,
            reload: async () => {},
            setting: (key: string) => {
              const value = (overrides[key] ?? base[key]) as unknown;
              return value === undefined || value === null ? '' : String(value);
            },
          }}
        >
          <ToastProvider>
            <MemoryRouter initialEntries={['/']}>
              <HomePage />
            </MemoryRouter>
          </ToastProvider>
        </SiteContext.Provider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

const BOOTSTRAP_SETTINGS: Record<string, string> = {
  'site.name': 'دفتر پیشخوان دولت',
  'site.short_name': 'پیشخوان',
  'office.name': 'دفتر پیشخوان مرکزی',
};
const BOOTSTRAP_SITE = {
  version: '1.0.0-test',
  settings: BOOTSTRAP_SETTINGS,
  categories: [],
  popularServices: [],
  stats: { services: 10, customers: 100, completedRequests: 42 },
};

const STYLES = fs.readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8');
const LANDING_STYLES = fs.readFileSync(path.resolve(__dirname, '../src/styles/landing.css'), 'utf8');

describe('landing page', () => {
  it('renders the hero, aurora shell, 5-layer journey stack and app section', async () => {
    const { container } = renderAt('/', <HomePage />);

    expect(container.querySelector('.landing-shell')).toBeTruthy();
    expect(container.querySelector('.aurora')).toBeTruthy();
    expect(container.querySelector('h1.hero-title')).toBeTruthy();
    expect(container.querySelector('.hero-media-frame img')).toBeTruthy();
    expect(container.querySelector('.journey-track')).toBeTruthy();
    expect(container.querySelector('.phone')).toBeTruthy();
  });

  it('assembles the request journey out of five paper layers and steps', async () => {
    const { container } = renderAt('/', <HomePage />);
    const papers = container.querySelectorAll('.paper-layer');
    expect(papers.length).toBe(5);
    const steps = container.querySelectorAll('.step-item');
    expect(steps.length).toBe(5);
    expect(container.querySelector('.journey-mobile-rail')).toBeTruthy();
    expect(container.textContent).toContain('تحویل نهایی و گواهی دیجیتال');
  });

  it('keeps every scroll-driven section hooked up to a reveal container', async () => {
    const { container } = renderAt('/', <HomePage />);
    const reveals = container.querySelectorAll('[data-reveal]');
    expect(reveals.length).toBeGreaterThan(5);
  });

  it('marks the hero search as a combobox backed by public search and can dismiss it', async () => {
    const { container } = renderAt('/', <HomePage />);
    const input = container.querySelector('input[aria-label="جست‌وجوی خدمات"]')!;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');

    fireEvent.change(input, { target: { value: 'بیمه' } });
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'), { timeout: 2000 });
    expect(container.querySelector('#hero-search-results')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'));
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('shows an honest empty state when categories or popular services are empty', async () => {
    const { container } = renderWithSettings({});
    await waitFor(() => expect(container.querySelector('h1')).toBeTruthy());
    const servicesSection = container.querySelector('[aria-label="خدمات پرکاربرد"]');
    expect(servicesSection).toBeTruthy();
    expect(servicesSection!.textContent).toContain('هنوز خدمتی در فهرست پرکاربرد منتشر نشده است');
  });

  it('offers all three Android install routes on the landing page', async () => {
    const { container } = renderAt('/', <HomePage />);
    const cards = container.querySelectorAll('.install-card');
    expect(cards.length).toBe(3);
    const labels = Array.from(cards).map((el) => el.textContent ?? '');
    expect(labels.some((t) => t.includes('دانلود مستقیم'))).toBe(true);
    expect(labels.some((t) => t.includes('کافه‌بازار'))).toBe(true);
    expect(labels.some((t) => t.includes('مایکت'))).toBe(true);
    cards.forEach((el) => {
      expect(el.tagName).toBe('SPAN');
      expect(el.getAttribute('aria-disabled')).toBe('true');
      expect(el.textContent).toContain('به‌زودی');
    });
  });

  it('turns landing install cards into real external links once URLs are configured', async () => {
    const { container } = renderWithSettings({
      'landing.app_android_url': 'https://example.ir/app.apk',
      'landing.app_bazaar_url': 'https://cafebazaar.ir/app/pishkan',
      'landing.app_myket_url': '',
    });
    const anchors = container.querySelectorAll('a.install-card');
    expect(anchors.length).toBe(2);
    expect(anchors[0].getAttribute('href')).toBe('https://example.ir/app.apk');
    expect(anchors[1].getAttribute('href')).toBe('https://cafebazaar.ir/app/pishkan');
    const soon = container.querySelectorAll('span.install-card');
    expect(soon.length).toBe(1);
    expect(soon[0].textContent).toContain('مایکت');
  });

  it('keeps shared AppStoreButtons working across direct, Bazaar and Myket routes', async () => {
    const { container, rerender } = render(
      <AppStoreButtons
        links={{ direct: 'https://example.ir/app.apk', bazaar: 'https://cafebazaar.ir/app/x', myket: '' }}
      />,
    );
    const anchors = container.querySelectorAll('a.app-store-btn');
    expect(anchors.length).toBe(2);
    expect(anchors[0].getAttribute('href')).toBe('https://example.ir/app.apk');
    expect(anchors[1].getAttribute('href')).toBe('https://cafebazaar.ir/app/x');
    const soon = container.querySelectorAll('span.app-store-btn');
    expect(soon.length).toBe(1);
    expect(soon[0].textContent).toContain('مایکت');

    rerender(<AppStoreButtons links={{ direct: 'https://example.ir/app.apk', showComingSoon: false }} />);
    expect(container.querySelectorAll('.app-store-btn').length).toBe(1);
  });

  it('labels the interactive category rail controls for screen readers', async () => {
    const { container } = renderAt('/', <HomePage />);
    const labelled = container.querySelectorAll('[aria-label="دسته‌های قبلی"], [aria-label="دسته‌های بعدی"]');
    expect(labelled.length).toBeGreaterThan(0);
  });

  it('renders the FAQ as native disclosure widgets the office can edit', async () => {
    const faq = [
      { q: 'چطور درخواست ثبت کنم؟', a: 'از دکمهٔ ثبت درخواست شروع کنید.' },
      { q: 'وضعیتم را کجا ببینم؟', a: 'در فهرست درخواست‌ها.' },
    ];
    const { container } = renderWithSettings({ 'landing.faq': JSON.stringify(faq) });
    await waitFor(() => expect(container.querySelectorAll('details')).toHaveLength(2));
    const details = Array.from(container.querySelectorAll('details'));
    expect(details[0].querySelector('summary')?.textContent).toContain('چطور درخواست ثبت کنم؟');
    expect(details[0].textContent).toContain('از دکمهٔ ثبت درخواست شروع کنید.');
  });

  it('hides the FAQ section entirely when the office clears it', async () => {
    const { container } = renderWithSettings({ 'landing.faq': '[]' });
    await waitFor(() => expect(container.querySelector('h1')).toBeTruthy());
    expect(container.querySelectorAll('details')).toHaveLength(0);
  });

  it('honours landing.show_stats and landing.show_app_section toggles', async () => {
    const { container } = renderWithSettings({
      'landing.show_stats': 'false',
      'landing.show_app_section': 'false',
    });
    await waitFor(() => expect(container.querySelector('h1')).toBeTruthy());
    expect(container.querySelector('.stat-grid')).toBeNull();
    expect(container.querySelector('#app')).toBeNull();
  });

  it('gives every reveal-driven block a container that can observe it', async () => {
    const { container } = renderAt('/', <HomePage />);
    await screen.findByRole('heading', { level: 1 });
    const hidden = Array.from(container.querySelectorAll('[data-reveal]'))
      .filter((el) => !el.classList.contains('is-in'))
      .map((el) => (el.textContent || '').trim().slice(0, 40) || el.className.slice(0, 40));
    expect(hidden).toEqual([]);
    expect(container.querySelector('.reveal-armed')).toBeNull();
  });

  it('wires the theme switcher in the header to light, dark and system modes', async () => {
    renderAt('/', <HomePage />);
    const darkBtn = screen.getByRole('button', { name: 'تیره' });
    fireEvent.click(darkBtn);
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('neutralises 3D perspective on narrow viewports', () => {
    const mobileBlock = LANDING_STYLES.slice(LANDING_STYLES.indexOf('@media (max-width: 767px)'));
    expect(mobileBlock).toContain('.device-scene');
    expect(mobileBlock).toContain('.card-3d');
    expect(mobileBlock).toContain('transform: none !important');
  });

  it('turns every animation off for reduced motion', () => {
    expect(STYLES).toContain('@media (prefers-reduced-motion: reduce)');
    expect(LANDING_STYLES).toContain('@media (prefers-reduced-motion: reduce)');
    expect(LANDING_STYLES).toContain('animation: none !important');
    expect(STYLES).toContain('[data-reveal]');
  });

  it('never hides a revealed element unless the observer is actually armed', () => {
    const baseRule = STYLES.match(/\[data-reveal\] \{([^}]*)\}/)?.[1] ?? '';
    expect(baseRule).not.toMatch(/opacity:\s*0/);
    expect(STYLES).toContain('.reveal-armed [data-reveal]:not(.is-in)');
    const bareHidden = [...STYLES.matchAll(/(?:^|})\s*\[data-reveal[^{]*\{([^}]*)\}/g)]
      .filter((m) => /opacity:\s*0(?!\.)/.test(m[1]) && !m[0].includes('reveal-armed'));
    expect(bareHidden).toHaveLength(0);
  });

  it('keeps the sticky 3D journey off the mobile layout and enables the mobile rail', () => {
    expect(LANDING_STYLES).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.landing-shell \.journey-mobile-rail \{ display: block; \}/);
    expect(LANDING_STYLES).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.landing-shell \.journey-track \{ height: auto; \}/);
    expect(LANDING_STYLES).toContain('overflow-x: clip');
  });

  it('opens the floating auth modal from the landing header and closes on Escape', async () => {
    const { container } = renderAt('/', <HomePage />);
    await screen.findByRole('heading', { level: 1 });
    const loginTrigger = container.querySelector('header button[aria-label="ورود"]') as HTMLButtonElement;
    expect(loginTrigger).toBeTruthy();

    fireEvent.click(loginTrigger);
    const dialog = await screen.findByRole('dialog', { name: 'ورود و ثبت‌نام' });
    expect(dialog).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ورود و ثبت‌نام' })).toBeNull());
  });

  it('uses real server service and category images and never renders emoji icons', async () => {
    const { container } = renderAt('/', <HomePage />);
    await waitFor(() => expect(container.querySelectorAll('.svc-card').length).toBeGreaterThan(0));
    const serviceImages = container.querySelectorAll('.svc-card img');
    expect(serviceImages.length).toBeGreaterThan(0);
    const svcTexts = Array.from(container.querySelectorAll('.svc-card')).map((el) => el.textContent ?? '');
    for (const text of svcTexts) {
      expect(text).not.toMatch(/[\p{Extended_Pictographic}]/u);
    }
  });
});
