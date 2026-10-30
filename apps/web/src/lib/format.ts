/** Persian display helpers: numbers, currency, Jalali dates, relative time. */

export function faNum(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString('fa-IR');
}

export function rial(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('fa-IR')} ریال`;
}

export function toman(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(Number(value) / 10).toLocaleString('fa-IR')} تومان`;
}

const dateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: 'long', day: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });

export function faDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return dateFormatter.format(new Date(value));
  } catch {
    return '—';
  }
}

export function faDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return dateTimeFormatter.format(new Date(value));
  } catch {
    return '—';
  }
}

export function faTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return timeFormatter.format(new Date(value));
  } catch {
    return '—';
  }
}

/** ISO date (Gregorian, for API filters) → Jalali short label. */
export function faDateShort(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: '2-digit', day: '2-digit' }).format(new Date(value));
  } catch {
    return '—';
  }
}

export function relative(value: string | null | undefined): string {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return 'همین حالا';
  if (Math.abs(minutes) < 60) return minutes > 0 ? `${faNum(minutes)} دقیقه پیش` : `${faNum(-minutes)} دقیقه بعد`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return hours > 0 ? `${faNum(hours)} ساعت پیش` : `${faNum(-hours)} ساعت بعد`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return days > 0 ? `${faNum(days)} روز پیش` : `${faNum(-days)} روز بعد`;
  return faDate(value);
}

export const STATUS_STYLES: Record<string, string> = {
  new: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  assigned: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  waiting_documents: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  waiting_customer: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  under_review: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  ready: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  rejected: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  paid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  partially_paid: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  unpaid: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  issued: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  void: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  pending: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  refunded: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  suspended: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  open: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  closed: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  accepted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  declined: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  expired: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  scheduled: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  absent: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  leave: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  late: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  present: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  ok: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  invalid: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  high: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  normal: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

export const STATUS_LABELS: Record<string, string> = {
  new: 'جدید',
  assigned: 'ارجاع‌شده',
  in_progress: 'در حال انجام',
  waiting_documents: 'در انتظار مدارک',
  waiting_customer: 'در انتظار مشتری',
  under_review: 'در حال بررسی',
  ready: 'آماده تحویل',
  completed: 'تکمیل‌شده',
  cancelled: 'لغو‌شده',
  rejected: 'رد‌شده',
  paid: 'پرداخت‌شده',
  partially_paid: 'پرداخت جزئی',
  unpaid: 'پرداخت‌نشده',
  issued: 'صادرشده',
  draft: 'پیش‌نویس',
  void: 'لغوشده',
  pending: 'در انتظار',
  confirmed: 'تأییدشده',
  failed: 'ناموفق',
  refunded: 'بازپرداخت‌شده',
  active: 'فعال',
  suspended: 'غیرفعال',
  open: 'باز',
  closed: 'بسته',
  accepted: 'پذیرفته‌شده',
  declined: 'رد‌شده',
  expired: 'منقضی',
  scheduled: 'برنامه‌ریزی‌شده',
  absent: 'غایب',
  leave: 'مرخصی',
  late: 'تأخیر',
  present: 'حاضر',
  approved: 'تأییدشده',
  ok: 'سالم',
  invalid: 'نامعتبر',
  high: 'فوری',
  normal: 'عادی',
  online: 'آنلاین',
  cash: 'نقدی',
  pos: 'کارتخوان',
  transfer: 'کارت به کارت',
  customer: 'مشتری',
  staff: 'کارمند',
  admin: 'مدیر',
  system: 'سامانه',
  swap: 'جابه‌جایی',
  add: 'افزودن',
};

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(days: number): string {
  return isoDate(new Date(Date.now() - days * 86_400_000));
}
