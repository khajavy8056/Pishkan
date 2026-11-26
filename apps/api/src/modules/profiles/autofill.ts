/**
 * Profile → service-form autofill.
 *
 * Customers kept retyping the same facts (national id, IBAN, father's name…)
 * on every service form. The profile now stores them once and this module
 * exposes them under the shared catalogue field keys so the checkout can
 * offer «استفاده از اطلاعات پروفایل من» and fill the matching fields in one
 * tap. Values are only ever returned to their owner.
 */
import { one, run } from '../../db/index.js';
import { validNationalId } from './service.js';

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

/**
 * Which submitted answers are really facts about the person — and where they live.
 *
 * The office's request: «تاریخ تولد در پروفایل نیست، ولی اگر یک بار در یک خدمت
 * پر شود، برای خدمات بعدی همان پر شود». The mapping is by **exact key**, with no
 * label or type guessing, and that is not laziness: the same key is what the read
 * side (`profileAutofill`) returns values under, so write and read agree by
 * construction. Guessing from «تاریخ تولد همسر» being a `date` would put another
 * person's birthday into the account owner's profile, and it would then be
 * offered on every future form — a wrong fact is far more expensive than a
 * missing one. The exact-key rule is also what makes the two halves agree:
 * `profileAutofill` returns values under these same keys, and both the app's
 * `fillEmptyFromProfile` and the web checkout look a field up by `field.key`.
 *
 * **Invariant: every key in this map is a key `profileAutofill` publishes.** A
 * value the profile stores but cannot hand back is a field that looks remembered
 * and never is — which is worse than not saving it, because the person already
 * told us once. `tests/profile-learning.test.ts` enforces it.
 *
 * What is deliberately absent, and why that is not an oversight:
 *  * `mobile`, `email`, `national_id`, `first_name`, `last_name`, `city` — the
 *    identity cells a *complete profile* already requires. `requireCompleteProfile`
 *    is a hard gate on every submission (name, a verified-shaped mobile, a valid
 *    national id, a city), so a customer cannot be missing them and this map would
 *    never fire. Writing them from a form would only be reachable if the gate were
 *    relaxed — and then a clerk's guess would move a login identity, which is a
 *    worse trade. Leaving them out keeps the list honest: it is exactly the facts
 *    the profile does *not* insist on, which is where the office's
 *    «به مرور کامل بشه» actually applies.
 *  * `city`/`province` as free text — coverage is `customer_profiles.city_id`, a
 *    real FK the quote step checks; text would disagree with it.
 */
const WRITEBACK: Record<string, { column: string; validate?: (value: string) => boolean }> = {
  birth_date: { column: 'birth_date', validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) },
  father_name: { column: 'father_name', validate: (v) => v.length >= 2 && v.length <= 60 },
  birth_certificate_no: { column: 'birth_certificate_no', validate: (v) => v.length >= 3 && v.length <= 20 },
  birth_place: { column: 'birth_place', validate: (v) => v.length >= 2 && v.length <= 60 },
  job_title: { column: 'job_title', validate: (v) => v.length >= 2 && v.length <= 60 },
  address: { column: 'address', validate: (v) => v.length >= 8 && v.length <= 400 },
  postal_code: { column: 'postal_code', validate: (v) => /^\d{10}$/.test(v) },
  // The column is `landline`; the key both sides publish is `phone`. A form field
  // literally keyed `landline` is deliberately not learned, because the rule below
  // is what makes this whole feature safe to leave switched on.
  phone: { column: 'landline', validate: (v) => /^0\d{9,11}$/.test(v) },
  iban: { column: 'iban', validate: validIban },
  bank_name: { column: 'bank_name', validate: (v) => v.length >= 2 && v.length <= 60 },
  card_number: { column: 'card_number', validate: (v) => /^\d{16}$/.test(v) },
};

/**
 * Complete the profile from a submission, without ever overwriting it.
 *
 * Three rules carry the safety, and they are the reason this can run on every
 * request:
 *
 *  1. **Empty cells only.** The profile is the person's own declaration; a form
 *     answer never rewrites something they set. A typo in one service must not
 *     become the source of truth for the next five.
 *  2. **Validated like the read side.** `validateFormData` already normalised
 *     digits and checked the checksums, and each column re-checks its own shape
 *     here — because this runs for submissions made through other paths (the
 *     assistant, a staff-created case) too.
 *  3. **Never another person's fact.** Only the applicant's own keys are mapped
 *     above; `spouse_national_id`, `child_birth_date`, `landlord_*` and the rest
 *     are answers *about someone else* and are left in the case file.
 *
 * Returns the Persian labels of what was learned, so the client can say
 * «۲ مورد به پروفایل شما اضافه شد» — the moment the person notices that the
 * system is filling itself in is the moment autofill stops being a hidden button.
 */
export async function learnFromSubmission(
  userId: string,
  answers: Record<string, unknown>,
): Promise<{ learned: string[] }> {
  const profile = await one<any>(
    `SELECT p.* FROM customer_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ? AND u.kind = 'customer'`,
    [userId],
  );
  if (!profile) return { learned: [] };

  const setProfile: Record<string, string> = {};
  for (const [key, rule] of Object.entries(WRITEBACK)) {
    const value = String(answers[key] ?? '').trim();
    if (!value) continue;
    if (rule.validate && !rule.validate(value)) continue;
    // Empty cells only — the profile is the person's own declaration.
    if (String(profile[rule.column] ?? '').trim()) continue;
    setProfile[rule.column] = value;
  }
  if (!Object.keys(setProfile).length) return { learned: [] };

  const ts = new Date().toISOString();
  const columns = Object.keys(setProfile);
  await run(
    `UPDATE customer_profiles SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`,
    [...Object.values(setProfile), ts, userId],
  );
  // Labels, not keys: this list is shown to a person, and it is the sentence that
  // makes the behaviour discoverable («این هم در پروفایل شما ذخیره شد»).
  return { learned: columns.map((column) => FIELD_LABELS[column] ?? column) };
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
