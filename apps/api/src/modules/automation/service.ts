import { one,q,run,tx,nowIso } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest,conflict,forbidden,notFound } from '../../http/errors.js';
import { hasPermission } from '../../lib/permissions.js';
import { officeScope } from '../../lib/scope.js';
import { addEvent,attachDocument,reviewDocument,reconcileAfterDocumentReview,snapshotSteps,refreshWorkBucket } from '../requests/service.js';
import { notifyRole,notifyUser } from '../notifications/service.js';
import { writeAudit } from '../audit/service.js';
import { accrueCommissionsForRequest } from '../payroll/service.js';
import { logEvent } from '../logging/service.js';

/** Best-effort commission sweep after a delivery milestone; never blocks it. */
async function sweepCommissions(requestId:string){
 await accrueCommissionsForRequest(requestId).catch((error)=>{
  logEvent({level:'WARNING',category:'payment',action:'commission.sweep_failed',result:'failure',entityType:'request',entityId:requestId,message:String((error as Error)?.message??error)}).catch(()=>undefined);
 });
}

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
export async function deliver(requestId:string,files:{fileId:string;title:string;replacesDocumentId?:string|null}[],summary:string,auth:Auth){
 const outcome=await tx(async()=>{
  await run('UPDATE requests SET updated_at=updated_at WHERE id=?',[requestId]);
  const row=await caseAccess(requestId,auth);
  if(!hasPermission(auth.permissions,'requests.edit'))throw forbidden();
  if(!['assigned','in_progress','waiting_documents','waiting_customer'].includes(row.status))throw conflict('پرونده در وضعیت قابل تحویل نیست.');
  if(await one("SELECT id FROM request_handoffs WHERE request_id=? AND department='management' AND status='pending' LIMIT 1",[requestId])) {
   throw conflict('ارجاع مدیریت قبلی هنوز باز است؛ ابتدا تصمیم آن را ثبت کنید.');
  }
  // Direct delivery is the normal path: the executor hands the result to
  // the customer and the case completes immediately. Services flagged
  // `requires_manager_approval` (special cases) keep the old review loop:
  // result files stay hidden until a manager approves them.
  const service=await one<any>('SELECT requires_manager_approval,title FROM services WHERE id=?',[row.service_id]);
  const needsApproval=Boolean(Number(service?.requires_manager_approval??0));
  if(needsApproval&&!files.length)throw badRequest('برای این خدمت، پیوست‌کردن حداقل یک فایل نتیجه برای بررسی مدیر لازم است.');

  const rejected=await q<any>(`SELECT d.id,d.title FROM request_documents d
   WHERE d.request_id=? AND d.kind='staff' AND d.status='rejected'
    AND NOT EXISTS(SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)
   ORDER BY d.created_at DESC`,[requestId]);
  const selectedReplacements=new Set<string>();
  const preparedFiles=files.map((file)=>{
   let replacesDocumentId=file.replacesDocumentId??null;
   if(!replacesDocumentId&&rejected.length){
    const exact=rejected.filter((document)=>document.title===file.title&&!selectedReplacements.has(document.id));
    if(exact.length===1)replacesDocumentId=exact[0].id;
    else if(rejected.length===1&&files.length===1)replacesDocumentId=rejected[0].id;
   }
   if(replacesDocumentId){
    if(!rejected.some((document)=>document.id===replacesDocumentId))throw conflict('شناسهٔ جایگزینی باید به نتیجهٔ ردشده و فعال همین پرونده اشاره کند.');
    if(selectedReplacements.has(replacesDocumentId))throw conflict('هر نتیجهٔ ردشده فقط یک بار می‌تواند جایگزین شود.');
    selectedReplacements.add(replacesDocumentId);
   }
   return {...file,replacesDocumentId};
  });
  if(rejected.some((document)=>!selectedReplacements.has(document.id))){
   throw conflict('برای هر نتیجهٔ ردشده، نسخهٔ جایگزین را انتخاب کنید؛ نتیجهٔ قبلی تا آن زمان جلوی تحویل نهایی را می‌گیرد.');
  }

  for(const file of preparedFiles)await attachDocument(requestId,file.fileId,file.title,{id:auth.user.id,name:auth.user.fullName},'staff',{replacesDocumentId:file.replacesDocumentId,delivered:!needsApproval});

  if(needsApproval){
   await run("UPDATE requests SET status='under_review',updated_at=? WHERE id=?",[nowIso(),requestId]);
   await addEvent({requestId,type:'delivery',actorId:auth.user.id,actorName:auth.user.fullName,message:`ارسال نتیجه برای تأیید: ${summary}`,fromStatus:row.status,toStatus:'under_review',visibleToCustomer:false});
   const review=await handoff(requestId,'management',summary,auth);
   await writeAudit({actorId:auth.user.id,actorName:auth.user.fullName,action:'request.deliver',entityType:'request',entityId:requestId,before:{status:row.status},after:{status:'under_review',mode:'approval',handoffId:review.id,files:preparedFiles.length}});
   await refreshWorkBucket(requestId);
   return {status:'under_review',handoffId:review.id,mode:'approval'};
  }

  const steps=snapshotSteps(row.snapshot);
  const lastStep=Math.max(0,steps.length-1);
  const ts=nowIso();
  await run("UPDATE requests SET status='completed',completed_at=?,current_step=?,updated_at=? WHERE id=?",[ts,lastStep,ts,requestId]);
  await addEvent({requestId,type:'delivery',actorId:auth.user.id,actorName:auth.user.fullName,message:`تحویل نهایی به مشتری: ${summary}`,fromStatus:row.status,toStatus:'completed',visibleToCustomer:true,metadata:{files:preparedFiles.map((file)=>file.fileId)}});
  await refreshWorkBucket(requestId);
  await notifyUser(row.customer_id,{
   title:'درخواست شما تحویل شد',
   body:`«${service?.title??'درخواست'}» (${row.tracking_code}) — ${summary}`.slice(0,300),
   kind:'success',link:`/app/requests/${requestId}`,push:true,
   idempotencyKey:`request:${requestId}:delivered`,
   sms:{eventCode:'request_status',variables:{tracking_code:row.tracking_code,status:'تکمیل‌شده'}},
  }).catch(()=>undefined);
  await writeAudit({actorId:auth.user.id,actorName:auth.user.fullName,action:'request.deliver',entityType:'request',entityId:requestId,before:{status:row.status},after:{status:'completed',mode:'direct',files:preparedFiles.length}});
  return {status:'completed',mode:'direct'};
 });
 // Delivery is the last safety net: any confirmed payment that predates the
 // assignment becomes the executor's recorded income now.
 if(outcome.status==='completed')await sweepCommissions(requestId);
 return outcome;
}
export async function decide(handoffId:string,decision:'approved'|'returned',note:string,auth:Auth){
 const outcome=await tx(async()=>{
  const current=await one<any>('SELECT * FROM request_handoffs WHERE id=?',[handoffId]);
  if(!current)throw notFound('ارجاع یافت نشد.');
  if(!canDecide(auth,current.department))throw forbidden('دسترسی تصمیم‌گیری این واحد را ندارید.');
  await run('UPDATE requests SET updated_at=updated_at WHERE id=?',[current.request_id]);
  const changed=await run("UPDATE request_handoffs SET status=?,decision_note=?,decided_by=?,decided_at=? WHERE id=? AND status='pending'",[decision,note,auth.user.id,nowIso(),handoffId]);
  if(!changed.changes)throw conflict('این ارجاع قبلاً بررسی شده است.');
  let row=await one<any>('SELECT * FROM requests WHERE id=?',[current.request_id]);
  if(!row)throw notFound('درخواست یافت نشد.');

  if(current.department==='management'&&decision==='approved'){
   const pendingFiles=await q<any>(`SELECT d.id FROM request_documents d
    WHERE d.request_id=? AND d.kind='staff' AND d.status='pending'
     AND NOT EXISTS(SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)
    ORDER BY d.created_at ASC`,[current.request_id]);
   for(const file of pendingFiles)await reviewDocument(file.id,'approved',note,{id:auth.user.id,name:auth.user.fullName});
  }
  if(current.department==='management'&&decision==='returned'&&row.status==='under_review'){
   const pendingFiles=await q<any>(`SELECT d.id FROM request_documents d
    WHERE d.request_id=? AND d.kind='staff' AND d.status='pending'
     AND NOT EXISTS(SELECT 1 FROM request_documents child WHERE child.replaces_document_id=d.id)
    ORDER BY d.created_at ASC`,[current.request_id]);
   for(const file of pendingFiles)await reviewDocument(file.id,'rejected',note,{id:auth.user.id,name:auth.user.fullName});
   row=await one<any>('SELECT * FROM requests WHERE id=?',[current.request_id]);
   if(row?.status==='under_review'){
    const ts=nowIso();
    await run("UPDATE requests SET status='in_progress',updated_at=? WHERE id=?",[ts,row.id]);
    await addEvent({requestId:row.id,type:'status',actorId:auth.user.id,actorName:auth.user.fullName,fromStatus:'under_review',toStatus:'in_progress',message:'نتیجهٔ تحویل برای اصلاح برگشت داده شد.'});
    row={...row,status:'in_progress'};
   }
  }

  await reconcileAfterDocumentReview(row.id,{id:auth.user.id,name:auth.user.fullName});
  await addEvent({requestId:row.id,type:'handoff_decision',actorId:auth.user.id,actorName:auth.user.fullName,message:`${decision==='approved'?'تأیید':'برگشت برای اصلاح'} ${current.department==='management'?'مدیریت':'حسابداری'}: ${note}`,visibleToCustomer:false,metadata:{handoffId,decision}});
  if(row.assigned_to)await notifyUser(row.assigned_to,{title:decision==='approved'?'ارجاع شما تأیید شد':'ارجاع برای اصلاح برگشت خورد',body:note,link:`/staff/requests/${row.id}`});
  await writeAudit({actorId:auth.user.id,actorName:auth.user.fullName,action:'request.handoff_decide',entityType:'request',entityId:row.id,after:{handoffId,decision,note}});
  await refreshWorkBucket(row.id);
  return {id:handoffId,status:decision,requestId:row.id,department:current.department};
 });
 if(outcome.department==='management'&&outcome.status==='approved')await sweepCommissions(outcome.requestId);
 return {id:outcome.id,status:outcome.status};
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
