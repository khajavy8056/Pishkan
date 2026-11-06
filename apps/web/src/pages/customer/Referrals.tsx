import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppShell, PageHeader } from '../../components/shell';
import { Button, Card, useToast } from '../../components/ui';
import { PublicLayout } from '../../components/public-layout';
import { api, ApiFailure } from '../../lib/api';
import { faNum, rial } from '../../lib/format';

const valid = (v:string) => /^[A-Za-z0-9_-]{16,128}$/.test(v);
export function saveReferral(token:string) { if (valid(token)) sessionStorage.setItem('pishkan.referral',token); }
export function getReferral() { const s=sessionStorage.getItem('pishkan.referral') ?? ''; return valid(s) ? s : ''; }
export function clearReferral() { sessionStorage.removeItem('pishkan.referral'); }

export function InviteLanding() {
  const { token = '' }=useParams();
  useEffect(() => { saveReferral(token); },[token]);
  return <PublicLayout><div className="mx-auto max-w-lg px-4 py-12"><Card><h1 className="text-xl font-bold">دعوت به پیشخوان</h1>{!valid(token) ? <p>لینک دعوت معتبر نیست.</p> : <><p className="my-4 text-sm leading-7">برای ثبت دعوت، با همین مرورگر حساب جدید بسازید و شماره موبایل خود را تأیید کنید. برای اپ نصب‌شده می‌توانید دکمهٔ زیر را بزنید.</p><div className="flex flex-wrap gap-3"><Link to="/register" className="btn-primary">ثبت‌نام در وب</Link><Link to="/login" className="btn-ghost">ورود یا ثبت‌نام پیامکی</Link><a className="btn-ghost" href={`pishkan://invite?ref=${encodeURIComponent(token)}&origin=${encodeURIComponent(window.location.origin)}`}>باز کردن اپ اندروید</a></div><p className="mt-4 text-sm">اگر اپ را بعداً نصب می‌کنید، کد زیر را کپی و در فرم ثبت‌نام اپ وارد کنید؛ انتقال خودکار پس از نصب در همه فروشگاه‌ها تضمین نمی‌شود.</p><code dir="ltr" className="mt-2 block break-all">{token}</code><Button size="sm" onClick={() => void navigator.clipboard.writeText(token)}>کپی کد دعوت</Button></>}</Card></div></PublicLayout>;
}
export function CustomerReferrals() {
  const [items,setItems]=useState<any[]|null>(null); const [error,setError]=useState(''); const {notify}=useToast();
  const load=async()=>{try{const r=await api.get<{data:any[]}>('/api/referrals/mine');setItems(r.data);setError('');}catch(e){setError(e instanceof ApiFailure?e.message:'دریافت کمپین‌ها ناموفق بود.');}};
  useEffect(()=>{void load();},[]);
  const issue=async(id:string)=>{try{await api.post(`/api/referrals/mine/${id}/link`,{});await load();}catch(e){notify(e instanceof ApiFailure?e.message:'ایجاد لینک ناموفق بود.','error');}};
  return <AppShell variant="customer"><PageHeader title="دعوت دوستان" description="با ثبت‌نام دوستان جدید و تأیید شماره موبایل آنها، تا پیش از تکمیل ظرفیت و طبق شرایط هر کمپین پاداش کیف پول دریافت کنید."/>{error&&<p role="alert" className="text-rose-700">{error}</p>}{items===null&&!error&&<p>در حال دریافت…</p>}{items?.length===0&&<p>کمپینی فعال نیست.</p>}<div className="grid gap-4">{items?.map(c=><Card key={c.id}><h2 className="font-bold">{c.title}</h2><p className="my-2 text-sm leading-7">با تأیید ثبت‌نام {faNum(c.threshold)} دوست جدید، یک‌بار {rial(c.rewardAmount)} پاداش کیف پول دریافت می‌کنید، مشروط به باقی‌ماندن ظرفیت. پیشرفت: {faNum(c.qualified)} از {faNum(c.threshold)} · {c.rewarded?'پاداش پرداخت شد':c.accepting?'کمپین فعال':'کمپین متوقف یا ظرفیت تکمیل شده'}</p>{c.token?<><code dir="ltr" className="block break-all text-xs">{`${window.location.origin}/invite/${c.token}`}</code><Button className="mt-2" onClick={async()=>{await navigator.clipboard.writeText(`${window.location.origin}/invite/${c.token}`);notify('لینک کپی شد.','success');}}>کپی لینک دعوت</Button></>:<Button disabled={!c.accepting} onClick={()=>void issue(c.id)}>ساخت لینک دعوت</Button>}</Card>)}</div></AppShell>;
}
