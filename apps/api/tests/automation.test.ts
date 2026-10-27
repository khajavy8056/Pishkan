import {beforeAll,describe,it,expect} from 'vitest';
import request from 'supertest';
import {app,adminSession,customerSession,createStaff,ADMIN} from './helpers.js';
import {one,run} from '../src/db/index.js';
import {updateSettings} from '../src/modules/settings/service.js';
let server:Awaited<ReturnType<typeof app>>,admin:any,operator:any,other:any,accountant:any,manager:any,customer:any,requestId:string,fileId:string,customerId:string,workerId:string,managementId:string,accountingId:string;
beforeAll(async()=>{
 server=await app();customer=await customerSession();customerId=(await request(server).get('/api/auth/me').set('Cookie',customer.cookie)).body.data.id;
 operator=await createStaff('operator',{username:'auto_worker',password:'Worker#Pass123',fullName:'کارمند تحویل'});
 other=await createStaff('operator',{username:'auto_other',password:'Worker#Pass123',fullName:'کارمند نامرتبط'});
 accountant=await createStaff('accountant',{username:'auto_finance',password:'Finance#Pass123',fullName:'حسابدار دفتر'});
 manager=await createStaff('manager',{username:'auto_manager',password:'Manager#Pass123',fullName:'سرپرست دفتر'});
 admin=await adminSession();workerId=(await request(server).get('/api/auth/me').set('Cookie',operator.cookie)).body.data.id;
 await updateSettings({'services.auto_assign':false}, {id:'system',name:'automation test'});
 const service=await request(server).post('/api/catalog/services').set('Cookie',admin.cookie).send({title:'خدمت گردش اداری',baseFee:500000,form:[],documents:[],workflow:[]});expect(service.status).toBe(201);
 const r=await request(server).post('/api/requests').set('Cookie',customer.cookie).send({serviceId:service.body.data.id,formData:{},paymentMethod:'cash'});expect(r.status).toBe(201);requestId=r.body.data.id;
 await run("UPDATE requests SET assigned_to=?,status='in_progress' WHERE id=?",[workerId,requestId]);
 const upload=await request(server).post('/api/files/upload?purpose=delivery').set('Cookie',operator.cookie).attach('file',Buffer.from('%PDF-1.4\nTest output'),'result.pdf');expect(upload.status).toBe(201);fileId=upload.body.data.id;
});
describe('role-aware professional case automation',()=>{
 it('uses the same password login endpoint for worker, accountant, supervisor and super admin',async()=>{
  for(const [identifier,password,role,kind] of [['auto_worker','Worker#Pass123','operator','staff'],['auto_finance','Finance#Pass123','accountant','staff'],['auto_manager','Manager#Pass123','manager','admin'],[ADMIN.username,ADMIN.password,'super_admin','admin']]){
   const r=await request(server).post('/api/auth/login').send({identifier,password});expect(r.status).toBe(200);expect(r.body.data.user.roleCode).toBe(role);expect(r.body.data.user.kind).toBe(kind);
   // Keep the most recent sessions, avoiding the intentional session cap in subsequent assertions.
   if(role==='super_admin')admin={cookie:r.headers['set-cookie']};
  }
 });
 it('enforces settings, staff creation, service creation and accounting on the server',async()=>{
  for(const session of [operator,accountant,manager])await request(server).get('/api/settings/admin').set('Cookie',session.cookie).expect(403);
  await request(server).get('/api/settings/admin').set('Cookie',admin.cookie).expect(200);
  await request(server).post('/api/staff').set('Cookie',operator.cookie).send({}).expect(403);
  await request(server).post('/api/catalog/services').set('Cookie',operator.cookie).send({}).expect(403);
  await request(server).post('/api/catalog/services').set('Cookie',manager.cookie).send({title:'خدمت مدیر',baseFee:250000,form:[]}).expect(201);
  await request(server).post('/api/staff').set('Cookie',manager.cookie).send({fullName:'کارمند ساخته‌شده توسط سرپرست',mobile:'09128881122',username:'manager_created_worker',password:'Manager#Created123',roleCode:'operator'}).expect(201);
  await request(server).get('/api/accounting/invoices').set('Cookie',operator.cookie).expect(403);
  await request(server).get('/api/accounting/invoices').set('Cookie',accountant.cookie).expect(200);
 });
 it('limits customer records to assigned cases and excludes identity numbers from the staff directory',async()=>{
  await request(server).get(`/api/customers/${customerId}`).set('Cookie',other.cookie).expect(403);
  const response=await request(server).get('/api/customers').set('Cookie',other.cookie).expect(200);
  expect(response.body.data.some((row:any)=>row.id===customerId)).toBe(false);
  const own=await request(server).get(`/api/customers/${customerId}`).set('Cookie',operator.cookie).expect(200);
  expect(own.body.data.invoices).toHaveLength(0);
  const directory=await request(server).get('/api/customers').set('Cookie',operator.cookie).expect(200);
  const listed=directory.body.data.find((row:any)=>row.id===customerId);expect(listed).toBeTruthy();expect(listed.nationalId).toBeNull();
 });
 it('rejects delivery by unrelated workers and rolls back foreign-file delivery',async()=>{
  await request(server).post(`/api/requests/${requestId}/deliver`).set('Cookie',other.cookie).send({files:[{fileId,title:'نتیجه خدمت'}],summary:'گزارش انجام کار'}).expect(403);
  const foreign=await request(server).post('/api/files/upload').set('Cookie',other.cookie).attach('file',Buffer.from('%PDF-1.4\nForeign'),'foreign.pdf');expect(foreign.status).toBe(201);
  await request(server).post(`/api/requests/${requestId}/deliver`).set('Cookie',operator.cookie).send({files:[{fileId,title:'نتیجه خدمت'},{fileId:foreign.body.data.id,title:'فایل دیگری'}],summary:'گزارش انجام کار'}).expect(403);
  expect((await one<any>('SELECT COUNT(*) AS c FROM request_documents WHERE request_id=?',[requestId])).c).toBe(0);
  expect((await one<any>('SELECT status FROM requests WHERE id=?',[requestId])).status).toBe('in_progress');
 });
 it('submits private output for management review and prevents premature completion or publication',async()=>{
  const sent=await request(server).post(`/api/requests/${requestId}/deliver`).set('Cookie',operator.cookie).send({files:[{fileId,title:'نتیجه خدمت'}],summary:'عملیات انجام شد؛ نتیجه برای تأیید نهایی'});expect(sent.status).toBe(200);expect(sent.body.data.status).toBe('under_review');managementId=sent.body.data.handoffId;
  const customerView=await request(server).get(`/api/requests/${requestId}`).set('Cookie',customer.cookie);expect(customerView.body.data.documents).toHaveLength(0);expect(customerView.body.data.events.some((e:any)=>e.type==='delivery')).toBe(false);
  await request(server).get(`/api/files/${fileId}`).set('Cookie',customer.cookie).expect(403);
  await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie',operator.cookie).send({status:'ready'}).expect(403);
  await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie',admin.cookie).send({status:'ready'}).expect(409);
 });
 it('separates accounting referral from managerial approval and prevents duplicate referral',async()=>{
  const r=await request(server).post(`/api/requests/${requestId}/handoffs`).set('Cookie',operator.cookie).send({department:'accounting',reason:'لطفاً وضعیت فاکتور و دریافت وجه بررسی شود'});expect(r.status).toBe(201);accountingId=r.body.data.id;
  await request(server).post(`/api/requests/${requestId}/handoffs`).set('Cookie',operator.cookie).send({department:'accounting',reason:'ارجاع دوباره به حسابداری'}).expect(409);
  await request(server).post(`/api/automation/${managementId}/decision`).set('Cookie',accountant.cookie).send({decision:'approved',note:'تأیید غیرمجاز مدیریت'}).expect(403);
  await request(server).post(`/api/automation/${accountingId}/decision`).set('Cookie',operator.cookie).send({decision:'approved',note:'تأیید خودمجاز نیست'}).expect(403);
  const inbox=await request(server).get('/api/automation/inbox').set('Cookie',accountant.cookie);expect(inbox.status).toBe(200);expect(inbox.body.data.some((r:any)=>r.id===managementId)).toBe(false);expect(inbox.body.data.some((r:any)=>r.id===accountingId)).toBe(true);
 });
 it('keeps internal notes out of customer notifications',async()=>{
  const before=await one<any>('SELECT COUNT(*) AS c FROM notifications WHERE user_id=?',[customerId]);
  await request(server).post(`/api/requests/${requestId}/notes`).set('Cookie',operator.cookie).send({message:'شرح محرمانه داخلی',visibleToCustomer:false}).expect(200);
  expect((await one<any>('SELECT COUNT(*) AS c FROM notifications WHERE user_id=?',[customerId])).c).toBe(before.c);
 });
 it('publishes approved output, deduplicates decisions and blocks close until all departments respond',async()=>{
  const decisions=await Promise.all([1,2].map(()=>request(server).post(`/api/automation/${managementId}/decision`).set('Cookie',manager.cookie).send({decision:'approved',note:'نتیجه بررسی و تأیید شد'})));expect(decisions.map(r=>r.status).sort()).toEqual([200,409]);
  await request(server).get(`/api/files/${fileId}`).set('Cookie',customer.cookie).expect(200);
  const customerView=await request(server).get(`/api/requests/${requestId}`).set('Cookie',customer.cookie);expect(customerView.body.data.documents).toHaveLength(1);
  await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie',manager.cookie).send({status:'ready'}).expect(409);
  await request(server).post(`/api/automation/${accountingId}/decision`).set('Cookie',accountant.cookie).send({decision:'approved',note:'فاکتور بررسی شد؛ ثبت پرداخت عملیاتی جداگانه است'}).expect(200);
  expect((await one<any>('SELECT COUNT(*) AS c FROM payments WHERE request_id=?',[requestId])).c).toBe(0);
  await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie',manager.cookie).send({status:'ready'}).expect(200);
  await request(server).patch(`/api/requests/${requestId}/status`).set('Cookie',manager.cookie).send({status:'completed'}).expect(200);
 });
});
