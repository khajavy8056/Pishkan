import { useEffect } from 'react';
import clsx from 'clsx';
import { useSite } from './site';

/**
 * Public-page SEO extras: search-console verification meta tags and the
 * self-hosted analytics bootstrap. Mounted ONLY on public surfaces (landing,
 * services, blog, assistant…) — never inside customer/staff/admin panels, so
 * panel activity is not tracked and verification tags stay on the public site.
 *
 * The analytics script is served by our own API (/api/public/analytics.js),
 * which embeds only settings-validated IDs; the strict CSP needs no
 * 'unsafe-inline'. GA/GTM domains are added to the CSP server-side only when
 * an ID is actually configured.
 */
export function PublicSeoExtras() {
  const { setting } = useSite();
  const ga = setting('seo.ga_measurement_id');
  const gtm = setting('seo.gtm_container_id');
  const googleVerification = setting('seo.google_site_verification');
  const bingVerification = setting('seo.bing_site_verification');
  const analyticsOn = /^G-[A-Z0-9]{6,12}$/.test(ga) || /^GTM-[A-Z0-9]{4,10}$/.test(gtm);

  useEffect(() => {
    const created: Element[] = [];
    const upsertMeta = (name: string, content: string) => {
      if (!content) return;
      let el = document.head.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.name = name;
        el.dataset.seoManaged = '1';
        document.head.appendChild(el);
        created.push(el);
      }
      el.content = content;
    };
    upsertMeta('google-site-verification', googleVerification);
    upsertMeta('msvalidate.01', bingVerification);

    let script: HTMLScriptElement | null = null;
    if (analyticsOn && !document.querySelector('script[data-pishkan-analytics]')) {
      script = document.createElement('script');
      script.src = '/api/public/analytics.js';
      script.async = true;
      script.dataset.pishkanAnalytics = '1';
      document.head.appendChild(script);
    }
    return () => {
      created.forEach((el) => el.remove());
      script?.remove();
    };
  }, [googleVerification, bingVerification, analyticsOn]);

  return null;
}

/**
 * Enamad trust seal. The stored value was rebuilt server-side from validated
 * enamad.ir URLs only (settings/enamad.ts) — no script, no foreign host, no
 * event handler can survive that sanitizer — so rendering it here is safe.
 */
export function EnamadBadge({ className }: { className?: string }) {
  const { setting } = useSite();
  const enabled = setting('site.enamad_enabled') === 'true';
  const code = setting('site.enamad_code');
  if (!enabled || !code) return null;
  return (
    <div
      className={clsx('inline-flex items-center justify-center rounded-xl bg-white/95 p-2 ring-1 ring-black/5', className)}
      // Sanitized at write time by the server; see parseEnamadSnippet.
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
