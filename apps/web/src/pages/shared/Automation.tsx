import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck,Send,UploadCloud,CheckCircle2,CornerDownLeft } from 'lucide-react';
import { AppShell,PageHeader } from '../../components/shell';
import { Button,Card,EmptyState,ErrorState,Field,Input,Loading,Select,Textarea,useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { DocumentViewer, FileSummary, FileThumbnail } from '../../components/documents';
import { useAuth } from '../../lib/auth';
import { faDateTime,faNum } from '../../lib/format';
const departmentName=(v:string)=>v==='management'?'مدیریت':'حسابداری';
const stateName=(v:string)=>v==='pending'?'در انتظار بررسی':v==='approved'?'تأیید شده':'برگشت برای اصلاح';
const tone=(v:string)=>v==='pending'?'bg-amber-50 text-amber-800':v==='approved'?'bg-emerald-50 text-emerald-800':'bg-rose-50 text-rose-800';
function useDecision(){const {user,can}=useAuth();return (department:string)=>['super_admin','manager','accountant'].includes(user?.roleCode??'')&&can(department==='management'?'requests.approve':'payments.approve')}
export function AutomationInbox({variant='staff'}:{variant?:'staff'|'admin'}){
 const [rows,setRows]=useState<any[]|null>(null);const [error,setError]=useState('');const [filter,setFilter]=useState('pending');const [note,setNote]=useState<Record<string,string>>({});const [busy,setBusy]=useState('');const {notify}=useToast();const canDecide=useDecision();
 const load=()=>{setError('');api.get<{data:any[]}>('/api/automation/inbox').then(r=>setRows(r.data)).catch(e=>setError(e.message))};useEffect(load,[]);
 const decide=async(row:any,decision:string)=>{if(!(note[row.id]??'').trim()){notify('توضیح تصمیم را وارد کنید.','error');return;}setBusy(row.id);try{await api.post(`/api/automation/${row.id}/decision`,{decision,note:note[row.id]});notify('تصمیم ثبت و به مسئول پرونده اطلاع داده شد.','success');load()}catch(e){notify(e instanceof Error?e.message:'خطا','error')}finally{setBusy('')}};
 return <AppShell variant={variant}><PageHeader title="کارتابل و ارجاعات" description="بررسی مستندات تحویل، تأیید مدیریت و پیگیری ارجاع مالی؛ تمام تصمیم‌ها با نام کاربر و زمان ثبت می‌شوند." actions={<Button variant="ghost" onClick={load}>تازه‌سازی</Button>} /><div className="mb-5 grid gap-3 sm:grid-cols-3">{['pending','approved','returned'].map(s=><button key={s} onClick={()=>setFilter(s)} className={`card flex items-center justify-between p-4 text-sm ${filter===s?'ring-2 ring-brand-500':''}`}><span>{stateName(s)}</span><b className={`badge ${tone(s)}`}>{faNum(rows?.filter(r=>r.status===s).length??0)}</b></button>)}</div>{error&&<ErrorState message={error} onRetry={load} />}{!rows&&!error&&<Loading />}{rows?.filter(r=>r.status===filter).length===0&&<EmptyState title="ارجاعی در این بخش وجود ندارد" />}<div className="grid gap-4 xl:grid-cols-2">{rows?.filter(r=>r.status===filter).map(r=><Card key={r.id}><div className="flex items-start justify-between gap-3"><div><p className="mb-2 text-xs text-navy-500">{r.tracking_code} · از {r.sender_name}</p><Link to={`/${variant}/requests/${r.request_id}`} className="font-bold text-accent">{r.service_title}</Link></div><span className={`badge ${tone(r.status)}`}>{departmentName(r.department)}</span></div><p className="my-4 whitespace-pre-wrap rounded-xl bg-surface-3 p-4 text-sm leading-7">{r.reason}</p><p className="text-[11px] text-navy-500">{faDateTime(r.created_at)}</p>{r.decision_note&&<p className="mt-3 border-t border-navy-100 pt-3 text-sm leading-7">پاسخ: {r.decision_note}</p>}{r.status==='pending'&&canDecide(r.department)&&<div className="mt-4 space-y-3"><Textarea aria-label="توضیح تصمیم" placeholder="نتیجه بررسی یا علت برگشت…" value={note[r.id]??''} onChange={e=>setNote({...note,[r.id]:e.target.value})} /><p className="hint">{r.department==='accounting'?'تأیید مالی صرفاً نتیجه بررسی است؛ ثبت پرداخت باید جداگانه در حسابداری انجام شود.':'با تأیید، فایل‌های نتیجه در انتظار بررسی برای مشتری قابل دریافت خواهند شد.'}</p><div className="flex gap-2"><Button loading={busy===r.id} onClick={()=>decide(r,'approved')}><CheckCircle2 className="size-4" />تأیید بررسی</Button><Button variant="ghost" disabled={!!busy} onClick={()=>decide(r,'returned')}><CornerDownLeft className="size-4" />برگشت برای اصلاح</Button></div></div>}</Card>)}</div></AppShell>;
}
export function CaseAutomation({ request, onChange }: { request: any; onChange: () => void }) {
  const { can } = useAuth();
  const { notify } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [department, setDepartment] = useState('management');
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [files, setFiles] = useState<{ fileId: string; title: string; file?: any; replacesDocumentId?: string }[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<{ data: any[] }>(`/api/requests/${request.id}/handoffs`)
      .then((response) => setRows(response.data))
      .catch((cause) => setError(cause.message));
  };
  useEffect(load, [request.id, request.updatedAt, request.status]);

  const documents = Array.isArray(request.documents) ? request.documents : [];
  const replacedDocumentIds = new Set(documents.map((document: any) => document.replacesDocumentId).filter(Boolean));
  const replacementCandidates = documents.filter((document: any) =>
    document.kind === 'staff' && document.status === 'rejected' && !replacedDocumentIds.has(document.id));
  const missingReplacements = replacementCandidates.filter((document: any) =>
    !files.some((file) => file.replacesDocumentId === document.id));

  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      notify('عملیات با موفقیت ثبت شد.', 'success');
      setReason(''); setSummary(''); setFiles([]);
      load(); onChange();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'خطا', 'error');
    } finally {
      setBusy(false);
    }
  };

  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status);
  const replacementOptions = (currentFileId: string, selectedId?: string) => {
    const usedByOtherFile = new Set(files.filter((file) => file.fileId !== currentFileId)
      .map((file) => file.replacesDocumentId).filter(Boolean));
    return [
      { value: '', label: 'این فایل جایگزین نتیجهٔ قبلی نیست' },
      ...replacementCandidates
        .filter((document: any) => !usedByOtherFile.has(document.id) || document.id === selectedId)
        .map((document: any) => ({ value: document.id, label: `جایگزین «${document.title}»` })),
    ];
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><ClipboardCheck className="size-5 text-accent" />تحویل نتیجه و گردش اداری</h2>
      <p className="mb-5 text-xs leading-6 text-navy-500">فایل نتیجه تا تأیید مدیریت برای مشتری منتشر نمی‌شود. ارجاع مالی پرداخت یا تسویه خودکار ایجاد نمی‌کند.</p>
      {error && <p className="text-sm text-rose-700">{error}</p>}

      {can('requests.edit') && !closed && (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <form className="space-y-3 rounded-xl border border-navy-100 p-4" onSubmit={(event) => {
            event.preventDefault();
            void perform(() => api.post(`/api/requests/${request.id}/handoffs`, { department, reason }));
          }}>
            <h3 className="text-sm font-bold">ارجاع به واحد مربوطه</h3>
            <Field label="واحد مقصد"><Select value={department} onChange={(event) => setDepartment(event.target.value)} options={[
              { value: 'management', label: 'مدیریت / سرپرست' }, { value: 'accounting', label: 'حسابداری' },
            ]} /></Field>
            <Field label="موضوع و علت ارجاع" required><Textarea required minLength={5} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
            <Button type="submit" loading={busy}><Send className="size-4" />ثبت ارجاع</Button>
          </form>

          {['assigned', 'in_progress', 'waiting_documents', 'waiting_customer'].includes(request.status) && (
            <form className="space-y-3 rounded-xl border border-brand-100 bg-brand-50/30 p-4" onSubmit={(event) => {
              event.preventDefault();
              void perform(() => api.post(`/api/requests/${request.id}/deliver`, {
                files: files.map(({ fileId, title, replacesDocumentId }) => ({ fileId, title, replacesDocumentId })), summary,
              }));
            }}>
              <h3 className="text-sm font-bold">تحویل کار برای تأیید</h3>
              <Field label="فایل‌های نتیجه" hint="PDF یا تصویر؛ حداکثر ۱۰ فایل. فایل‌ها ابتدا خصوصی بارگذاری می‌شوند." required>
                <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple disabled={busy} onChange={async (event) => {
                  const selected = Array.from(event.target.files ?? []);
                  if (files.length + selected.length > 10) { notify('حداکثر ۱۰ فایل مجاز است.', 'error'); return; }
                  setBusy(true);
                  const uploaded: { fileId: string; title: string; file?: any; replacesDocumentId?: string }[] = [];
                  let savedTotal = 0;
                  try {
                    for (const file of selected) {
                      const response = await api.upload<{ data: any }>('/api/files/upload', file, { purpose: 'delivery' });
                      const reservedIds = new Set([...files, ...uploaded].map((item) => item.replacesDocumentId).filter(Boolean));
                      const exact = replacementCandidates.filter((document: any) =>
                        document.title === response.data.name && !reservedIds.has(document.id));
                      let replacesDocumentId = exact.length === 1 ? exact[0].id : undefined;
                      const remaining = replacementCandidates.filter((document: any) => !reservedIds.has(document.id));
                      if (!replacesDocumentId && remaining.length === 1 && selected.length === 1) replacesDocumentId = remaining[0].id;
                      uploaded.push({ fileId: response.data.id, title: response.data.name, file: response.data, replacesDocumentId });
                      savedTotal += response.data.savingsPercent ?? 0;
                    }
                    setFiles((old) => [...old, ...uploaded]);
                    if (uploaded.length) {
                      const failed = uploaded.some((file) => file.file?.processing?.status === 'failed');
                      notify(failed
                        ? 'فایل‌ها خصوصی ذخیره شدند؛ بهینه‌سازی برخی فایل‌ها انجام نشد ولی نسخه اصلی سالم است.'
                        : `${faNum(uploaded.length)} فایل خصوصی ذخیره شد؛ میانگین کاهش حجم ${faNum(Math.round(savedTotal / uploaded.length))}٪.`, 'success');
                    }
                  } catch (cause) {
                    setFiles((old) => [...old, ...uploaded]);
                    notify(cause instanceof Error ? cause.message : 'خطای بارگذاری', 'error');
                  } finally {
                    event.target.value = '';
                    setBusy(false);
                  }
                }} />
              </Field>

              {replacementCandidates.length > 0 && (
                <p className="hint">برای هر نتیجهٔ ردشده، فایل جایگزین را انتخاب کنید تا سابقهٔ رد و نسخهٔ جدید به هم پیوند بخورند.</p>
              )}
              <div className="space-y-2">
                {files.map((file) => (
                  <div key={file.fileId} className="rounded-lg border border-navy-100 bg-surface p-2">
                    <div className="flex items-start gap-3">
                      <FileThumbnail file={file.file} onOpen={() => file.file && setPreview(file.file)} />
                      <div className="min-w-0 flex-1">{file.file ? <FileSummary file={file.file} /> : <p className="truncate text-xs">{file.title}</p>}</div>
                      <button type="button" onClick={() => setFiles((current) => current.filter((item) => item.fileId !== file.fileId))}
                        className="shrink-0 text-xs text-rose-700">حذف</button>
                    </div>
                    {replacementCandidates.length > 0 && (
                      <Field label="پیوند جایگزینی" className="mt-2">
                        <Select value={file.replacesDocumentId ?? ''}
                          onChange={(event) => setFiles((current) => current.map((item) => item.fileId === file.fileId
                            ? { ...item, replacesDocumentId: event.target.value || undefined } : item))}
                          options={replacementOptions(file.fileId, file.replacesDocumentId)} />
                      </Field>
                    )}
                  </div>
                ))}
              </div>
              {missingReplacements.length > 0 && (
                <p role="status" className="text-xs text-amber-800">برای {faNum(missingReplacements.length)} نتیجهٔ ردشده هنوز فایل جایگزین انتخاب نشده است.</p>
              )}
              <Field label="گزارش انجام کار" required><Textarea required minLength={5} maxLength={2000} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
              <Button type="submit" loading={busy} disabled={!files.length || missingReplacements.length > 0}>
                <UploadCloud className="size-4" />ارسال برای تأیید مدیریت
              </Button>
            </form>
          )}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-navy-100 p-4">
            <div className="flex justify-between gap-3 text-xs"><b>{departmentName(row.department)}</b><span className={`badge ${tone(row.status)}`}>{stateName(row.status)}</span></div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{row.reason}</p>
            <p className="mt-2 text-[11px] text-navy-500">{row.sender_name} · {faDateTime(row.created_at)}</p>
            {row.decision_note && <p className="mt-2 border-t border-navy-100 pt-2 text-xs leading-6">{row.reviewer_name}: {row.decision_note}</p>}
          </div>
        ))}
      </div>
      <DocumentViewer file={preview} title={preview?.name ?? 'پیش‌نمایش فایل تحویل'} open={Boolean(preview)} onClose={() => setPreview(null)} />
    </Card>
  );
}
