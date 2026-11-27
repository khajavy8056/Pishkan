import { useEffect, useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, ApiFailure } from '../lib/api';
import { Button, Input, useToast } from './ui';

/**
 * Email ownership verification + the person's own email alarm preferences.
 * Shared by the customer profile and the staff account page so both audiences
 * get exactly the same controls, backed by the same account-scoped endpoints.
 */
export function EmailVerification() {
  const { user, refresh } = useAuth();
  const { notify } = useToast();
  const [requested, setRequested] = useState(false);
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user?.email) {
    return <p className="mb-4 text-xs text-navy-500">برای دریافت ایمیل‌های سامانه (بازیابی رمز، اعلان‌ها)، ایمیل خود را در فرم زیر ثبت و ذخیره کنید.</p>;
  }
  if (user.emailVerified) {
    return <p className="mb-4 flex items-center gap-1.5 text-xs text-accent"><ShieldCheck className="size-3.5" /> مالکیت ایمیل <b dir="ltr">{user.email}</b> تأیید شده است.</p>;
  }
  return (
    <div className="mb-5 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="flex items-center gap-1.5"><Mail className="size-4 shrink-0" /> ایمیل <b dir="ltr">{user.email}</b> هنوز تأیید نشده است. با تأیید، بازیابی رمز و اعلان‌های ایمیلی مطمئن‌تر می‌شود.</p>
      {!requested ? (
        <Button variant="ghost" loading={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.post('/api/auth/email/verify/request', {});
            setRequested(true);
            notify('کد و لینک تأیید به ایمیل شما ارسال شد.', 'success');
          } catch (e) { notify(e instanceof ApiFailure ? e.message : 'ارسال ناموفق بود', 'error'); } finally { setBusy(false); }
        }}>ارسال کد تأیید به ایمیل</Button>
      ) : (
        <div className="flex gap-2">
          <Input aria-label="کد تأیید ایمیل" inputMode="numeric" maxLength={6} value={proof} onChange={(e) => setProof(e.target.value)} dir="ltr" className="text-center tracking-[0.3em]" placeholder="------" />
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post('/api/auth/email/verify/confirm', { proof });
              await refresh();
              notify('ایمیل شما تأیید شد.', 'success');
            } catch (e) { notify(e instanceof ApiFailure ? e.message : 'تأیید ناموفق بود', 'error'); } finally { setBusy(false); }
          }}>تأیید</Button>
        </div>
      )}
    </div>
  );
}

interface EmailPrefs {
  emailEnabled: boolean;
  tickets: boolean;
  cases: boolean;
  payments: boolean;
  security: boolean;
  announcements: boolean;
}

const PREF_LABELS: { key: keyof Omit<EmailPrefs, 'emailEnabled'>; label: string; hint: string }[] = [
  { key: 'tickets', label: 'تیکت‌های پشتیبانی', hint: 'ثبت تیکت، پاسخ تازه و حل‌شدن' },
  { key: 'cases', label: 'پرونده‌ها و درخواست‌ها', hint: 'تغییر وضعیت و مراحل پرونده' },
  { key: 'payments', label: 'پرداخت‌ها', hint: 'رسید و وضعیت پرداخت' },
  { key: 'security', label: 'هشدارهای امنیتی', hint: 'هشدارهای گارد و پایش (مدیران)' },
  { key: 'announcements', label: 'اعلان‌های عمومی', hint: 'رویدادهای تازهٔ حساب' },
];

/** «کدام هشدارها به ایمیل من برسد» — the per-person alarm switches. */
export function EmailAlarmPrefs() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get<{ data: EmailPrefs }>('/api/notifications/email-prefs')
      .then((res) => { if (alive) setPrefs(res.data); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!prefs) return null;

  const toggle = async (key: keyof EmailPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setBusy(true);
    try {
      const res = await api.put<{ data: EmailPrefs }>('/api/notifications/email-prefs', { [key]: next[key] });
      setPrefs(res.data);
    } catch (e) {
      setPrefs(prefs);
      notify(e instanceof ApiFailure ? e.message : 'ذخیره ناموفق بود', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
        <span className="text-sm font-semibold text-navy-900">دریافت ایمیل‌های سامانه</span>
        <input type="checkbox" className="size-4 accent-teal-700" checked={prefs.emailEnabled} disabled={busy} onChange={() => toggle('emailEnabled')} />
      </label>
      {prefs.emailEnabled && PREF_LABELS.map(({ key, label, hint }) => (
        <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line p-3">
          <span>
            <span className="block text-sm text-navy-800">{label}</span>
            <span className="block text-[11px] text-navy-400">{hint}</span>
          </span>
          <input type="checkbox" className="size-4 accent-teal-700" checked={prefs[key]} disabled={busy} onChange={() => toggle(key)} />
        </label>
      ))}
      {!user?.email && <p className="text-[11px] text-amber-700">برای اثرگذاری این تنظیمات، ابتدا ایمیل خود را در پروفایل ثبت کنید.</p>}
    </div>
  );
}
