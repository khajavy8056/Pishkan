/**
 * Persian, field-specific validation messages.
 *
 * A save button that answers «داده‌های ارسالی معتبر نیست» tells the operator
 * nothing about *which* field to fix — the exact complaint that made staff
 * edits look broken. Every Zod rejection is translated here into a sentence
 * that names the field and the rule, so the toast is actionable on its own.
 *
 * The English `message` Zod produces is never shown; it is kept in `details`
 * only as the machine-readable `rule` for developers.
 */
import type { ZodError } from 'zod';

/** Human labels for the fields the panels actually edit. Unknown paths fall
 * back to the path itself, which still beats a generic sentence. */
const FIELD_LABELS: Record<string, string> = {
  fullName: 'نام و نام خانوادگی',
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  mobile: 'شماره موبایل',
  phone: 'تلفن',
  email: 'ایمیل',
  username: 'نام کاربری',
  password: 'رمز عبور',
  newPassword: 'رمز عبور جدید',
  currentPassword: 'رمز عبور فعلی',
  roleCode: 'نقش',
  status: 'وضعیت',
  employeeCode: 'کد کارمندی',
  position: 'سمت',
  specialties: 'تخصص‌ها',
  maxActiveCases: 'سقف پرونده‌های هم‌زمان',
  acceptsNewCases: 'پذیرش پرونده جدید',
  mfaRequired: 'ورود دومرحله‌ای',
  nationalId: 'کد ملی',
  address: 'نشانی',
  city: 'شهر',
  province: 'استان',
  notes: 'یادداشت‌ها',
  title: 'عنوان',
  body: 'متن',
  amount: 'مبلغ',
  code: 'کد',
  token: 'توکن',
  identifier: 'نام کاربری/ایمیل',
  kind: 'نوع',
  permissions: 'مجوزها',
  name: 'نام',
  description: 'توضیحات',
  domain: 'دامنه',
  host: 'هاست',
  port: 'پورت',
  values: 'مقادیر',
};

export function fieldLabel(path: (string | number | symbol)[]): string {
  const key = path.map(String).join('.');
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const last = String(path[path.length - 1] ?? '');
  if (FIELD_LABELS[last]) return FIELD_LABELS[last];
  return key || 'فیلد';
}

/** Translate one Zod issue into a Persian sentence that names the field. */
export function translateIssue(issue: any): string {
  const label = fieldLabel(issue.path ?? []);
  const code = String(issue.code ?? '');
  switch (code) {
    case 'invalid_type': {
      const expected = String(issue.expected ?? '');
      // Expected-type first: a coerced NaN arrives with no usable `input`, and
      // «باید عدد باشد» is still the sentence the operator needs.
      if (expected === 'number' || expected === 'int') return `«${label}» باید یک عدد معتبر باشد.`;
      if (expected === 'string') return `«${label}» باید متن باشد.`;
      if (expected === 'boolean') return `«${label}» باید بله/خیر باشد.`;
      if (expected === 'array') return `«${label}» باید فهرست باشد.`;
      if (issue.input === null || issue.input === undefined) {
        return `مقدار «${label}» ارسال نشده یا نامعتبر است.`;
      }
      return `مقدار «${label}» معتبر نیست.`;
    }
    case 'too_small': {
      const min = Number(issue.minimum ?? 0);
      if (issue.origin === 'string') {
        if (min === 1) return `«${label}» نباید خالی باشد.`;
        return `«${label}» باید حداقل ${min} نویسه باشد.`;
      }
      if (issue.origin === 'array') return `«${label}» باید حداقل ${min} مورد داشته باشد.`;
      return `«${label}» باید حداقل ${min} باشد.`;
    }
    case 'too_big': {
      const max = Number(issue.maximum ?? 0);
      if (issue.origin === 'string') return `«${label}» باید حداکثر ${max} نویسه باشد.`;
      if (issue.origin === 'array') return `«${label}» باید حداکثر ${max} مورد داشته باشد.`;
      return `«${label}» باید حداکثر ${max} باشد.`;
    }
    case 'invalid_format': {
      const format = String(issue.format ?? '');
      if (format === 'email') return 'ایمیل واردشده معتبر نیست (نمونهٔ درست: name@example.com).';
      if (format === 'url') return `«${label}» باید یک نشانی معتبر باشد (با https://).`;
      if (format === 'regex') return `قالب «${label}» معتبر نیست.`;
      return `قالب «${label}» معتبر نیست.`;
    }
    case 'invalid_value':
      return `مقدار انتخابی برای «${label}» معتبر نیست.`;
    case 'invalid_union':
      return `مقدار «${label}» معتبر نیست.`;
    case 'unrecognized_keys':
      return `فیلد ناشناخته در درخواست: ${(issue.keys ?? []).join(', ')}`;
    case 'not_multiple_of':
      return `«${label}» باید مضرب ${issue.multipleOf} باشد.`;
    default:
      return `مقدار «${label}» معتبر نیست.`;
  }
}

export interface TranslatedValidation {
  /** One actionable Persian sentence (the first problem), for the toast. */
  message: string;
  /** Every problem, field by field, for clients that render inline errors. */
  details: { field: string; path: string; message: string; rule: string }[];
}

export function translateZodError(err: ZodError): TranslatedValidation {
  const details = err.issues.map((issue: any) => ({
    field: fieldLabel(issue.path ?? []),
    path: (issue.path ?? []).map(String).join('.'),
    message: translateIssue(issue),
    rule: String(issue.code ?? 'invalid'),
  }));
  const first = details[0]?.message ?? 'داده‌های ارسالی معتبر نیست.';
  const message = details.length > 1 ? `${first} (+${details.length - 1} مورد دیگر)` : first;
  return { message, details };
}
