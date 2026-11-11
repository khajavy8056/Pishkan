# استقرار روی سرور — یک فایل، یک دستور

این سند دقیقاً همان مسیری است که از «یک سرور خالی» به «سایت روی دامنه با HTTPS» می‌رسد، و بعد از آن مسیر هر آپدیت.

> **قاعدهٔ اصلی:** دامنه و همهٔ تنظیمات استقرار فقط در **یک فایل** نوشته می‌شوند: `deploy.conf`.
> هیچ‌جای دیگر نام دامنه تکرار نمی‌شود. برای تغییر دامنه، زیردامنه یا تنظیمات، همان فایل را ویرایش می‌کنید و `sudo pishkan provision` می‌زنید. نصب دوباره لازم نیست.

---

## ۱. نصب از صفر

### پیش‌نیاز شما

- یک سرور Ubuntu Server **22.04** یا **24.04** با دسترسی root (2GB RAM، 20GB دیسک)
- دامنه‌ای که DNS آن را در اختیار دارید (در Cloudflare یا هر جای دیگر)

### مرحلهٔ ۱ — فایل تنظیمات

```bash
sudo mkdir -p /etc/pishkan
sudo curl -fsSL -o /etc/pishkan/deploy.conf \
  https://raw.githubusercontent.com/khajavy8056/Pishkan/main/deploy/deploy.conf
sudo nano /etc/pishkan/deploy.conf
```

دست‌کم دو خط را پر کنید:

```ini
DOMAIN=pishkan.example.ir
ACME_EMAIL=admin@example.ir
```

بقیهٔ مقادیر پیش‌فرض‌های امن دارند. توضیح هر کلید داخل همان فایل نوشته شده.

### مرحلهٔ ۲ — نصب

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/khajavy8056/Pishkan/main/scripts/install.sh)"
```

نصب‌کننده خودش این‌ها را انجام می‌دهد:

| مرحله | چه کاری |
| --- | --- |
| پیش‌بررسی | سیستم‌عامل، معماری، RAM، دیسک — اگر یکی نباشد، **قبل از هر تغییری** متوقف می‌شود |
| تنظیمات | `deploy.conf` را می‌خواند و **اعتبارسنجی می‌کند**؛ خطای تایپی یعنی توقف، نه نصب نیمه‌کاره |
| DNS | بررسی می‌کند دامنه به همین سرور اشاره می‌کند یا پشت Cloudflare است (فقط گزارش، نه توقف) |
| پیش‌نیازها | `curl git build-essential postgresql nginx certbot jq ufw` و Node.js 22 |
| پایگاه داده | کاربر و دیتابیس PostgreSQL می‌سازد (اگر وجود داشته باشند، دست نمی‌زند) |
| کد | commit مشخص را کلون می‌کند و SHA را تأیید می‌کند |
| ساخت | `npm ci` و build هر دو اپ |
| مهاجرت | مهاجرت‌های نسخه‌بندی‌شده را اجرا می‌کند |
| سرویس | systemd با hardening کامل (`ProtectSystem=strict`, `NoNewPrivileges`…) |
| Nginx | vhost را برای همهٔ hostnameها می‌نویسد |
| TLS | گواهی Let's Encrypt برای **همهٔ** hostnameها در یک لاین |
| پشتیبان | تایمر روزانه ۰۲:۳۰ |
| مدیر | حساب مدیر با رمز تصادفی — **یک بار** نمایش داده می‌شود |

### مرحلهٔ ۳ — بررسی

```bash
sudo pishkan doctor
```

---

## ۲. دامنه و زیردامنه

همه‌چیز از `deploy.conf`:

```ini
DOMAIN=pishkan.example.ir
DOMAIN_WWW=www.pishkan.example.ir
DOMAIN_ALIASES=old-domain.ir

BLOG_MODE=inline                 # یا subdomain
BLOG_SUBDOMAIN=blog.pishkan.example.ir
```

### وبلاگ روی زیردامنه

```ini
BLOG_MODE=subdomain
BLOG_SUBDOMAIN=blog.pishkan.example.ir
```

بعد:

```bash
sudo pishkan provision
```

چه اتفاقی می‌افتد:

1. **رکورد DNS** — باید `blog` را به همان سرور اشاره دهید (یا در Cloudflare Proxied کنید). `provision` این را بررسی و گزارش می‌کند.
2. **nginx** — `blog.pishkan.example.ir` به همان vhost اضافه می‌شود؛ **یک** vhost، **یک** گواهی.
3. **ریدایرکت** — `/blog` و `/blog/...` روی دامنهٔ اصلی `301` می‌شوند به زیردامنه. لینک‌های قدیمی و نتایج گوگل نمی‌شکنند.
4. **CORS** — `CORS_ORIGINS` خودکار هر دو host را شامل می‌شود.
5. **TLS** — گواهی با `--expand` برای hostname جدید بزرگ می‌شود، نه یک گواهی دوم.

**برگشت به حالت قبل:** `BLOG_MODE=inline` کنید و `sudo pishkan provision` بزنید. زیردامنه از nginx حذف می‌شود، ریدایرکت برداشته می‌شود، `CORS_ORIGINS` کوچک می‌شود. داده‌ها دست نمی‌خورند.

### Cloudflare

دامنه پشت Cloudflare می‌آید و بعد به سرور. دو نکتهٔ حیاتی:

| تنظیم Cloudflare | درست | چرا |
| --- | --- | --- |
| **SSL/TLS mode** | **Full (strict)** | با `Flexible`، Cloudflare به سرور HTTP می‌زند؛ کوکی نشست `Secure` است، مرورگر آن را دور می‌ریزد و کاربر در حلقهٔ ورود گیر می‌کند. `deploy.conf` مقدار `flexible` را **رد می‌کند**. |
| **Real IP** | خودکار | قالب nginx رنج‌های Cloudflare را در `set_real_ip_from` دارد؛ بدون آن همهٔ کاربران یک محدودیت نرخ مشترک دارند. |

اگر Cloudflare روی «Under Attack» یا «I'm Under Attack» باشد، ACME چالش ممکن است مسدود شود. `pishkan provision --tls` را بعد از خاموش کردن موقت امتحان کنید.

---

## ۳. آپدیت

```bash
sudo pishkan update
```

بدون هیچ آرگومانی. این‌ها را انجام می‌دهد:

```
پشتیبان‌گیری خودکار
  → ls-remote برای پیدا کردن آخرین commit شاخه
  → کلون و تأیید SHA
  → npm ci + build
  → مهاجرت‌ها
  → سوییچ سیم‌لینک current
  → restart
  → تست /api/health تا ۹۰ ثانیه
     ├─ سالم → provision دوباره + حذف نسخه‌های قدیمی
     └─ ناسالم → بازگشت خودکار به نسخهٔ قبل
```

### گزینه‌ها

```bash
sudo pishkan update --dry-run      # فقط بگو چه چیزی عوض می‌شود
sudo pishkan update --ref <SHA>    # نسخهٔ مشخص
sudo pishkan update --no-backup    # رد کردن پشتیبان (فقط با پشتیبان تازه)
```

### چرا نسخه‌های قدیمی حذف می‌شوند

هر نسخه یک `node_modules` کامل دارد. بعد از ۱۰ آپدیت، `/opt` پر می‌شود و **آپدیت بعدی** شکست می‌خورد. `KEEP_RELEASES` (پیش‌فرض ۵) تعیین می‌کند چند نسخه بماند. نسخه‌ای که `previous` به آن اشاره دارد هرگز حذف نمی‌شود، چون همین چیزی است که `rollback` استفاده می‌کند.

### بازگشت

```bash
sudo pishkan rollback          # آخرین نسخهٔ قبلی
sudo pishkan rollback --to 20260101120000
```

---

## ۴. تغییر هر چیزی بعد از نصب

| چه چیزی | چطور |
| --- | --- |
| دامنه یا زیردامنه | `deploy.conf` را ویرایش کن، `sudo pishkan provision` |
| گسترش HTTPS | `sudo pishkan provision --tls` |
| منطقه زمانی | `TIMEZONE=` در `deploy.conf`، `provision` |
| تعداد نسخه‌های نگه‌داشته | `KEEP_RELEASES=` در `deploy.conf` |
| پشتیبان خودکار | `BACKUP_ENABLED=` در `deploy.conf` |
| بازبینی بدون تغییر | `sudo pishkan provision --dry-run` |

`provision` اگر خطای پیکربندی پیدا کند، **هیچ چیزی را عوض نمی‌کند** و به نسخهٔ قبلی nginx برمی‌گردد.

---

## ۵. عیب‌یابی

```bash
sudo pishkan doctor                    # بررسی کامل
sudo pishkan logs api -f               # لاگ زندهٔ API
sudo journalctl -u pishkan-api -n 200  # سرویس
sudo nginx -t                          # پیکربندی nginx
sudo pishkan health                    # فقط سلامت API
```

| نشانه | علت احتمالی |
| --- | --- |
| حلقهٔ ورود / لاگین نمی‌شود | Cloudflare روی `Flexible` است. `full_strict` کنید. |
| صفحهٔ سفید بعد از آپدیت | نسخهٔ کش‌شدهٔ مرورگر. هارد‌رفرش کنید؛ `index.html` با `no-cache` سرو می‌شود. |
| `certbot` شکست می‌خورد | DNS منتشر نشده، پورت ۸۰ بسته، یا `/.well-known/acme-challenge/` به SPA می‌رسد (باید قبل از `location /` باشد — تست خودکار این را قفل کرده). |
| آپدیت «نسخه‌ای برای آپدیت نیست» می‌گوید | `PISHKAN_RELEASE_REF` در `pishkan.env` با آخرین commit شاخه برابر است. |
| دیسک پر | `KEEP_RELEASES` را کم کنید یا پشتیبان‌های قدیمی را پاک کنید. |

---

## ۶. ساختار روی سرور

```
/opt/pishkan/
  releases/20260101120000/   ← نسخه‌های کامل
  releases/20260102140000/
  current -> releases/...    ← سیم‌لینک اتمیک
  previous -> releases/...   ← هدف rollback

/etc/pishkan/
  deploy.conf                ← دامنه و تنظیمات استقرار (۰۶۴۰)
  pishkan.env                ← کلیدها و رمزها (۰۶۴۰ root:pishkan)

/var/lib/pishkan/uploads/    ← مدارک کاربران
/var/backups/pishkan/        ← پشتیبان‌های روزانه
/var/www/letsencrypt/        ← چالش ACME
```

---

## برای توسعه‌دهنده

اگر روی این پروژه کار می‌کنید و می‌خواهید آپدیتی بسازید که کاربران بتوانند بی‌خطر بگیرند، **[UPDATING-FOR-DEVELOPERS.md](UPDATING-FOR-DEVELOPERS.md)** را بخوانید. قاعدهٔ مرکزی: **همیشه expand، بعد contract.**
