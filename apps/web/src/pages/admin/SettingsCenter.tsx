import { useEffect, useMemo, useState } from 'react';
import {
  Save, RotateCcw, TestTube2, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, KeyRound,
  MessageSquare, Globe, Loader2, Info, Eye, EyeOff, Search,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Switch,
  Textarea, useToast,
} from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDateTime, faNum } from '../../lib/format';

interface SettingItem {
  key: string; group: string; type: string; label: string; hint?: string;
  value: any; hasValue?: boolean; isSecret?: boolean; masked?: string;
  options?: { value: string; label: string }[]; min?: number; max?: number;
  placeholder?: string; critical?: boolean; defaultValue?: any;
}

const GROUP_ICONS: Record<string, string> = {
  general: '🏢', domain: '🌐', auth: '🔑', sms: '📩', email: '✉️', security: '🛡️', services: '🧾',
  accounting: '💳', workforce: '🗓️', assistant: '🤖', files: '📁', backup: '💾', maintenance: '📊', multibranch: '🏬',
};

export function SettingsCenter() {
  const { notify } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeGroup, setActiveGroup] = useState('general');
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [criticalModal, setCriticalModal] = useState(false);
  const [smsTestMobile, setSmsTestMobile] = useState('');
  const [smsState, setSmsState] = useState<any>(null);
  const [smsLogs, setSmsLogs] = useState<any[]>([]);
  const [testing, setTesting] = useState<'connection' | 'send' | null>(null);
  const [domainCheck, setDomainCheck] = useState<any>(null);

  const load = () => {
    setLoading(true);
    api.get<{ data: any }>('/api/settings/admin')
      .then((res) => {
        setData(res.data);
        const initial: Record<string, any> = {};
        for (const item of res.data.settings as SettingItem[]) {
          initial[item.key] = item.isSecret ? '' : item.value;
        }
        setDraft(initial);
      })
      .catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا در دریافت تنظیمات'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get<{ data: any }>('/api/settings/sms/credentials').then((res) => setSmsState(res.data)).catch(() => undefined);
    api.list<any>('/api/settings/sms/logs', { limit: 10 }).then((res) => setSmsLogs(res.data)).catch(() => undefined);
  }, []);

  const settings: SettingItem[] = data?.settings ?? [];
  const groups = useMemo(() => (data?.groups ?? []).slice().sort((a: any, b: any) => a.order - b.order), [data]);

  const dirtyKeys = useMemo(
    () => settings.filter((item) => !item.isSecret && draft[item.key] !== item.value).map((item) => item.key)
      .concat(settings.filter((item) => item.isSecret && (draft[item.key] ?? '') !== '').map((item) => item.key)),
    [settings, draft],
  );

  const groupSettings = settings.filter((item) => item.group === activeGroup);
  const criticalDirty = groupSettings.some((item) => item.critical && dirtyKeys.includes(item.key));

  const save = async (confirmed = false) => {
    if (dirtyKeys.length === 0) {
      notify('تغییری برای ذخیره وجود ندارد.', 'info');
      return;
    }
    if (criticalDirty && !confirmed) {
      setCriticalModal(true);
      return;
    }
    const values: Record<string, any> = {};
    for (const key of dirtyKeys) values[key] = draft[key];
    setSaving(true);
    try {
      const res = await api.put<{ data: any }>('/api/settings/admin', { values, confirmCritical: confirmed });
      notify(res.data.message ?? 'تنظیمات ذخیره شد.', 'success');
      setCriticalModal(false);
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ذخیره تنظیمات', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async (item: SettingItem) => {
    if (!window.confirm(`مقدار «${item.label}» به پیش‌فرض بازگردانده شود؟`)) return;
    try {
      await api.post('/api/settings/admin/reset', { key: item.key });
      notify('مقدار پیش‌فرض بازگردانده شد.', 'success');
      load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    }
  };

  const testConnection = async () => {
    setTesting('connection');
    try {
      const res = await api.post<{ data: any }>('/api/settings/sms/test-connection');
      notify(res.data.message ?? (res.data.ok ? 'اتصال برقرار است.' : 'اتصال برقرار نشد.'), res.data.ok ? 'success' : 'error');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در بررسی اتصال', 'error');
    } finally { setTesting(null); }
  };

  const sendTest = async () => {
    if (!smsTestMobile) {
      notify('شماره مقصد را وارد کنید. پیامک بدون شماره مشخص ارسال نمی‌شود.', 'error');
      return;
    }
    if (!window.confirm(`پیامک آزمایشی به ${smsTestMobile} ارسال شود؟`)) return;
    setTesting('send');
    try {
      const res = await api.post<{ data: any }>('/api/settings/sms/test-send', { mobile: smsTestMobile });
      notify(res.data.message ?? (res.data.ok ? 'پیامک ارسال شد.' : 'ارسال ناموفق بود.'), res.data.ok ? 'success' : 'error');
      api.list<any>('/api/settings/sms/logs', { limit: 10 }).then((r) => setSmsLogs(r.data)).catch(() => undefined);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در ارسال پیامک', 'error');
    } finally { setTesting(null); }
  };

  const checkDomain = async () => {
    try {
      const res = await api.get<{ data: any }>('/api/settings/domain-check');
      setDomainCheck(res.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا در بررسی دامنه', 'error');
    }
  };

  if (loading) return <AppShell variant="admin"><Loading rows={6} /></AppShell>;
  if (error) return <AppShell variant="admin"><ErrorState message={error} onRetry={load} /></AppShell>;

  const filteredGroups = search.trim()
    ? groups.filter((group: any) => settings.some((item) => item.group === group.code && (
      item.label.includes(search) || item.key.includes(search) || (item.hint ?? '').includes(search)
    )))
    : groups;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="تنظیمات سامانه"
        description="هر گزینه توضیح، اعتبارسنجی و اثر مشخص دارد. مقادیر رمزنگاری‌شده هرگز به مرورگر ارسال نمی‌شوند."
        actions={
          <div className="flex gap-2">
            {dirtyKeys.length > 0 && <Badge tone="warning">{faNum(dirtyKeys.length)} تغییر ذخیره‌نشده</Badge>}
            <Button size="sm" loading={saving} onClick={() => save(false)} disabled={dirtyKeys.length === 0}>
              <Save className="size-4" /> ذخیره تنظیمات
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-navy-500">
        <span>آخرین تغییر: {data?.lastUpdated ? faDateTime(data.lastUpdated) : '—'}</span>
        <span>•</span>
        <span>محیط: {data?.meta?.nodeEnv}</span>
        <span>•</span>
        <span>نسخه: {data?.meta?.version}</span>
        <span>•</span>
        <span>کلید رمزنگاری: {data?.meta?.encryptionConfigured ? <CheckCircle2 className="inline size-3 text-emerald-700" /> : <XCircle className="inline size-3 text-rose-700" />}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <div>
          <div className="card mb-3 flex items-center gap-2 p-2">
            <Search className="size-4 text-navy-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجوی گزینه…" className="w-full bg-transparent py-1 text-xs outline-none" />
          </div>
          <nav className="card overflow-hidden p-1">
            {filteredGroups.map((group: any) => (
              <button key={group.code} onClick={() => setActiveGroup(group.code)}
                className={clsx('mb-0.5 flex w-full items-start gap-2 rounded-lg px-3 py-2 text-right transition',
                  activeGroup === group.code ? 'bg-brand-50 text-brand-900' : 'text-navy-600 hover:bg-surface-3')}>
                <span className="text-base leading-5">{GROUP_ICONS[group.code] ?? '⚙️'}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{group.title}</span>
                  <span className="block text-[10px] leading-4 text-navy-400">{group.description}</span>
                </span>
              </button>
            ))}
            {filteredGroups.length === 0 && <p className="p-3 text-xs text-navy-400">گزینه‌ای یافت نشد.</p>}
          </nav>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-navy-900">{groups.find((g: any) => g.code === activeGroup)?.title}</h2>
                <p className="mt-0.5 text-[11px] text-navy-500">{groups.find((g: any) => g.code === activeGroup)?.description}</p>
              </div>
              <RotateCcw className="size-4 text-navy-500" />
            </div>

            <div className="space-y-5">
              {groupSettings.map((item) => (
                <SettingRow
                  key={item.key}
                  item={item}
                  value={draft[item.key]}
                  revealed={Boolean(revealed[item.key])}
                  onToggleReveal={() => setRevealed((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                  onChange={(value) => setDraft((prev) => ({ ...prev, [item.key]: value }))}
                  onReset={() => reset(item)}
                  dirty={dirtyKeys.includes(item.key)}
                />
              ))}
              {groupSettings.length === 0 && <EmptyState title="گزینه‌ای در این بخش نیست" />}
            </div>
          </Card>

          {activeGroup === 'sms' && <SmsTemplatesPanel notify={notify} />}

          {activeGroup === 'sms' && (
            <Card>
              <h2 className="mb-1 flex items-center gap-2 font-bold text-navy-900"><MessageSquare className="size-4 text-accent" /> آزمون سرویس پیامک</h2>
              <p className="mb-3 text-[11px] leading-5 text-navy-500">
                ارسال پیامک فقط با شماره مقصد مشخص انجام می‌شود. اعتبارنامه‌ها در سرور ذخیره و رمزنگاری می‌شوند و در مرورگر نمایش داده نمی‌شوند.
              </p>

              <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
                <Badge tone={smsState?.enabled ? 'success' : 'default'}>ارسال: {smsState?.enabled ? 'فعال' : 'غیرفعال'}</Badge>
                <Badge tone="info">ارائه‌دهنده: {smsState?.provider ?? '—'}</Badge>
                <Badge tone="info">روش احراز: {smsState?.authMode ?? '—'}</Badge>
                <Badge tone={smsState?.hasPassword || smsState?.hasApiKey ? 'success' : 'warning'}>
                  اعتبارنامه: {smsState?.hasPassword || smsState?.hasApiKey ? 'ثبت شده' : 'ثبت نشده'}
                </Badge>
                <Badge tone="default">خط ارسال: {smsState?.senderLine ?? '—'}</Badge>
                <Badge tone="default">کد الگو: {smsState?.otpTemplate || '—'}</Badge>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button size="sm" variant="ghost" loading={testing === 'connection'} onClick={testConnection}>
                  <TestTube2 className="size-4" /> بررسی اتصال
                </Button>
                <Input value={smsTestMobile} onChange={(e) => setSmsTestMobile(e.target.value)} placeholder="09123456789" dir="ltr" className="text-left sm:w-44" />
                <Button size="sm" loading={testing === 'send'} onClick={sendTest} disabled={!smsTestMobile}>ارسال پیامک آزمایشی</Button>
              </div>

              {smsLogs.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-semibold text-navy-800">آخرین ارسال‌ها</p>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>زمان</th><th>مقصد</th><th>نوع</th><th>وضعیت</th></tr></thead>
                      <tbody>
                        {smsLogs.map((log) => (
                          <tr key={log.id}>
                            <td className="text-[11px]">{faDateTime(log.createdAt ?? log.created_at)}</td>
                            <td dir="ltr" className="text-left text-[11px]">{mask(log.to ?? log.recipient ?? '')}</td>
                            <td className="text-[11px]">{log.kind ?? log.template ?? '—'}</td>
                            <td className="text-[11px]">
                              {log.status === 'sent' || log.success ? <span className="text-emerald-700">ارسال شد</span>
                                : <span className="text-rose-700">{log.error ?? 'ناموفق'}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}

          {activeGroup === 'domain' && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-bold text-navy-900"><Globe className="size-4 text-accent" /> بررسی اتصال دامنه</h2>
                <Button size="sm" variant="ghost" onClick={checkDomain}>اجرای بررسی</Button>
              </div>
              <p className="mb-3 text-[11px] leading-5 text-navy-500">
                این بررسی دامنه نمی‌خرد و DNS را تغییر نمی‌دهد؛ فقط سازگاری تنظیمات و دسترسی HTTPS را می‌سنجد.
              </p>
              {!domainCheck && <p className="text-sm text-navy-400">برای مشاهده نتیجه، دکمه «اجرای بررسی» را بزنید.</p>}
              {domainCheck && (
                <div className="space-y-2">
                  {domainCheck.checks.map((check: any) => (
                    <div key={check.key} className="flex items-start gap-2 rounded-xl bg-surface-3 px-3 py-2">
                      {check.status === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-700" />
                        : check.status === 'warning' ? <AlertTriangle className="mt-0.5 size-4 text-amber-700" />
                          : <XCircle className="mt-0.5 size-4 text-rose-700" />}
                      <div>
                        <p className="text-xs font-medium text-navy-900">{check.label}</p>
                        <p className="text-[11px] text-navy-500">{check.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <Modal open={criticalModal} onClose={() => setCriticalModal(false)} title="تأیید تغییر تنظیمات حساس"
        footer={<><Button variant="ghost" onClick={() => setCriticalModal(false)}>انصراف</Button><Button variant="danger" loading={saving} onClick={() => save(true)}>تأیید و ذخیره</Button></>}>
        <div className="space-y-3 text-sm leading-7">
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            یکی از گزینه‌های در حال تغییر، روی ورود کاربران یا امنیت سامانه اثر مستقیم دارد.
          </div>
          <p className="text-xs text-navy-600">
            پیش از تغییر روش ورود، مطمئن شوید حداقل یک راه ورود برای مدیر کل فعال می‌ماند. در صورت اشتباه،
            مقدار قبلی را می‌توانید از همین صفحه بازگردانید.
          </p>
          <ul className="space-y-1 text-[11px] text-navy-600">
            {groupSettings.filter((item) => item.critical && dirtyKeys.includes(item.key)).map((item) => (
              <li key={item.key}>• <span className="font-medium">{item.label}</span> ({item.key})</li>
            ))}
          </ul>
        </div>
      </Modal>
    </AppShell>
  );
}

function SmsTemplatesPanel({ notify }: { notify: (message: string, type: 'success' | 'error' | 'info') => void }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => api.get<{ data: any[] }>('/api/settings/sms/templates')
    .then((res) => {
      setTemplates(res.data);
      setDrafts(Object.fromEntries(res.data.map((item) => [item.eventCode, {
        bodyId: item.bodyId, patternText: item.patternText, enabled: item.enabled,
      }])));
      setError('');
    })
    .catch((err) => setError(err instanceof ApiFailure ? err.message : 'بارگذاری الگوها ناموفق بود.'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const saveTemplate = async (eventCode: string) => {
    const draft = drafts[eventCode];
    if (!draft) return;
    setSaving(eventCode);
    try {
      await api.put(`/api/settings/sms/templates/${encodeURIComponent(eventCode)}`, draft);
      notify('الگوی این رویداد ذخیره شد. برای ارسال واقعی باید شناسه و متن را با پنل ارائه‌دهنده تطبیق دهید.', 'success');
      await load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ذخیره الگوی پیامک ناموفق بود.', 'error');
    } finally { setSaving(null); }
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold text-navy-900"><MessageSquare className="size-4 text-accent" /> الگوهای پیامک رویدادها</h2>
      <p className="mb-4 text-[11px] leading-5 text-navy-500">
        برای هر رویداد، شناسه پترن و متن تأییدشده را از پنل ارائه‌دهنده وارد کنید. فقط نام متغیرهای ثابت زیر به ترتیب مشخص‌شده به پترن فرستاده می‌شود؛ متن آزاد و یادداشت داخلی ارسال نمی‌شود. وضعیت «ساختار کامل» تأیید ارائه‌دهنده یا تحویل واقعی پیامک نیست.
      </p>
      {loading ? <Loading rows={2} /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <div className="space-y-4">
          {templates.map((template) => {
            const draft = drafts[template.eventCode] ?? {};
            return (
              <div key={template.eventCode} className="rounded-xl border border-navy-100 p-3 sm:p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-navy-900">{template.title}</h3>
                    <p className="text-[11px] text-navy-500">گیرنده: {template.recipientType === 'customer' ? 'مشتری' : 'کارشناس'} · {template.description}</p>
                  </div>
                  <Badge tone={template.validationStatus === 'configured' ? 'info' : 'warning'}>
                    {template.validationStatus === 'configured' ? 'ساختار کامل؛ تطبیق ارائه‌دهنده تأیید نشده' : 'ناقص'}
                  </Badge>
                </div>
                <div className="mb-3 rounded-lg bg-surface-3 px-3 py-2 text-[11px] text-navy-600">
                  متغیرها، به همین ترتیب: <span dir="ltr" className="font-mono">{template.parameters.map((name: string) => `{${name}}`).join('، ')}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="شناسه پترن ارائه‌دهنده">
                    <Input dir="ltr" inputMode="numeric" value={draft.bodyId ?? ''} onChange={(e) => setDrafts((prev) => ({ ...prev, [template.eventCode]: { ...draft, bodyId: e.target.value } }))} placeholder="شناسه عددی" />
                  </Field>
                  <Field label="متن پترن (فقط برای تطبیق مدیریتی)">
                    <Textarea dir="rtl" value={draft.patternText ?? ''} onChange={(e) => setDrafts((prev) => ({ ...prev, [template.eventCode]: { ...draft, patternText: e.target.value } }))} className="min-h-20" placeholder={template.parameters.map((name: string) => `{${name}}`).join(' ')} />
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <Switch checked={Boolean(draft.enabled)} onChange={(enabled) => setDrafts((prev) => ({ ...prev, [template.eventCode]: { ...draft, enabled } }))} label={draft.enabled ? 'ارسال این رویداد فعال' : 'غیرفعال'} />
                  <Button size="sm" loading={saving === template.eventCode} onClick={() => saveTemplate(template.eventCode)}><Save className="size-4" /> ذخیره الگو</Button>
                </div>
              </div>
            );
          })}
          {templates.length === 0 && <EmptyState title="رویدادی برای پیکربندی موجود نیست" />}
        </div>
      )}
    </Card>
  );
}

function SettingRow({ item, value, onChange, onReset, dirty, revealed, onToggleReveal }: {
  item: SettingItem; value: any; onChange: (value: any) => void; onReset: () => void;
  dirty: boolean; revealed: boolean; onToggleReveal: () => void;
}) {
  const [rawJson, setRawJson] = useState<string>('');
  useEffect(() => {
    if (item.type === 'json') setRawJson(typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2));
  }, [item.key]);

  const label = (
    <span className="flex flex-wrap items-center gap-1.5">
      {item.label}
      {item.critical && <Badge tone="danger">حساس</Badge>}
      {item.isSecret && <Badge tone="default"><KeyRound className="size-3" /> رمزنگاری‌شده</Badge>}
      {dirty && <Badge tone="warning">تغییر یافته</Badge>}
    </span>
  );

  const body = (() => {
    switch (item.type) {
      case 'boolean':
        return <Switch checked={Boolean(value)} onChange={onChange} label={value ? 'فعال' : 'غیرفعال'} />;
      case 'select':
        return <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} options={item.options ?? []} />;
      case 'textarea':
        return <Textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="min-h-24" />;
      case 'color':
        return (
          <div className="flex items-center gap-2">
            <input type="color" value={String(value || '#0b1f3a')} onChange={(e) => onChange(e.target.value)} className="size-10 cursor-pointer rounded-lg border border-navy-200" aria-label={item.label} />
            <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} dir="ltr" className="text-left" />
          </div>
        );
      case 'password':
        return (
          <div className="relative">
            <Input
              type={revealed ? 'text' : 'password'}
              value={String(value ?? '')}
              onChange={(e) => onChange(e.target.value)}
              placeholder={item.hasValue ? `ذخیره شده: ${item.masked ?? '••••••'}` : 'مقدار جدید را وارد کنید'}
              dir="ltr"
              className="text-left pl-10"
              autoComplete="new-password"
            />
            <button type="button" onClick={onToggleReveal} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-navy-400 hover:bg-surface-3" aria-label="نمایش">
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        );
      case 'json':
        return (
          <Textarea
            value={rawJson}
            onChange={(e) => { setRawJson(e.target.value); onChange(e.target.value); }}
            dir="ltr"
            className="min-h-28 text-left font-mono text-xs"
            spellCheck={false}
          />
        );
      case 'number':
        return <Input type="number" value={Number(value ?? 0)} min={item.min} max={item.max}
          onChange={(e) => onChange(Number(e.target.value))} />;
      case 'time':
        return <Input type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} dir="ltr" />;
      case 'url':
      case 'email':
      case 'tel':
        return <Input type={item.type === 'url' ? 'url' : item.type} value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)} dir="ltr" className="text-left" placeholder={item.placeholder} />;
      default:
        return <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={item.placeholder} />;
    }
  })();

  return (
    <div className="rounded-xl border border-navy-900/6 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-navy-900">{label}</p>
          {item.hint && <p className="mt-0.5 text-[11px] leading-5 text-navy-500">{item.hint}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onReset} className="rounded-lg p-1.5 text-navy-400 hover:bg-surface-3 hover:text-navy-700" title="بازگردانی پیش‌فرض" aria-label="بازگردانی">
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-2">{body}</div>
      <p dir="ltr" className="mt-1.5 text-right text-[10px] text-navy-500">{item.key}</p>
    </div>
  );
}

const mask = (value: string) => (value.length > 6 ? `${value.slice(0, 4)}***${value.slice(-2)}` : '***');
