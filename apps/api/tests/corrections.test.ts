import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup } from '../src/modules/system/backup.js';
import { env } from '../src/env.js';
import { beforeAll,afterEach,describe,it,expect,vi } from 'vitest';
import request from 'supertest';
import {app,adminSession,customerSession,createStaff} from './helpers.js';
import {one,q,run} from '../src/db/index.js';
import {updateSettings} from '../src/modules/settings/service.js';
import {createInvoice,createPayment,confirmPayment,refundPayment,getInvoice} from '../src/modules/accounting/service.js';
import {startZarinpal,verifyZarinpal} from '../src/modules/accounting/zarinpal.js';
import {createContract,accrueMonth,compensation,settle} from '../src/modules/payroll/service.js';
let server:Awaited<ReturnType<typeof app>>,admin:any,customer:any,customerId:string,serviceId:string,staffId:string,staff:any;
const actor={id:'system',name:'correction-tests'};
beforeAll(async()=>{
 server=await app();customer=await customerSession();customerId=(await request(server).get('/api/auth/me').set('Cookie',customer.cookie)).body.data.id;
 staff=await createStaff('operator',{username:'corrections_worker',password:'Test#Worker123',fullName:'کارمند آزمون اصلاحات'});
 staffId=(await request(server).get('/api/auth/me').set('Cookie',staff.cookie)).body.data.id;admin=await adminSession();
 await updateSettings({'services.auto_assign':false,'workforce.auto_assign_on_shift':false},actor);
 const r=await request(server).post('/api/catalog/services').set('Cookie',admin.cookie).send({title:'خدمت آزمون اصلاحات',baseFee:100001,discountPercent:10,urgentEnabled:true,urgentPercent:25,urgentDays:1,urgentCapacity:1,form:[]});expect(r.status).toBe(201);serviceId=r.body.data.id;
});
afterEach(()=>vi.unstubAllGlobals());
describe('corrected workflows',()=>{
 it('quotes exact integer IRR and issues matching urgent invoice once under capacity contention',async()=>{
  const quote=await request(server).post('/api/requests/quote').set('Cookie',customer.cookie).send({serviceId,priority:'high'});expect(quote.status).toBe(200);expect(quote.body.data.urgentFee).toBe(25000);expect(quote.body.data.total).toBe(115001);
  const results=await Promise.all([1,2].map(()=>request(server).post('/api/requests').set('Cookie',customer.cookie).send({serviceId,priority:'high',paymentMethod:'cash',formData:{}})));
  expect(results.map(r=>r.status).sort()).toEqual([201,409]);
  const created=results.find(r=>r.status===201)!.body.data;
  const invoice=await one<any>('SELECT * FROM invoices WHERE request_id=?',[created.id]);expect(invoice.total).toBe(quote.body.data.total);expect(JSON.parse(invoice.items)).toHaveLength(2);
 });
 it('filters city catalog and blocks direct cross-city submission, without rewriting historical snapshots',async()=>{
  const old=await one<any>('SELECT snapshot FROM requests WHERE service_id=?',[serviceId]);
  await request(server).patch(`/api/catalog/services/${serviceId}`).set('Cookie',admin.cookie).send({coverage:'cities',cityIds:['shiraz']}).expect(200);
  const catalog=await request(server).get('/api/public/services?pageSize=100').set('Cookie',customer.cookie);expect(catalog.body.data.some((s:any)=>s.id===serviceId)).toBe(false);
  await request(server).post('/api/requests').set('Cookie',customer.cookie).send({serviceId,formData:{}}).expect(403);
  expect((await one<any>('SELECT snapshot FROM requests WHERE service_id=?',[serviceId])).snapshot).toBe(old.snapshot);
  await request(server).patch(`/api/catalog/services/${serviceId}`).set('Cookie',admin.cookie).send({coverage:'nationwide'}).expect(200);
 });
 it('atomically claims a case and shows no customer details in eligible queue',async()=>{
  const r=await request(server).post('/api/requests').set('Cookie',customer.cookie).send({serviceId,formData:{},paymentMethod:'cash'});expect(r.status).toBe(201);
  const queue=await request(server).get('/api/requests/queue/eligible').set('Cookie',staff.cookie);expect(queue.status).toBe(200);const item=queue.body.data.find((x:any)=>x.id===r.body.data.id);expect(item).toBeTruthy();expect(item.customerId).toBeUndefined();
  const claims=await Promise.all([1,2].map(()=>request(server).post(`/api/requests/${r.body.data.id}/claim`).set('Cookie',staff.cookie)));expect(claims.map(x=>x.status).sort()).toEqual([200,409]);
 });
 it('concurrent confirmations and refunds update invoice and ledger exactly once',async()=>{
  const invoice=(await createInvoice({customerId,title:'Concurrent invoice',items:[{title:'item',qty:1,unitPrice:100000}]},actor))!;
  const payment:any=await createPayment({customerId,invoiceId:invoice.id,method:'online',amount:100000,gateway:'mock'},actor);
  await Promise.all([1,2,3].map(()=>confirmPayment(payment.id,actor,'mock-ref')));
  expect((await getInvoice(invoice.id))!.paidAmount).toBe(100000);
  expect((await one<any>("SELECT COUNT(*) AS c FROM ledger_entries WHERE ref_type='payment' AND ref_id=?",[payment.id])).c).toBe(2);
  const refunds=await Promise.allSettled([1,2].map(()=>refundPayment(payment.id,'test refund',actor)));expect(refunds.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await getInvoice(invoice.id))!.paidAmount).toBe(0);
 });
 it('creates immutable dated salary, deduplicates accrual and settlement, protects personal payroll',async()=>{
  await createContract({userId:staffId,kind:'monthly',monthlyAmount:31000000,commissionPercent:0,startsOn:'2026-10-01',endsOn:'2026-10-31'},actor.id);
  await Promise.all([1,2].map(()=>accrueMonth('2026-10',actor.id)));let state=await compensation(staffId);expect(state.accrued).toBe(31000000);expect(state.entries).toHaveLength(1);
  await Promise.all([1,2].map(()=>settle(staffId,10000000,'test-settlement-key','test receipt',actor.id)));state=await compensation(staffId);expect(state.balance).toBe(21000000);expect(state.entries).toHaveLength(2);
  await request(server).get(`/api/payroll/staff/${customerId}`).set('Cookie',staff.cookie).expect(403);
  const own=await request(server).get('/api/payroll/me').set('Cookie',staff.cookie);expect(own.body.data.balance).toBe(21000000);
 });
 it('uses PSP request and server verify with saved IRR amount, rejects mismatched authority, deduplicates callback',async()=>{
  await updateSettings({'accounting.online_payment_enabled':true,'accounting.gateway':'zarinpal','accounting.gateway_sandbox':true,'accounting.gateway_merchant_id':'12345678-1234-1234-1234-123456789abc'},actor);
  const invoice=(await createInvoice({customerId,title:'Gateway contract test',items:[{title:'item',qty:1,unitPrice:100000}]},actor))!;
  const authority='A'+'1'.repeat(35);
  const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:{code:100,authority}}),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({data:{code:100,ref_id:123456}}),{status:200}));vi.stubGlobal('fetch',fetchMock);
  const start=await startZarinpal(invoice.id,customerId);expect(start.paymentUrl).toBe(`https://sandbox.zarinpal.com/pg/StartPay/${authority}`);
  const requestPayload=JSON.parse(fetchMock.mock.calls[0][1].body);expect(requestPayload.amount).toBe(100000);expect(requestPayload.currency).toBe('IRR');
  await expect(verifyZarinpal(start.paymentId,'wrong','OK')).rejects.toThrow();expect((await getInvoice(invoice.id))!.paidAmount).toBe(0);
  const callback=await request(server).get(`/api/accounting/gateway/zarinpal?paymentId=${start.paymentId}&Authority=${authority}&Status=OK`);expect(callback.status).toBe(303);expect((await getInvoice(invoice.id))!.paidAmount).toBe(100000);
  await verifyZarinpal(start.paymentId,authority,'OK');expect(fetchMock).toHaveBeenCalledTimes(2);
  const verifyPayload=JSON.parse(fetchMock.mock.calls[1][1].body);expect(verifyPayload.amount).toBe(100000);expect(verifyPayload.authority).toBe(authority);
 });
 it('snapshots commission and reverses the original share after refund',async()=>{
  await createContract({userId:staffId,kind:'commission',monthlyAmount:0,commissionPercent:20,startsOn:'2026-11-01'},actor.id);
  const r=await request(server).post('/api/requests').set('Cookie',customer.cookie).send({serviceId,formData:{},paymentMethod:'cash'});expect(r.status).toBe(201);
  await run('UPDATE requests SET assigned_to=? WHERE id=?',[staffId,r.body.data.id]);
  const invoice=await one<any>('SELECT * FROM invoices WHERE request_id=?',[r.body.data.id]);
  // Select a commission date via fake clock; no historical records are modified.
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
  try{const payment:any=await createPayment({customerId,invoiceId:invoice.id,amount:invoice.total,method:'cash',status:'confirmed'},actor);
   const accrued=await one<any>("SELECT * FROM compensation_entries WHERE payment_id=? AND kind='commission'",[payment.id]);expect(accrued.amount).toBe(Math.round(invoice.total*.2));
   await refundPayment(payment.id,'refund original share',actor);const reversal=await one<any>("SELECT amount FROM compensation_entries WHERE payment_id=? AND kind='reversal'",[payment.id]);expect(reversal.amount).toBe(-accrued.amount);
  }finally{vi.useRealTimers()}
 });
 it('round-trips a SQLite snapshot into an isolated restore target',async()=>{
  const before=await one<any>('SELECT COUNT(*) AS c FROM invoices');
  const backup=await createBackup(actor,'isolated restore round-trip');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pishkan-restore-'));
  try{
   const restored=path.join(dir,'restored.sqlite');fs.copyFileSync(path.join(backup.location??env.backupDir,backup.filename),restored);
   let db=new DatabaseSync(restored);expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');expect(db.prepare('SELECT COUNT(*) AS c FROM invoices').get()!.c).toBe(before.c);
   db.exec('DELETE FROM invoices');db.close();fs.copyFileSync(path.join(backup.location??env.backupDir,backup.filename),restored);
   db=new DatabaseSync(restored);expect(db.prepare('SELECT COUNT(*) AS c FROM invoices').get()!.c).toBe(before.c);db.close();
   expect((await one<any>('SELECT COUNT(*) AS c FROM invoices')).c).toBe(before.c);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
 });
 it('serves versioned authenticated API and verifies mobile only after a scoped challenge',async()=>{
  const me=await request(server).get('/api/v1/auth/me').set('Cookie',staff.cookie);expect(me.status).toBe(200);
  await run('UPDATE users SET mobile_verified=0 WHERE id=?',[staffId]);
  const unverified=await request(server).post('/api/auth/otp/request').send({mobile:me.body.data.mobile,kind:'staff'});expect(unverified.status).toBe(403);
  const challenge=await request(server).post('/api/auth/mobile/verify/request').set('Cookie',staff.cookie).send({confirm:true});expect(challenge.status).toBe(200);expect(challenge.body.data.debugCode).toBeTruthy();
  const verified=await request(server).post('/api/auth/mobile/verify/confirm').set('Cookie',staff.cookie).send({code:challenge.body.data.debugCode});expect(verified.status).toBe(200);expect((await one<any>('SELECT mobile_verified FROM users WHERE id=?',[staffId])).mobile_verified).toBe(1);
 });

});
