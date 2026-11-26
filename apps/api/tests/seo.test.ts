import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app } from './helpers.js';

/**
 * SEO surface end-to-end against the real seeded app: canonical-based
 * sitemap/robots, the self-hosted analytics bootstrap (only validated IDs),
 * settings-driven CSP extension, and the Enamad sanitizer's write path.
 * Nothing is stubbed; every assertion reads a real HTTP response.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;

const set = (patch: Record<string, unknown>) =>
  request(server).put('/api/settings/admin').set('Cookie', admin.cookie).send({ values: patch });

beforeAll(async () => {
  server = await app();
  admin = await adminSession();
});

describe('SEO endpoints', () => {
  it('robots.txt always disallows private surfaces and appends admin extra lines', async () => {
    const base = await request(server).get('/robots.txt').expect(200);
    for (const path of ['/api/', '/app/', '/admin/', '/staff/', '/login', '/login-admin', '/register', '/reset-password']) {
      expect(base.text).toContain(`Disallow: ${path}`);
    }
    expect(base.text).toContain('Sitemap:');

    const upd = await set({ 'seo.robots_extra': 'Disallow: /drafts/\nUser-agent: BadBot\nDisallow: /' });
    expect(upd.status).toBe(200);
    const extra = await request(server).get('/robots.txt').expect(200);
    expect(extra.text).toContain('Disallow: /drafts/');
    expect(extra.text).toContain('User-agent: BadBot');
    await set({ 'seo.robots_extra': '' });
  });

  it('sitemap and robots honour seo.canonical_base over the request host', async () => {
    const upd = await set({ 'seo.canonical_base': 'https://office.example.ir/' });
    expect(upd.status).toBe(200);
    const sitemap = await request(server).get('/sitemap.xml').expect(200);
    expect(sitemap.text).toContain('<loc>https://office.example.ir/</loc>');
    expect(sitemap.text).toContain('<loc>https://office.example.ir/services/');
    expect(sitemap.text).not.toContain('127.0.0.1');
    const robots = await request(server).get('/robots.txt').expect(200);
    expect(robots.text).toContain('Sitemap: https://office.example.ir/sitemap.xml');
    await set({ 'seo.canonical_base': '' });
  });

  it('analytics.js stays empty without IDs and embeds only validated ones', async () => {
    const empty = await request(server).get('/api/public/analytics.js').expect(200);
    expect(empty.headers['content-type']).toContain('application/javascript');
    expect(empty.text).not.toContain('googletagmanager.com/gtag');
    expect(empty.text).not.toContain('gtm.js');

    // Invalid ID must be rejected by the settings validator itself.
    const bad = await set({ 'seo.ga_measurement_id': 'G-"><script>alert(1)</script>' });
    expect(bad.status).toBe(400);

    const good = await set({ 'seo.ga_measurement_id': 'G-TEST123456' });
    expect(good.status).toBe(200);
    const ga = await request(server).get('/api/public/analytics.js').expect(200);
    expect(ga.text).toContain("gtag('config','G-TEST123456'");
    expect(ga.text).toContain('anonymize_ip');

    // GTM wins when both are configured (no double counting).
    const both = await set({ 'seo.gtm_container_id': 'GTM-TEST123' });
    expect(both.status).toBe(200);
    const gtm = await request(server).get('/api/public/analytics.js').expect(200);
    expect(gtm.text).toContain("'GTM-TEST123'");
    expect(gtm.text).not.toContain("gtag('config'");

    await set({ 'seo.ga_measurement_id': '', 'seo.gtm_container_id': '' });
    const cleared = await request(server).get('/api/public/analytics.js').expect(200);
    expect(cleared.text).not.toContain('googletagmanager');
  });

  it('CSP stays strict by default and extends only when integrations are on', async () => {
    const strict = await request(server).get('/api/public/bootstrap').expect(200);
    const strictCsp = String(strict.headers['content-security-policy']);
    expect(strictCsp).not.toContain('google-analytics');
    expect(strictCsp).not.toContain('enamad');

    await set({ 'seo.ga_measurement_id': 'G-CSP1234567', 'site.enamad_enabled': true });
    const extended = await request(server).get('/api/public/bootstrap').expect(200);
    const csp = String(extended.headers['content-security-policy']);
    expect(csp).toContain('https://www.google-analytics.com');
    expect(csp).toContain('https://trustseal.enamad.ir');
    expect(csp).toContain("object-src 'none'"); // original hardening preserved
    // Scripts stay locked to self + Google loaders; the pre-existing
    // style-src 'unsafe-inline' (React inline styles) is unchanged.
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src ')) ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).toContain("'self'");

    await set({ 'seo.ga_measurement_id': '', 'site.enamad_enabled': false });
    const restored = await request(server).get('/api/public/bootstrap').expect(200);
    expect(String(restored.headers['content-security-policy'])).not.toContain('google-analytics');
  });

  it('enamad code is sanitized to enamad.ir-only markup and exposed publicly', async () => {
    const evil = await set({ 'site.enamad_code': '<a href="https://trustseal.enamad.ir/?id=1&Code=abc"><img src="https://logo.enamad.ir/Logo.aspx?id=1" onerror="alert(1)"></a><script>steal()</script>' });
    expect(evil.status).toBe(400); // script tag → rejected outright

    const foreign = await set({ 'site.enamad_code': '<a href="https://evil.example/x"><img src="https://evil.example/y.png"></a>' });
    expect(foreign.status).toBe(400);

    const good = await set({
      'site.enamad_code': '<a referrerpolicy="origin" target="_blank" href="https://trustseal.enamad.ir/?id=12345&Code=abcdef"><img referrerpolicy="origin" src="https://logo.enamad.ir/Logo.aspx?id=12345" style="cursor:pointer" alt="نماد اعتماد الکترونیکی"></a>',
      'site.enamad_enabled': true,
    });
    expect(good.status).toBe(200);
    const bootstrap = await request(server).get('/api/public/bootstrap').expect(200);
    const code = String(bootstrap.body.data.settings['site.enamad_code']);
    expect(code).toContain('trustseal.enamad.ir/?id=12345');
    expect(code).toContain('logo.enamad.ir');
    expect(code).not.toContain('onerror');
    expect(code).not.toContain('<script');
    expect(bootstrap.body.data.settings['site.enamad_enabled']).toBe(true);

    await set({ 'site.enamad_code': '', 'site.enamad_enabled': false });
  });
});
