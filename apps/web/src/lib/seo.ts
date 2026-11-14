import { useEffect } from 'react';

/**
 * Per-page SEO head manager for the SPA: sets the document title, meta
 * description, canonical link, Open Graph / Twitter cards, robots directive
 * and an optional JSON-LD block, and restores the previous values when the
 * page unmounts. Pair it with the server-generated /sitemap.xml so crawlers
 * can discover every published article.
 */
export interface SeoInput {
  title: string;
  description?: string;
  canonical?: string;
  image?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | null;
}

function upsertMeta(selector: string, attrs: Record<string, string>, content: string | undefined, created: Element[]) {
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!content) {
    if (el && el.dataset.seoManaged) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
    el.dataset.seoManaged = '1';
    document.head.appendChild(el);
    created.push(el);
  }
  el.setAttribute('content', content);
}

export function useSeo(input: SeoInput | null) {
  const serialized = input ? JSON.stringify(input) : '';
  useEffect(() => {
    if (!serialized) return undefined;
    const seo: SeoInput = JSON.parse(serialized);
    document.documentElement.dataset.seoTitle = '1';
    const previousTitle = document.title;
    document.title = seo.title;

    const created: Element[] = [];
    const restore: (() => void)[] = [];

    const managedMeta = (selector: string, attrs: Record<string, string>, content?: string) => {
      const existing = document.head.querySelector(selector) as HTMLMetaElement | null;
      const previous = existing?.getAttribute('content') ?? null;
      upsertMeta(selector, attrs, content, created);
      restore.push(() => {
        const current = document.head.querySelector(selector) as HTMLMetaElement | null;
        if (!current) return;
        if (previous === null && current.dataset.seoManaged) current.remove();
        else if (previous !== null) current.setAttribute('content', previous);
      });
    };

    const absolute = (url?: string) => {
      if (!url) return undefined;
      try { return new URL(url, window.location.origin).toString(); } catch { return undefined; }
    };
    const canonical = absolute(seo.canonical) ?? window.location.href.split('#')[0];
    const image = absolute(seo.image);

    managedMeta('meta[name="description"]', { name: 'description' }, seo.description);
    managedMeta('meta[name="robots"]', { name: 'robots' }, seo.noindex ? 'noindex, nofollow' : 'index, follow');
    managedMeta('meta[property="og:title"]', { property: 'og:title' }, seo.title);
    managedMeta('meta[property="og:description"]', { property: 'og:description' }, seo.description);
    managedMeta('meta[property="og:type"]', { property: 'og:type' }, seo.type ?? 'website');
    managedMeta('meta[property="og:url"]', { property: 'og:url' }, canonical);
    managedMeta('meta[property="og:image"]', { property: 'og:image' }, image);
    managedMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, image ? 'summary_large_image' : 'summary');
    managedMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, seo.title);
    managedMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, seo.description);
    managedMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, image);

    let canonicalEl = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    const previousCanonical = canonicalEl?.getAttribute('href') ?? null;
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.setAttribute('rel', 'canonical');
      canonicalEl.dataset.seoManaged = '1';
      document.head.appendChild(canonicalEl);
      created.push(canonicalEl);
    }
    canonicalEl.setAttribute('href', canonical);

    let jsonLdEl: HTMLScriptElement | null = null;
    if (seo.jsonLd) {
      jsonLdEl = document.createElement('script');
      jsonLdEl.type = 'application/ld+json';
      jsonLdEl.dataset.seoManaged = '1';
      jsonLdEl.textContent = JSON.stringify(seo.jsonLd);
      document.head.appendChild(jsonLdEl);
    }

    return () => {
      document.title = previousTitle;
      restore.forEach((fn) => fn());
      if (canonicalEl) {
        if (previousCanonical === null && canonicalEl.dataset.seoManaged) canonicalEl.remove();
        else if (previousCanonical !== null) canonicalEl.setAttribute('href', previousCanonical);
      }
      jsonLdEl?.remove();
    };
  }, [serialized]);
}
