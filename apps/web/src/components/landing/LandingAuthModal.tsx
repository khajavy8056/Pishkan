import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserPlus,
  X,
} from 'lucide-react';
import { api, ApiFailure } from '../../lib/api';
import { homeFor, useAuth } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { useSite } from '../../lib/site';
import { useToast } from '../ui';
import { clearReferral, getReferral } from '../../pages/customer/Referrals';

export function LandingAuthModal({
  open,
  onClose,
  initialTab = 'login',
  nextPath,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: 'login' | 'register';
  nextPath?: string;
}) {
  const { site } = useSite();
  const brand = useBrand();
  const { refresh, setUser } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const otpEnabled = site?.authMethods?.otp ?? true;
  const passwordEnabled = site?.authMethods?.password ?? true;
  const registrationOpen = site?.authMethods?.registrationOpen ?? true;

  const [tab, setTab] = useState<'login' | 'register'>(initialTab);
  const [loginMode, setLoginMode] = useState<'otp' | 'password'>(() =>
    otpEnabled && !passwordEnabled ? 'otp' : 'password',
  );

  // OTP state
  const [mobile, setMobile] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
  const [countdown, setCountdown] = useState(0);
  const [debugCode, setDebugCode] = useState('');

  // Password state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // MFA state
  const [mfa, setMfa] = useState<{ token: string; mode: 'totp' | 'otp'; message: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // Register state
  const [regForm, setRegForm] = useState({ fullName: '', mobile: '', password: '' });
  const [referral] = useState(() => getReferral());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTab(initialTab);
    setError('');
  }, [initialTab, open]);

  useEffect(() => {
    if (otpEnabled && !passwordEnabled) setLoginMode('otp');
    else if (!otpEnabled && passwordEnabled) setLoginMode('password');
  }, [otpEnabled, passwordEnabled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  if (!open) return null;

  const finishAuth = async () => {
    let me = await refresh();
    if (!me) {
      await new Promise((r) => window.setTimeout(r, 180));
      me = await refresh();
    }
    if (!me) {
      setUser(null);
      setError('ورود پذیرفته شد اما نشست مرورگر تأیید نشد. کوکی‌ها را بررسی کنید.');
      return;
    }
    notify(`خوش آمدید ${me.fullName ?? ''}`, 'success');
    onClose();
    navigate(nextPath || homeFor(me), { replace: true });
  };

  const requestOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ data: { sent: boolean; debugCode?: string; resendIn: number; error?: string } }>(
        '/api/auth/otp/request',
        { mobile, kind: 'customer' },
      );
      setOtpStep('verify');
      setCountdown(res.data.resendIn ?? 60);
      setDebugCode(res.data.debugCode ?? '');
      if (res.data.sent) notify('کد تأیید ارسال شد.', 'success');
      else notify(res.data.error ?? 'ارسال پیامک انجام نشد.', 'error');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'خطا در ارسال کد');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<any>('/api/auth/otp/verify', {
        mobile,
        code: otpCode,
        kind: 'customer',
        ...(referral.trim() ? { referralCode: referral.trim() } : {}),
      });
      clearReferral();
      if (res.data?.mfaRequired) {
        setMfa({
          token: res.data.mfaToken,
          mode: 'totp',
          message: 'کد تأیید دومرحله‌ای را وارد کنید.',
        });
        return;
      }
      await finishAuth();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'کد وارد شده معتبر نیست');
    } finally {
      setLoading(false);
    }
  };

  const submitPasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<any>('/api/auth/customer/login', { identifier, password });
      if (res.data?.mfaRequired) {
        setMfa({ token: res.data.mfaToken, mode: res.data.mode, message: res.data.message });
        if (res.data.mode === 'otp') notify('کد تأیید به موبایل شما ارسال شد.', 'success');
        return;
      }
      clearReferral();
      await finishAuth();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'نام کاربری یا رمز عبور نادرست است');
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    setError('');
    setLoading(true);
    try {
      await api.post<any>('/api/auth/mfa/verify', { ticket: mfa.token, code: mfaCode, mode: mfa.mode });
      await finishAuth();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'کد تأیید صحیح نیست');
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<any>('/api/auth/register', {
        ...regForm,
        ...(referral.trim() ? { referralCode: referral.trim() } : {}),
      });
      clearReferral();
      if (res.data?.requiresVerification) {
        setMobile(regForm.mobile);
        setTab('login');
        setLoginMode('otp');
        setOtpStep('verify');
        notify('حساب ساخته شد. کد تأیید پیامک شد.', 'info');
        return;
      }
      await finishAuth();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'ثبت‌نام ناموفق بود');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ورود و ثبت‌نام"
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-slate-950/65 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="glass animate-pop relative z-10 w-full max-w-md overflow-hidden rounded-[2rem] border border-line-strong bg-surface/95 p-6 shadow-2xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 right-1/2 size-56 translate-x-1/2 rounded-full bg-cyan-400/20 blur-3xl"
        />

        <div className="relative flex items-center justify-between gap-3 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-brand-600 text-white shadow-lg shadow-cyan-500/30">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-black text-text">ورود به {brand.name}</h2>
              <p className="text-[11px] text-muted">ثبت و پیگیری آنی پرونده‌ها</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="lp-icon-btn"
          >
            <X className="size-4" />
          </button>
        </div>

        {mfa ? (
          <form onSubmit={submitMfa} className="relative space-y-4">
            <p className="text-xs leading-relaxed text-muted">{mfa.message}</p>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-text">کد تأیید</label>
              <input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                maxLength={8}
                className="w-full rounded-xl border border-line-strong bg-surface-2 px-4 py-2.5 text-center font-mono text-base tracking-[0.4em] text-text focus:border-cyan-400 focus:outline-none"
              />
            </div>
            {error ? <p className="text-xs font-bold text-rose-500">{error}</p> : null}
            <button type="submit" disabled={loading} className="lp-btn lp-btn-primary w-full py-3 text-sm">
              {loading ? 'در حال بررسی…' : 'تأیید و ورود'}
            </button>
            <button
              type="button"
              onClick={() => setMfa(null)}
              className="w-full text-center text-xs text-muted hover:text-text"
            >
              بازگشت
            </button>
          </form>
        ) : (
          <div className="relative">
            {registrationOpen ? (
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface-2 p-1">
                <button
                  type="button"
                  onClick={() => { setTab('login'); setError(''); }}
                  className={`rounded-xl py-2 text-xs font-extrabold transition ${
                    tab === 'login' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  ورود به حساب
                </button>
                <button
                  type="button"
                  onClick={() => { setTab('register'); setError(''); }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition ${
                    tab === 'register' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  <UserPlus className="size-3.5" />
                  ثبت‌نام سریع
                </button>
              </div>
            ) : null}

            {tab === 'login' ? (
              <div className="space-y-4">
                {otpEnabled && passwordEnabled ? (
                  <div className="flex gap-1 rounded-xl border border-line bg-surface-2/70 p-1">
                    <button
                      type="button"
                      onClick={() => { setLoginMode('otp'); setError(''); }}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition ${
                        loginMode === 'otp' ? 'bg-cyan-400/15 text-brand-text' : 'text-muted'
                      }`}
                    >
                      <Smartphone className="size-3.5" />
                      کد یک‌بارمصرف
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginMode('password'); setError(''); }}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition ${
                        loginMode === 'password' ? 'bg-cyan-400/15 text-brand-text' : 'text-muted'
                      }`}
                    >
                      <KeyRound className="size-3.5" />
                      رمز عبور
                    </button>
                  </div>
                ) : null}

                {loginMode === 'otp' && otpEnabled ? (
                  otpStep === 'request' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-text">شماره موبایل</label>
                        <input
                          value={mobile}
                          onChange={(e) => setMobile(e.target.value)}
                          placeholder="09123456789"
                          inputMode="tel"
                          dir="ltr"
                          className="w-full rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 text-left text-sm text-text placeholder:text-faint focus:border-cyan-400 focus:outline-none"
                        />
                      </div>
                      {error ? <p className="text-xs font-bold text-rose-500">{error}</p> : null}
                      <button
                        type="button"
                        onClick={requestOtp}
                        disabled={loading || mobile.replace(/\D/g, '').length < 10}
                        className="lp-btn lp-btn-primary w-full py-3 text-sm disabled:opacity-50"
                      >
                        {loading ? 'در حال ارسال…' : 'دریافت کد تأیید'}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={verifyOtp} className="space-y-3">
                      <p className="text-xs text-muted">
                        کد ارسال‌شده به <span dir="ltr" className="font-bold text-text">{mobile}</span> را وارد کنید.
                      </p>
                      <input
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        inputMode="numeric"
                        dir="ltr"
                        maxLength={8}
                        placeholder="------"
                        className="w-full rounded-xl border border-line-strong bg-surface-2 px-4 py-2.5 text-center font-mono text-lg tracking-[0.5em] text-text focus:border-cyan-400 focus:outline-none"
                      />
                      {debugCode ? (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-400/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-200">
                          <Info className="mt-0.5 size-3.5 shrink-0" />
                          <span>کد آزمایشی: <b dir="ltr">{debugCode}</b></span>
                        </div>
                      ) : null}
                      {error ? <p className="text-xs font-bold text-rose-500">{error}</p> : null}
                      <button
                        type="submit"
                        disabled={loading || otpCode.length < 4}
                        className="lp-btn lp-btn-primary w-full py-3 text-sm disabled:opacity-50"
                      >
                        {loading ? 'در حال ورود…' : 'تأیید و ورود'}
                      </button>
                      <div className="flex items-center justify-between text-[11px] text-muted">
                        <button type="button" onClick={() => { setOtpStep('request'); setOtpCode(''); }} className="hover:text-text">
                          تغییر شماره
                        </button>
                        <button
                          type="button"
                          disabled={countdown > 0 || loading}
                          onClick={requestOtp}
                          className="inline-flex items-center gap-1 text-brand-text disabled:opacity-50"
                        >
                          <RefreshCw className="size-3" />
                          {countdown > 0 ? `ارسال مجدد (${countdown})` : 'ارسال مجدد'}
                        </button>
                      </div>
                    </form>
                  )
                ) : (
                  <form onSubmit={submitPasswordLogin} className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-text">نام کاربری، موبایل یا ایمیل</label>
                      <input
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        dir="ltr"
                        autoComplete="username"
                        required
                        className="w-full rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 text-left text-sm text-text focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-bold text-text">رمز عبور</label>
                        <Link to="/reset-password" onClick={onClose} className="text-[11px] font-semibold text-brand-text hover:underline">
                          فراموشی رمز؟
                        </Link>
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          dir="ltr"
                          autoComplete="current-password"
                          required
                          className="w-full rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 pl-10 text-left text-sm text-text focus:border-cyan-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'پنهان کردن رمز' : 'نمایش رمز'}
                          className="absolute inset-y-0 left-2.5 grid place-items-center text-muted hover:text-text"
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    {error ? <p className="text-xs font-bold text-rose-500">{error}</p> : null}
                    <button type="submit" disabled={loading} className="lp-btn lp-btn-primary w-full py-3 text-sm">
                      {loading ? 'در حال ورود…' : 'ورود به حساب'}
                      <ArrowLeft className="size-4" />
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <form onSubmit={submitRegister} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-text">نام و نام خانوادگی</label>
                  <input
                    value={regForm.fullName}
                    onChange={(e) => setRegForm((p) => ({ ...p, fullName: e.target.value }))}
                    required
                    className="w-full rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-text focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-text">شماره موبایل</label>
                  <input
                    value={regForm.mobile}
                    onChange={(e) => setRegForm((p) => ({ ...p, mobile: e.target.value }))}
                    placeholder="09123456789"
                    inputMode="tel"
                    dir="ltr"
                    required
                    className="w-full rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 text-left text-sm text-text focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-text">رمز عبور</label>
                  <input
                    type="password"
                    value={regForm.password}
                    onChange={(e) => setRegForm((p) => ({ ...p, password: e.target.value }))}
                    dir="ltr"
                    required
                    minLength={6}
                    className="w-full rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 text-left text-sm text-text focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                {error ? <p className="text-xs font-bold text-rose-500">{error}</p> : null}
                <button type="submit" disabled={loading} className="lp-btn lp-btn-gold w-full py-3 text-sm">
                  {loading ? 'در حال ساخت حساب…' : 'ایجاد حساب و ادامه'}
                </button>
              </form>
            )}

            <div className="mt-5 flex items-center justify-between border-t border-line pt-3.5 text-[11px] text-muted">
              <Link to="/login-admin" onClick={onClose} className="inline-flex items-center gap-1 hover:text-text">
                <LockKeyhole className="size-3.5" />
                ورود کارکنان
              </Link>
              <Link to="/login" onClick={onClose} className="font-semibold text-brand-text hover:underline">
                صفحهٔ کامل ورود
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
