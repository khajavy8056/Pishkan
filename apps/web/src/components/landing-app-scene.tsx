/**
 * The app promo scene.
 *
 * The phone is not a static picture of a phone: its screen runs a short, looping
 * demo of the real product — request list → tracking timeline → wallet — with a
 * notification dropping in on top. The phone itself is a real 3D object (CSS
 * `preserve-3d` with a body, a screen and two side panels), so it has thickness
 * when it turns.
 *
 * On phones the whole thing reflows to a horizontal card rail instead of a
 * mockup: a 3D phone at 360px wide is unreadable, and the *content* is what the
 * visitor came for.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BadgeCheck, Bell, Check, Clock, CreditCard, FileText, Send, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useBrand, BrandMark } from '../lib/brand';
import { faNum } from '../lib/format';

/** The three screens the demo cycles through. */
const SCREENS = [
  { id: 'request', label: 'ثبت درخواست' },
  { id: 'track', label: 'پیگیری پرونده' },
  { id: 'wallet', label: 'کیف پول' },
] as const;

type ScreenId = (typeof SCREENS)[number]['id'];

export function AnimatedPhone({
  className,
  reducedMotion = false,
  /** Which screen to show first; the demo advances from here. */
  initial = 'request',
}: {
  className?: string;
  reducedMotion?: boolean;
  initial?: ScreenId;
}) {
  const brand = useBrand();
  const [screen, setScreen] = useState<ScreenId>(initial);
  const [typing, setTyping] = useState(0);
  const [toast, setToast] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The demo is a state machine on a timer rather than a CSS animation because
  // each beat changes *content* (a row appears, a step ticks over), and text
  // swapped by CSS would be invisible to a screen reader mid-read.
  useEffect(() => {
    if (reducedMotion) return;
    let cancelled = false;
    const wait = (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (cancelled) clearTimeout(timer);
    });

    (async () => {
      const order: ScreenId[] = ['request', 'track', 'wallet'];
      let index = Math.max(0, order.indexOf(initial));
      while (!cancelled) {
        const current = order[index % order.length];
        setScreen(current);
        setTyping(0);
        setToast(false);
        // Type the request title in, character by character.
        if (current === 'request') {
          for (let step = 1; step <= 3; step += 1) {
            await wait(340);
            if (cancelled) return;
            setTyping(step);
          }
          await wait(900);
          if (cancelled) return;
          setToast(true);
          await wait(1700);
        } else {
          await wait(3200);
        }
        if (cancelled) return;
        index += 1;
      }
    })();

    return () => { cancelled = true; };
  }, [reducedMotion, initial]);

  return (
    <div ref={ref} className={clsx('phone-scene', className)}>
      <div className="phone-3d">
        {/* back / body / screen as separate faces so the object has depth */}
        <div className="phone-face phone-back" aria-hidden="true" />
        <div className="phone-face phone-edge" aria-hidden="true" />
        <div className="phone-face phone-screen">
          <div className="relative h-full w-full overflow-hidden rounded-[2.05rem] bg-[#f7fafc]">
            {/* status bar */}
            <div className="flex items-center justify-between px-4 pt-3 text-[9px] font-bold text-navy-500">
              <span>{brand.shortName}</span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-3.5 rounded-[2px] border border-navy-400/60" />
                ۱۲:۴۰
              </span>
            </div>

            <div className="px-3.5 pt-2">
              {/* header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BrandMark className="size-6" />
                  <div className="leading-tight">
                    <p className="text-[10px] font-black text-navy-900">{brand.name}</p>
                    <p className="text-[7px] font-medium text-navy-500">سلام، علی 👋</p>
                  </div>
                </div>
                <span className="relative grid size-6 place-items-center rounded-full bg-white shadow-sm ring-1 ring-navy-900/5">
                  <Bell className="size-3 text-navy-600" />
                  {toast && <span className="absolute -top-0.5 -left-0.5 size-2 rounded-full bg-rose-500 ring-2 ring-white" />}
                </span>
              </div>

              {/* --- screen 1: new request --- */}
              {screen === 'request' && (
                <div className="animate-[fadeUp_.34s_ease_both] mt-3 space-y-2">
                  <p className="text-[9px] font-black text-navy-900">درخواست جدید</p>
                  <div className="space-y-1.5 rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-navy-900/5">
                    {[
                      { label: 'نام و نام خانوادگی', value: 'علی رضایی' },
                      { label: 'کد ملی', value: '۰۴۹۹۳۷۰۸۹۹' },
                      { label: 'شماره بیمه', value: '۱۲۳۴۵۶۷۸۹۰' },
                    ].map((field, i) => (
                      <div key={field.label} className="rounded-xl bg-navy-50/60 px-2 py-1.5">
                        <p className="text-[6.5px] font-medium text-navy-500">{field.label}</p>
                        <p className={clsx(
                          'text-[8px] font-bold text-navy-900 transition-opacity duration-300',
                          typing > i ? 'opacity-100' : 'opacity-0',
                        )}>{field.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-navy-900/5">
                    <span className="grid size-5 place-items-center rounded-lg bg-emerald-500 text-white"><Check className="size-3" strokeWidth={3} /></span>
                    <span className="text-[7.5px] font-semibold text-navy-700">مدرک پیوست شد</span>
                    <span className="mr-auto text-[7px] text-navy-400">۱ فایل</span>
                  </div>
                  <button className="flex w-full items-center justify-center gap-1 rounded-xl bg-brand-600 py-2 text-[8.5px] font-black text-white shadow-md shadow-brand-600/35" type="button">
                    <Send className="size-3 -scale-x-100" />
                    ثبت نهایی درخواست
                  </button>
                </div>
              )}

              {/* --- screen 2: tracking --- */}
              {screen === 'track' && (
                <div className="animate-[fadeUp_.34s_ease_both] mt-3 space-y-2">
                  <div className="rounded-2xl bg-gradient-to-l from-brand-600 to-brand-700 p-2.5 text-white shadow-md">
                    <p className="text-[7px] text-white/70">کد پیگیری</p>
                    <p className="text-[11px] font-black tracking-wider" dir="ltr">PK-20262973</p>
                    <p className="mt-1 text-[7px] text-white/80">دریافت قبض تأمین اجتماعی</p>
                  </div>
                  <div className="rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-navy-900/5">
                    {[
                      { label: 'ثبت شد', done: true },
                      { label: 'بررسی کارشناس', done: true },
                      { label: 'آمادهٔ تحویل', done: false, active: true },
                      { label: 'تحویل نهایی', done: false },
                    ].map((step, i) => (
                      <div key={step.label} className="flex items-start gap-1.5">
                        <div className="flex flex-col items-center">
                          <span className={clsx(
                            'grid size-3.5 place-items-center rounded-full',
                            step.done ? 'bg-emerald-500 text-white'
                              : step.active ? 'bg-amber-400 text-white' : 'bg-navy-200 text-navy-400',
                          )}>
                            {step.done ? <Check className="size-2" strokeWidth={4} /> : <span className="size-1 rounded-full bg-white" />}
                          </span>
                          {i < 3 && <span className={clsx('h-3.5 w-0.5', step.done ? 'bg-emerald-400' : 'bg-navy-200')} />}
                        </div>
                        <p className={clsx(
                          'pb-1 text-[7.5px] font-bold',
                          step.done ? 'text-navy-800' : step.active ? 'text-amber-700' : 'text-navy-400',
                        )}>{step.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* --- screen 3: wallet --- */}
              {screen === 'wallet' && (
                <div className="animate-[fadeUp_.34s_ease_both] mt-3 space-y-2">
                  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-emerald-600 to-emerald-700 p-3 text-white shadow-lg">
                    <div className="absolute -top-4 -left-4 size-14 rounded-full bg-white/10" aria-hidden="true" />
                    <div className="flex items-center justify-between">
                      <p className="text-[7.5px] text-white/75">موجودی کیف پول</p>
                      <Wallet className="size-3 text-white/70" />
                    </div>
                    <p className="mt-1 text-[15px] font-black">{faNum(1284500)} <span className="text-[7px] font-medium text-white/70">ریال</span></p>
                    <div className="mt-2 flex gap-1.5">
                      <span className="flex-1 rounded-lg bg-white/15 py-1 text-center text-[7px] font-bold ring-1 ring-white/20">شارژ</span>
                      <span className="flex-1 rounded-lg bg-white py-1 text-center text-[7px] font-black text-emerald-800">پرداخت</span>
                    </div>
                  </div>
                  {[
                    { icon: CreditCard, label: 'قبض تأمین اجتماعی', amount: '-۵۰,۰۰۰', tone: 'text-rose-600' },
                    { icon: FileText, label: 'شارژ کیف پول', amount: '+۵۰۰,۰۰۰', tone: 'text-emerald-600' },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center gap-1.5 rounded-xl bg-white p-2 shadow-sm ring-1 ring-navy-900/5">
                      <span className="grid size-5 place-items-center rounded-lg bg-brand-50 text-brand-600"><row.icon className="size-3" /></span>
                      <span className="text-[7.5px] font-semibold text-navy-800">{row.label}</span>
                      <span className={clsx('mr-auto text-[7.5px] font-black', row.tone)}>{row.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* notification toast, appears when the request is submitted */}
            <div className={clsx(
              'absolute inset-x-2.5 top-9 flex items-center gap-1.5 rounded-xl bg-navy-950/92 px-2.5 py-1.5 text-white shadow-xl backdrop-blur transition-all duration-500',
              toast ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0',
            )}>
              <span className="grid size-4.5 place-items-center rounded-lg bg-emerald-500"><Check className="size-2.5" strokeWidth={4} /></span>
              <div className="leading-tight">
                <p className="text-[7px] font-black">درخواست ثبت شد</p>
                <p className="text-[6px] text-white/60">کد پیگیری PK-20262973</p>
              </div>
            </div>

            {/* bottom nav */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-around border-t border-navy-900/5 bg-white/90 px-2 pt-1.5 pb-2 backdrop-blur">
              {SCREENS.map((item) => (
                <span key={item.id} className={clsx('flex flex-col items-center gap-0.5 text-[6px] font-bold', screen === item.id ? 'text-brand-600' : 'text-navy-400')}>
                  <span className={clsx('grid size-5 place-items-center rounded-lg', screen === item.id ? 'bg-brand-50' : '')}>
                    {item.id === 'request' ? <Send className="size-2.5" /> : item.id === 'track' ? <Clock className="size-2.5" /> : <Wallet className="size-2.5" />}
                  </span>
                  {item.label}
                </span>
              ))}
            </div>

            {/* dynamic island */}
            <div className="absolute left-1/2 top-1.5 h-3 w-14 -translate-x-1/2 rounded-full bg-navy-950" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile fallback: the same three screens as swipeable-looking cards.
 * Rendered instead of the phone on narrow viewports (see the CSS in
 * `styles.css`), so a phone user gets the content, not a shrunken mockup.
 */
export function AppScreenCards({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setActive((value) => (value + 1) % 3), 3600);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  const cards = [
    {
      icon: Send,
      title: 'ثبت درخواست در چند ثانیه',
      body: 'فرم هوشمند، بارگذاری مدارک با دوربین گوشی و پرداخت آنلاین.',
      tint: 'from-brand-600 to-brand-700',
    },
    {
      icon: Clock,
      title: 'پیگیری لحظه‌ای پرونده',
      body: 'هر تغییری در وضعیت، همان لحظه اعلان می‌شود.',
      tint: 'from-sky-600 to-brand-700',
    },
    {
      icon: Wallet,
      title: 'کیف پول و پرداخت',
      body: 'شارژ، پرداخت قبض و تاریخچهٔ کامل تراکنش‌ها.',
      tint: 'from-emerald-600 to-emerald-700',
    },
  ];
  const current = cards[active];

  return (
    <div className="relative">
      <div className={clsx('relative overflow-hidden rounded-[1.8rem] bg-gradient-to-bl p-5 text-white shadow-xl', current.tint)}>
        <div className="absolute -top-6 -left-6 size-20 rounded-full bg-white/10" aria-hidden="true" />
        <current.icon className="size-8" />
        <p className="mt-3 text-base font-black">{current.title}</p>
        <p className="mt-1 text-xs leading-6 text-white/85">{current.body}</p>
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
            className={clsx('h-1.5 rounded-full transition-all', index === active ? 'w-7 bg-brand-600' : 'w-1.5 bg-navy-300')}
          />
        ))}
      </div>
    </div>
  );
}

/** Small trust row used under the app CTA. */
export function AppTrustRow() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-navy-500">
      <span className="flex items-center gap-1.5"><BadgeCheck className="size-4 text-emerald-600" /> نصب رایگان</span>
      <span className="flex items-center gap-1.5"><Check className="size-4 text-emerald-600" /> بدون تبلیغات</span>
      <span className="flex items-center gap-1.5"><ArrowLeft className="size-4 text-emerald-600" /> حجم کم</span>
    </div>
  );
}
