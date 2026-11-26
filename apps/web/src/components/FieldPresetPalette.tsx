import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { Badge, Button, Input } from './ui';
import { api } from '../lib/api';
import { faNum } from '../lib/format';
import type { FormField } from '../lib/site';

/**
 * The «فیلدهای آماده» palette — one click, and a field arrives with the standard
 * the rest of the catalogue already uses.
 *
 * ## Why it exists
 *
 * The service editor asks for an English key, a Persian label, a type, whether it
 * is required, a placeholder and a help line — for «کد ملی», which every other
 * service in the catalogue already has. Writing that by hand the fortieth time is
 * slow, and worse, it drifts: `national_id` in one service and `melli_code` in
 * the next, and then the profile autofill, the document archive and the staff
 * filters — all of which address a field by its key — stop matching for half the
 * catalogue. Nothing errors; the reuse just silently stops happening.
 *
 * ## Why the free-form editor stays
 *
 * A palette that *replaces* the editor is a cage: the moment a service needs a
 * field the list has never seen, the office is stuck. So every entry here is an
 * insert into the same editor, and the list is built from what the office itself
 * defines — a field saved on any service appears here on the next one, which is
 * why a custom «شماره پرونده دادگاه» needs no approval from anybody.
 */
export interface FieldPreset {
  key: string;
  label: string;
  type: string;
  field: FormField;
  source: 'builtin' | 'service' | 'manual';
  usage: number;
  usedIn: string[];
  typeLabel: string;
}

const SOURCE_HINT: Record<FieldPreset['source'], string> = {
  builtin: 'استاندارد سامانه',
  service: 'از خدمات موجود',
  manual: 'فیلد آمادهٔ خودتان',
};

export function FieldPresetPalette({ onPick, takenKeys }: {
  onPick: (preset: FieldPreset) => void;
  /** Keys already in this form — clicking one of those would only be rejected. */
  takenKeys: string[];
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FieldPreset[] | null>(null);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  // Debounced on purpose: the search hits the same scan the admin list uses, and
  // a request per keystroke on an office laptop over Wi-Fi is how a search box
  // starts lagging behind the keyboard.
  useEffect(() => {
    const current = ++generation.current;
    const timer = setTimeout(() => {
      api.get<{ data: FieldPreset[] }>(`/api/catalog/admin/form-field-presets?limit=80&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (current !== generation.current) return;
          setItems(res.data);
          setFailed(false);
        })
        .catch(() => {
          if (current !== generation.current) return;
          setItems([]);
          setFailed(true);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const taken = useMemo(() => new Set(takenKeys), [takenKeys]);
  const list = items ?? [];

  return (
    <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3" data-testid="field-palette">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-800">
          <Sparkles className="size-3.5" /> فیلدهای آماده
        </span>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-navy-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جست‌وجو: کد ملی، تاریخ تولد، شناسنامه، فایل…"
            className="ps-8"
            aria-label="جست‌وجو در فیلدهای آماده"
            data-testid="field-palette-search"
          />
        </div>
      </div>

      {failed && (
        <p className="mt-2 text-[11px] leading-6 text-navy-500">
          فهرست فیلدهای آماده فعلاً در دسترس نیست. می‌توانید فیلد را دستی بسازید؛
          بعد از ذخیرهٔ خدمت، همان فیلد اینجا ظاهر می‌شود.
        </p>
      )}

      {!failed && items === null && <p className="mt-2 text-[11px] text-navy-500">در حال خواندن فیلدهای موجود…</p>}

      {!failed && items?.length === 0 && (
        <p className="mt-2 text-[11px] leading-6 text-navy-500">
          فیلد آماده‌ای با این نام پیدا نشد. اگر این فیلد را حالا بسازید و خدمت را
          ذخیره کنید، از این پس برای بقیهٔ خدمات هم همین‌جا در دسترس است.
        </p>
      )}

      {!!items?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {list.map((preset) => {
            const isTaken = taken.has(preset.key);
            return (
              <button
                key={preset.key}
                type="button"
                disabled={isTaken}
                title={[
                  `کلید: ${preset.key}`,
                  `نوع: ${preset.typeLabel}`,
                  SOURCE_HINT[preset.source],
                  preset.usage > 0 ? `در ${faNum(preset.usage)} خدمت استفاده شده` : 'هنوز در هیچ خدمتی استفاده نشده',
                  preset.usedIn.length ? `مثال: ${preset.usedIn.join('، ')}` : '',
                  isTaken ? 'این فیلد از قبل در همین فرم هست' : '',
                ].filter(Boolean).join(' • ')}
                onClick={() => onPick(preset)}
                className={[
                  'rounded-full border px-2.5 py-1 text-[11px] transition',
                  isTaken
                    ? 'cursor-not-allowed border-navy-100 bg-white/60 text-navy-300'
                    : 'border-brand-300 bg-white text-brand-900 hover:bg-brand-100',
                ].join(' ')}
              >
                {preset.label}
                <span className="ms-1 text-[10px] text-navy-400">{preset.typeLabel}</span>
                {preset.usage > 0 && <span className="ms-1 text-[10px] text-brand-700">{faNum(preset.usage)}</span>}
              </button>
            );
          })}
        </div>
      )}

      {!!items?.length && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-navy-400">
          <Badge tone="navy">{faNum(items.length)} فیلد</Badge>
          با کلیک، فیلد با همان برچسب، نوع، اجباری‌بودن و راهنمای استانداردش ساخته می‌شود و بعد از آن قابل ویراست.
        </p>
      )}
    </div>
  );
}

/** The button a field row uses to offer itself to the palette. */
export function SaveAsPresetButton({ field, onSaved }: { field: FormField; onSaved: (label: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) {
    return <span className="text-[11px] text-emerald-700">در فهرست فیلدهای آماده ثبت شد.</span>;
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      aria-label="ذخیره به‌عنوان فیلد آماده"
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/api/catalog/admin/form-field-presets', field);
          onSaved(field.label);
          setDone(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Sparkles className="size-3.5" /> فیلد آماده
    </Button>
  );
}
