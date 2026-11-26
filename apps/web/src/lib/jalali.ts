/**
 * The Jalali (Persian) calendar, built on the platform's own `persian` calendar.
 *
 * ## Why there is no conversion table or algorithm in this file
 *
 * Dates in this product are *displayed* with `Intl.DateTimeFormat('fa-IR-u-ca-persian')`
 * (see lib/format.ts). The original bug was that the pickers opened the Gregorian
 * calendar while every label on screen was Jalali — the person typed ۱۴۰۴/۰۸/۰۱
 * into a field and was shown a March–January grid. The obvious way to "fix" that
 * is to add a Jalali↔Gregorian algorithm, and that is how you get the *second*
 * version of the same bug: two implementations of one calendar, agreeing on
 * almost every date and disagreeing on a leap day once every few years — and the
 * disagreement shows up as an invoice dated one day off, which nobody notices
 * until the customer complains.
 *
 * So the picker converts through the exact same API the labels use. There is one
 * source of truth for what day it is, and the display and the picker cannot drift
 * because they are the same code.
 *
 * ## Dates are calendar days, not instants
 *
 * Everything here works on UTC midnight (`Date.UTC`), because an ISO `YYYY-MM-DD`
 * string in this API means *that civil day*: if a picker let the machine's local
 * timezone move the value, a filter for «امروز» in a server set to +3:30 would
 * quietly become yesterday. The formatter is pinned to `timeZone: 'UTC'` for the
 * same reason.
 */

export interface JalaliParts {
  jy: number;
  jm: number;
  jd: number;
}

const DAY = 86_400_000;

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** Persian week: Saturday first. */
export const JALALI_WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const partsFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-latn', {
  calendar: 'persian',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  numberingSystem: 'latn',
  timeZone: 'UTC',
});

export const faDigits = (value: string) => value.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const enDigits = (value: string) => value
  .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** Days elapsed since the Unix epoch, in UTC — the identity of a civil date. */
export function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY);
}

export function dateFromDay(day: number): Date {
  return new Date(day * DAY);
}

/** Today as a civil day, in the user's own timezone (not the server's). */
export function todayDayNumber(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / DAY);
}

/** Gregorian civil date → Jalali parts. */
export function toJalali(date: Date): JalaliParts {
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }
  // A calendar era prefix (some ICU builds render 1200 as "1200 AP"-ish text)
  // cannot be trusted for arithmetic; the numeric parts above always come back
  // for the `persian` calendar, so a zero here means the locale lacks it and the
  // caller should fall back to the Gregorian field rather than show ۰/۰/۰.
  if (!year || !month || !day) throw new Error('persian calendar unavailable');
  return { jy: year, jm: month, jd: day };
}

/* -------------------------------------------------------------------------- */
/*  one year of the calendar, derived once                                    */
/* -------------------------------------------------------------------------- */

interface JalaliYear {
  /** Civil day (UTC midnight) on which each month of the year starts. */
  starts: number[];
  lengths: number[];
  /** Nowruz of the next year — the end of this one. */
  nextNowruz: number;
}

const yearCache = new Map<number, JalaliYear>();

function safeToJalali(date: Date): JalaliParts | null {
  try {
    return toJalali(date);
  } catch {
    // An ICU build without the persian calendar throws; the field falls back to
    // the native Gregorian input instead of shipping a broken picker.
    return null;
  }
}

/**
 * Farvardin 1 of a Jalali year, as a civil day number.
 *
 * Found by looking at mid-March of `jy + 621` and walking a short window:
 * Nowruz is 19–22 March, so this is always exact, and it is one less way to be
 * subtly wrong than the leap-year arithmetic it replaces.
 */
function nowruzDay(jy: number): number {
  const cached = nowruzCache.get(jy);
  if (cached !== undefined) return cached;
  const year = jy + 621;
  for (let day = dayNumber(new Date(Date.UTC(year, 2, 14))); day <= dayNumber(new Date(Date.UTC(year, 2, 26))); day += 1) {
    const parts = safeToJalali(dateFromDay(day));
    if (parts && parts.jy === jy && parts.jm === 1 && parts.jd === 1) {
      nowruzCache.set(jy, day);
      return day;
    }
  }
  throw new Error(`could not locate Nowruz of ${jy}`);
}

const nowruzCache = new Map<number, number>();

function monthOfDay(day: number): number {
  return safeToJalali(dateFromDay(day))?.jm ?? 0;
}

/**
 * Month starts and lengths for a whole Jalali year, computed in one pass and
 * cached: twelve binary searches over the year's own days.
 *
 * The month lengths are *read* from the calendar rather than assumed
 * ("six months of 31, five of 30, the last one takes the leap day") — which is
 * what makes this correct for 1403 and 1404 and for the year the leap rule
 * changes, without anyone having to re-derive the rule here.
 */
export function jalaliYear(jy: number): JalaliYear {
  const cached = yearCache.get(jy);
  if (cached) return cached;
  const from = nowruzDay(jy);
  const nextNowruz = nowruzDay(jy + 1);
  const starts: number[] = [from];
  for (let month = 2; month <= 12; month += 1) {
    // First day of this year whose Jalali month is >= `month`. `monthOfDay` is
    // non-decreasing across [from, nextNowruz), which is what a binary search
    // needs, so the boundary is found in ~9 probes instead of 365.
    let lo = starts[month - 2];
    let hi = nextNowruz;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (monthOfDay(mid) >= month) hi = mid;
      else lo = mid + 1;
    }
    starts.push(lo);
  }
  const lengths = starts.map((start, index) => (index === 11 ? nextNowruz : starts[index + 1]) - start);
  const year: JalaliYear = { starts, lengths, nextNowruz };
  yearCache.set(jy, year);
  return year;
}

/** Start day (Gregorian civil day) of a Jalali month. */
export function jalaliMonthStartDay(jy: number, jm: number): number {
  return jalaliYear(jy).starts[Math.min(11, Math.max(0, jm - 1))];
}

/** How many days a Jalali month has (29–31; the last one absorbs the leap day). */
export function jalaliMonthLength(jy: number, jm: number): number {
  return jalaliYear(jy).lengths[Math.min(11, Math.max(0, jm - 1))];
}

/** Clear the caches — only for tests and very long-lived processes. */
export function clearJalaliCache() {
  nowruzCache.clear();
  yearCache.clear();
}

/** Jalali parts → the civil day number (Gregorian, UTC midnight). */
export function jalaliToDay(jy: number, jm: number, jd: number): number {
  const safeDay = Math.max(1, Math.min(jalaliMonthLength(jy, jm), jd));
  return jalaliMonthStartDay(jy, jm) + safeDay - 1;
}

/** Jalali parts → ISO `YYYY-MM-DD`, the form every API filter in this product takes. */
export function jalaliToIso(jy: number, jm: number, jd: number): string {
  const date = dateFromDay(jalaliToDay(jy, jm, jd));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
}

/** ISO `YYYY-MM-DD` → Jalali parts, or null when the value is not a date. */
export function isoToJalali(iso: string | null | undefined): JalaliParts | null {
  const text = String(iso ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const date = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return safeToJalali(date);
}

/** How the field should show the value, e.g. ۱۴۰۴/۰۸/۰۱. */
export function formatJalali(jy: number, jm: number, jd: number): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return faDigits(`${jy}/${two(jm)}/${two(jd)}`);
}

/** The same, from the stored ISO value — what a field displays. */
export function formatJalaliIso(iso: string | null | undefined): string {
  const parts = isoToJalali(iso);
  if (!parts) return String(iso ?? '');
  return formatJalali(parts.jy, parts.jm, parts.jd);
}

/** Today, in the browser's own timezone, as Jalali parts (or null). */
export function todayJalali(): JalaliParts | null {
  return isoToJalali(isoOfDay(todayDayNumber()));
}

/** Civil day number → ISO `YYYY-MM-DD`. */
export function isoOfDay(day: number): string {
  return dateFromDay(day).toISOString().slice(0, 10);
}

/** ISO `YYYY-MM-DD` → Jalali parts (the field's single parse path). */
export function jalaliOfIso(iso: string | null | undefined): JalaliParts | null {
  return isoToJalali(iso);
}

/**
 * Accept `1404/08/01`, `۱۴۰۴-۰۸-۰۱`, `1404.8.1`, `140481` — whatever a person
 * actually types — and produce ISO. Returns null for anything that is not a real
 * Jalali date, so the field can say "this date does not exist" instead of
 * silently storing the 31st of a 30-day month.
 */
export function parseJalaliInput(raw: string): string | null {
  const text = enDigits(String(raw ?? '')).replace(/[./،]/g, '-').trim();
  if (!text) return null;
  let jy = 0;
  let jm = 0;
  let jd = 0;
  const segments = text.split('-').filter(Boolean);
  if (segments.length === 3 && segments.every((n) => /^\d{1,4}$/.test(n))) {
    [jy, jm, jd] = segments.map((n) => Number(n));
  } else if (segments.length === 1 && /^\d{6,8}$/.test(segments[0])) {
    // «14040801», «140481», «1404091»: however the keypad happened to type it, so
    // the day and month are read from the right (1 or 2 digits each) and the year
    // is what is left. Reading from the left would make 1404/09/1 and 140/4/091
    // indistinguishable — from the right, only real dates parse.
    const digits = segments[0];
    for (let dayWidth = 2; dayWidth >= 1 && !jy; dayWidth -= 1) {
      for (let monthWidth = 2; monthWidth >= 1; monthWidth -= 1) {
        const day = digits.slice(digits.length - dayWidth);
        const month = digits.slice(digits.length - dayWidth - monthWidth, digits.length - dayWidth);
        const year = digits.slice(0, digits.length - dayWidth - monthWidth);
        if (!year || !month || !day) continue;
        const candidate = { y: Number(year), m: Number(month), d: Number(day) };
        if (candidate.y >= 1200 && candidate.y <= 1500 && candidate.m >= 1 && candidate.m <= 12 && candidate.d >= 1 && candidate.d <= 31) {
          jy = candidate.y;
          jm = candidate.m;
          jd = candidate.d;
          break;
        }
      }
    }
    if (!jy) return null;
  } else {
    return null;
  }
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return null;
  if (jy < 1200 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  if (jd > jalaliMonthLength(jy, jm)) return null;
  return jalaliToIso(jy, jm, jd);
}

/** Weekday index for the grid, Saturday = 0. */
export function jalaliWeekdayIndex(day: number): number {
  return (dateFromDay(day).getUTCDay() + 1) % 7;
}

/** The whole month as a grid of civil days, blanks padded to full weeks. */
export function jalaliMonthGrid(jy: number, jm: number): (number | null)[] {
  const start = jalaliMonthStartDay(jy, jm);
  const length = jalaliMonthLength(jy, jm);
  const cells: (number | null)[] = [];
  for (let i = 0; i < jalaliWeekdayIndex(start); i += 1) cells.push(null);
  for (let d = 0; d < length; d += 1) cells.push(start + d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Neighbouring month, wrapping the year. */
export function nextJalaliMonth(jy: number, jm: number, delta: number): { jy: number; jm: number } {
  let year = jy;
  let month = jm + delta;
  while (month > 12) { month -= 12; year += 1; }
  while (month < 1) { month += 12; year -= 1; }
  return { jy: year, jm: month };
}
