/**
 * The Android app section: a real device with the product running inside it.
 *
 * The previous version drew a phone out of CSS boxes — a body, a screen and an
 * edge — which always reads as a drawing. This one composites an actual
 * photographic device cut-out (`phone-bezel.webp`, the frame with the glass
 * removed) *on top of* live React UI that is inset by the exact pixel margins
 * measured from that photograph:
 *
 *     left 6.08% · right 6.42% · top 2.99% · bottom 2.99%
 *
 * so the interface is genuinely behind the glass, under the notch, and clipped
 * by the rounded corners. The screen content is real DOM — selectable, legible,
 * accessible — not an image of an interface.
 *
 * The demo is a four-beat loop: type the request → submit → track the dossier →
 * pay from the wallet. It advances on a timer and pauses when the section is
 * off-screen, so a phone in a pocket is not burning battery.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, BadgeCheck, Bell, Check, ChevronLeft, Clock, CreditCard, FileText,
  Fingerprint, Send, ShieldCheck, Sparkles, Wallet,
} from 'lucide-react';
import clsx from 'clsx';
import { useBrand, BrandMark } from '../lib/brand';
import { faNum } from '../lib/format';

/** The four beats of the demo. */
const BEATS = ['compose', 'sent', 'track', 'wallet'] as const;
type Beat = (typeof BEATS)[number];

/** Margins of the glass inside the photograph, measured, in percent. */
const GLASS = { left: '6.08%', right: '6.42%', top: '2.99%', bottom: '2.99%' };

export function AppDevice({
  className,
  reducedMotion = false,
}: {
  className?: string;
  reducedMotion?: boolean;
}) {
  const brand = useBrand();
  const [beat, setBeat] = useState<Beat>('compose');
  const [typed, setTyped] = useState(0);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  // Stop the loop when the section is off-screen. `visible` gates the timer.
  useEffect(() => {
    const node = sceneRef.current;
    if (!node || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '120px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reducedMotion || !visible) return;
    let cancelled = false;
    const wait = (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (cancelled) clearTimeout(timer);
    });

    (async () => {
      while (!cancelled) {
        setBeat('compose');
        setTyped(0);
        for (let step = 1; step <= 3; step += 1) {
          await wait(420);
          if (cancelled) return;
          setTyped(step);
        }
        await wait(700);
        if (cancelled) return;
        setBeat('sent');
        await wait(1600);
        if (cancelled) return;
        setBeat('track');
        await wait(3000);
        if (cancelled) return;
        setBeat('wallet');
        await wait(3000);
      }
    })();

    return () => { cancelled = true; };
  }, [reducedMotion, visible]);

  // With reduced motion the demo still has to *say* something, so it parks on
  // the tracking screen: the most information-dense of the four.
  const shown: Beat = reducedMotion ? 'track' : beat;

  return (
    <div ref={sceneRef} className={clsx('device-stage', className)}>
      {/* glow pooled under the device */}
      <div aria-hidden="true" className="device-glow" />

      <div className="device-tilt">
        {/* floating chips, desktop only — they orbit the device, not the screen */}
        <div className="device-chip" data-chip="notify">
          <span className="grid size-7 place-items-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-900/40">
            <Check className="size-4" strokeWidth={3.5} />
          </span>
          <div className="leading-tight">
            <p className="text-[10.5px] font-black text-navy-900">پرونده تأیید شد</p>
            <p className="text-[9px] font-medium text-navy-500">کد PK-20262973</p>
          </div>
        </div>

        <div className="device-chip" data-chip="speed">
          <Clock className="size-4 text-sky-500" />
          <div className="leading-tight">
            <p className="text-[10.5px] font-black text-navy-900">میانگین رسیدگی</p>
            <p className="text-[9px] font-medium text-navy-500">۲۴ ساعت کاری</p>
          </div>
        </div>

        <div className="device-chip" data-chip="secure">
          <ShieldCheck className="size-4 text-brand-600" />
          <span className="text-[10.5px] font-black text-navy-900">مدارک رمزنگاری‌شده</span>
        </div>

        {/* ------------------------------ the device ------------------------------ */}
        <div className="device relative">
          {/* live UI, sized to the glass rect inside the photograph */}
          <div className="device-glass" style={GLASS}>
            <div className="flex h-full w-full flex-col bg-[#f6f8fc]">
              {/* status bar — sits under the notch, which the bezel draws over it */}
              <div className="device-status flex items-center justify-between px-3.5 pt-2 pb-1 text-[8px] font-bold text-navy-500">
                <span dir="ltr">۱۲:۴۰</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-3 rounded-[1px] border border-navy-400/60" />
                  <span className="inline-block h-1.5 w-2 rounded-[1px] bg-navy-400/60" />
                </span>
              </div>

              {/* app header */}
              <div className="flex items-center gap-2 px-3.5 pb-2">
                <BrandMark className="size-6 shrink-0" />
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-[10px] font-black text-navy-900">{brand.name}</p>
                  <p className="text-[7.5px] font-medium text-navy-500">سلام، علی 👋</p>
                </div>
                <span className="relative mr-auto grid size-6 shrink-0 place-items-center rounded-full bg-white shadow-sm ring-1 ring-navy-900/5">
                  <Bell className="size-3 text-navy-600" />
                  {shown === 'sent' && <span className="absolute -top-0.5 -left-0.5 size-2 rounded-full bg-rose-500 ring-2 ring-white" />}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden px-3">
                {/* ---------------- beat 1: composing the request ---------------- */}
                {shown === 'compose' && (
                  <div className="animate-[fadeUp_.3s_ease_both] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-black text-navy-900">درخواست جدید</p>
                      <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[7px] font-bold text-brand-700">۴۵ ثانیه</span>
                    </div>
                    {[
                      { label: 'نام و نام خانوادگی', value: 'علی رضایی' },
                      { label: 'کد ملی', value: '۰۴۹۹۳۷۰۸۹۹' },
                      { label: 'شماره بیمه', value: '۱۲۳۴۵۶۷۸۹۰' },
                    ].map((field, i) => (
                      <div key={field.label} className="rounded-xl bg-white px-2 py-1.5 shadow-sm ring-1 ring-navy-900/5">
                        <p className="text-[6.5px] font-medium text-navy-400">{field.label}</p>
                        <p className={clsx('text-[8.5px] font-bold text-navy-900 transition-opacity duration-200', typed > i ? 'opacity-100' : 'opacity-25')}>
                          {typed > i ? field.value : '·········'}
                        </p>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-200/70">
                      <span className="grid size-4 place-items-center rounded-md bg-emerald-500 text-white">
                        <Check className="size-2.5" strokeWidth={4} />
                      </span>
                      <span className="text-[7.5px] font-bold text-emerald-800">کارت ملی پیوست شد</span>
                    </div>
                    <div className={clsx(
                      'flex items-center justify-center gap-1 rounded-xl py-2 text-[8.5px] font-black text-white transition-all duration-300',
                      typed >= 3 ? 'bg-brand-600 shadow-md shadow-brand-600/40' : 'bg-navy-300',
                    )}>
                      <Send className="size-3 -scale-x-100" />
                      ثبت نهایی
                    </div>
                  </div>
                )}

                {/* ---------------- beat 2: submitted, tracking code ---------------- */}
                {shown === 'sent' && (
                  <div className="animate-[fadeUp_.3s_ease_both] flex h-full flex-col items-center justify-center pb-6 text-center">
                    <span className="grid size-12 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-600/40">
                      <Check className="size-7" strokeWidth={3.5} />
                    </span>
                    <p className="mt-2.5 text-[11px] font-black text-navy-900">درخواست ثبت شد</p>
                    <p className="mt-0.5 text-[8px] text-navy-500">می‌توانید همین حالا پیگیری کنید</p>
                    <div className="mt-2.5 rounded-xl bg-white px-3 py-1.5 shadow-sm ring-1 ring-navy-900/5">
                      <p className="text-[6.5px] text-navy-400">کد پیگیری</p>
                      <p className="text-[10px] font-black tracking-wider text-brand-700" dir="ltr">PK-20262973</p>
                    </div>
                  </div>
                )}

                {/* ---------------- beat 3: live dossier tracking ---------------- */}
                {shown === 'track' && (
                  <div className="animate-[fadeUp_.3s_ease_both] space-y-1.5">
                    <div className="rounded-xl bg-gradient-to-l from-brand-600 to-brand-700 p-2 text-white shadow-md">
                      <div className="flex items-center justify-between">
                        <p className="text-[6.5px] text-white/70">در حال پیگیری</p>
                        <Fingerprint className="size-3 text-white/60" />
                      </div>
                      <p className="text-[9px] font-black" dir="ltr">PK-20262973</p>
                      <p className="text-[6.5px] text-white/80">سابقهٔ بیمه تأمین اجتماعی</p>
                    </div>
                    <div className="rounded-xl bg-white p-2 shadow-sm ring-1 ring-navy-900/5">
                      {[
                        { label: 'ثبت شد', state: 'done' },
                        { label: 'بررسی مدارک', state: 'done' },
                        { label: 'در دست کارشناس', state: 'active' },
                        { label: 'آمادهٔ تحویل', state: 'next' },
                      ].map((step, i, all) => (
                        <div key={step.label} className="flex gap-1.5">
                          <div className="flex flex-col items-center">
                            <span className={clsx(
                              'grid size-3 shrink-0 place-items-center rounded-full',
                              step.state === 'done' ? 'bg-emerald-500 text-white'
                                : step.state === 'active' ? 'bg-amber-400 text-white' : 'bg-navy-200',
                            )}>
                              {step.state === 'done'
                                ? <Check className="size-1.5" strokeWidth={5} />
                                : <span className="size-1 rounded-full bg-white" />}
                            </span>
                            {i < all.length - 1 && (
                              <span className={clsx('w-0.5 flex-1', step.state === 'done' ? 'bg-emerald-400' : 'bg-navy-200')} />
                            )}
                          </div>
                          <p className={clsx(
                            'pb-1.5 text-[7.5px] font-bold',
                            step.state === 'next' ? 'text-navy-400' : step.state === 'active' ? 'text-amber-700' : 'text-navy-800',
                          )}>
                            {step.label}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ---------------- beat 4: wallet ---------------- */}
                {shown === 'wallet' && (
                  <div className="animate-[fadeUp_.3s_ease_both] space-y-1.5">
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-bl from-emerald-500 to-emerald-700 p-2.5 text-white shadow-lg">
                      <div aria-hidden="true" className="absolute -top-3 -left-3 size-12 rounded-full bg-white/10" />
                      <div className="flex items-center justify-between">
                        <p className="text-[7px] text-white/75">موجودی کیف پول</p>
                        <Wallet className="size-3 text-white/70" />
                      </div>
                      <p className="mt-0.5 text-[14px] font-black">
                        {faNum(1284500)} <span className="text-[6.5px] font-medium text-white/70">ریال</span>
                      </p>
                      <div className="mt-1.5 flex gap-1">
                        <span className="flex-1 rounded-md bg-white/20 py-0.5 text-center text-[6.5px] font-bold ring-1 ring-white/25">شارژ</span>
                        <span className="flex-1 rounded-md bg-white py-0.5 text-center text-[6.5px] font-black text-emerald-800">پرداخت</span>
                      </div>
                    </div>
                    {[
                      { icon: CreditCard, label: 'قبض تأمین اجتماعی', amount: '-۵۰٬۰۰۰', tone: 'text-rose-600' },
                      { icon: FileText, label: 'شارژ کیف پول', amount: '+۵۰۰٬۰۰۰', tone: 'text-emerald-600' },
                      { icon: Sparkles, label: 'رسید خدمت', amount: 'رایگان', tone: 'text-navy-500' },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center gap-1.5 rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-navy-900/5">
                        <span className="grid size-4 place-items-center rounded-md bg-brand-50 text-brand-600">
                          <row.icon className="size-2.5" />
                        </span>
                        <span className="text-[7px] font-semibold text-navy-800">{row.label}</span>
                        <span className={clsx('mr-auto text-[7px] font-black', row.tone)}>{row.amount}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* bottom navigation — same four beats as tabs */}
              <div className="mt-auto flex items-end justify-around border-t border-navy-900/5 bg-white px-1 pt-1 pb-1.5">
                {[
                  { id: 'compose', icon: Send, label: 'درخواست' },
                  { id: 'track', icon: Clock, label: 'پیگیری' },
                  { id: 'wallet', icon: Wallet, label: 'کیف پول' },
                ].map((item) => {
                  const on = shown === item.id || (item.id === 'compose' && shown === 'sent');
                  return (
                    <span key={item.id} className={clsx('flex flex-col items-center gap-0.5 text-[5.5px] font-bold', on ? 'text-brand-600' : 'text-navy-400')}>
                      <span className={clsx('grid size-5 place-items-center rounded-lg', on && 'bg-brand-50')}>
                        <item.icon className="size-2.5" />
                      </span>
                      {item.label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* glass sheen: one diagonal highlight so the screen is glass, not paper */}
            <div aria-hidden="true" className="device-sheen" />
          </div>

          {/* the photograph of the device, on top of the live UI */}
          <picture className="device-body pointer-events-none absolute inset-0 select-none">
            <source srcSet="/images/landing/phone-bezel.webp" type="image/webp" />
            <img
              src="/images/landing/phone-bezel.webp"
              alt=""
              aria-hidden="true"
              className="block h-full w-full"
              draggable={false}
              decoding="async"
            />
          </picture>
        </div>
      </div>
    </div>
  );
}

/**
 * Narrow-viewport replacement: the same four beats as stacked cards.
 *
 * A photographic device at 360px wide would put the interface at 6px type. The
 * content is what the visitor came for, so the phone is swapped for cards that
 * show each screen's substance at a readable size.
 */
export function AppDeviceCards({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setActive((value) => (value + 1) % 3), 3800);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  const cards = [
    {
      icon: Send,
      title: 'ثبت درخواست در چند ثانیه',
      body: 'فرم هوشمندی که اطلاعات را از پروفایل شما پر می‌کند؛ فقط مدارک را می‌گیرد.',
      tint: 'from-brand-600 to-brand-800',
      stats: ['۴۵ ثانیه میانگین', 'بدون صف'],
    },
    {
      icon: Clock,
      title: 'پیگیری زندهٔ پرونده',
      body: 'هر تغییر وضعیت همان لحظه اعلان می‌شود؛ کد پیگیری همیشه در دسترس است.',
      tint: 'from-sky-600 to-brand-800',
      stats: ['اعلان لحظه‌ای', 'تاریخچهٔ کامل'],
    },
    {
      icon: Wallet,
      title: 'کیف پول و پرداخت',
      body: 'شارژ، پرداخت قبض و رسید خدمت، همه در یک‌جا و قابل حسابرسی.',
      tint: 'from-emerald-600 to-emerald-800',
      stats: ['پرداخت آنلاین', 'رسید دیجیتال'],
    },
  ];
  const current = cards[active];

  return (
    <div className="relative">
      <div className={clsx('relative overflow-hidden rounded-[1.75rem] bg-gradient-to-bl p-5 text-white shadow-xl transition-colors duration-500', current.tint)}>
        <div aria-hidden="true" className="absolute -top-8 -left-8 size-24 rounded-full bg-white/10" />
        <div aria-hidden="true" className="absolute -right-6 -bottom-10 size-28 rounded-full border border-white/15" />
        <current.icon className="relative size-8" />
        <p className="relative mt-3 text-base font-black leading-snug">{current.title}</p>
        <p className="relative mt-1.5 text-xs leading-6 text-white/85">{current.body}</p>
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {current.stats.map((stat) => (
            <span key={stat} className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold ring-1 ring-white/20">{stat}</span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex justify-center gap-1.5" role="tablist" aria-label="صفحه‌های اپلیکیشن">
        {cards.map((card, index) => (
          <button
            key={card.title}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={card.title}
            onClick={() => setActive(index)}
            className={clsx('h-1.5 rounded-full transition-all', index === active ? 'w-8 bg-brand-600' : 'w-1.5 bg-navy-300')}
          />
        ))}
      </div>
    </div>
  );
}

/** The trust row under the app CTA. */
export function AppTrustRow() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-white/60">
      <span className="flex items-center gap-1.5"><BadgeCheck className="size-4 text-emerald-300" /> نصب رایگان</span>
      <span className="flex items-center gap-1.5"><Check className="size-4 text-emerald-300" /> بدون تبلیغات</span>
      <span className="flex items-center gap-1.5"><ArrowLeft className="size-4 text-emerald-300" /> حجم کم</span>
      <span className="flex items-center gap-1.5"><ChevronLeft className="size-4 text-emerald-300" /> اندروید ۸ به بالا</span>
    </div>
  );
}
