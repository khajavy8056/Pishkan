# گزارش آزمون‌های واقعی — تک پیشخوان

تاریخ: ۲۰۲۶-۱۱-۲۶ · شاخه: `arena/fe627e67-pishkan` · نسخه: `1.0.1218`

همهٔ نتایج زیر از **اجرای واقعی** به‌دست آمده‌اند (نه ادعا). لاگ کامل در `.data/audit-logs/`.

## ۱. آزمون عملکردی (Functional)

| سوئیت | موتور | نتیجه |
| --- | --- | --- |
| API کامل (۶۹ فایل) | SQLite | **۵۰۱/۵۰۱ پاس** · EXIT_CODE=0 |
| API کامل (۶۹ فایل) | PostgreSQL 16.2 واقعی | **۴۹۵ پاس + ۶ skip عمدی + ۰ شکست** · EXIT_CODE=0 |
| وب (۱۷ فایل) | jsdom | **۱۴۵/۱۴۵ پاس** |
| typecheck API + وب | TypeScript | پاس |
| build وب + PWA | Vite 7 | موفق (۱۱۹ precache، sw.js تولید شد) |
| build API | tsc | موفق |
| selftest کتابخانهٔ ویندوز | node (روی لینوکس) | **۵۲/۵۲** (۲ skip نیازمند Windows/dist) |
| contrast وب | check:contrast | پاس (بخشی از verify) |

پوشش عملکردی: همهٔ نقش‌ها (customer/expert/manager/accountant/admin)، جریان‌های اصلی
(ثبت درخواست، ارجاع، مدارک، فاکتور، پرداخت، کیف پول)، پیامک/اعلان، فایل‌ها، تنظیمات، بلاگ.
تطبیق ویندوز↔سرور با اجرای یک سوئیت روی هر دو دیتابیس (بخش ۳ گزارش تطبیق).

## ۲. آزمون امنیتی (Security — فقط محیط کنترل‌شده)

| آزمون | نتیجه |
| --- | --- |
| `guard.test.ts` (RBAC، brute-force، مسدودسازی/رفع، 404، probe، آپلود مخرب، یکپارچگی، قرنطینه، audit، اینماد، پیامک) | **۱۵/۱۵** روی SQLite و PG |
| `guard.test.tsx` (داشبورد/رویداد/مسدودسازی/اسکن/قرنطینه UI) | **۵/۵** |
| `seo.test.ts` (robots/sitemap/analytics/CSP/اینماد) | **۵/۵** |
| `trust-seo.test.tsx` (اینماد/verification/analytics/noindex) | **۶/۶** |
| `npm audit` | **۰ آسیب‌پذیری** |
| کنترل دسترسی backup/monitoring (401/403 برای غیرمجاز) | پاس در تست‌های مربوط |

تست‌های امنیتی فقط روی loopback و دیتابیس ایزوله اجرا شدند؛ هیچ تست نفوذ خارجی بدون مجوز انجام نشد.

## ۳. آزمون زیرساخت (Infra)

| آزمون | نتیجه |
| --- | --- |
| `backup-external.test.ts` (SFTP/FTP واقعی، checksum، retention، شکست صادقانه، RBAC) | **۸/۸** |
| `monitoring-infra.test.ts` (تازگی بکاپ، SSL واقعی TLS، health، RBAC) | **۷/۷** |
| `monitoring.test.ts` (health/charts/alerts) | پاس |
| `backup-restore.test.ts` (بازیابی ایزولهٔ SQLite + آرشیو مدارک) | پاس |
| نصب‌کننده v2 | `bash -n` سبز؛ journal/قفل/گزارش/بستهٔ اندروید در کد |

موارد نیازمند زیرساخت واقعی (دامنه/SSL زنده/پیامک/درگاه/Drive OAuth/VPS) در `06-REMAINING-EXTERNAL.md`.

## ۴. آزمون پایداری (Stability)

- همروندی/حجم: سوئیت PG با MVCC واقعی اجرا شد؛ دفتر مالی با tx()/idempotency در برابر
  پرداخت تکراری تست شد (wallet/payments tests روی هر دو DB).
- منابع: مانیتورینگ CPU/RAM/disk/DB-latency واقعی؛ هشدار آستانه‌دار.
- بودجهٔ پیامک ساعتی گارد در برابر تخلیهٔ اعتبار تست شد (دقیقاً ۱ پیامک در سقف ۱).

## ۵. نتیجهٔ نهایی PostgreSQL

اجرای نهایی روی **PostgreSQL 16.2 واقعی** (pgserver، با PG_DUMP_BIN/PG_RESTORE_BIN):
```
Test Files  67 passed | 2 skipped (69)
      Tests  495 passed | 6 skipped (501)
EXIT_CODE=0
```
۶ skip عمدی تست‌های restore-package مخصوص SQLite هستند. **۰ شکست.** لاگ: `.data/audit-logs/pg-suite-run3.log`.
اجرای SQLite نیز `۵۰۱/۵۰۱` با EXIT_CODE=0 (`.data/audit-logs/full-suite-run4.log`).

## ۶. جمع‌بندی

هیچ شکست رفع‌نشده باقی نمانده است. تنها شکست اجرای اول PG (یک تست گارد) یک race در
خواندن `action_taken` پیش از تکمیل مسدودسازی async بود؛ با انتظار برای وضعیت تکمیل‌شده
رفع شد و روی PG **۱۵/۱۵** تأیید شد (منطق گارد دست‌نخورده ماند).
