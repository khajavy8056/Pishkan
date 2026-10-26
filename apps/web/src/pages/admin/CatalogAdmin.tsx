import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Search, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, AlertTriangle, Save, FolderPlus,
  ListChecks, FileText, ListOrdered, CircleDollarSign, Settings2, GripVertical, Copy,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Switch,
  Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faNum, rial } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import type { FormField, WorkflowStep } from '../../lib/site';

interface DocItem { title: string; required: boolean; note?: string }

/* ------------------------------ services list ----------------------------- */

export function AdminServices() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tab, setTab] = useState<'services' | 'categories'>('services');
  const [catModal, setCatModal] = useState<any>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/catalog/admin/services', { search: search || undefined, categoryId: category || undefined, pageSize: 100 }),
      api.list<any>('/api/catalog/admin/categories'),
    ]).then(([svc, cat]) => { setServices(svc.data); setCategories(cat.data); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [search, category]);

  const toggle = async (service: any, field: 'isPublished' | 'acceptingRequests') => {
    try {
      await api.patch(`/api/catalog/services/${service.id}`, { [field]: !service[field] });
      notify(field === 'isPublished'
        ? (service.isPublished ? 'خدمت از کاتالوگ عمومی پنهان شد.' : 'خدمت در کاتالوگ عمومی نمایش داده می‌شود.')
        : (service.acceptingRequests ? 'پذیرش درخواست متوقف شد.' : 'پذیرش درخواست فعال شد.'), 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const archive = async (service: any) => {
    if (!window.confirm(`خدمت «${service.title}» آرشیو شود؟ پرونده‌های موجود دست‌نخورده می‌مانند.`)) return;
    try {
      await api.delete(`/api/catalog/services/${service.id}`);
      notify('خدمت آرشیو شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const saveCategory = async () => {
    if (!catModal) return;
    try {
      if (catModal.id) await api.patch(`/api/catalog/categories/${catModal.id}`, catModal);
      else await api.post('/api/catalog/categories', catModal);
      notify('دسته ذخیره شد.', 'success');
      setCatModal(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="admin">
      <PageHeader
        title="خدمات و دسته‌ها"
        description="مدیریت کاتالوگ خدمات، فرم‌های پویا، مدارک، گردش کار و وضعیت پذیرش."
        actions={can('services.create') ? <Link to="/admin/services/new" className="btn-primary btn-sm"><Plus className="size-4" /> خدمت جدید</Link> : undefined}
      />

      <div className="mb-4 flex gap-1 rounded-xl bg-white p-1 ring-1 ring-navy-900/8 sm:w-fit">
        {[{ key: 'services', label: 'خدمات' }, { key: 'categories', label: 'دسته‌بندی‌ها' }].map((item) => (
          <button key={item.key} onClick={() => setTab(item.key as any)}
            className={clsx('rounded-lg px-4 py-1.5 text-sm transition', tab === item.key ? 'bg-brand-700 text-white' : 'text-navy-600 hover:bg-navy-50')}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'services' && (
        <>
          <div className="card mb-4 flex flex-col gap-2 p-3 sm:flex-row">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-navy-50 px-3">
              <Search className="size-4 text-navy-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجوی خدمت…" className="w-full bg-transparent py-2 text-sm outline-none" />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="دسته"
              options={[{ value: '', label: 'همه دسته‌ها' }, ...categories.map((c) => ({ value: c.id, label: c.title }))]} className="sm:w-56" />
          </div>

          {loading && <Loading />}
          {!loading && services.length === 0 && <EmptyState title="خدمتی یافت نشد" />}

          <div className="space-y-2">
            {services.map((service) => (
              <Card key={service.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/admin/services/${service.id}`} className="font-medium text-navy-900 hover:text-brand-700">{service.title}</Link>
                      {!service.isPublished && <Badge tone="default">پنهان از کاتالوگ</Badge>}
                      {service.isPublished && !service.acceptingRequests && <Badge tone="warning">پذیرش متوقف</Badge>}
                      {service.needsReview && <Badge tone="warning">نیازمند بازبینی</Badge>}
                      {service.isCustom && <Badge tone="info">اختصاصی</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-navy-500">
                      {service.categoryTitle ?? 'بدون دسته'} • {rial(service.finalFee)}
                      {service.discountPercent > 0 ? ` (${faNum(service.discountPercent)}٪ تخفیف)` : ''} • {faNum(service.estimatedDays)} روز
                      • {faNum(service.form.length)} فیلد فرم • {faNum(service.documents.length)} مدرک
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggle(service, 'isPublished')} title="نمایش در کاتالوگ">
                      {service.isPublished ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    </Button>
                    <Button size="sm" variant={service.acceptingRequests ? 'ghost' : 'primary'} onClick={() => toggle(service, 'acceptingRequests')}>
                      {service.acceptingRequests ? 'توقف پذیرش' : 'فعال‌سازی پذیرش'}
                    </Button>
                    <Link to={`/admin/services/${service.id}`} className="btn-ghost btn-sm"><Settings2 className="size-4" /> ویرایش</Link>
                    {can('services.delete') && (
                      <Button size="sm" variant="danger" onClick={() => archive(service)} aria-label="آرشیو"><Trash2 className="size-4" /></Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {tab === 'categories' && (
        <>
          <div className="mb-3 flex justify-end">
            <Button size="sm" onClick={() => setCatModal({ title: '', slug: '', description: '', icon: '', sortOrder: categories.length + 1, isActive: true })}>
              <FolderPlus className="size-4" /> دسته جدید
            </Button>
          </div>
          {loading && <Loading />}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <Card key={cat.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-navy-900">{cat.title}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">{cat.description}</p>
                    <p className="mt-1 text-[10px] text-navy-400">{faNum(cat.serviceCount ?? 0)} خدمت • شناسه {cat.slug}</p>
                  </div>
                  <Badge tone={cat.isActive ? 'success' : 'default'}>{cat.isActive ? 'فعال' : 'غیرفعال'}</Badge>
                </div>
                <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => setCatModal(cat)}>ویرایش دسته</Button>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal open={Boolean(catModal)} onClose={() => setCatModal(null)} title={catModal?.id ? 'ویرایش دسته' : 'دسته جدید'}
        footer={<><Button variant="ghost" onClick={() => setCatModal(null)}>انصراف</Button><Button onClick={saveCategory}>ذخیره</Button></>}>
        {catModal && (
          <div className="space-y-3">
            <Field label="عنوان" required><Input value={catModal.title} onChange={(e) => setCatModal({ ...catModal, title: e.target.value })} /></Field>
            <Field label="شناسه (slug)" hint="حروف لاتین، برای نشانی صفحه استفاده می‌شود."><Input value={catModal.slug} onChange={(e) => setCatModal({ ...catModal, slug: e.target.value })} dir="ltr" className="text-left" /></Field>
            <Field label="توضیح"><Textarea value={catModal.description ?? ''} onChange={(e) => setCatModal({ ...catModal, description: e.target.value })} /></Field>
            <Field label="ترتیب نمایش"><Input type="number" value={catModal.sortOrder ?? 0} onChange={(e) => setCatModal({ ...catModal, sortOrder: Number(e.target.value) })} /></Field>
            <Switch checked={Boolean(catModal.isActive)} onChange={(v) => setCatModal({ ...catModal, isActive: v })} label="دسته فعال است" />
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

/* ----------------------------- service editor ----------------------------- */

const FIELD_TYPES = [
  { value: 'text', label: 'متن' },
  { value: 'tel', label: 'تلفن/موبایل' },
  { value: 'number', label: 'عدد' },
  { value: 'national_id', label: 'کد ملی' },
  { value: 'postal_code', label: 'کد پستی' },
  { value: 'iban', label: 'شماره شبا' },
  { value: 'money', label: 'مبلغ' },
  { value: 'date', label: 'تاریخ' },
  { value: 'textarea', label: 'متن بلند' },
  { value: 'select', label: 'لیست انتخابی' },
  { value: 'radio', label: 'انتخاب تک‌گزینه‌ای' },
  { value: 'checkbox', label: 'تیک تأیید' },
  { value: 'file', label: 'فایل' },
];

const emptyService = {
  title: '', slug: '', categoryId: '', summary: '', description: '', icon: '', image: null as string | null,
  coverage:'nationwide',cityIds:[] as string[],urgentEnabled:false,urgentPercent:25,urgentDays:1,urgentCapacity:2,
  baseFee: 0, discountPercent: 0, estimatedDays: 3, paymentMethods: ['online', 'cash'] as string[],
  tags: [] as string[], contactNotice: '', isPublished: true, acceptingRequests: true, needsReview: true, sortOrder: 100,
  form: [] as FormField[], documents: [] as DocItem[], workflow: [] as WorkflowStep[],
};

export function AdminServiceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();
  const isNew = !id || id === 'new';
  const [service, setService] = useState<any>(emptyService);
  const [categories, setCategories] = useState<any[]>([]);
  const [cities,setCities]=useState<any[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'general' | 'form' | 'documents' | 'workflow' | 'pricing'>('general');

  useEffect(() => {
    api.list<any>('/api/catalog/admin/categories').then((res) => setCategories(res.data)).catch(() => undefined);
    api.get<{data:any[]}>('/api/public/cities').then(r=>setCities(r.data)).catch(()=>notify('دریافت شهرها ناموفق بود','error'));
    if (isNew) return;
    api.get<{ data: any }>(`/api/catalog/admin/services/${id}`)
      .then((res) => setService({ ...emptyService, ...res.data }))
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خدمت یافت نشد'))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (patch: Record<string, any>) => setService((prev: any) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = { ...service };
      delete payload.stats;
      delete payload.categoryTitle;
      delete payload.categorySlug;
      delete payload.createdAt;
      delete payload.updatedAt;
      delete payload.id;
      delete payload.finalFee;
      delete payload.isCustom;
      delete payload.ownerCustomerId;
      if (isNew) {
        const res = await api.post<{ data: any }>('/api/catalog/services', payload);
        notify('خدمت ایجاد شد.', 'success');
        navigate(`/admin/services/${res.data.id}`, { replace: true });
      } else {
        await api.patch(`/api/catalog/services/${id}`, payload);
        notify('تغییرات ذخیره شد.', 'success');
      }
    } catch (err) {
      const message = err instanceof ApiFailure ? err.message : 'خطا در ذخیره';
      setError(message);
      notify(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addField = () => {
    const index = service.form.length + 1;
    set({ form: [...service.form, { key: `field_${index}`, label: '', type: 'text', required: false, placeholder: '', help: '' } as FormField] });
  };
  const updateField = (index: number, patch: Partial<FormField>) =>
    set({ form: service.form.map((f: FormField, i: number) => (i === index ? { ...f, ...patch } : f)) });
  const moveField = (index: number, dir: -1 | 1) => {
    const next = [...service.form];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ form: next });
  };

  const addDoc = () => set({ documents: [...service.documents, { title: '', required: true }] });
  const updateDoc = (index: number, patch: Partial<DocItem>) =>
    set({ documents: service.documents.map((d: DocItem, i: number) => (i === index ? { ...d, ...patch } : d)) });

  const addStep = () => set({ workflow: [...service.workflow, { title: '', description: '' } as WorkflowStep] });
  const updateStep = (index: number, patch: Partial<WorkflowStep>) =>
    set({ workflow: service.workflow.map((s: WorkflowStep, i: number) => (i === index ? { ...s, ...patch } : s)) });

  const togglePayment = (method: string) => {
    const has = service.paymentMethods.includes(method);
    set({ paymentMethods: has ? service.paymentMethods.filter((m: string) => m !== method) : [...service.paymentMethods, method] });
  };

  if (loading) return <AppShell variant="admin"><Loading /></AppShell>;

  const tabs = [
    { key: 'general', label: 'اطلاعات کلی', icon: <Settings2 className="size-4" /> },
    { key: 'form', label: `فرم درخواست (${faNum(service.form.length)})`, icon: <ListChecks className="size-4" /> },
    { key: 'documents', label: `مدارک (${faNum(service.documents.length)})`, icon: <FileText className="size-4" /> },
    { key: 'workflow', label: `گردش کار (${faNum(service.workflow.length)})`, icon: <ListOrdered className="size-4" /> },
    { key: 'pricing', label: 'هزینه و پرداخت', icon: <CircleDollarSign className="size-4" /> },
  ] as const;

  return (
    <AppShell variant="admin">
      <PageHeader
        title={isNew ? 'خدمت جدید' : `ویرایش: ${service.title}`}
        description="فرم پویا، مدارک و گردش کار این خدمت در همه کلاینت‌ها (وب و اندروید) به‌صورت خودکار نمایش داده می‌شود."
        backTo="/admin/services"
        actions={<Button loading={saving} onClick={save}><Save className="size-4" /> ذخیره</Button>}
      />

      {error && <ErrorState message={error} />}

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-white p-1 ring-1 ring-navy-900/8">
        {tabs.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)}
            className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition',
              tab === item.key ? 'bg-brand-700 text-white' : 'text-navy-600 hover:bg-navy-50')}>
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tab === 'general' && (
            <Card>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="عنوان خدمت" required><Input value={service.title} onChange={(e) => set({ title: e.target.value })} /></Field>
                  <Field label="شناسه در نشانی (slug)" hint="حروف لاتین و خط تیره"><Input value={service.slug} onChange={(e) => set({ slug: e.target.value })} dir="ltr" className="text-left" placeholder="insurance-history" /></Field>
                </div>
                <Field label="دسته‌بندی">
                  <Select value={service.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })} placeholder="بدون دسته"
                    options={categories.map((c) => ({ value: c.id, label: c.title }))} />
                </Field>
                <Field label="خلاصه (در کارت خدمات)" required><Input value={service.summary} onChange={(e) => set({ summary: e.target.value })} maxLength={300} /></Field>
                <Field label="توضیحات کامل">
                  <Textarea value={service.description} onChange={(e) => set({ description: e.target.value })} className="min-h-32" />
                </Field>
                <Field label="هشدار تماس / توضیح تکمیلی" hint="در صفحه خدمت با رنگ هشدار نمایش داده می‌شود.">
                  <Input value={service.contactNotice ?? ''} onChange={(e) => set({ contactNotice: e.target.value })} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Switch checked={service.isPublished} onChange={(v) => set({ isPublished: v })} label="نمایش در کاتالوگ عمومی"
                    hint="در صورت خاموش بودن، خدمت در سایت و اپ دیده نمی‌شود." />
                  <Switch checked={service.acceptingRequests} onChange={(v) => set({ acceptingRequests: v })} label="پذیرش درخواست فعال"
                    hint="کارت خدمت دیده می‌شود ولی امکان ثبت درخواست وجود ندارد." />
                  <Switch checked={service.needsReview} onChange={(v) => set({ needsReview: v })} label="هزینه/شرایط نمونه است"
                    hint="در UI برچسب «نیازمند تأیید» نمایش داده می‌شود." />
                </div>
              </div>
            </Card>
          )}

          {tab === 'form' && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-navy-900">فیلدهای فرم درخواست</h2>
                  <p className="text-[11px] text-navy-500">این فیلدها به‌صورت پویا در صفحه خدمت و اپ اندروید رندر می‌شوند.</p>
                </div>
                <Button size="sm" variant="ghost" onClick={addField}><Plus className="size-4" /> افزودن فیلد</Button>
              </div>
              {service.form.length === 0 && <EmptyState title="فیلدی تعریف نشده" description="حداقل نام و شماره تماس را اضافه کنید." />}
              <div className="space-y-3">
                {service.form.map((field: FormField, index: number) => (
                  <div key={index} className="rounded-xl bg-navy-50/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[11px] text-navy-500"><GripVertical className="size-3.5" /> فیلد {faNum(index + 1)}</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => moveField(index, -1)} aria-label="بالا"><ArrowUp className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => moveField(index, 1)} aria-label="پایین"><ArrowDown className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => set({ form: service.form.filter((_: any, i: number) => i !== index) })} aria-label="حذف"><Trash2 className="size-3.5" /></Button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input value={field.key} onChange={(e) => updateField(index, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} placeholder="key" dir="ltr" className="text-left" />
                      <Input value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} placeholder="برچسب" />
                      <Select value={field.type} onChange={(e) => updateField(index, { type: e.target.value as any })} options={FIELD_TYPES} />
                    </div>
                    {(field.type === 'select' || field.type === 'radio') && (
                      <Input className="mt-2" value={(field.options ?? []).join(', ')}
                        onChange={(e) => updateField(index, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                        placeholder="گزینه‌ها با کاما جدا شوند: بله، خیر" />
                    )}
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input value={field.placeholder ?? ''} onChange={(e) => updateField(index, { placeholder: e.target.value })} placeholder="متن راهنمای داخل فیلد" />
                      <Input value={field.help ?? ''} onChange={(e) => updateField(index, { help: e.target.value })} placeholder="توضیح زیر فیلد" />
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-navy-700">
                      <input type="checkbox" checked={Boolean(field.required)} onChange={(e) => updateField(index, { required: e.target.checked })} className="size-3.5" />
                      تکمیل این فیلد الزامی است
                    </label>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'documents' && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-navy-900">مدارک مورد نیاز</h2>
                <Button size="sm" variant="ghost" onClick={addDoc}><Plus className="size-4" /> افزودن مدرک</Button>
              </div>
              {service.documents.length === 0 && <EmptyState title="مدرکی تعریف نشده" />}
              <div className="space-y-2">
                {service.documents.map((doc: DocItem, index: number) => (
                  <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl bg-navy-50/50 p-2">
                    <Input value={doc.title} onChange={(e) => updateDoc(index, { title: e.target.value })} placeholder="عنوان مدرک (مثلاً: تصویر کارت ملی)" className="flex-1" />
                    <label className="flex items-center gap-1 text-[11px] text-navy-700">
                      <input type="checkbox" checked={doc.required} onChange={(e) => updateDoc(index, { required: e.target.checked })} className="size-3.5" /> الزامی
                    </label>
                    <Button size="sm" variant="ghost" onClick={() => set({ documents: service.documents.filter((_: any, i: number) => i !== index) })} aria-label="حذف">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'workflow' && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-navy-900">مراحل رسیدگی</h2>
                  <p className="text-[11px] text-navy-500">ترتیب مراحل برای مشتری نمایش داده می‌شود و مبنای پیشرفت پرونده است.</p>
                </div>
                <Button size="sm" variant="ghost" onClick={addStep}><Plus className="size-4" /> افزودن مرحله</Button>
              </div>
              {service.workflow.length === 0 && <EmptyState title="مرحله‌ای تعریف نشده" />}
              <div className="space-y-2">
                {service.workflow.map((step: WorkflowStep, index: number) => (
                  <div key={index} className="rounded-xl bg-navy-50/50 p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-700 text-[11px] text-white">{faNum(index + 1)}</span>
                      <Input value={step.title} onChange={(e) => updateStep(index, { title: e.target.value })} placeholder="عنوان مرحله" />
                      <Button size="sm" variant="ghost" onClick={() => set({ workflow: service.workflow.filter((_: any, i: number) => i !== index) })} aria-label="حذف">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Input className="mt-2" value={step.description ?? ''} onChange={(e) => updateStep(index, { description: e.target.value })} placeholder="توضیح کوتاه مرحله" />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'pricing' && (
            <Card>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="هزینه پایه (ریال)" hint="هزینه نمونه است؛ آن را بر اساس تعرفه رسمی تأیید کنید.">
                    <Input type="number" value={service.baseFee} onChange={(e) => set({ baseFee: Number(e.target.value) })} />
                  </Field>
                  <Field label="درصد تخفیف"><Input type="number" value={service.discountPercent} onChange={(e) => set({ discountPercent: Number(e.target.value) })} /></Field>
                  <Field label="زمان تخمینی (روز)"><Input type="number" value={service.estimatedDays} onChange={(e) => set({ estimatedDays: Number(e.target.value) })} /></Field>
                </div>
                <div className="space-y-4 rounded-2xl border border-navy-100 p-4"><h3 className="text-sm font-bold">محدوده ارائه خدمت</h3><Select value={service.coverage} onChange={e=>set({coverage:e.target.value})} options={[{value:'nationwide',label:'سراسر کشور'},{value:'cities',label:'فقط شهرهای انتخابی'}]} />{service.coverage==='cities'&&<div className="max-h-48 space-y-2 overflow-auto">{cities.map(c=><label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={service.cityIds.includes(c.id)} onChange={e=>set({cityIds:e.target.checked?[...service.cityIds,c.id]:service.cityIds.filter((v:string)=>v!==c.id)})} />{c.province} · {c.name}</label>)}</div>}<Button variant="ghost" size="sm" onClick={async()=>{const province=prompt('نام استان');if(!province)return;const name=prompt('نام شهر');if(!name)return;try{await api.post('/api/catalog/cities',{province,name});setCities((await api.get<{data:any[]}>('/api/public/cities')).data);notify('شهر ثبت شد','success')}catch(e){notify(e instanceof Error?e.message:'خطا','error')}}}>افزودن شهر به مرجع</Button></div>
                <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={service.urgentEnabled} onChange={e=>set({urgentEnabled:e.target.checked})} />پذیرش درخواست فوری</label>{service.urgentEnabled&&<div className="grid gap-3 sm:grid-cols-3"><Field label="افزایش درصدی مبلغ پایه"><Input type="number" min={0} max={500} value={service.urgentPercent} onChange={e=>set({urgentPercent:Number(e.target.value)})} /></Field><Field label="زمان فوری (روز کاری)"><Input type="number" min={1} value={service.urgentDays} onChange={e=>set({urgentDays:Number(e.target.value)})} /></Field><Field label="ظرفیت همزمان فوری"><Input type="number" min={0} value={service.urgentCapacity} onChange={e=>set({urgentCapacity:Number(e.target.value)})} /></Field></div>}</div>
                <div className="rounded-xl bg-brand-50/60 p-3 text-xs text-brand-900">
                  هزینه نهایی برای مشتری: <b>{rial(Math.round(service.baseFee * (1 - (service.discountPercent || 0) / 100)))}</b>
                </div>
                <div>
                  <p className="label">روش‌های پرداخت مجاز</p>
                  <div className="flex flex-wrap gap-2">
                    {[['online', 'پرداخت آنلاین'], ['cash', 'نقدی در دفتر'], ['pos', 'کارت‌خوان'], ['transfer', 'کارت به کارت']].map(([value, label]) => (
                      <button key={value} type="button" onClick={() => togglePayment(value)}
                        className={clsx('rounded-xl px-3 py-2 text-xs ring-1 transition',
                          service.paymentMethods.includes(value) ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-navy-700 ring-navy-900/10 hover:bg-navy-50')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="برچسب‌ها" hint="با کاما جدا کنید؛ در جست‌وجو استفاده می‌شوند.">
                  <Input value={service.tags.join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                </Field>
                <Field label="ترتیب نمایش"><Input type="number" value={service.sortOrder} onChange={(e) => set({ sortOrder: Number(e.target.value) })} /></Field>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-sm font-bold text-navy-900">پیش‌نمایش کارت</h2>
            <div className="rounded-xl border border-navy-900/8 p-4">
              <Badge tone="info">{categories.find((c) => c.id === service.categoryId)?.title ?? 'بدون دسته'}</Badge>
              <p className="mt-2 font-semibold text-navy-900">{service.title || 'عنوان خدمت'}</p>
              <p className="mt-1 line-clamp-2 text-xs text-navy-500">{service.summary || 'خلاصه خدمت…'}</p>
              <div className="mt-3 flex items-center justify-between border-t border-navy-900/5 pt-2 text-xs">
                <span className="text-navy-500">{faNum(service.estimatedDays)} روز</span>
                <span className="font-semibold">{rial(Math.round(service.baseFee * (1 - (service.discountPercent || 0) / 100)))}</span>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 text-[11px] text-navy-500">
              <p>• کاتالوگ: {service.isPublished ? 'نمایش داده می‌شود' : 'پنهان است'}</p>
              <p>• پذیرش: {service.acceptingRequests ? 'فعال' : 'متوقف'}</p>
              <p>• مدارک الزامی: {faNum(service.documents.filter((d: DocItem) => d.required).length)}</p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy-900"><AlertTriangle className="size-4 text-amber-600" /> یادآوری</h2>
            <p className="text-[11px] leading-6 text-navy-600">
              هزینه‌ها و شرایط خدمات دولتی باید از منبع رسمی همان دستگاه تأیید شود. مقادیر نمونه را قبل از انتشار عمومی
              با تعرفه رسمی جایگزین کنید و گزینه «هزینه/شرایط نمونه است» را خاموش کنید.
            </p>
          </Card>

          {!isNew && (
            <Card>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy-900"><Copy className="size-4" /> نشانی عمومی</h2>
              <code dir="ltr" className="block break-all rounded-lg bg-navy-50 p-2 text-[11px] text-navy-700">/services/{service.slug}</code>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
