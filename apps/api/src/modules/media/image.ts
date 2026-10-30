import fs from 'node:fs/promises';
import sharp from 'sharp';

type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
type SharpInstance = ReturnType<typeof sharp>;
type SharpWebpOptions = NonNullable<Parameters<SharpInstance['webp']>[0]>;

/**
 * Image optimisation for customer documents.
 *
 * Quality contract (in priority order, never traded away for file size):
 *   1. never lose resolution, never crop, never re-encode twice,
 *   2. apply the EXIF orientation so the reader sees the document upright,
 *   3. prefer lossless WebP; when lossless cannot shrink the file, only use
 *      near-lossless/lossy when a pixel-level quality gate still passes,
 *   4. document-like scans never take the lossy path at all,
 *   5. if nothing is both smaller *and* faithful, keep the original bytes.
 *
 * The gate is a real measurement between the normalised source and the
 * candidate output: mean absolute difference, high-percentile difference and
 * retained gradient (edge) energy. A candidate that blurs small print fails it.
 */

export type QualityMode = 'quality_first' | 'balanced' | 'lossless_only';

export interface ImagePolicy {
  qualityMode: QualityMode;
  /** Savings (percent) a candidate must reach to be preferred at its quality tier. */
  targetSavingsPercent: number;
  /** Minimum savings for any replacement to be accepted at all. */
  minSavingsPercent: number;
  maxPixels: number;
  /** 0 keeps the original pixel dimensions (default). */
  maxDimension: number;
  previewMaxWidth: number;
  /** Highest lossy quality tier that is tried first. */
  lossyQuality: number;
}

export const DEFAULT_POLICY: ImagePolicy = {
  qualityMode: 'quality_first',
  targetSavingsPercent: 70,
  minSavingsPercent: 8,
  maxPixels: 50_000_000,
  maxDimension: 0,
  previewMaxWidth: 640,
  lossyQuality: 95,
};

export const SUPPORTED_IMAGE_MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

export type SupportedImageFormat = keyof typeof SUPPORTED_IMAGE_MIME;

/** Input formats we accept for decoding (they are all re-encoded to WebP). */
export const DECODABLE_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'tiff', 'gif', 'avif'] as const;

sharp.cache({ memory: 64, files: 20, items: 100 });
sharp.concurrency(Math.max(1, Math.min(2, Number(process.env.SHARP_CONCURRENCY ?? 2))));

export class ImageRejectedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ImageRejectedError';
  }
}

export interface SourceInfo {
  format: string;
  width: number;
  height: number;
  space: string;
  hasAlpha: boolean;
  orientation: number;
  size: number;
}

/** Decode-level inspection. Throws ImageRejectedError for corrupt/oversized input. */
export async function inspectImage(filePath: string, policy: ImagePolicy = DEFAULT_POLICY): Promise<SourceInfo> {
  let meta: SharpMetadata;
  try {
    meta = await sharp(filePath, { limitInputPixels: policy.maxPixels, failOn: 'error' }).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/pixel limit|too large|exceeds/i.test(message)) {
      throw new ImageRejectedError('image_too_large', 'ابعاد تصویر بیش از حد مجاز است.');
    }
    throw new ImageRejectedError('image_corrupt', 'تصویر قابل خواندن نیست یا فایل خراب است.');
  }
  const format = String(meta.format ?? '');
  if (!(DECODABLE_INPUT_FORMATS as readonly string[]).includes(format)) {
    throw new ImageRejectedError('image_format', `قالب تصویر ${format || 'ناشناخته'} پشتیبانی نمی‌شود.`);
  }
  if (!meta.width || !meta.height) throw new ImageRejectedError('image_corrupt', 'ابعاد تصویر قابل تشخیص نیست.');
  if (meta.width * meta.height > policy.maxPixels) {
    throw new ImageRejectedError('image_too_large', 'ابعاد تصویر بیش از حد مجاز است.');
  }
  return {
    format,
    width: meta.width,
    height: meta.height,
    space: String(meta.space ?? 'srgb'),
    hasAlpha: Boolean(meta.hasAlpha),
    orientation: Number(meta.orientation ?? 1),
    size: meta.size ?? 0,
  };
}

interface Grid {
  data: Buffer;
  width: number;
  height: number;
  energy: number;
}

const GRID_MAX_DIMENSION = 4000;
const GRID_MAX_PIXELS = 12_000_000;

/** Normalised, orientation-corrected grayscale grid used for quality checks. */
async function qualityGrid(input: string | Buffer, policy: ImagePolicy): Promise<Grid> {
  const { data, info } = await sharp(input, { limitInputPixels: policy.maxPixels, failOn: 'error' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    // Compare at native resolution whenever it fits the budget: downscaling
    // both sides hides exactly the fine-print damage this gate exists to catch.
    .resize({ width: GRID_MAX_DIMENSION, height: GRID_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width * info.height > GRID_MAX_PIXELS) {
    throw new ImageRejectedError('image_too_large', 'تصویر برای ارزیابی کیفیت بیش از حد بزرگ است.');
  }
  let energy = 0;
  for (let y = 0; y < info.height - 1; y += 1) {
    for (let x = 0; x < info.width - 1; x += 1) {
      const i = y * info.width + x;
      energy += Math.abs(data[i]! - data[i + 1]!) + Math.abs(data[i]! - data[i + info.width]!);
    }
  }
  const pixels = Math.max(1, (info.width - 1) * (info.height - 1));
  return { data, width: info.width, height: info.height, energy: energy / pixels };
}

interface QualityMetrics {
  meanDiff: number;
  p999Diff: number;
  edgeRatio: number;
}

function compareGrids(source: Grid, candidate: Grid): QualityMetrics {
  if (source.width !== candidate.width || source.height !== candidate.height) {
    return { meanDiff: 255, p999Diff: 255, edgeRatio: 0 };
  }
  let sum = 0;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < source.data.length; i += 1) {
    const d = Math.abs(source.data[i]! - candidate.data[i]!);
    sum += d;
    histogram[d] += 1;
  }
  const total = source.data.length || 1;
  let acc = 0;
  let p999 = 255;
  const cutoff = total * 0.999;
  for (let d = 0; d < 256; d += 1) {
    acc += histogram[d]!;
    if (acc >= cutoff) { p999 = d; break; }
  }
  // Near-flat images carry no measurable edge energy; the ratio is meaningless there.
  const edgeRatio = source.energy > 0.02 ? candidate.energy / source.energy : 1;
  return { meanDiff: sum / total, p999Diff: p999, edgeRatio };
}

/**
 * Quality gate applied to every candidate that is not bit-exact.
 *
 * Near-lossless is held to a stricter standard because it is offered for
 * documents: thin glyph strokes must survive. Lossy is only ever applied to
 * photographs, where smooth gradients legitimately lose some edge energy while
 * remaining visually indistinguishable, so photometric error dominates.
 */
function passesGate(metrics: QualityMetrics, mode: CompressionMode): boolean {
  if (mode === 'near_lossless') {
    return metrics.meanDiff <= 1.5 && metrics.p999Diff <= 24 && metrics.edgeRatio >= 0.985;
  }
  if (mode === 'lossy') {
    return metrics.meanDiff <= 2.5 && metrics.p999Diff <= 40 && metrics.edgeRatio >= 0.9;
  }
  return true;
}

export interface DocumentLikeness {
  documentLike: boolean;
  whiteness: number;
  saturation: number;
}

/**
 * Heuristic: scans/cards/letters are low-saturation images dominated by paper
 * white. They are never given to the lossy encoder, even at high quality,
 * because thin Persian glyph strokes are the first thing to smear.
 */
export async function detectDocumentLikeness(filePath: string, policy: ImagePolicy = DEFAULT_POLICY): Promise<DocumentLikeness> {
  const { data, info } = await sharp(filePath, { limitInputPixels: policy.maxPixels, failOn: 'error' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: 256, height: 256, fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let white = 0;
  let sat = 0;
  for (let i = 0; i < pixels; i += 1) {
    const r = data[i * 3]!;
    const g = data[i * 3 + 1]!;
    const b = data[i * 3 + 2]!;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma >= 205) white += 1;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const whiteness = white / Math.max(1, pixels);
  const saturation = sat / Math.max(1, pixels);
  return {
    whiteness,
    saturation,
    documentLike: whiteness >= 0.32 && saturation <= 60,
  };
}

export type CompressionMode = 'lossless' | 'near_lossless' | 'lossy' | 'original';

export interface EncodedCandidate {
  buffer: Buffer;
  mode: CompressionMode;
  qualityTier: number;
  metrics?: QualityMetrics;
  savingsPercent: number;
}

export interface PreviewImage {
  buffer: Buffer;
  width: number;
  height: number;
  mime: 'image/webp';
}

export interface ProcessedImage {
  display: Buffer;
  displayMime: 'image/webp' | 'image/jpeg' | 'image/png';
  /** True when the served bytes are the untouched source file. */
  displayIsSource: boolean;
  displayMode: CompressionMode;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  originalSize: number;
  displaySize: number;
  savingsPercent: number;
  qualityScore: number;
  documentLike: boolean;
  preview: PreviewImage | null;
  notes: string[];
}

function savings(original: number, candidate: number): number {
  if (original <= 0) return 0;
  return Math.round((1 - candidate / original) * 1000) / 10;
}

async function encode(filePath: string, policy: ImagePolicy, options: Record<string, unknown>): Promise<Buffer> {
  let pipeline = sharp(filePath, { limitInputPixels: policy.maxPixels, failOn: 'error' }).rotate();
  if (policy.maxDimension > 0) {
    pipeline = pipeline.resize({
      width: policy.maxDimension,
      height: policy.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  // WebP writer drops EXIF/GPS/XMP by default: metadata is not carried into the
  // served copy. The original archive keeps it for authorised readers.
  return pipeline.webp(options as SharpWebpOptions).toBuffer();
}

async function buildPreview(filePath: string, policy: ImagePolicy): Promise<PreviewImage | null> {
  if (policy.previewMaxWidth <= 0) return null;
  try {
    const pipeline = sharp(filePath, { limitInputPixels: policy.maxPixels, failOn: 'error' })
      .rotate()
      .resize({ width: policy.previewMaxWidth, height: policy.previewMaxWidth, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74, effort: 4, smartSubsample: true });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, mime: 'image/webp' };
  } catch {
    return null;
  }
}

export interface ProcessImageOptions {
  policy?: ImagePolicy;
  /** Absolute size of the input file (used for the savings figure). */
  originalSize?: number;
}

/**
 * Run the full quality-first optimisation. Never throws on "cannot improve":
 * the original image is returned as the display version instead.
 */
export async function processImage(filePath: string, options: ProcessImageOptions = {}): Promise<ProcessedImage> {
  const policy = options.policy ?? DEFAULT_POLICY;
  const source = await inspectImage(filePath, policy);
  const originalSize = options.originalSize && options.originalSize > 0 ? options.originalSize : source.size;
  const notes: string[] = [];

  if (source.orientation !== 1) notes.push('جهت تصویر بر اساس EXIF اصلاح شد.');
  if (policy.maxDimension > 0) notes.push(`حداکثر بُعد نسخه نمایشی ${policy.maxDimension} پیکسل تنظیم شده است.`);

  const likeness = await detectDocumentLikeness(filePath, policy);
  const sourceGrid = await qualityGrid(filePath, policy);

  const minSavings = Math.max(1, policy.minSavingsPercent);
  const target = Math.max(minSavings, policy.targetSavingsPercent);
  const candidates: EncodedCandidate[] = [];

  const consider = async (mode: CompressionMode, qualityTier: number, webpOptions: Record<string, unknown>) => {
    const buffer = await encode(filePath, policy, webpOptions);
    const saving = savings(originalSize, buffer.length);
    if (saving < minSavings) return;
    let metrics: QualityMetrics | undefined;
    if (mode !== 'lossless') {
      const grid = await qualityGrid(buffer, policy);
      metrics = compareGrids(sourceGrid, grid);
      if (!passesGate(metrics, mode)) {
        notes.push(`گزینه ${mode} (سطح ${qualityTier}) به دلیل افت کیفیت رد شد.`);
        return;
      }
    }
    candidates.push({ buffer, mode, qualityTier, metrics, savingsPercent: saving });
  };

  const reachedTarget = () => candidates.some((c) => c.savingsPercent >= target);

  // 1) Lossless. Skipped for JPEG photographs: a lossless WebP of an already
  //    lossy JPEG is always larger, so the attempt would only cost CPU. Scans
  //    and PNG/WebP sources always get this chance — flat document backgrounds
  //    routinely shrink 50-75% with zero pixel change.
  const tryLossless = likeness.documentLike || source.format !== 'jpeg';
  if (tryLossless) {
    await consider('lossless', 100, { lossless: true, effort: 6, smartSubsample: false });
  }

  // 2) Near-lossless — lossless compression after a conservative colour
  //    quantisation step. Still faithfully preserves thin glyph strokes.
  if (!reachedTarget() && (likeness.documentLike || policy.qualityMode !== 'quality_first')) {
    await consider('near_lossless', 90, { lossless: true, nearLossless: true, quality: 90, effort: 6 });
  }

  // 3) Lossy tiers — photographs only. A document scan never reaches this branch
  //    under the default quality-first policy.
  const lossyAllowed = !(policy.qualityMode === 'lossless_only' || (policy.qualityMode === 'quality_first' && likeness.documentLike));
  if (lossyAllowed && !reachedTarget()) {
    const start = Math.min(100, Math.max(70, policy.lossyQuality));
    const tiers = [start, start - 5, start - 10, start - 15].filter((q) => q >= 70);
    for (const quality of tiers) {
      await consider('lossy', quality, {
        quality,
        alphaQuality: 100,
        effort: 6,
        smartSubsample: false,
        chromaSubsampling: '4:4:4',
      });
      // Lower tiers are only explored while the size target is unmet; the first
      // (highest-quality) candidate that reaches it wins.
      if (reachedTarget()) break;
    }
  }

  candidates.sort((a, b) => b.qualityTier - a.qualityTier);
  const preferred = candidates.find((c) => c.savingsPercent >= target) ?? candidates[0];

  let display: Buffer;
  let displayMode: CompressionMode;
  let displayMime: ProcessedImage['displayMime'] = 'image/webp';
  let displayIsSource = false;
  let qualityScore = 100;
  if (preferred) {
    display = preferred.buffer;
    displayMode = preferred.mode;
    qualityScore = preferred.metrics ? Math.max(0, Math.round((1 - preferred.metrics.meanDiff / 255) * 1000) / 10) : 100;
    if (likeness.documentLike && displayMode === 'lossy') notes.push('مدرک اسکن‌شده با کیفیت بالا و بدون افت نوشته‌ها ذخیره شد.');
  } else if (source.orientation === 1 && source.format in SUPPORTED_IMAGE_MIME) {
    // Nothing was both smaller and faithful: the served version is the original
    // file, byte for byte. This is a success case, not a failure — quality
    // always wins over size, and we never re-encode a second time.
    display = await fs.readFile(filePath);
    displayMode = 'original';
    displayIsSource = true;
    displayMime = (SUPPORTED_IMAGE_MIME as Record<string, ProcessedImage['displayMime']>)[source.format] ?? 'image/webp';
    notes.push('کاهش حجم بدون افت کیفیت ممکن نبود؛ فایل اصلی بدون بازکدگذاری به‌عنوان نسخه نمایشی حفظ شد.');
  } else {
    // Rotation is mandatory, so a re-encode is unavoidable. Lossless WebP is the
    // only faithful option even if it ends up larger than the source.
    display = await sharp(filePath, { limitInputPixels: policy.maxPixels, failOn: 'error' })
      .rotate()
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    displayMode = 'original';
    notes.push('برای اصلاح جهت، نسخه Lossless ساخته شد؛ کیفیت کامل حفظ شده و حجم ممکن است بیشتر از فایل اولیه باشد.');
  }

  const meta = await sharp(display, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new ImageRejectedError('image_corrupt', 'نسخه بهینه‌شده قابل خواندن نیست.');
  const swapsAxes = [5, 6, 7, 8].includes(source.orientation);
  const expectedWidth = swapsAxes ? source.height : source.width;
  const expectedHeight = swapsAxes ? source.width : source.height;
  if (policy.maxDimension === 0 && (meta.width !== expectedWidth || meta.height !== expectedHeight)) {
    throw new ImageRejectedError('image_dimensions', 'ابعاد نسخه بهینه‌شده با تصویر اصلی مطابقت ندارد.');
  }
  // Blank-output guard: a broken encode must never replace a real document.
  const stats = await sharp(display, { failOn: 'error' }).greyscale().stats();
  if (stats.channels[0] && stats.channels[0].stdev < 0.5 && sourceGrid.energy > 1) {
    throw new ImageRejectedError('image_blank', 'خروجی پردازش بدون محتوا تشخیص داده شد.');
  }

  const preview = await buildPreview(filePath, policy);
  const displaySize = display.length;
  return {
    display,
    displayMime,
    displayIsSource,
    displayMode,
    width: meta.width,
    height: meta.height,
    originalWidth: source.width,
    originalHeight: source.height,
    originalSize,
    displaySize,
    savingsPercent: displayIsSource ? 0 : savings(originalSize, displaySize),
    qualityScore,
    documentLike: likeness.documentLike,
    preview,
    notes,
  };
}
