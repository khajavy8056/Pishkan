import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell,PageHeader } from '../../components/shell';
import { Button,Card,EmptyState,ErrorState,Loading,useToast } from '../../components/ui';
import { api } from '../../lib/api';
export function EligibleQueue(){
 const [rows,setRows]=useState<any[]|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState('');const {notify}=useToast();
 const load=()=>{setError('');api.get<{data:any[]}>('/api/requests/queue/eligible').then(r=>setRows(r.data)).catch(e=>setError(e.message))};useEffect(load,[]);
 return <AppShell variant="staff"><PageHeader title="صف پذیرش خدمات" description="فقط پرونده‌های متناسب با مهارت، شیفت و ظرفیت شما نمایش داده می‌شوند. تا زمان پذیرش، اطلاعات مشتری محرمانه می‌ماند." actions={<Button variant="ghost" onClick={load}>تازه‌سازی صف</Button>} />{error&&<ErrorState message={error} onRetry={load} />}{!rows&&!error&&<Loading />}{rows?.length===0&&<EmptyState title="پرونده واجد شرایطی در صف نیست" description="شیفت فعال، ثبت ورود و ظرفیت کاری خود را بررسی کنید." />}<div className="grid gap-4 md:grid-cols-2">{rows?.map(r=><Card key={r.id}><span className="badge bg-brand-50 text-brand-800">{r.priority==='high'?'فوری':'عادی'}</span><h2 className="my-4 font-bold">{r.serviceTitle}</h2><p className="mb-4 text-xs text-navy-500">کد پیگیری {r.trackingCode}</p><Button loading={busy===r.id} onClick={async()=>{setBusy(r.id);try{await api.post(`/api/requests/${r.id}/claim`);notify('پرونده به شما اختصاص یافت.','success');load()}catch(e){notify(e instanceof Error?e.message:'خطا','error')}finally{setBusy('')}}}>پذیرش پرونده</Button></Card>)}</div><Link className="btn-soft mt-5" to="/staff/requests">پرونده‌های من</Link></AppShell>;
}
