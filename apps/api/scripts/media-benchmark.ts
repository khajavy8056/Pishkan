/**
 * Reproducible media-pipeline benchmark.
 *
 * Generates synthetic documents (no customer data), runs the same code path the
 * upload endpoint uses, and prints a Markdown table with the measured numbers.
 *
 *   npm run media:benchmark --workspace apps/api
 *
 * The fixtures are written to a temporary directory and deleted afterwards.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { processImage, detectDocumentLikeness } from '../src/modules/media/image.js';
import { inspectPdf, validateUploadContent } from '../src/modules/media/validation.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pishkan-media-bench-'));

function docSvg(width: number, height: number, title: string) {
  const lines = Array.from({ length: 26 }, (_, index) => (
    `<text x="90" y="${420 + index * 60}" font-size="34" font-family="sans-serif" fill="#1a1a1a">` +
    `${title} — ردیف ${index + 1}: شماره ${(index + 1) * 7919} | مقدار ۱۲۳۴۵۶۷۸۹۰</text>`
  )).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#f7f4ee"/>
    <text x="90" y="180" font-size="58" font-family="sans-serif" fill="#111">${title}</text>
    <text x="90" y="270" font-size="30" font-family="monospace" fill="#333">0012345678 · 1402/05/12 · IR-9988776655</text>
    ${lines}
  </svg>`;
}

async function photo(width: number, height: number, noiseSeed: number) {
  const raw = Buffer.alloc(width * height * 3);
  let seed = noiseSeed;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const noise = random() * 26;
      raw[i] = Math.min(255, Math.round((x * 255) / width + noise));
      raw[i + 1] = Math.min(255, Math.round((y * 255) / height + noise));
      raw[i + 2] = Math.min(255, Math.round(128 + 96 * Math.sin(x / 90) + noise));
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

interface Row {
  name: string;
  note: string;
  inputBytes: number;
  outputBytes: number;
  savings: string;
  dims: string;
  mode: string;
  meanDiff: string;
  edgeRatio: string;
  ms: number;
  documentLike: boolean;
  result: string;
}

const rows: Row[] = [];

async function measure(name: string, note: string, buffer: Buffer, extension: string) {
  const file = path.join(dir, `${name}.${extension}`);
  fs.writeFileSync(file, buffer);
  const started = Date.now();
  try {
    const likeness = await detectDocumentLikeness(file);
    const processed = await processImage(file, { originalSize: buffer.length });
    const ms = Date.now() - started;

    // Independent readability measurement at native resolution.
    const a = await sharp(buffer).rotate().flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(processed.display).rotate().flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < a.data.length; i += 1) sum += Math.abs(a.data[i]! - b.data[i]!);
    const energy = (data: Buffer, width: number, height: number) => {
      let total = 0;
      for (let y = 0; y < height - 1; y += 1) for (let x = 0; x < width - 1; x += 1) {
        const i = y * width + x;
        total += Math.abs(data[i]! - data[i + 1]!) + Math.abs(data[i]! - data[i + width]!);
      }
      return total / Math.max(1, (width - 1) * (height - 1));
    };
    const meanDiff = sum / a.data.length;
    const edgeRatio = energy(a.data, a.info.width, a.info.height) > 0
      ? energy(b.data, b.info.width, b.info.height) / energy(a.data, a.info.width, a.info.height)
      : 1;
    rows.push({
      name,
      note,
      inputBytes: buffer.length,
      outputBytes: processed.displaySize,
      savings: `${processed.savingsPercent.toFixed(1)}%`,
      dims: `${processed.originalWidth}×${processed.originalHeight} → ${processed.width}×${processed.height}`,
      mode: processed.displayMode,
      meanDiff: meanDiff.toFixed(3),
      edgeRatio: edgeRatio.toFixed(4),
      ms,
      documentLike: likeness.documentLike,
      result: processed.displaySize <= buffer.length || processed.displayMode === 'original' ? 'قبول' : 'رد',
    });
  } catch (error) {
    rows.push({
      name, note, inputBytes: buffer.length, outputBytes: 0, savings: '—', dims: '—', mode: '—',
      meanDiff: '—', edgeRatio: '—', ms: Date.now() - started, documentLike: false,
      result: `خطا: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

const cardPng = await sharp(Buffer.from(docSvg(1600, 1000, 'کارت ملی'))).png().toBuffer();
const cardJpeg = await sharp(Buffer.from(docSvg(1600, 1000, 'کارت ملی'))).jpeg({ quality: 88 }).toBuffer();
const certificate = await sharp(Buffer.from(docSvg(1700, 2300, 'شناسنامه'))).greyscale().jpeg({ quality: 88 }).toBuffer();
const camera = await photo(3000, 2000, 7);
const smallPhoto = await photo(1400, 900, 11);
const lowRes = await sharp(Buffer.from(docSvg(1600, 1000, 'کارت ملی'))).resize(180, 110).png().toBuffer();
const rotatedBase = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#ffffff' } })
  .composite([{ input: await sharp(Buffer.from(docSvg(760, 1160, 'مدرک'))).png().toBuffer(), top: 20, left: 20 }])
  .jpeg({ quality: 92 }).toBuffer();
const rotated = await sharp(rotatedBase).withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer();
const colorfulPng = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } })
  .composite([{ input: await sharp(Buffer.from(docSvg(1200, 800, 'نمودار'))).png().toBuffer(), top: 0, left: 0, blend: 'over' }])
  .png().toBuffer();

const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 2>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\nstartxref\n0\n%%EOF\n',
);

await measure('national-card-png', 'کارت ملی، نوشته ریز، PNG', cardPng, 'png');
await measure('national-card-jpeg', 'کارت ملی، اسکن JPEG q88', cardJpeg, 'jpg');
await measure('birth-certificate-grayscale', 'شناسنامه سیاه‌وسفید A4', certificate, 'jpg');
await measure('camera-photo-6mp', 'عکس رنگی ۶ مگاپیکسل', camera, 'jpg');
await measure('photo-1.2mp', 'عکس رنگی کوچک‌تر', smallPhoto, 'jpg');
await measure('low-res', 'اسکن کم‌رزولوشن ۱۸۰×۱۱۰', lowRes, 'png');
await measure('exif-rotated', 'تصویر چرخیده با EXIF orientation 6', rotated, 'jpg');
await measure('colorful-png', 'تصویر رنگی با متن', colorfulPng, 'png');

console.log('\n| # | نمونه | حجم اولیه | حجم WebP | کاهش حجم | ابعاد | حالت | اختلاف میانگین پیکسل | حفظ لبه | زمان | نتیجه |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
rows.forEach((row, index) => {
  console.log(`| ${index + 1} | ${row.name} (${row.note}) | ${row.inputBytes.toLocaleString('en-US')} B | ${row.outputBytes.toLocaleString('en-US')} B | ${row.savings} | ${row.dims} | ${row.mode} | ${row.meanDiff} | ${row.edgeRatio} | ${row.ms}ms | ${row.result} |`);
});

// Rejection cases
const badExt = path.join(dir, 'fake.jpg');
fs.writeFileSync(badExt, cardPng);
const corrupt = path.join(dir, 'corrupt.jpg');
fs.writeFileSync(corrupt, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300)]));
const maliciousPdf = path.join(dir, 'active.pdf');
fs.writeFileSync(maliciousPdf, Buffer.from('%PDF-1.4\n1 0 obj<</OpenAction 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'));
const check = async (label: string, fn: () => Promise<unknown>) => {
  try { await fn(); console.log(`- ${label}: پذیرفته شد (نامطلوب)`); }
  catch (error) { console.log(`- ${label}: رد شد → ${error instanceof Error ? error.message : String(error)}`); }
};

console.log('\nبررسی‌های امنیتی:');
fs.writeFileSync(path.join(dir, 'valid.pdf'), pdf);
console.log(`- ساختار PDF سالم: ${inspectPdf(path.join(dir, 'valid.pdf'), pdf.length).ok ? 'قبول' : 'رد'}`);
await check('پسوند جعلی (PNG با نام .jpg)', () => validateUploadContent({ filePath: badExt, originalName: 'fake.jpg', size: cardPng.length, allowedTypes: ['jpg', 'png'] }));
await check('فایل خراب با امضای JPEG', () => validateUploadContent({ filePath: corrupt, originalName: 'corrupt.jpg', size: 304, allowedTypes: ['jpg'] }));
await check('PDF با محتوای فعال', () => validateUploadContent({ filePath: maliciousPdf, originalName: 'active.pdf', size: fs.statSync(maliciousPdf).size, allowedTypes: ['pdf'] }));
console.log(`- PDF چندصفحه‌ای: ${inspectPdf(path.join(dir, 'valid.pdf'), pdf.length).ok ? 'قبول (بدون تبدیل)' : 'رد'}`);

fs.rmSync(dir, { recursive: true, force: true });
