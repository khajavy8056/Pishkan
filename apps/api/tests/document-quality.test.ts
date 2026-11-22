import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkDocumentPhoto } from '../src/modules/media/document-quality.js';

describe('document photo screening', () => {
  it('rejects blank, tiny and heavily blurred source images but accepts a sharp sample', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pishkan-quality-'));
    try {
      const svg = Buffer.from(`<svg width="1000" height="650"><rect width="100%" height="100%" fill="white"/><text x="65" y="150" font-size="48" fill="black">Identity document sample</text><text x="65" y="280" font-size="32">123456789 987654321</text><text x="65" y="400" font-size="36">Readable text and clear details</text></svg>`);
      const sharpFile = path.join(dir, 'sharp.png');
      const blur = path.join(dir, 'blur.png');
      const blank = path.join(dir, 'blank.png');
      const tiny = path.join(dir, 'tiny.png');
      await sharp(svg).png().toFile(sharpFile);
      await sharp(svg).blur(15).png().toFile(blur);
      await sharp({ create: { width: 1000, height: 650, channels: 3, background: 'white' } }).png().toFile(blank);
      await sharp(svg).resize(300, 195).png().toFile(tiny);
      expect((await checkDocumentPhoto(sharpFile)).ok).toBe(true);
      expect((await checkDocumentPhoto(blur)).ok).toBe(false);
      expect((await checkDocumentPhoto(blank)).ok).toBe(false);
      expect((await checkDocumentPhoto(tiny)).ok).toBe(false);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
