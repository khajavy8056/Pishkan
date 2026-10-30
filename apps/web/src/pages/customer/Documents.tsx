import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, FileText, Plus, RefreshCw, ShieldCheck, Trash2, UploadCloud, Wand2, XCircle,
} from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Button, Card, EmptyState, Field, Input, Loading, Modal, Select, StatusBadge, useToast,
} from '../../components/ui';
import { DocumentViewer, FileSummary, FileThumbnail, ProcessingBadge, bytes, type MediaFile } from '../../components/documents';
import { api, ApiFailure } from '../../lib/api';
import { faDate, faNum } from '../../lib/format';

interface CustomerDocument {
  id: string;
  docType: string;
  docTypeLabel: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected';
  issuedAt: string | null;
  expiresAt: string | null;
  validity: 'none' | 'valid' | 'expiring' | 'expired';
  reviewNote: string | null;
  createdAt: string;
  file: MediaFile;
}

interface DocumentType {
  code: string;
  label: string;
  validityDays: number;
  counts: { total: number; approved: number; pending: number; rejected: number };
}

const STATUS_TEXT: Record<string, string> = { pending: 'در انتظار بررسی', approved: 'تأییدشده', rejected: 'نیازمند اصلاح' };

export function CustomerDocuments() {
  const { notify } = useToast();
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<CustomerDocument | null>(null);
  const [reuse, setReuse] = useState<CustomerDocument | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [reuseRequestId, setReuseRequestId] = useState('');
  const [reuseConfirm, setReuseConfirm] = useState(false);
  const [form, setForm] = useState({ docType: 'national_card', issuedAt: '', expiresAt: '', title: '' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const load = (showLoading = true) => {
    if (showLoading) setLoading(true);
    api.get<{ data: CustomerDocument[]; meta?: { types?: DocumentType[] } }>('/api/documents/mine')
      .then((res) => { setDocuments(res.data); setTypes(res.meta?.types ?? []); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت مدارک', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const refreshTypes = async () => {
    const res = await api.get<{ data: CustomerDocument[]; meta?: { types?: DocumentType[] } }>('/api/documents/mine');
    setTypes(res.meta?.types ?? []);
  };

  const upload = async () => {
    if (!selectedFile) { notify('ابتدا فایل را انتخاب کنید.', 'error'); return; }
    setBusy(true);
    try {
      const uploaded = await api.upload<{ data: { id: string; processing: { status: string }; savingsPercent: number; notes?: string[] } }>(
        '/api/files/upload', selectedFile, { purpose: 'profile_document' },
      );
      const created = await api.post<{ data: CustomerDocument }>('/api/documents/mine', {
        fileId: uploaded.data.id,
        docType: form.docType,
        title: form.title || undefined,
        issuedAt: form.issuedAt || undefined,
        expiresAt: form.expiresAt || undefined,
      });
      notify(
        uploaded.data.processing.status === 'ready'
          ? `مدرک ثبت شد و تصویر بدون افت خوانایی بهینه شد (${faNum(uploaded.data.savingsPercent)}٪ کاهش حجم).`
          : 'مدرک ثبت شد. پردازش تصویر انجام نشد و نسخه اصلی حفظ شد.',
        'success',
      );
      if (uploaded.data.notes?.length) notify(uploaded.data.notes.join(' '), 'info');
      setUploadOpen(false);
      setSelectedFile(null);
      setForm({ docType: form.docType, issuedAt: '', expiresAt: '', title: '' });
      load();
      void created;
      await refreshTypes();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ثبت مدرک', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (document: CustomerDocument) => {
    if (!window.confirm(`مدرک «${document.docTypeLabel}» از پروفایل حذف شود؟`)) return;
    try {
      await api.delete(`/api/documents/mine/${document.id}`);
      notify('مدرک حذف شد.', 'success');
      load(false);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در حذف مدرک', 'error');
    }
  };

  const openReuse = async (document: CustomerDocument) => {
    setReuse(document);
    setReuseConfirm(false);
    setReuseRequestId('');
    try {
      const res = await api.list<any>('/api/requests', { group: 'open', pageSize: 50 });
      setRequests(res.data);
    } catch {
      setRequests([]);
    }
  };

  const submitReuse = async () => {
    if (!reuse) return;
    if (!reuseRequestId) { notify('پرونده مقصد را انتخاب کنید.', 'error'); return; }
    if (!reuseConfirm) { notify('تأیید استفاده دوباره از مدرک الزامی است.', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/api/documents/mine/${reuse.id}/reuse`, { requestId: reuseRequestId, confirm: true });
      notify('مدرک با تأیید شما به پرونده انتخابی پیوست شد.', 'success');
      setReuse(null);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در استفاده دوباره از مدرک', 'error');
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => ({
    count: documents.length,
    ready: documents.filter((document) => document.file.processing?.status === 'ready').length,
    saved: documents.reduce((sum, document) => {
      const original = document.file.originalSize ?? document.file.size;
      return sum + Math.max(0, original - document.file.size);
    }, 0),
  }), [documents]);

  return (
    <AppShell variant="customer">
      <PageHeader
        title="مدارک من"
        description="کارت ملی، شناسنامه و سایر مدارک را یک‌بار بارگذاری کنید؛ تصویر به‌طور خودکار اصلاح جهت، بهینه و به WebP تبدیل می‌شود و نسخه اصلی سالم نگه داشته می‌شود."
        actions={(
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => load()}><RefreshCw className="size-4" /> بازبینی</Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}><Plus className="size-4" /> افزودن مدرک</Button>
          </div>
        )}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <ShieldCheck className="size-8 text-emerald-600" />
          <div><p className="text-xs text-navy-500">مدارک ثبت‌شده</p><p className="text-lg font-bold text-navy-900">{faNum(totals.count)}</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <Wand2 className="size-8 text-brand-600" />
          <div><p className="text-xs text-navy-500">بهینه‌سازی خودکار</p><p className="text-lg font-bold text-navy-900">{faNum(totals.ready)} مدرک</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <FileText className="size-8 text-sky-600" />
          <div><p className="text-xs text-navy-500">حجم صرفه‌جویی‌شده</p><p className="text-lg font-bold text-navy-900">{bytes(totals.saved)}</p></div>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-navy-900"><Wand2 className="size-4 text-brand-700" /> پردازش خودکار تصاویر</h2>
        <ul className="grid gap-2 text-[11px] leading-6 text-navy-600 sm:grid-cols-2">
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-600" /> اصلاح خودکار جهت تصویر بر اساس EXIF</li>
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-600" /> تبدیل به WebP بدون کاهش رزولوشن</li>
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-600" /> نگهداری نسخه اصلی برای بازیابی و بازبینی</li>
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-600" /> حذف متادیتای غیرضروری از نسخه نمایشی</li>
        </ul>
      </Card>

      {loading && <Loading />}
      {!loading && documents.length === 0 && (
        <EmptyState
          title="هنوز مدرکی ثبت نشده است"
          description="یک تصویر کارت ملی یا شناسنامه بارگذاری کنید؛ نیازی به فشرده‌سازی یا ویرایش قبلی نیست."
          action={<Button onClick={() => setUploadOpen(true)}><UploadCloud className="size-4" /> بارگذاری مدرک</Button>}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {documents.map((document) => (
          <Card key={document.id} className="flex gap-3">
            <FileThumbnail file={document.file} onOpen={() => setViewer(document)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-navy-900">{document.docTypeLabel}</p>
                  <p className="text-[10px] text-navy-500">ثبت {faDate(document.createdAt)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={document.status} label={STATUS_TEXT[document.status]} />
                  <ProcessingBadge processing={document.file.processing} />
                </div>
              </div>
              <FileSummary file={document.file} />
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="text-navy-500">اعتبار:</span>
                {document.expiresAt ? (
                  <StatusBadge status={document.validity} label={
                    document.validity === 'expired' ? `منقضی (${faDate(document.expiresAt)})`
                      : document.validity === 'expiring' ? `نزدیک انقضا (${faDate(document.expiresAt)})`
                        : `تا ${faDate(document.expiresAt)}`
                  } />
                ) : <span className="text-navy-600">بدون تاریخ انقضا</span>}
              </p>
              {document.reviewNote && <p className="mt-1 text-[11px] text-rose-700">{document.reviewNote}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setViewer(document)}>مشاهده</Button>
                <Button size="sm" variant="ghost" onClick={() => openReuse(document)} disabled={document.validity === 'expired'}>
                  استفاده در پرونده
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(document)} aria-label="حذف مدرک">
                  <Trash2 className="size-3.5 text-rose-600" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {types.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-3 font-bold text-navy-900">وضعیت انواع مدارک</h2>
          <div className="flex flex-wrap gap-2">
            {types.map((type) => (
              <span key={type.code} className="rounded-xl bg-navy-50 px-3 py-2 text-[11px] text-navy-700">
                {type.label}
                {type.counts.total > 0
                  ? ` — ${faNum(type.counts.total)} مورد${type.counts.approved ? ` (${faNum(type.counts.approved)} تأییدشده)` : ''}`
                  : ' — ثبت نشده'}
              </span>
            ))}
          </div>
        </Card>
      )}

      <DocumentViewer
        file={viewer?.file ?? null}
        title={viewer?.docTypeLabel ?? 'مدرک'}
        open={Boolean(viewer)}
        onClose={() => setViewer(null)}
      />

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="افزودن مدرک به پروفایل"
        footer={(
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>انصراف</Button>
            <Button loading={busy} onClick={upload} disabled={!selectedFile}>بارگذاری و ثبت</Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <Field label="نوع مدرک" required>
            <Select
              value={form.docType}
              onChange={(event) => setForm({ ...form, docType: event.target.value })}
              options={types.map((type) => ({ value: type.code, label: type.label }))}
            />
          </Field>
          <Field label="فایل تصویر یا PDF" required hint="حجم و کیفیت را خودتان کاهش ندهید؛ سامانه به‌طور خودکار نسخه بهینه می‌سازد.">
            <Input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            {selectedFile && <p className="mt-1 text-[10px] text-navy-500">انتخاب‌شده: {selectedFile.name} — {bytes(selectedFile.size)}</p>}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تاریخ صدور (اختیاری)">
              <Input type="date" value={form.issuedAt} onChange={(event) => setForm({ ...form, issuedAt: event.target.value })} dir="ltr" />
            </Field>
            <Field label="تاریخ انقضا (اختیاری)" hint="اگر خالی باشد، اعتبار بر اساس نوع مدرک محاسبه می‌شود.">
              <Input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} dir="ltr" />
            </Field>
          </div>
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-3 text-[11px] leading-6 text-amber-900">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            نسخه اصلی مدرک برای بازیابی و بازبینی انسانی نگه داشته می‌شود و فقط افراد مجاز به آن دسترسی دارند.
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(reuse)}
        onClose={() => setReuse(null)}
        title="استفاده دوباره از مدرک"
        footer={(
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setReuse(null)}>انصراف</Button>
            <Button loading={busy} onClick={submitReuse} disabled={!reuseRequestId || !reuseConfirm}>پیوست به پرونده</Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-brand-50 p-3 text-[11px] leading-6 text-brand-900">
            مدرک «{reuse?.docTypeLabel}» با تأیید شما به پرونده انتخابی پیوست می‌شود. اگر اعتبار مدرک پایان یافته باشد، سامانه اجازه پیوست نمی‌دهد.
          </p>
          <Field label="پرونده مقصد" required>
            <Select
              value={reuseRequestId}
              onChange={(event) => setReuseRequestId(event.target.value)}
              options={[{ value: '', label: 'انتخاب پرونده در جریان' }, ...requests.map((request) => ({
                value: request.id,
                label: `${request.serviceTitle} — ${request.trackingCode} (${request.statusLabel})`,
              }))]}
            />
          </Field>
          {requests.length === 0 && (
            <p className="text-[11px] text-navy-500">پرونده در جریانی وجود ندارد. ابتدا از بخش خدمات، درخواست جدید ثبت کنید.</p>
          )}
          <label className="flex items-start gap-2 rounded-xl border border-navy-100 p-3 text-[11px] leading-6 text-navy-700">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={reuseConfirm}
              onChange={(event) => setReuseConfirm(event.target.checked)}
            />
            <span>
              تأیید می‌کنم این مدرک متعلق به من است و با استفاده دوباره آن در پرونده انتخاب‌شده موافقم.
              {reuse?.expiresAt ? ` اعتبار مدرک تا ${faDate(reuse.expiresAt)} است.` : ''}
            </span>
          </label>
          {reuse?.status === 'rejected' && (
            <p className="flex items-center gap-1 text-[11px] text-rose-700"><XCircle className="size-3.5" /> این مدرک رد شده است و قابل استفاده دوباره نیست.</p>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}
