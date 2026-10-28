import { one,q,run,tx,nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict } from '../../http/errors.js';

export async function compensation(userId: string) {
 const contracts=await q<any>('SELECT * FROM compensation_contracts WHERE user_id=? ORDER BY starts_on DESC',[userId]);
 const entries=await q<any>('SELECT * FROM compensation_entries WHERE user_id=? ORDER BY created_at DESC LIMIT 500',[userId]);
 const sum=await one<any>("SELECT COALESCE(SUM(amount),0) AS balance, COALESCE(SUM(CASE WHEN kind<>'settlement' THEN amount ELSE 0 END),0) AS accrued, COALESCE(SUM(CASE WHEN kind='settlement' THEN -amount ELSE 0 END),0) AS settled FROM compensation_entries WHERE user_id=?",[userId]);
 return {contracts,entries,balance:Number(sum.balance),accrued:Number(sum.accrued),settled:Number(sum.settled)};
}
/** Entries are append-only. A refund reverses the original split, never today's contract. */
export async function accrueCommission(paymentId: string, reverse = false) {
 return tx(async()=>{
  const payment=await one<any>('SELECT * FROM payments WHERE id=?',[paymentId]);
  if(!payment) return;
  if(reverse){
   const originals=await q<any>("SELECT * FROM compensation_entries WHERE payment_id=? AND kind='commission'",[paymentId]);
   for(const e of originals) await append({...e,id:id('comp'),operation_key:`refund:${e.operation_key}`,kind:'reversal',amount:-Number(e.amount),created_by:'system',created_at:nowIso()});
   return;
  }
  if(payment.status!=='confirmed' || !payment.request_id) return;
  const request=await one<any>('SELECT * FROM requests WHERE id=?',[payment.request_id]);
  if(!request?.assigned_to) return;
  const date=String(payment.paid_at ?? nowIso()).slice(0,10);
  const contract=await one<any>("SELECT * FROM compensation_contracts WHERE user_id=? AND kind='commission' AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?) ORDER BY starts_on DESC LIMIT 1",[request.assigned_to,date,date]);
  if(!contract)return;
  const invoice=payment.invoice_id?await one<any>('SELECT total,tax FROM invoices WHERE id=?',[payment.invoice_id]):null;
  const basis=invoice?.total>0?Math.round(Number(payment.amount)*(Number(invoice.total)-Number(invoice.tax))/Number(invoice.total)):Number(payment.amount);
  const amount=Math.round(basis*Number(contract.commission_percent)/100);
  await append({id:id('comp'),operation_key:`commission:${paymentId}:${request.assigned_to}`,user_id:request.assigned_to,contract_id:contract.id,kind:'commission',amount,payment_id:paymentId,request_id:request.id,snapshot:JSON.stringify({contract,basis,percent:contract.commission_percent}),created_by:'system',created_at:nowIso()});
 });
}
async function append(e:any){
 await run(`INSERT INTO compensation_entries(id,operation_key,user_id,contract_id,kind,amount,period,payment_id,request_id,snapshot,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(operation_key) DO NOTHING`,[e.id,e.operation_key,e.user_id,e.contract_id??null,e.kind,e.amount,e.period??null,e.payment_id??null,e.request_id??null,e.snapshot??'{}',e.note??null,e.created_by,e.created_at]);
}
export async function createContract(input:{userId:string;kind:'monthly'|'commission';monthlyAmount:number;commissionPercent:number;startsOn:string;endsOn?:string},actorId:string){
 return tx(async()=>{
  const user=await one<any>("SELECT * FROM users WHERE id=? AND kind IN ('staff','admin')",[input.userId]);
  if(!user)throw badRequest('کارمند یافت نشد.');
  await run('UPDATE users SET updated_at=updated_at WHERE id=?',[user.id]);
  if(input.endsOn && input.endsOn<input.startsOn)throw badRequest('پایان قرارداد پیش از شروع است.');
  const overlaps=await one("SELECT id FROM compensation_contracts WHERE user_id=? AND kind=? AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)",[user.id,input.kind,input.endsOn??'9999-12-31',input.startsOn]);
  if(overlaps)throw conflict('قراردادها نباید هم‌پوشانی زمانی داشته باشند. قرارداد قبلی را با تاریخ پایان مشخص ثبت کنید.');
  const contractId=id('contract');
  await run('INSERT INTO compensation_contracts(id,user_id,kind,monthly_amount,commission_percent,starts_on,ends_on,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',[contractId,user.id,input.kind,input.monthlyAmount,input.commissionPercent,input.startsOn,input.endsOn??null,actorId,nowIso()]);
  return {id:contractId};
 });
}
/** Explicit Gregorian month; partial contracts prorated by calendar days. No hidden scheduler. */
export async function accrueMonth(month:string,actorId:string){
 return tx(async()=>{
  const start=`${month}-01`;const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  const days=Number(end.slice(8));
  const contracts=await q<any>("SELECT * FROM compensation_contracts WHERE kind='monthly' AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)",[end,start]);
  for(const c of contracts){
   const first=c.starts_on>start?c.starts_on:start;const last=c.ends_on&&c.ends_on<end?c.ends_on:end;
   const covered=Math.round((Date.parse(last)-Date.parse(first))/86400000)+1;
   await append({id:id('comp'),operation_key:`salary:${c.id}:${month}`,user_id:c.user_id,contract_id:c.id,kind:'salary',amount:Math.round(Number(c.monthly_amount)*covered/days),period:month,snapshot:JSON.stringify({contract:c,covered,days}),created_by:actorId,created_at:nowIso()});
  }
  return {month,contracts:contracts.length};
 });
}
export async function settle(userId:string,amount:number,key:string,note:string,actorId:string){
 return tx(async()=>{
  await run('UPDATE users SET updated_at=updated_at WHERE id=?',[userId]);
  const existing=await one<any>('SELECT * FROM compensation_entries WHERE operation_key=?',[`settlement:${key}`]);
  if(existing){if(existing.user_id!==userId || Number(existing.amount)!==-amount)throw conflict('کلید تکرار با مبلغ متفاوت ارسال شده است.');return existing;}
  const state=await compensation(userId);
  if(amount>state.balance)throw badRequest('مبلغ تسویه بیشتر از مانده قابل پرداخت است.');
  await append({id:id('comp'),operation_key:`settlement:${key}`,user_id:userId,kind:'settlement',amount:-amount,note,created_by:actorId,created_at:nowIso()});
  return compensation(userId);
 });
}
