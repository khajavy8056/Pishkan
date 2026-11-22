import { useEffect, useRef, useState } from 'react';
import {
  Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Redo2, RemoveFormatting,
  Underline, Undo2, ImagePlus, Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiFailure } from '../lib/api';
import { useToast } from './ui';

/**
 * WordPress-style rich text editor for blog articles (contentEditable +
 * formatting toolbar, inline image upload into the public blog media
 * gateway). The value is an HTML string; readers only ever see it through
 * the strict allow-list sanitizer and the API sanitizes again on save.
 */
export function RichTextEditor({ value, onChange, placeholder = 'متن مطلب را اینجا بنویسید…' }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef<string>('');
  const [uploading, setUploading] = useState(false);
  const { notify } = useToast();

  // Load external value once (and when it changes from outside the editor).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastEmitted.current && el.innerHTML !== value) {
      el.innerHTML = value || '';
      lastEmitted.current = value;
    }
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    lastEmitted.current = html;
    onChange(html);
  };

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    // execCommand is deprecated but remains the only dependency-free way to
    // format a contentEditable selection consistently across browsers.
    document.execCommand(command, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt('نشانی پیوند (https://…)');
    if (url && url.trim()) exec('createLink', url.trim());
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.upload<{ data: { id: string } }>('/api/files/upload', file, { purpose: 'blog' });
      const url = `/api/public/blog/media/${res.data.id}`;
      ref.current?.focus();
      document.execCommand('insertImage', false, url);
      emit();
      notify('تصویر در متن قرار گرفت.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری تصویر ناموفق بود.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const tools: { title: string; icon: React.ReactNode; run: () => void }[] = [
    { title: 'ضخیم', icon: <Bold className="size-4" />, run: () => exec('bold') },
    { title: 'مورب', icon: <Italic className="size-4" />, run: () => exec('italic') },
    { title: 'زیرخط‌دار', icon: <Underline className="size-4" />, run: () => exec('underline') },
    { title: 'عنوان ۲', icon: <Heading2 className="size-4" />, run: () => exec('formatBlock', 'H2') },
    { title: 'عنوان ۳', icon: <Heading3 className="size-4" />, run: () => exec('formatBlock', 'H3') },
    { title: 'پاراگراف', icon: <span className="text-xs font-black">P</span>, run: () => exec('formatBlock', 'P') },
    { title: 'نقل‌قول', icon: <Quote className="size-4" />, run: () => exec('formatBlock', 'BLOCKQUOTE') },
    { title: 'فهرست نشانه‌ای', icon: <List className="size-4" />, run: () => exec('insertUnorderedList') },
    { title: 'فهرست شماره‌دار', icon: <ListOrdered className="size-4" />, run: () => exec('insertOrderedList') },
    { title: 'افزودن پیوند', icon: <Link2 className="size-4" />, run: addLink },
    { title: 'حذف قالب‌بندی', icon: <RemoveFormatting className="size-4" />, run: () => exec('removeFormat') },
    { title: 'واگردانی', icon: <Undo2 className="size-4" />, run: () => exec('undo') },
    { title: 'بازگردانی', icon: <Redo2 className="size-4" />, run: () => exec('redo') },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-2 py-1.5">
        {tools.map((tool) => (
          <button key={tool.title} type="button" title={tool.title} aria-label={tool.title}
            onMouseDown={(e) => e.preventDefault()} onClick={tool.run}
            className="grid size-8 place-items-center rounded-lg text-navy-600 transition hover:bg-brand-50 hover:text-brand-700">
            {tool.icon}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <button type="button" title="افزودن تصویر" aria-label="افزودن تصویر"
          onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-navy-600 transition hover:bg-brand-50 hover:text-brand-700">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} تصویر
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ''; }} />
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        dir="rtl"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        className={clsx(
          'blog-content min-h-72 px-4 py-3 text-[15px] leading-8 text-navy-900 outline-none',
          'empty:before:pointer-events-none empty:before:text-navy-300 empty:before:content-[attr(data-placeholder)]',
        )}
      />
    </div>
  );
}

/** Estimated reading time, mirroring the API computation (180 wpm). */
export function estimateReading(html: string): { words: number; minutes: number } {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').filter(Boolean).length : 0;
  return { words, minutes: Math.max(1, Math.ceil(words / 180)) };
}
