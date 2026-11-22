/**
 * Profile → service-form autofill.
 *
 * Customers kept retyping the same facts (national id, IBAN, father's name…)
 * on every service form. The profile now stores them once and this module
 * exposes them under the shared catalogue field keys so the checkout can
 * offer «استفاده از اطلاعات پروفایل من» and fill the matching fields in one
 * tap. Values are only ever returned to their owner.
 */
import { one } from '../../db/index.js';

export interface AutofillEntry { key: string; label: string; value: string }

const FIELD_LABELS: Record<string, string> = {
  full_name: 'نام و نام خانوادگی',
  first_name: 'نام',
  last_name: 'نام خانوادگی',
  national_id: 'کد ملی',
  mobile: 'شماره موبایل',
  phone: 'تلفن ثابت',
  email: 'ایمیل',
  birth_date: 'تاریخ تولد',
  father_name: 'نام پدر',
  birth_certificate_no: 'شماره شناسنامه',
  birth_place: 'محل تولد',
  address: 'نشانی',
  postal_code: 'کد پستی',
  city: 'شهر',
  province: 'استان',
  job_title: 'شغل',
  iban: 'شماره شبا',
  bank_name: 'نام بانک',
  card_number: 'شماره کارت بانکی',
};

export async function profileAutofill(userId: string) {
  const row = await one<any>(
    `SELECT u.full_name, u.mobile, u.national_id, u.email,
            p.first_name, p.last_name, p.address, p.postal_code, p.birth_date,
            p.job_title, p.province, p.city,
            p.father_name, p.birth_certificate_no, p.birth_place, p.landline,
            p.iban, p.bank_name, p.card_number
     FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
     WHERE u.id = ? AND u.kind = 'customer'`,
    [userId],
  );
  const raw: Record<string, unknown> = row ?? {};
  const fullName = String(raw.full_name ?? '').trim()
    || [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim();
  const source: Record<string, unknown> = {
    full_name: fullName,
    first_name: raw.first_name,
    last_name: raw.last_name,
    national_id: raw.national_id,
    mobile: raw.mobile,
    phone: raw.landline,
    email: raw.email,
    birth_date: raw.birth_date,
    father_name: raw.father_name,
    birth_certificate_no: raw.birth_certificate_no,
    birth_place: raw.birth_place,
    address: raw.address,
    postal_code: raw.postal_code,
    city: raw.city,
    province: raw.province,
    job_title: raw.job_title,
    iban: raw.iban,
    bank_name: raw.bank_name,
    card_number: raw.card_number,
  };
  const values: Record<string, string> = {};
  const entries: AutofillEntry[] = [];
  const missing: { key: string; label: string }[] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const value = String(source[key] ?? '').trim();
    if (value) {
      values[key] = value;
      entries.push({ key, label, value });
    } else {
      missing.push({ key, label });
    }
  }
  return { values, entries, missing };
}

/** Iranian IBAN (IR + 24 digits) with mod-97 check, shared with form validation. */
export function validIban(input: string): boolean {
  const iban = String(input).toUpperCase().replace(/[\s-]/g, '');
  if (!/^IR\d{24}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0n;
  for (const ch of rearranged) {
    const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10n + BigInt(d)) % 97n;
  }
  return remainder === 1n;
}
