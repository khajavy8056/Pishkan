# راهنمای فارسی نصب — از صفر تا سایت بالا

این کوتاه‌ترین مسیر است. برای جزئیات بیشتر: [DEPLOY.md](DEPLOY.md)

---

## آنچه لازم دارید

| مورد | مقدار |
| --- | --- |
| سرور | Ubuntu Server **22.04** یا **24.04** |
| مشخصات | ۲ هسته CPU، **۲ گیگ رم**، ۲۰ گیگ دیسک |
| دسترسی | کاربر `root` یا `sudo` |
| دامنه | یک دامنه که DNS‌اش دستتان باشد |

> ⚠️ اگر رم سرور ۱ گیگ است، نصب `npm ci` و build ممکن است شکست بخورد. سواپ بسازید یا سرور بزرگ‌تر بگیرید.

---

## مرحله ۱ — DNS را درست کنید

در پنل دامنه (یا Cloudflare) این رکورد را بسازید:

```
نوع: A
نام: @          (یعنی خودِ دامنه)
مقدار: <IP سرور شما>
```

اگر `www` هم می‌خواهید، یکی دیگر با نام `www` بسازید.

**اگر Cloudflare استفاده می‌کنید:**
- ابر نارنجی (Proxied) روشن باشد — اشکالی ندارد
- در بخش SSL/TLS، حالت را روی **Full (strict)** بگذارید
- ❌ **هرگز Flexible نگذارید** — ورود به سایت کار نمی‌کند و کاربر در حلقه گیر می‌کند

---

## مرحله ۲ — نصب

به سرور SSH بزنید و یک دستور اجرا کنید:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/khajavy8056/Pishkan/main/scripts/install.sh)"
```

نصب‌کننده:

1. سیستم‌عامل، رم و دیسک را بررسی می‌کند
2. **دامنه را می‌پرسد** (چون در فایل تنظیمات خالی است)
3. ایمیل برای گواهی HTTPS را می‌پرسد
4. خودش PostgreSQL، Nginx، Node.js و certbot را نصب می‌کند
5. کد را می‌گیرد، می‌سازد، دیتابیس را آماده می‌کند
6. سرویس را بالا می‌آورد
7. گواهی HTTPS را می‌گیرد
8. **در پایان خودش تست می‌کند** که سایت واقعاً از دامنه باز می‌شود

حدود **۱۰ تا ۱۵ دقیقه** طول می‌کشد.

در پایان یک رمز عبور برای مدیر نمایش داده می‌شود:

```
⚠ رمز عبور اولیه مدیر کل (فقط یک بار نمایش داده می‌شود):
    نام کاربری: admin
    رمز عبور:   aB3dE7hK...
```

**همین حالا کپی کنید.** بعد از این پیام دیگر نمایش داده نمی‌شود.

---

## مرحله ۳ — وارد شوید

```
https://دامنه-شما/login
```

با `admin` و رمزی که گرفتید وارد شوید و **رمز را عوض کنید**.

---

## مرحله ۴ — فایل تنظیمات

همهٔ تنظیمات استقرار در یک فایل است:

```bash
sudo nano /etc/pishkan/deploy.conf
```

چیزهایی که می‌توانید عوض کنید:

```ini
DOMAIN=pishkan.example.ir          # دامنه اصلی
DOMAIN_WWW=www.pishkan.example.ir  # www (اگر می‌خواهید)
ACME_EMAIL=admin@example.ir        # ایمیل گواهی
TIMEZONE=Asia/Tehran               # منطقه زمانی
KEEP_RELEASES=5                    # چند نسخه برای rollback بماند
```

بعد از هر تغییر:

```bash
sudo pishkan provision
```

همین. نصب دوباره لازم نیست.

---

## وبلاگ روی زیردامنه

اگر می‌خواهید وبلاگ روی `blog.دامنه` باشد:

**۱)** در DNS یک رکورد `A` با نام `blog` بسازید (یا در Cloudflare Proxied کنید).

**۲)** در `deploy.conf`:

```ini
BLOG_MODE=subdomain
BLOG_SUBDOMAIN=blog.pishkan.example.ir
```

**۳)** اجرا کنید:

```bash
sudo pishkan provision
```

چه می‌شود:
- گواهی برای `blog` هم گرفته می‌شود
- `دامنه/blog` به `blog.دامنه` ریدایرکت می‌شود (لینک‌های قدیمی نمی‌شکنند)
- CORS خودکار به‌روز می‌شود

**برگشت:**
```ini
BLOG_MODE=inline
```
```bash
sudo pishkan provision
```

---

## آپدیت

```bash
sudo pishkan update            # خودش جدیدترین نسخه را پیدا می‌کند
sudo pishkan update --dry-run  # فقط نشان بده چه چیزی عوض می‌شود
```

پشت صحنه:

```
پشتیبان خودکار
  → دریافت نسخه جدید
  → build
  → مهاجرت دیتابیس
  → سوییچ به نسخه جدید
  → تست سلامت
     ├ موفق → پاک‌سازی نسخه‌های قدیمی
     └ ناموفق → بازگشت خودکار به نسخه قبل
```

**اگر آپدیت خراب شد:**

```bash
sudo pishkan rollback
```

سایت به نسخهٔ قبلی برمی‌گردد. هیچ داده‌ای پاک نمی‌شود.

---

## اگر چیزی کار نکرد

اول این را بزنید — بیشتر مشکلات را خودش پیدا می‌کند:

```bash
sudo pishkan doctor
```

| مشکل | راه‌حل |
| --- | --- |
| ایمیل/رمز کار نمی‌کند، صفحه رفرش می‌شود | Cloudflare روی Flexible است → `Full (strict)` کنید |
| سایت باز نمی‌شود | `sudo pishkan logs nginx` و `sudo pishkan doctor` |
| «گواهی HTTPS نشد» | DNS هنوز منتشر نشده. چند ساعت صبر کنید، بعد: `sudo pishkan provision --tls` |
| صفحهٔ سفید | `Ctrl+Shift+R` (هارد رفرش) |
| نمی‌توانم وارد پنل شوم | `sudo pishkan reset-admin` |

لاگ‌ها:

```bash
sudo pishkan logs api -f      # لاگ زندهٔ سرور
sudo journalctl -u pishkan-api -n 200
sudo tail -f /var/log/nginx/pishkan.error.log
```

---

## دستورهای روزمره

```bash
sudo pishkan status          # وضعیت کلی
sudo pishkan doctor          # بررسی کامل
sudo pishkan update          # آپدیت
sudo pishkan rollback        # برگشت
sudo pishkan backup          # پشتیبان دستی
sudo pishkan provision       # اعمال deploy.conf
sudo pishkan logs api -f     # لاگ زنده
```

---

## کجا چه چیزی است

```
/etc/pishkan/deploy.conf     ← دامنه و تنظیمات (این را ویرایش کنید)
/etc/pishkan/pishkan.env     ← رمزها و کلیدها (به کسی ندهید)

/var/lib/pishkan/uploads/    ← فایل‌های کاربران
/var/backups/pishkan/        ← پشتیبان‌های روزانه (ساعت ۰۲:۳۰)

/opt/pishkan/current         ← نسخهٔ فعلی
/opt/pishkan/previous        ← نسخهٔ قبلی (برای rollback)
```

> **پشتیبان‌ها روی همان سرور هستند.** برای امنیت واقعی، روزانه به یک سرور دیگر هم کپی کنید:
> ```bash
> rsync -av /var/backups/pishkan/ backup-host:/backups/pishkan/
> ```
