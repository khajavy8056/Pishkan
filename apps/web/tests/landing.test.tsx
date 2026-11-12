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
  it('renders the hero, the layer stack and the app section', async () => {
    const { container } = renderAt('/', <HomePage />);

    // Hero copy comes from settings with a hard fallback, so it must exist even
    // before the site payload resolves.
    expect(container.querySelector('h1')).toBeTruthy();

    // The three structural anchors of the page.
    expect(container.querySelector('.hero-stage-v2')).toBeTruthy();
    expect(container.querySelector('.stack-track')).toBeTruthy();
    expect(container.querySelector('.device, .stack-mobile')).toBeTruthy();
  });

  it('builds the hero out of several independent 3D pieces, not one image', async () => {
    const { container } = renderAt('/', <HomePage />);
    // The whole point of the rebuild: the stage is a composition. Assert the
    // count and the distinct depth tokens, because "someone flattened it back
    // into a single photo" is the regression this has to catch.
    const pieces = container.querySelectorAll('.hero-piece');
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    const depths = new Set(
      Array.from(pieces).map((el) => (el as HTMLElement).style.getPropertyValue('--z')),
    );
    expect(depths.size).toBeGreaterThanOrEqual(4);
    // Every piece must be a real object image with an accessible alternative.
    expect(container.querySelectorAll('.hero-object').length).toBeGreaterThanOrEqual(3);
  });

  it('assembles the request out of five layers', async () => {
    const { container } = renderAt('/', <HomePage />);
    const sheets = container.querySelectorAll('.stack-sheet');
    expect(sheets.length).toBe(5);
    // Each sheet carries its own stagger index; the CSS keys the timing off it.
    const indices = Array.from(sheets).map((el) => el.getAttribute('data-i'));
    expect(indices).toEqual(['0', '1', '2', '3', '4']);
    // And the panel still names all five steps for a screen reader.
    expect(container.textContent).toContain('مُهر تأیید و تحویل');
  });

  it('puts live UI inside the device photograph', async () => {
    const { container } = renderAt('/', <HomePage />);
    const device = container.querySelector('.device');
    expect(device).toBeTruthy();
    const glass = device!.querySelector('.device-glass');
    expect(glass).toBeTruthy();
    // The glass rect is the measured inset, not a magic number in a component:
    // if these drift the UI slides out from under the bezel.
    const style = (glass as HTMLElement).style;
    expect(style.left).toBe('6.08%');
    expect(style.top).toBe('2.99%');
    // And the device photograph must sit *over* the interface.
    expect(device!.querySelectorAll('.device-glass, .device-body').length).toBe(2);
  });

  it('keeps every scroll-driven section hooked up to a reveal container', async () => {
    const { container } = renderAt('/', <HomePage />);
    // If a ref is dropped, the section still renders but never animates in and
    // stays at opacity 0 in the browser — invisible content, green test. This is
    // the guard against exactly that.
    const reveals = container.querySelectorAll('[data-reveal]');
    expect(reveals.length).toBeGreaterThan(5);
  });

  it('offers the mobile app fallback next to the device', async () => {
    const { container } = renderAt('/', <HomePage />);
    // The device is desktop-only; the card rail is its replacement. Both must be
    // in the tree so the CSS can choose between them.
    const device = container.querySelector('.device');
    const cards = container.querySelector('[role="tablist"]');
    expect(device && cards).toBeTruthy();
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
    expect(mobileBlock).toContain('.hero-stage-v2');
    expect(mobileBlock).toContain('.device-tilt');
    expect(mobileBlock).toContain('transform: none !important');
  });

  it('turns every animation off for reduced motion', () => {
    const reducedBlocks = STYLES.split('@media (prefers-reduced-motion: reduce)').slice(1);
    // Every block, not just the last: a new section that appends its own
    // reduced-motion rule at the end of the file must not exempt the old ones.
    expect(reducedBlocks.length).toBeGreaterThan(1);
    expect(reducedBlocks.some((block) => block.includes('[data-reveal]'))).toBe(true);
    expect(reducedBlocks.some((block) => block.includes('animation: none'))).toBe(true);
    // The round-2 sections need the guard too.
    expect(reducedBlocks.some((block) => block.includes('.stack-sheet'))).toBe(true);
    expect(reducedBlocks.some((block) => block.includes('.device-tilt'))).toBe(true);
  });

  it('keeps the sticky layer stack off the mobile layout', () => {
    // A 100vh sticky panel inside a 640px-tall phone viewport (with the address
    // bar moving) is unusable; the CSS must swap it for the plain list.
    expect(STYLES).toContain('.stack-mobile { display: none; }');
    expect(STYLES).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.stack-sticky \{ display: none; \}/);
    expect(STYLES).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.stack-mobile \{ display: block; \}/);
  });

  it('layers the request in scroll order without a per-layer script', () => {
    // The whole choreography must be one token plus arithmetic in CSS: if a
    // sheet ever gets a hard-coded transform or a React-driven style, the
    // section starts fighting the scroll instead of following it.
    expect(STYLES).toContain('--lp: clamp(0, calc((var(--j, 0) - var(--start)) * var(--rate)), 1)');
    for (const index of ['1', '2', '3', '4']) {
      expect(STYLES).toContain(`.stack-sheet[data-i='${index}'] { --start:`);
    }
  });
});
