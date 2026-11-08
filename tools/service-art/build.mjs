#!/usr/bin/env node
/**
 * Illustrations for every service and category — generated, not hand-picked.
 *
 * Why generated: the catalogue has 190+ services and the office keeps adding
 * more from the admin panel. A fixed set of downloaded photos can never stay
 * unique (and would be several megabytes inside the APK), so each asset is
 * rendered from a deterministic recipe:
 *
 *   icon (the service's own Lucide glyph, the same one the web panel shows)
 *   + the category's base hue
 *   + a per-service hue nudge and pedestal/backdrop variant
 *   -> one 3D "soft / puffy" webp that no other service shares.
 *
 * Uniqueness is structural: two services get the same file only if their glyph,
 * category and variant are identical, which the catalogue forbids (slug is
 * unique and the icon is part of the service definition). services.test.ts
 * asserts that every seeded service resolves to its own file.
 *
 * Outputs (all committed, because the office server may be offline):
 *   apps/mobile/assets/service_art/<slug>.webp        160x160, ~5 KB  (catalogue rows)
 *   apps/mobile/assets/service_art/large/<slug>.webp  480x480, ~20 KB (detail header)
 *   apps/mobile/assets/category_art/<slug>.webp       320x320, ~12 KB
 *   apps/web/public/images/services/art/<slug>.webp   480x480, same files as `large`
 *   apps/web/public/images/categories/art/<slug>.webp 320x320
 *
 * Usage: node tools/service-art/build.mjs [--only slug1,slug2] [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// sharp is an API dependency; npm may hoist it to the repo or keep it local.
async function loadSharp() {
  for (const candidate of [
    path.join(root, 'node_modules/sharp/dist/index.cjs'),
    path.join(root, 'apps/api/node_modules/sharp/dist/index.cjs'),
  ]) {
    if (fs.existsSync(candidate)) return (await import(candidate)).default;
  }
  throw new Error('sharp is not installed — run `npm ci` at the repository root.');
}
const sharp = await loadSharp();

/* ----------------------------- catalogue input ---------------------------- */

const seed = fs.readFileSync(path.join(root, 'apps/api/src/modules/catalog/seed-data.ts'), 'utf8');

/** `{ slug, category, title, icon }` for every seeded service. */
export function readSeedServices() {
  const services = [];
  const blockRe = /slug: '([^']+)',\s*category: '([^']+)',\s*title: '([^']+)',([\s\S]*?)\n  \},/g;
  let match;
  while ((match = blockRe.exec(seed))) {
    const [, slug, category, title, rest] = match;
    const icon = /icon: '([^']+)'/.exec(rest)?.[1] ?? 'file-text';
    services.push({ slug, category, title, icon });
  }
  return services;
}

export function readSeedCategories() {
  const categories = [];
  const blockRe = /slug: '([^']+)',\s*title: '([^']+)',([\s\S]*?)color: '(#[0-9a-fA-F]{6})',([\s\S]*?)\n  \},/g;
  let match;
  while ((match = blockRe.exec(seed))) {
    const [, slug, title, mid, color] = match;
    const icon = /icon: '([^']+)'/.exec(mid)?.[1] ?? 'layout-grid';
    categories.push({ slug, title, color, icon });
  }
  return categories;
}

/* ------------------------------ lucide glyphs ----------------------------- */

const iconsDir = path.join(root, 'node_modules/lucide-react/dist/esm/icons');
const glyphCache = new Map();

/** Lucide icon node data -> list of `{tag, attrs}` (path/circle/rect/line...). */
export function loadGlyph(name) {
  if (glyphCache.has(name)) return glyphCache.get(name);
  // A few seeded names carry a display-only suffix (`landmark-icon`); Lucide
  // files are plain kebab-case, so try the trimmed name before giving up.
  const candidates = [name, name.replace(/-icon$/, ''), name.replace(/-2$/, '')];
  let file = candidates.map((candidate) => path.join(iconsDir, `${candidate}.mjs`)).find((candidate) => fs.existsSync(candidate));
  if (!file) file = path.join(iconsDir, 'file-text.mjs');
  let source = fs.readFileSync(file, 'utf8');
  // Aliases are one-line re-exports (`export { default } from './x.mjs'`).
  const alias = /^export \{ default \} from '\.\/([^']+)\.mjs';$/m.exec(source);
  if (alias) {
    source = fs.readFileSync(path.join(iconsDir, `${alias[1]}.mjs`), 'utf8');
  }
  const start = source.indexOf('const __iconData = ') + 'const __iconData = '.length;
  const literal = source.slice(start, source.indexOf('};', start) + 1);
  const data = new Function(`return (${literal})`)();
  // Aliases reuse another icon's node list with no coordinates of their own.
  const nodes = Array.isArray(data.node)
    ? data.node.map(([tag, attrs]) => ({ tag, attrs: attrs ?? {} }))
    : loadGlyph(data.name ?? 'file-text');
  glyphCache.set(name, nodes);
  return nodes;
}

export function glyphSvg(nodes, size = 100, strokeWidth = 2) {
  const body = nodes.map(({ tag, attrs }) => {
    const clean = Object.entries(attrs)
      .filter(([key]) => key !== 'key')
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    return `<${tag} ${clean}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" `
    + `fill="none" stroke="#ffffff" stroke-width="${strokeWidth}" stroke-linecap="round" `
    + `stroke-linejoin="round">${body}</svg>`;
}

/* ------------------------------- colour work ------------------------------ */

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

export function hexToHsl(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return [h * 60, s, l];
}

export function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  if (sat === 0) {
    const value = clamp(lig * 255);
    return `#${value.toString(16).padStart(2, '0').repeat(3)}`;
  }
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const channel = (t) => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  const r = clamp(channel(hue + 1 / 3) * 255);
  const g = clamp(channel(hue) * 255);
  const b = clamp(channel(hue - 1 / 3) * 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Stable per-slug number, so a service keeps its tint forever. */
export function slugHash(slug) {
  let hash = 2166136261;
  for (let index = 0; index < slug.length; index += 1) {
    hash ^= slug.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * The palette the app actually uses. Each category owns a base hue; a service
 * only nudges ±14° inside it so a screen full of one category still reads as
 * one family while neighbours remain distinguishable.
 */
export function paletteFor(categoryColor, slug) {
  const [baseHue] = hexToHsl(categoryColor);
  const hash = slugHash(slug);
  const hue = baseHue + ((hash % 29) - 14);
  const variant = hash % 4;
  return {
    hue,
    variant,
    tileTop: hslToHex(hue, 0.78, 0.66),
    tileBottom: hslToHex(hue, 0.82, 0.48),
    tileRim: hslToHex(hue, 0.62, 0.86),
    glow: hslToHex(hue, 0.85, 0.62),
    backdropA: hslToHex(hue, 0.52, 0.965),
    backdropB: hslToHex(hue, 0.48, 0.9),
    shadow: hslToHex(hue, 0.55, 0.42),
  };
}

/* --------------------------------- renderer ------------------------------- */

/**
 * Visual recipe for one tile, in the same language as the commissioned
 * category illustrations: a glossy rounded slab with real thickness, floating
 * above a bevelled disc, on a near-white studio backdrop with a soft shadow.
 *
 * Everything is drawn in a 512x512 canvas and downscaled, so edges stay clean
 * at every density. No text and no photographs — only the service's own glyph.
 */
export function sceneSvg({ slug, categoryColor, icon, size = 512, category = false }) {
  const p = paletteFor(categoryColor, slug);
  const glyph = glyphSvg(loadGlyph(icon), category ? 118 : 108, 2.15);

  const slab = category ? { w: 208, h: 208, r: 66 } : { w: 192, h: 192, r: 62 };
  // Thickness of the extruded side — this is what reads as "3D".
  const depth = category ? 26 : 24;
  const slabY = category ? 214 : 220;           // centre of the front face
  const baseW = slab.w + 44;
  const baseY = slabY + slab.h / 2 + depth + 34; // top face of the disc
  const glyphTop = slabY - (category ? 62 : 58);

  const backdrop = [
    `<circle cx="196" cy="168" r="168" fill="${p.glow}" opacity="0.13"/>
     <circle cx="330" cy="300" r="150" fill="${p.glow}" opacity="0.09"/>`,
    `<rect x="86" y="74" width="342" height="342" rx="150" fill="${p.glow}" opacity="0.11" transform="rotate(-14 256 246)"/>`,
    `<circle cx="256" cy="214" r="186" fill="${p.glow}" opacity="0.12"/>`,
    `<rect x="112" y="92" width="286" height="286" rx="143" fill="${p.glow}" opacity="0.13"/>`,
  ][p.variant];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="46%" cy="30%" r="86%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="52%" stop-color="${p.backdropA}"/>
      <stop offset="100%" stop-color="${p.backdropB}"/>
    </radialGradient>
    <!-- front face: bright at the top-left, saturated at the bottom-right -->
    <linearGradient id="face" x1="12%" y1="6%" x2="82%" y2="98%">
      <stop offset="0%" stop-color="${hslToHex(p.hue, 0.82, 0.72)}"/>
      <stop offset="46%" stop-color="${hslToHex(p.hue, 0.84, 0.58)}"/>
      <stop offset="100%" stop-color="${hslToHex(p.hue, 0.86, 0.44)}"/>
    </linearGradient>
    <!-- extruded side: same hue, clearly darker -->
    <linearGradient id="side" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${hslToHex(p.hue, 0.78, 0.44)}"/>
      <stop offset="100%" stop-color="${hslToHex(p.hue, 0.72, 0.3)}"/>
    </linearGradient>
    <linearGradient id="rim" x1="20%" y1="0%" x2="70%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="46%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.08"/>
    </linearGradient>
    <!-- bevelled disc: lit top face over a tinted side wall -->
    <linearGradient id="disc" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="42%" stop-color="${hslToHex(p.hue, 0.42, 0.9)}"/>
      <stop offset="100%" stop-color="${hslToHex(p.hue, 0.5, 0.74)}"/>
    </linearGradient>
    <radialGradient id="discTop" cx="42%" cy="30%" r="76%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="${hslToHex(p.hue, 0.34, 0.965)}"/>
      <stop offset="100%" stop-color="${hslToHex(p.hue, 0.38, 0.9)}"/>
    </radialGradient>
    <filter id="castShadow" x="-40%" y="-60%" width="180%" height="220%">
      <feDropShadow dx="0" dy="20" stdDeviation="16" flood-color="${p.shadow}" flood-opacity="0.3"/>
    </filter>
    <filter id="objectShadow" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="14" stdDeviation="12" flood-color="${p.shadow}" flood-opacity="0.34"/>
    </filter>
    <filter id="glyphShadow" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.2" flood-color="#0b1f3a" flood-opacity="0.36"/>
    </filter>
    <filter id="softBlur" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect width="512" height="512" fill="url(#bg)"/>
  ${backdrop}
  <!-- the object's shadow pooling on the floor, before anything is drawn on top -->
  <ellipse cx="256" cy="${baseY + 34}" rx="${baseW * 0.62}" ry="30" fill="${p.shadow}" opacity="0.34" filter="url(#softBlur)"/>
  <ellipse cx="256" cy="${baseY + 6}" rx="${slab.w * 0.52}" ry="16" fill="${p.shadow}" opacity="0.26" filter="url(#softBlur)"/>

  <!-- bevelled disc: side wall, top face, then a crisp inner rim -->
  <g filter="url(#castShadow)">
    <path d="M${256 - baseW / 2} ${baseY} a${baseW / 2} 30 0 0 0 ${baseW} 0 v18 a${baseW / 2} 30 0 0 1 -${baseW} 0 z" fill="url(#disc)"/>
    <ellipse cx="256" cy="${baseY}" rx="${baseW / 2}" ry="30" fill="url(#discTop)"/>
    <ellipse cx="256" cy="${baseY}" rx="${baseW / 2}" ry="30" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="3"/>
    <ellipse cx="232" cy="${baseY - 8}" rx="${baseW * 0.24}" ry="9" fill="#ffffff" opacity="0.5"/>
  </g>

  <!-- the slab: extruded side first, then the lit front face -->
  <g filter="url(#objectShadow)">
    <rect x="${256 - slab.w / 2}" y="${slabY - slab.h / 2 + depth}" width="${slab.w}" height="${slab.h}" rx="${slab.r}" fill="url(#side)"/>
    <rect x="${256 - slab.w / 2}" y="${slabY - slab.h / 2}" width="${slab.w}" height="${slab.h}" rx="${slab.r}" fill="url(#face)"/>
    <rect x="${256 - slab.w / 2 + 2.5}" y="${slabY - slab.h / 2 + 2.5}" width="${slab.w - 5}" height="${slab.h - 5}" rx="${slab.r - 2.5}"
          fill="none" stroke="url(#rim)" stroke-width="4.5"/>
    <!-- specular sweep across the top third: the "puffy" gloss -->
    <path d="M${256 - slab.w / 2 + 12} ${slabY - slab.h / 2 + 10}
             h${slab.w - 24} v${slab.h * 0.3}
             q-${slab.w * 0.34} ${slab.h * 0.16} -${slab.w - 24} ${slab.h * 0.06} z"
          fill="#ffffff" opacity="0.17"/>
    <ellipse cx="${256 - slab.w * 0.2}" cy="${slabY - slab.h * 0.26}" rx="${slab.w * 0.2}" ry="${slab.h * 0.1}"
             fill="#ffffff" opacity="0.3"/>
  </g>

  <g filter="url(#glyphShadow)" transform="translate(${256 - (category ? 59 : 54)}, ${glyphTop})">${glyph}</g>
</svg>`;
}

/* ---------------------------------- build --------------------------------- */

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set((args[args.indexOf('--only') + 1] ?? '').split(',').filter(Boolean)) : null;

const out = {
  serviceSmall: path.join(root, 'apps/mobile/assets/service_art'),
  serviceLarge: path.join(root, 'apps/mobile/assets/service_art/large'),
  categoryMobile: path.join(root, 'apps/mobile/assets/category_art'),
  serviceWeb: path.join(root, 'apps/web/public/images/services/art'),
  categoryWeb: path.join(root, 'apps/web/public/images/categories/art'),
};
for (const dir of Object.values(out)) fs.mkdirSync(dir, { recursive: true });

const categories = readSeedCategories();
const categoryColor = new Map(categories.map((c) => [c.slug, c.color]));
const serviceIcons = readSeedServices();

async function render(svg, file, width) {
  const buffer = await sharp(Buffer.from(svg), { density: 384 })
    .resize(width, width, { fit: 'cover' })
    .webp({ quality: 86, effort: 5 })
    .toBuffer();
  fs.writeFileSync(file, buffer);
  return buffer.length;
}

let total = 0;
let count = 0;

for (const category of categories) {
  if (only && !only.has(category.slug)) continue;
  const svg = sceneSvg({ slug: category.slug, categoryColor: category.color, icon: category.icon, category: true });
  total += await render(svg, path.join(out.categoryMobile, `${category.slug}.webp`), 320);
  total += await render(svg, path.join(out.categoryWeb, `${category.slug}.webp`), 320);
  count += 1;
}

for (const service of serviceIcons) {
  if (only && !only.has(service.slug)) continue;
  const color = categoryColor.get(service.category) ?? '#1f6fee';
  const svg = sceneSvg({ slug: service.slug, categoryColor: color, icon: service.icon });
  total += await render(svg, path.join(out.serviceSmall, `${service.slug}.webp`), 160);
  const large = await render(svg, path.join(out.serviceLarge, `${service.slug}.webp`), 480);
  total += large;
  fs.writeFileSync(path.join(out.serviceWeb, `${service.slug}.webp`), fs.readFileSync(path.join(out.serviceLarge, `${service.slug}.webp`)));
  count += 1;
}

/* ------------------- the app's and API's bundled-slug index ----------------- */

const allSlugs = serviceIcons.map((service) => service.slug).sort();
const dartList = allSlugs.map((slug) => `  '${slug}',`).join('\n');
const dartFile = path.join(root, 'apps/mobile/lib/core/bundled_art.dart');
fs.writeFileSync(dartFile, `// GENERATED by tools/service-art/build.mjs — do not edit by hand.
//
// Every service that ships its illustration inside the APK. Services created
// from the admin panel after this build are absent here and fall back to the
// vector glyph until the next build, which is why the list is explicit rather
// than "try the asset and see".

/// Slugs with a bundled illustration in \`assets/service_art/\`.
const bundledServiceArt = <String>{
${dartList}
};

/// Slugs with a bundled illustration in \`assets/category_art/\`.
const bundledCategoryArt = <String>{
${categories.map((category) => `  '${category.slug}',`).join('\n')}
};
`);

const tsList = allSlugs.map((slug) => `  '${slug}',`).join('\n');
const tsFile = path.join(root, 'apps/api/src/modules/catalog/bundled-artwork.ts');
fs.writeFileSync(tsFile, `/**
 * GENERATED by tools/service-art/build.mjs — do not edit by hand.
 *
 * The slugs that ship a generated illustration in
 * \`apps/web/public/images/services/art/\`. Kept next to the catalogue so
 * artwork resolution and the build script can never disagree.
 */
export const BUNDLED_SERVICE_ART: ReadonlySet<string> = new Set([
${tsList}
]);

export const BUNDLED_CATEGORY_ART: ReadonlySet<string> = new Set([
${categories.map((category) => `  '${category.slug}',`).join('\n')}
]);
`);

console.log(`rendered ${count} tiles (${(total / 1024 / 1024).toFixed(2)} MB across all variants)`);
console.log(`indexed ${allSlugs.length} services and ${categories.length} categories`);
