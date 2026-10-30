#!/usr/bin/env node
/**
 * Generates windows/assets/pishkan.ico and pishkan-logo.png from pure code.
 *
 * No font rasteriser and no binary asset in the repository history: the mark is
 * drawn with signed-distance maths (rounded square + three ascending bars) and
 * encoded as PNG (zlib) and ICO (PNG payload, supported by Windows Vista+).
 *
 *   node windows/lib/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MODULE_DIR } from './common.mjs';

const OUT_DIR = path.resolve(MODULE_DIR, '..', 'assets');

function crc32(buffer) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, sum]);
}

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function roundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

function renderPng(size) {
  const ss = 3; // supersampling factor for anti-aliasing
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const fx = (x + (sx + 0.5) / ss) / size;
          const fy = (y + (sy + 0.5) / ss) / size;
          const inSquare = roundedRect(fx, fy, 0.5, 0.5, 0.46, 0.46, 0.14) <= 0;
          if (!inSquare) continue;
          // vertical gradient #1D5FD8 → #2F7BF6
          const t = fy;
          let cr = 29 + (47 - 29) * t;
          let cg = 95 + (123 - 95) * t;
          let cb = 216 + (246 - 216) * t;
          // three ascending white bars
          const bars = [
            { x0: 0.24, x1: 0.35, y0: 0.60, y1: 0.74 },
            { x0: 0.395, x1: 0.505, y0: 0.46, y1: 0.74 },
            { x0: 0.55, x1: 0.66, y0: 0.30, y1: 0.74 },
          ];
          const inBar = bars.some((bar) => fx > bar.x0 && fx < bar.x1
            && fy > bar.y0 && fy < bar.y1
            && roundedRect(fx, fy, (bar.x0 + bar.x1) / 2, (bar.y0 + bar.y1) / 2,
              (bar.x1 - bar.x0) / 2, (bar.y1 - bar.y0) / 2, 0.025) <= 0);
          if (inBar) {
            cr = 255; cg = 255; cb = 255;
          }
          r += cr; g += cg; b += cb; a += 255;
        }
      }
      const samples = ss * ss;
      const index = (y * size + x) * 4;
      const alpha = a / samples;
      if (alpha > 0) {
        px[index] = Math.round(r / (alpha / 255) / samples);
        px[index + 1] = Math.round(g / (alpha / 255) / samples);
        px[index + 2] = Math.round(b / (alpha / 255) / samples);
      }
      px[index + 3] = Math.round(alpha);
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, data: renderPng(size) }));
const ico = buildIco(images);
fs.writeFileSync(path.join(OUT_DIR, 'pishkan.ico'), ico);
fs.writeFileSync(path.join(OUT_DIR, 'pishkan-logo.png'), renderPng(512));
process.stdout.write(`pishkan.ico ${(ico.length / 1024).toFixed(1)} KB · sizes ${sizes.join(', ')}\n`);
