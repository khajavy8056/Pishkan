import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone, KeyRound, ArrowRight, ShieldCheck, Eye, EyeOff, RefreshCw, Info, LogOut, Headset, Zap, LockKeyhole } from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { useSite } from '../../lib/site';
import { useAuth, homeFor, safeNextPath, type CurrentUser } from '../../lib/auth';
import { useBrand, BrandLockup, BrandMark } from '../../lib/brand';
import { api, ApiFailure } from '../../lib/api';
import { clearReferral, getReferral, saveReferral } from '../customer/Referrals';
import { Button, Field, Input, useToast } from '../../components/ui';

type Audience = 'customer' | 'staff';

function audienceMatches(audience: Audience, user: CurrentUser | null): boolean {
  if (!user) return false;
  return audience === 'customer' ? user.kind === 'customer' : user.kind !== 'customer';
}

/**
 * One login engine, two strictly separated doors. The customer door only
 * ever calls the customer endpoints (which only accept customer accounts);
 * the staff door only calls the staff endpoints. A session from the other
 * door is never silently reused — the visitor is told and can switch.
 */
function LoginPanel({ audience }: { audience: Audience }) {
  const { site } = useSite();
  const { user, refresh, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { notify } = useToast();
  const next = safeNextPath(params.get('next'), audience);

  const otpEnabled = audience === 'staff' ? Boolean(site?.authMethods.staffOtp) : (site?.authMethods.otp ?? false);
  const passwordEnabled = audience === 'staff' ? true : (site?.authMethods.password ?? false);
  const [mode, setMode] = useState<'otp' | 'password'>('password');

  useEffect(() => {
    if (otpEnabled && !passwordEnabled) setMode('otp');
    else if (!otpEnabled && passwordEnabled) setMode('password');
  }, [otpEnabled, passwordEnabled]);

  const [referral, setReferral] = useState(() => getReferral());
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [countdown, setCountdown] = useState(0);
  const [debugCode, setDebugCode] = useState('');
  const [mfa, setMfa] = useState<{ token: string; mode: 'totp' | 'otp'; message: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && audienceMatches(audience, user)) navigate(next ?? homeFor(user), { replace: true });
  }, [user, audience, next, navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const afterLogin = async () => {
    // Do not open a protected panel based only on the login response: the
    // browser must send the session cookie back successfully first.
    let authenticated = await refresh();
    if (!authenticated) {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      authenticated = await refresh();
    }
    if (!authenticated) {
      setUser(null);
      setError('ورود پذیرفته شد، اما نشست مرورگر تأیید نشد. کوکی‌های این سایت را فعال کنید و دوباره وارد شوید.');
      return;
    }
    if (!audienceMatches(audience, authenticated)) {
      // The server doors already guarantee this; kept as a hard client-side wall.
      setError(audience === 'customer'
        ? 'این درگاه مخصوص مشتریان است و این حساب مشتری نیست.'
        : 'این درگاه مخصوص کارکنان است و این حساب کارمندی نیست.');
      return;
    }
    notify(`خوش آمدید ${authenticated.fullName ?? ''}`, 'success');
    navigate(next ?? homeFor(authenticated), { replace: true });
  };

  const requestOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ data: { sent: boolean; debugCode?: string; resendIn: number; error?: string } }>('/api/auth/otp/request', { mobile, kind: audience });
      setStep('verify');
      setCountdown(res.data.resendIn ?? 60);
      setDebugCode(res.data.debugCode ?? '');
      if (res.data.sent) notify('کد تأیید ارسال شد.', 'success');
      else notify(res.data.error ?? 'ارسال پیامک انجام نشد؛ با پشتیبانی تماس بگیرید.', 'error');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'خطا در ارسال کد');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post<any>('/api/auth/otp/verify', { mobile, code, kind: audience, ...(audience === 'customer' && referral.trim() ? { referralCode: referral.trim() } : {}) });
      if (audience === 'customer') clearReferral();
      if (res.data.mfaRequired) { setMfa({ token: res.data.mfaToken, mode: 'totp', message: 'کد برنامه تأیید دومرحله‌ای را وارد کنید.' }); return; }
      await afterLogin();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'کد وارد شده معتبر نیست');
    } finally {
      setLoading(false);
    }
  };

  const passwordLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post<any>(`/api/auth/${audience}/login`, { identifier, password });
      if (res.data?.mfaRequired) {
        setMfa({ token: res.data.mfaToken, mode: res.data.mode, message: res.data.message });
        if (res.data.mode === 'otp') notify('کد تأیید به موبایل شما ارسال شد.', 'success');
        return;
      }
      if (audience === 'customer') clearReferral();
      await afterLogin();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'ورود ناموفق بود');
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async () => {
    if (!mfa) return;
    setLoading(true);
    setError('');
    try {
      await api.post<any>('/api/auth/mfa/verify', { ticket: mfa.token, code: mfaCode, mode: mfa.mode });
      await afterLogin();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'کد تأیید صحیح نیست');
    } finally {
      setLoading(false);
    }
  };

  if (user && !audienceMatches(audience, user)) {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl bg-amber-50 p-4 text-sm leading-7 text-amber-900 ring-1 ring-amber-200">
          {audience === 'customer' ? (
            <>شما هم‌اکنون با حساب <b>کارکنان</b> ({user.fullName}) وارد شده‌اید. این صفحه فقط برای ورود <b>مشتریان</b> است؛ حساب کارکنان از این درگاه وارد نمی‌شود.</>
          ) : (
            <>شما هم‌اکنون با حساب <b>مشتری</b> ({user.fullName}) وارد شده‌اید. این درگاه فقط برای <b>کارکنان و مدیران</b> دفتر است.</>
          )}
        </div>
        <Link to={homeFor(user)} className="btn-primary w-full">رفتن به پنل من</Link>
        <button
          type="button"
          className="btn-ghost w-full"
          onClick={async () => { await logout(); notify('از حساب خارج شدید؛ حالا می‌توانید وارد شوید.', 'info'); }}
        >
          <LogOut className="size-4" /> خروج و ورود با حساب دیگر
        </button>
      </div>
    );
  }

  if (mfa) {
    return (
      <div>
        <h2 className="text-lg font-bold text-navy-900">تأیید دومرحله‌ای</h2>
        <p className="mt-1 text-sm text-navy-500">{mfa.message}</p>
        <div className="mt-5 space-y-4">
          <Field label="کد تأیید">
            <Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" dir="ltr" className="text-center tracking-[0.5em]" maxLength={8} />
          </Field>
          {error && <p className="text-xs text-rose-700">{error}</p>}
          <Button className="w-full" loading={loading} onClick={submitMfa}>تأیید و ورود</Button>
          <button className="w-full text-xs text-navy-500 hover:text-navy-800" onClick={() => setMfa(null)}>بازگشت</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-2xl bg-surface-3 p-1">
        {otpEnabled && (
          <button onClick={() => { setMode('otp'); setError(''); }} className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm transition', mode === 'otp' ? 'bg-surface font-bold text-navy-900 shadow-sm' : 'text-navy-600')} aria-pressed={mode === 'otp'}>
            <Smartphone className="size-4" /> کد یک‌بارمصرف
          </button>
        )}
        {passwordEnabled && (
          <button onClick={() => { setMode('password'); setError(''); }} className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm transition', mode === 'password' ? 'bg-surface font-bold text-navy-900 shadow-sm' : 'text-navy-600')} aria-pressed={mode === 'password'}>
            <KeyRound className="size-4" /> نام کاربری و رمز
          </button>
        )}
        {!otpEnabled && !passwordEnabled && (
          <p className="px-3 py-2 text-sm text-amber-700">روش ورود توسط مدیر سامانه غیرفعال شده است. با دفتر تماس بگیرید.</p>
        )}
      </div>

      {mode === 'otp' && otpEnabled && (
        <div className="space-y-4">
          {step === 'request' ? (
            <>
              {audience === 'customer' && <Field label="کد دعوت (اختیاری)" hint="فقط هنگام ساخت حساب جدید اعمال می‌شود."><Input value={referral} onChange={e=>{setReferral(e.target.value); if(e.target.value) saveReferral(e.target.value); else clearReferral();}} dir="ltr" /></Field>}
              <Field label="شماره موبایل" hint="کد تأیید به همین شماره ارسال می‌شود." required>
                <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="09123456789" inputMode="tel" dir="ltr" className="text-left" />
              </Field>
              {error && <p className="text-xs text-rose-700">{error}</p>}
              <Button className="w-full" loading={loading} onClick={requestOtp} disabled={mobile.replace(/\D/g, '').length < 10}>
                دریافت کد تأیید
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-navy-600">کد ارسال‌شده به <span dir="ltr" className="font-medium">{mobile}</span> را وارد کنید.</p>
              <Field label="کد تأیید" required>
                <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" dir="ltr" className="text-center text-lg tracking-[0.5em]" maxLength={8} />
              </Field>
              {debugCode && (
                <div className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>حالت توسعه: پیامک واقعی ارسال نشده است. کد آزمایشی: <b dir="ltr">{debugCode}</b></span>
                </div>
              )}
              {error && <p className="text-xs text-rose-700">{error}</p>}
              <Button className="w-full" loading={loading} onClick={verifyOtp} disabled={code.length < 4}>ورود</Button>
              <div className="flex items-center justify-between text-xs">
                <button className="text-navy-500 hover:text-navy-800" onClick={() => { setStep('request'); setCode(''); }}>تغییر شماره</button>
                <button className="flex items-center gap-1 text-accent hover:underline disabled:text-navy-400" disabled={countdown > 0 || loading} onClick={requestOtp}>
                  <RefreshCw className="size-3.5" />
                  {countdown > 0 ? `ارسال مجدد در ${countdown} ثانیه` : 'ارسال مجدد کد'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'password' && passwordEnabled && (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void passwordLogin(); }}>
          <Field label={audience === 'staff' ? 'نام کاربری یا موبایل' : 'نام کاربری، موبایل یا ایمیل'} required>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} dir="ltr" className="text-left" autoComplete="username" />
          </Field>
          <Field label="رمز عبور" required>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
                className="text-left pl-10"
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-navy-400 hover:bg-surface-3" aria-label="نمایش رمز">
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          {error && <p className="text-xs text-rose-700">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>ورود</Button>
          {audience === 'customer' && site?.authMethods.passwordReset && (
            <Link to="/reset-password" className="block text-center text-xs text-navy-500 hover:text-navy-800">رمز عبور خود را فراموش کرده‌اید؟</Link>
          )}
        </form>
      )}
    </div>
  );
}

/** Customer door — the only login linked from the public site. */
export function LoginPage() {
  const { site, setting } = useSite();
  const brand = useBrand();

  return (
    <PublicLayout>
      <section className="hero-sky">
        <div className="mx-auto grid max-w-6xl items-stretch gap-6 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:py-14">
          <div className="relative hidden overflow-hidden rounded-[2rem] shadow-2xl shadow-brand-900/20 ring-1 ring-white/40 lg:block">
            <img src={brand.heroImage} alt={brand.name} className="absolute inset-0 size-full object-cover" />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#071528]/88 via-[#071528]/30 to-transparent" />
            <div className="relative flex h-full flex-col justify-end p-8 text-white">
              <BrandLockup tone="light" />
              <p className="mt-5 max-w-sm text-sm leading-7 text-white/85">
                {setting('site.welcome_message') || 'با ورود به حساب، درخواست‌های خود را ثبت و پیگیری کنید، فاکتورها را ببینید و با کارشناس دفتر در ارتباط باشید.'}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="glass-chip animate-floaty"><ShieldCheck className="size-4 text-emerald-600" /> امن و معتبر</span>
                <span className="glass-chip animate-floaty-delay"><Zap className="size-4 text-amber-500" /> سریع و آسان</span>
                <span className="glass-chip animate-floaty-slow"><Headset className="size-4 text-sky-600" /> پشتیبانی حرفه‌ای</span>
              </div>
            </div>
          </div>

          <div className="card card-pad mx-auto w-full max-w-lg self-center lg:mx-0">
            <div className="mb-6 text-center">
              <div className="mb-3 flex justify-center lg:hidden"><BrandMark className="size-14" /></div>
              <h1 className="text-xl font-black text-navy-900">ورود مشتریان</h1>
              <p className="mt-1.5 text-xs leading-6 text-navy-500">
                خوش برگشتید! برای ادامه وارد حساب مشتری خود در {brand.shortName} شوید.
              </p>
            </div>

            <LoginPanel audience="customer" />

            {site?.authMethods.registrationOpen && (
              <p className="mt-5 border-t border-line pt-4 text-center text-xs text-navy-500">
                حساب ندارید؟ <Link to="/register" className="font-bold text-accent hover:underline">ثبت‌نام مشتری جدید</Link>
              </p>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

/**
 * Staff door — deliberately not linked from any public page. Office staff
 * know this address; customers (and casual scanners) never see it.
 */
export function StaffLoginPage() {
  const brand = useBrand();

  useEffect(() => {
    const previous = document.title;
    document.title = `ورود کارکنان | ${brand.name}`;
    return () => { document.title = previous; };
  }, [brand.name]);

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-shell px-4 py-10 text-shell-fg">
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 right-[8%] size-96 rounded-full bg-brand-500/15 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-[6%] size-80 rounded-full bg-brand-400/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute top-1/3 left-[16%] size-56 rounded-full border-2 border-dashed border-shell-line" />

      <div className="relative w-full max-w-md animate-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="size-16" />
          <h1 className="mt-4 text-xl font-black text-shell-fg">{brand.name}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-shell-muted">
            <LockKeyhole className="size-3.5" /> درگاه اختصاصی ورود کارکنان و مدیران دفتر
          </p>
        </div>

        <div className="card card-pad shadow-2xl">
          <LoginPanel audience="staff" />
          <Link to="/reset-password" className="mt-3 block text-center text-xs text-navy-500 hover:text-navy-800">رمز عبور خود را فراموش کرده‌اید؟ بازیابی با ایمیل</Link>
        </div>

        <p className="mt-5 flex items-center justify-center gap-2 text-center text-[11px] leading-6 text-shell-muted">
          <ShieldCheck className="size-4 shrink-0" />
          تلاش‌های ورود ثبت و پایش می‌شوند. اگر رمز را فراموش کرده‌اید، از «بازیابی با ایمیل» استفاده کنید یا با مدیر کل سامانه تماس بگیرید.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ registration ------------------------------ */

export function RegisterPage() {
  const { site } = useSite();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'), 'customer');
  const { notify } = useToast();
  const [referralCode, setReferralCode] = useState(() => params.get('ref') || getReferral());
  const [form, setForm] = useState({ fullName: '', username: '', mobile: '', password: '', email: '', nationalId: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post<any>('/api/auth/register', {...form,username:form.username || undefined, ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {})});
      clearReferral();
      if (res.data?.requiresVerification) {
        setNeedsVerification(true);
        notify('حساب ساخته شد. کد تأیید پیامک شد.', 'info');
        return;
      }
      const me = await refresh();
      notify('ثبت‌نام با موفقیت انجام شد', 'success');
      navigate(me ? (me.profileState?.complete === false ? homeFor(me) : (next ?? homeFor(me))) : '/app', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'ثبت‌نام ناموفق بود');
    } finally {
      setLoading(false);
    }
  };

  if (!site?.authMethods.registrationOpen) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="card card-pad">
            <h1 className="text-lg font-bold text-navy-900">ثبت‌نام غیرفعال است</h1>
            <p className="mt-2 text-sm text-navy-500">در حال حاضر امکان ثبت‌نام عمومی وجود ندارد. برای ایجاد حساب با دفتر تماس بگیرید.</p>
            <Link to="/login" className="btn-primary mt-4">ورود با کد یک‌بارمصرف</Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="card card-pad">
          <h1 className="text-lg font-bold text-navy-900">ایجاد حساب مشتری</h1>
          <p className="mt-1 text-sm text-navy-500">پس از ثبت‌نام می‌توانید درخواست ثبت کنید و وضعیت پرونده را دنبال کنید.</p>

          {needsVerification ? (
            <div className="mt-5 space-y-4">
              <p className="rounded-xl bg-brand-50 p-4 text-sm leading-7 text-brand-900">
                حساب شما ساخته شد. برای فعال‌سازی، کد ارسال‌شده به موبایل را وارد کنید.
              </p>
              <Link to={`/login`} className="btn-primary w-full">ورود با کد تأیید</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label="کد دعوت (اختیاری)" hint="از لینک دعوت دریافت می‌شود یا می‌توانید آن را دستی وارد کنید."><Input value={referralCode} onChange={e => { setReferralCode(e.target.value); if (e.target.value) saveReferral(e.target.value); else clearReferral(); }} dir="ltr" /></Field>
              <Field label="نام و نام خانوادگی" required>
                <Input value={form.fullName} onChange={set('fullName')} autoComplete="name" />
              </Field>
              <Field label="نام کاربری (اختیاری)" hint="حداقل ۳ حرف لاتین؛ با حرف شروع شود."><Input value={form.username} onChange={set('username')} autoComplete="username" dir="ltr" /></Field>
              <Field label="شماره موبایل" required>
                <Input value={form.mobile} onChange={set('mobile')} inputMode="tel" dir="ltr" className="text-left" placeholder="09123456789" />
              </Field>
              <Field label="کد ملی" hint="برای صدور فاکتور و پیگیری پرونده کاربرد دارد.">
                <Input value={form.nationalId} onChange={set('nationalId')} inputMode="numeric" dir="ltr" className="text-left" maxLength={10} />
              </Field>
              <Field label="ایمیل (اختیاری)">
                <Input type="email" value={form.email} onChange={set('email')} dir="ltr" className="text-left" />
              </Field>
              <Field label="رمز عبور" hint="حداقل ۸ کاراکتر شامل حرف و رقم." required>
                <Input type="password" value={form.password} onChange={set('password')} dir="ltr" className="text-left" autoComplete="new-password" />
              </Field>
              {error && <p className="text-xs text-rose-700">{error}</p>}
              <Button type="submit" className="w-full" loading={loading}>ثبت‌نام</Button>
              <p className="text-center text-xs text-navy-500">
                قبلاً ثبت‌نام کرده‌اید؟ <Link to="/login" className="text-accent hover:underline">ورود</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

/* -------------------------------- assistant ------------------------------- */

/**
 * The assistant now lives in its own module (`./Assistant`) because it renders
 * the full structured reply contract — service, case, invoice and wallet cards,
 * quick actions and the guided request draft. Re-exported here so existing
 * imports keep working.
 */
export { AssistantPage } from './Assistant';

/* --------------------------------- legal ---------------------------------- */

export function LegalPage() {
  const [data, setData] = useState<{ terms: string; privacy: string; officeName: string } | null>(null);
  useEffect(() => {
    api.get<{ data: any }>('/api/settings/legal').then((res) => setData(res.data)).catch(() => setData({ terms: '', privacy: '', officeName: '' }));
  }, []);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-navy-900">شرایط استفاده و حریم خصوصی</h1>
        <div className="card card-pad mt-5 prose-fa">
          <h2>شرایط استفاده</h2>
          {data?.terms ? <p className="whitespace-pre-wrap">{data.terms}</p> : (
            <p className="text-navy-500">متن شرایط استفاده توسط مدیر سامانه در بخش «تنظیمات عمومی» قابل ویرایش است و هنوز تکمیل نشده است.</p>
          )}
          <h2>حریم خصوصی</h2>
          {data?.privacy ? <p className="whitespace-pre-wrap">{data.privacy}</p> : (
            <p className="text-navy-500">
              اطلاعات هویتی و مدارک شما فقط برای انجام خدمت درخواستی و توسط کارشناسان مجاز دفتر استفاده می‌شود.
              دسترسی‌ها در تاریخچه عملیات سامانه ثبت می‌شود و پرداخت‌ها از طریق درگاه معتبر انجام می‌گیرد.
            </p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

export function StatusPage() {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<{ data: any }>('/api/public/status').then((res) => setStatus(res.data)).catch((err) => setError(err instanceof ApiFailure ? err.message : 'خطا'));
  }, []);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-navy-900">وضعیت سامانه</h1>
        <div className="card card-pad mt-5">
          {error && <p className="text-sm text-rose-700">{error}</p>}
          {!status && !error && <p className="text-sm text-navy-500">در حال دریافت وضعیت…</p>}
          {status && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
                <span className="text-sm font-medium text-emerald-900">وضعیت کلی سرویس</span>
                <span className="badge bg-emerald-600 text-white">فعال</span>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-xl bg-surface-3 p-4"><dt className="text-xs text-navy-500">نسخه سامانه</dt><dd className="mt-1 font-medium text-navy-900">{status.version}</dd></div>
                <div className="rounded-xl bg-surface-3 p-4"><dt className="text-xs text-navy-500">تعداد خدمات فعال</dt><dd className="mt-1 font-medium text-navy-900">{status.services}</dd></div>
                <div className="rounded-xl bg-surface-3 p-4"><dt className="text-xs text-navy-500">دفتر</dt><dd className="mt-1 font-medium text-navy-900">{status.office.name}</dd></div>
                <div className="rounded-xl bg-surface-3 p-4"><dt className="text-xs text-navy-500">ساعات کاری</dt><dd className="mt-1 font-medium text-navy-900">{status.office.workingHours}</dd></div>
              </dl>
              <p className="text-xs text-navy-400">آخرین بررسی: {new Date(status.checkedAt).toLocaleString('fa-IR')}</p>
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

export function NotFoundPage() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="text-6xl font-black text-brand-400">۴۰۴</p>
        <h1 className="mt-3 text-xl font-bold text-navy-900">صفحه مورد نظر یافت نشد</h1>
        <p className="mt-2 text-sm text-navy-500">ممکن است نشانی تغییر کرده باشد یا دسترسی به این صفحه مجاز نباشد.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/" className="btn-primary">صفحه اصلی</Link>
          <Link to="/services" className="btn-ghost">فهرست خدمات</Link>
        </div>
      </div>
    </PublicLayout>
  );
}

/* ------------------------------ password reset ---------------------------- */

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const linkToken = searchParams.get('token') ?? '';
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [identifier, setIdentifier] = useState('');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'request' | 'reset'>(linkToken ? 'reset' : 'request');
  const [emailRequested, setEmailRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const requestEmail = async () => {
    setLoading(true); setError('');
    try {
      const res = await api.post<{ data: { message: string } }>('/api/auth/password/reset-email/request', { identifier });
      setEmailRequested(true);
      notify(res.data?.message ?? 'اگر حسابی با این مشخصات وجود داشته باشد، لینک بازیابی ارسال شد.', 'success');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'خطا در ارسال لینک');
    } finally { setLoading(false); }
  };

  const confirmEmail = async () => {
    setLoading(true); setError('');
    try {
      await api.post('/api/auth/password/reset-email/confirm', { token: linkToken, newPassword: password });
      notify('رمز عبور تعیین شد. اکنون وارد شوید.', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'تعیین رمز ناموفق بود');
    } finally { setLoading(false); }
  };

  const request = async () => {
    setLoading(true); setError('');
    try {
      await api.post('/api/auth/otp/request', { mobile, purpose: 'reset', kind: 'customer' });
      setStep('reset');
      notify('کد بازیابی ارسال شد.', 'success');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'خطا در ارسال کد');
    } finally { setLoading(false); }
  };

  const reset = async () => {
    setLoading(true); setError('');
    try {
      await api.post('/api/auth/password/reset', { mobile, code, newPassword: password });
      notify('رمز عبور تغییر کرد. اکنون وارد شوید.', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'بازیابی ناموفق بود');
    } finally { setLoading(false); }
  };

  // Arrived through the emailed one-time link: only the new password is asked.
  if (linkToken) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-md px-4 py-14">
          <div className="card card-pad">
            <h1 className="text-lg font-bold text-navy-900">تعیین رمز عبور جدید</h1>
            <p className="mt-1 text-sm text-navy-500">لینک بازیابی شما معتبر است. رمز تازه را تعیین کنید؛ همهٔ نشست‌های قبلی بسته می‌شوند.</p>
            <div className="mt-5 space-y-4">
              <Field label="رمز عبور جدید" hint="حداقل ۱۰ کاراکتر شامل حرف و رقم." required>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="text-left" />
              </Field>
              {error && <p className="text-xs text-rose-700">{error}</p>}
              <Button className="w-full" loading={loading} onClick={confirmEmail}>تعیین رمز جدید</Button>
              <Link to="/login" className="block text-center text-xs text-navy-500 hover:text-navy-800">بازگشت به ورود</Link>
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-14">
        <div className="card card-pad">
          <h1 className="text-lg font-bold text-navy-900">بازیابی رمز عبور</h1>
          <p className="mt-1 text-sm text-navy-500">از طریق لینک ایمیل (کارکنان و مشتریان) یا کد پیامکی (مشتریان).</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant={channel === 'email' ? 'primary' : 'ghost'} size="sm" onClick={() => { setChannel('email'); setError(''); }}>لینک ایمیل</Button>
            <Button variant={channel === 'sms' ? 'primary' : 'ghost'} size="sm" onClick={() => { setChannel('sms'); setError(''); }}>کد پیامکی</Button>
          </div>
          <div className="mt-5 space-y-4">
            {channel === 'email' ? (
              <>
                <Field label="نام کاربری یا ایمیل" required>
                  <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} dir="ltr" className="text-left" />
                </Field>
                {emailRequested && (
                  <p className="rounded-lg bg-emerald-50 p-3 text-xs leading-6 text-emerald-800">
                    اگر حسابی با این مشخصات و ایمیل ثبت‌شده وجود داشته باشد، لینک بازیابی ارسال شد. صندوق ورودی (و پوشهٔ اسپم) را بررسی کنید؛ لینک ۳۰ دقیقه اعتبار دارد.
                  </p>
                )}
                {error && <p className="text-xs text-rose-700">{error}</p>}
                <Button className="w-full" loading={loading} onClick={requestEmail}>ارسال لینک بازیابی</Button>
              </>
            ) : (
              <>
                <Field label="شماره موبایل" required>
                  <Input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" className="text-left" inputMode="tel" />
                </Field>
                {step === 'reset' && (
                  <>
                    <Field label="کد پیامکی" required>
                      <Input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" className="text-center tracking-[0.4em]" inputMode="numeric" maxLength={8} />
                    </Field>
                    <Field label="رمز عبور جدید" hint="حداقل ۱۰ کاراکتر شامل حرف و رقم." required>
                      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="text-left" />
                    </Field>
                  </>
                )}
                {error && <p className="text-xs text-rose-700">{error}</p>}
                <Button className="w-full" loading={loading} onClick={step === 'request' ? request : reset}>
                  {step === 'request' ? 'دریافت کد بازیابی' : 'تعیین رمز جدید'}
                </Button>
              </>
            )}
            <Link to="/login" className="block text-center text-xs text-navy-500 hover:text-navy-800">بازگشت به ورود</Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

/** Landing page of the emailed verification link. The confirm endpoint is
 * account-scoped, so the person must be logged in; the page says so plainly
 * instead of failing silently. */
export function VerifyEmailPage() {
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error' | 'auth'>('idle');
  const [message, setMessage] = useState('');

  const confirm = async () => {
    setState('working');
    try {
      await api.post('/api/auth/email/verify/confirm', { proof: token });
      setState('done');
      notify('ایمیل شما تأیید شد.', 'success');
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        setState('auth');
        setMessage('برای تأیید ایمیل ابتدا وارد حساب خود شوید، سپس دوباره همین لینک را باز کنید.');
      } else {
        setState('error');
        setMessage(err instanceof ApiFailure ? err.message : 'تأیید ناموفق بود.');
      }
    }
  };

  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-14">
        <div className="card card-pad text-center">
          <h1 className="text-lg font-bold text-navy-900">تأیید ایمیل</h1>
          {state === 'done' ? (
            <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✅ ایمیل شما با موفقیت تأیید شد.</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-navy-500">برای تأیید نشانی ایمیل حساب خود، دکمهٔ زیر را بزنید.</p>
              {message && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-800">{message}</p>}
              <Button className="mt-4 w-full" loading={state === 'working'} onClick={confirm} disabled={!token}>تأیید ایمیل من</Button>
              {!token && <p className="mt-2 text-xs text-rose-700">توکن تأیید در نشانی وجود ندارد؛ از لینک داخل ایمیل استفاده کنید.</p>}
            </>
          )}
          <Link to="/app" className="mt-4 block text-xs text-navy-500 hover:text-navy-800">بازگشت به سامانه</Link>
        </div>
      </div>
    </PublicLayout>
  );
}
