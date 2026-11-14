import { describe, expect, it } from 'vitest';
import { paletteFor, renderArtworkSvg, renderArtworkPng } from '../src/modules/catalog/artwork-render.js';

/**
 * The rule these tests protect: every service must show *its own* picture.
 * A customer must never see two different services behind the same tile, and a
 * service the office adds from the admin panel this morning must not fall back
 * to its category's photo — that is exactly the bug the generated artwork
 * exists to prevent.
 */
describe('generated artwork', () => {
  const services = [
    { slug: 'plate-change', title: 'تعویض پلاک', categorySlug: 'vehicle-services' },
    { slug: 'birth-certificate', title: 'گواهی تولد', categorySlug: 'other-services' },
    { slug: 'tax-return', title: 'اظهارنامه مالیاتی', categorySlug: 'tax-services' },
    { slug: 'insurance-card', title: 'بیمه درمان', categorySlug: 'insurance-health' },
    { slug: 'housing-loan', title: 'وام مسکن', categorySlug: 'housing-land' },
  ];

  it('gives every slug a different palette', () => {
    const seen = new Map<string, string>();
    for (const service of services) {
      const palette = paletteFor(service.slug, service.categorySlug);
      const key = `${palette.top}|${palette.front}|${palette.side}`;
      expect(seen.has(key), `${service.slug} reuses ${seen.get(key)}'s colours`).toBe(false);
      seen.set(key, service.slug);
    }
    expect(seen.size).toBe(services.length);
  });

  it('is deterministic: the same slug always renders the same bytes', () => {
    const a = renderArtworkSvg({ slug: 'plate-change', title: 'تعویض پلاک', categorySlug: 'vehicle-services' });
    const b = renderArtworkSvg({ slug: 'plate-change', title: 'تعویض پلاک', categorySlug: 'vehicle-services' });
    expect(a).toBe(b);
  });

  it('keeps a service inside its category hue family', () => {
    // vehicle-services is ~33°; a tile 20°+ away would read as another category.
    const { hue } = paletteFor('plate-change', 'vehicle-services');
    expect(Math.min(Math.abs(hue - 33), 360 - Math.abs(hue - 33))).toBeLessThanOrEqual(17);
  });

  it('draws a category tile that differs from any of its services', () => {
    const service = renderArtworkSvg({ slug: 'plate-change', categorySlug: 'vehicle-services' });
    const category = renderArtworkSvg({ slug: 'vehicle-services', categorySlug: 'vehicle-services', category: true });
    expect(service).not.toBe(category);
  });

  it('escapes nothing into the SVG that would break the renderer', async () => {
    // A slug from the admin panel is untrusted input; it must not inject markup.
    const svg = renderArtworkSvg({ slug: 'evil"><script>alert(1)</script>', title: '<b>x</b>', categorySlug: '' });
    expect(svg).not.toContain('<script>');
    await expect(renderArtworkPng({ slug: 'evil', title: '<b>x</b>', size: 64 })).resolves.toBeInstanceOf(Buffer);
  });

  it('produces real WebP bytes that Flutter can decode', async () => {
    const buffer = await renderArtworkPng({ slug: 'plate-change', title: 'تعویض پلاک', categorySlug: 'vehicle-services', size: 160 });
    // RIFF....WEBP
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
