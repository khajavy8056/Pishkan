import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, UserPlus, ShieldCheck, Trash2, KeyRound, RefreshCw, Save, Users, BadgeCheck, Info,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, Select, StatCard, StatusBadge,
  Switch, Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum, rial } from '../../lib/format';

/* -------------------------------- customers ------------------------------- */

export function AdminCustomers() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const { notify } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({ fullName: '', mobile: '', nationalId: '', email: '', password: '', city: '', province: '', address: '' });

  const load = () => {
    setLoading(true);
    api.list<any>('/api/customers', { search: search || undefined, status: status || undefined, pageSize: 50 })
      .then((res) => setItems(res.data))
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [search, status]);

  const openDetail = async (customer: any) => {
    const res = await api.get<{ data: any }>(`/api/customers/${customer.id}`);
    setSelected(res.data);
  };

  const create = async () => {
    try {
      await api.post('/api/customers', form);
      notify('مشتری ایجاد شد.', 'success');
      setCreating(false);
      setForm({ fullName: '', mobile: '', nationalId: '', email: '', password: '', city: '', province: '', address: '' });
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const save = async () => {
    if (!editing) return;
    try {
      await api.patch(`/api/customers/${editing.id}`, {
        fullName: editing.fullName, email: editing.email, nationalId: editing.nationalId,
        status: editing.status, address: editing.profile?.address, city: editing.profile?.city,
      });
      notify('تغییرات ذخیره شد.', 'success');
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const resetPassword = async (customer: any) => {
    if (!window.confirm(`لینک/رمز موقت برای ${customer.fullName} ایجاد شود؟`)) return;
    try {
      const res = await api.post<{ data: any }>(`/api/customers/${customer.id}/reset-password`, {});
      notify(res.data.temporaryPassword ? `رمز موقت: ${res.data.temporaryPassword}` : 'درخواست بازیابی ثبت شد.', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const remove = async (customer: any) => {
    if (!window.confirm(`حساب ${customer.fullName} غیرفعال شود؟ این عملیات داده‌ها را حذف نمی‌کند.`)) return;
    try {
      await api.delete(`/api/customers/${customer.id}`);
      notify('حساب مشتری غیرفعال شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  return (
    <AppShell variant="admin">
      <PageHeader title="مشتریان" description="مدیریت حساب مشتریان، مشاهده پرونده‌ها و وضعیت مالی."
        actions={can('customers.create') ? <Button size="sm" onClick={() => setCreating(true)}><UserPlus className="size-4" /> مشتری جدید</Button> : undefined} />

      <div className="card mb-4 flex flex-col gap-2 p-3 sm:flex-row">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-navy-50 px-3">
          <Search className="size-4 text-navy-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، موبایل یا کد ملی…" className="w-full bg-transparent py-2 text-sm outline-none" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="وضعیت" className="sm:w-44"
          options={[{ value: '', label: 'همه وضعیت‌ها' }, { value: 'active', label: 'فعال' }, { value: 'pending', label: 'در انتظار تأیید' }, { value: 'suspended', label: 'مسدود' }]} />
      </div>

      {loading && <Loading />}
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>نام</th><th>موبایل</th><th>شهر</th><th>پرونده</th><th>بدهی</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {items.map((customer) => (
                <tr key={customer.id}>
                  <td className="font-medium text-navy-900">{customer.fullName}</td>
                  <td dir="ltr" className="text-left text-xs">{customer.mobile}</td>
                  <td className="text-xs text-navy-500">{customer.city ?? '—'}</td>
                  <td>{faNum(customer.requestCount)}</td>
                  <td className={customer.outstanding > 0 ? 'text-rose-600' : 'text-navy-400'}>{rial(customer.outstanding)}</td>
                  <td><StatusBadge status={customer.status} /></td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(customer)}>پرونده</Button>
                      {can('customers.edit') && <Button size="sm" variant="ghost" onClick={() => setEditing({ ...customer, profile: customer.profile ?? {} })}>ویرایش</Button>}
                      {can('customers.edit') && <Button size="sm" variant="ghost" onClick={() => resetPassword(customer)} aria-label="بازیابی رمز"><KeyRound className="size-3.5" /></Button>}
                      {can('customers.delete') && <Button size="sm" variant="ghost" onClick={() => remove(customer)} aria-label="غیرفعال‌سازی"><Trash2 className="size-3.5" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && <EmptyState title="مشتری یافت نشد" />}
      </Card>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.fullName ?? ''} size="lg">
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-navy-50/70 p-3"><p className="text-[10px] text-navy-500">موبایل</p><p dir="ltr">{selected.mobile}</p></div>
              <div className="rounded-xl bg-navy-50/70 p-3"><p className="text-[10px] text-navy-500">کد ملی</p><p dir="ltr">{selected.nationalId ?? '—'}</p></div>
              <div className="rounded-xl bg-navy-50/70 p-3"><p className="text-[10px] text-navy-500">آخرین ورود</p><p className="text-xs">{selected.lastLoginAt ? faDateTime(selected.lastLoginAt) : '—'}</p></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <StatCard label="پرونده‌ها" value={faNum(selected.stats?.total ?? 0)} />
              <StatCard label="در جریان" value={faNum(selected.stats?.open ?? 0)} tone="amber" />
              <StatCard label="تکمیل" value={faNum(selected.stats?.completed ?? 0)} tone="emerald" />
              <StatCard label="مانده" value={rial(selected.stats?.outstandingAmount ?? 0)} tone="rose" />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-navy-800">آخرین پرونده‌ها</p>
              {selected.requests.length === 0 && <p className="text-xs text-navy-400">پرونده‌ای ندارد.</p>}
              <div className="space-y-1">
                {selected.requests.map((request: any) => (
                  <Link key={request.id} to={`/admin/requests/${request.id}`} className="flex items-center justify-between rounded-lg bg-navy-50/60 px-2 py-1.5 text-xs hover:bg-brand-50">
                    <span className="truncate">{request.serviceTitle} — {request.trackingCode}</span>
                    <StatusBadge status={request.status} label={request.statusLabel} />
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-navy-800">فاکتورها</p>
              {selected.invoices.length === 0 && <p className="text-xs text-navy-400">فاکتوری ندارد.</p>}
              <div className="space-y-1">
                {selected.invoices.map((invoice: any) => (
                  <div key={invoice.id} className="flex items-center justify-between rounded-lg bg-navy-50/60 px-2 py-1.5 text-xs">
                    <span>{invoice.number} — {rial(invoice.total)}</span>
                    <StatusBadge status={invoice.status} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="ویرایش مشتری"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>انصراف</Button><Button onClick={save}>ذخیره</Button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label="نام و نام خانوادگی"><Input value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="ایمیل"><Input value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} dir="ltr" className="text-left" /></Field>
              <Field label="کد ملی"><Input value={editing.nationalId ?? ''} onChange={(e) => setEditing({ ...editing, nationalId: e.target.value })} dir="ltr" className="text-left" maxLength={10} /></Field>
            </div>
            <Field label="وضعیت حساب">
              <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                options={[{ value: 'active', label: 'فعال' }, { value: 'pending', label: 'در انتظار تأیید' }, { value: 'suspended', label: 'مسدود' }]} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="استان"><Input value={editing.profile?.province ?? ''} onChange={(e) => setEditing({ ...editing, profile: { ...editing.profile, province: e.target.value } })} /></Field>
              <Field label="شهر"><Input value={editing.profile?.city ?? ''} onChange={(e) => setEditing({ ...editing, profile: { ...editing.profile, city: e.target.value } })} /></Field>
            </div>
            <Field label="نشانی"><Textarea value={editing.profile?.address ?? ''} onChange={(e) => setEditing({ ...editing, profile: { ...editing.profile, address: e.target.value } })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="مشتری جدید"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>انصراف</Button><Button onClick={create} disabled={form.fullName.length < 3 || form.mobile.length < 10}>ایجاد</Button></>}>
        <div className="space-y-3">
          <Field label="نام و نام خانوادگی" required><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="موبایل" required><Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} dir="ltr" className="text-left" /></Field>
            <Field label="کد ملی"><Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} dir="ltr" className="text-left" maxLength={10} /></Field>
          </div>
          <Field label="رمز عبور اولیه (اختیاری)" hint="حداقل ۸ کاراکتر؛ در صورت خالی بودن، ورود با کد پیامکی انجام می‌شود.">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" className="text-left" />
          </Field>
        </div>
      </Modal>
    </AppShell>
  );
}

/* ---------------------------------- staff --------------------------------- */

const ROLE_OPTIONS_DEFAULT = [
  { value: 'super_admin', label: 'مدیر کل' },
  { value: 'manager', label: 'مدیر داخلی / سرپرست' },
  { value: 'service_expert', label: 'کارشناس خدمات' },
  { value: 'operator', label: 'کارمند اجرایی' },
  { value: 'document_reviewer', label: 'مسئول بررسی مدارک' },
  { value: 'finance_officer', label: 'مسئول مالی' },
];

export function AdminStaff() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState<'staff' | 'roles'>('staff');
  const [staff, setStaff] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({
    fullName: '', mobile: '', username: '', email: '', password: '', roleCode: 'service_expert',
    employeeCode: '', position: '', specialties: '', maxActiveCases: 20, kind: 'staff',
  });
  const [roleEditing, setRoleEditing] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.list<any>('/api/staff', { search: search || undefined }),
      api.list<any>('/api/staff/meta/roles'),
    ]).then(([st, rl]) => { setStaff(st.data); setRoles(rl.data); })
      .catch((err) => notify(err instanceof ApiFailure ? err.message : 'خطا', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const openRolesMeta = async () => {
    if (meta) return;
    const res = await api.get<{ data: any }>('/api/staff/meta/permissions').catch(() => null);
    if (res) setMeta(res.data);
  };

  const create = async () => {
    try {
      await api.post('/api/staff', {
        ...form,
        specialties: form.specialties.split(',').map((s: string) => s.trim()).filter(Boolean),
        maxActiveCases: Number(form.maxActiveCases),
      });
      notify('کارمند ایجاد شد.', 'success');
      setCreating(false);
      setForm({ fullName: '', mobile: '', username: '', email: '', password: '', roleCode: 'service_expert', employeeCode: '', position: '', specialties: '', maxActiveCases: 20, kind: 'staff' });
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const saveStaff = async () => {
    if (!editing) return;
    try {
      await api.patch(`/api/staff/${editing.id}`, {
        fullName: editing.fullName, email: editing.email, position: editing.position,
        roleCode: editing.roleCode, maxActiveCases: Number(editing.maxActiveCases),
        acceptsNewCases: editing.acceptsNewCases, status: editing.status,
        specialties: Array.isArray(editing.specialties) ? editing.specialties : String(editing.specialties ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      });
      notify('تغییرات ذخیره شد.', 'success');
      setEditing(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const toggleAvailability = async (member: any) => {
    try {
      await api.post(`/api/staff/${member.id}/toggle-availability`, {});
      notify('وضعیت پذیرش پرونده تغییر کرد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const showPerformance = async (member: any) => {
    const res = await api.get<{ data: any }>(`/api/staff/${member.id}/performance`).catch(() => null);
    setPerformance({ member, data: res?.data });
  };

  const saveRole = async () => {
    if (!roleEditing) return;
    try {
      if (roleEditing.id) {
        await api.patch(`/api/staff/meta/roles/${roleEditing.id}`, { name: roleEditing.name, description: roleEditing.description, permissions: roleEditing.permissions });
      } else {
        await api.post('/api/staff/meta/roles', roleEditing);
      }
      notify('نقش ذخیره شد.', 'success');
      setRoleEditing(null);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const togglePermission = (permission: string) => {
    if (!roleEditing) return;
    const has = roleEditing.permissions.includes(permission);
    setRoleEditing({
      ...roleEditing,
      permissions: has ? roleEditing.permissions.filter((p: string) => p !== permission) : [...roleEditing.permissions, permission],
    });
  };

  return (
    <AppShell variant="admin">
      <PageHeader title="کارکنان و نقش‌ها" description="مدیریت کارکنان دفتر، ظرفیت کاری، تخصص و مجوزهای هر نقش."
        actions={can('staff.create') ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> کارمند جدید</Button> : undefined} />

      <div className="mb-4 flex gap-1 rounded-xl bg-white p-1 ring-1 ring-navy-900/8 sm:w-fit">
        {[{ key: 'staff', label: 'کارکنان' }, { key: 'roles', label: 'نقش‌ها و مجوزها' }].map((item) => (
          <button key={item.key} onClick={() => { setTab(item.key as any); if (item.key === 'roles') void openRolesMeta(); }}
            className={clsx('rounded-lg px-4 py-1.5 text-sm transition', tab === item.key ? 'bg-brand-700 text-white' : 'text-navy-600 hover:bg-navy-50')}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'staff' && (
        <>
          <div className="card mb-4 flex items-center gap-2 p-3">
            <Search className="size-4 text-navy-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، موبایل یا کد پرسنلی…" className="w-full bg-transparent py-1.5 text-sm outline-none" />
          </div>
          {loading && <Loading />}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((member) => (
              <Card key={member.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy-900">{member.fullName}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">{member.roleName ?? member.roleCode} {member.employeeCode ? `• ${member.employeeCode}` : ''}</p>
                    <p dir="ltr" className="mt-0.5 text-left text-[11px] text-navy-400">{member.mobile}</p>
                  </div>
                  <StatusBadge status={member.status} />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-navy-500">
                  <span>بار کاری {faNum(member.activeCases)} / {faNum(member.maxActiveCases)}</span>
                  <Badge tone={member.acceptsNewCases ? 'success' : 'default'}>{member.acceptsNewCases ? 'پذیرش فعال' : 'پذیرش بسته'}</Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-navy-100">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (member.activeCases / Math.max(1, member.maxActiveCases)) * 100)}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {can('staff.edit') && <Button size="sm" variant="ghost" onClick={() => setEditing({ ...member, specialties: (member.specialties ?? []).join(', ') })}>ویرایش</Button>}
                  <Button size="sm" variant="ghost" onClick={() => toggleAvailability(member)}><RefreshCw className="size-3.5" /> پذیرش</Button>
                  <Button size="sm" variant="ghost" onClick={() => showPerformance(member)}><BadgeCheck className="size-3.5" /> عملکرد</Button>
                </div>
              </Card>
            ))}
          </div>
          {!loading && staff.length === 0 && <EmptyState title="کارمندی ثبت نشده است" />}
        </>
      )}

      {tab === 'roles' && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs leading-6 text-navy-500">
              مجوزها به‌صورت ریزدانه (`منبع.عمل`) ذخیره می‌شوند و در سمت سرور اعمال می‌شوند. نقش «مدیر کل» همیشه دسترسی کامل دارد.
            </p>
            {can('roles.create') && (
              <Button size="sm" onClick={() => { setRoleEditing({ code: '', name: '', description: '', permissions: [] }); void openRolesMeta(); }}>
                <Plus className="size-4" /> نقش جدید
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((role) => (
              <Card key={role.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-navy-900">{role.name}</p>
                    <p className="mt-0.5 text-[11px] text-navy-500">{role.description}</p>
                  </div>
                  {role.isSystem && <Badge tone="info">سیستمی</Badge>}
                </div>
                <p className="mt-2 text-[11px] text-navy-400">
                  {role.code === 'super_admin' ? 'دسترسی کامل به همه بخش‌ها' : `${faNum(role.permissions.length)} مجوز`}
                </p>
                <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => { setRoleEditing({ ...role, permissions: role.code === 'super_admin' ? ['*'] : role.permissions }); void openRolesMeta(); }}>
                  <ShieldCheck className="size-3.5" /> مشاهده / ویرایش مجوزها
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="کارمند جدید" size="lg"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>انصراف</Button><Button onClick={create} disabled={form.fullName.length < 3 || form.mobile.length < 10 || form.password.length < 8}>ایجاد</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام و نام خانوادگی" required><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="موبایل" required><Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} dir="ltr" className="text-left" /></Field>
          <Field label="نام کاربری" hint="برای ورود با رمز عبور"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} dir="ltr" className="text-left" /></Field>
          <Field label="رمز عبور" required hint="حداقل ۸ کاراکتر، شامل حرف و رقم"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" className="text-left" /></Field>
          <Field label="نقش" required>
            <Select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}
              options={roles.length ? roles.map((r) => ({ value: r.code, label: r.name })) : ROLE_OPTIONS_DEFAULT} />
          </Field>
          <Field label="کد پرسنلی"><Input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} dir="ltr" className="text-left" /></Field>
          <Field label="سمت"><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
          <Field label="حداکثر پرونده فعال"><Input type="number" value={form.maxActiveCases} onChange={(e) => setForm({ ...form, maxActiveCases: Number(e.target.value) })} /></Field>
          <Field label="تخصص‌ها" hint="شناسه دسته‌ها با کاما؛ برای ارجاع خودکار استفاده می‌شود." className="sm:col-span-2">
            <Input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} placeholder="insurance, companies" dir="ltr" className="text-left" />
          </Field>
          <Field label="نوع کاربر">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
              options={[{ value: 'staff', label: 'کارمند' }, { value: 'admin', label: 'مدیر' }]} />
          </Field>
        </div>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="ویرایش کارمند"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>انصراف</Button><Button onClick={saveStaff}>ذخیره</Button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label="نام و نام خانوادگی"><Input value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} /></Field>
            <Field label="نقش">
              <Select value={editing.roleCode} onChange={(e) => setEditing({ ...editing, roleCode: e.target.value })} options={roles.map((r) => ({ value: r.code, label: r.name }))} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="سمت"><Input value={editing.position ?? ''} onChange={(e) => setEditing({ ...editing, position: e.target.value })} /></Field>
              <Field label="حداکثر پرونده فعال"><Input type="number" value={editing.maxActiveCases} onChange={(e) => setEditing({ ...editing, maxActiveCases: Number(e.target.value) })} /></Field>
            </div>
            <Field label="تخصص‌ها" hint="با کاما جدا کنید"><Input value={editing.specialties} onChange={(e) => setEditing({ ...editing, specialties: e.target.value })} dir="ltr" className="text-left" /></Field>
            <Field label="وضعیت حساب">
              <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                options={[{ value: 'active', label: 'فعال' }, { value: 'suspended', label: 'مسدود' }]} />
            </Field>
            <Switch checked={Boolean(editing.acceptsNewCases)} onChange={(v) => setEditing({ ...editing, acceptsNewCases: v })} label="پرونده جدید می‌پذیرد" />
          </div>
        )}
      </Modal>

      <Modal open={Boolean(roleEditing)} onClose={() => setRoleEditing(null)} title="مجوزهای نقش" size="lg"
        footer={<><Button variant="ghost" onClick={() => setRoleEditing(null)}>انصراف</Button><Button onClick={saveRole}>ذخیره نقش</Button></>}>
        {roleEditing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="کد نقش" hint="حروف لاتین کوچک"><Input value={roleEditing.code} onChange={(e) => setRoleEditing({ ...roleEditing, code: e.target.value })} dir="ltr" className="text-left" disabled={Boolean(roleEditing.id)} /></Field>
              <Field label="عنوان نقش" required><Input value={roleEditing.name} onChange={(e) => setRoleEditing({ ...roleEditing, name: e.target.value })} /></Field>
            </div>
            <Field label="توضیح"><Input value={roleEditing.description ?? ''} onChange={(e) => setRoleEditing({ ...roleEditing, description: e.target.value })} /></Field>

            {roleEditing.permissions.includes('*') ? (
              <div className="flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-xs leading-6 text-brand-900">
                <Info className="mt-0.5 size-4 shrink-0" /> این نقش دسترسی کامل دارد و برای جلوگیری از قفل شدن سامانه قابل محدودسازی نیست.
              </div>
            ) : !meta ? (
              <Loading />
            ) : (
              <div className="table-wrap">
                <table className="table text-xs">
                  <thead>
                    <tr>
                      <th>بخش</th>
                      {meta.actions.map((action: any) => <th key={action.code} className="text-center">{action.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {meta.resources.map((resource: any) => (
                      <tr key={resource.code}>
                        <td className="font-medium text-navy-800">{resource.label}</td>
                        {meta.actions.map((action: any) => {
                          const permission = `${resource.code}.${action.code}`;
                          const checked = roleEditing.permissions.includes(permission);
                          return (
                            <td key={permission} className="text-center">
                              <input type="checkbox" checked={checked} onChange={() => togglePermission(permission)}
                                className="size-4 rounded border-navy-300 text-brand-600" aria-label={permission} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(performance)} onClose={() => setPerformance(null)} title={`عملکرد ${performance?.member?.fullName ?? ''}`}>
        {performance && !performance.data && <p className="text-sm text-navy-500">اطلاعات عملکرد در دسترس نیست.</p>}
        {performance?.data && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="تکمیل‌شده" value={faNum(performance.data.completed)} tone="emerald" />
              <StatCard label="میانگین زمان" value={performance.data.averageCompletionHours !== null ? `${faNum(performance.data.averageCompletionHours)} ساعت` : '—'} />
            </div>
            <div className="flex flex-wrap gap-2">
              {performance.data.byStatus.map((row: any) => (
                <Badge key={row.status} tone="default">{row.status} {faNum(row.count)}</Badge>
              ))}
            </div>
            <p className="text-xs text-navy-500">درآمد منتسب: {rial(performance.data.revenue)}</p>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
