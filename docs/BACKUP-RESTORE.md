# پشتیبان‌گیری و بازیابی

## چه چیزی پشتیبان می‌شود؟

هر نسخه پشتیبان یک فایل `pishkan-backup-<UTC timestamp>.tar.gz` و یک فایل چک‌سام `.sha256` است و شامل:

| محتوا | توضیح |
| --- | --- |
| `database.dump` | خروجی کامل PostgreSQL با قالب custom (شامل مشتریان، پرونده‌ها، فاکتورها، تراکنش‌ها، تنظیمات، نقش‌ها، لاگ عملیات) |
| `uploads.tar.gz` | مدارک و فایل‌های بارگذاری‌شده مشتریان |
| `manifest.json` | تاریخ، نسخه سامانه، شناسه نسخه کد، نوع پایگاه داده و نام سرور |

در محیط SQLite (توسعه) به‌جای dump، فایل `database.sqlite` با روش backup امن SQLite گرفته می‌شود.

## پشتیبان‌گیری دستی

```bash
sudo pishkan backup
# نسخه پشتیبان + چک‌سام در /var/backups/pishkan
```

مقصد دیگر:

```bash
sudo pishkan backup --dest /mnt/nas/pishkan
```

## پشتیبان‌گیری خودکار

نصب‌کننده تایمر `pishkan-backup.timer` را فعال می‌کند (هر شب ۰۲:۳۰ با تأخیر تصادفی تا ۱۰ دقیقه).

```bash
systemctl list-timers pishkan-backup.timer
sudo systemctl start pishkan-backup.service   # اجرای فوری
journalctl -u pishkan-backup.service -n 50
```

نگهداری پیش‌فرض روی سرور ۱۴ روز است (`BACKUP_KEEP_DAYS`). نسخه‌های قدیمی‌تر از مقصد محلی حذف می‌شوند.

## ذخیره خارج از سرور (الزامی)

نسخه‌ای که فقط روی همان سرور است، در صورت خرابی دیسک یا باج‌خواهی از دست می‌رود.
یکی از این روش‌ها را انتخاب کنید:

**سرور پشتیبان با rsync**

```bash
# روی سرور اصلی
rsync -av --delete /var/backups/pishkan/ backup-host:/backups/pishkan/
```

**فضای ابری S3 با rclone**

```bash
sudo apt install rclone
rclone config            # ساخت remote با نام myremote
rclone copy /var/backups/pishkan/ myremote:pishkan-backups/ --include 'pishkan-backup-*' --max-age 30d
```

برای خودکارسازی، اسکریپت بالا را در `/etc/cron.d/pishkan-offsite` قرار دهید (ساعت ۰۳:۳۰).

**قاعده ۳-۲-۱:** حداقل سه نسخه، روی دو رسانه، یکی خارج از سرور. یکی از نسخه‌ها را ماهانه
روی محیط آزمایشی بازیابی و بررسی کنید.

## بازیابی

> بازیابی، داده‌های فعلی را با نسخه انتخاب‌شده **جایگزین** می‌کند.

```bash
sudo pishkan restore /var/backups/pishkan/pishkan-backup-20260101T023000Z.tar.gz
```

مراحل داخلی:

1. بررسی چک‌سام فایل (اگر فایل `.sha256` موجود باشد).
2. درخواست تأیید با تایپ عبارت `RESTORE`.
3. گرفتن پشتیبان ایمنی از وضعیت فعلی (قبل از هر تغییری).
4. توقف سرویس، `pg_restore --clean --if-exists`، بازگردانی مدارک.
5. راه‌اندازی سرویس و بررسی سلامت.

با `--yes` می‌توانید تأیید تعاملی را رد کنید (برای اسکریپت خودکار)؛ استفاده از این گزینه در محیط
عملیاتی بدون بررسی دقیق توصیه نمی‌شود.

### بازیابی روی سرور تازه

```bash
# ۱. نصب تازه (بدون داده)
curl -fsSL https://raw.githubusercontent.com/khajavy8056/Pishkan/main/scripts/install.sh | sudo bash
# ۲. بازیابی
sudo pishkan restore /path/to/pishkan-backup-....tar.gz
```

نکته: رمز پایگاه داده در `/etc/pishkan/pishkan.env` سرور جدید متفاوت است؛ این مسئله‌ای ایجاد نمی‌کند
چون `pg_dump` با `--no-owner --no-privileges` گرفته شده و مخزن داده در پایگاه داده جدید ساخته می‌شود.
پس از بازیابی، `APP_ENCRYPTION_KEY` سرور جدید با نسخه پشتیبان مطابقت ندارد و **اعتبارنامه‌های
رمزنگاری‌شده (پیامک/درگاه) باید دوباره وارد شوند**. برای جلوگیری از این وضعیت، کلید رمزنگاری را در
مدیر رمز سازمانی نگه دارید و در سرور جدید همان مقدار را قرار دهید.

## آزمون دوره‌ای بازیابی

```bash
# روی محیط آزمایشی (نه تولید)
sudo -u postgres createdb pishkan_restore_test
sudo -u postgres pg_restore -d pishkan_restore_test --no-owner --no-privileges /tmp/database.dump
sudo -u postgres psql -d pishkan_restore_test -c 'SELECT count(*) FROM requests;'
```

## حذف و نگهداری داده

- پاک کردن فایل‌های پشتیبان قدیمی به‌صورت خودکار پس از ۱۴ روز انجام می‌شود.
- حذف داده‌های مشتری از پنل مدیریت به‌صورت «غیرفعال‌سازی» است، نه حذف فیزیکی، تا سابقه مالی حفظ شود.
- درخواست حذف داده طبق مقررات حفاظت از داده باید به‌صورت مستند و با تأیید مدیر کل انجام شود
  (حذف فایل مدارک + غیرفعال‌سازی حساب، با ثبت در لاگ عملیات).
