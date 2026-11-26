/**
 * The guided tours («راهنمای تصویری») — one catalogue for web and Android.
 *
 * Why the copy sits on the server: the two clients must explain the same screen
 * in the same words, and a release on Google Play is slow. A wording fix here
 * reaches the app on its next launch. What deliberately stays *out* of here is
 * geometry — the server says which element to point at (`target`), the client
 * decides where it is, how the spotlight is drawn and which side of it the card
 * fits, because only the client knows the viewport.
 *
 * A step whose `target` is not on screen is skipped by the client, which is what
 * lets one tour span several screens (Android's request wizard and the web
 * service page share `customer-request` without either implementing the other's
 * steps).
 */

export interface TourStep {
  /** Stable id — the client's `data-tour` attribute / Android tour key. */
  id: string;
  /** The element to spotlight. Same string on both platforms. */
  target: string;
  /**
   * Fallbacks, tried in order when `target` is not on screen.
   *
   * Not a courtesy to the other platform: the same idea sits in a different
   * place in the two layouts (the Android wizard has its own «انتخاب از مدارک
   * پروفایل» row, the web form folds it into the document block), so a step
   * names the ideal anchor and then the one that exists here. A step with no
   * anchor at all is skipped, which is the rule that keeps a wrong pointer
   * from ever appearing.
   */
  altTargets?: string[];
  title: string;
  body: string;
  /**
   * Only relevant on this route (web). Android ignores it, because a screen that
   * is not open simply has no registered target.
   */
  route?: string;
  /** Where the card should sit relative to the target; a hint for the client. */
  placement?: 'top' | 'bottom' | 'start' | 'end';
  /**
   * The step is a thing to *do*, not a thing to read: the client keeps the
   * spotlight on the control and waits for it to be used before advancing.
   */
  interactive?: boolean;
}

export interface TourHint {
  key: string;
  /** The element to nudge the eye towards, if the client has one. */
  target: string;
  /** Tried in order when `target` is absent, as in a tour step. */
  altTargets?: string[];
  title: string;
  /** One sentence. A tip that needs two is a tour, and a tour is the wrong answer to a mistake. */
  body: string;
}

export interface Tour {
  code: string;
  label: string;
  audience: 'customer' | 'office';
  /** Screen the tour belongs to; used to decide when it may auto-start. */
  anchor: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    code: 'customer-request',
    label: 'ثبت درخواست خدمت',
    audience: 'customer',
    anchor: 'service-detail',
    steps: [
      {
        id: 'start',
        target: 'tour:service-start',
        title: 'از همین‌جا شروع می‌شود',
        body: 'پس از خواندن توضیح خدمت، دکمهٔ «ثبت درخواست» شما را به فرم می‌برد؛ نیازی به جست‌وجوی منو نیست.',
        placement: 'bottom',
      },
      {
        id: 'fields',
        target: 'tour:request-form',
        title: 'فقط فیلدهای ستاره‌دار الزامی‌اند',
        body: 'هرچه را که نمی‌دانید خالی بگذارید؛ کارشناس مسئول پرونده در گفت‌وگو از شما می‌پرسد. فرم با همان اطلاعات ذخیره و ادامه می‌یابد.',
        placement: 'top',
      },
      {
        id: 'documents',
        target: 'tour:request-documents',
        title: 'مدرک را اینجا بگذارید، نه در پیام',
        body: 'برای هر نیازمندی یک خانه جدا هست. مدرکی که در گفت‌وگو فرستاده شود به پرونده وصل نمی‌شود و دوباره از شما خواسته می‌شود.',
        placement: 'top',
      },
      {
        id: 'documents-profile',
        // One name on both clients for «take a document I already sent»: the
        // control is the same idea in a different place, so the fallback list is
        // what lets a single catalogue frame it correctly in either layout.
        target: 'tour:profile-document-picker',
        altTargets: ['tour:request-documents'],
        title: 'اول از مدارک پروفایل بردارید',
        body: 'اگر مدرکی را قبلاً فرستاده‌اید، از فهرست «مدارک من» انتخابش کنید؛ دوباره عکس گرفتن لازم نیست و کیفیت مدرک هم افت نمی‌کند.',
        placement: 'top',
      },
      {
        id: 'price',
        target: 'tour:request-price',
        title: 'قیمت پیش از ثبت، قطعی است',
        body: 'مبلغ، حق‌الزحمهٔ فوری و تخفیف‌ها همین‌جا نوشته می‌شود. پس از ثبت، فاکتور همان عدد را دارد.',
        placement: 'top',
      },
      {
        id: 'submit',
        target: 'tour:request-submit',
        title: 'ثبت، و بعد کد پیگیری',
        body: 'پس از زدن «ثبت نهایی» کد پیگیری را نشان می‌دهیم؛ با همان کد می‌توانید وضعیت را دنبال کنید یا دربارهٔ همان پرونده پیام بدهید.',
        placement: 'top',
      },
    ],
  },
  {
    code: 'customer-profile',
    label: 'مشخصات و مدارک',
    audience: 'customer',
    anchor: 'profile',
    steps: [
      {
        id: 'prefill',
        target: 'tour:profile-form',
        title: 'بیشترش پر شده است',
        body: 'نام، کد ملی و اطلاعاتی که در ثبت‌نام دادید اینجا از پیش آمده است؛ فقط خانه‌های خالی را کامل کنید.',
        placement: 'bottom',
      },
      {
        id: 'reuse',
        target: 'tour:profile-documents',
        // On a screen where the archive itself is not open, the picker inside
        // the request form is the same idea one tap away.
        altTargets: ['tour:profile-document-picker'],
        title: 'یک بار بفرستید، همیشه استفاده کنید',
        body: 'مدرک تأییدشده در پروفایل ماند و در ثبت درخواست‌های بعدی خودش پیشنهاد می‌شود.',
        placement: 'top',
      },
    ],
  },
  {
    code: 'office-case',
    label: 'گردش کار پرونده',
    audience: 'office',
    anchor: 'case-detail',
    steps: [
      {
        id: 'timeline',
        target: 'tour:case-timeline',
        title: 'اینجا سابقهٔ کامل پرونده است',
        body: 'هر تغییر وضعیت، مدارک، پیام و یادداشت با نام و زمان ثبت شده است. پیش از هر تصمیم، این فهرست را ببینید.',
        placement: 'bottom',
      },
      {
        id: 'documents',
        target: 'tour:case-documents',
        title: 'تأیید، مدرک‌به‌مدرک',
        body: 'دکمهٔ تأیید برای هر مدرک جداست. «تأیید مرحله» تنها وقتی باز می‌شود که همهٔ مدارک الزامی آخرین نسخهٔ تأییدشده را داشته باشند.',
        placement: 'top',
      },
      {
        id: 'step',
        target: 'tour:case-advance',
        title: 'یک مرحله، یک قدم',
        body: '«تأیید مرحله» پرونده را یک مرحله جلو می‌برد و مشتری را بی‌صدا باخبر می‌کند؛ پرش بین مرحله‌ها ممکن نیست تا سابقه گم نشود.',
        placement: 'top',
        interactive: true,
      },
      {
        id: 'chat',
        target: 'tour:case-chat',
        title: 'سؤال؟ از همین‌جا و به همین پرونده',
        body: 'گفت‌وگویی که از این دکمه باز شود به همین پرونده وصل است؛ پاسخ مشتری هم مستقیم به همین صفحهٔ شما می‌آید.',
        placement: 'top',
      },
      {
        id: 'assign',
        target: 'tour:case-assign',
        title: 'مسئول نداشته باشد، گیر می‌کند',
        body: 'از همین‌جا واگذار کنید یا به صف آزاد برگردانید. تا وقتی پرونده‌ای مسئول نداشته باشد، کارش روی میز هیچ‌کس نیست.',
        placement: 'top',
      },
    ],
  },
  {
    code: 'office-chat',
    label: 'گفت‌وگو با مشتری',
    audience: 'office',
    anchor: 'messages',
    steps: [
      {
        id: 'list',
        target: 'tour:chat-list',
        title: 'هر گفت‌وگو، یک پرونده',
        body: 'کد پرونده روی هر ردیف نوشته شده است؛ گفت‌وگوی عمومی با گفت‌وگوی یک پرونده قاطی نمی‌شود.',
        placement: 'bottom',
      },
      {
        id: 'case-chip',
        target: 'tour:chat-case',
        title: 'یک لمس، خودِ پرونده',
        body: 'با نوار بالای گفت‌وگو به صفحهٔ همان پرونده می‌روید؛ مدرک و وضعیت همان‌جا هست.',
        placement: 'bottom',
      },
      {
        id: 'composer',
        target: 'tour:chat-composer',
        title: 'بنویسید و بفرستید',
        body: 'پیام شما برای مشتری هم در پنل و هم روی گوشی‌اش اعلام می‌شود؛ لازم نیست منتظر بمانید تا خودش سر بزند.',
        placement: 'top',
      },
    ],
  },
];

/**
 * The tips.
 *
 * These are the whole point of calling the tour «smart»: they are not shown by a
 * tour, they are shown by a *pattern*. A client reports «the user did the thing
 * we expect them not to do», and `service.ts` decides whether that pattern is
 * established enough to interrupt for. Which is also why the wording is a nudge
 * and not a lecture — nobody reads a lecture after being told they erred.
 */
export const TOUR_HINTS: TourHint[] = [
  {
    key: 'document-from-profile',
    target: 'tour:profile-document-picker',
    altTargets: ['tour:request-documents', 'tour:case-documents'],
    title: 'مدرک را از پروفایل بردارید',
    body: 'فایل همین مدرک در «مدارک من» هست؛ از فهرست انتخابش کنید، دوباره گرفتنِ عکس لازم نیست.',
  },
  {
    key: 'confirm-before-document',
    target: 'tour:request-documents',
    altTargets: ['tour:request-submit', 'tour:case-documents'],
    title: 'اول مدرک، بعد تأیید',
    body: 'تا نیازمندی‌های ستاره‌دار پر نشده‌اند، «ثبت نهایی» پرونده را جلو نمی‌برد.',
  },
  {
    key: 'document-in-chat',
    target: 'tour:chat-composer',
    title: 'مدرک را در گفت‌وگو نفرستید',
    body: 'فایلِ پیام به پرونده وصل نمی‌شود؛ آن را در خانهٔ همان مدرک در صفحهٔ پرونده بگذارید.',
  },
  {
    key: 'unassigned-case',
    target: 'tour:case-assign',
    title: 'این پرونده مسئول ندارد',
    body: 'تا واگذار نشود، در هیچ میز کاری دیده نمی‌شود؛ از همین‌جا بردارید یا به همکار بسپارید.',
  },
  {
    key: 'profile-incomplete',
    target: 'tour:profile-form',
    title: 'چند خانهٔ پروفایل خالی است',
    body: 'با کامل‌کردن این‌ها، فرم درخواست‌های بعدی خودش پر می‌شود.',
  },
];

export function tourByCode(code: string): Tour | undefined {
  return TOURS.find((tour) => tour.code === code);
}

export function hintByKey(key: string): TourHint | undefined {
  return TOUR_HINTS.find((hint) => hint.key === key);
}

/** Copy overrides from settings win over the built-in text, field by field. */
export function applyTourOverrides(tours: Tour[], hints: TourHint[], override: Record<string, any>): { tours: Tour[]; hints: TourHint[] } {
  const tourOverrides = override?.tours ?? {};
  const hintOverrides = override?.hints ?? {};
  const mapText = <T extends { title: string; body: string }>(step: T, text: any): T => ({
    ...step,
    ...(typeof text?.title === 'string' && text.title.trim() ? { title: text.title.trim() } : {}),
    ...(typeof text?.body === 'string' && text.body.trim() ? { body: text.body.trim() } : {}),
  });
  return {
    tours: tours.map((tour) => {
      const forTour = tourOverrides[tour.code] ?? {};
      const steps = tour.steps.map((step) => mapText(step, forTour?.[step.id]));
      return typeof forTour?.label === 'string' && forTour.label.trim()
        ? { ...tour, label: forTour.label.trim(), steps }
        : { ...tour, steps };
    }),
    hints: hints.map((hint) => mapText(hint, hintOverrides[hint.key])),
  };
}
