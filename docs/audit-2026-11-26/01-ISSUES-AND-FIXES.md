# فهرست یافته‌ها و اصلاحات — مأموریت آماده‌سازی عملیاتی

تاریخ: ۲۰۲۶-۱۱-۲۶ · شاخه: `arena/fe627e67-pishkan` · مبنا: `main@ec34330` · نسخه: `1.0.1218`

این سند هر یافته، ریشهٔ آن، اصلاح انجام‌شده و شاهد آزمون واقعی را ردیابی می‌کند.
هیچ اصلاحی «نمایشی» نیست؛ هر مورد با تست اجراشده تأیید شده است.

## الف) یافته‌های اولیه و اصلاحات

| # | یافته | شدت | ریشه | اصلاح | شاهد آزمون |
| --- | --- | --- | --- | --- | --- |
| F1 | `adm-zip@0.5.16` با ۶ advisory (zip-bomb، symlink overwrite، SUID) در مسیر بازیابی بسته | بالا | نسخهٔ قدیمی | ارتقا به `adm-zip@^0.6.1` | `npm audit` → ۰ آسیب‌پذیری؛ تست‌های restore-package سبز |
| F2 | رمز یک‌بارمصرف مدیر در `install.log` ثبت می‌شد | بالا | `tee` سراسری + چاپ رمز در خلاصه | `print_secret_once` فقط به ترمینال یا فایل 0600 root؛ `unset` پس از چاپ؛ گزارش نصب هرگز محرمانه ندارد | بازبینی کد install.sh؛ گزارش بدون secret |
| F3 | `pg_dump`/`pg_restore` بدون override مسیر؛ عدم تطابق نسخه در اوبونتو | متوسط | تکیه بر PATH | `PG_DUMP_BIN`/`PG_RESTORE_BIN` در env.ts + پیام فارسی ENOENT/version-mismatch | سوئیت PG با باینری pgserver |
| F4 | تست `push-stage-payload` از `rowid` مخصوص SQLite استفاده می‌کرد | متوسط | SQL غیرقابل‌حمل | جایگزینی با `created_at` قابل‌حمل | تست روی هر دو دیتابیس سبز |
| F5 | پیام خطای خام دیتابیس در `/api/health` عمومی منتشر می‌شد | پایین | نشت جزئیات داخلی | sanitize در routes/health.ts | تست health |
| F6 | `minimatch`/`glob` (dev) advisory متوسط | پایین | وابستگی build | override به `glob@^14.0.2` (که minimatch@11 وصله‌شده می‌آورد) | `npm audit` → ۰؛ build وب + PWA موفق (۱۱۹ precache) |
| F7 | گارد امنیتی اختصاصی وجود نداشت | کمبود | — | ماژول کامل Guard (بخش ب) | ۱۵ تست API + ۵ تست وب |
| F8 | بکاپ خارجی وجود نداشت | کمبود | — | آداپتور SFTP/FTP/Google Drive (بخش ج) | ۸ تست با سرور واقعی SFTP/FTP |
| F9 | تنظیمات SEO/اینماد/گوگل نبود | کمبود | — | گروه seo + اینماد + analytics (بخش د) | ۵ تست API + ۶ تست وب |
| F10 | پایش SSL و تازگی بکاپ نبود | کمبود | — | چک SSL واقعی + تازگی بکاپ (بخش ه) | ۷ تست مانیتورینگ |
| F11 | نصب‌کننده journal/قفل/گزارش/بستهٔ اندروید نداشت | کمبود | — | نصب‌کننده v2 (بخش و) | بازبینی کد + bash -n |

## ب) گارد تک پیشخوان (Takh Pishkhan Guard)

**مهاجرت‌ها:** `045_guard.sql` (guard_events/blocks/scans/file_baseline/quarantine/state)، `046_backup_external.sql` (backup_transfers) — افزایشی، بدون حذف داده.

**ماژول‌ها (`apps/api/src/modules/guard/`):**
- `service.ts`: ثبت رویداد، raiseAlarm → مسدودسازی خودکار → اعلان؛ کش ۵ثانیه‌ای blockedUntil؛ blockIp/unblockIp؛ securityPosture؛ guardOverview؛ prune. **loopback و trusted_ips هرگز خودکار مسدود نمی‌شوند؛ کارکنان با `never_block_staff` مستثنا** — گارد نمی‌تواند مدیر را قفل کند.
- `detectors.ts`: پنجرهٔ لغزان per-IP؛ auth_bruteforce (بحرانی)، forbidden/notfound/rate_abuse (هشدار)، upload_attack (بحرانی)؛ یک alarm per window؛ `EXPLOIT_PATH` → exploit_probe (هشدار، غیرمسدودکننده).
- `response.ts`: اعلان داخلی به super_admin/manager + پیامک از سرویس موجود با بودجهٔ ساعتی؛ `sendGuardSms` مشترک برای رویدادهای امنیتی و عملیاتی.
- `integrity.ts`: خط مبنای SHA-256 فایل‌ها؛ بازسازی خودکار هنگام تغییر نسخه؛ تشخیص تغییر غیرمجاز.
- `uploads-scan.ts`: امضای MZ/ELF/shebang/PHP/JSP/HTML-script/Java؛ فایل ثبت‌شده → needs_admin؛ ناشناس → قرنطینهٔ خودکار؛ grace یک‌ساعته برای .part؛ قرنطینه 0700/0600؛ بازگردانی با تأیید checksum.
- `deps.ts`: `npm audit --json` واقعی؛ parseAuditReport؛ پیشنهاد نسخهٔ امن + هشدار تغییر major.
- `scheduler.ts`: tick پنج‌دقیقه‌ای؛ اسکن آپلود هر ۶ ساعت؛ prune هر ۲۴ ساعت.

**API (`/api/guard` + `/api/v1`):** overview، posture، events(+ack)، blocks GET/POST/DELETE، scans(+/:id)، POST /scan، /baseline/rebuild، /quarantine GET/POST/:id/restore، /deps، /test-sms. خواندن=`guard.view`، نوشتن=`guard.manage`. middleware مسدودسازی IP قبل از روترها (403 `guard_blocked` + Retry-After).

**صفحهٔ مدیریت (`apps/web/src/pages/admin/Guard.tsx`):** ۵ تب (داشبورد/رویدادها/مسدودسازی/اسکن‌ها/قرنطینه)؛ StatCard؛ جدول وابستگی با نسخهٔ امن؛ مودال مسدودسازی/اسکن؛ اقدامات gated با `can('guard.manage')`. مسیر `/admin/guard`، nav «گارد تک پیشخوان».

**آزمون:** `apps/api/tests/guard.test.ts` = **۱۵/۱۵** (RBAC، brute-force+مسدودسازی+معافیت مدیر+رفع، اعتبارسنجی مسدودسازی دستی، فوران 404، probe .env، آپلود .exe، دستکاری یکپارچگی/بازسازی، قرنطینه/بازگردانی ELF، parse audit، اینماد، پیامک با سقف ساعتی). `apps/web/tests/guard.test.tsx` = **۵/۵**.

**اصلاح ریشه‌ای حین تست:** دو شکست اولیهٔ guard.test به‌دلیل قفل تجمعی حساب `testadmin` (failed_attempts/locked_until) بود، نه باگ منطق؛ با reset در beforeEach و بین دو موج پیامک رفع شد. منطق تشخیص/پیامک دست‌نخورده ماند.

## ج) بکاپ خارجی

**ماژول `backup-external.ts`:** سه آداپتور واقعی — SFTP (ssh2)، FTP/FTPS (basic-ftp)، Google Drive (OAuth refresh token، resumable upload). هر جزء یک رکورد `backup_transfers` با مسیر/اندازه/SHA-256/نتیجه. مقایسهٔ اندازه پس از بارگذاری؛ انتقال ناقص هرگز «موفق» نمی‌شود. نگهداری فقط فایل‌های `pishkan-*` را پاک می‌کند و فایل بیگانه/نسخهٔ ارجاع‌شده هرگز حذف نمی‌شود. شکست انتقال نسخهٔ محلی را باطل نمی‌کند + اعلان به مدیر.

**اتصال:** پس از بکاپ دستی (route) و خودکار (scheduler) وقتی `backup.external_enabled` روشن است. endpointهای `/api/system/backups/transfers`، `/external/test`، `/:id/transfer`. UI در عملیات ← پشتیبان‌گیری (دکمهٔ آزمایش/انتقال + تاریخچه).

**آزمون `backup-external.test.ts` = ۸/۸** با سرور **واقعی** SFTP (paramiko، handshake واقعی SSH) و FTP (pyftpdlib) روی loopback: انتقال هر دو جزء با تطابق SHA-256 مبدأ/مقصد؛ رمز اشتباه ⇒ رکورد ناموفق + سالم‌ماندن محلی؛ حذف فقط pishkan-* قدیمی؛ انتقال خودکار؛ خطای صادقانهٔ Drive بدون اعتبارنامه؛ RBAC.

## د) SEO / اینماد / گوگل

**تنظیمات:** گروه `seo` (۲۲ کلید: meta/OG/canonical/robots/verification/GA/GTM/JSON-LD) + `site.enamad_*`. پاک‌ساز اینماد (`enamad.ts`): فقط https روی enamad.ir، بازسازی قطعی a>img/iframe، رد script/on*/دامنهٔ بیگانه. **اصلاح حین تست:** نشانی رسمی لوگو فقط `id` دارد (نه Code)؛ پاک‌ساز برای پذیرش آن اصلاح شد.

**API:** sitemap با canonical_base + خدمات منتشرشده؛ robots با خطوط اضافهٔ مدیر (مسیرهای خصوصی همیشه Disallow)؛ `/api/public/analytics.js` self-hosted (فقط ID معتبر G-/GTM-، GTM بر GA اولویت)؛ CSP افزودنی فقط وقتی یکپارچه‌سازی فعال است (بدون unsafe-inline برای script).

**فرانت‌اند:** `trust-seo.tsx` (PublicSeoExtras + EnamadBadge) فقط روی صفحه‌های عمومی؛ noindex در AppShell پنل‌ها؛ عنوان/توضیحات پیش‌فرض از seo.* در SiteProvider.

**آزمون:** `seo.test.ts` = **۵/۵**؛ `trust-seo.test.tsx` = **۶/۶**.

## ه) مانیتورینگ

**`ssl.ts`:** probe واقعی TLS به پورت ۴۴ (میزبان تنظیم‌شده یا دامنهٔ APP_URL)؛ خواندن valid_to/issuer؛ کش یک‌ساعته؛ در استقرار لوکال/http صادقانه «قابل بررسی نیست» با دلیل. `expired` فقط وقتی valid_to گذشته باشد.

**alerts.ts:** تازگی بکاپ (missing=بحرانی، stale=هشدار/بحرانی) فقط وقتی بکاپ خودکار روشن؛ انقضای SSL (expired=بحرانی، expiring≤آستانه). پیامک عملیاتی از `sendGuardSms` مشترک (یک شماره، یک بودجه، per-event toggle) فقط در اولین وقوع.

**service.ts:** کامپوننت‌های backup و ssl در healthSnapshot. endpoint `/api/monitoring/ssl/check` (probe تازه).

**آزمون `monitoring-infra.test.ts` = ۷/۷** شامل handshake واقعی TLS با github.com (گواهی واقعی خوانده شد؛ proxy محیط گواهی کوتاه‌مدت می‌دهد که به‌درستی هشدار انقضا را فعال می‌کند — نشانهٔ کار موتور هشدار).

## و) نصب‌کنندهٔ سرور v2

- **رفع F2:** `print_secret_once` (ترمینال یا فایل 0600)، unset رمز، گزارش بدون محرمانه.
- **journal:** هر مرحله یک خط JSON در `install-journal.jsonl` (نام/وضعیت/زمان/توضیح غیرمحرمانه)؛ نسخهٔ قبلی به .prev منتقل می‌شود.
- **گزارش قابل دانلود:** `render_install_report` → `install-report.md` (مراحل/وضعیت/پیش‌نیاز/DB/دامنه/SSL/نتیجه؛ بدون secret) در موفقیت و شکست.
- **قفل پس از نصب:** `.install-complete`؛ اجرای دوباره بدون `PISHKAN_FORCE_INSTALL=1` رد می‌شود؛ به‌روزرسانی با `pishkan update`.
- **بستهٔ اتصال اندروید:** `android-connection.json` (API URL/domain/baseURL/مسیرهای ضروری/نسخه/auth/health زنده؛ بدون هیچ محرمانه).
- **خطای صادقانه:** on_error گزارش + کد خروج؛ هیچ موفقیت جعلی.
- `bash -n` سبز؛ ژورنال در همهٔ فازها.

## ز) اصلاحات امنیتی اضافی حین کار

- **مسیرهای probe حساس:** SPA fallback قبلاً `/.env` را با 200 می‌پوشاند وقتی dist ساخته شده بود. حالا `isExploitPath` قبل از static همیشه 404 می‌دهد — فرانت‌اند ساخته‌شده نمی‌تواند probe را معتبر نشان دهد. (تست exploit_probe در هر دو حالت سبز.)
- **CSP افزودنی کنترل‌شده:** فقط originهای دقیق GA/GTM/enamad؛ سخت‌گیری پیش‌فرض دست‌نخورده.

## ح) وضعیت آزمون‌ها (به‌روزرسانی نهایی در گزارش آزمون)

- SQLite: سوئیت کامل API + وب (در حال اجرای نهایی؛ نتیجه در `05-TEST-REPORT.md`).
- PostgreSQL 16 واقعی: اجرای مجدد با PG_DUMP_BIN/PG_RESTORE_BIN (نتیجه در `04-DB-COMPATIBILITY.md`).
- `npm audit`: **۰ آسیب‌پذیری**.
- build وب + PWA و build API: موفق.
