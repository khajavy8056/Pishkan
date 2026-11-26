import { nowIso, one, q, run } from '../../db/index.js';
import { forbidden } from '../../http/errors.js';
export function validNationalId(input: string): boolean {
 const code = String(input).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
 if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
 const sum = [...code.slice(0,9)].reduce((n,d,i) => n + Number(d)*(10-i),0) % 11;
 return Number(code[9]) === (sum < 2 ? sum : 11-sum);
}
/**
 * Split a single-line «نام و نام خانوادگی» into its two halves.
 *
 * Registration — on the web and in the Android app — asks for ONE name field,
 * while the profile stores two columns. Before this helper existed the two
 * halves were never written, so every customer who had just typed their full
 * name was told their profile was missing "نام" and "نام خانوادگی" and had to
 * type the same thing again. The given name is the first token and the family
 * name is everything after it, because Iranian surnames are frequently two
 * words ("محمدی نیا") and re-joining the parts always reproduces the original.
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * A profile row with `first_name` / `last_name` filled in from `full_name`
 * whenever the columns are empty.
 *
 * Every client (web profile, Android profile, the assistant's autofill) reads
 * this object, so deriving here is the one place that can make all of them
 * prefill instead of re-asking. A row that already has the columns keeps them:
 * an edited profile always wins over the signup string.
 */
export function withDerivedNames<T extends { full_name?: string | null; first_name?: string | null; last_name?: string | null }>(row: T): T {
  const hasFirst = Boolean(row?.first_name?.trim());
  const hasLast = Boolean(row?.last_name?.trim());
  if (hasFirst && hasLast) return row;
  const derived = splitFullName(row?.full_name ?? '');
  return {
    ...row,
    first_name: hasFirst ? row.first_name : (derived.firstName || null),
    last_name: hasLast ? row.last_name : (derived.lastName || null),
  };
}

export async function profileState(userId: string) {
 const row = await one<any>(`SELECT p.*, u.full_name, u.mobile, u.national_id FROM users u LEFT JOIN customer_profiles p ON p.user_id=u.id WHERE u.id=?`, [userId]);
 const profile = row ? withDerivedNames(row) : null;
 const missing: string[] = [];
 if (!profile?.first_name?.trim()) missing.push('نام');
 if (!profile?.last_name?.trim()) missing.push('نام خانوادگی');
 if (!/^09\d{9}$/.test(profile?.mobile ?? '')) missing.push('موبایل');
 if (!validNationalId(profile?.national_id ?? '')) missing.push('کد ملی معتبر');
 if (!profile?.city_id || !await one('SELECT id FROM cities WHERE id=? AND is_active=1',[profile.city_id])) missing.push('شهر');
 return { complete: missing.length === 0, missing, profile };
}
export async function requireCompleteProfile(userId: string) {
 const state = await profileState(userId);
 if (!state.complete) throw forbidden(`ابتدا پروفایل را تکمیل کنید: ${state.missing.join('، ')}`);
 return state.profile;
}
export async function requireCoverage(serviceId: string, customerId: string) {
 const s = await one<any>('SELECT coverage FROM services WHERE id=?',[serviceId]);
 if (s?.coverage !== 'cities') return;
 const allowed = await one(`SELECT sc.city_id FROM service_cities sc JOIN customer_profiles p ON p.city_id=sc.city_id WHERE sc.service_id=? AND p.user_id=?`,[serviceId,customerId]);
 if (!allowed) throw forbidden('این خدمت در شهر محل سکونت شما ارائه نمی‌شود.');
}

/**
 * Repair pass for customers created before the sign-up name was split.
 *
 * Their `customer_profiles` rows carry a full name in `users` and two empty
 * columns here, which is what made the profile screen re-ask for the family
 * name. Deriving on read already fixes what every client displays; this makes
 * the stored data agree as well, so an office looking at a customer record
 * sees one name instead of a blank. Run once at boot, the way every other
 * additive repair in this application is run, and written in JavaScript on
 * purpose: `substr`/`instr`-style splitting is not valid on both SQLite and
 * PostgreSQL, and this codebase is deliberately portable between them.
 */
export async function backfillProfileNames(
  log: (msg: string) => void = () => undefined,
  limit = 2000,
): Promise<{ updated: number; scanned: number }> {
  const rows = await q<any>(
    `SELECT u.id, u.full_name FROM users u
     JOIN customer_profiles p ON p.user_id = u.id
     WHERE u.kind = 'customer'
       AND TRIM(COALESCE(u.full_name, '')) <> ''
       AND TRIM(COALESCE(p.first_name, '')) = ''
       AND TRIM(COALESCE(p.last_name, '')) = ''
     LIMIT ?`,
    [limit],
  );
  let updated = 0;
  for (const row of rows) {
    const { firstName, lastName } = splitFullName(row.full_name);
    // A single-word name has nothing to split: leave it for the profile form,
    // which is the only place that can ask what the family name actually is.
    if (!firstName || !lastName) continue;
    await run(
      'UPDATE customer_profiles SET first_name = ?, last_name = ?, updated_at = ? WHERE user_id = ?',
      [firstName, lastName, nowIso(), row.id],
    );
    updated += 1;
  }
  if (updated) log(`profile names split for ${updated} customer(s)`);
  if (rows.length >= limit) log(`profile name backfill paused at ${limit} rows; the next start will continue`);
  return { updated, scanned: rows.length };
}
