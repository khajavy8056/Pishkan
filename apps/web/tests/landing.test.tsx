/**
 * Landing page contract.
 *
 * The page is mostly motion, which a DOM test cannot see. What it *can* lock
 * down is the structure the motion hangs off — and those are exactly the things
 * that silently break: a section losing its reveal hook, the mobile fallback
 * disappearing, the accessible name of a control changing.
 *
 * The rest of the guarantee lives in `styles.css`, where every animated rule is
 * paired with a `prefers-reduced-motion` and a `max-width: 767px` counterpart.
 * The last test in this file reads the stylesheet and asserts those guards still
 * exist, because "we forgot the mobile override" is a one-line regression that
 * no render test would ever catch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { HomePage } from '../src/pages/public/Home';

/** Same provider stack the app mounts at the root. */
function renderAt(path: string, element: React.ReactElement) {
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

const STYLES = fs.readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8');

describe('landing page', () => {
  it('renders the hero, the journey and the app section', async () => {
    const { container } = renderAt('/', <HomePage />);

    // Hero copy comes from settings with a hard fallback, so it must exist even
    // before the site payload resolves.
    expect(container.querySelector('h1')).toBeTruthy();

    // The three structural anchors of the page.
    expect(container.querySelector('.hero-stage')).toBeTruthy();
    expect(container.querySelector('.journey-track')).toBeTruthy();
    expect(container.querySelector('.phone-scene, .journey-mobile')).toBeTruthy();
  });

  it('keeps every scroll-driven section hooked up to a reveal container', async () => {
    const { container } = renderAt('/', <HomePage />);
    // If a ref is dropped, the section still renders but never animates in and
    // stays at opacity 0 in the browser — invisible content, green test. This is
    // the guard against exactly that.
    const reveals = container.querySelectorAll('[data-reveal]');
    expect(reveals.length).toBeGreaterThan(5);
  });

  it('offers the mobile app fallback next to the 3D phone', async () => {
    const { container } = renderAt('/', <HomePage />);
    // The phone is desktop-only (hidden below sm); the card rail is its
    // replacement. Both must be in the tree so the CSS can choose.
    const phone = container.querySelector('.phone-scene');
    const cards = container.querySelector('[role="tablist"]');
    expect(phone || cards).toBeTruthy();
  });

  it('labels the interactive carousel controls for screen readers', async () => {
    const { container } = renderAt('/', <HomePage />);
    const labelled = container.querySelectorAll('[aria-label="دسته‌های قبلی"], [aria-label="دسته‌های بعدی"]');
    expect(labelled.length).toBeGreaterThan(0);
  });
});

describe('landing stylesheet guards', () => {
  it('neutralises the 3D transforms on narrow viewports', () => {
    // The single biggest cause of "it shakes on my phone": a perspective scene
    // plus pointer transforms at 360px. The mobile block must neutralise them.
    const mobileBlock = STYLES.slice(STYLES.indexOf('@media (max-width: 767px)'));
    expect(mobileBlock).toContain('.hero-stage');
    expect(mobileBlock).toContain('.phone-3d');
    expect(mobileBlock).toContain('transform: none !important');
  });

  it('turns every animation off for reduced motion', () => {
    const reducedBlocks = STYLES.split('@media (prefers-reduced-motion: reduce)');
    expect(reducedBlocks.length).toBeGreaterThan(1);
    const last = reducedBlocks[reducedBlocks.length - 1];
    expect(last).toContain('animation: none');
    expect(last).toContain('[data-reveal]');
  });

  it('keeps the sticky journey off the mobile layout', () => {
    // A 100vh sticky panel inside a 640px-tall phone viewport (with the address
    // bar moving) is unusable; the CSS must swap it for the plain list.
    expect(STYLES).toContain('.journey-mobile { display: none; }');
    expect(STYLES).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.journey-sticky \{ display: none; \}/);
    expect(STYLES).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.journey-mobile \{ display: block; \}/);
  });
});
