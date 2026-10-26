import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone, KeyRound, ArrowRight, ShieldCheck, Eye, EyeOff, RefreshCw, Info } from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { useSite } from '../../lib/site';
import { useAuth, homeFor, type CurrentUser } from '../../lib/auth';
import { api, ApiFailure } from '../../lib/api';
import { Button, Field, Input, useToast } from '../../components/ui';

export function LoginPage() {
  const { site, setting } = useSite();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { notify } = useToast();
  const next = params.get('next');

  const [accountKind,setAccountKind]=useState<'customer'|'staff'>('customer');
  const otpEnabled = (accountKind==='staff'?site?.authMethods.staffOtp:site?.authMethods.otp) ?? true;
  const passwordEnabled = accountKind==='staff' || (site?.authMethods.password ?? false);
  const [mode, setMode] = useState<'otp' | 'password'>(otpEnabled ? 'otp' : 'password');

  useEffect(()=>{if(!otpEnabled)setMode('password');else if(!passwordEnabled)setMode('otp')},[otpEnabled,passwordEnabled]);
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
    if (user) navigate(next ?? homeFor(user), { replace: true });
  }, [user, next, navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const afterLogin = async (data: any) => {
    const me = await refresh();
    const target = next ?? homeFor(me ?? (data.user as CurrentUser));
    notify(`خوش آمدید ${me?.fullName ?? ''}`, 'success');
    navigate(target, { replace: true });
  };

  const requestOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ data: { sent: boolean; debugCode?: string; resendIn: number; error?: string } }>('/api/auth/otp/request', { mobile,kind:accountKind });
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
      const res = await api.post<any>('/api/auth/otp/verify', { mobile, code,kind:accountKind });
      if(res.data.mfaRequired){setMfa({token:res.data.mfaToken,mode:'totp',message:'کد برنامه تأیید دومرحله‌ای را وارد کنید.'});return;}
      await afterLogin(res.data);
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
      const res = await api.post<any>('/api/auth/login', { identifier, password });
      if (res.data?.mfaRequired) {
        setMfa({ token: res.data.mfaToken, mode: res.data.mode, message: res.data.message });
        if (res.data.mode === 'otp') notify('کد تأیید به موبایل شما ارسال شد.', 'success');
        return;
      }
      await afterLogin(res.data);
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
      const res = await api.post<any>('/api/auth/mfa/verify', { ticket: mfa.token, code: mfaCode, mode: mfa.mode });
      await afterLogin(res.data);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'کد تأیید صحیح نیست');
    } finally {
      setLoading(false);
    }
  };

  if (mfa) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-md px-4 py-14">
          <div className="card card-pad">
            <h1 className="text-lg font-bold text-navy-900">تأیید دومرحله‌ای</h1>
            <p className="mt-1 text-sm text-navy-500">{mfa.message}</p>
            <div className="mt-5 space-y-4">
              <Field label="کد تأیید">
                <Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" dir="ltr" className="text-center tracking-[0.5em]" maxLength={8} />
              </Field>
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <Button className="w-full" loading={loading} onClick={submitMfa}>تأیید و ورود</Button>
              <button className="w-full text-xs text-navy-500 hover:text-navy-800" onClick={() => setMfa(null)}>بازگشت</button>
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
        <div className="hidden lg:block">
          <h1 className="text-2xl font-bold leading-9 text-navy-900">ورود به سامانه {setting('site.short_name')}</h1>
          <p className="mt-2 text-sm leading-7 text-navy-600">
            با ورود به حساب، درخواست‌های خود را ثبت و پیگیری کنید، فاکتورها را ببینید و با کارشناس دفتر در ارتباط باشید.
          </p>

          <div className="mt-6 space-y-3">
            {[
              ['ورود بدون رمز', 'با شماره موبایل و کد یک‌بارمصرف، سریع و امن وارد شوید.'],
              ['پیگیری شفاف', 'هر تغییر وضعیت با تاریخ و کاربر ثبت می‌شود.'],
              ['حریم خصوصی', 'اطلاعات پرونده شما فقط برای کارشناس مسئول قابل مشاهده است.'],
            ].map(([title, text]) => (
              <div key={title} className="rounded-xl bg-white p-4 ring-1 ring-navy-900/8">
                <p className="text-sm font-semibold text-navy-900">{title}</p>
                <p className="mt-1 text-xs leading-6 text-navy-500">{text}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-navy-500">
            <ShieldCheck className="size-4 text-emerald-600" />
            اتصال شما رمزنگاری‌شده است و کدهای ورود پس از مدت کوتاه منقضی می‌شوند.
          </div>
        </div>

        <div className="card card-pad">
          <div className="mb-4 flex gap-2">{([['customer','ورود مشتریان'],['staff','ورود کارکنان و مدیران']] as const).map(([kind,label])=><button key={kind} onClick={()=>{setAccountKind(kind);setMode('password');setStep('request');setError('')}} className={clsx('flex-1 rounded-xl border px-3 py-3 text-xs',accountKind===kind?'border-brand-200 bg-brand-50 font-bold text-brand-800':'border-navy-100 text-navy-500')}>{label}</button>)}</div>
          <div className="mb-5 flex gap-1 rounded-xl bg-navy-50 p-1">
            {otpEnabled && (
              <button onClick={() => { setMode('otp'); setError(''); }} className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition', mode === 'otp' ? 'bg-white font-medium text-navy-900 shadow-sm' : 'text-navy-600')}>
                <Smartphone className="size-4" /> کد یک‌بارمصرف
              </button>
            )}
            {passwordEnabled && (
              <button onClick={() => { setMode('password'); setError(''); }} className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition', mode === 'password' ? 'bg-white font-medium text-navy-900 shadow-sm' : 'text-navy-600')}>
                <KeyRound className="size-4" /> نام کاربری و رمز
              </button>
            )}
            {!otpEnabled && !passwordEnabled && (
              <p className="px-3 py-2 text-sm text-amber-700">روش ورود مشتریان توسط مدیر سامانه غیرفعال شده است. با دفتر تماس بگیرید.</p>
            )}
          </div>

          {mode === 'otp' && otpEnabled && (
            <div className="space-y-4">
              {step === 'request' ? (
                <>
                  <Field label="شماره موبایل" hint="کد تأیید به همین شماره ارسال می‌شود." required>
                    <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="09123456789" inputMode="tel" dir="ltr" className="text-left" />
                  </Field>
                  {error && <p className="text-xs text-rose-600">{error}</p>}
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
                    <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
                      <Info className="mt-0.5 size-4 shrink-0" />
                      <span>حالت توسعه: پیامک واقعی ارسال نشده است. کد آزمایشی: <b dir="ltr">{debugCode}</b></span>
                    </div>
                  )}
                  {error && <p className="text-xs text-rose-600">{error}</p>}
                  <Button className="w-full" loading={loading} onClick={verifyOtp} disabled={code.length < 4}>ورود به سامانه</Button>
                  <div className="flex items-center justify-between text-xs">
                    <button className="text-navy-500 hover:text-navy-800" onClick={() => { setStep('request'); setCode(''); }}>تغییر شماره</button>
                    <button
                      className="flex items-center gap-1 text-brand-700 hover:underline disabled:text-navy-400"
                      disabled={countdown > 0 || loading}
                      onClick={requestOtp}
                    >
                      <RefreshCw className="size-3.5" />
                      {countdown > 0 ? `ارسال مجدد در ${countdown} ثانیه` : 'ارسال مجدد کد'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {mode === 'password' && passwordEnabled && (
            <div className="space-y-4">
              <Field label="نام کاربری، موبایل یا ایمیل" required>
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
                    onKeyDown={(e) => e.key === 'Enter' && passwordLogin()}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-navy-400 hover:bg-navy-50" aria-label="نمایش رمز">
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <Button className="w-full" loading={loading} onClick={passwordLogin}>ورود</Button>
              {site?.authMethods.passwordReset && (
                <Link to="/reset-password" className="block text-center text-xs text-navy-500 hover:text-navy-800">رمز عبور خود را فراموش کرده‌اید؟</Link>
              )}
            </div>
          )}

          {site?.authMethods.registrationOpen && (
            <p className="mt-5 border-t border-navy-900/8 pt-4 text-center text-xs text-navy-500">
              حساب ندارید؟ <Link to="/register" className="font-medium text-brand-700 hover:underline">ثبت‌نام کنید</Link>
            </p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

/* ------------------------------ registration ------------------------------ */

export function RegisterPage() {
  const { site } = useSite();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();
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
      const res = await api.post<any>('/api/auth/register', {...form,username:form.username || undefined});
      if (res.data?.requiresVerification) {
        setNeedsVerification(true);
        notify('حساب ساخته شد. کد تأیید پیامک شد.', 'info');
        return;
      }
      const me = await refresh();
      notify('ثبت‌نام با موفقیت انجام شد', 'success');
      navigate(me ? homeFor(me) : '/app', { replace: true });
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
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <Button type="submit" className="w-full" loading={loading}>ثبت‌نام</Button>
              <p className="text-center text-xs text-navy-500">
                قبلاً ثبت‌نام کرده‌اید؟ <Link to="/login" className="text-brand-700 hover:underline">ورود</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

/* -------------------------------- assistant ------------------------------- */

export function AssistantPage() {
  const { site } = useSite();
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; suggestions?: any[]; questions?: string[] }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [handoff, setHandoff] = useState(false);

  useEffect(() => {
    if (site?.assistant.welcome && messages.length === 0) {
      setMessages([{ role: 'assistant', content: site.assistant.welcome }]);
    }
  }, [site, messages.length]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setMessages((prev) => [...prev, { role: 'user', content }]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.post<{ data: any }>('/api/assistant/chat', {
        message: content,
        history: messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      });
      const reply = res.data;
      setMessages((prev) => [...prev, {
        role: 'assistant', content: reply.reply, suggestions: reply.suggestions, questions: reply.followUpQuestions,
      }]);
      setHandoff(Boolean(reply.handoffSuggested));
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: err instanceof ApiFailure ? err.message : 'خطا در ارتباط با دستیار' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-navy-900">{site?.assistant.name ?? 'دستیار هوشمند'}</h1>
          <p className="mt-1 text-xs text-navy-500">{site?.assistant.disclaimer}</p>
        </div>

        <div className="card flex h-[65vh] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-5 scrollbar-thin">
            {messages.map((message, index) => (
              <div key={index} className={clsx('flex', message.role === 'user' ? 'justify-start' : 'justify-end')}>
                <div className={clsx('max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-7',
                  message.role === 'user' ? 'bg-brand-700 text-white' : 'bg-navy-50 text-navy-800')}>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.questions && message.questions.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-navy-900/10 pt-2 text-xs text-navy-600">
                      {message.questions.map((q) => <p key={q}>• {q}</p>)}
                    </div>
                  )}
                  {message.suggestions && message.suggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {message.suggestions.map((s: any) => (
                        <Link key={s.id} to={`/services/${s.slug}`} className="block rounded-xl bg-white p-3 ring-1 ring-navy-900/8 hover:bg-brand-50">
                          <span className="block text-xs font-semibold text-navy-900">{s.title}</span>
                          <span className="mt-0.5 block text-[11px] text-navy-500">{s.summary}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <p className="text-center text-xs text-navy-400">دستیار در حال نوشتن پاسخ است…</p>}
          </div>

          {handoff && (
            <div className="border-t border-navy-900/8 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              اگر پاسخ کافی نبود، می‌توانید <Link to="/app/messages" className="underline">به کارشناس پیام بدهید</Link>.
            </div>
          )}

          <div className="border-t border-navy-900/8 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="سؤال خود را بنویسید…"
                className="input"
                aria-label="پیام"
              />
              <Button onClick={() => send()} loading={loading} icon={<ArrowRight className="size-4 rotate-180" />}>ارسال</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['می‌خواهم سابقه بیمه بگیرم', 'چه مدارکی برای ثبت شرکت لازم است؟', 'وضعیت یارانه من چیست؟'].map((q) => (
                <button key={q} onClick={() => send(q)} className="rounded-full bg-navy-50 px-3 py-1 text-[11px] text-navy-600 hover:bg-brand-50">{q}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

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
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!status && !error && <p className="text-sm text-navy-500">در حال دریافت وضعیت…</p>}
          {status && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
                <span className="text-sm font-medium text-emerald-900">وضعیت کلی سرویس</span>
                <span className="badge bg-emerald-600 text-white">فعال</span>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-xl bg-navy-50/70 p-4"><dt className="text-xs text-navy-500">نسخه سامانه</dt><dd className="mt-1 font-medium text-navy-900">{status.version}</dd></div>
                <div className="rounded-xl bg-navy-50/70 p-4"><dt className="text-xs text-navy-500">تعداد خدمات فعال</dt><dd className="mt-1 font-medium text-navy-900">{status.services}</dd></div>
                <div className="rounded-xl bg-navy-50/70 p-4"><dt className="text-xs text-navy-500">دفتر</dt><dd className="mt-1 font-medium text-navy-900">{status.office.name}</dd></div>
                <div className="rounded-xl bg-navy-50/70 p-4"><dt className="text-xs text-navy-500">ساعات کاری</dt><dd className="mt-1 font-medium text-navy-900">{status.office.workingHours}</dd></div>
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
        <p className="text-6xl font-black text-brand-200">۴۰۴</p>
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
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const request = async () => {
    setLoading(true); setError('');
    try {
      await api.post('/api/auth/otp/request', { mobile, purpose: 'reset' });
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

  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-14">
        <div className="card card-pad">
          <h1 className="text-lg font-bold text-navy-900">بازیابی رمز عبور</h1>
          <p className="mt-1 text-sm text-navy-500">با کد پیامکی، رمز عبور جدید تعیین کنید.</p>
          <div className="mt-5 space-y-4">
            <Field label="شماره موبایل" required>
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" className="text-left" inputMode="tel" />
            </Field>
            {step === 'reset' && (
              <>
                <Field label="کد پیامکی" required>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" className="text-center tracking-[0.4em]" inputMode="numeric" maxLength={8} />
                </Field>
                <Field label="رمز عبور جدید" hint="حداقل ۸ کاراکتر شامل حرف و رقم." required>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="text-left" />
                </Field>
              </>
            )}
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <Button className="w-full" loading={loading} onClick={step === 'request' ? request : reset}>
              {step === 'request' ? 'دریافت کد بازیابی' : 'تعیین رمز جدید'}
            </Button>
            <Link to="/login" className="block text-center text-xs text-navy-500 hover:text-navy-800">بازگشت به ورود</Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
