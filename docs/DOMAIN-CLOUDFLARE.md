# دامنه، DNS و Cloudflare

> **تاریخ بازبینی این سند: ۲۰۲۶-۱۰-۲۴.**
> منابع رسمی که باید پیش از اجرا دوباره بررسی شوند:
> - وضعیت Proxy در DNS: <https://developers.cloudflare.com/dns/proxy-status/>
> - گواهی مبدأ و حالت SSL: <https://developers.cloudflare.com/ssl/origin-configuration/>
> - حالت‌های SSL/TLS: <https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/>
> - رکوردهای DNS: <https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/>
>
> در محیط توسعه این پروژه دسترسی شبکه به دامنه‌های Cloudflare وجود نداشت، بنابراین متن بالا از دانش
> مستندات رسمی نوشته شده و **با صفحه زنده تطبیق داده نشده است**. پیش از تغییر DNS، همین لینک‌ها را باز
> کنید و در صورت تغییر رابط کاربری، مراحل را مطابق پنل فعلی انجام دهید.

## ۱. خرید و آماده‌سازی دامنه

**این پروژه هیچ دامنه‌ای نخریده و هیچ DNS‌ای را تغییر نداده است.** برای راه‌اندازی واقعی:

1. دامنه را از یک ثبت‌کننده معتبر (برای `.ir` از ایرنیک و نمایندگان مجاز) تهیه کنید.
2. در پنل ثبت‌کننده، Name Serverهای Cloudflare را تنظیم کنید
   (دو NS که Cloudflare پس از افزودن سایت به شما می‌دهد).
3. در Cloudflare پس از تأیید دامنه، رکوردها را بسازید.

## ۲. رکوردهای DNS

فرض: دامنه `pishkan.example.ir` و IP سرور `203.0.113.10`.

| Type | Name | Content | Proxy status | TTL |
| --- | --- | --- | --- | --- |
| A | `@` (یا `pishkan.example.ir`) | `203.0.113.10` | Proxied (نارنجی) | Auto |
| A | `www` | `203.0.113.10` | Proxied | Auto |
| AAAA | `@` | IPv6 سرور (اگر دارد) | Proxied | Auto |

- برای زیردامنه API جداگانه نیازی نیست: همان دامنه، مسیر `/api` را سرو می‌کند و CORS ساده‌تر می‌ماند.
  اگر `api.pishkan.example.ir` می‌خواهید، رکورد A جدا بسازید و در تنظیمات → دامنه وارد کنید.
- **پورت ۳۰۰۰ را هرگز عمومی نکنید.** Cloudflare فقط ۸۰/۴۴۳ را عبور می‌دهد و API باید از Nginx سرو شود.

## ۳. حالت SSL — حتماً Full (strict)

مسیر: **SSL/TLS → Overview → Full (strict)**

- `Flexible` **ممنوع** است: ترافیک بین Cloudflare و سرور بدون رمز عبور می‌کند و حلقه ریدایرکت ایجاد می‌شود.
- `Full` (بدون strict) گواهی نامعتبر مبدأ را می‌پذیرد و امکان حمله مرد میانی را باز می‌گذارد.
- `Full (strict)` فقط گواهی معتبر (Let's Encrypt یا Origin Certificate) را می‌پذیرد.

### گواهی مبدأ روی سرور

روش پیشنهادی: Let's Encrypt با certbot (اعتبار ۹۰ روزه، تمدید خودکار):

```bash
sudo certbot --nginx -d pishkan.example.ir -d www.pishkan.example.ir \
  -m admin@example.ir --agree-tos --redirect
sudo systemctl list-timers | grep certbot   # تمدید خودکار
```

روش جایگزین: **Origin Certificate** از Cloudflare (اعتبار تا ۱۵ سال، فقط معتبر در Cloudflare):

1. SSL/TLS → Origin Server → Create Certificate (دامنه و زیردامنه‌ها).
2. فایل‌ها را در `/etc/ssl/pishkan/` قرار دهید و در Nginx به آن‌ها اشاره کنید.
3. حالت را روی Full (strict) نگه دارید.

**هرگز `proxy_ssl_verify off`، `curl -k` یا غیرفعال‌کردن بررسی گواهی به‌عنوان راه‌حل موقت استفاده نکنید.**

## ۴. تنظیمات پیشنهادی Cloudflare

| تنظیم | مقدار | دلیل |
| --- | --- | --- |
| Always Use HTTPS | روشن | هدایت خودکار به HTTPS |
| Automatic HTTPS Rewrites | روشن | جلوگیری از محتوای مختلط |
| Minimum TLS Version | TLS 1.2 | امنیت پایه |
| Opportunistic Encryption | روشن | — |
| HSTS (SSL/TLS → Edge Certificates) | فعال، max-age 6 ماه | فقط پس از اطمینان از HTTPS پایدار |
| Brotli | روشن | سرعت بارگذاری |
| Rocket Loader | **خاموش** | با SPA و اسکریپت‌های ماژول تداخل دارد |
| Email Obfuscation | خاموش | با فرم‌ها و API تداخل می‌کند |
| Under Attack Mode | فقط در حمله | چالش JS ممکن است اپ اندروید را مختل کند |
| Development Mode | خاموش (پس از تنظیم) | کش مرورگر را غیرفعال می‌کند |

### کش و قواعد (اختیاری)

- مسیرهای `/api/*` باید **Bypass** شوند (پیش‌فرض هیچ کشی برای API اعمال نمی‌شود).
- `/assets/*` (فایل‌های Vite با هش) می‌تواند Cache Everything با Edge TTL بلند داشته باشد.
- `/` و `/index.html` را کش نکنید تا نسخه جدید فوراً دیده شود.
- اگر از Cloudflare Access استفاده می‌کنید، فقط مسیرهای مدیریتی را محدود کنید، نه `/api/accounting/payments/callback/*` را
  (درگاه پرداخت باید بتواند فراخوانی کند).

## ۵. تنظیم در سامانه

پس از اتصال دامنه، در پنل مدیریت:

1. **تنظیمات سامانه → دامنه و نشانی‌ها**:
   - `domain.primary` = `pishkan.example.ir`
   - `domain.public_url` = `https://pishkan.example.ir`
   - `domain.proxy_provider` = `cloudflare`
   - `domain.ssl_mode` = `full_strict`
   - `domain.dns_target_ip` = IP سرور
2. دکمه **«اجرای بررسی»** در همان بخش را بزنید: بررسی سازگاری نشانی، حالت SSL و دسترسی HTTPS.
   بررسی از داخل سرور انجام می‌شود؛ اگر نتیجه «هشدار» بود و سایت از مرورگر باز می‌شود،
   احتمالاً فایروال خروجی سرور بسته است.
3. در سرور: `server_name` در `/etc/nginx/sites-available/pishkan.conf` را با دامنه جایگزین و `nginx -t && systemctl reload nginx` کنید.

## ۶. خطاهای رایج و راه‌حل درست

| کد | معنا | راه‌حل |
| --- | --- | --- |
| 520/521 | Cloudflare به مبدأ وصل نمی‌شود | Nginx فعال است؟ `systemctl status nginx`؛ فایروال پورت ۸۰/۴۴۳ باز است؟ |
| 522 | Timeout اتصال | IP رکورد A درست است؟ سرور روشن است؟ |
| 523 | مبدأ غیرقابل دسترس | رکورد DNS/مسیر شبکه |
| 524 | پاسخ کند (بیش از ۱۰۰ ثانیه) | گزارش‌های سنگین؛ فیلتر تاریخ را محدود کنید (Cloudflare Enterprise تا ۳۰ دقیقه) |
| 525 | SSL handshake ناموفق | گواهی روی سرور نصب نیست → certbot یا Origin Certificate |
| 526 | گواهی نامعتبر | گواهی منقضی/خودامضا → تمدید کنید، نه غیرفعال‌کردن بررسی |
| حلقه ریدایرکت | حالت Flexible + ریدایرکت HTTPS در Nginx | حالت را Full (strict) کنید |
| 403 فقط برای اپ اندروید | Under Attack Mode یا WAF | مسیرهای API را از چالش مستثنی کنید |

## ۷. اکستنشن‌های امنیتی پیشنهادی

- **WAF → Managed Rules**: فعال با حساسیت متوسط؛ ابتدا در حالت Log تا false positive مشخص شود.
- **Rate limiting** (در Cloudflare): برای `/api/auth/*` نرخ ۱۰ درخواست در دقیقه به ازای IP.
  سامانه خودش هم محدودیت نرخ و قفل حساب دارد؛ این لایه دفاعی دوم است.
- **Bot Fight Mode**: ممکن است درخواست‌های اپ موبایل را چالش کند؛ اگر اپ مشکل داشت خاموش کنید.

## ۸. چک‌لیست پیش از انتشار

- [ ] رکورد A و AAAA به IP صحیح اشاره می‌کنند و Proxy روشن است.
- [ ] حالت SSL روی Full (strict) است و گواهی مبدأ معتبر است.
- [ ] `https://دامنه/api/health` پاسخ `{"ok":true}` می‌دهد.
- [ ] ورود با کد پیامکی و ورود مدیر از دامنه واقعی کار می‌کند.
- [ ] آپلود فایل (کمتر از حد مجاز) و دانلود مدرک کار می‌کند.
- [ ] `www` به دامنه اصلی ریدایرکت می‌شود (قاعده Redirect Rule یا Nginx).
- [ ] دسترسی مستقیم به پورت ۳۰۰۰ از بیرون بسته است (`nmap` یا curl از سرور دیگر).
