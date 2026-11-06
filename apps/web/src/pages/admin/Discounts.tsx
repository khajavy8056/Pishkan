import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus, ReceiptText, TicketPercent, Trash2 } from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, Select, Switch, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDate, faDateTime, faNum, rial } from '../../lib/format';

type CodeForm = {
  code: string; title: string; type: 'percent' | 'fixed';
  value: string; maxDiscount: string; minAmount: string; usageLimit: string;
  perCustomerLimit: string; serviceId: string; categoryId: string;
  startsAt: string; expiresAt: string; isActive: boolean; audience: 'code' | 'all' | 'first_purchase' | 'assigned';
};

const EMPTY: CodeForm = {
  code: '', title: '', type: 'percent', value: '10', maxDiscount: '',
  minAmount: '', usageLimit: '', perCustomerLimit: '1', serviceId: '', categoryId: '',
  startsAt: '', expiresAt: '', isActive: true, audience: 'code',
};

function toDateInput(value?: string | null): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function AdminDiscountsPage({ variant = 'admin' }: { variant?: 'admin' | 'staff' } = {}) {
  const { notify } = useToast();
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CodeForm>(EMPTY);
  const [busy, setBusy] = useState('');
  const [usagesFor, setUsagesFor] = useState<any>(null);
  const [usages, setUsages] = useState<any[]>([]);
  const [assigning, setAssigning] = useState<any>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.list<{ data: any[] }>('/api/discount-codes', { pageSize: 100 });
      setCodes(res.data ?? []);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'دریافت کدها ناموفق بود.', 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    api.list<{ data: any[] }>('/api/admin/services', { pageSize: 300 }).then((r) => setServices(r.data ?? [])).catch(() => undefined);
    api.get<{ data: any[] }>('/api/public/categories').then((r) => setCategories(r.data ?? [])).catch(() => undefined);
  }, []);

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setModalOpen(true); };

  const openEdit = (code: any) => {
    setEditingId(code.id);
    setForm({
      code: code.code, title: code.title ?? '',
      type: code.type, value: String(code.value ?? ''),
      maxDiscount: code.maxDiscount ? String(code.maxDiscount) : '',
      minAmount: code.minAmount ? String(code.minAmount) : '',
      usageLimit: code.usageLimit ? String(code.usageLimit) : '',
      perCustomerLimit: String(code.perCustomerLimit ?? 1),
      serviceId: code.serviceId ?? '', categoryId: code.categoryId ?? '',
      startsAt: toDateInput(code.startsAt), expiresAt: toDateInput(code.expiresAt),
      isActive: Boolean(code.isActive), audience: code.audience ?? 'code',
    });
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const num = (value: string) => (value.trim() === '' ? null : Number(value.replace(/,/g, '')));
    const payload = {
      code: form.code.trim().toUpperCase(),
      title: form.title.trim(),
      type: form.type,
      value: Number(form.value || 0),
      maxDiscount: form.type === 'percent' ? num(form.maxDiscount) : null,
      minAmount: num(form.minAmount) ?? 0,
      usageLimit: num(form.usageLimit),
      perCustomerLimit: Math.max(1, Number(form.perCustomerLimit || 1)),
      serviceId: form.serviceId || null,
      categoryId: form.categoryId || null,
      startsAt: form.startsAt || null,
      expiresAt: form.expiresAt || null,
      isActive: form.isActive, audience: form.audience,
    };
    setBusy('save');
    try {
      if (editingId) await api.patch(`/api/discount-codes/${editingId}`, payload);
      else await api.post('/api/discount-codes', payload);
      setModalOpen(false);
      notify(editingId ? 'کد تخفیف ویرایش شد.' : 'کد تخفیف ساخته شد.', 'success');
      void load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ذخیره ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const remove = async (code: any) => {
    if (!window.confirm(`کد «${code.code}» حذف شود؟`)) return;
    setBusy(code.id);
    try {
      await api.delete(`/api/discount-codes/${code.id}`);
      notify('کد تخفیف حذف شد.', 'success');
      void load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'حذف ناموفق بود.', 'error');
    } finally { setBusy(''); }
  };

  const showUsages = async (code: any) => {
    setUsagesFor(code);
    setUsages([]);
    try {
      const res = await api.list<{ data: any[] }>(`/api/discount-codes/${code.id}/usages`, { pageSize: 100 });
      setUsages(res.data ?? []);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در دریافت مصرف‌ها', 'error');
    }
  };

  const searchCustomers = async () => {
    if (customerQuery.trim().length < 3) { notify('حداقل سه حرف نام یا شماره را وارد کنید.', 'error'); return; }
    try { const res = await api.list<{ data: any[] }>('/api/customers', { search: customerQuery.trim(), pageSize: 30 }); setCustomers(res.data ?? []); }
    catch (err) { notify(err instanceof ApiFailure ? err.message : 'جست‌وجوی مشتری ناموفق بود.', 'error'); }
  };
  const assign = async (customerId: string) => {
    setBusy(customerId);
    try { await api.post(`/api/discount-codes/${assigning.id}/assignments`, { customerId }); notify('تخفیف به مشتری اختصاص یافت.', 'success'); }
    catch (err) { notify(err instanceof ApiFailure ? err.message : 'تخصیص ناموفق بود.', 'error'); }
    finally { setBusy(''); }
  };

  const scopeLabel = (code: any) => code.serviceTitle ?? code.categoryTitle ?? 'همه خدمات';

  return (
    <AppShell variant={variant}>
      <PageHeader title="کدهای تخفیف" description="کدهای تخفیفی که مشتری در صفحهٔ ثبت درخواست وارد می‌کند؛ تخفیف روی فاکتور اعمال و در گزارش‌ها ثبت می‌شود."
        actions={<Button onClick={openCreate}><Plus className="size-4" /> کد جدید</Button>} />

      <Card>
        {loading ? <Loading rows={4} /> : codes.length === 0 ? (
          <EmptyState title="هنوز کد تخفیفی ساخته نشده است." description="با «کد جدید» اولین کد را بسازید؛ مثلاً WELCOME10 برای مشتریان تازه." icon={<TicketPercent className="size-6" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs text-navy-500">
                  <th className="py-2 pe-3 font-bold">کد</th>
                  <th className="py-2 pe-3 font-bold">عنوان</th>
                  <th className="py-2 pe-3 font-bold">میزان</th>
                  <th className="py-2 pe-3 font-bold">محدوده</th>
                  <th className="py-2 pe-3 font-bold">اعتبار</th>
                  <th className="py-2 pe-3 font-bold">مصرف</th>
                  <th className="py-2 pe-3 font-bold">وضعیت</th>
                  <th className="py-2 font-bold">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {codes.map((code) => (
                  <tr key={code.id} className="align-top">
                    <td className="py-3 pe-3"><span className="rounded-lg bg-surface-3 px-2 py-1 font-mono text-xs font-bold" dir="ltr">{code.code}</span></td>
                    <td className="py-3 pe-3">{code.title}<span className="block text-xs text-navy-500">{({code:'فقط با کد', all:'همه مشتریان', first_purchase:'خرید اول', assigned:'مشتریان انتخاب‌شده'} as Record<string,string>)[code.audience] ?? 'فقط با کد'}</span></td>
                    <td className="py-3 pe-3">
                      {code.type === 'percent' ? `${faNum(code.value)}٪` : rial(code.value)}
                      {code.type === 'percent' && code.maxDiscount ? <span className="block text-[11px] text-navy-400">سقف {rial(code.maxDiscount)}</span> : null}
                    </td>
                    <td className="py-3 pe-3">{scopeLabel(code)}</td>
                    <td className="py-3 pe-3 text-xs">
                      {code.startsAt ? `از ${faDate(code.startsAt)}` : ''}{code.expiresAt ? `${code.startsAt ? ' تا ' : 'تا '}${faDate(code.expiresAt)}` : (!code.startsAt ? 'بدون محدودیت' : '')}
                      {code.expired && <span className="block font-bold text-rose-600">منقضی شده</span>}
                    </td>
                    <td className="py-3 pe-3">{faNum(code.usedCount ?? 0)}{code.usageLimit ? ` از ${faNum(code.usageLimit)}` : ''}</td>
                    <td className="py-3 pe-3">{code.isActive ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</td>
                    <td className="py-3">
                      <div className="flex gap-1">
                        {code.audience === 'assigned' && <Button size="sm" variant="ghost" onClick={() => { setAssigning(code); setCustomerQuery(''); setCustomers([]); }}>تخصیص مشتری</Button>}
                        <Button size="sm" variant="ghost" aria-label="مصرف‌ها" onClick={() => void showUsages(code)}><ReceiptText className="size-4" /></Button>
                        <Button size="sm" variant="ghost" aria-label="ویرایش" onClick={() => openEdit(code)}><Pencil className="size-4" /></Button>
                        <Button size="sm" variant="ghost" aria-label="حذف" loading={busy === code.id} onClick={() => void remove(code)}><Trash2 className="size-4 text-rose-600" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'ویرایش کد تخفیف' : 'کد تخفیف جدید'} size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>انصراف</Button>
            <Button type="submit" form="discount-code-form" loading={busy === 'save'}>ذخیره</Button>
          </>
        )}>
        <form id="discount-code-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="کد (لاتین)" required>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} dir="ltr" className="text-left uppercase" placeholder="WELCOME10" maxLength={32} required />
          </Field>
          <Field label="عنوان نمایشی" required>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="تخفیف مشتریان تازه" required />
          </Field>
          <Field label="مخاطب کمپین" hint="خرید اول: بدون خرید پرداخت‌شده و بدون درخواست فعال با تخفیف خرید اول. مخاطب پس از مصرف قابل تغییر نیست.">
            <Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as CodeForm['audience'] })}
              options={[{ value: 'code', label: 'فقط با کد (نمایش داده نشود)' }, { value: 'all', label: 'همه مشتریان' }, { value: 'first_purchase', label: 'خرید اول' }, { value: 'assigned', label: 'مشتریان انتخاب‌شده' }]} />
          </Field>
          <Field label="نوع تخفیف">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })}
              options={[{ value: 'percent', label: 'درصدی' }, { value: 'fixed', label: 'مبلغ ثابت (ریال)' }]} />
          </Field>
          <Field label={form.type === 'percent' ? 'درصد تخفیف' : 'مبلغ تخفیف (ریال)'} required>
            <Input inputMode="numeric" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} dir="ltr" className="text-left" required />
          </Field>
          {form.type === 'percent' && (
            <Field label="سقف تخفیف (ریال)" hint="خالی یعنی بدون سقف.">
              <Input inputMode="numeric" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })} dir="ltr" className="text-left" />
            </Field>
          )}
          <Field label="حداقل مبلغ سفارش (ریال)">
            <Input inputMode="numeric" value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="ظرفیت کل مصرف" hint="خالی یعنی نامحدود.">
            <Input inputMode="numeric" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="دفعات مجاز برای هر مشتری">
            <Input inputMode="numeric" value={form.perCustomerLimit} onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="فقط برای خدمت">
            <Select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value, categoryId: e.target.value ? '' : form.categoryId })}
              options={[{ value: '', label: 'همه خدمات' }, ...services.map((s) => ({ value: s.id, label: s.title }))]} />
          </Field>
          <Field label="فقط برای دسته‌بندی">
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value, serviceId: e.target.value ? '' : form.serviceId })}
              options={[{ value: '', label: 'همه دسته‌ها' }, ...categories.map((c) => ({ value: c.id, label: c.title }))]} />
          </Field>
          <Field label="از تاریخ">
            <Input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="تا تاریخ">
            <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Switch checked={form.isActive} onChange={(checked) => setForm({ ...form, isActive: checked })} label="کد فعال باشد" />
        </form>
      </Modal>

      <Modal open={Boolean(assigning)} onClose={() => setAssigning(null)} title="تخصیص تخفیف به مشتری" size="lg">
        <p className="mb-3 text-xs text-navy-600">نام یا شماره را جست‌وجو و مشتری موردنظر را انتخاب کنید.</p>
        <div className="flex gap-2"><Input value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} placeholder="نام یا موبایل مشتری" /><Button onClick={() => void searchCustomers()}>جست‌وجو</Button></div>
        <ul className="divide-y divide-line">{customers.map(customer => <li key={customer.id} className="flex items-center gap-3 py-3 text-sm"><span>{customer.fullName} — {customer.mobile}</span><Button className="ms-auto" size="sm" loading={busy === customer.id} onClick={() => void assign(customer.id)}>تخصیص</Button></li>)}</ul>
      </Modal>
      <Modal open={Boolean(usagesFor)} onClose={() => setUsagesFor(null)} title={usagesFor ? `مصرف کد ${usagesFor.code}` : ''} size="lg">
        {usages.length === 0 ? (
          <p className="text-sm text-navy-500">این کد هنوز استفاده نشده است.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {usages.map((usage) => (
              <li key={usage.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="font-bold text-navy-900">{usage.customerName}</span>
                <span className="text-navy-500" dir="ltr">{usage.trackingCode}</span>
                <span className="ms-auto font-bold text-emerald-700">{rial(usage.amount)}</span>
                <span className="text-[11px] text-navy-400">{faDateTime(usage.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </AppShell>
  );
}
