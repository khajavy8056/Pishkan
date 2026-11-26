# گزارش ممیزی امنیتی — تک پیشخوان

تاریخ: ۲۰۲۶-۱۱-۲۶ · شاخه: `arena/fe627e67-pishkan` · نسخه: `1.0.1218`

دامنهٔ بررسی: SQLi، XSS، CSRF، SSRF، RCE، path traversal، آپلود، session hijacking،
auth bypass، broken access control، privesc، brute force، نشت اعتبارنامه، API abuse،
وابستگی‌ها. همهٔ تست‌ها در محیط کنترل‌شدهٔ آزمون (loopback، دیتابیس ایزوله) اجرا شدند.

## ۱. وضعیت کنترل‌های موجود (تأییدشده با کد و تست)

| حوزه | کنترل | وضعیت |
| --- | --- | --- |
| تزریق SQL | کوئری‌های پارامتری (`?`/`$n`) در همهٔ ماژول‌ها؛ بدون الحاق رشتهٔ کاربر | ✅ برقرار |
| XSS | React escape خودکار؛ اینماد بازسازی‌شده از قطعات معتبر (بدون script/on*/دامنهٔ بیگانه)؛ CSP سخت‌گیر | ✅ برقرار + تقویت |
| CSRF | کوکی session با SameSite؛ Origin/Referer بررسی در middleware | ✅ برقرار |
| SSRF | آداپتورهای خارجی فقط به میزبان‌های تنظیم‌شده توسط مدیر؛ اینماد فقط enamad.ir | ✅ برقرار |
| RCE | بدون eval/exec کاربر؛ `execFile` با آرگومان آرایه‌ای (نه shell) برای pg_dump/tar | ✅ برقرار |
| Path traversal | backupPath/resolveStoragePath با containment؛ extractUploadsSafely رد link/escape | ✅ برقرار |
| آپلود | .part + allowlist پسوند + magic bytes + رد PDF-JS؛ اسکن امضای Guard + قرنطینه | ✅ برقرار + تقویت |
| Session | توکن sha256 با TTL/IP-bind؛ MFA/TOTP؛ bcrypt 12؛ AES-256-GCM at rest | ✅ برقرار |
| Auth bypass | requireAuth/requirePermission per-route؛ OTP audience split | ✅ برقرار |
| Access control | RBAC ریزدانه (permissions v6)؛ تست RBAC برای guard/backup/monitoring | ✅ برقرار + تست |
| Brute force | قفل حساب (max_login_attempts/lockout) + تشخیص Guard + مسدودسازی موقت IP | ✅ برقرار + تقویت |
| نشت اعتبارنامه | getSecret رمزنگاری‌شده؛ mask در UI؛ health sanitize؛ install secret فقط ترمینال/0600 | ✅ برقرار + رفع F2/F5 |
| API abuse | rate limiter per-IP؛ تشخیص rate_abuse/404/403 Guard | ✅ برقرار + تقویت |
| وابستگی | `npm audit` = **۰** (adm-zip ارتقا؛ glob/minimatch override وصله‌شده) | ✅ رفع F1/F6 |

## ۲. آسیب‌پذیری‌های شناسایی و رفع‌شده در این ممیزی

1. **F1 (بالا):** adm-zip قدیمی در مسیر بازیابی ⇒ ارتقا به 0.6.1.
2. **F2 (بالا):** رمز مدیر در install.log ⇒ print_secret_once + unset + گزارش بدون secret.
3. **F5 (پایین):** نشت خطای خام DB در health عمومی ⇒ sanitize.
4. **F6 (متوسط):** minimatch/glob dev ⇒ override glob@14 (minimatch@11 وصله‌شده)؛ build+PWA تأیید شد.
5. **پوشش probe با 200:** SPA fallback مسیر `/.env` را معتبر نشان می‌داد وقتی dist ساخته بود ⇒ `isExploitPath` همیشه 404 قبل از static.

## ۳. گارد امنیتی (لایهٔ دفاعی فعال)

- تشخیص: brute force، فوران 403/404، rate abuse، آپلود مخرب، probe مسیر شناخته‌شده، تغییر غیرمجاز فایل، spike منابع (از مانیتورینگ).
- پاسخ متناسب: مسدودسازی موقت IP، throttling، قرنطینهٔ کنترل‌شدهٔ فایل، اعلان مدیر؛ **اقدامات پرخطر نیازمند تأیید مدیر** (عبارت تأیید برای بازگردانی/بازسازی).
- **برگشت‌پذیر و ثبت‌شده:** هر مسدودسازی/قرنطینه قابل رفع است و در guard_events/system_logs ثبت می‌شود.
- **هرگز دادهٔ کاربر را حذف نمی‌کند، مدیر اصلی را مسدود نمی‌کند، سامانه را آفلاین نمی‌کند، فایل سالم را نابود نمی‌کند:** loopback/trusted_ips معاف؛ کارکنان با never_block_staff معاف؛ قرنطینه فقط فایل ناشناس/مخرب را جابه‌جا می‌کند (حذف نمی‌کند) و بازگردانی با تأیید checksum ممکن است.
- پیامک هشدار با بودجهٔ ساعتی (ضد تخلیهٔ اعتبار)، per-event toggle، یک شمارهٔ مدیر.

## ۴. سیاست‌های امنیتی مرورگر/API

- CSP پیش‌فرض سخت‌گیر (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `script-src-attr 'none'`)؛ افزودن فقط originهای دقیق GA/GTM/enamad وقتی فعال‌اند؛ **بدون unsafe-inline برای script**.
- HSTS در HTTPS؛ `X-Content-Type-Options: nosniff`؛ `Referrer-Policy: strict-origin-when-cross-origin`؛ Permissions-Policy محدود.
- noindex برای همهٔ پنل‌ها (meta + robots.txt Disallow).
- analytics فقط در صفحه‌های عمومی، self-hosted bootstrap، فقط ID معتبر.

## ۵. مدیریت secret و فایل‌های حساس

- کلید رمزنگاری APP_ENCRYPTION_KEY از env (نه کد)؛ secretها AES-256-GCM در DB.
- env file 0640 root:app؛ initial-admin-secret 0600 root؛ quarantine 0700/0600.
- گزارش نصب و بستهٔ اندروید **هیچ** رمز/کلید/اعتبارنامه ندارند.
- لاگ رویداد امنیتی بدون دادهٔ حساس کاربر.

## ۶. موارد نیازمند زیرساخت واقعی (خارج از محیط آزمون)

اسکن malware با موتور به‌روز (ClamAV) روی VPS، تست نفوذ خارجی مجاز، SSL زندهٔ Let's Encrypt،
پیامک واقعی، درگاه بانکی زنده. این‌ها در `06-REMAINING-EXTERNAL.md` با دستور دقیق آمده‌اند.
اسکن فعلی Guard امضایی/یکپارچگی است و **جایگزین آنتی‌ویروس کامل نیست** — صادقانه در UI و مستندات ذکر شده.

## ۷. نتیجه

هیچ آسیب‌پذیری **بحرانی یا بالا** رفع‌نشده باقی نمانده است. `npm audit` صفر است.
کنترل‌های دسترسی/احراز هویت/آپلود/نشت با تست واقعی تأیید شدند. گارد فعال و آزمون‌شده است.
موارد باقی‌مانده همگی به زیرساخت خارجی نیاز دارند و به‌صورت شفاف مستند شده‌اند.
