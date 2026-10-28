import { one,q,run,tx,nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest,conflict,forbidden,notFound } from '../../http/errors.js';
import { hasPermission } from '../../lib/permissions.js';
import { officeScope } from '../../lib/scope.js';
import { addEvent,attachDocument } from '../requests/service.js';
import { notifyRole,notifyUser } from '../notifications/service.js';
import { writeAudit } from '../audit/service.js';

type Auth = {user:{id:string;kind:string;fullName:string;roleCode:string|null};permissions:string[]|'*'};
function canDecide(auth:Auth,department:string){
 return officeScope(auth) && hasPermission(auth.permissions,department==='accounting'?'payments.approve':'requests.approve');
}
export async function caseAccess(requestId:string,auth:Auth){
 const row=await one<any>('SELECT * FROM requests WHERE id=?',[requestId]);
 if(!row)throw notFound('پرونده یافت نشد.');
 if(auth.user.kind==='customer'||!hasPermission(auth.permissions,'requests.view')||(!officeScope(auth)&&row.assigned_to!==auth.user.id))throw forbidden('پرونده در محدوده مسئولیت شما نیست.');
 return row;
}
export async function handoff(requestId:string,department:'management'|'accounting',reason:string,auth:Auth){
 return tx(async()=>{
  await run('UPDATE requests SET updated_at=updated_at WHERE id=?',[requestId]);
  const row=await caseAccess(requestId,auth);
  if(!hasPermission(auth.permissions,'requests.edit')&&!canDecide(auth,department))throw forbidden();
  if(['completed','cancelled','rejected'].includes(row.status))throw conflict('پرونده بسته قابل ارجاع نیست.');
  if(await one("SELECT id FROM request_handoffs WHERE request_id=? AND department=? AND status='pending'",[requestId,department]))throw conflict('ارجاع باز به این واحد وجود دارد.');
  const handoffId=id('handoff');
  await run('INSERT INTO request_handoffs(id,request_id,department,reason,created_by,created_at) VALUES(?,?,?,?,?,?)',[handoffId,requestId,department,reason,auth.user.id,nowIso()]);
  await addEvent({requestId,type:'handoff',actorId:auth.user.id,actorName:auth.user.fullName,message:`ارجاع به ${department==='management'?'مدیریت':'حسابداری'}: ${reason}`,visibleToCustomer:false,metadata:{handoffId,department}});
  await notifyRole(department==='management'?['super_admin','manager']:['super_admin','accountant'],{title:'ارجاع جدید برای بررسی',body:`${row.tracking_code} — ${reason}`,link:'/staff/automation'});
  await writeAudit({actorId:auth.user.id,actorName:auth.user.fullName,action:'request.handoff',entityType:'request',entityId:requestId,after:{handoffId,department,reason}});
  return {id:handoffId};
 });
}
export async function deliver(requestId:string,files:{fileId:string;title:string}[],summary:string,auth:Auth){
 return tx(async()=>{
  await run('UPDATE requests SET updated_at=updated_at WHERE id=?',[requestId]);
  const row=await caseAccess(requestId,auth);
  if(!hasPermission(auth.permissions,'requests.edit'))throw forbidden();
  if(!['assigned','in_progress','waiting_documents','waiting_customer'].includes(row.status))throw conflict('پرونده در وضعیت قابل تحویل نیست.');
  if(!files.length)throw badRequest('حداقل یک فایل نتیجه لازم است.');
  for(const file of files)await attachDocument(requestId,file.fileId,file.title,{id:auth.user.id,name:auth.user.fullName},'staff');
  await run("UPDATE requests SET status='under_review',updated_at=? WHERE id=?",[nowIso(),requestId]);
  await addEvent({requestId,type:'delivery',actorId:auth.user.id,actorName:auth.user.fullName,message:`ارسال نتیجه برای تأیید: ${summary}`,fromStatus:row.status,toStatus:'under_review',visibleToCustomer:false});
  const review=await handoff(requestId,'management',summary,auth);
  return {status:'under_review',handoffId:review.id};
 });
}
export async function decide(handoffId:string,decision:'approved'|'returned',note:string,auth:Auth){
 return tx(async()=>{
  const current=await one<any>('SELECT * FROM request_handoffs WHERE id=?',[handoffId]);
  if(!current)throw notFound('ارجاع یافت نشد.');
  if(!canDecide(auth,current.department))throw forbidden('دسترسی تصمیم‌گیری این واحد را ندارید.');
  await run('UPDATE requests SET updated_at=updated_at WHERE id=?',[current.request_id]);
  const changed=await run("UPDATE request_handoffs SET status=?,decision_note=?,decided_by=?,decided_at=? WHERE id=? AND status='pending'",[decision,note,auth.user.id,nowIso(),handoffId]);
  if(!changed.changes)throw conflict('این ارجاع قبلاً بررسی شده است.');
  const row=await one<any>('SELECT * FROM requests WHERE id=?',[current.request_id]);
  if(current.department==='management'&&decision==='approved'){
   await run("UPDATE request_documents SET status='approved',reviewed_by=?,review_note=? WHERE request_id=? AND kind='staff' AND status='pending'",[auth.user.id,note,current.request_id]);
  }
  if(decision==='returned'&&row.status==='under_review')await run("UPDATE requests SET status='in_progress',updated_at=? WHERE id=?",[nowIso(),row.id]);
  await addEvent({requestId:row.id,type:'handoff_decision',actorId:auth.user.id,actorName:auth.user.fullName,message:`${decision==='approved'?'تأیید':'برگشت برای اصلاح'} ${current.department==='management'?'مدیریت':'حسابداری'}: ${note}`,visibleToCustomer:false,metadata:{handoffId,decision}});
  if(row.assigned_to)await notifyUser(row.assigned_to,{title:decision==='approved'?'ارجاع شما تأیید شد':'ارجاع برای اصلاح برگشت خورد',body:note,link:`/staff/requests/${row.id}`});
  await writeAudit({actorId:auth.user.id,actorName:auth.user.fullName,action:'request.handoff_decide',entityType:'request',entityId:row.id,after:{handoffId,decision,note}});
  return {id:handoffId,status:decision};
 });
}
export async function handoffsForCase(requestId:string,auth:Auth){
 await caseAccess(requestId,auth);
 return q<any>(`SELECT h.*,u.full_name AS sender_name,d.full_name AS reviewer_name FROM request_handoffs h JOIN users u ON u.id=h.created_by LEFT JOIN users d ON d.id=h.decided_by WHERE h.request_id=? ORDER BY h.created_at DESC`,[requestId]);
}
export async function inbox(auth:Auth){
 if(auth.user.kind==='customer')throw forbidden();
 const departments=['management','accounting'].filter(d=>canDecide(auth,d));
 const clause=departments.length?`h.department IN (${departments.map(()=>'?').join(',')})`:'h.created_by=?';
 return q<any>(`SELECT h.*,r.tracking_code,s.title AS service_title,u.full_name AS sender_name FROM request_handoffs h JOIN requests r ON r.id=h.request_id JOIN services s ON s.id=r.service_id JOIN users u ON u.id=h.created_by WHERE ${clause} ORDER BY CASE h.status WHEN 'pending' THEN 0 ELSE 1 END,h.created_at DESC LIMIT 100`,departments.length?departments:[auth.user.id]);
}
