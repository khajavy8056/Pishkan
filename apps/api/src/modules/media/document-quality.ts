import sharp from 'sharp';

/**
 * A conservative screen for obviously unusable photographs, not OCR, document
 * classification, identity verification, or expert approval. PDF pages are not
 * rendered here. Metrics run on the original pixels, before compression.
 */
export async function checkDocumentPhoto(filePath: string): Promise<{ ok: boolean; reason?: string }> {
  const meta = await sharp(filePath, { limitInputPixels: 50_000_000 }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (Math.min(width, height) < 360 || Math.max(width, height) < 600) {
    return { ok: false, reason: 'تصویر مدرک بسیار کوچک است. عکس تازه و واضح‌تری از اصل مدرک بگیرید.' };
  }
  const { data, info } = await sharp(filePath, { limitInputPixels: 50_000_000 })
    .rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, sum2 = 0, lapSum = 0, lapSum2 = 0, count = 0;
  for (let y = 1; y < info.height - 1; y++) {
    for (let x = 1; x < info.width - 1; x++) {
      const i = y * info.width + x;
      const v = data[i];
      const lap = 4 * v - data[i - 1] - data[i + 1] - data[i - info.width] - data[i + info.width];
      sum += v; sum2 += v * v; lapSum += lap; lapSum2 += lap * lap; count++;
    }
  }
  const contrast = Math.sqrt(Math.max(0, sum2 / count - (sum / count) ** 2));
  const sharpness = lapSum2 / count - (lapSum / count) ** 2;
  if (contrast < 9 || sharpness < 12) {
    return { ok: false, reason: 'تصویر مدرک تار یا کم‌جزئیات است. در نور مناسب، بدون لرزش و از نزدیک دوباره عکس بگیرید.' };
  }
  return { ok: true };
}
