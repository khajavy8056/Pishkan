import { useState } from 'react';
import { FileText, ImageOff, Maximize2, Download, ExternalLink, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { Badge, Button, Modal, Spinner } from './ui';
import { faNum } from '../lib/format';

/**
 * Shared document preview primitives.
 *
 * The API serves three variants per image: a small WebP preview for lists, the
 * optimised WebP "display" copy, and the archived original (permission-gated).
 * These components never guess a path — they only use the URLs the API returns.
 */

export interface MediaFile {
  id: string;
  name?: string;
  mime: string;
  size: number;
  originalSize?: number;
  savingsPercent?: number;
  width?: number | null;
  height?: number | null;
  previewUrl?: string | null;
  displayUrl?: string | null;
  originalUrl?: string | null;
  url?: string | null;
  processing?: { status: string; mode?: string | null; error?: string | null };
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value < 1024) return `${faNum(value)} بایت`;
  if (value < 1024 * 1024) return `${faNum(Math.round(value / 102.4) / 10)} کیلوبایت`;
  return `${faNum(Math.round(value / 104857.6) / 10)} مگابایت`;
}

const MODE_LABELS: Record<string, string> = {
  lossless: 'Lossless WebP',
  near_lossless: 'Near-lossless WebP',
  lossy: 'WebP با کیفیت بالا',
  original: 'نسخه اصلی',
};

export function ProcessingBadge({ processing }: { processing?: MediaFile['processing'] }) {
  if (!processing) return null;
  const tone = processing.status === 'ready' || processing.status === 'skipped' ? 'success'
    : processing.status === 'failed' ? 'danger' : 'warning';
  const label = processing.status === 'ready' ? 'بهینه‌سازی شد'
    : processing.status === 'failed' ? 'خطای پردازش'
      : processing.status === 'pending' ? 'در انتظار پردازش'
        : processing.status === 'processing' ? 'در حال پردازش'
          : 'بدون تبدیل';
  return <Badge tone={tone}>{label}</Badge>;
}

export function FileSummary({ file }: { file: MediaFile }) {
  const saved = file.originalSize && file.size ? Math.round((1 - file.size / file.originalSize) * 1000) / 10 : 0;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-navy-500">
      <span>{file.mime === 'application/pdf' ? 'PDF' : (file.width && file.height ? `${faNum(file.width)}×${faNum(file.height)}` : 'تصویر')}</span>
      <span>•</span>
      <span>{bytes(file.size)}</span>
      {saved > 0 && (
        <>
          <span>•</span>
          <span className="text-emerald-700">از {bytes(file.originalSize)} ({faNum(saved)}٪ کمتر)</span>
        </>
      )}
      {file.processing?.mode && file.processing.status === 'ready' && (
        <>
          <span>•</span>
          <span>{MODE_LABELS[file.processing.mode] ?? file.processing.mode}</span>
        </>
      )}
    </p>
  );
}

export function FileThumbnail({ file, onOpen, className }: { file: MediaFile; onOpen?: () => void; className?: string }) {
  const [failed, setFailed] = useState(false);
  const isImage = file.mime?.startsWith('image/');
  const src = file.previewUrl ?? (isImage ? file.displayUrl ?? file.url : null);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        'group relative flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-navy-100 bg-surface-3',
        onOpen && 'cursor-zoom-in', className,
      )}
      aria-label={onOpen ? 'مشاهده مدرک' : undefined}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : isImage ? (
        <ImageOff className="size-5 text-navy-400" />
      ) : (
        <FileText className="size-6 text-rose-500" />
      )}
      {onOpen && (
        <span className="absolute inset-0 hidden items-center justify-center bg-scrim text-white group-hover:flex">
          <Maximize2 className="size-4" />
        </span>
      )}
    </button>
  );
}

export function DocumentViewer({
  file, title, open, onClose,
}: { file: MediaFile | null; title: string; open: boolean; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  if (!file) return null;
  const isImage = file.mime?.startsWith('image/');
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg"
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[11px] text-navy-500">
            <ShieldCheck className="size-3.5" /> نسخه اصلی فقط برای افراد مجاز قابل دریافت است.
          </span>
          <span className="flex gap-2">
            {isImage && (
              <Button size="sm" variant="ghost" onClick={() => setZoomed((v) => !v)}>
                <Maximize2 className="size-3.5" /> {zoomed ? 'نمایش معمولی' : 'اندازه کامل'}
              </Button>
            )}
            {file.displayUrl && (
              <a href={file.displayUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
                <ExternalLink className="size-3.5" /> بازکردن نسخه نمایشی
              </a>
            )}
            {file.originalUrl && (
              <a href={`${file.originalUrl}${file.originalUrl.includes('?') ? '&' : '?'}download=true`} className="btn-ghost btn-sm">
                <Download className="size-3.5" /> نسخه اصلی
              </a>
            )}
          </span>
        </div>
      )}>
      <div className={clsx('overflow-auto rounded-xl bg-surface-3', zoomed ? 'max-h-[60vh]' : 'max-h-[52vh]')}>
        {isImage && file.displayUrl ? (
          <img src={file.displayUrl} alt={title} className={clsx('mx-auto block', zoomed ? 'max-w-none' : 'max-h-[50vh] w-auto')} />
        ) : file.displayUrl ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <FileText className="size-10 text-rose-500" />
            <p className="text-sm text-navy-700">این فایل PDF است و برای امنیت، در مرورگر جاسازی نمی‌شود.</p>
            <a href={file.displayUrl} target="_blank" rel="noreferrer" className="btn-primary btn-sm">
              <ExternalLink className="size-4" /> بازکردن PDF
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-center p-8"><Spinner /></div>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-navy-500">حجم نسخه نمایشی</dt><dd className="font-medium text-navy-900">{bytes(file.size)}</dd></div>
        <div><dt className="text-navy-500">حجم نسخه اصلی</dt><dd className="font-medium text-navy-900">{bytes(file.originalSize ?? file.size)}</dd></div>
        <div><dt className="text-navy-500">ابعاد</dt><dd className="font-medium text-navy-900">{file.width && file.height ? `${faNum(file.width)}×${faNum(file.height)}` : '—'}</dd></div>
        <div><dt className="text-navy-500">وضعیت پردازش</dt><dd className="mt-1"><ProcessingBadge processing={file.processing} /></dd></div>
      </dl>
      {file.processing?.error && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[11px] leading-6 text-amber-900">
          پردازش خودکار انجام نشد: {file.processing.error} — نسخه اصلی سالم نگه داشته شده است.
        </p>
      )}
    </Modal>
  );
}
