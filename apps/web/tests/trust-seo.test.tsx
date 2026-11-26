/**
 * Public SEO + Enamad trust seal contract.
 *
 * Verifies that the analytics bootstrap only loads for validated IDs, that
 * search-console verification meta tags are injected/cleaned, and that the
 * Enamad badge renders only when enabled with a sanitized snippet. These are
 * the browser-side half of the SEO hardening; the API half (CSP extension,
 * analytics.js content, sanitizer) is covered by apps/api/tests/seo.test.ts.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SiteContext } from '../src/lib/site';
import { PublicSeoExtras, EnamadBadge } from '../src/lib/trust-seo';

function renderWith(settings: Record<string, string>, element: React.ReactElement) {
  return render(
    <SiteContext.Provider
      value={{
        site: { version: 't', settings, categories: [], popularServices: [] } as never,
        loading: false,
        reload: async () => {},
        setting: (key: string) => settings[key] ?? '',
      }}
    >
      <MemoryRouter>{element}</MemoryRouter>
    </SiteContext.Provider>,
  );
}

afterEach(() => {
  // Remove anything the components injected so tests stay isolated.
  document.head.querySelectorAll('[data-seo-managed], [data-pishkan-analytics]').forEach((el) => el.remove());
});

const SANITIZED_ENAMAD =
  '<a href="https://trustseal.enamad.ir/?id=12345&Code=abcdef" referrerpolicy="origin" target="_blank" rel="noopener noreferrer">' +
  '<img src="https://logo.enamad.ir/Logo.aspx?id=12345" alt="نماد اعتماد الکترونیکی" style="width:125px;height:125px;border:none" loading="lazy" referrerpolicy="origin"></a>';

describe('EnamadBadge', () => {
  it('renders the sanitized seal only when enabled and non-empty', () => {
    const { container, rerender } = renderWith(
      { 'site.enamad_enabled': 'true', 'site.enamad_code': SANITIZED_ENAMAD },
      <EnamadBadge />,
    );
    const link = container.querySelector('a[href*="trustseal.enamad.ir"]');
    expect(link).toBeTruthy();
    expect(container.querySelector('img[src*="logo.enamad.ir"]')).toBeTruthy();
    // The stored value is server-sanitized; no script/handler can be present.
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('onerror');

    // Disabled → nothing renders.
    rerender(
      <SiteContext.Provider value={{ site: { settings: {} } as never, loading: false, reload: async () => {}, setting: () => '' }}>
        <MemoryRouter><EnamadBadge /></MemoryRouter>
      </SiteContext.Provider>,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders nothing when enabled but the code is empty', () => {
    const { container } = renderWith({ 'site.enamad_enabled': 'true', 'site.enamad_code': '' }, <EnamadBadge />);
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('PublicSeoExtras', () => {
  it('injects verification meta tags and removes them on unmount', async () => {
    const { unmount } = renderWith(
      { 'seo.google_site_verification': 'google-token-abc', 'seo.bing_site_verification': 'bing-token-xyz' },
      <PublicSeoExtras />,
    );
    await waitFor(() => {
      expect(document.head.querySelector('meta[name="google-site-verification"]')?.getAttribute('content')).toBe('google-token-abc');
      expect(document.head.querySelector('meta[name="msvalidate.01"]')?.getAttribute('content')).toBe('bing-token-xyz');
    });
    unmount();
    expect(document.head.querySelector('meta[name="google-site-verification"]')).toBeNull();
    expect(document.head.querySelector('meta[name="msvalidate.01"]')).toBeNull();
  });

  it('loads the self-hosted analytics script only for a valid GA/GTM id', async () => {
    const { unmount } = renderWith({ 'seo.ga_measurement_id': 'G-ABC1234567' }, <PublicSeoExtras />);
    await waitFor(() => {
      const script = document.head.querySelector('script[data-pishkan-analytics]') as HTMLScriptElement | null;
      expect(script).toBeTruthy();
      expect(script!.src).toContain('/api/public/analytics.js');
    });
    unmount();
    expect(document.head.querySelector('script[data-pishkan-analytics]')).toBeNull();
  });

  it('does not load analytics when no valid id is configured', async () => {
    renderWith({ 'seo.ga_measurement_id': '', 'seo.gtm_container_id': 'not-valid' }, <PublicSeoExtras />);
    // Give any effect a chance to run, then assert nothing was injected.
    await new Promise((r) => setTimeout(r, 30));
    expect(document.head.querySelector('script[data-pishkan-analytics]')).toBeNull();
  });

  it('prefers GTM when both ids are valid (no double counting)', async () => {
    renderWith({ 'seo.ga_measurement_id': 'G-ABC1234567', 'seo.gtm_container_id': 'GTM-XYZ123' }, <PublicSeoExtras />);
    await waitFor(() => {
      const scripts = document.head.querySelectorAll('script[data-pishkan-analytics]');
      expect(scripts.length).toBe(1); // exactly one bootstrap, server decides GA vs GTM
    });
  });
});
