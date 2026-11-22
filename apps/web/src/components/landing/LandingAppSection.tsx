import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  CreditCard,
  Download,
  Folder,
  MonitorSmartphone,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Wallet,
} from 'lucide-react';
import { useBrand } from '../../lib/brand';
import { useSite } from '../../lib/site';
import { usePrefersReducedMotion, useReveal, useVisibilityPause } from '../landing-motion';

type Beat = 'compose' | 'sent' | 'track';
const BEATS: Beat[] = ['compose', 'sent', 'track'];

/* ------------------------- phone screen beats ------------------------- */

function PhoneScreen({ visible, brandName }: { visible: boolean; brandName: string }) {
  const [beat, setBeat] = useState<Beat>('compose');
  const [typed, setTyped] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!visible || reduced) {
      setTyped(3);
      return;
    }
    const id = window.setInterval(() => {
      setBeat((prev) => BEATS[(BEATS.indexOf(prev) + 1) % BEATS.length]);
    }, 4600);
    return () => window.clearInterval(id);
  }, [visible, reduced]);

  useEffect(() => {
    if (!visible || reduced) {
      setTyped(3);
      return;
    }
    setTyped(0);
    const id = window.setInterval(() => setTyped((t) => (t >= 3 ? 3 : t + 1)), 700);
    return () => window.clearInterval(id);
  }, [beat, visible, reduced]);

  const fields = [
    { label: 'نام و نام خانوادگی', value: 'علی رضایی' },
    { label: 'کد ملی', value: '۰۰۴۳۲۱۹۸۷۶' },
    { label: 'شمارهٔ بیمه', value: '۱۲۳۴۵۶۷۸۹۰' },
  ];

  return (
    <div className="app-screen">
      <div className="app-screen-status">
        <span dir="ltr">۱۲:۴۰</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded-[1px] border border-current opacity-60" />
          <span className="inline-block h-1.5 w-2 rounded-[1px] bg-current opacity-60" />
        </span>
      </div>

      <div className="app-screen-header">
        <span className="app-screen-logo">
          <MonitorSmartphone className="size-4" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="app-screen-name">{brandName}</p>
          <p className="app-screen-sub">سلام، علی</p>
        </div>
        <span className="app-screen-bell">
          <Bell className="size-3.5" />
          {beat === 'sent' ? <span className="app-screen-dot" /> : null}
        </span>
      </div>

      <div className="app-screen-body">
        {beat === 'compose' && (
          <div className="animate-[fadeUp_.4s_ease_both] space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="app-screen-strong text-[10px] font-black">درخواست جدید</p>
              <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[8px] font-extrabold text-cyan-600 dark:text-cyan-300">
                ۴۵ ثانیه
              </span>
            </div>
            {fields.map((field, i) => (
              <div key={field.label} className="app-screen-field">
                <p className="app-screen-label">{field.label}</p>
                <p className={`app-screen-value ${typed > i ? 'opacity-100' : 'opacity-30'}`}>
                  {typed > i ? field.value : '·········'}
                </p>
              </div>
            ))}
            <div className="app-screen-chip-ok">
              <span className="app-screen-check">
                <Check className="size-2.5" strokeWidth={4} />
              </span>
              <span className="text-[9px] font-extrabold">کارت ملی پیوست شد</span>
            </div>
            <div className={`app-screen-submit ${typed >= 3 ? 'is-live' : ''}`}>
              <Send className="size-3.5" />
              ثبت نهایی
            </div>
          </div>
        )}

        {beat === 'sent' && (
          <div className="flex h-full animate-[fadeUp_.4s_ease_both] flex-col items-center justify-center text-center">
            <span className="app-screen-success">
              <Check className="size-8" strokeWidth={3.2} />
            </span>
            <p className="app-screen-strong text-[13px] font-black">درخواست ثبت شد</p>
            <p className="app-screen-label text-[9px]">می‌توانید همین حالا پیگیری کنید</p>
            <div className="app-screen-code">
              <p className="text-[7px] opacity-70">کد پیگیری</p>
              <p className="text-[11px] font-black tracking-wider" dir="ltr">
                PK-20262973
              </p>
            </div>
          </div>
        )}

        {beat === 'track' && (
          <div className="animate-[fadeUp_.4s_ease_both] space-y-2">
            <div className="app-screen-dossier">
              <div className="flex items-center justify-between">
                <p className="text-[8px] text-white/80">در حال پیگیری</p>
                <ShieldCheck className="size-3.5 text-white/70" />
              </div>
              <p className="text-[10px] font-black" dir="ltr">
                PK-20262973
              </p>
              <p className="text-[8px] text-white/80">سابقهٔ بیمه تأمین اجتماعی</p>
            </div>
            <div className="app-screen-timeline">
              {[
                { label: 'ثبت شد', state: 'done' as const },
                { label: 'بررسی مدارک', state: 'done' as const },
                { label: 'در دست کارشناس', state: 'active' as const },
                { label: 'آمادهٔ تحویل', state: 'next' as const },
              ].map((row, i, arr) => (
                <div key={row.label} className="flex gap-2">
                  <div className="flex flex-col items-center">
                    <span className={`app-screen-track-dot ${row.state}`}>
                      {row.state === 'done' ? <Check className="size-2.5" strokeWidth={4} /> : null}
                    </span>
                    {i < arr.length - 1 ? <span className="app-screen-track-line" /> : null}
                  </div>
                  <p
                    className={`pb-2.5 text-[9px] font-bold ${
                      row.state === 'next' ? 'app-screen-label' : 'app-screen-strong'
                    }`}
                  >
                    {row.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="app-screen-home">
        <span />
      </div>
    </div>
  );
}

/* ------------------------- install buttons ------------------------- */

function InstallButton({
  icon,
  title,
  hint,
  href,
  tone,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  href?: string;
  tone: 'slate' | 'bazaar' | 'myket';
}) {
  const soon = !href;
  const content = (
    <>
      <span className="install-icon">{icon}</span>
      <span className="min-w-0 flex-1 text-start">
        <span className="block text-[0.74rem] font-black leading-5">{title}</span>
        <span className="block text-[0.6rem] opacity-75">{soon ? 'به‌زودی' : hint}</span>
      </span>
      {!soon ? <ArrowLeft className="size-4 shrink-0 opacity-70" /> : null}
    </>
  );

  if (soon) {
    return (
      <span
        className={`install-card install-card-${tone} is-soon`}
        aria-disabled="true"
        title="به‌روزرسانی به‌زودی"
      >
        {content}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`install-card install-card-${tone}`}
    >
      {content}
    </a>
  );
}

/* ------------------------- app section ------------------------- */

export function LandingAppSection() {
  const { setting } = useSite();
  const brand = useBrand();
  const reveal = useReveal<HTMLElement>();
  const { ref: sceneRef, visible } = useVisibilityPause<HTMLDivElement>();
  const phoneRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = phoneRef.current;
    if (!node || reduced) return;
    if (
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches
    ) {
      return;
    }

    let frame = 0;
    const apply = (clientX: number, clientY: number) => {
      const rect = node.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width - 0.5;
      const py = (clientY - rect.top) / rect.height - 0.5;
      node.style.setProperty('--mx', (px * 1.5).toFixed(3));
      node.style.setProperty('--my', (py * 1.5).toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply(event.clientX, event.clientY);
      });
    };
    const onLeave = () => {
      node.style.setProperty('--mx', '0');
      node.style.setProperty('--my', '0');
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  if (setting('landing.show_app_section') === 'false') return null;

  const title = setting('landing.app_title') || `اپلیکیشن ${brand.name} همیشه همراه شماست`;
  const text =
    setting('landing.app_text') ||
    'نسخهٔ اندروید برای ثبت سریع درخواست، عکس‌برداری از مدارک، پرداخت آنلاین و دریافت اعلان وضعیت طراحی شده است.';
  const directUrl = setting('landing.app_android_url') || setting('landing.app_direct_url');
  const bazaarUrl = setting('landing.app_bazaar_url');
  const myketUrl = setting('landing.app_myket_url');
  const apkNote =
    setting('landing.app_apk_note') ||
    'نصب با APK مستقیم ممکن است در بعضی دستگاه‌ها نیازمند تأیید منبع باشد.';

  const features = [
    { icon: Send, text: 'ثبت درخواست کمتر از ۱ دقیقه' },
    { icon: Bell, text: 'اعلان فوری تغییر وضعیت پرونده' },
    { icon: Wallet, text: 'کیف پول و پرداخت یک‌کلیکی' },
    { icon: Folder, text: 'آرشیو امن مدارک همیشه در جیب' },
  ];

  return (
    <section ref={reveal} id="app" className="scroll-mt-24 py-16 sm:py-20" aria-label="اپلیکیشن اندروید">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="app-panel relative overflow-hidden rounded-[2.2rem] border border-line">
          <div className="app-panel-glow" aria-hidden="true" />
          <div className="app-panel-grid" aria-hidden="true" />

          <div className="relative grid items-center gap-7 p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-12 lg:p-12">
            {/* ---------- copy column ---------- */}
            <div className="app-copy order-1">
              <span className="app-badge inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.68rem] font-extrabold">
                <Smartphone className="size-3.5" />
                اپلیکیشن اندروید
              </span>
              <h2 className="app-title mt-3 text-2xl font-black leading-[1.45] sm:text-3xl">{title}</h2>
              <p className="app-text mt-3 max-w-lg text-sm leading-7">{text}</p>

              <ul className="app-features mt-6 grid gap-2.5 sm:grid-cols-2">
                {features.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <li key={feature.text} className="app-feature-item">
                      <span className="app-feature-icon">
                        <Icon className="size-3.5" />
                      </span>
                      {feature.text}
                    </li>
                  );
                })}
              </ul>

              <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
                <InstallButton
                  tone="slate"
                  href={directUrl || undefined}
                  icon={<Download className="size-4" />}
                  title="دانلود مستقیم"
                  hint="APK مستقیم"
                />
                <InstallButton
                  tone="bazaar"
                  href={bazaarUrl || undefined}
                  icon={<Store className="size-4" />}
                  title="کافه‌بازار"
                  hint="فروشگاه رسمی"
                />
                <InstallButton
                  tone="myket"
                  href={myketUrl || undefined}
                  icon={<Store className="size-4" />}
                  title="مایکت"
                  hint="فروشگاه اندروید"
                />
              </div>

              <p className="app-note mt-4 text-[0.66rem] font-semibold leading-6">{apkNote}</p>
            </div>

            {/* ---------- device ---------- */}
            <div ref={sceneRef} data-reveal="zoom" className="device-scene order-2 lg:order-last" aria-hidden="true">
              <div className="device-frame-wrap relative">
                <span className="device-chip" data-chip="notify">
                  <Bell className="size-4" /> اعلان فوری
                </span>
                <span className="device-chip" data-chip="speed">
                  <Sparkles className="size-4" /> ثبت ۴۵ ثانیه
                </span>
                <span className="device-chip" data-chip="secure">
                  <CreditCard className="size-4" /> پرداخت امن
                </span>

                <div ref={phoneRef} className="phone">
                  <div className="phone-glass">
                    <PhoneScreen visible={visible} brandName={brand.name} />
                    <div className="phone-sheen" />
                  </div>
                  <div className="phone-notch" />
                  <div className="phone-side power" />
                  <div className="phone-side vol" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
