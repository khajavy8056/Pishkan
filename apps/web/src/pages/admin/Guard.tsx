import { useCallback, useEffect, useState } from 'react';
import {
  ShieldAlert, ShieldCheck, RefreshCw, Ban, Unlock, ScanLine, FileWarning, PackageSearch,
  ArchiveRestore, CheckCircle2, AlertTriangle, Siren, Send, Eye,
} from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import { Button, Card, EmptyState, Field, Input, Loading, Modal, Select, StatCard, Tabs, useToast } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum } from '../../lib/format';

interface PostureItem { key: string; title: string; status: 'ok' | 'warning' | 'critical' | 'unknown'; detail: string }
interface GuardEvent {
  id: string; created_at: string; severity: 'info' | 'warning' | 'critical'; kind: string;
  source_ip: string | null; user_id: string | null; method: string | null; path: string | null;
  message: string; details: Record<string, unknown>; action_taken: string | null;
  acknowledged_at: string | null; acknowledged_by: string | null;
}
interface GuardBlock { id: string; ip: string; reason: string; created_at: string; expires_at: string; created_by: string; revoked_at: string | null }
interface ScanRow { id: string; kind: string; status: string; started_at: string; finished_at: string | null; triggered_by: string; summary: Record<string, any> }
interface QuarantineRow { id: string; original_path: string; sha256: string; size: number; reason: string; created_at: string; created_by: string; restored_at: string | null }
interface DepsReport {
  checkedAt: string; ok: boolean; error?: string; total: number; counts: Record<string, number>;
  vulnerabilities: { name: string; severity: string; isDirect: boolean; range: string; advisories: { title: string; url: string }[]; fixAvailable: { name: string; version: string; isSemVerMajor: boolean } | boolean }[];
}
interface Overview {
  generatedAt: string; enabled: boolean; events24h: Record<string, number>; failedLogins24h: number;
  activeBlocks: number; openCritical: number; posture: PostureItem[]; recentEvents: GuardEvent[];
  lastScans: Record<string, ScanRow | null>;
}

const SEVERITY_LABEL: Record<string, string> = { info: 'اطلاع', warning: 'هشدار', critical: 'بحرانی' };
const SEVERITY_TONE: Record<string, string> = {
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  critical: 'bg-rose-50 text-rose-800 border-rose-200',
};
const POSTURE_TONE: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50/60',
  warning: 'border-amber-200 bg-amber-50/70',
  critical: 'border-rose-200 bg-rose-50/70',
  unknown: 'border-line bg-surface-3',
};
const POSTURE_LABEL: Record<string, string> = { ok: 'سالم', warning: 'هشدار', critical: 'بحرانی', unknown: 'نامشخص' };
const KIND_LABEL: Record<string, string> = {
  auth_bruteforce: 'حملهٔ رمز (Brute Force)', forbidden_burst: 'دسترسی غیرمجاز مکرر', path_scan: 'پویش مسیرها',
  rate_abuse: 'سوءاستفاده از نرخ API', upload_attack: 'آپلود غیرمجاز', exploit_probe: 'کاوش مسیر حمله',
  integrity_change: 'تغییر فایل برنامه', integrity_baseline: 'خط مبنای یکپارچگی', suspicious_upload: 'فایل مشکوک',
  deps_vulnerable: 'وابستگی آسیب‌پذیر', quarantine_restored: 'بازگردانی از قرنطینه',
};
const SCAN_LABEL: Record<string, string> = { integrity: 'یکپارچگی فایل‌ها', uploads: 'پوشهٔ آپلودها', deps: 'وابستگی‌ها' };

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold', SEVERITY_TONE[severity] ?? SEVERITY_TONE.info)}>{SEVERITY_LABEL[severity] ?? severity}</span>;
}

export function AdminGuard() {
  const { can } = useAuth();
  const { notify } = useToast();
  const push = (t: { kind: 'success' | 'error'; title: string; message: string }) =>
    notify(`${t.title} — ${t.message}`, t.kind === 'error' ? 'error' : 'success');
  const manage = can('guard.manage');
  const [tab, setTab] = useState('dashboard');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<GuardEvent[]>([]);
  const [blocks, setBlocks] = useState<GuardBlock[]>([]);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineRow[]>([]);
  const [deps, setDeps] = useState<DepsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState('');
  const [blockModal, setBlockModal] = useState(false);
  const [blockIp, setBlockIp] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blockMinutes, setBlockMinutes] = useState('30');
  const [scanDetail, setScanDetail] = useState<any | null>(null);

  const fail = useCallback((error: unknown) => {
    push({ kind: 'error', title: 'خطا', message: error instanceof ApiFailure ? error.message : 'ارتباط با سرور برقرار نشد.' });
  }, [push]);

  const load = useCallback(async () => {
    try {
      const [ov, ev, bl, sc, q, dp] = await Promise.all([
        api.get<{ data: Overview }>('/api/guard/overview'),
        api.get<{ data: GuardEvent[] }>('/api/guard/events', { limit: 200, severity: severityFilter || undefined }),
        api.get<{ data: GuardBlock[] }>('/api/guard/blocks'),
        api.get<{ data: ScanRow[] }>('/api/guard/scans'),
        api.get<{ data: QuarantineRow[] }>('/api/guard/quarantine'),
        api.get<{ data: DepsReport | null }>('/api/guard/deps'),
      ]);
      setOverview(ov.data); setEvents(ev.data); setBlocks(bl.data); setScans(sc.data); setQuarantine(q.data); setDeps(dp.data);
    } catch (error) { fail(error); } finally { setLoading(false); }
  }, [fail, severityFilter]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async (kind: 'integrity' | 'uploads' | 'deps') => {
    setBusy(kind);
    try {
      const result = await api.post<{ data: any }>('/api/guard/scan', { kind });
      push({ kind: 'success', title: `اسکن ${SCAN_LABEL[kind]} انجام شد`, message: result?.data?.summary ? JSON.stringify(result.data.summary).slice(0, 140) : 'نتیجه ثبت شد.' });
      await load();
    } catch (error) { fail(error); } finally { setBusy(null); }
  };

  const ack = async (id: string) => {
    try { await api.post(`/api/guard/events/${id}/ack`); await load(); } catch (error) { fail(error); }
  };

  const revoke = async (id: string) => {
    try { await api.delete(`/api/guard/blocks/${id}`); push({ kind: 'success', title: 'مسدودسازی لغو شد', message: 'دسترسی IP بازگشت.' }); await load(); } catch (error) { fail(error); }
  };

  const submitBlock = async () => {
    setBusy('block');
    try {
      await api.post('/api/guard/blocks', { ip: blockIp.trim(), reason: blockReason.trim(), minutes: Number(blockMinutes) || 30 });
      push({ kind: 'success', title: 'IP مسدود شد', message: `${blockIp} به‌طور موقت مسدود شد.` });
      setBlockModal(false); setBlockIp(''); setBlockReason('');
      await load();
    } catch (error) { fail(error); } finally { setBusy(null); }
  };

  const restore = async (id: string) => {
    try {
      await api.post(`/api/guard/quarantine/${id}/restore`, { confirm: 'بازگردانی فایل' });
      push({ kind: 'success', title: 'فایل بازگردانی شد', message: 'فایل به مسیر اصلی خود برگشت.' });
      await load();
    } catch (error) { fail(error); }
  };

  const rebuildBaseline = async () => {
    setBusy('baseline');
    try {
      await api.post('/api/guard/baseline/rebuild', { confirm: 'بازسازی خط مبنا' });
      push({ kind: 'success', title: 'خط مبنا بازسازی شد', message: 'وضعیت فعلی فایل‌ها مبنای اسکن‌های بعدی است.' });
      await load();
    } catch (error) { fail(error); } finally { setBusy(null); }
  };

  const testSms = async () => {
    setBusy('sms');
    try {
      const result = await api.post<{ data: { ok: boolean; message: string } }>('/api/guard/test-sms');
      push({ kind: result.data.ok ? 'success' : 'error', title: 'پیامک آزمایشی گارد', message: result.data.message });
    } catch (error) { fail(error); } finally { setBusy(null); }
  };

  const openScan = async (id: string) => {
    try { setScanDetail((await api.get<{ data: any }>(`/api/guard/scans/${id}`)).data); } catch (error) { fail(error); }
  };

  if (loading) return <AppShell variant="admin"><Loading label="بارگذاری گارد امنیتی…" /></AppShell>;

  const criticalPosture = overview?.posture.filter((p) => p.status === 'critical').length ?? 0;
  const warningPosture = overview?.posture.filter((p) => p.status === 'warning').length ?? 0;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="گارد تک پیشخوان"
        eyebrow="Takh Pishkhan Guard"
        description="نظارت، تشخیص، هشدار و واکنش امنیتی چندلایه — همهٔ اقدامات برگشت‌پذیر و ثبت‌شده‌اند."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw className="size-4" /> تازه‌سازی</Button>
            {manage && <Button variant="ghost" size="sm" onClick={testSms} loading={busy === 'sms'}><Send className="size-4" /> پیامک آزمایشی</Button>}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="وضعیت کلی" value={criticalPosture > 0 ? 'بحرانی' : warningPosture > 0 ? 'نیازمند توجه' : 'سالم'} hint={`${faNum(criticalPosture)} مورد بحرانی، ${faNum(warningPosture)} هشدار`} icon={<ShieldCheck className="size-5" />} tone={criticalPosture > 0 ? 'rose' : warningPosture > 0 ? 'amber' : 'emerald'} />
        <StatCard label="رویداد بحرانی ۲۴ ساعت" value={faNum(overview?.events24h?.critical ?? 0)} hint={`${faNum(overview?.events24h?.warning ?? 0)} هشدار، ${faNum(overview?.events24h?.info ?? 0)} اطلاع`} icon={<Siren className="size-5" />} tone={(overview?.events24h?.critical ?? 0) > 0 ? 'rose' : 'brand'} />
        <StatCard label="ورود ناموفق ۲۴ ساعت" value={faNum(overview?.failedLogins24h ?? 0)} icon={<AlertTriangle className="size-5" />} tone={(overview?.failedLogins24h ?? 0) > 20 ? 'amber' : 'navy'} />
        <StatCard label="IP مسدود فعال" value={faNum(overview?.activeBlocks ?? 0)} hint={`${faNum(overview?.openCritical ?? 0)} رویداد بحرانی بررسی‌نشده`} icon={<Ban className="size-5" />} tone={(overview?.activeBlocks ?? 0) > 0 ? 'amber' : 'emerald'} />
      </div>

      <div className="mt-4">
        <Tabs
          tabs={[
            { key: 'dashboard', label: 'وضعیت امنیتی' },
            { key: 'events', label: 'رویدادها', count: events.length },
            { key: 'blocks', label: 'مسدودسازی IP', count: blocks.length },
            { key: 'scans', label: 'اسکن‌ها و وابستگی‌ها' },
            { key: 'quarantine', label: 'قرنطینه', count: quarantine.length },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'dashboard' && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {(overview?.posture ?? []).map((item) => (
            <div key={item.key} className={clsx('rounded-xl border p-3', POSTURE_TONE[item.status])}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-navy-900">{item.title}</span>
                <span className="text-[11px] font-bold">{POSTURE_LABEL[item.status]}</span>
              </div>
              <p className="mt-1 text-xs leading-6 text-navy-700">{item.detail}</p>
            </div>
          ))}
          <Card className="lg:col-span-2">
            <h3 className="mb-2 text-sm font-bold text-navy-900">آخرین رویدادها</h3>
            {(overview?.recentEvents ?? []).length === 0
              ? <EmptyState title="رویدادی ثبت نشده است" description="تاکنون فعالیت مشکوکی شناسایی نشده." icon={<ShieldCheck className="size-8" />} />
              : <ul className="divide-y divide-line">
                  {(overview?.recentEvents ?? []).slice(0, 8).map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2"><SeverityBadge severity={event.severity} /><span className="truncate text-xs font-semibold text-navy-800">{KIND_LABEL[event.kind] ?? event.kind}</span></div>
                        <p className="mt-0.5 truncate text-[11px] text-navy-500">{event.message}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-navy-400">{faDateTime(event.created_at)}</span>
                    </li>
                  ))}
                </ul>}
          </Card>
        </div>
      )}

      {tab === 'events' && (
        <Card className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              options={[{ value: 'warning', label: 'هشدار' }, { value: 'critical', label: 'بحرانی' }, { value: 'info', label: 'اطلاع' }]}
              placeholder="همهٔ شدت‌ها"
              className="w-40"
            />
            <span className="text-xs text-navy-500">{faNum(events.length)} رویداد</span>
          </div>
          {events.length === 0
            ? <EmptyState title="رویدادی نیست" icon={<ShieldCheck className="size-8" />} />
            : <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead><tr className="border-b border-line text-navy-500">
                    <th className="p-2">زمان</th><th className="p-2">شدت</th><th className="p-2">نوع</th><th className="p-2">منبع</th><th className="p-2">شرح</th><th className="p-2">اقدام</th><th className="p-2"></th>
                  </tr></thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id} className="border-b border-line/60 align-top">
                        <td className="whitespace-nowrap p-2 text-navy-500">{faDateTime(event.created_at)}</td>
                        <td className="p-2"><SeverityBadge severity={event.severity} /></td>
                        <td className="p-2 font-semibold text-navy-800">{KIND_LABEL[event.kind] ?? event.kind}</td>
                        <td className="p-2 font-mono text-[11px]" dir="ltr">{event.source_ip ?? '—'}</td>
                        <td className="max-w-md p-2 leading-6 text-navy-700">{event.message}</td>
                        <td className="p-2 text-navy-600">{event.action_taken ?? '—'}</td>
                        <td className="p-2">
                          {manage && !event.acknowledged_at && <Button size="sm" variant="ghost" onClick={() => void ack(event.id)}><CheckCircle2 className="size-4" /> بررسی شد</Button>}
                          {event.acknowledged_at && <span className="text-[11px] text-emerald-700">بررسی شده</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </Card>
      )}

      {tab === 'blocks' && (
        <Card className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs leading-6 text-navy-600">مسدودسازی‌ها موقت و برگشت‌پذیرند؛ loopback، IPهای مورد اعتماد و (پیش‌فرض) کارکنان احرازشده هرگز مسدود نمی‌شوند.</p>
            {manage && <Button size="sm" onClick={() => setBlockModal(true)}><Ban className="size-4" /> مسدودسازی دستی</Button>}
          </div>
          {blocks.length === 0
            ? <EmptyState title="IP مسدودی وجود ندارد" icon={<Unlock className="size-8" />} />
            : <ul className="divide-y divide-line">
                {blocks.map((block) => (
                  <li key={block.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <span className="font-mono text-sm font-bold text-navy-900" dir="ltr">{block.ip}</span>
                      <p className="mt-0.5 text-[11px] text-navy-500">{block.reason}</p>
                      <p className="text-[11px] text-navy-400">تا {faDateTime(block.expires_at)} · توسط {block.created_by === 'guard' ? 'گارد (خودکار)' : block.created_by}</p>
                    </div>
                    {manage && <Button size="sm" variant="ghost" onClick={() => void revoke(block.id)}><Unlock className="size-4" /> لغو مسدودسازی</Button>}
                  </li>
                ))}
              </ul>}
        </Card>
      )}

      {tab === 'scans' && (
        <div className="mt-4 space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              {manage && <>
                <Button size="sm" onClick={() => void runScan('integrity')} loading={busy === 'integrity'}><ScanLine className="size-4" /> اسکن یکپارچگی فایل‌ها</Button>
                <Button size="sm" onClick={() => void runScan('uploads')} loading={busy === 'uploads'}><FileWarning className="size-4" /> اسکن آپلودها</Button>
                <Button size="sm" onClick={() => void runScan('deps')} loading={busy === 'deps'}><PackageSearch className="size-4" /> بررسی وابستگی‌ها</Button>
                <Button size="sm" variant="ghost" onClick={() => void rebuildBaseline()} loading={busy === 'baseline'}><RefreshCw className="size-4" /> بازسازی خط مبنا (پس از به‌روزرسانی)</Button>
              </>}
            </div>
            <p className="mt-2 text-[11px] leading-6 text-navy-500">
              اسکن یکپارچگی، فایل‌های برنامه را با خط مبنای SHA-256 مقایسه می‌کند. اسکن آپلودها امضای فایل‌های اجرایی/اسکریپت را می‌جوید؛ فایل ثبت‌نشدهٔ مشکوک قرنطینه می‌شود (بدون حذف). بررسی وابستگی‌ها از npm audit واقعی استفاده می‌کند و به‌روزرسانی خودکار انجام نمی‌دهد.
            </p>
          </Card>

          {deps && (
            <Card>
              <h3 className="mb-1 text-sm font-bold text-navy-900">گزارش آسیب‌پذیری وابستگی‌ها</h3>
              <p className="mb-3 text-[11px] text-navy-500">آخرین بررسی: {faDateTime(deps.checkedAt)} {deps.ok ? '' : `— ناموفق: ${deps.error ?? ''}`}</p>
              {deps.ok && deps.vulnerabilities.length === 0 && <p className="text-xs text-emerald-700">آسیب‌پذیری شناخته‌شده‌ای در وابستگی‌های نصب‌شده یافت نشد.</p>}
              {deps.vulnerabilities.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead><tr className="border-b border-line text-navy-500"><th className="p-2">بسته</th><th className="p-2">شدت</th><th className="p-2">محدودهٔ آسیب‌پذیر</th><th className="p-2">نسخهٔ امن پیشنهادی</th><th className="p-2">توضیح</th></tr></thead>
                    <tbody>
                      {deps.vulnerabilities.map((v) => (
                        <tr key={v.name} className="border-b border-line/60 align-top">
                          <td className="p-2 font-mono font-bold" dir="ltr">{v.name}{v.isDirect ? '' : ' (غیرمستقیم)'}</td>
                          <td className="p-2"><SeverityBadge severity={v.severity === 'high' || v.severity === 'critical' ? 'critical' : v.severity === 'moderate' ? 'warning' : 'info'} /></td>
                          <td className="p-2 font-mono text-[11px]" dir="ltr">{v.range}</td>
                          <td className="p-2 font-mono text-[11px]" dir="ltr">{typeof v.fixAvailable === 'object' ? `${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (تغییر عمده — بررسی سازگاری)' : ''}` : 'بررسی دستی'}</td>
                          <td className="max-w-sm p-2 leading-6 text-navy-600">{v.advisories[0]?.title ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <Card>
            <h3 className="mb-2 text-sm font-bold text-navy-900">تاریخچهٔ اسکن‌ها</h3>
            {scans.length === 0
              ? <EmptyState title="اسکنی اجرا نشده است" icon={<ScanLine className="size-8" />} />
              : <ul className="divide-y divide-line">
                  {scans.map((scan) => (
                    <li key={scan.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <span className="text-xs font-bold text-navy-800">{SCAN_LABEL[scan.kind] ?? scan.kind}</span>
                        <span className={clsx('mr-2 text-[11px] font-bold', scan.status === 'ok' ? 'text-emerald-700' : scan.status === 'failed' ? 'text-rose-700' : 'text-amber-700')}>{scan.status === 'ok' ? 'موفق' : scan.status === 'failed' ? 'ناموفق' : 'در حال اجرا'}</span>
                        <p className="text-[11px] text-navy-500">{faDateTime(scan.started_at)} · {scan.triggered_by === 'scheduler' ? 'خودکار' : scan.triggered_by}</p>
                        <p className="text-[11px] text-navy-400" dir="ltr">{JSON.stringify(scan.summary ?? {}).slice(0, 160)}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void openScan(scan.id)}><Eye className="size-4" /> جزئیات</Button>
                    </li>
                  ))}
                </ul>}
          </Card>
        </div>
      )}

      {tab === 'quarantine' && (
        <Card className="mt-4">
          <p className="mb-3 text-xs leading-6 text-navy-600">فایل‌های قرنطینه‌شده حذف نشده‌اند؛ فقط به فضای امن منتقل شده‌اند و با تأیید مدیر قابل بازگردانی‌اند.</p>
          {quarantine.length === 0
            ? <EmptyState title="قرنطینه خالی است" icon={<ArchiveRestore className="size-8" />} />
            : <ul className="divide-y divide-line">
                {quarantine.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <span className="block truncate font-mono text-xs font-bold text-navy-900" dir="ltr">{item.original_path}</span>
                      <p className="text-[11px] text-navy-500">{item.reason} · {faNum(item.size)} بایت · {faDateTime(item.created_at)}</p>
                      <p className="truncate font-mono text-[10px] text-navy-400" dir="ltr">SHA-256: {item.sha256}</p>
                    </div>
                    {manage && !item.restored_at && <Button size="sm" variant="ghost" onClick={() => void restore(item.id)}><ArchiveRestore className="size-4" /> بازگردانی</Button>}
                  </li>
                ))}
              </ul>}
        </Card>
      )}

      <Modal open={blockModal} onClose={() => setBlockModal(false)} title="مسدودسازی موقت IP" footer={
        <div className="flex gap-2">
          <Button onClick={() => void submitBlock()} loading={busy === 'block'} disabled={!blockIp.trim() || blockReason.trim().length < 3}>مسدود کن</Button>
          <Button variant="ghost" onClick={() => setBlockModal(false)}>انصراف</Button>
        </div>
      }>
        <div className="space-y-3">
          <Field label="نشانی IP" required><Input value={blockIp} onChange={(e) => setBlockIp(e.target.value)} placeholder="203.0.113.10" dir="ltr" /></Field>
          <Field label="دلیل" required><Input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="مثلاً: تلاش مکرر برای ورود غیرمجاز" /></Field>
          <Field label="مدت (دقیقه)"><Input type="number" min={1} max={1440} value={blockMinutes} onChange={(e) => setBlockMinutes(e.target.value)} /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(scanDetail)} onClose={() => setScanDetail(null)} title={scanDetail ? `جزئیات اسکن ${SCAN_LABEL[scanDetail.kind] ?? scanDetail.kind}` : ''} size="lg">
        {scanDetail && (
          <div className="space-y-3 text-xs">
            <p className="text-navy-600">وضعیت: {scanDetail.status} · شروع: {faDateTime(scanDetail.started_at)} {scanDetail.finished_at ? `· پایان: ${faDateTime(scanDetail.finished_at)}` : ''}</p>
            <pre className="max-h-40 overflow-auto rounded-lg bg-surface-3 p-2 text-[11px]" dir="ltr">{JSON.stringify(scanDetail.summary ?? {}, null, 2)}</pre>
            <div className="max-h-72 overflow-auto rounded-lg border border-line">
              <pre className="p-2 text-[11px] leading-5" dir="ltr">{JSON.stringify(scanDetail.findings ?? [], null, 2)}</pre>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
