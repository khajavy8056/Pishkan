import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Search, ArrowLeft, Clock, FileText, CheckCircle2, AlertTriangle, UploadCloud, Wallet,
  ListOrdered, ChevronLeft, ShieldCheck, Info, TicketPercent, UserRoundCheck, X,
  Landmark, LogIn, UserPlus,
} from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { CategoryIcon } from '../../components/visual';
import { AppShell } from '../../components/shell';
import { formatDuration, useSite, type FormField, type Service } from '../../lib/site';
import { useAuth, homeFor } from '../../lib/auth';
import { api, ApiFailure } from '../../lib/api';
import { faNum, rial, STATUS_LABELS } from '../../lib/format';
import { Button, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Textarea, useToast } from '../../components/ui';

/* ------------------------------- service list ----------------------------- */

export function ServicesPage() {
  const { site, setting } = useSite();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'order';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.list<Service>('/api/public/services', { q: query || undefined, category: category || undefined, sort, page, pageSize: 12 })
      .then((res) => {
        if (!active) return;
        setServices(res.data);
        setTotal(res.total);
      })
      .catch((err) => active && setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت خدمات'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query, category, sort, page]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  return (
    <PublicLayout>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-navy-900">خدمات {setting('site.short_name') || 'پیشخوان'}</h1>
          <p className="mt-1 text-sm text-navy-500">{site?.settings['services.catalog_notice'] ?? ''}</p>
        </div>

        <div className="card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-3 px-3">
            <Search className="size-4 text-navy-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی خدمت…"
              className="w-full bg-transparent py-2.5 text-sm outline-none"
              aria-label="جست‌وجو"
            />
          </div>
          <div className="flex gap-2">
            <Select
              aria-label="مرتب‌سازی"
              value={sort}
              onChange={(e) => updateParam('sort', e.target.value)}
              options={[
                { value: 'order', label: 'ترتیب پیش‌فرض' },
                { value: 'newest', label: 'جدیدترین' },
                { value: 'price_asc', label: 'ارزان‌ترین' },
                { value: 'price_desc', label: 'گران‌ترین' },
              ]}
              className="min-w-40"
            />
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => updateParam('category', '')}
            className={clsx('rounded-full px-3.5 py-1.5 text-xs ring-1 transition',
              !category ? 'bg-shell text-shell-fg ring-shell' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}
          >
            همه دسته‌ها
          </button>
          {site?.categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => updateParam('category', cat.slug)}
              className={clsx('rounded-full px-3.5 py-1.5 text-xs ring-1 transition',
                category === cat.slug ? 'bg-shell text-shell-fg ring-shell' : 'bg-surface text-navy-600 ring-line hover:bg-surface-3')}
            >
              {cat.title}
            </button>
          ))}
        </div>

        {error && <ErrorState message={error} />}
        {loading && <Loading rows={4} />}

        {!loading && !error && services.length === 0 && (
          <EmptyState
            title="خدمتی یافت نشد"
            description="عبارت دیگری را جست‌وجو کنید یا از دستیار هوشمند برای پیدا کردن خدمت مناسب کمک بگیرید."
            action={<Link to="/assistant" className="btn-soft btn-sm">پرسیدن از دستیار</Link>}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <Link key={service.id} to={`/services/${service.slug}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-2"><CategoryIcon name={service.icon} className="size-7" /><span className="badge bg-brand-50 text-accent">{service.categoryTitle ?? 'خدمت'}</span></span>
                {!service.acceptingRequests && <span className="badge bg-amber-50 text-amber-800">موقتاً غیرفعال</span>}
              </div>
              <h3 className="mt-3 font-semibold leading-6 text-navy-900">{service.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-6 text-navy-500">{service.summary}</p>
              <div className="mt-4 flex items-center justify-between border-t border-navy-900/5 pt-3 text-xs">
                <span className="flex items-center gap-1 text-navy-500"><Clock className="size-3.5" /> {formatDuration(service.estimatedMinutes, service.estimatedDays)}</span>
                <span className="font-semibold text-navy-900">{rial(service.finalFee)}</span>
              </div>
            </Link>
          ))}
        </div>

        {total > 12 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
            <span className="text-sm text-navy-500">صفحه {faNum(page)} — {faNum(total)} خدمت</span>
            <Button variant="ghost" size="sm" disabled={page * 12 >= total} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

/* ------------------------------ service detail ---------------------------- */

const emptyValue = (field: FormField) => (field.type === 'checkbox' ? false : '');
const isMissingRequiredValue = (field: FormField, value: unknown) => field.type === 'checkbox'
  ? value !== true && value !== 'true' && value !== 'on' && value !== 1
  : value === undefined || value === null || String(value).trim() === '';

function normalizeFieldErrors(details: unknown): { path: string; message: string }[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((detail: any) => {
    const path = typeof detail?.path === 'string' ? detail.path : typeof detail?.field === 'string' ? detail.field : '';
    return path && typeof detail?.message === 'string' ? [{ path, message: detail.message }] : [];
  });
}

export function ServiceDetailPage({ variant = 'public' }: { variant?: 'public' | 'app' }) {
  const inApp = variant === 'app';
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notify } = useToast();
  const [service, setService] = useState<(Service & { showPrices?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [documentUploads, setDocumentUploads] = useState<Record<string, { fileId: string; name: string }>>({});
  const [formFileNames, setFormFileNames] = useState<Record<string, string>>({});
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});
  const [priority,setPriority]=useState('normal');
  const [quote,setQuote]=useState<any>(null);
  const [quoteError,setQuoteError]=useState('');
  const [paymentMethod, setPaymentMethod] = useState('online');
  const [discountInput, setDiscountInput] = useState('');
  const [appliedCode, setAppliedCode] = useState('');
  const [codeMessage, setCodeMessage] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [autofill, setAutofill] = useState<{ values: Record<string, string>; entries: { key: string; label: string; value: string }[]; missing: { key: string; label: string }[] } | null>(null);
  const [autofillPicked, setAutofillPicked] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ path: string; message: string }[]>([]);
  const [formError, setFormError] = useState('');
  const submissionKeyRef = useRef<{ storageKey: string; fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get<{ data: Service }>(`/api/public/services/${slug}`)
      .then((res) => {
        if (!active) return;
        setService(res.data);
        const initial: Record<string, any> = {};
        for (const field of res.data.form) initial[field.key] = emptyValue(field);
        setValues(initial);
        setDocumentUploads({});
        setFormFileNames({});
        setUploadingFiles({});
        setPaymentMethod(res.data.paymentMethods[0] ?? 'online');
      })
      .catch((err) => active && setError(err instanceof ApiFailure ? err.message : 'خدمت یافت نشد'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  useEffect(()=>{
    if(!inApp || !service || user?.kind!=='customer') return;
    let active=true;setQuote(null);setQuoteError('');
    api.post<{data:any}>('/api/requests/quote',{serviceId:service.id,priority,discountCode:appliedCode||undefined})
      .then(r=>{if(active)setQuote(r.data)})
      .catch(e=>{ if(!active) return;
        // A code that stopped being valid un-applies itself loudly instead of
        // silently blocking checkout.
        if (appliedCode) { setAppliedCode(''); setCodeMessage(e.message); }
        else setQuoteError(e.message);
      });
    return ()=>{active=false};
  },[inApp,service?.id,priority,user?.id,appliedCode]);

  useEffect(() => {
    if (!inApp || user?.kind !== 'customer') return;
    let active = true;
    api.get<{ data: any }>('/api/auth/profile/autofill')
      .then((res) => { if (active) setAutofill(res.data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [inApp, user?.id]);

  // Map service form fields to profile values: exact key first, then a small
  // set of safe type heuristics (never other people's ids like spouse/child).
  const autofillMatches = useMemo(() => {
    if (!service || !autofill) return [] as { field: FormField; value: string; sourceLabel: string }[];
    const byKey = autofill.values;
    const entryLabel = new Map(autofill.entries.map((e) => [e.key, e.label]));
    const matches: { field: FormField; value: string; sourceLabel: string }[] = [];
    for (const field of service.form) {
      if (field.type === 'file' || field.type === 'checkbox') continue;
      let sourceKey: string | undefined;
      if (byKey[field.key]) sourceKey = field.key;
      else if (field.type === 'national_id' && field.key === 'national_id' && byKey.national_id) sourceKey = 'national_id';
      else if (field.type === 'iban' && byKey.iban) sourceKey = 'iban';
      else if (field.type === 'postal_code' && byKey.postal_code) sourceKey = 'postal_code';
      else if (field.type === 'tel' && (field.key === 'mobile' || field.key === 'phone') && (byKey[field.key] || byKey.mobile)) sourceKey = byKey[field.key] ? field.key : 'mobile';
      if (sourceKey) matches.push({ field, value: byKey[sourceKey], sourceLabel: entryLabel.get(sourceKey) ?? sourceKey });
    }
    return matches;
  }, [service, autofill]);

  const openAutofill = () => {
    const picked: Record<string, boolean> = {};
    for (const match of autofillMatches) picked[match.field.key] = true;
    setAutofillPicked(picked);
    setAutofillOpen(true);
  };

  const applyAutofill = () => {
    setValues((current) => {
      const next = { ...current };
      for (const match of autofillMatches) {
        if (autofillPicked[match.field.key]) next[match.field.key] = match.value;
      }
      return next;
    });
    setFieldErrors((current) => current.filter((e) => !autofillPicked[e.path]));
    setAutofillOpen(false);
    notify('اطلاعات پروفایل در فرم قرار گرفت؛ می‌توانید هر مورد را ویرایش کنید.', 'success');
  };

  const applyDiscountCode = async () => {
    if (!service) return;
    const code = discountInput.trim();
    if (!code) { setCodeMessage('کد تخفیف را وارد کنید.'); return; }
    setCodeBusy(true); setCodeMessage('');
    try {
      const res = await api.post<{ data: any }>('/api/discount-codes/preview', { code, serviceId: service.id, priority });
      setAppliedCode(res.data.code);
      setCodeMessage('');
      notify(`کد تخفیف «${res.data.title}» اعمال شد.`, 'success');
    } catch (err) {
      setCodeMessage(err instanceof ApiFailure ? err.message : 'کد تخفیف معتبر نیست.');
    } finally { setCodeBusy(false); }
  };

  const removeDiscountCode = () => {
    setAppliedCode('');
    setDiscountInput('');
    setCodeMessage('');
  };

  const documentRequirements = useMemo(() => (service?.documents ?? []).map((document, index) => ({
    ...document,
    key: document.key || `document_${index + 1}`,
  })), [service]);
  const missingRequired = useMemo(() => {
    if (!service) return 0;
    return service.form.filter((field) => field.required && isMissingRequiredValue(field, values[field.key])).length;
  }, [service, values]);
  const missingRequiredDocuments = useMemo(() => documentRequirements.filter((doc) => doc.required && !documentUploads[doc.key]).length,
    [documentRequirements, documentUploads]);

  const uploadFormFile = async (field: FormField, file: File) => {
    setUploadingFiles((current) => ({ ...current, [field.key]: true }));
    try {
      const uploaded = await api.upload<{ data: { id: string; name: string; processing: { status: string }; savingsPercent: number } }>(
        '/api/files/upload', file, { purpose: 'document' },
      );
      setValues((current) => ({ ...current, [field.key]: uploaded.data.id }));
      setFormFileNames((current) => ({ ...current, [field.key]: uploaded.data.name }));
      setFieldErrors((current) => current.filter((error) => error.path !== field.key));
      notify(`فایل «${field.label}» دریافت شد.`, 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری فایل ناموفق بود.', 'error');
    } finally {
      setUploadingFiles((current) => ({ ...current, [field.key]: false }));
    }
  };

  const uploadServiceDocument = async (requirement: Service['documents'][number], file: File) => {
    setUploadingFiles((current) => ({ ...current, [requirement.key]: true }));
    try {
      const uploaded = await api.upload<{ data: { id: string; name: string; processing: { status: string }; savingsPercent: number } }>(
        '/api/files/upload', file, { purpose: 'document', documentQuality: /عکس (پرسنلی|شخصی)/.test(requirement.title) ? 'false' : 'true' },
      );
      setDocumentUploads((current) => ({ ...current, [requirement.key]: { fileId: uploaded.data.id, name: uploaded.data.name } }));
      setFieldErrors((current) => current.filter((error) => error.path !== `documents.${requirement.key}`));
      notify(`مدرک «${requirement.title}» دریافت شد؛ تأیید نهایی با کارشناس است.`, 'info');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری مدرک ناموفق بود.', 'error');
    } finally {
      setUploadingFiles((current) => ({ ...current, [requirement.key]: false }));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!service) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/app/services/${service.slug}`)}`);
      return;
    }
    if (user.kind !== 'customer') {
      notify('ثبت درخواست از این فرم برای مشتریان است. از پنل کارکنان درخواست را ثبت کنید.', 'info');
      return;
    }
    if (user.profileState?.complete === false) {
      notify('برای ثبت درخواست، ابتدا اطلاعات الزامی پروفایل را تکمیل کنید.', 'info');
      navigate('/app/profile');
      return;
    }

    setFormError('');
    setFieldErrors([]);
    const incompleteFields = service.form.filter((field) => field.required && isMissingRequiredValue(field, values[field.key]));
    if (incompleteFields.length > 0) {
      setFieldErrors(incompleteFields.map((field) => ({
        path: field.key,
        message: field.type === 'checkbox' ? `«${field.label}» باید تأیید شود.` : `«${field.label}» الزامی است.`,
      })));
      setFormError('پیش از ثبت، فیلدهای الزامی مشخص‌شده را کامل کنید.');
      return;
    }
    if (missingRequiredDocuments > 0) {
      const missingDocuments = documentRequirements.filter((document) => document.required && !documentUploads[document.key]);
      setFieldErrors(missingDocuments.map((document) => ({ path: `documents.${document.key}`, message: `بارگذاری مدرک «${document.title}» الزامی است.` })));
      setFormError(`برای ادامه ${faNum(missingRequiredDocuments)} مدرک الزامی را بارگذاری کنید.`);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        serviceId: service.id,
        formData: values,
        paymentMethod,
        priority,
        discountCode: appliedCode || undefined,
        documentIds: documentRequirements.flatMap((document) => {
          const uploaded = documentUploads[document.key];
          return uploaded ? [{ fileId: uploaded.fileId, title: document.title, requirementKey: document.key }] : [];
        }),
      };
      const fingerprint = JSON.stringify(payload);
      const storageKey = `pishkan:request-submit:v1:${user.id}:${service.id}`;
      let savedKey: string | null = null;
      try { savedKey = window.sessionStorage.getItem(storageKey); } catch { /* private browsing may disable sessionStorage */ }
      const currentKey = submissionKeyRef.current;
      const reusable = currentKey?.storageKey === storageKey
        ? currentKey.fingerprint === fingerprint ? currentKey.key : undefined
        : savedKey ?? undefined;
      const idempotencyKey = reusable ?? (typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : Array.from(window.crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join(''));
      submissionKeyRef.current = { storageKey, fingerprint, key: idempotencyKey };
      // Persist only the random operation key, never personal form values or a fingerprint of them.
      try { window.sessionStorage.setItem(storageKey, idempotencyKey); } catch { /* in-memory retry fallback */ }

      const res = await api.post<{ data: { id: string; trackingCode: string } }>('/api/requests', payload, {
        'Idempotency-Key': idempotencyKey,
      });
      try {
        if (window.sessionStorage.getItem(storageKey) === idempotencyKey) window.sessionStorage.removeItem(storageKey);
      } catch { /* storage may be unavailable */ }
      submissionKeyRef.current = null;
      notify(`درخواست ثبت شد. کد پیگیری: ${res.data.trackingCode}`, 'success');
      navigate(`/app/requests/${res.data.id}`);
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.status === 409 && err.message.includes('این کلید ثبت قبلاً')) {
          try {
            if (window.sessionStorage.getItem(submissionKeyRef.current?.storageKey ?? '') === submissionKeyRef.current?.key) {
              window.sessionStorage.removeItem(submissionKeyRef.current?.storageKey ?? '');
            }
          } catch { /* storage may be unavailable */ }
          submissionKeyRef.current = null;
        }
        setFormError(err.message);
        setFieldErrors(normalizeFieldErrors(err.details));
      } else {
        setFormError('خطا در ثبت درخواست');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const wrap = (node: React.ReactNode) => (inApp
    ? <AppShell variant="customer">{node}</AppShell>
    : <PublicLayout>{node}</PublicLayout>);

  if (loading) {
    return wrap(<div className="mx-auto max-w-5xl px-4 py-10"><Loading rows={4} /></div>);
  }
  if (error || !service) {
    return wrap(
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState message={error || 'خدمت یافت نشد'} />
        <Link to={inApp ? '/app/services' : '/services'} className="btn-ghost mt-4">بازگشت به فهرست خدمات</Link>
      </div>,
    );
  }

  const errorFor = (key: string) => fieldErrors.find((e) => e.path === key)?.message;

  const page = (
    <>
      <div className={inApp ? undefined : 'mx-auto max-w-6xl px-4 py-8 sm:px-6'}>
        <Link to={inApp ? '/app/services' : '/services'} className="mb-4 inline-flex items-center gap-1 text-xs text-navy-500 hover:text-navy-900">
          <ArrowLeft className="size-3.5 rotate-180" /> همه خدمات
        </Link>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="card card-pad">
              {service.image && <img src={service.image} alt="" className="mb-4 h-44 w-full rounded-2xl object-cover sm:h-56" />}
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-2"><CategoryIcon name={service.icon} className="size-7" /><span className="badge bg-brand-50 text-accent">{service.categoryTitle ?? 'خدمت'}</span></span>
                {service.needsReview && (
                  <span className="badge bg-amber-50 text-amber-800">
                    <AlertTriangle className="size-3.5" /> هزینه و شرایط نمونه است
                  </span>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-bold text-navy-900">{service.title}</h1>
              <p className="mt-2 text-sm leading-8 text-navy-600">{service.description || service.summary}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-surface-3 p-4">
                  <p className="text-[11px] text-navy-500">هزینه تقریبی</p>
                  <p className="mt-1 font-bold text-navy-900">{rial(service.finalFee)}</p>
                  {service.discountPercent > 0 && <p className="text-[11px] text-emerald-700">{faNum(service.discountPercent)}٪ تخفیف</p>}
                </div>
                <div className="rounded-xl bg-surface-3 p-4">
                  <p className="text-[11px] text-navy-500">زمان تخمینی</p>
                  <p className="mt-1 font-bold text-navy-900">{formatDuration(service.estimatedMinutes, service.estimatedDays)}</p>
                </div>
                <div className="rounded-xl bg-surface-3 p-4">
                  <p className="text-[11px] text-navy-500">وضعیت پذیرش</p>
                  <p className={clsx('mt-1 font-bold', service.acceptingRequests ? 'text-emerald-700' : 'text-amber-700')}>
                    {service.acceptingRequests ? 'پذیرش درخواست فعال' : 'موقتاً غیرفعال'}
                  </p>
                </div>
              </div>

              {service.contactNotice && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-xs leading-6 text-amber-900 ring-1 ring-amber-200">
                  <Info className="mt-0.5 size-4 shrink-0" /> {service.contactNotice}
                </div>
              )}

              {service.hasExternalCosts && (
                <div className="mt-4 rounded-xl bg-sky-50 p-4 text-xs leading-6 text-sky-950 ring-1 ring-sky-200">
                  <p className="flex items-center gap-2 font-bold">
                    <Landmark className="size-4 shrink-0" />
                    هزینهٔ سازمانی جداگانه از حق‌الزحمه
                  </p>
                  <p className="mt-1">{service.externalCostsNote}</p>
                  {(service.externalCostItems?.length ?? 0) > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-sky-200/70 pt-2">
                      {service.externalCostItems!.map((item) => (
                        <li key={item.title} className="flex items-center justify-between gap-2">
                          <span>{item.title}</span>
                          <b>{rial(item.amount)}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Workflow */}
            <div className="card card-pad mt-6">
              <h2 className="flex items-center gap-2 font-bold text-navy-900"><ListOrdered className="size-5 text-accent" /> مراحل رسیدگی</h2>
              <ol className="mt-4 space-y-3">
                {service.workflow.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-accent">{faNum(index + 1)}</span>
                    <div>
                      <p className="text-sm font-medium text-navy-900">{step.title}</p>
                      {step.description && <p className="mt-0.5 text-xs leading-6 text-navy-500">{step.description}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Documents */}
            <div className="card card-pad mt-6">
              <h2 className="flex items-center gap-2 font-bold text-navy-900"><FileText className="size-5 text-accent" /> مدارک مورد نیاز</h2>
              <ul className="mt-3 space-y-2">
                {documentRequirements.map((doc) => (
                  <li key={doc.key} className="flex items-center justify-between gap-3 rounded-xl bg-surface-3 px-4 py-2.5">
                    <span className="text-sm text-navy-800">{doc.title}</span>
                    <span className={clsx('badge', doc.required ? 'bg-rose-50 text-rose-700' : 'bg-surface text-navy-500 ring-1 ring-line')}>
                      {doc.required ? 'الزامی' : 'اختیاری'}
                    </span>
                  </li>
                ))}
                {service.documents.length === 0 && <li className="text-sm text-navy-500">مدرک خاصی نیاز نیست.</li>}
              </ul>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-navy-500">
                <ShieldCheck className="size-3.5 text-emerald-700" /> مدارک فقط برای کارشناس پرونده شما قابل مشاهده است.
              </p>
            </div>
          </div>

          {/* Booking: the live request form exists only inside the customer
              panel (/app/services/:slug). The public page is a showcase —
              starting a request always goes through login first. */}
          <div className="lg:col-span-1">
            {!inApp ? (
              <div className="card card-pad sticky top-24">
                <h2 className="flex items-center gap-2.5 font-bold text-navy-900">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30">
                    <LogIn className="size-5" />
                  </span>
                  ثبت درخواست این خدمت
                </h2>

                <div className="mt-4 space-y-2 rounded-xl bg-surface-3 p-4 text-xs text-navy-600">
                  <div className="flex items-center justify-between"><span>هزینهٔ تقریبی خدمت</span><span className="font-bold text-navy-900">{rial(service.finalFee)}</span></div>
                  <div className="flex items-center justify-between"><span>زمان تخمینی انجام</span><span>{formatDuration(service.estimatedMinutes, service.estimatedDays)}</span></div>
                  <div className="flex items-center justify-between"><span>وضعیت پذیرش</span><span className={service.acceptingRequests ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>{service.acceptingRequests ? 'فعال' : 'موقتاً غیرفعال'}</span></div>
                </div>
                {service.hasExternalCosts && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-sky-900">
                    <Landmark className="mt-0.5 size-3.5 shrink-0" />
                    این مبلغ فقط حق‌الزحمهٔ انجام خدمت است؛ هزینهٔ سازمانی (اگر پیش بیاید) با فاکتور جداگانه در پرونده‌تان اعلام می‌شود.
                  </p>
                )}

                {!service.acceptingRequests ? (
                  <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900 ring-1 ring-amber-200">
                    پذیرش این خدمت موقتاً متوقف شده است. برای اطلاع از زمان فعال‌سازی با دفتر تماس بگیرید.
                  </div>
                ) : !user ? (
                  <>
                    <p className="mt-4 text-xs leading-6 text-navy-600">
                      ثبت درخواست فقط برای کاربران واردشده است. ابتدا وارد حساب کاربری شوید؛ پس از ورود،
                      مستقیم به فرم همین خدمت در پنل‌تان هدایت می‌شوید و می‌توانید مدارک را بارگذاری و درخواست را نهایی کنید.
                    </p>
                    <Link to={`/login?next=${encodeURIComponent(`/app/services/${service.slug}`)}`} className="btn-primary btn-lg mt-4 w-full">
                      <LogIn className="size-5" /> ورود و ثبت درخواست
                    </Link>
                    <Link to={`/register?next=${encodeURIComponent(`/app/services/${service.slug}`)}`} className="btn-ghost mt-2 w-full">
                      <UserPlus className="size-4" /> حساب ندارم — ثبت‌نام سریع
                    </Link>
                  </>
                ) : user.kind === 'customer' ? (
                  <>
                    <p className="mt-4 text-xs leading-6 text-navy-600">
                      فرم ثبت این خدمت در پنل مشتری شما آماده است و اطلاعات پروفایل‌تان آنجا به‌صورت خودکار در تکمیل فرم کمکتان می‌کند.
                    </p>
                    <Link to={`/app/services/${service.slug}`} className="btn-primary btn-lg mt-4 w-full">
                      <CheckCircle2 className="size-5" /> ثبت درخواست در پنل من
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="mt-4 text-xs leading-6 text-navy-600">
                      شما با حساب کارکنان وارد شده‌اید؛ ثبت درخواست برای مشتری (پذیرش حضوری) از پنل کارکنان انجام می‌شود.
                    </p>
                    <Link to={homeFor(user)} className="btn-primary mt-4 w-full">رفتن به پنل من</Link>
                  </>
                )}

                <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-5 text-navy-400">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-700" />
                  مدارک و اطلاعات شما فقط برای کارشناس مسئول پرونده قابل مشاهده است.
                </p>
              </div>
            ) : (
            <form onSubmit={submit} className="card card-pad sticky top-24">
              <h2 className="font-bold text-navy-900">ثبت درخواست</h2>
              <p className="mt-1 text-xs leading-6 text-navy-500">فیلدها و مدارک ستاره‌دار الزامی هستند.</p>

              {user?.kind === 'customer' && autofill && (
                <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
                  <p className="flex items-start gap-2 text-xs leading-6 text-brand-900">
                    <UserRoundCheck className="mt-1 size-4 shrink-0 text-brand-700" />
                    {autofillMatches.length > 0
                      ? 'بخشی از اطلاعات این فرم در پروفایل شما موجود است و لازم نیست دوباره بنویسید.'
                      : 'اطلاعات پروفایل شما برای تکمیل خودکار فرم‌ها استفاده می‌شود.'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={openAutofill} disabled={autofillMatches.length === 0}>
                      <UserRoundCheck className="size-4" /> استفاده از اطلاعات پروفایل من
                      {autofillMatches.length > 0 && ` (${faNum(autofillMatches.length)} مورد)`}
                    </Button>
                    {autofillMatches.length === 0 && <Link className="btn btn-ghost btn-sm" to="/app/profile">تکمیل پروفایل</Link>}
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-4">
                {service.form.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.help} required={field.required} error={errorFor(field.key)}>
                    <DynamicField
                      field={field}
                      value={values[field.key]}
                      fileName={formFileNames[field.key]}
                      uploading={Boolean(uploadingFiles[field.key])}
                      onFileUpload={(file) => void uploadFormFile(field, file)}
                      onChange={(value) => {
                        setValues((prev) => ({ ...prev, [field.key]: value }));
                        setFieldErrors((current) => current.filter((error) => error.path !== field.key));
                        if (!value) setFormFileNames((prev) => { const next = { ...prev }; delete next[field.key]; return next; });
                      }}
                    />
                  </Field>
                ))}
              </div>

              {documentRequirements.length > 0 && (
                <div className="mt-5 space-y-3 rounded-xl bg-surface-3/70 p-3">
                  <h3 className="text-sm font-bold text-navy-900">بارگذاری مدارک خدمت</h3>
                  {documentRequirements.map((document) => (
                    <Field key={document.key} label={document.title} required={document.required}
                      hint={document.note || (document.required ? 'برای ثبت درخواست لازم است.' : 'اختیاری')} error={errorFor(`documents.${document.key}`)}>
                      <Input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" disabled={Boolean(uploadingFiles[document.key])}
                        onChange={(event) => event.target.files?.[0] && void uploadServiceDocument(document, event.target.files[0])} />
                      {uploadingFiles[document.key] && <p className="mt-1 text-[11px] text-navy-500">در حال بارگذاری…</p>}
                      {documentUploads[document.key] && <p className="mt-1 text-[11px] text-navy-600">دریافت شد؛ در انتظار بررسی: {documentUploads[document.key].name}</p>}
                    </Field>
                  ))}
                </div>
              )}

              {service.urgentEnabled && <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><input type="checkbox" checked={priority==='high'} onChange={e=>setPriority(e.target.checked?'high':'normal')} className="mt-1 size-4 accent-amber-600" /><span><b>انجام فوری</b><small className="mt-1 block leading-6">افزایش {faNum(service.urgentPercent ?? 0)}٪ مبلغ پایه · زمان {formatDuration(service.urgentMinutes, service.urgentDays)} · ظرفیت محدود</small></span></label>}
              {quote && <div aria-live="polite" className="mt-4 space-y-2 rounded-xl bg-surface-3 p-4 text-xs text-navy-600"><div className="flex justify-between"><span>زمان تخمینی خدمت</span><span>{formatDuration(quote.estimatedMinutes, quote.estimatedDays)}</span></div><div className="flex justify-between"><span>هزینه پایه</span><span>{rial(quote.baseFee)}</span></div><div className="flex justify-between"><span>هزینه فوری</span><span>{rial(quote.urgentFee)}</span></div><div className="flex justify-between"><span>تخفیف خدمت</span><span>{rial(quote.discount ?? 0)}</span></div>{(quote.codeDiscount ?? 0) > 0 && <div className="flex justify-between font-bold text-emerald-700"><span>تخفیف کد {appliedCode}</span><span>{rial(quote.codeDiscount)}-</span></div>}<div className="flex justify-between"><span>مالیات بر ارزش افزوده</span><span>{rial(quote.tax)}</span></div><div className="flex justify-between border-t border-navy-200 pt-3 text-sm font-bold text-navy-900"><span>جمع قابل پرداخت</span><span>{rial(quote.total)}</span></div>{priority==='high'&&!quote.urgentAvailable&&<p className="text-rose-700">ظرفیت فوری تکمیل است؛ حالت عادی را انتخاب کنید.</p>}</div>}
              {quoteError && <p role="alert" className="mt-4 text-sm text-rose-700">{quoteError} <Link className="underline" to="/app/profile">تکمیل پروفایل</Link></p>}
              {user?.kind === 'customer' && (
                <div className="mt-4 rounded-xl border border-dashed border-navy-200 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-navy-800"><TicketPercent className="size-4 text-emerald-700" /> کد تخفیف دارید؟</p>
                  {appliedCode ? (
                    <div className="mt-2 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      <span>کد <b dir="ltr">{appliedCode}</b> اعمال شده است{(quote?.codeDiscount ?? 0) > 0 ? ` · ${rial(quote.codeDiscount)} تخفیف` : ''}</span>
                      <button type="button" onClick={removeDiscountCode} className="flex items-center gap-1 font-bold text-rose-600 hover:text-rose-700"><X className="size-3.5" /> حذف</button>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <Input value={discountInput} onChange={(e) => { setDiscountInput(e.target.value); setCodeMessage(''); }} placeholder="کد تخفیف" dir="ltr" className="text-left uppercase" maxLength={32} />
                      <Button type="button" variant="ghost" loading={codeBusy} onClick={() => void applyDiscountCode()} disabled={!discountInput.trim()}>اعمال</Button>
                    </div>
                  )}
                  {codeMessage && <p role="alert" className="mt-2 text-[11px] leading-5 text-rose-700">{codeMessage}</p>}
                </div>
              )}
              {service.paymentMethods.length > 1 && (
                <div className="mt-4">
                  <p className="label">روش پرداخت</p>
                  <div className="flex flex-wrap gap-2">
                    {service.paymentMethods.map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={clsx('rounded-xl px-3 py-2 text-xs ring-1 transition',
                          paymentMethod === method ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-700 ring-line hover:bg-surface-3')}
                      >
                        {STATUS_LABELS[method] ?? method}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {formError && (
                <div role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs leading-6 text-rose-700 ring-1 ring-rose-200">
                  <p>{formError}</p>
                  {fieldErrors.length > 0 && (
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {fieldErrors.map((fieldError, index) => <li key={`${fieldError.path}-${index}`}>{fieldError.message}</li>)}
                    </ul>
                  )}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between rounded-xl bg-surface-3 px-4 py-3">
                <span className="text-xs text-navy-600">مبلغ قابل پرداخت</span>
                <span className="font-bold text-navy-900">{rial(quote ? quote.total : service.finalFee)}</span>
              </div>
              {service.hasExternalCosts && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-sky-900">
                  <Landmark className="mt-0.5 size-3.5 shrink-0" />
                  این مبلغ فقط حق‌الزحمهٔ انجام خدمت است؛ هزینهٔ سازمانی (اگر پیش بیاید) بعداً با فاکتور جداگانه در پرونده‌تان اعلام و همان‌جا قابل پرداخت می‌شود.
                </p>
              )}

              {!service.acceptingRequests ? (
                <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900 ring-1 ring-amber-200">
                  پذیرش این خدمت موقتاً متوقف شده است. برای اطلاع از زمان فعال‌سازی با دفتر تماس بگیرید.
                </div>
              ) : (
                <Button type="submit" loading={submitting} disabled={missingRequiredDocuments > 0 || Object.values(uploadingFiles).some(Boolean)} className="mt-4 w-full">
                  <CheckCircle2 className="size-4" />
                  {user ? 'ثبت نهایی درخواست' : 'ورود و ثبت درخواست'}
                </Button>
              )}

              {missingRequired > 0 && (
                <p className="mt-2 text-center text-[11px] text-navy-400">{faNum(missingRequired)} فیلد الزامی باقی مانده است.</p>
              )}
              {missingRequiredDocuments > 0 && (
                <p className="mt-2 text-center text-[11px] text-rose-700">{faNum(missingRequiredDocuments)} مدرک الزامی باید بارگذاری شود.</p>
              )}

              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-navy-400">
                <Wallet className="mt-0.5 size-3.5 shrink-0" />
                پرداخت آنلاین فقط پس از تأیید درگاه معتبر ثبت می‌شود؛ پرداخت حضوری توسط کارشناس ثبت خواهد شد.
              </p>
            </form>
            )}
          </div>
        </div>
      </div>
      {inApp && (
      <Modal open={autofillOpen} onClose={() => setAutofillOpen(false)} title="استفاده از اطلاعات پروفایل من"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAutofillOpen(false)}>انصراف</Button>
            <Button onClick={applyAutofill} disabled={!Object.values(autofillPicked).some(Boolean)}>درج در فرم</Button>
          </>
        )}>
        <p className="text-sm leading-7 text-navy-600">
          موارد زیر از پروفایل شما خوانده می‌شوند. هر موردی را که نمی‌خواهید استفاده شود از حالت انتخاب خارج کنید؛ پس از درج هم می‌توانید مقادیر را ویرایش کنید.
        </p>
        <div className="mt-3 space-y-2">
          {autofillMatches.map((match) => (
            <label key={match.field.key} className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-3 px-3 py-2.5">
              <input type="checkbox" className="mt-1 size-4 accent-brand-700" checked={Boolean(autofillPicked[match.field.key])}
                onChange={(e) => setAutofillPicked((current) => ({ ...current, [match.field.key]: e.target.checked }))} />
              <span className="flex-1 text-sm">
                <span className="block font-bold text-navy-900">{match.field.label}</span>
                <span className="mt-0.5 block text-navy-600">{match.value}</span>
                <span className="block text-[11px] text-navy-400">از «{match.sourceLabel}» پروفایل</span>
              </span>
            </label>
          ))}
          {autofillMatches.length === 0 && <p className="text-sm text-navy-500">برای این فرم، داده‌ای در پروفایل شما پیدا نشد.</p>}
        </div>
        {autofill && autofill.missing.length > 0 && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900 ring-1 ring-amber-200">
            برای سریع‌تر شدن فرم‌های بعدی، این موارد را در پروفایل تکمیل کنید: {autofill.missing.map((m) => m.label).join('، ')}.{' '}
            <Link className="font-bold underline" to="/app/profile">تکمیل پروفایل</Link>
          </div>
        )}
      </Modal>
      )}
    </>
  );
  return wrap(page);
}

export function DynamicField({ field, value, onChange, fileName, uploading, onFileUpload }: {
  field: FormField; value: any; onChange: (value: any) => void; fileName?: string; uploading?: boolean; onFileUpload?: (file: File) => void;
}) {
  switch (field.type) {
    case 'textarea':
      return <Textarea value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <Select
          value={value ?? ''}
          placeholder="انتخاب کنید"
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'radio':
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={clsx('rounded-xl px-3 py-2 text-xs ring-1 transition',
                value === option ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-navy-700 ring-line hover:bg-surface-3')}
            >
              {option}
            </button>
          ))}
        </div>
      );
    case 'checkbox':
      return (
        <label className="flex items-start gap-2 rounded-xl bg-surface-3 p-3 text-xs text-navy-700">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 rounded border-navy-300" />
          <span>{field.label}</span>
        </label>
      );
    case 'file':
      return (
        <div className="space-y-1.5">
          <Input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" disabled={uploading}
            onChange={(event) => event.target.files?.[0] && onFileUpload?.(event.target.files[0])} />
          {uploading && <p className="text-[11px] text-navy-500">در حال بارگذاری…</p>}
          {value && <p className="flex items-center gap-1 text-[11px] text-emerald-700"><UploadCloud className="size-3.5" /> {fileName || 'فایل بارگذاری شد.'}</p>}
        </div>
      );
    case 'money':
    case 'number':
      return <Input type="number" inputMode="numeric" value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <Input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    default:
      return (
        <Input
          type={field.type === 'tel' ? 'tel' : 'text'}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          dir={field.type === 'iban' || field.type === 'national_id' ? 'ltr' : undefined}
          className={field.type === 'iban' || field.type === 'national_id' ? 'text-left' : undefined}
        />
      );
  }
}
