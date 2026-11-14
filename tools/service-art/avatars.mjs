#!/usr/bin/env node
/**
 * The 24 default avatars.
 *
 * Same visual grammar as the service tiles (soft 3D, gentle highlights, brand
 * hues) but drawn as friendly busts: a shoulders/body shape, a head, a softly
 * shaded face and a hairstyle that varies per id. 1-12 read feminine, 13-24
 * masculine, so `chooseAvatarPreset` can enforce the customer's gender choice
 * while still offering twelve different looks in each set.
 *
 * Written to
 *   apps/mobile/assets/avatars/preset-NN.webp     192px (rendered in the app)
 *   apps/web/public/images/avatars/preset-NN.webp 256px (web + API)
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

const outApp = path.join(root, 'apps/mobile/assets/avatars');
const outWeb = path.join(root, 'apps/web/public/images/avatars');
fs.mkdirSync(outApp, { recursive: true });
fs.mkdirSync(outWeb, { recursive: true });

// Background washes and skin tones cycle so a comment list never looks cloned.
const WASHES = ['#E8F0FF', '#E6F7F1', '#FDF0E7', '#F1EAFE', '#E9F4FF', '#FEF3E2'];
const SKINS = ['#F2C8A8', '#E8B08C', '#D89B72', '#C98B63', '#B87A52', '#F7D6BD'];
const HAIRS = ['#2B2118', '#3D2A1E', '#5A3A24', '#1F1A17', '#704A2E', '#412F3F'];
const SHIRTS = ['#2E6BEE', '#16A34A', '#0E7490', '#7C3AED', '#DB2777', '#B45309', '#475569'];

const pick = (list, index) => list[((index % list.length) + list.length) % list.length];

function avatarSvg(index, feminine) {
  const wash = pick(WASHES, index);
  const skin = pick(SKINS, index * 3 + (feminine ? 1 : 2));
  const hair = pick(HAIRS, index * 5 + (feminine ? 0 : 1));
  const shirt = pick(SHIRTS, index * 2 + (feminine ? 1 : 0));
  const hairStyle = index % 6;
  const id = `a${index}`;

  // Hair silhouettes: bob, long, bun, short, crop, wavy.
  const longHair = feminine
    ? `<path d="M138 196 q0 -86 118 -86 q118 0 118 86 v72 q-20 -40 -34 -44 q10 -60 -84 -60 q-94 0 -84 60 q-14 4 -34 44 z" fill="url(#${id}hair)"/>`
    : `<path d="M146 194 q0 -74 110 -74 q110 0 110 74 q-26 -34 -110 -34 q-84 0 -110 34 z" fill="url(#${id}hair)"/>`;
  const bun = feminine && hairStyle === 2
    ? `<circle cx="256" cy="104" r="30" fill="url(#${id}hair)"/><circle cx="256" cy="104" r="30" fill="#ffffff" opacity="0.08"/>`
    : '';
  const sideLocks = feminine
    ? `<path d="M150 214 q-12 78 4 118 q-30 -26 -30 -92 z" fill="url(#${id}hair)" opacity="0.92"/>
       <path d="M362 214 q12 78 -4 118 q30 -26 30 -92 z" fill="url(#${id}hair)" opacity="0.92"/>`
    : '';
  const fringe = feminine
    ? `<path d="M170 200 q18 -58 86 -58 q68 0 86 58 q-34 -22 -86 -22 q-52 0 -86 22 z" fill="url(#${id}hair)"/>`
    : `<path d="M172 198 q10 -52 84 -52 q74 0 84 52 q-40 -16 -84 -16 q-44 0 -84 16 z" fill="url(#${id}hair)"/>`;
  const lashes = feminine
    ? `<path d="M206 244 q20 -10 38 0" stroke="#2B2118" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.85"/>
       <path d="M268 244 q18 -10 38 0" stroke="#2B2118" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.85"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="${id}bg" cx="50%" cy="26%" r="86%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="62%" stop-color="${wash}"/>
      <stop offset="100%" stop-color="${wash}"/>
    </radialGradient>
    <linearGradient id="${id}skin" x1="20%" y1="8%" x2="80%" y2="96%">
      <stop offset="0%" stop-color="${skin}" stop-opacity="1"/>
      <stop offset="68%" stop-color="${skin}" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.10"/>
    </linearGradient>
    <linearGradient id="${id}hair" x1="18%" y1="6%" x2="82%" y2="94%">
      <stop offset="0%" stop-color="${hair}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>
    </linearGradient>
    <linearGradient id="${id}shirt" x1="14%" y1="4%" x2="86%" y2="96%">
      <stop offset="0%" stop-color="${shirt}"/>
      <stop offset="100%" stop-color="#0B1F3A" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="${id}gloss" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="${id}soft" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#0B1F3A" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#${id}bg)"/>
  <circle cx="256" cy="238" r="180" fill="#ffffff" opacity="0.55"/>
  <g filter="url(#${id}soft)">
    <!-- shoulders -->
    <path d="M92 512 q0 -132 164 -132 q164 0 164 132 z" fill="url(#${id}shirt)"/>
    <path d="M92 512 q0 -132 164 -132 q164 0 164 132 z" fill="url(#${id}gloss)" opacity="0.18"/>
    <!-- neck -->
    <rect x="226" y="286" width="60" height="72" rx="26" fill="${skin}"/>
    <!-- head -->
    <ellipse cx="256" cy="216" rx="98" ry="106" fill="url(#${id}skin)"/>
    <!-- ears -->
    <ellipse cx="158" cy="222" rx="15" ry="22" fill="${skin}"/>
    <ellipse cx="354" cy="222" rx="15" ry="22" fill="${skin}"/>
    ${longHair}
    ${bun}
    ${fringe}
    ${sideLocks}
    ${lashes}
    <!-- eyes -->
    <ellipse cx="224" cy="228" rx="9" ry="11" fill="#25324A"/>
    <ellipse cx="288" cy="228" rx="9" ry="11" fill="#25324A"/>
    <circle cx="227" cy="224" r="3" fill="#ffffff" opacity="0.9"/>
    <circle cx="291" cy="224" r="3" fill="#ffffff" opacity="0.9"/>
    <!-- cheeks + smile -->
    <ellipse cx="204" cy="262" rx="16" ry="10" fill="#FF8FA3" opacity="0.28"/>
    <ellipse cx="308" cy="262" rx="16" ry="10" fill="#FF8FA3" opacity="0.28"/>
    <path d="M232 276 q24 20 48 0" stroke="#8A4B3A" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.65"/>
    <!-- collar -->
    <path d="M208 388 q48 40 96 0 q-48 18 -96 0 z" fill="#ffffff" opacity="0.7"/>
  </g>
</svg>`;
}

let total = 0;
for (let index = 0; index < 24; index += 1) {
  const preset = index + 1;
  const feminine = preset <= 12;
  const svg = Buffer.from(avatarSvg(preset, feminine));
  const name = `preset-${String(preset).padStart(2, '0')}.webp`;
  const small = await sharp(svg, { density: 384 }).resize(192, 192).webp({ quality: 88, effort: 5 }).toBuffer();
  const large = await sharp(svg, { density: 384 }).resize(256, 256).webp({ quality: 88, effort: 5 }).toBuffer();
  fs.writeFileSync(path.join(outApp, name), small);
  fs.writeFileSync(path.join(outWeb, name), large);
  total += small.length + large.length;
}
console.log(`24 avatars, ${(total / 1024).toFixed(1)} KB total`);
