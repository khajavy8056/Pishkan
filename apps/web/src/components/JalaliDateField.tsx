import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Field, Input } from './ui';
import {
  JALALI_MONTHS, JALALI_WEEKDAYS, faDigits, formatJalaliIso, jalaliMonthGrid, jalaliOfIso,
  jalaliToIso, nextJalaliMonth, parseJalaliInput, todayJalali,
} from '../lib/jalali';
import { useSite } from '../lib/site';

/**
 * A date field whose calendar is the one the rest of the screen uses.
 *
 * ## The bug this exists for
 *
 * Every date in this product is *displayed* in Jalali — «۱۴۰۴/۰۸/۰۱» — while the
 * fields that let a person pick one were `<input type="date">`: a Gregorian
 * March-to-January grid in which ۱۴۰۴ is not even a valid year, and a typed
 * Persian date is rejected outright. The phone had the same fault with extra
 * confusion: `showDatePicker` was given `locale: fa`, so it drew Persian digits
 * around a Gregorian calendar. That is the whole of «تقویم که باز می‌شد میلادی
 * بود».
 *
 * ## Why the value stays ISO
 *
 * The API contract is `YYYY-MM-DD` Gregorian everywhere — the same strings the
 * filters, invoices and reports already store and compare. Only the *face* of the
 * field is Jalali. That keeps the web panels and the Android app agreeing on a
 * date with no migration and no second date format anywhere in the system, and it
 * is why this is a wrapper around the existing input rather than a new field type.
 *
 * ## The office's own choice still wins
 *
 * `site.calendar` («تقویم نمایش تاریخ») is honoured: an office that selected
 * «میلادی» gets the native browser field back, and so does a platform build that
 * lacks the Persian calendar (the picker would otherwise render an empty grid).
 * The setting used to be declared in the admin panel and read by nothing — a
 * control that only looks like it works is worse than no control at all.
 */
export interface JalaliDateFieldProps {
  /** ISO `YYYY-MM-DD`, or '' for empty. */
  value: string | null | undefined;
  onChange: (iso: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** ISO bounds, as callers already pass to `min`/`max`. */
  min?: string;
  max?: string;
  disabled?: boolean;
  readOnly?: boolean;
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function JalaliDateField(props: JalaliDateFieldProps) {
  const { setting } = useSite();
  const native = setting('site.calendar') === 'gregorian' || !persianCalendarAvailable();
  const control = <JalaliControl {...props} native={native} />;
  if (!props.label && !props.hint && !props.error) return control;
  return (
    <Field label={props.label} hint={props.hint} error={props.error} required={props.required} className={props.className}>
      {control}
    </Field>
  );
}

function persianCalendarAvailable(): boolean {
  try {
    return todayJalali() !== null;
  } catch {
    return false;
  }
}

function JalaliControl(props: JalaliDateFieldProps & { native: boolean }) {
  const {
    value, onChange, min, max, disabled, readOnly, clearable = true,
    placeholder = '۱۴۰۴/۰۱/۰۱', label, hint, error, required, id, native,
  } = props;
  const iso = String(value ?? '');
  const [text, setText] = useState(() => (iso ? formatJalaliIso(iso) : ''));
  const [typing, setTyping] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const today = useMemo(() => todayJalali(), []);
  const [view, setView] = useState(() => {
    const parts = iso ? jalaliOfIso(iso) : today;
    return { jy: parts?.jy ?? today?.jy ?? 1404, jm: parts?.jm ?? 1 };
  });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The last value the box was made to match. Syncing on *change* rather than on
  // every render is what lets a rejected date stay on screen: the alternative is
  // the field silently erasing a person's typing and showing no explanation.
  const synced = useRef(iso);
  useEffect(() => {
    if (typing || synced.current === iso) return;
    synced.current = iso;
    setText(iso ? formatJalaliIso(iso) : '');
    setInvalid(false);
  }, [iso, typing]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function commit(raw: string) {
    setTyping(false);
    const trimmed = raw.trim();
    if (!trimmed) {
      setInvalid(false);
      synced.current = '';
      onChange('');
      return;
    }
    const parsed = parseJalaliInput(trimmed);
    if (parsed) {
      setInvalid(false);
      synced.current = parsed;
      setText(formatJalaliIso(parsed));
      onChange(parsed);
    } else {
      // Left on screen exactly as typed, with the reason next to it: a date the
      // calendar does not contain is a question for the person, not a typo to fix.
      setInvalid(true);
    }
  }

  if (native) {
    return (
      <Input
        id={id}
        type="date"
        dir="ltr"
        className={`text-left ${props.className ?? ''}`}
        value={iso}
        min={min}
        max={max}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const grid = jalaliMonthGrid(view.jy, view.jm);
  const leading = grid.findIndex((cell) => cell !== null);
  const minDay = min ? dayOfIso(min) : null;
  const maxDay = max ? dayOfIso(max) : null;

  return (
    <div className={`relative ${props.className ?? ''}`} ref={wrapRef}>
      <div className="flex items-stretch gap-1">
        <Input
          id={id}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          className="text-left"
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          onFocus={() => setTyping(true)}
          onChange={(event) => {
            setText(event.target.value);
            if (invalid) setInvalid(false);
          }}
          onBlur={() => commit(text)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit((event.target as HTMLInputElement).value);
            } else if (event.key === 'ArrowDown' && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded-xl border border-navy-100 px-2 text-sm text-navy-500 hover:bg-navy-50 disabled:opacity-50"
          aria-label="باز کردن تقویم شمسی"
          disabled={disabled || readOnly}
          onClick={() => setOpen((value) => !value)}
        >
          تقویم
        </button>
        {clearable && !readOnly && (iso || text) && (
          <button
            type="button"
            className="shrink-0 rounded-xl px-2 text-sm text-navy-400 hover:bg-navy-50"
            aria-label="پاک کردن تاریخ"
            onClick={() => {
              setText('');
              setInvalid(false);
              setTyping(false);
              synced.current = '';
              onChange('');
            }}
          >
            پاک
          </button>
        )}
      </div>

      {(invalid || error) && (
        <p className="mt-1 text-xs text-rose-600" role="alert">
          {invalid ? 'تاریخ شمسی معتبر نیست؛ نمونه: ۱۴۰۴/۰۸/۰۱' : error}
        </p>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="انتخاب تاریخ شمسی"
          className="absolute z-50 mt-1 w-[292px] max-w-[92vw] rounded-2xl border border-navy-100 bg-white p-3 shadow-xl"
          data-testid="jalali-calendar"
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <GridButton label="یک سال عقب" onClick={() => setView(nextJalaliMonth(view.jy, view.jm, -12))}>‹‹</GridButton>
            <GridButton label="ماه قبل" onClick={() => setView(nextJalaliMonth(view.jy, view.jm, -1))}>‹</GridButton>
            <div className="text-sm font-semibold text-navy-800">{faDigits(`${JALALI_MONTHS[view.jm - 1]} ${view.jy}`)}</div>
            <GridButton label="ماه بعد" onClick={() => setView(nextJalaliMonth(view.jy, view.jm, 1))}>›</GridButton>
            <GridButton label="یک سال جلو" onClick={() => setView(nextJalaliMonth(view.jy, view.jm, 12))}>››</GridButton>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {JALALI_WEEKDAYS.map((day) => (
              <span key={day} className="text-[11px] font-semibold text-navy-400">{day}</span>
            ))}
            {grid.map((day, index) => {
              if (day === null) return <span key={`pad-${index}`} />;
              const jd = index - leading + 1;
              const isSelected = jalaliEquals(iso ? jalaliOfIso(iso) : null, { jy: view.jy, jm: view.jm, jd });
              const blocked = (minDay !== null && day < minDay) || (maxDay !== null && day > maxDay);
              const classes = [
                'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition',
                blocked ? 'cursor-not-allowed text-navy-200' : 'hover:bg-navy-50',
                isSelected ? 'bg-brand-700 font-bold text-white hover:bg-brand-700' : 'text-navy-800',
                !isSelected && today && view.jy === today.jy && view.jm === today.jm && jd === today.jd ? 'ring-1 ring-brand-300' : '',
              ].join(' ');
              return (
                <button
                  key={day}
                  type="button"
                  disabled={blocked}
                  className={classes}
                  onClick={() => {
                    const picked = jalaliToIso(view.jy, view.jm, jd);
                    synced.current = picked;
                    setInvalid(false);
                    onChange(picked);
                    setOpen(false);
                  }}
                >
                  {faDigits(String(jd))}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-xs text-brand-700 hover:bg-navy-50"
              onClick={() => {
                const now = new Date();
                const isoToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
                synced.current = isoToday;
                setInvalid(false);
                onChange(isoToday);
                setOpen(false);
              }}
            >
              امروز
            </button>
            <button type="button" className="rounded-lg px-2 py-1 text-xs text-navy-500 hover:bg-navy-50" onClick={() => setOpen(false)}>
              بستن
            </button>
          </div>
          {hint && <p className="mt-2 text-[11px] text-navy-400">{hint}</p>}
          {required && !iso && <p className="mt-1 text-[11px] text-navy-400">این فیلد اجباری است.</p>}
        </div>
      )}
    </div>
  );
}

function GridButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} className="rounded-lg px-2 py-1 text-sm text-navy-500 hover:bg-navy-50" onClick={onClick}>
      {children}
    </button>
  );
}

/* ------------------------------- helpers -------------------------------- */

type Parts = { jy: number; jm: number; jd: number };

function jalaliEquals(a: Parts | null, b: Parts) {
  return Boolean(a && a.jy === b.jy && a.jm === b.jm && a.jd === b.jd);
}

/** Localise a `YYYY-MM-DD` string as a civil day number (for min/max bounds). */
function dayOfIso(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}
