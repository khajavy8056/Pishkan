import { one } from '../../db/index.js';
import { forbidden } from '../../http/errors.js';
export function validNationalId(input: string): boolean {
 const code = String(input).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
 if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
 const sum = [...code.slice(0,9)].reduce((n,d,i) => n + Number(d)*(10-i),0) % 11;
 return Number(code[9]) === (sum < 2 ? sum : 11-sum);
}
export async function profileState(userId: string) {
 const row = await one<any>(`SELECT p.*, u.full_name, u.mobile, u.national_id FROM users u LEFT JOIN customer_profiles p ON p.user_id=u.id WHERE u.id=?`, [userId]);
 const missing: string[] = [];
 if (!row?.first_name?.trim()) missing.push('نام');
 if (!row?.last_name?.trim()) missing.push('نام خانوادگی');
 if (!/^09\d{9}$/.test(row?.mobile ?? '')) missing.push('موبایل');
 if (!validNationalId(row?.national_id ?? '')) missing.push('کد ملی معتبر');
 if (!row?.city_id || !await one('SELECT id FROM cities WHERE id=? AND is_active=1',[row.city_id])) missing.push('شهر');
 return { complete: missing.length === 0, missing, profile: row ?? null };
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
