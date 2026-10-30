/**
 * Theme contrast gate.
 *
 * Reads the primitive tokens from `src/styles.css` (`:root` for light, `.dark`
 * for the dark theme), computes WCAG 2.1 contrast for the text/background pairs
 * the UI actually uses, and fails when a pair drops below its target.
 *
 *   node scripts/check-theme-contrast.mjs
 *
 * Limits: values must be plain hex colours (no color-mix) — that is how the
 * text and surface tokens are defined on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(here, '../src/styles.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector ${selector} not found`);
  let depth = 0;
  let i = css.indexOf('{', start);
  const from = i + 1;
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(from, i);
    }
  }
  throw new Error(`unterminated block ${selector}`);
}

function tokens(source) {
  const map = {};
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    map[match[1]] = match[2];
  }
  return map;
}

const light = tokens(block(':root {'));
const dark = { ...light, ...tokens(block('\n.dark {')) };

function rgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** [label, foreground token, background token, minimum ratio] */
const pairs = [
  ['متن اصلی روی پس‌زمینه', '--navy-900', '--canvas', 7],
  ['متن اصلی روی کارت', '--navy-900', '--surface', 7],
  ['متن ثانویه روی کارت', '--navy-500', '--surface', 4.5],
  ['راهنمای ریز روی کارت', '--navy-400', '--surface', 3.5],
  ['عنوان جدول روی سرستون', '--navy-600', '--surface-2', 4.5],
  ['متن جدول', '--navy-800', '--surface', 7],
  ['لینک/تأکید روی کارت', '--accent', '--surface', 4.5],
  ['لینک/تأکید روی نوار روشن', '--accent', '--brand-50', 4.5],
  ['متن دکمه اصلی', '--primary-fg', '--primary', 4.5],
  ['متن سایدبار', '--shell-fg', '--shell', 7],
  ['متن کم‌رنگ سایدبار', '--shell-muted', '--shell', 4.5],
  ['نشان موفقیت', '--color-emerald-700', '--color-emerald-50', 4.5],
  ['نشان خطا', '--color-rose-700', '--color-rose-50', 4.5],
  ['نشان هشدار', '--color-amber-800', '--color-amber-50', 4.5],
  ['نشان اطلاع', '--color-sky-700', '--color-sky-50', 4.5],
  ['سفید روی دکمه برند', '#ffffff', '--brand-700', 4.5],
  ['سفید روی نشان خطا', '#ffffff', '--color-rose-600', 4.5],
  ['سفید روی نشان موفقیت', '#ffffff', '--color-emerald-600', 4.5],
  ['سفید روی نشان هشدار', '#ffffff', '--color-amber-600', 4.5],
];

let failed = 0;
for (const [themeName, theme] of [['روشن', light], ['تیره', dark]]) {
  console.log(`\n${themeName}`);
  console.log('| سنجه | پیش‌زمینه | نسبت | حد | نتیجه |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const [label, fg, bg, min] of pairs) {
    const fgValue = fg.startsWith('#') ? fg : theme[fg];
    const bgValue = bg.startsWith('#') ? bg : theme[bg];
    if (!fgValue || !bgValue) {
      console.log(`| ${label} | ${bg} | — | ${min} | توکن پیدا نشد |`);
      failed += 1;
      continue;
    }
    const ratio = contrast(fgValue, bgValue);
    const pass = ratio >= min;
    if (!pass) failed += 1;
    console.log(`| ${label} | ${bg} ${bgValue} | ${ratio.toFixed(2)}:1 | ${min}:1 | ${pass ? 'قبول' : '**رد**'} |`);
  }
}

console.log(failed === 0 ? '\nهمهٔ جفت‌های رنگ از حد WCAG عبور کردند.' : `\n${failed} جفت رنگ زیر حد است.`);
process.exit(failed === 0 ? 0 : 1);
