import fs from 'node:fs';
import { inspectImage, ImageRejectedError, type ImagePolicy, DEFAULT_POLICY } from './image.js';

/**
 * Upload validation that does not trust anything the client says.
 *
 * The extension is used only to pick the expected signature; the signature is
 * what decides. The stored filename is always generated from the verified MIME
 * type, never from the uploaded name.
 */

export const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export interface SignatureResult {
  mime: string | null;
  detail: string;
}

/** Read the first bytes of a file and identify it by magic number. */
export function sniffSignature(filePath: string): SignatureResult {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(32);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, read);
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mime: 'image/jpeg', detail: 'JPEG' };
    }
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { mime: 'image/png', detail: 'PNG' };
    }
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
      return { mime: 'image/webp', detail: 'WEBP' };
    }
    if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
      return { mime: 'application/pdf', detail: 'PDF' };
    }
    // Known but unsupported signatures get a precise message instead of "unknown".
    if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'GIF8') return { mime: null, detail: 'GIF' };
    if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d))) {
      return { mime: null, detail: 'TIFF' };
    }
    if (bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'PK') return { mime: null, detail: 'ZIP/OOXML' };
    if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x21) return { mime: null, detail: 'PostScript' };
    return { mime: null, detail: 'نامشخص' };
  } finally {
    fs.closeSync(fd);
  }
}

export interface PdfCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Structural PDF checks. Active content (JavaScript, launch actions, embedded
 * files, rich media) is refused: these documents are uploaded by customers and
 * opened by staff.
 */
export function inspectPdf(filePath: string, size: number): PdfCheck {
  if (size < 64) return { ok: false, reason: 'فایل PDF بسیار کوچک و ناقص است.' };
  const head = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  let headRead = 0;
  let tail = '';
  try {
    headRead = fs.readSync(fd, head, 0, head.length, 0);
    const tailLength = Math.min(4096, size);
    const tailBuffer = Buffer.alloc(tailLength);
    fs.readSync(fd, tailBuffer, 0, tailLength, Math.max(0, size - tailLength));
    tail = tailBuffer.toString('latin1');
  } finally {
    fs.closeSync(fd);
  }
  if (head.toString('ascii', 0, Math.min(5, headRead)) !== '%PDF-') {
    return { ok: false, reason: 'امضای فایل PDF معتبر نیست.' };
  }
  if (!tail.includes('%%EOF')) return { ok: false, reason: 'ساختار PDF کامل نیست (پایان فایل یافت نشد).' };
  const body = fs.readFileSync(filePath).toString('latin1');
  const active = [
    { pattern: /\/JavaScript\b/, label: 'JavaScript' },
    { pattern: /\/JS\s*[(<]/, label: 'JavaScript' },
    { pattern: /\/Launch\b/, label: 'Launch action' },
    { pattern: /\/EmbeddedFile\b/, label: 'Embedded file' },
    { pattern: /\/RichMedia\b/, label: 'Rich media' },
    { pattern: /\/OpenAction\b/, label: 'Open action' },
  ].find((entry) => entry.pattern.test(body));
  if (active) return { ok: false, reason: `PDF دارای محتوای فعال (${active.label}) پذیرفته نمی‌شود.` };
  return { ok: true };
}

/** Strip directories and control characters; keep the name readable for humans. */
export function safeDisplayName(name: string, fallback = 'document'): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

export interface UploadValidation {
  mime: string;
  extension: string;
  signature: string;
}

export async function validateUploadContent(options: {
  filePath: string;
  originalName: string;
  size: number;
  allowedTypes: string[];
  imagePolicy?: ImagePolicy;
}): Promise<UploadValidation> {
  const extension = (options.originalName.split('.').pop() ?? '').toLowerCase();
  const expected = MIME_BY_EXTENSION[extension];
  const signature = sniffSignature(options.filePath);
  if (!expected) {
    throw Object.assign(new Error(`پسوند .${extension || '—'} مجاز نیست. فرمت‌های مجاز: ${options.allowedTypes.join(', ')}`), {
      statusCode: 400,
    });
  }
  if (!options.allowedTypes.includes(extension)) {
    throw Object.assign(new Error(`پسوند .${extension} در تنظیمات سامانه مجاز نشده است.`), { statusCode: 400 });
  }
  if (!signature.mime) {
    throw Object.assign(new Error(`محتوای فایل با قالب مجاز مطابقت ندارد (شناسایی: ${signature.detail}).`), { statusCode: 400 });
  }
  if (signature.mime !== expected) {
    throw Object.assign(new Error('پسوند فایل با محتوای واقعی آن یکسان نیست.'), { statusCode: 400 });
  }
  if (signature.mime === 'application/pdf') {
    const pdf = inspectPdf(options.filePath, options.size);
    if (!pdf.ok) throw Object.assign(new Error(pdf.reason ?? 'فایل PDF معتبر نیست.'), { statusCode: 400 });
  }
  if (signature.mime.startsWith('image/')) {
    // A file that cannot be decoded is not a document: refuse it now instead of
    // storing an unreadable "successful" upload.
    try {
      await inspectImage(options.filePath, options.imagePolicy ?? DEFAULT_POLICY);
    } catch (error) {
      const message = error instanceof ImageRejectedError ? error.message : 'تصویر قابل خواندن نیست.';
      throw Object.assign(new Error(message), { statusCode: 400 });
    }
  }
  return { mime: signature.mime, extension, signature: signature.detail };
}
