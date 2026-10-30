# ممیزی منطق و گردش‌کار پشکان

- مخزن: `khajavy8056/Pishkan`
- شاخه: `arena/3ec9e234-pishkan`
- Commit استخراج: `ab145955a23fe547f700803b7432eb26fa356ad4`
- دامنه: منطق کسب‌وکار، رفتار نقش‌ها، UI/API، request state machine، seed catalog، مالی، پیام/دستیار و آزمون‌های مخزن.
- ورودی runtime: پایگاه‌داده تولیدی، تنظیمات جاری، secrets و provider credentials **خوانده نشدند**.

## پوشش عددی

| سنجه | تعداد |
|---|---:|
| شاخه‌های اصلی موضوعی | 13 |
| گره‌های کسب‌وکار/قانون/عملیات/وضعیت/ریسک | 335 |
| ارتباط‌ها | 720 |
| جریان‌های نمایشی | 7 |
| statusهای واقعی request | 10 |
| transitionهای مجاز استخراج‌شده از map | 31 |
| قالب‌های seed نصب | 30 در 3 دسته |
| فایل‌های آزمون/پذیرش tracked که به‌عنوان شاهد جست‌وجو شدند | 21 |
| یافته‌های کسب‌وکار اولویت‌بندی‌شده | 15 |

## جریان انتها‌به‌انتها

1. مهمان صفحه عمومی را باز می‌کند؛ bootstrap تنظیمات/دسته‌ها/خدمات/روش login را می‌آورد. جست‌وجو و دسته/مرتب‌سازی روی catalog عمومی انجام می‌شود. جزئیات خدمت می‌تواند نمونه قیمت/مدت/مدرک نشان دهد.
2. برای submit مشتری باید نشست customer داشته باشد. OTP/password بر اساس تنظیمات؛ OTP دارای limit/cooldown/TTL/max attempts/one-use؛ staff MFA می‌تواند TOTP باشد. مقصد: مشتری ناقص → profile، customer کامل → `/app`، admin → `/admin`، accountant → `/staff/accounting`، staff → `/staff`.
3. Quote و submit هر دو server-side خدمت/پروفایل/پوشش/اولویت را بررسی می‌کنند. فرم از schema خدمت validate می‌شود؛ فایل upload و ownership بررسی می‌شود. saved `customer_records` وجود دارد ولی auto-fill در booking form مشاهده نشد.
4. `POST /api/requests`: idempotency HMAC keyed by customer+key+payload؛ transaction، request `new` + `payment_status=unpaid` + snapshot و tracking code. اگر total>0 invoice ساخته می‌شود؛ بعد `autoAssign` فراخوانی می‌شود؛ اعلان request-created پس از آن تلاش می‌شود.
5. **نکته مهم واقعی:** پرداخت gate ساخت/ارجاع/claim نیست. پرونده unpaid می‌تواند assignment/صف شود؛ تأیید پرداخت فقط payment_status را به‌روزرسانی می‌کند، نه request.status.
6. صف: `queue`، عدم candidate، auto assignment; candidates با active status, accepts_new_cases, skill/service linkage, load, max load و optional shift. برای claim، transaction/no-op row lock + conditional update و conflict رقابتی وجود دارد. پس از auto/claim notification مستقیم به assignee دیده نشد؛ manual assign آن را دارد.
7. کارمند پرونده را بررسی، یادداشت، مدارک را بازبینی یا نتیجه را بارگذاری می‌کند. deliver حداقل فایل+summary می‌خواهد، status را `under_review` می‌کند و مدیریت را handoff می‌دهد. مدیریت فایل‌ها را approve/return می‌کند؛ پس از approval، تغییر `ready/completed` هنوز عملیات دستی manager است و notification از status route صادر می‌شود.
8. وضعیت پرداخت و پرونده دو ماشین مجزا هستند. زرین‌پال request/verify سمت سرور و amount از invoice انجام می‌شود. callback غیر `OK` می‌تواند payment را pending نگه دارد؛ retry ممکن است authority pending را reuse کند. نقدی/POS/انتقال در صورت setting و permission به‌صورت دستی ثبت می‌شود. Refund/void جدا هستند و لغو request خودکار refund نمی‌کند.

## ماشین حالت درخواست

نام وضعیت‌ها و transitionها از `apps/api/src/modules/requests/service.ts` استخراج شده‌اند: `new`, `assigned`, `in_progress`, `waiting_documents`, `waiting_customer`, `under_review`, `ready`, `completed`, `cancelled`, `rejected`. نمودار state machine در HTML تمام یال‌های map را نشان می‌دهد. completed/cancelled/rejected terminal هستند؛ route بازگشایی مشاهده نشد. `ready` و `completed` نیازمند office scope و `requests.approve` هستند و completion علاوه بر مدارک، handoffهای pending و فایل staff تأییدنشده را کنترل می‌کند.

## کاربران، نقش و پشتیبانی

- پنل مشتری: داشبورد، درخواست‌ها/تایم‌لاین/لغو محدود به وضعیت، پروفایل/records، فایل، offer، invoice/payment، thread، notification و session security.
- کارکنان: workbench و assigned scope؛ نقش‌های پیش‌فرض شامل service_expert/operator/document_reviewer/accountant؛ manager/super_admin office-level controls.
- نقش‌ها و permission strings از `apps/api/src/lib/permissions.ts` و snapshot نقش‌ها استخراج شده؛ role سفارشی قابل ساخت/ویرایش است، بنابراین ماتریس live ممکن است با defaultها فرق کند.
- گفت‌وگوها general یا request-scoped، با owner/assignment/office access، read/unread و فایل. WebSocket/SSE برای thread زنده دیده نشد؛ shell بعضی counts را poll می‌کند.
- Assistant: builtin catalog search و optional OpenAI-compatible (فقط context کاتالوگ/آخرین history محدود، timeout 15s، fallback). دسترسی مستقیم وضعیت پرونده ندارد و operation واقعی نمی‌سازد؛ handoff فقط پیشنهاد/لینک message center است.

## کاتالوگ و گزینه خدمت

30 قالب کاتالوگ از `SEED_SERVICES` با category/title/slug/form/docs/workflow اختصاصی در HTML/JSON آمده‌اند. source خود seed صریحاً price/duration/documents را sample و `needs_review` می‌داند. seed هنگام install admin edits را overwrite نمی‌کند، بنابراین قالب‌ها وضعیت فعلی database را اثبات نمی‌کنند. وضعیت جاری، قیمت رسمی یا متولی بیرونی برای هر خدمت از این استخراج مشخص نیست. جریان dynamic form/state machine عمومی است؛ workflow_steps به‌تنهایی engine اختصاصی هر خدمت نیست.

سیاست‌های واقعاً کدنویسی‌شده: fee/discount درصدی خدمت، tax، urgent surcharge/capacity/days، city coverage، payment methods و per-service form/doc/workflow. coupon/campaign/referral reward در source بررسی‌شده پیدا نشد.

## یافته‌ها و پیشنهادهای اولویت‌دار

### R-001 · P1 — ثبت/تخصیص پرونده به پرداخت وابسته نیست

**وضعیت:** `confirmed-gap`<br>
درخواست با payment_status=unpaid ساخته می‌شود؛ createRequest بلافاصله autoAssign را اجرا می‌کند. موفقیت پرداخت فقط payment_status را عوض می‌کند و state/status را نه. اگر کسب‌وکار قبل از شروع/ارجاع وجه می‌خواهد، صف و عملیات فعلی آن را enforce نمی‌کند.

**پیشنهاد:** تصمیم کسب‌وکار را صریح کنید: پرداخت قبل از claim یا پرداخت بعد از بررسی. سپس state/payment gate، UI، reconciliation و آزمون backend را هماهنگ کنید؛ صرف UI disable کافی نیست.

**شواهد:** `apps/api/src/modules/requests/service.ts:422`, `apps/api/src/modules/requests/service.ts:460`, `apps/api/src/modules/accounting/service.ts:287`, `apps/api/tests/requests.test.ts:89`
### R-002 · P1 — سیاست required documents به همه مدارک الزام‌شده نگاشت نمی‌شود

**وضعیت:** `confirmed-risk`<br>
در require_document_approval فقط pending=0 و برای requiredDocs حداقل یک approved بررسی می‌شود؛ تعداد/هویت تمام مدارک required خدمت با مدارک approved تطبیق داده نمی‌شود.

**پیشنهاد:** مدارک required را با document kind/key اجباری ذخیره و هرکدام را جداگانه gate کنید؛ آزمون چندمدرکی و missing-one اضافه شود.

**شواهد:** `apps/api/src/modules/requests/service.ts:639`, `apps/api/src/modules/requests/service.ts:634`, `apps/api/audit/requirements.acceptance.test.ts`
### R-003 · P1 — پاسخ ناموفق زرین‌پال transaction را failure نمی‌کند

**وضعیت:** `confirmed-gap`<br>
callback با Status!=OK/نتیجه verify ناموفق transaction pending می‌ماند؛ callback به صفحه unconfirmed برمی‌گردد و retry ممکن است همان authority را reuse کند. reconcile/timeout-to-failed در این مسیر دیده نشد.

**پیشنهاد:** وضعیت callback cancelled/failure، expiry/void و retry-safe state را ذخیره کنید؛ reconciliation job و راهنمای finance برای pending ماندگار اضافه شود.

**شواهد:** `apps/api/src/modules/accounting/zarinpal.ts:56`, `apps/api/src/modules/accounting/zarinpal.ts:36`
### R-004 · P1 — Required manual review: نمونه‌های seed ممکن است مانند تعهد رسمی دیده شوند

**وضعیت:** `confirmed-risk`<br>
خدمت‌های seed با `needs_review=1` و contact notice نمونه ساخته می‌شوند؛ فرم/UI قیمتی نشان می‌دهد اما مبلغ رسمی/تعرفه سازمانی از سورس تضمین نمی‌شود.

**پیشنهاد:** قبل از انتشار هر کاتالوگ، owner آن را تأیید و needs_review را کنترل کند؛ در UI نمونه بودن و نیاز بررسی تا تأیید نهایی واضح باشد.

**شواهد:** `apps/api/src/modules/catalog/seed-data.ts:4`, `apps/api/src/modules/catalog/seed.ts:72`, `apps/api/src/routes/public.ts:94`
### R-005 · P2 — Workflow service به موتور وضعیت وصل نشده

**وضعیت:** `confirmed-gap`<br>
workflow_steps در snapshot/read مدل دراختیار UI است؛ `current_step` فقط هر transition به in_progress افزایش می‌یابد و transition خاص برای هر مرحله تعریف نشده. role/requiresDocument در template، guard اجرای engine نیست.

**پیشنهاد:** یا workflow را به‌عنوان راهنمای غیرالزام‌آور با همین برچسب نگه دارید، یا step engine واقعی با current_step/roles/doc gate/test طراحی کنید.

**شواهد:** `apps/api/src/modules/catalog/seed-data.ts:19`, `apps/api/src/modules/requests/service.ts:654`, `apps/api/src/modules/requests/service.ts:523`
### R-006 · P2 — مدرک required به‌صورت تکمیل موردی، نه همه مدارک، بررسی می‌شود

**وضعیت:** `confirmed-risk`<br>
کاتالوگ هر خدمت می‌تواند چند required document داشته باشد؛ check completion اگر هر تعداد required template وجود داشته باشد، شرط approved-count > 0 است.

**پیشنهاد:** (مکمل R-002) ارتباط هر requirement با document type و state لازم اضافه شود.

**شواهد:** `apps/api/src/modules/requests/service.ts:636`, `apps/api/src/modules/catalog/service.ts`
### R-007 · P2 — انقضای پیشنهاد اختصاصی فاکتور را خودکار void نمی‌کند

**وضعیت:** `confirmed-risk`<br>
در accept expired مسیر offer را expired می‌کند اما invoice قبلی را void نمی‌کند؛ reject مسیر voidInvoice دارد. فاکتور جاری می‌تواند برای پیشنهاد منقضی باقی بماند.

**پیشنهاد:** در expire transaction فاکتور را لغو یا وضعیت offer/invoice را هماهنگ کنید و آزمون expiry بنویسید.

**شواهد:** `apps/api/src/routes/catalog.ts:291`, `apps/api/src/routes/catalog.ts:342`
### R-008 · P2 — مدارک ذخیره‌شده در پروفایل به فرم سفارش prefill نمی‌شوند

**وضعیت:** `confirmed-gap`<br>
API customer_records و صفحه پروفایل موجودند؛ ServiceDetailPage در load فقط initial empty value می‌سازد و submit رکوردها را نمی‌خواند؛ مشتری ممکن است داده تکراری وارد کند.

**پیشنهاد:** keyهای رکورد را با field schema نگاشت، انتخاب مشتری‌محور و explicit consent برای prefill اضافه کنید؛ از ذخیره/نمایش حساس بی‌مورد پرهیز شود.

**شواهد:** `apps/api/src/routes/customers.ts:38`, `apps/web/src/pages/public/Services.tsx:175`, `apps/web/src/pages/customer/CustomerPages.tsx:822`
### R-009 · P2 — ایمیل در تنظیمات تعریف شده ولی ارسال در notification path دیده نشد

**وضعیت:** `confirmed-absence`<br>
SMTP/email.enabled تنظیم می‌شود ولی NotifyInput.email مصرف نشده و sender پیدا نشد؛ صاحب کسب‌وکار نباید ایمیل را channel ارسال‌شده فرض کند.

**پیشنهاد:** sender واقعی و test/status/dedupe پیاده کنید یا تنظیمات email را با برچسب reserved/unused نمایش دهید.

**شواهد:** `apps/api/src/modules/settings/definitions.ts:140`, `apps/api/src/modules/notifications/service.ts:7`, `apps/api/src/modules/notifications/service.ts:18`
### R-010 · P2 — کد تخفیف/کمپین/معرفی مشتری پیدا نشد

**وضعیت:** `not-found`<br>
فقط درصد تخفیف بر خدمت و تخفیف custom offer موجود است؛ کد کمپین، تاریخ/سقف مصرف و پاداش referral در کد مشاهده نشد.

**پیشنهاد:** اگر الزام کسب‌وکار است، به‌صورت feature مستقل با مدل مصرف، تاریخ، محدودیت customer، audit و تست رقابت تعریف شود.

**شواهد:** `apps/api/src/modules/catalog/service.ts:58`, `apps/api/src/modules/accounting/service.ts:50`
### R-011 · P2 — سفارش‌سازی خانه و handoff خودکار assistant به thread دیده نشد

**وضعیت:** `not-found`<br>
Home کد-محور/تنظیماتی است؛ assistant فقط handoffSuggested و لینک پیام می‌دهد، thread ایجاد نمی‌کند.

**پیشنهاد:** اگر نیاز عملیاتی دارید، CMS کنترل‌شده و API ایجاد thread همراه با انتقال context/رضایت مشتری طراحی شود.

**شواهد:** `apps/web/src/pages/public/Home.tsx:14`, `apps/api/src/modules/assistant/service.ts:15`, `apps/api/src/routes/messages.ts:88`
### R-012 · P3 — تخصیص خودکار/claim notification کارمند یکنواخت نیست

**وضعیت:** `confirmed-gap`<br>
manual assign پیام به کارمند می‌فرستد؛ autoAssign/claim route پس از موفقیت پیام user assignee نمی‌فرستند. assigned event ثبت می‌شود اما ممکن است کارمند اعلان جدید نگیرد.

**پیشنهاد:** یک رویداد assignment مشترک/idempotent برای auto/manual/claim تعریف و tests برای recipient notification اضافه شود.

**شواهد:** `apps/api/src/modules/requests/service.ts:254`, `apps/api/src/modules/requests/service.ts:812`, `apps/api/src/routes/requests.ts:206`
### R-013 · P3 — پایان شیفت/رد/timeout موجب reassignment خودکار نمی‌شود

**وضعیت:** `not-found`<br>
کاندید eligibility به شیفت کنونی و ظرفیت توجه دارد؛ پس از تخصیص، بررسی دوره‌ای off-shift/عدم پذیرش، claim expiry یا reassignment در مسیر دیده نشد.

**پیشنهاد:** SLA و ownership در پایان شیفت مشخص شود؛ task زمان‌بندی‌شده و audit event (یا صریحاً manual policy) تعریف گردد.

**شواهد:** `apps/api/src/modules/requests/service.ts:174`, `apps/api/src/modules/requests/service.ts:670`
### R-014 · P3 — لغو پرونده مالی را به بازپرداخت/ابطال فاکتور وصل نمی‌کند

**وضعیت:** `confirmed-gap`<br>
customerCancel فقط status را cancelled می‌کند. هیچ void/refund call ندارد؛ refund قابل انجام از endpoint جدا و permission/setting/window دارد.

**پیشنهاد:** سیاست لغو و مالی را تعریف کنید؛ prompt/approval، مانده/بازپرداخت و اعلان وضعیت واحد را به هم متصل کنید.

**شواهد:** `apps/api/src/modules/requests/service.ts:744`, `apps/api/src/modules/accounting/service.ts:359`, `apps/api/src/modules/accounting/service.ts:185`
### R-015 · P3 — قیمت و وضعیت محیط واقعی بدون DB/درگاه زنده بررسی نشده

**وضعیت:** `unknown`<br>
این نقشه source/seed/SQLite migration/tests را بررسی می‌کند؛ دیتابیس یا settings تولیدی، حساب واقعی Zarinpal/SMS/LLM و فهرست فعال runtime را نخوانده است.

**پیشنهاد:** صاحب سامانه در محیط staging، ۳۰ template/قیمت/مدرک/فعال‌بودن، test payment, SMS delivery, office notifications را تأیید کند؛ secrets در فایل نقشه وارد نشود.

**شواهد:** `apps/api/src/modules/catalog/seed.ts:65`, `apps/api/src/modules/accounting/zarinpal.ts:27`, `apps/api/src/modules/sms/provider.ts:412`

## وضعیت آزمون

آزمون‌های موجود به‌صورت شاهد در نمودار به فایل و عنوان تست وصل شده‌اند؛ generator آزمون کسب‌وکار یا adapter live نمی‌سازد. اعتبارسنجی این snapshot: `npm test` موفق، ۱۸ فایل/۱۰۰ تست API و ۲ فایل/۱۷ تست Web؛ `npm run typecheck` و `npm run build` نیز موفق. آزمون پذیرش opt-in با `cd apps/api && npx vitest run --config audit.config.ts` جداگانه اجرا شد و هر ۱۶ assertion در `requirements.acceptance.test.ts` پاس شد. گرچه header آن را release blocker می‌نامد، در این commit نباید آن را گزارش fail کرد. این آزمون‌ها از DB موقت/provider mock استفاده می‌کنند و delivery زندهٔ SMS/زرین‌پال/SMTP/LLM را اثبات نمی‌کنند. HTML مستقل در Chromium واقعی (نمای overview، tree request، search، role filter، نمودار مالی، زوم و viewport موبایل) باز و smoke-test شد؛ خطای JavaScript مرورگر صفر بود.

## محدودیت‌های ممیزی

- هیچ DB تولیدی/تنظیم زنده/مشتری/Secret/کلید provider خوانده نشد؛ runtime catalog به seed template قابل فروکاستن نیست.
- وجود adapter یا test mock، ارسال SMS/تراکنش واقعی/توافق خدمت با سازمان بیرونی را اثبات نمی‌کند.
- منطق قابل‌مشاهده از کد و tests استخراج شده؛ رفتار deployment، هر branch اجرایی و هر custom role exhaustively live-test نشده.
- تمام اختلاف‌های «نیافت شد» به معنی عدم وجود در snapshot بررسی‌شده است؛ ممکن است فرایند دستی خارج سامانه باشد.
- نمودار فقط از شواهد source ساخته می‌شود؛ برای تصمیم‌های P1 به‌خصوص سیاست دریافت پول پیش/پس از کار، مالک کسب‌وکار باید policy را تعیین کند.

## فایل‌های خروجی

- `Pishkan-Business-Logic-Map.html` — نقشهٔ فارسی، مستقل، قابل جست‌وجو/فیلتر/بازوبسته و چاپ/PDF.
- `Pishkan-Business-Logic-Data.json` — گراف کامل، شواهد، نقش‌ها، وضعیت‌ها، ۳۰ قالب seed و findings؛ JSON همین فایل در HTML inline شده.
- `Pishkan-Business-Logic-Audit.md` — همین گزارش.
- generator: `tools/generate_pishkan_business_logic.py`؛ بعد از `npm ci` در ریشه `python3 tools/generate_pishkan_business_logic.py` خروجی‌ها را می‌سازد.
