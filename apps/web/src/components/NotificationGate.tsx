import { useEffect, useState } from 'react';
import { BellRing, ShieldAlert, X } from 'lucide-react';
import { Button, Modal, useToast } from './ui';
import { currentPushState, enablePush } from '../lib/push';

const STAFF_DISMISS_KEY = 'pishkan.notifGate.sessionDismissed';
const CUSTOMER_DISMISS_KEY = 'pishkan.notifGate.customerDismissedAt';
const CUSTOMER_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

type GateState = 'checking' | 'ok' | 'prompt' | 'banner' | 'denied' | 'insecure' | 'server-off';

/**
 * Notifications are part of the job, not an opt-in extra: staff and managers
 * are asked — persistently — to turn browser notifications on, and told
 * exactly how to unblock them when the browser has them denied. Customers
 * get one friendly prompt and are left alone for a week after dismissing.
 */
export function NotificationGate({ kind }: { kind: 'customer' | 'staff' | 'admin' }) {
  const { notify } = useToast();
  const [state, setState] = useState<GateState>('checking');
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const isStaffSide = kind !== 'customer';

  useEffect(() => {
    let active = true;
    (async () => {
      const push = await currentPushState();
      if (!active) return;
      if (push === 'subscribed' || push === 'unsupported') { setState('ok'); return; }
      if (push === 'insecure') { setState(isStaffSide ? 'insecure' : 'ok'); return; }
      if (push === 'denied') { setState(isStaffSide ? 'denied' : 'ok'); return; }
      if (push === 'unsubscribed') {
        // Permission already granted in the past — silently resubscribe.
        const result = await enablePush();
        if (!active) return;
        setState(result === 'subscribed' ? 'ok' : result === 'server-off' ? 'server-off' : 'prompt');
        return;
      }
      // 'default' — never asked yet.
      if (isStaffSide) {
        setState(sessionStorage.getItem(STAFF_DISMISS_KEY) ? 'banner' : 'prompt');
      } else {
        const dismissedAt = Number(localStorage.getItem(CUSTOMER_DISMISS_KEY) ?? 0);
        setState(dismissedAt && Date.now() - dismissedAt < CUSTOMER_RETRY_MS ? 'ok' : 'prompt');
      }
    })();
    return () => { active = false; };
  }, [isStaffSide]);

  const activate = async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      if (result === 'subscribed') {
        setState('ok');
        setGuideOpen(false);
        notify('اعلان‌های این دستگاه فعال شد؛ از این پس رویدادهای مهم را همان لحظه دریافت می‌کنید.', 'success');
      } else if (result === 'denied') {
        setState('denied');
        setGuideOpen(true);
      } else if (result === 'server-off') {
        setState('server-off');
        notify('اعلان لحظه‌ای فعلاً در تنظیمات سامانه خاموش است؛ اعلان‌ها داخل سامانه (زنگولهٔ بالای صفحه) نمایش داده می‌شوند.', 'error');
      } else if (result === 'insecure') {
        setState('insecure');
      } else {
        notify('فعال‌سازی اعلان ناموفق بود؛ دوباره تلاش کنید.', 'error');
      }
    } finally { setBusy(false); }
  };

  const dismiss = () => {
    if (isStaffSide) {
      sessionStorage.setItem(STAFF_DISMISS_KEY, '1');
      setState('banner');
    } else {
      localStorage.setItem(CUSTOMER_DISMISS_KEY, String(Date.now()));
      setState('ok');
    }
  };

  if (state === 'checking' || state === 'ok' || state === 'server-off') return null;

  const deniedGuide = (
    <Modal open={guideOpen} onClose={() => setGuideOpen(false)} title="راهنمای فعال‌سازی اعلان در مرورگر"
      footer={<Button onClick={() => setGuideOpen(false)}>متوجه شدم</Button>}>
      <div className="space-y-3 text-sm leading-7 text-navy-700">
        <p>مرورگر شما اعلان‌های این سامانه را مسدود کرده است. برای بازکردن آن:</p>
        <ol className="list-decimal space-y-1.5 pr-5">
          <li>کنار نوار نشانی مرورگر، روی آیکون قفل (یا «تنظیمات سایت») کلیک کنید.</li>
          <li>گزینهٔ «اعلان‌ها» (Notifications) را روی «مجاز» (Allow) بگذارید.</li>
          <li>صفحه را تازه‌سازی (F5) کنید و دکمهٔ «فعال‌سازی اعلان‌ها» را بزنید.</li>
        </ol>
        <p className="text-xs text-navy-500">
          در ویندوز همچنین مطمئن شوید در تنظیمات ویندوز، بخش Notifications، اعلان‌های مرورگر شما روشن است و حالت «مزاحم نشوید» (Focus) خاموش است.
        </p>
      </div>
    </Modal>
  );

  if (state === 'prompt') {
    return (
      <Modal open onClose={dismiss} title="فعال‌سازی اعلان‌ها"
        footer={(
          <>
            <Button variant="ghost" onClick={dismiss}>بعداً</Button>
            <Button loading={busy} onClick={() => void activate()}>
              <BellRing className="size-4" /> فعال‌سازی اعلان‌ها
            </Button>
          </>
        )}>
        <div className="space-y-3 text-sm leading-7 text-navy-700">
          <p className="flex items-start gap-2">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-accent ring-1 ring-brand-100">
              <BellRing className="size-5" />
            </span>
            <span>
              {isStaffSide ? (
                <>
                  برای کارکنان دفتر، روشن‌بودن اعلان‌ها <b>الزامی</b> است؛ ارجاع پروندهٔ جدید، پیام مشتری،
                  یادآوری پیگیری و تحویل‌ها فقط با اعلان به‌موقع می‌رسند. اگر الان فعال نکنید، این یادآوری در هر ورود دوباره نمایش داده می‌شود.
                </>
              ) : (
                <>
                  با فعال‌کردن اعلان‌ها، تغییر مرحلهٔ پرونده، پاسخ پشتیبانی، فاکتور جدید و لحظهٔ تحویل کار را
                  همان موقع روی همین دستگاه می‌بینید و لازم نیست مدام سامانه را بررسی کنید.
                </>
              )}
            </span>
          </p>
          <p className="text-xs text-navy-500">بعد از کلیک، مرورگر از شما اجازه می‌خواهد؛ گزینهٔ «Allow / مجاز» را بزنید.</p>
        </div>
      </Modal>
    );
  }

  // banner / denied / insecure — persistent slim reminder (staff side only reaches here).
  return (
    <>
      {deniedGuide}
      <div className="fixed inset-x-3 bottom-20 z-40 sm:inset-x-auto sm:right-4 sm:w-[24rem] lg:bottom-6" role="alert">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 shadow-xl">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-950">اعلان‌های این دستگاه فعال نیست</p>
            <p className="mt-0.5 text-[11px] leading-5 text-amber-900/80">
              {state === 'insecure'
                ? 'روی این نشانی (شبکهٔ محلی بدون HTTPS) مرورگر اجازهٔ اعلان نمی‌دهد. سامانه را روی همین رایانه با نشانی localhost یا از نشانی امن (HTTPS) باز کنید، یا اعلان‌ها را از زنگولهٔ بالای صفحه دنبال کنید.'
                : state === 'denied'
                  ? 'مرورگر اعلان‌ها را مسدود کرده است؛ ممکن است ارجاع یا پیام جدید را از دست بدهید.'
                  : 'برای دریافت فوری ارجاع‌ها، پیام‌های مشتریان و یادآوری‌ها، اعلان‌ها را فعال کنید.'}
            </p>
            <div className="mt-2 flex gap-2">
              {state === 'denied' ? (
                <Button size="sm" onClick={() => setGuideOpen(true)}>راهنمای فعال‌سازی</Button>
              ) : state !== 'insecure' ? (
                <Button size="sm" loading={busy} onClick={() => void activate()}>
                  <BellRing className="size-4" /> فعال‌سازی
                </Button>
              ) : null}
              <button type="button" aria-label="بستن یادآوری"
                className="grid size-8 place-items-center rounded-lg text-amber-800 transition hover:bg-amber-100"
                onClick={() => setState('ok')}>
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
