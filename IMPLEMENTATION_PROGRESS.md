# وضعیت اجرای ممیزی و اصلاح گردش درخواست‌ها

**وضعیت: پیاده‌سازی و verification محلی کامل؛ انتشار GitHub در انتظار بازبینی نهایی diff و commit/push است.** آخرین اجرای کامل: API 135/135 (۲۰ فایل)، وب 27/27 (۴ فایل)، typecheck، build، contrast، Windows selftest 36/36، PowerShell static/parser 13/13 و `git diff --check` موفق. اجرای اولیهٔ selftest یک مورد از ۳۶ را به‌دلیل LF در چهار فایل `.cmd` ثبت کرد؛ هر چهار فایل به CRLF اصلاح و اجرای نهایی 36/36 شد. PowerShell/Windows Defender Firewall و Wi‑Fi واقعی روی Linux اجرا نشده‌اند؛ Zarinpal به HTTP mock محدود است. تا push موفق کار تکمیل‌شده اعلام نمی‌شود.

## دامنه و معیارهای مأموریت

ممیزی ریشه‌ای چرخهٔ خدمت، درخواست، مدرک و پرداخت (نقدی/رایگان/آنلاین Sandbox)، پیوند ساختاریافتهٔ مدارک به مشتری/خدمت/درخواست، صف رسیدگی به مدارک pending، الزام دلیل رد و سابقهٔ بررسی، وضعیت‌های نیازمند بازبینی، ارجاع و RBAC در API، شمارنده‌های واقعی مدیر، زمان خدمت به دقیقه/ساعت/روز با تفکیک برآورد از مهلت قطعی، و دسترسی امن Windows از LAN. نسخهٔ Linux باید منطق مشترک محصول را حفظ کند. خطای کاربر باید روشن و فنی‌ها log شوند، بدون افشای دادهٔ حساس. DB محلی، رمز و دادهٔ آزمایشی نباید به Git وارد شود.

سناریوهای پذیرش: درخواست نقدی همراه مدرک؛ تأیید/رد مدرک پروفایل و جایگزینی آن؛ رفع نشانگر بازبینی؛ دسترسی مدیر و کارمند مجاز و رد کارمند غیرمجاز؛ مدت‌های ۳۰ دقیقه، ۲ ساعت، ۱ روز و ۴ ساعت؛ و اتصال گوشی در Wi‑Fi محلی. پرداخت نقدی/رایگان نباید به شناسهٔ پرداخت آنلاین وابسته باشد؛ پرداخت نقدی نباید درخواست را کامل کند.

## شاخه و PR — بررسی‌شده در 2026-10-31

- مخزن `khajavy8056/Pishkan`، شاخهٔ ثابت `arena/db057b54-pishkan`.
- HEAD: `ff2825802c5c1cee49f2e940f62358440c3e2e7f` (`fix(windows): رفع خطای JSON نصب + نصب خودکار پیش‌نیازها`).
- پس از fetch صریح، `HEAD` و `origin/arena/db057b54-pishkan` هر دو روی `ff2825802c5c1cee49f2e940f62358440c3e2e7f` هستند (`git rev-list --left-right --count` برابر `0 0`). شاخهٔ محلی upstream تنظیم‌شده ندارد؛ push نهایی به‌صورت صریح به همین شاخه انجام می‌شود. Working tree تغییرات مأموریت را دارد؛ commit و push نشده‌اند.
- PR #4 باز است؛ base شاخهٔ `arena/3ec9e234-pishkan`، عنوان «موتور تصویر و مدارک + بازطراحی رابط + نصب‌کننده و مدیر گرافیکی ویندوز (۱٫۲٫۰)»: <https://github.com/khajavy8056/Pishkan/pull/4>.
- در status جاری، فایل DB محلی یا `.env` محرمانه‌ای دیده نشد. پیش از commit/push جست‌وجوی نهایی secrets و فایل‌های تولیدی لازم است.

## وضعیت مرحله‌ها

| مرحله | وضعیت | جزئیات |
|---|---|---|
| 1. ممیزی شاخه، PR و نقطهٔ توقف | دوباره بررسی شد | روی شاخهٔ ثابت هستیم؛ HEAD و remote tracking روی `ff282580` برابرند، PR #4 باز است و upstream محلی تنظیم نیست؛ push صریح انجام می‌شود. |
| 2. مدل داده و migration | پیاده و در suite کامل SQLite آزموده شد؛ PostgreSQL واقعی اجرا نشده | migration 017 آزموده شد و زنجیرهٔ جایگزینی/سوابق review در API پوشش دارد. |
| 3. API درخواست، پرداخت و مدارک | suite کامل پاس | نقدی/رایگان/آنلاین mock، بررسی/رد با دلیل، جایگزینی، تاریخچه و حفظ تفکیک درخواست/پرداخت پوشش دارند. Zarinpal Sandbox واقعی نیست. |
| 4. صف بررسی، ارجاع و RBAC | suite کامل پاس | scoping درخواست/مدرک، محرومیت بدون `documents.view`، assignment/claim، audit و وضعیت‌ها پوشش دارند. |
| 5. UI، catalog و مدت‌ها | test/typecheck/build پاس | `formatDuration` مشترک؛ دقیقه/ساعت/روز دقیق، فرم‌های مدرک، سابقه و جایگزینی در صفحات آزموده شدند. |
| 6. Windows LAN امن | پیاده‌سازی و آزمون ایستای Linux پاس؛ Windows واقعی باز است | opt-in، loopback fail-closed، firewall محدود به Private/LocalSubnet، Public/Domain block، installer/Manager/uninstaller و مستندات. Firewall/Wi‑Fi فیزیکی اجرا نشده‌اند. |
| 7. اعتبارسنجی نهایی | verification محلی پاس؛ بازبینی diff/secrets باقی | API 135/135، web 27/27، typecheck، build، contrast، selftest 36/36، parser 13/13 و diff-check پاس؛ npm audit قبلی: 12 مورد dev، production صفر. |
| 8. انتشار | در انتظار | commit و push بدون force فقط به `arena/db057b54-pishkan`، سپس تأیید وضعیت PR #4. |

## تغییرات مهم انجام‌شده

### درخواست، پرداخت و مدارک

- جداسازی وضعیت درخواست از وضعیت پرداخت برای نقدی/رایگان/آنلاین؛ نقدی فاکتور `issued` با `payment_status=cash_due` دارد و پرداخت آنلاین/شناسهٔ آن برای ثبت درخواست لازم نیست. ثبت وجه نقد مسیر حسابداری جداست و به‌تنهایی درخواست را complete نمی‌کند.
- فایل‌های درخواست با نیازمندی سند (از جمله file-fieldهای فرم snapshot)، مشتری و درخواست پیوند ساختاریافته دارند؛ وضعیت بررسی، رد با دلیل و تاریخچهٔ reviewer نگهداری می‌شود. جایگزینی به نیازمندی ردشده وصل می‌شود و باید همان نیازمندی را پوشش دهد.
- مدرک پروفایل pending قابل استفاده در درخواست نیست تا تأیید شود؛ مدرک ردشده قابل reuse نیست. ثبت جایگزین و تاریخچهٔ بررسی/audit در service ثبت می‌شود.
- مدت تخمینی خدمت از `deadlineAt` عملیاتی جدا شده است؛ `formatDuration` helper مشترک در `apps/web/src/lib/site.tsx` است و صفحهٔ Home از همان export استفاده می‌کند.
- Zarinpal خطاهای شبکه/HTTP/JSON/ساختار/decline/callback mismatch را با metadata محدود log می‌کند؛ payload، merchant، authority، مبلغ و callback URL در log چاپ نمی‌شوند.
- مسیر درخواست نقدی در UI درخواست را ایجاد و به صفحهٔ درخواست می‌برد؛ شروع پرداخت آنلاین مسیر جدا دارد. تست Sandbox افزوده‌شده مسیر API/DB و قواعد callback/verify را می‌سنجد اما پاسخ‌های HTTP درگاه را stub می‌کند.

### RBAC، آمار و UI

- `/api/requests/stats` برای کارکنان `requests.view` می‌خواهد؛ آمار و جمع فاکتور باز با مشتری/مسئول مجاز scope می‌شوند.
- `/api/dashboard/summary` برای staff/admin به `dashboard.view` نیاز دارد و برای مشتری خروجی مشتری‌محور باقی می‌ماند.
- شمارندهٔ دسته فقط خدمت‌های منتشرشده/قابل‌نمایش را می‌شمارد. نشانگر `needsReview` با ویرایش صریح مدیر پاک می‌شود، نه صرفاً مشاهده.
- warning key در ServiceDetail ناشی از fixture قدیمیِ بدون `documents[].key` بود؛ fallback پایدار اضافه شد و خروجی اجرای صفحه پس از اصلاح بدون warning بود.

### Windows LAN و گزارش خطا

- پیش‌فرض loopback باقی است. فعال‌سازی LAN نیازمند opt-in صریح checkbox/console/installer است؛ `.env.windows.local` مقدار `LAN_ACCESS` و `HOST` را نگه می‌دارد.
- Rule فایروال TCP برای همان پورت و Node نصب‌شده، inbound از `LocalSubnet` روی profile `Private` را مجاز و `Public`/`Domain` را block می‌کند. کد profileهای سراسری یا پیکربندی عمومی Firewall را تغییر نمی‌دهد؛ وضعیت ناامن/allow گسترده یا نبود دسترسی باعث رد LAN می‌شود.
- API روی Windows بدون تأیید Firewall از Manager، wildcard را به loopback محدود می‌کند؛ رفتار Linux از تنظیم host مشترک استفاده می‌کند و منطق محصول Windows-specific ندارد.
- Manager آدرس‌های خصوصی IPv4 و وضعیت فایروال را گزارش می‌دهد؛ رخدادهای فنی مدیر در `.data/logs/pishkan-manager.log` می‌روند. حذف rule هنگام opt-out/uninstall تلاش می‌شود؛ اگر حذف ایمن ممکن نباشد، سرور loopback-only می‌ماند.
- تست‌های selftest جدید opt-in خاموش/روشن را با dry-run بررسی می‌کنند و بیرون Windows اجازهٔ اجرای PowerShell Firewall واقعی نمی‌دهند.

## نتایج مرحلهٔ قبلی (پیش از اصلاحات نهایی؛ فقط سابقه، 2026-10-31)

| فرمان/آزمون | نتیجه |
|---|---|
| بررسی Git/PR | شاخهٔ درست، PR #4 باز، upstream و HEAD هم‌تراز (0 ahead/behind). تغییرات هنوز منتشر نشده‌اند. |
| `git diff --check` | ابتدا چهار trailing whitespace در `catalog/{seed.ts,service.ts}` یافت شد؛ پاک شدند. اجرای دوباره موفق و بدون خطا. |
| `npm run test --workspace apps/api -- tests/accounting.test.ts tests/catalog.test.ts tests/requests.test.ts tests/server-bind.test.ts tests/media.test.ts` | موفق: 5 فایل، 64/64 تست. شامل cash/free، مدارک، scope/RBAC، مدت، دسته، callback داخلی Zarinpal و bind. SQLite آزمایشی است و transport Gateway mock. |
| `npm run test --workspace apps/web -- tests/pages.test.tsx` | موفق: 1 فایل، 11/11 تست؛ React key warning پس از اصلاح fixture/fallback دیده نشد. |
| `npm run typecheck` | موفق: TypeScript هر دو workspace، API و web. |
| `node windows/lib/ps-lint.mjs` | موفق: 13/13 فایل Windows سالم و parser در دسترس، شامل اسکریپت Firewall. |
| `npm run test:windows` — اجرای نخست پس از ویرایش | 32/34؛ یک `.ps1` به دلیل از دست‌رفتن BOM پس از edit هشدار داد و تست dry-run جدید stdin را با `--job-stdin` فعال نکرده بود. هر دو علت اصلاح شدند. |
| `node windows/lib/ps-lint.mjs --fix` سپس `npm run test:windows` | موفق: static/parser 13/13 و selftest 34/34. یک مورد واقعی Firewall/Wi‑Fi به‌صراحت skip شد چون سیستم میزبان Linux است. |
| `npm test` (full) | API: 20 فایل، 129/129؛ web: 4 فایل، 24/24. همه پاس شدند. اجرای دوم web پس از اصلاح تست Theme نیز 24/24 و بدون React `act()` warning بود. |
| `npm run build` | موفق: TypeScript API build و Vite production web build (1986 modules، PWA precache 21 entries). |
| `npm run check:contrast` | موفق؛ همهٔ جفت‌های متن/زمینه در تم روشن و تیره از آستانهٔ تعریف‌شده عبور کردند. |
| `npm audit --json` | خروجی غیرصفر: 12 مورد (2 low، 10 moderate؛ 0 high/critical)، در وابستگی‌های توسعه. ابزار fix موجود را با downgrade major برای Capacitor CLI/PWA پیشنهاد می‌کند؛ تغییر خودکار/ناسازگار انجام نشد. |
| `npm audit --omit=dev` | موفق: 0 آسیب‌پذیری در dependencyهای production. |

## محدودیت‌ها و موارد باز

- PostgreSQL واقعی در این محیط نصب/اتصال نشده؛ migration و رفتارها در SQLite آزمایشی آزموده شده‌اند.
- اتصال واقعی Zarinpal Sandbox قابل اثبات نیست: آزمون API از HTTP mock استفاده می‌کند و میزبان Sandbox در دسترس نیست؛ هیچ اعتبارنامه یا callback واقعی استفاده نشده است.
- PowerShell/WinForms/Windows Defender Firewall و اتصال موبایل روی Wi‑Fi باید روی Windows واقعی اجرا شوند. Linux selftest و parser، رفتار فیزیکی فایروال/شبکه را اثبات نمی‌کنند.
- آخرین `npm audit` شناخته‌شده 12 آسیب‌پذیری توسعه (2 low، 10 moderate، بدون high/critical) و صفر مورد production داشت؛ چون dependencyها تغییر نکردند دوباره اجرا نشد. پیشنهاد fix با downgrade major ناسازگار بود و اعمال نشد.
- بازبینی نهایی diff، جست‌وجوی اسرار/فایل DB/دادهٔ آزمایشی، و تأیید مجدد branch/PR هنوز باقی است.
- پس از بازبینی، commit و push بدون force فقط به `arena/db057b54-pishkan` انجام می‌شود. تا push موفق، مأموریت تکمیل اعلام نمی‌شود.

## گام‌های بعدی

1. بازبینی نهایی diff دسته‌به‌دسته، `APP_URL` در لینک‌ها و فهرست فایل‌های staged/untracked؛ اطمینان از عدم ورود DB، `.env` محرمانه یا artifact.
2. تأیید مجدد نام شاخه، upstream، وضعیت PR #4 و `git diff --check`.
3. commit و push بدون force به `arena/db057b54-pishkan`؛ سپس تأیید PR #4 و ثبت hash نهایی.
4. در گزارش نهایی محدودیت PostgreSQL، Gateway mock و Windows واقعی صریح بماند؛ Sandbox/Firewall/Wi‑Fi واقعی ادعا نشود.

## اصلاحات نهایی و verification (2026-10-31)

### یافته‌ها و اصلاحات تأییدشده

- بدون `documents.view` پاسخ `GET /requests/:id` دیگر فهرست مدرک، رخدادهای مدرک یا file IDهای فیلدهای `file` فرم را برنمی‌گرداند. مسیرهای آرشیو/دانلود/بررسی نیز permission و مسئولیت پرونده را در API کنترل می‌کنند؛ بررسی نیازمند `documents.view` و `documents.approve` است.
- مدرک pending در صف رسیدگی قرار می‌گیرد؛ رد نیازمند دلیل است و `document_reviews` تاریخچهٔ reviewer/تصمیم/دلیل را نگه می‌دارد. حذف مدرک بررسی‌شده یا داخل زنجیرهٔ جایگزینی ممنوع است؛ یکتایی replacement در migration enforce می‌شود.
- تحویل نتیجهٔ کارکنان برای بازبینی مدیریت خصوصی می‌ماند؛ رد با دلیل، status/event و audit ثبت می‌شود. نسخهٔ جدید به برگ ردشده پیوند می‌خورد؛ تکمیل فقط مدارک فعالِ آخرین نسخه را می‌سنجد.
- درخواست، پرداخت نقدی/رایگان/آنلاین مستقل‌اند؛ نقدی به شناسهٔ درگاه نیاز ندارد و وصول نقدی درخواست را خودکار complete نمی‌کند. callback زرین‌پال فقط HTTPS عمومی را می‌پذیرد.
- بازبینی مسیر پذیرش پیشنهاد اختصاصی نشان داد فاکتور پیش‌صدور تا پس از پاسخ `createRequest` به درخواست پیوند می‌خورد؛ این پیوند به تراکنش ساخت درخواست منتقل شد، برای آن رویداد تاریخچه ثبت شد و پاسخ اولیه اکنون فاکتور را برمی‌گرداند. آزمون regression پیوند و وضعیت `cash_due` اضافه شد. ورودی اعتبار پیشنهاد (ساعت) در UI هم اکنون در API اعمال می‌شود.
- درخواست `documents.view`/scope دارد؛ manual assignment، auto-assignment، claim، status و deadline رویداد/audit دارند. لغو مسئولیت در وضعیت `assigned` پرونده را به `new` برمی‌گرداند تا از صف خارج نشود.
- URL callback دامنه‌های `example.com` و زیر‌دامنه‌ها، `.example`/`.onion`/`.arpa` و دیگر نام‌های محلی را رد می‌کند؛ IPv4 و IPv6 رزروشده، mapped، `2001::/23` و `3fff::/20` نیز رد می‌شوند.
- API error logger دیگر query کامل callback یا شیء خطای خام را نمی‌نویسد. تشخیص‌ها credential، URL اتصال، token، شماره/شناسه/نام و مسیر home را پالایش می‌کند؛ Manager هنگام نمایش logهای قدیمی نیز redaction می‌کند. مقدار username از پیام ایجاد حساب حذف شده است.
- LAN در Windows پیش‌فرض خاموش/loopback است؛ Manager قبل از bind wildcard، rule را بررسی/ایجاد می‌کند. Allow محدود به TCP/پورت همان نصب/Node/Private/LocalSubnet و Public/Domain صریحاً Block است. اگر شرط Firewall برقرار نباشد API loopback می‌ماند. `APP_URL` محلی Windows برای ساخت لینک مصرف نمی‌شود؛ SPA درخواست‌های relative و cookie host-only با `SameSite=Lax` به‌کار می‌برد.
- `formatDuration` helper مشترک `apps/web/src/lib/site.tsx` است؛ دقیقه/ساعت/روز دقیق هم در صفحات و هم در پیشنهاد/متن دستیار پشتیبانی می‌شوند. برآورد از deadline عملیاتی جداست.

### نتایج آخرین اجرا

| فرمان/آزمون | نتیجه |
|---|---|
| `npm run typecheck` | موفق؛ API و web. |
| `npm test` | موفق؛ API: 20 فایل، 135/135؛ web: 4 فایل، 27/27. شامل migration 017، cash/free، مدارک و جایگزینی، RBAC، audit assignment، مدت دقیق و callback mock. |
| `npm run build` | موفق؛ API TypeScript و Vite production build، 1986 ماژول، PWA precache 21 entry. |
| `npm run check:contrast` | موفق؛ جفت‌های رنگ تم روشن/تیره از آستانه گذشتند. |
| `npm run test:windows` | موفق: 36/36؛ پس از اصلاح CRLF در چهار launcher از آزمون اول. آزمون واقعی Firewall/Wi‑Fi صریحاً skip شد چون میزبان Linux است. |
| `node windows/lib/ps-lint.mjs` | موفق: 13/13 فایل و parser PowerShell. |
| `git diff --check` | موفق؛ بدون whitespace error، در diff و index. |
| `npm audit --omit=dev` | موفق؛ صفر آسیب‌پذیری در dependencyهای production. `npm ci` نیز 12 مورد low/moderate در dependencyهای توسعه نشان داد؛ پیشنهاد downgrade-major اعمال نشد. |
| جست‌وجوی APP_URL در کد | APP_URL محلی Windows فقط در env/config و endpoint اطلاعات سیستم است؛ رابط از URLهای relative استفاده می‌کند و لینک absolute محلی بر اساس آن ساخته نمی‌شود. |

در اجراهای میانی، selftest ابتدا نبود BOM در فایل تازهٔ PowerShell را یافت و یک assertion آزمایشی به پاسخ اشتباه تکیه داشت؛ BOM و fixture اصلاح شدند. یک آزمون پالایش لاگ نیز پس از افزودن پوشش نام کاربری با ترتیب placeholderها ناسازگار شد؛ پالایش و assertion اصلاح و در suite نهایی تأیید شد. نتایج بالا آخرین اجراها هستند.

### مواردی که در این محیط اجرا نشدند

- PostgreSQL واقعی و migration روی یک instance عملیاتی: اجرا نشده.
- Zarinpal Sandbox واقعی: اجرا نشده؛ test transport HTTP mock است و secret/callback واقعی استفاده نشده.
- Windows PowerShell/WinForms و Windows Defender Firewall واقعی، و اتصال موبایل روی Wi‑Fi: اجرا نشده؛ میزبان Linux است.

### اقدام باقی‌مانده

بازبینی نهایی diff و فایل‌های staged/untracked، جست‌وجوی اسرار و artifact/DB محلی، تأیید مجدد شاخه/PR، سپس commit و push بدون force به `arena/db057b54-pishkan` و ثبت hash نهایی. تا پایان این مرحله مأموریت تکمیل اعلام نمی‌شود.
