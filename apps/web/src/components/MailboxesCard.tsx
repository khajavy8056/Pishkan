import { useCallback, useEffect, useState } from 'react';
import { Inbox, KeyRound, Mail, Plus, Power, Smartphone, Trash2 } from 'lucide-react';
import { api, ApiFailure } from '../lib/api';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, useToast } from './ui';
import { faDateTime } from '../lib/format';

interface Mailbox {
  id: string; address: string; local_part: string; domain: string;
  display_name: string | null; active: number; created_at: string;
}
interface MailStatus {
  status: { installed: boolean; running: boolean; domain: string; hostname: string; detail?: string };
  gmail: { domain: string; incoming: { host: string; port: number; security: string }; outgoing: { host: string; port: number; security: string }; username: string };
}

/**
 * Organizational mailboxes on the office's own domain. The real mail server is
 * provisioned on the VPS in the install phase; until then this card honestly
 * shows "not installed" and explains the next step. Once running, the admin can
 * create mailboxes and connect them to the Gmail Android app (IMAP/SMTP).
 */
export function MailboxesCard() {
  const { notify } = useToast();
  const [state, setState] = useState<MailStatus | null>(null);
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [localPart, setLocalPart] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [pwBox, setPwBox] = useState<Mailbox | null>(null);
  const [newPw, setNewPw] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([
        api.get<{ data: MailStatus }>('/api/mailboxes/status'),
        api.get<{ data: Mailbox[] }>('/api/mailboxes'),
      ]);
      setState(s.data);
      setBoxes(b.data);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری اطلاعات ایمیل ناموفق بود.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!localPart.trim() || password.length < 8) {
      notify('نام صندوق و رمز (حداقل ۸ نویسه) را وارد کنید.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/mailboxes', { localPart: localPart.trim(), password, displayName: displayName.trim() || undefined });
      notify('صندوق ساخته شد.');
      setLocalPart(''); setPassword(''); setDisplayName('');
      await load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ساخت صندوق ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (box: Mailbox) => {
    try {
      await api.put(`/api/mailboxes/${encodeURIComponent(box.address)}/active`, { active: box.active !== 1 });
      notify(box.active === 1 ? 'صندوق معلق شد.' : 'صندوق فعال شد.');
      await load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'تغییر وضعیت ناموفق بود.', 'error');
    }
  };

  const remove = async (box: Mailbox) => {
    if (!window.confirm(`صندوق ${box.address} حذف شود؟ ایمیل‌های آن از دسترس خارج می‌شود.`)) return;
    try {
      await api.delete(`/api/mailboxes/${encodeURIComponent(box.address)}`);
      notify('صندوق حذف شد.');
      await load();
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'حذف صندوق ناموفق بود.', 'error');
    }
  };

  const changePassword = async () => {
    if (!pwBox || newPw.length < 8) { notify('رمز باید حداقل ۸ نویسه باشد.', 'error'); return; }
    setBusy(true);
    try {
      await api.put(`/api/mailboxes/${encodeURIComponent(pwBox.address)}/password`, { password: newPw });
      notify('رمز صندوق تغییر کرد.');
      setPwBox(null); setNewPw('');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'تغییر رمز ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Card><Loading /></Card>;

  const status = state?.status;
  const gmail = state?.gmail;
  const ready = status?.installed && status?.running;

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold text-navy-900">
        <Inbox className="size-4 text-accent" /> صندوق‌های ایمیل سازمانی
      </h2>
      <p className="mb-3 text-[11px] leading-5 text-navy-500">
        صندوق‌هایی با پسوند دامنهٔ خودتان (مثلاً admin@office.ir) که در اپ Gmail اندروید هم ارسال و دریافت دارند.
        دامنه را در فیلد «دامنهٔ ایمیل سازمانی» بالا تنظیم کنید.
      </p>

      {!ready && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
          {status?.installed
            ? 'سرور ایمیل نصب شده اما در حال اجرا نیست. در پنل سرور (منوی ۱۴) یا با دستور pishkan-mail بررسی کنید.'
            : 'سرور ایمیل سازمانی هنوز روی سرور نصب نشده است. پس از تهیهٔ سرور و تنظیم DNS، در فاز نصب با دستور «pishkan-mail install --domain دامنه» راه‌اندازی می‌شود و این بخش فعال خواهد شد.'}
          {status?.detail ? <span className="block text-amber-600">{status.detail}</span> : null}
        </div>
      )}

      {ready && (
        <div className="mb-4 grid gap-2 rounded-xl bg-surface-3 p-3 sm:grid-cols-3">
          <Input value={localPart} onChange={(e) => setLocalPart(e.target.value)} placeholder="نام صندوق (مثلاً admin)" dir="ltr" className="text-left" />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="رمز (حداقل ۸ نویسه)" dir="ltr" className="text-left" />
          <div className="flex gap-2">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="نام نمایشی (اختیاری)" />
            <Button size="sm" loading={busy} onClick={create}><Plus className="size-4" /> ساخت</Button>
          </div>
          {status?.domain && <p className="text-[11px] text-navy-500 sm:col-span-3">نشانی کامل: <span dir="ltr">{localPart || '…'}@{status.domain}</span></p>}
        </div>
      )}

      {boxes.length === 0 ? (
        <EmptyState icon={<Mail className="size-6" />} title="صندوقی ساخته نشده" description={ready ? 'اولین صندوق سازمانی را بسازید.' : 'پس از راه‌اندازی سرور ایمیل، اینجا مدیریت می‌شوند.'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>نشانی</th><th>نام</th><th>وضعیت</th><th>ساخته‌شده</th><th>عملیات</th></tr></thead>
            <tbody>
              {boxes.map((box) => (
                <tr key={box.id}>
                  <td dir="ltr" className="text-left text-[12px] font-medium">{box.address}</td>
                  <td className="text-[11px]">{box.display_name || '—'}</td>
                  <td>{box.active === 1 ? <Badge tone="success">فعال</Badge> : <Badge tone="warning">معلق</Badge>}</td>
                  <td className="text-[11px]">{faDateTime(box.created_at)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button type="button" title={box.active === 1 ? 'تعلیق' : 'فعال‌سازی'} onClick={() => toggle(box)} className="grid size-7 place-items-center rounded-lg text-navy-500 transition hover:bg-surface-3 hover:text-navy-800">
                        <Power className="size-4" />
                      </button>
                      <button type="button" title="تغییر رمز" onClick={() => { setPwBox(box); setNewPw(''); }} className="grid size-7 place-items-center rounded-lg text-navy-500 transition hover:bg-surface-3 hover:text-navy-800">
                        <KeyRound className="size-4" />
                      </button>
                      <button type="button" title="حذف" onClick={() => remove(box)} className="grid size-7 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 hover:text-rose-700">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gmail && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold text-navy-800"><Smartphone className="size-4 text-accent" /> اتصال اپ Gmail اندروید</p>
          <p className="mb-2 text-[11px] leading-5 text-navy-500">
            در Gmail: Settings → Add account → <b>Other (IMAP)</b>. نام کاربری = نشانی کامل صندوق، رمز = همان رمز صندوق.
          </p>
          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            <div className="rounded-lg bg-surface px-3 py-2">
              <p className="font-semibold text-navy-700">دریافت (IMAP)</p>
              <p dir="ltr" className="text-left text-navy-500">{gmail.incoming.host} : {gmail.incoming.port} — {gmail.incoming.security}</p>
            </div>
            <div className="rounded-lg bg-surface px-3 py-2">
              <p className="font-semibold text-navy-700">ارسال (SMTP)</p>
              <p dir="ltr" className="text-left text-navy-500">{gmail.outgoing.host} : {gmail.outgoing.port} — {gmail.outgoing.security}</p>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!pwBox} onClose={() => setPwBox(null)} title={`تغییر رمز ${pwBox?.address ?? ''}`}>
        <Field label="رمز تازه">
          <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} dir="ltr" className="text-left" placeholder="حداقل ۸ نویسه" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPwBox(null)}>انصراف</Button>
          <Button loading={busy} onClick={changePassword}>ذخیره رمز</Button>
        </div>
      </Modal>
    </Card>
  );
}
