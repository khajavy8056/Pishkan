import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, GitBranch, HardDrive, Play, RefreshCw, ShieldCheck, Terminal,
} from 'lucide-react';
import { AppShell, PageHeader } from '../../components/shell';
import { Button, Card, Loading, Modal, StatusBadge, useToast } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { faDateTime, faNum } from '../../lib/format';

/**
 * «به‌روزرسانی سامانه» — the panel's update button.
 *
 * It is a *viewer* for `scripts/pishkan`, not a new updater: the server already
 * knew how to back up, install one verified commit, migrate, swap the symlink and
 * roll itself back. What was missing was a way for the office to see that state
 * and press the button without SSH. So this page reads, and then asks the API to
 * run the one command it is allowed to run.
 *
 * Two UI rules follow from how the grant is built:
 *  * there is no field for a repo address, a branch or a commit — the install
 *    decides all three, and the sudoers grant only permits "the tip of the
 *    configured branch". A text box here would be a promise the server cannot
 *    keep.
 *  * when the mode is not `privileged`, the button is replaced by the reason and
 *    the one-time fix. No greyed-out lie, no "updated!" that updated nothing.
 */

type Check = {
  ok: boolean;
  mode: 'privileged' | 'read-only' | 'unavailable';
  installed?: { version: string; release: string; commit: string };
  target?: { repo: string; branch: string; commit: string; pinnedCommit: string };
  available?: boolean;
  latestVersion?: string;
  safety?: { backupEnabled: boolean; keepReleases: number; freeMb: number; rootRequired: boolean };
  error?: string;
  hint?: string;
};

type Job = {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';
  startedAt?: string;
  finishedAt?: string;
  lines: string[];
};

const short = (value?: string) => (value && value.length > 12 ? `${value.slice(0, 12)}…` : value || '—');

export function AdminSystemUpdate() {
  const { notify } = useToast();
  const { can } = useAuth();
  // `system.edit`, not `system.view`: reading the version is harmless, replacing the
  // code that runs the business is not, and the two are separate grants on purpose.
  const canApply = can('system.edit');
  const [check, setCheck] = useState<Check | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: Check }>('/api/system/update/check');
      setCheck(res.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خواندن وضعیت به‌روزرسانی ممکن نشد.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  // Poll the job while it runs. The transcript is a file on the server, so this
  // keeps working after the API restarts under it — which a successful update does
  // on purpose, and is exactly the moment a websocket-only design would go dark.
  useEffect(() => {
    if (job?.status !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const res = await api.get<{ data: Job }>(`/api/system/update/job/${job.id}`);
        setJob(res.data);
        if (res.data.status !== 'running') void load();
      } catch { /* the service is restarting; the next tick will find it */ }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [job, load]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.lines.length]);

  const apply = async () => {
    setStarting(true);
    try {
      const res = await api.post<{ data: Job }>('/api/system/update/start', {});
      setJob(res.data);
      setConfirmOpen(false);
      notify('به‌روزرسانی آغاز شد. تا پایان، سامانه ممکن است برای یک دقیقه در دسترس نباشد.', 'info');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'آغاز به‌روزرسانی ممکن نشد.', 'error');
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <AppShell variant="admin"><Loading /></AppShell>;

  const safety = check?.safety;
  const blocked = check?.mode !== 'privileged' || !check?.available;
  const state = job?.status ?? (check?.available ? 'idle' : 'current');

  return (
    <AppShell variant="admin">
      <PageHeader
        eyebrow="سامانه"
        title="به‌روزرسانی از مخزن"
        description="نسخهٔ تازه روی سرور نصب و پس از بررسی سلامت فعال می‌شود؛ اگر سالم نباشد، خودش به نسخهٔ قبل برمی‌گردد."
        actions={(
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw className="size-4" /> بررسی دوباره
          </Button>
        )}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-navy-500" />
              <h3 className="text-sm font-bold text-navy-900">
                نسخهٔ نصب‌شده: {check?.installed?.version || '—'}
              </h3>
              <StatusBadge status={check?.available ? 'warning' : 'active'} label={check?.available ? 'نسخهٔ تازه موجود است' : 'به‌روز'} />
            </div>
            <span className="text-[11px] text-navy-400">شاخهٔ فعال: {check?.target?.branch || 'main'}</span>
          </div>

          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-surface-3 p-3">
              <dt className="text-navy-500">commit نصب‌شده</dt>
              <dd className="mt-1 font-mono text-[12px] text-navy-900">{short(check?.installed?.commit)}</dd>
            </div>
            <div className="rounded-xl bg-surface-3 p-3">
              <dt className="text-navy-500">تازه‌ترین commit مخزن</dt>
              <dd className="mt-1 font-mono text-[12px] text-navy-900">{short(check?.target?.commit)}</dd>
            </div>
            {check?.latestVersion && (
              <div className="rounded-xl bg-surface-3 p-3">
                <dt className="text-navy-500">تازه‌ترین نسخهٔ برچسب‌شده</dt>
                <dd className="mt-1 font-bold text-navy-900">{check.latestVersion}</dd>
              </div>
            )}
            <div className="rounded-xl bg-surface-3 p-3">
              <dt className="text-navy-500">آخرین release</dt>
              <dd className="mt-1 font-mono text-[12px] text-navy-900">{check?.installed?.release || '—'}</dd>
            </div>
          </dl>

          {check?.target?.pinnedCommit && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              این نصب روی یک commit ثابت قفل شده است ({short(check.target.pinnedCommit)}). تا وقتی این قفل هست،
              «pishkan update» همان commit را نصب می‌کند؛ برای آزاد کردنش از سرور:
              <span className="font-mono">PISHKAN_COMMIT</span> را از فایل تنظیمات بردارید.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canApply && (
              <Button onClick={() => setConfirmOpen(true)} disabled={blocked || starting || job?.status === 'running'}>
                <Play className="size-4" /> به‌روزرسانی سامانه
              </Button>
            )}
            {job?.status === 'running' && (
              <span className="flex items-center gap-2 text-xs text-navy-600">
                <span className="size-2 animate-pulse rounded-full bg-brand-600" /> در حال اجرا…
              </span>
            )}
            {!check?.available && check?.mode === 'privileged' && (
              <span className="text-xs text-navy-500">چیزی برای نصب نیست؛ همین commit تازه‌ترین است.</span>
            )}
          </div>

          {check && check.mode !== 'privileged' && (
            <div className="mt-4 rounded-xl border border-line bg-surface-3 p-3 text-xs leading-6 text-navy-700">
              <p className="flex items-start gap-2 font-bold text-navy-900">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-navy-500" />
                به‌روزرسانی از این پنل روی این سرور فعال نیست
              </p>
              <p className="mt-1.5">{check.hint ?? 'اسکریپت مدیریت نصب در دسترس نیست.'}</p>
              <p className="mt-1.5 text-navy-500">
                وضعیت و همین صفحه با اجرا کردن همان دستور روی سرور هم درست کار می‌کند؛ چیزی در این‌جا ساختگی نیست.
              </p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="flex items-center gap-2 text-sm font-bold text-navy-900">
              <ShieldCheck className="size-4 text-emerald-600" /> ایمنی این مسیر
            </h3>
            <ul className="mt-3 space-y-2 text-xs leading-6 text-navy-700">
              {[
                'پیش از هر چیز، یک پشتیبان کامل از پایگاه داده و مدارک گرفته می‌شود؛ بدون آن به‌روزرسانی آغاز نمی‌شود.',
                'فقط یک commit کامل و تأییدشده نصب می‌شود — نه «آخرین تغییرات هرچه هست».',
                'مهاجرت‌های پایگاه داده پیش از فعال‌سازی اجرا می‌شوند؛ اگر خطا بدهند، نسخهٔ فعلی دست‌نخورده می‌ماند.',
                'سرویس پس از سوییچ بررسی سلامت می‌شود؛ سالم نباشد، خودش به نسخهٔ قبل برمی‌گردد.',
                `${faNum(safety?.keepReleases ?? 0)} نسخهٔ آخر نگه داشته می‌شود تا «pishkan rollback» معنی داشته باشد.`,
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-emerald-600" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {safety && (
              <p className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[11px] text-navy-500">
                <HardDrive className="size-3.5" />
                فضای آزاد دیسک: {faNum(Math.round(safety.freeMb / 1024))} گیگابایت
                {safety.backupEnabled === false && ' — پشتیبان خودکار خاموش است'}
              </p>
            )}
            {safety?.backupEnabled === false && (
              <p className="mt-2 rounded-lg bg-rose-50 p-2 text-[11px] leading-5 text-rose-900">
                اسکریپت نصب، پیش از به‌روزرسانی پشتیبان می‌گیرد؛ اما برای اینکه پشتیبان شبانه هم فعال باشد،
                «پشتیبان‌گیری خودکار» را در تنظیمات استقرار روشن کنید.
              </p>
            )}
          </Card>

          <Card>
            <h3 className="flex items-center gap-2 text-sm font-bold text-navy-900">
              <Terminal className="size-4 text-navy-500" /> خروجی به‌روزرسانی
            </h3>
            <div ref={logRef} className="mt-3 max-h-72 overflow-y-auto rounded-xl bg-navy-950 p-3 text-[11px] leading-6 text-emerald-100">
              {job?.lines?.length
                ? job.lines.map((line, index) => <div key={`${line}-${index}`} className="whitespace-pre-wrap break-words">{line}</div>)
                : <p className="text-navy-300">هنوز به‌روزرسانی‌ای از این پنل آغاز نشده است.</p>}
            </div>
            {job?.startedAt && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-navy-500">
                <Clock className="size-3" /> {faDateTime(job.startedAt)} — وضعیت: {job.status}
              </p>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="به‌روزرسانی سامانه"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>انصراف</Button>
            <Button onClick={apply} disabled={starting}>
              {starting ? 'در حال آغاز…' : 'پشتیبان بگیر و به‌روزرسانی کن'}
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-7 text-navy-700">
          از {check?.installed?.version || 'نسخهٔ فعلی'} ({short(check?.installed?.commit)}) به commit{' '}
          {short(check?.target?.commit)} شاخهٔ {check?.target?.branch || 'main'} می‌روید.
        </p>
        <ul className="mt-3 space-y-1.5 text-xs leading-6 text-navy-600">
          <li>• پشتیبان کامل، پیش از هر تغییر، گرفته می‌شود و اگر گرفتنش ناموفق باشد کاری انجام نمی‌شود.</li>
          <li>• در زمان سوییچ، سرویس یک‌بار راه‌اندازی مجدد می‌شود؛ معمولاً کمتر از یک دقیقه.</li>
          <li>• اگر نسخهٔ تازه سالم نباشد، به‌طور خودکار به همین نسخهٔ فعلی بازمی‌گردد.</li>
          <li>• دادهٔ مشتری‌ها، فاکتورها و مدارک در این مسیر حذف یا بازنویسی نمی‌شوند.</li>
        </ul>
        <p className="mt-3 text-[11px] leading-6 text-navy-500">
          انتخاب commit مشخص از پنل ممکن نیست — عمداً: مجوزی که به این دکمه داده شده فقط «تازه‌ترین commit
          همین شاخه» را اجازه می‌دهد. برای یک نسخهٔ خاص، روی سرور: <span className="font-mono">sudo pishkan update --ref &lt;SHA&gt;</span>
        </p>
      </Modal>
    </AppShell>
  );
}
