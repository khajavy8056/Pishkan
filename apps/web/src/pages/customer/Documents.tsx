import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, FileText, Plus, RefreshCw, ShieldCheck, Trash2, UploadCloud, XCircle,
} from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Button, Card, EmptyState, Field, Input, Loading, Modal, Select, StatusBadge, useToast,
} from '../../components/ui';
import { DocumentViewer, FileSummary, FileThumbnail, bytes, type MediaFile } from '../../components/documents';
import { api, ApiFailure } from '../../lib/api';
import { faDate, faNum } from '../../lib/format';
import { availableRequestDocumentRequirements, requestDocumentRequirements } from '../../lib/request-documents';

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
  replacesDocumentId?: string | null;
  reviewHistory?: { decision: string; note: string | null; reviewerName: string; createdAt: string }[];
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
  const [replacing, setReplacing] = useState<CustomerDocument | null>(null);
  const [reuse, setReuse] = useState<CustomerDocument | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [reuseRequestId, setReuseRequestId] = useState('');
  const [reuseRequest, setReuseRequest] = useState<any>(null);
  const [reuseRequestLoading, setReuseRequestLoading] = useState(false);
  const [reuseRequirementKey, setReuseRequirementKey] = useState('');
  const reuseRequestLoadId = useRef('');
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

  const openUpload = (replacement: CustomerDocument | null = null) => {
    setReplacing(replacement);
    setSelectedFile(null);
    setForm({ docType: replacement?.docType ?? 'national_card', issuedAt: '', expiresAt: '', title: replacement?.title ?? '' });
    setUploadOpen(true);
  };

  const upload = async () => {
    if (!selectedFile) { notify('ابتدا فایل را انتخاب کنید.', 'error'); return; }
    setBusy(true);
    try {
      const uploaded = await api.upload<{ data: { id: string; processing: { status: string }; savingsPercent: number; notes?: string[] } }>(
        '/api/files/upload', selectedFile, { purpose: 'profile_document', documentQuality: form.docType === 'personal_photo' ? 'false' : 'true' },
      );
      const created = await api.post<{ data: CustomerDocument }>('/api/documents/mine', {
        fileId: uploaded.data.id,
        docType: form.docType,
        title: form.title || undefined,
        issuedAt: form.issuedAt || undefined,
        expiresAt: form.expiresAt || undefined,
        replacesDocumentId: replacing?.id,
      });
      notify('مدرک با موفقیت ثبت شد.', 'success');
      setUploadOpen(false);
      setReplacing(null);
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
    setReuseRequest(null);
    setReuseRequirementKey('');
    setReuseRequestLoading(false);
    reuseRequestLoadId.current = '';
    try {
      const res = await api.list<any>('/api/requests', { group: 'open', pageSize: 50 });
      setRequests(res.data);
    } catch {
      setRequests([]);
    }
  };

  const selectReuseRequest = async (requestId: string) => {
    reuseRequestLoadId.current = requestId;
    setReuseRequestId(requestId);
    setReuseRequest(null);
    setReuseRequirementKey('');
    if (!requestId) return;
    setReuseRequestLoading(true);
    try {
      const result = await api.get<{ data: any }>(`/api/requests/${requestId}`);
      if (reuseRequestLoadId.current !== requestId) return;
      setReuseRequest(result.data);
      setReuseRequirementKey(availableRequestDocumentRequirements(result.data).find(item => item.documentType && item.documentType === reuse?.docType)?.key ?? '');
    } catch (err) {
      if (reuseRequestLoadId.current === requestId) notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت الزامات پرونده', 'error');
    } finally {
      if (reuseRequestLoadId.current === requestId) setReuseRequestLoading(false);
    }
  };

  const submitReuse = async () => {
    if (!reuse) return;
    if (!reuseRequestId || !reuseRequest) { notify('پرونده مقصد را انتخاب کنید.', 'error'); return; }
    if (!availableRequestDocumentRequirements(reuseRequest).some((item) => item.key === reuseRequirementKey && item.documentType && item.documentType === reuse.docType)) {
      notify('نیازمندی‌ای که برای این مدرک انتخاب شده دیگر قابل پیوست نیست.', 'error'); return;
    }
    if (!reuseConfirm) { notify('تأیید استفاده دوباره از مدرک الزامی است.', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/api/documents/mine/${reuse.id}/reuse`, {
        requestId: reuseRequestId,
        confirm: true,
        requirementKey: reuseRequirementKey || undefined,
      });
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
    approved: documents.filter((document) => document.status === 'approved').length,
    pending: documents.filter((document) => document.status === 'pending').length,
  }), [documents]);
  const reuseRequirements = requestDocumentRequirements(reuseRequest);
  const availableReuseRequirements = availableRequestDocumentRequirements(reuseRequest).filter(item => item.documentType && item.documentType === reuse?.docType);

  return (
    <AppShell variant="customer">
      <PageHeader
        title="مدارک من"
        description="کارت ملی، شناسنامه و سایر مدارک را یک‌بار خوانا و بدون برش بارگذاری کنید تا در پرونده‌ها قابل استفاده باشند."
        actions={(
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => load()}><RefreshCw className="size-4" /> بازبینی</Button>
            <Button size="sm" onClick={() => openUpload()}><Plus className="size-4" /> افزودن مدرک</Button>
          </div>
        )}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <ShieldCheck className="size-8 text-emerald-700" />
          <div><p className="text-xs text-navy-500">مدارک ثبت‌شده</p><p className="text-lg font-bold text-navy-900">{faNum(totals.count)}</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <CheckCircle2 className="size-8 text-accent" />
          <div><p className="text-xs text-navy-500">مدارک تأییدشده</p><p className="text-lg font-bold text-navy-900">{faNum(totals.approved)} مدرک</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <FileText className="size-8 text-sky-700" />
          <div><p className="text-xs text-navy-500">در انتظار بررسی</p><p className="text-lg font-bold text-navy-900">{faNum(totals.pending)} مدرک</p></div>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-navy-900"><ShieldCheck className="size-4 text-accent" /> نکته‌های بارگذاری مدرک</h2>
        <ul className="grid gap-2 text-[11px] leading-6 text-navy-600 sm:grid-cols-2">
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-700" /> عکس را با نور کافی و بدون بازتاب بگیرید تا همهٔ متن خوانا باشد.</li>
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-700" /> هر چهار گوشهٔ مدرک باید داخل کادر دیده شود.</li>
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-700" /> مدارک تأییدشده در درخواست‌های بعدی بدون بارگذاری دوباره قابل استفاده‌اند.</li>
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-700" /> فایل‌ها فقط برای کارشناس پروندهٔ شما قابل مشاهده‌اند.</li>
        </ul>
      </Card>

      {loading && <Loading />}
      {!loading && documents.length === 0 && (
        <EmptyState
          title="هنوز مدرکی ثبت نشده است"
          description="یک تصویر خوانا از کارت ملی یا شناسنامه بارگذاری کنید."
          action={<Button onClick={() => openUpload()}><UploadCloud className="size-4" /> بارگذاری مدرک</Button>}
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
              {document.reviewNote && <p className="mt-1 text-[11px] text-rose-700">دلیل بررسی: {document.reviewNote}</p>}
              {document.replacesDocumentId && <p className="mt-1 text-[10px] text-navy-500">این نسخه جایگزین مدرک ردشده است.</p>}
              {document.reviewHistory && document.reviewHistory.length > 0 && (
                <details className="mt-1 text-[10px] text-navy-500">
                  <summary className="cursor-pointer">تاریخچه بررسی ({faNum(document.reviewHistory.length)})</summary>
                  <ul className="mt-1 space-y-1">
                    {document.reviewHistory.map((review, index) => (
                      <li key={`${review.createdAt}-${index}`}>{review.decision === 'approved' ? 'تأیید' : 'رد'} توسط {review.reviewerName} — {faDate(review.createdAt)}{review.note ? `: ${review.note}` : ''}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setViewer(document)}>مشاهده</Button>
                {document.status === 'rejected' && <Button size="sm" variant="primary" onClick={() => openUpload(document)}>بارگذاری نسخه جایگزین</Button>}
                <Button size="sm" variant="ghost" onClick={() => openReuse(document)} disabled={document.validity === 'expired' || document.status !== 'approved'}>
                  استفاده در پرونده
                </Button>
                {document.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => remove(document)} aria-label="حذف مدرک در انتظار بررسی">
                  <Trash2 className="size-3.5 text-rose-700" />
                </Button>}
              </div>
              {document.status !== 'pending' && <p className="mt-1 text-[10px] text-navy-500">مدرک بررسی‌شده برای حفظ دلیل و سابقه حذف نمی‌شود.</p>}
            </div>
          </Card>
        ))}
      </div>

      {types.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-3 font-bold text-navy-900">وضعیت انواع مدارک</h2>
          <div className="flex flex-wrap gap-2">
            {types.map((type) => (
              <span key={type.code} className="rounded-xl bg-surface-3 px-3 py-2 text-[11px] text-navy-700">
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
        onClose={() => { setUploadOpen(false); setReplacing(null); setSelectedFile(null); }}
        title={replacing ? 'بارگذاری نسخه جایگزین' : 'افزودن مدرک به پروفایل'}
        footer={(
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>انصراف</Button>
            <Button loading={busy} onClick={upload} disabled={!selectedFile}>بارگذاری و ثبت</Button>
          </div>
        )}
      >
        <div className="space-y-4">
          {replacing && <p className="rounded-xl bg-amber-50 p-3 text-[11px] leading-6 text-amber-900">این فایل به‌عنوان نسخهٔ جایگزین «{replacing.docTypeLabel}» ثبت می‌شود. مدرک ردشده و سابقهٔ آن برای پیگیری باقی می‌ماند.</p>}
          <Field label="نوع مدرک" required>
            <Select
              value={form.docType}
              disabled={Boolean(replacing)}
              onChange={(event) => setForm({ ...form, docType: event.target.value })}
              options={types.map((type) => ({ value: type.code, label: type.label }))}
            />
          </Field>
          <Field label="فایل تصویر یا PDF" required hint="تصویر را همان‌طور که گرفته‌اید بارگذاری کنید؛ نیازی به ویرایش یا کم‌کردن کیفیت آن نیست.">
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
            <Button loading={busy} onClick={submitReuse}
              disabled={!reuseRequestId || !reuseRequest || reuseRequestLoading || !reuseConfirm || reuse?.status !== 'approved' || !availableReuseRequirements.some((item) => item.key === reuseRequirementKey)}>
              پیوست به پرونده
            </Button>
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
              onChange={(event) => { void selectReuseRequest(event.target.value); }}
              options={[{ value: '', label: 'انتخاب پرونده در جریان' }, ...requests.map((request) => ({
                value: request.id,
                label: `${request.serviceTitle} — ${request.trackingCode} (${request.statusLabel})`,
              }))]}
            />
          </Field>
          {reuseRequestLoading && <p className="text-[11px] text-navy-500">در حال دریافت مدارک موردنیاز پرونده…</p>}
          {reuseRequirements.length > 0 && (
            <Field label="مدرک موردنیاز پرونده" required>
              <Select
                value={reuseRequirementKey}
                onChange={(event) => setReuseRequirementKey(event.target.value)}
                options={[
                  { value: '', label: 'انتخاب مدرک موردنیاز' },
                  ...availableReuseRequirements.map((item) => ({ value: item.key, label: item.title })),
                ]}
              />
              {availableReuseRequirements.length === 0 && <p className="mt-1 text-[10px] text-navy-500">نیازمندی قابل پیوست جدیدی وجود ندارد.</p>}
            </Field>
          )}
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
