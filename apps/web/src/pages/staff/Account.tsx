import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, PageHeader } from '../../components/shell';
import { Card, Button, Field, Input, useToast } from '../../components/ui';
import { EmailVerification, EmailAlarmPrefs } from '../../components/email-card';
import { useAuth } from '../../lib/auth';
import { api, ApiFailure } from '../../lib/api';

/**
 * The staff/admin account page: email ownership, personal email alarm
 * preferences and password change — the same controls customers get, through
 * the same account-scoped endpoints.
 */
export function StaffAccount() {
  const { user, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    setBusy(true);
    try {
      await api.post('/api/auth/password/change', passwords);
      notify('رمز عبور تغییر کرد. دوباره وارد شوید.', 'success');
      await logout();
      navigate('/login-admin');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'خطا', 'error');
    } finally { setBusy(false); }
  };

  return (
    <AppShell variant="staff">
      <PageHeader title="حساب کاربری من" description="ایمیل، اعلان‌های ایمیلی و رمز عبور خود را مدیریت کنید." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-bold text-navy-900">ایمیل و تأیید مالکیت</h2>
          <EmailVerification />
          <p className="text-xs leading-6 text-navy-500">
            نام کاربری: <b dir="ltr">{user?.username ?? '-'}</b>
            <br />
            برای تغییر نشانی ایمیل، از مدیر کل بخواهید آن را در «افراد → ویرایش کارمند» به‌روز کند؛ پس از تغییر، تأیید دوباره لازم است.
          </p>
        </Card>
        <Card>
          <h2 className="mb-2 font-bold text-navy-900">اعلان‌های ایمیلی من</h2>
          <p className="mb-3 text-xs text-navy-500">مشخص کنید کدام هشدارها به ایمیل شما ارسال شوند.</p>
          <EmailAlarmPrefs />
        </Card>
        <Card>
          <h2 className="mb-4 font-bold text-navy-900">تغییر رمز عبور</h2>
          <div className="space-y-4">
            <Field label="رمز عبور فعلی" required>
              <Input type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} dir="ltr" className="text-left" autoComplete="current-password" />
            </Field>
            <Field label="رمز عبور جدید" hint="حداقل ۱۰ کاراکتر شامل حرف و رقم." required>
              <Input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} dir="ltr" className="text-left" autoComplete="new-password" />
            </Field>
            <Button loading={busy} onClick={changePassword}>تغییر رمز عبور</Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
