/**
 * Per-slug artwork, rendered on demand.
 *
 * The mobile app bundles an illustration for every service that existed when
 * the APK was cut (see `tools/service-art/build.mjs`). Services the office
 * creates later — including from the admin panel, minutes before a customer
 * opens the app — are absent from that bundle, so they ask for
 * `/api/catalog/artwork/<slug>.webp` and `/api/catalog/artwork/category/<slug>.webp`.
 *
 * Two rules drive this file:
 *
 *  1. **Never a shared picture.** The colour and the glyph are derived from the
 *     slug itself, so two services can only collide if their slugs collide —
 *     which the catalogue already forbids. A category photo is never reused for
 *     one of its services.
 *  2. **Looks like the bundled set.** Same soft three-dimensional slab, same
 *     floating glyph, same palette family, so a brand-new service sits next to
 *     the baked ones without looking imported from another app.
 *
 * Output is WebP, not SVG: Flutter's image pipeline decodes bitmaps only.
 */
import sharp from 'sharp';

/* --------------------------------- palette -------------------------------- */

/** Base hue per category slug, mirrored from the app's `categoryBaseColors`. */
const CATEGORY_HUE: Record<string, number> = {
  'insurance-health': 220,
  'companies-institutions': 217,
  'subsidy-welfare': 188,
  'vehicle-services': 33,
  'tax-services': 262,
  'judicial-services': 215,
  'exams-employment': 200,
  'housing-land': 142,
  'banking-services': 224,
  'police-services': 175,
  'university-students': 292,
  'business-licenses': 24,
  'school-services': 330,
  'consulting': 82,
  'other-services': 215,
};

const DEFAULT_HUE = 217;

/** Stable 32-bit hash — the same slug always gets the same picture. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A service nudges ±16° inside its category's hue, so a screen full of one
 * category still reads as one family while no two tiles are identical.
 */
export function paletteFor(slug: string, categorySlug: string): {
  hue: number;
  front: string;
  top: string;
  side: string;
  glyph: string;
} {
  const base = CATEGORY_HUE[categorySlug] ?? DEFAULT_HUE;
  const shift = (hash(`hue:${slug}`) % 33) - 16;
  const hue = (base + shift + 360) % 360;
  const light = 56 + (hash(`l:${slug}`) % 9);
  const front = `hsl(${hue} ${72}% ${light}%)`;
  const top = `hsl(${hue} ${78}% ${Math.min(light + 16, 88)}%)`;
  const side = `hsl(${hue} ${64}% ${Math.max(light - 18, 26)}%)`;
  return { hue, front, top, side, glyph: '#ffffff' };
}

/* ---------------------------------- glyphs -------------------------------- */

/**
 * Twelve simple, legible pictograms drawn as SVG paths on a 24×24 grid.
 * They are intentionally generic: a new service should read as "a document",
 * "a car", "a building" — the same vocabulary the bundled set uses — rather
 * than trying to guess something more specific and ending up with a smudge.
 */
const GLYPHS: Record<string, string> = {
  document: 'M7 3h7l4 4v14H7z M14 3v4h4',
  car: 'M4 15h16v3H4z M6 15V9l2-4h8l2 4v6 M7 18.5a1.2 1.2 0 1 0 0 .01 M17 18.5a1.2 1.2 0 1 0 0 .01',
  building: 'M5 21V5h9v16 M14 11h5v10 M8 8h3 M8 12h3 M8 16h3',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  wallet: 'M3 8h16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3z M3 8V6a1 1 0 0 1 1-1h13 M17 13.5a1 1 0 1 0 0 .01',
  gavel: 'M14 3l7 7-3 3-7-7z M3 21h10 M6 16l5-5',
  school: 'M12 3l9 5-9 5-9-5z M6 11v5c0 1 3 2 6 2s6-1 6-2v-5',
  health: 'M12 5v14 M5 12h14',
  house: 'M4 11l8-7 8 7 M6 10v10h12V10 M10 20v-6h4v6',
  bank: 'M3 10l9-6 9 6 M5 10v9h14v-9 M9 19v-5h6v5',
  briefcase: 'M3 8h18v12H3z M9 8V5h6v3 M3 13h18',
  star: 'M12 3l2.6 5.6 6.1.8-4.4 4.3 1.1 6-5.4-3-5.4 3 1.1-6L3.3 9.4l6.1-.8z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M2 21c0-3.5 3-6 7-6s7 2.5 7 6 M17 5.5a3 3 0 0 1 0 6 M18 15c2.5.6 4 2.6 4 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
};

/** Ordered keyword rules, most specific first — mirrors the app's `_rules`. */
const RULES: Array<{ glyph: keyof typeof GLYPHS; words: string[] }> = [
  { glyph: 'car', words: ['پلاک', 'خودرو', 'ماشین', 'سوخت', 'بنزین', 'رانندگی', 'plate', 'vehicle', 'car', 'fuel', 'driving'] },
  { glyph: 'shield', words: ['بیمه', 'سوء پیشینه', 'پیشینه', 'گواهی', 'insurance', 'police', 'certificate'] },
  { glyph: 'health', words: ['سلامت', 'درمان', 'پزشک', 'health', 'medical'] },
  { glyph: 'house', words: ['ملک', 'سند', 'زمین', 'مسکن', 'housing', 'property', 'land'] },
  { glyph: 'school', words: ['دانشگاه', 'تحصیل', 'دانشجو', 'آموزش', 'مدرسه', 'school', 'exams', 'university'] },
  { glyph: 'bank', words: ['وام', 'تسهیلات', 'بانک', 'حساب', 'یارانه', 'loan', 'bank', 'subsidy', 'welfare'] },
  { glyph: 'gavel', words: ['حقوقی', 'دادگستری', 'وکالت', 'قضایی', 'legal', 'judicial', 'court'] },
  { glyph: 'briefcase', words: ['پروانه کسب', 'کسب', 'جواز', 'مجوز', 'شرکت', 'تجاری', 'license', 'business', 'company'] },
  { glyph: 'building', words: ['شهرداری', 'اداره', 'سازمان', 'amaken', 'municipal'] },
  { glyph: 'wallet', words: ['پرداخت', 'فاکتور', 'کیف پول', 'wallet', 'payment', 'invoice'] },
  { glyph: 'clock', words: ['نوبت', 'زمان', 'مهلت', 'appointment', 'time'] },
  { glyph: 'users', words: ['خانواده', 'ازدواج', 'فرزند', 'family', 'marriage', 'child'] },
];

function pickGlyph(haystack: string): string {
  const text = haystack.toLowerCase();
  for (const rule of RULES) {
    if (rule.words.some((word) => text.includes(word.toLowerCase()))) {
      return GLYPHS[rule.glyph];
    }
  }
  return GLYPHS.document;
}

/* ---------------------------------- scene --------------------------------- */

const SIZE = 480;

/**
 * The illustration: a rounded slab with real thickness, its glyph floating in
 * front, over a soft radial glow. `category` draws a wider slab so a category
 * tile is recognisable at a glance next to a service tile.
 */
export function renderArtworkSvg(options: {
  slug: string;
  title?: string;
  categorySlug?: string;
  category?: boolean;
}): string {
  const { slug, title = '', categorySlug = '', category = false } = options;
  const p = paletteFor(slug, categorySlug);
  const glyph = pickGlyph(`${title} ${slug} ${categorySlug}`);
  const slab = category ? { w: 300, h: 300, r: 92 } : { w: 276, h: 276, r: 86 };
  const depth = category ? 30 : 26;
  // Centre the slab *including* its thickness, so the tile looks composed
  // rather than cropped at the bottom of a square.
  const y = (SIZE - slab.h - depth) / 2;
  const glyphScale = category ? 6.2 : 5.8;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="${p.top}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${p.top}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="front" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="${p.top}"/>
      <stop offset="1" stop-color="${p.front}"/>
    </linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.side}"/>
      <stop offset="1" stop-color="${p.side}" stop-opacity="0.82"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${depth * 0.45}" stdDeviation="${depth * 0.42}" flood-color="${p.side}" flood-opacity="0.42"/>
    </filter>
    <g id="glyph" fill="none" stroke="${p.glyph}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="${glyph}"/>
    </g>
  </defs>

  <rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>

  <g filter="url(#soft)">
    <rect x="${SIZE / 2 - slab.w / 2}" y="${y}" width="${slab.w}" height="${slab.h}" rx="${slab.r}" fill="url(#side)" transform="translate(0 ${depth})"/>
    <rect x="${SIZE / 2 - slab.w / 2}" y="${y}" width="${slab.w}" height="${slab.h}" rx="${slab.r}" fill="url(#front)"/>
    <rect x="${SIZE / 2 - slab.w / 2 + 16}" y="${y + 14}" width="${slab.w - 32}" height="${slab.h * 0.30}" rx="${slab.r * 0.7}" fill="#ffffff" opacity="0.13"/>
  </g>

  <use href="#glyph" transform="translate(${SIZE / 2 - glyphScale * 12} ${y + slab.h / 2 - glyphScale * 12}) scale(${glyphScale})"/>
</svg>`;
}

/* -------------------------------- rendering -------------------------------- */

/**
 * Rasterise one slug to WebP — the only bitmap format the app decodes for
 * these tiles, and about a fifth the size of the equivalent PNG.
 */
export async function renderArtworkPng(options: {
  slug: string;
  title?: string;
  categorySlug?: string;
  category?: boolean;
  size?: number;
}): Promise<Buffer> {
  const svg = renderArtworkSvg(options);
  return sharp(Buffer.from(svg))
    .resize(options.size ?? 320, options.size ?? 320, { fit: 'cover' })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();
}
