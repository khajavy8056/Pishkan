import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Button,Input,useToast } from './ui';
export function MobileVerification(){
 const {user,refresh}=useAuth();const {notify}=useToast();const [requested,setRequested]=useState(false);const [code,setCode]=useState('');const [busy,setBusy]=useState(false);
 if(!user?.mobile)return null;
 if(user.mobileVerified)return <p className="mb-4 text-xs text-brand-700">مالکیت شماره موبایل تأیید شده است.</p>;
 return <div className="mb-5 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>مالکیت شماره <b dir="ltr">{user.mobile}</b> هنوز تأیید نشده است. ورود رمزی همچنان قابل استفاده است.</p>{!requested?<Button variant="ghost" loading={busy} onClick={async()=>{if(!confirm(`ارسال پیامک واقعی به شماره ${user.mobile} را تأیید می‌کنید؟`))return;setBusy(true);try{const r=await api.post<{data:{sent:boolean;error?:string}}>('/api/auth/mobile/verify/request',{confirm:true});if(!r.data.sent)throw new Error(r.data.error??'ارسال انجام نشد');setRequested(true);notify('کد ارسال شد','success')}catch(e){notify(e instanceof Error?e.message:'خطا','error')}finally{setBusy(false)}}}>ارسال کد تأیید مالکیت</Button>:<div className="flex gap-2"><Input aria-label="کد تأیید موبایل" inputMode="numeric" value={code} onChange={e=>setCode(e.target.value)} /><Button loading={busy} onClick={async()=>{setBusy(true);try{await api.post('/api/auth/mobile/verify/confirm',{code});await refresh();notify('شماره تأیید شد','success')}catch(e){notify(e instanceof Error?e.message:'خطا','error')}finally{setBusy(false)}}}>تأیید</Button></div>}</div>;
}
