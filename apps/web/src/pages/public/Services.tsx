import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Search, ArrowLeft, Clock, FileText, CheckCircle2, AlertTriangle, UploadCloud, Wallet,
  ListOrdered, ChevronLeft, ShieldCheck, Info,
} from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { useSite, type FormField, type Service } from '../../lib/site';
import { useAuth } from '../../lib/auth';
import { api, ApiFailure } from '../../lib/api';
import { faNum, rial, STATUS_LABELS } from '../../lib/format';
import { Button, EmptyState, ErrorState, Field, Input, Loading, Select, Textarea, useToast } from '../../components/ui';

/* ------------------------------- service list ----------------------------- */

export function ServicesPage() {
  const { site } = useSite();
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
          <h1 className="text-2xl font-bold text-navy-900">خدمات دفتر پیشخوان</h1>
          <p className="mt-1 text-sm text-navy-500">{site?.settings['services.catalog_notice'] ?? ''}</p>
        </div>

        <div className="card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-navy-50 px-3">
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
              !category ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-600 ring-navy-900/10 hover:bg-navy-50')}
          >
            همه دسته‌ها
          </button>
          {site?.categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => updateParam('category', cat.slug)}
              className={clsx('rounded-full px-3.5 py-1.5 text-xs ring-1 transition',
                category === cat.slug ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-600 ring-navy-900/10 hover:bg-navy-50')}
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
                <span className="badge bg-brand-50 text-brand-800">{service.categoryTitle ?? 'خدمت'}</span>
                {!service.acceptingRequests && <span className="badge bg-amber-50 text-amber-800">موقتاً غیرفعال</span>}
              </div>
              <h3 className="mt-3 font-semibold leading-6 text-navy-900">{service.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-6 text-navy-500">{service.summary}</p>
              <div className="mt-4 flex items-center justify-between border-t border-navy-900/5 pt-3 text-xs">
                <span className="flex items-center gap-1 text-navy-500"><Clock className="size-3.5" /> {faNum(service.estimatedDays)} روز کاری</span>
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

export function ServiceDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notify } = useToast();
  const [service, setService] = useState<(Service & { showPrices?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [priority,setPriority]=useState('normal');
  const [quote,setQuote]=useState<any>(null);
  const [quoteError,setQuoteError]=useState('');
  const [paymentMethod, setPaymentMethod] = useState('online');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ path: string; message: string }[]>([]);
  const [formError, setFormError] = useState('');

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
        setPaymentMethod(res.data.paymentMethods[0] ?? 'online');
      })
      .catch((err) => active && setError(err instanceof ApiFailure ? err.message : 'خدمت یافت نشد'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  useEffect(()=>{
    if(!service || user?.kind!=='customer') return;
    let active=true;setQuote(null);setQuoteError('');
    api.post<{data:any}>('/api/requests/quote',{serviceId:service.id,priority}).then(r=>{if(active)setQuote(r.data)}).catch(e=>{if(active)setQuoteError(e.message)});
    return ()=>{active=false};
  },[service?.id,priority,user?.id]);

  const missingRequired = useMemo(() => {
    if (!service) return 0;
    return service.form.filter((f) => f.required && (values[f.key] === '' || values[f.key] === undefined)).length;
  }, [service, values]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!service) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/services/${service.slug}`)}`);
      return;
    }
    if (user.kind !== 'customer') {
      notify('ثبت درخواست از این فرم برای مشتریان است. از پنل کارکنان درخواست را ثبت کنید.', 'info');
      return;
    }
    if(user.profileState?.complete === false){navigate('/app/profile');return;}
    setSubmitting(true);
    setFormError('');
    setFieldErrors([]);
    try {
      const res = await api.post<{ data: { id: string; trackingCode: string } }>('/api/requests', {
        serviceId: service.id,
        formData: values,
        paymentMethod,
        priority,
      });
      notify(`درخواست ثبت شد. کد پیگیری: ${res.data.trackingCode}`, 'success');
      navigate(`/app/requests/${res.data.id}`);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setFormError(err.message);
        if (Array.isArray(err.details)) setFieldErrors(err.details as any);
      } else {
        setFormError('خطا در ثبت درخواست');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <PublicLayout><div className="mx-auto max-w-5xl px-4 py-10"><Loading rows={4} /></div></PublicLayout>;
  }
  if (error || !service) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <ErrorState message={error || 'خدمت یافت نشد'} />
          <Link to="/services" className="btn-ghost mt-4">بازگشت به فهرست خدمات</Link>
        </div>
      </PublicLayout>
    );
  }

  const errorFor = (key: string) => fieldErrors.find((e) => e.path === key)?.message;

  return (
    <PublicLayout>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link to="/services" className="mb-4 inline-flex items-center gap-1 text-xs text-navy-500 hover:text-navy-900">
          <ArrowLeft className="size-3.5 rotate-180" /> همه خدمات
        </Link>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="card card-pad">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge bg-brand-50 text-brand-800">{service.categoryTitle ?? 'خدمت'}</span>
                {service.needsReview && (
                  <span className="badge bg-amber-50 text-amber-800">
                    <AlertTriangle className="size-3.5" /> هزینه و شرایط نمونه است
                  </span>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-bold text-navy-900">{service.title}</h1>
              <p className="mt-2 text-sm leading-8 text-navy-600">{service.description || service.summary}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-navy-50/70 p-4">
                  <p className="text-[11px] text-navy-500">هزینه تقریبی</p>
                  <p className="mt-1 font-bold text-navy-900">{rial(service.finalFee)}</p>
                  {service.discountPercent > 0 && <p className="text-[11px] text-emerald-700">{faNum(service.discountPercent)}٪ تخفیف</p>}
                </div>
                <div className="rounded-xl bg-navy-50/70 p-4">
                  <p className="text-[11px] text-navy-500">زمان تخمینی</p>
                  <p className="mt-1 font-bold text-navy-900">{faNum(service.estimatedDays)} روز کاری</p>
                </div>
                <div className="rounded-xl bg-navy-50/70 p-4">
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
            </div>

            {/* Workflow */}
            <div className="card card-pad mt-6">
              <h2 className="flex items-center gap-2 font-bold text-navy-900"><ListOrdered className="size-5 text-brand-700" /> مراحل رسیدگی</h2>
              <ol className="mt-4 space-y-3">
                {service.workflow.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">{faNum(index + 1)}</span>
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
              <h2 className="flex items-center gap-2 font-bold text-navy-900"><FileText className="size-5 text-brand-700" /> مدارک مورد نیاز</h2>
              <ul className="mt-3 space-y-2">
                {service.documents.map((doc) => (
                  <li key={doc.title} className="flex items-center justify-between gap-3 rounded-xl bg-navy-50/60 px-4 py-2.5">
                    <span className="text-sm text-navy-800">{doc.title}</span>
                    <span className={clsx('badge', doc.required ? 'bg-rose-50 text-rose-700' : 'bg-white text-navy-500 ring-1 ring-navy-900/8')}>
                      {doc.required ? 'الزامی' : 'اختیاری'}
                    </span>
                  </li>
                ))}
                {service.documents.length === 0 && <li className="text-sm text-navy-500">مدرک خاصی نیاز نیست.</li>}
              </ul>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-navy-500">
                <ShieldCheck className="size-3.5 text-emerald-600" /> مدارک فقط برای کارشناس پرونده شما قابل مشاهده است.
              </p>
            </div>
          </div>

          {/* Booking form */}
          <div className="lg:col-span-1">
            <form onSubmit={submit} className="card card-pad sticky top-24">
              <h2 className="font-bold text-navy-900">ثبت درخواست</h2>
              <p className="mt-1 text-xs leading-6 text-navy-500">فیلدهای ستاره‌دار الزامی هستند.</p>

              <div className="mt-4 space-y-4">
                {service.form.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.help} required={field.required} error={errorFor(field.key)}>
                    <DynamicField
                      field={field}
                      value={values[field.key]}
                      onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
                    />
                  </Field>
                ))}
              </div>

              {service.urgentEnabled && <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><input type="checkbox" checked={priority==='high'} onChange={e=>setPriority(e.target.checked?'high':'normal')} className="mt-1 size-4 accent-amber-600" /><span><b>انجام فوری</b><small className="mt-1 block leading-6">افزایش {faNum(service.urgentPercent ?? 0)}٪ مبلغ پایه · زمان {faNum(service.urgentDays ?? 1)} روز کاری · ظرفیت محدود</small></span></label>}
              {quote && <div aria-live="polite" className="mt-4 space-y-2 rounded-xl bg-navy-50 p-4 text-xs text-navy-600"><div className="flex justify-between"><span>هزینه پایه</span><span>{rial(quote.baseFee)}</span></div><div className="flex justify-between"><span>هزینه فوری</span><span>{rial(quote.urgentFee)}</span></div><div className="flex justify-between"><span>تخفیف / مالیات</span><span>{rial(quote.discount)} / {rial(quote.tax)}</span></div><div className="flex justify-between border-t border-navy-200 pt-3 text-sm font-bold text-navy-900"><span>جمع قابل پرداخت</span><span>{rial(quote.total)}</span></div>{priority==='high'&&!quote.urgentAvailable&&<p className="text-rose-700">ظرفیت فوری تکمیل است؛ حالت عادی را انتخاب کنید.</p>}</div>}
              {quoteError && <p role="alert" className="mt-4 text-sm text-rose-700">{quoteError} <Link className="underline" to="/app/profile">تکمیل پروفایل</Link></p>}
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
                          paymentMethod === method ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-navy-700 ring-navy-900/10 hover:bg-navy-50')}
                      >
                        {STATUS_LABELS[method] ?? method}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {formError && (
                <div className="mt-4 rounded-xl bg-rose-50 p-3 text-xs leading-6 text-rose-700 ring-1 ring-rose-200">{formError}</div>
              )}

              <div className="mt-5 flex items-center justify-between rounded-xl bg-navy-50/70 px-4 py-3">
                <span className="text-xs text-navy-600">مبلغ قابل پرداخت</span>
                <span className="font-bold text-navy-900">{rial(service.finalFee)}</span>
              </div>

              {!service.acceptingRequests ? (
                <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900 ring-1 ring-amber-200">
                  پذیرش این خدمت موقتاً متوقف شده است. برای اطلاع از زمان فعال‌سازی با دفتر تماس بگیرید.
                </div>
              ) : (
                <Button type="submit" loading={submitting} className="mt-4 w-full">
                  <CheckCircle2 className="size-4" />
                  {user ? 'ثبت نهایی درخواست' : 'ورود و ثبت درخواست'}
                </Button>
              )}

              {missingRequired > 0 && (
                <p className="mt-2 text-center text-[11px] text-navy-400">{faNum(missingRequired)} فیلد الزامی باقی مانده است.</p>
              )}

              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-navy-400">
                <Wallet className="mt-0.5 size-3.5 shrink-0" />
                پرداخت آنلاین فقط پس از تأیید درگاه معتبر ثبت می‌شود؛ پرداخت حضوری توسط کارشناس ثبت خواهد شد.
              </p>
            </form>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

export function DynamicField({ field, value, onChange }: { field: FormField; value: any; onChange: (value: any) => void }) {
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
                value === option ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-navy-700 ring-navy-900/10 hover:bg-navy-50')}
            >
              {option}
            </button>
          ))}
        </div>
      );
    case 'checkbox':
      return (
        <label className="flex items-start gap-2 rounded-xl bg-navy-50/60 p-3 text-xs text-navy-700">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 rounded border-navy-300" />
          <span>{field.label}</span>
        </label>
      );
    case 'file':
      return (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-navy-300 bg-navy-50/40 px-3 py-2.5 text-xs text-navy-500">
          <UploadCloud className="size-4" /> پس از ثبت درخواست، از صفحه پرونده فایل را بارگذاری کنید.
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
