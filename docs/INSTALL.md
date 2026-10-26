# نصب پشکان روی Ubuntu Server

این سند نصب **واقعی** روی سرور را توضیح می‌دهد. اگر فقط می‌خواهید سامانه را ببینید،
از بخش «اجرای محلی» در [README](../README.md) استفاده کنید.

## ۱. پیش‌نیازها

| مورد | حداقل | پیشنهاد |
| --- | --- | --- |
| سیستم‌عامل | Ubuntu Server 22.04 LTS یا 24.04 LTS (x86_64/arm64) | 24.04 LTS |
| حافظه | 1 GB RAM | 2 GB |
| دیسک | 4 GB آزاد | 20 GB (مدارک مشتریان رشد می‌کند) |
| دسترسی | کاربر root یا sudo | root |
| شبکه | دسترسی خروجی HTTPS برای دریافت بسته‌ها و کد | — |
| دامنه | اختیاری برای نصب اولیه، لازم برای HTTPS | یک دامنه با دسترسی به DNS |

نصب‌کننده اگر سیستم‌عامل غیر Ubuntu، نسخه قدیمی‌تر، حافظه کمتر از ۹۰۰MB یا فضای آزاد کمتر از ۴GB باشد
**با پیام روشن متوقف می‌شود** و هیچ تغییری در سیستم ایجاد نمی‌کند.

## ۲. نصب یک‌دستوری

```bash
curl -fsSL https://raw.githubusercontent.com/khajavy8056/Pishkan/main/scripts/install.sh | sudo bash
```

با دامنه و ایمیل (HTTPS خودکار با Let's Encrypt):

```bash
curl -fsSL https://raw.githubusercontent.com/khajavy8056/Pishkan/main/scripts/install.sh \
  | sudo DOMAIN=pishkan.example.ir EMAIL=admin@example.ir bash
```

از داخل یک کلون:

```bash
git clone https://github.com/khajavy8056/Pishkan.git
cd Pishkan
sudo bash scripts/install.sh
```

### متغیرهای اختیاری نصب

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `DOMAIN` | خالی | دامنه عمومی؛ اگر خالی باشد سامانه فقط روی IP و HTTP در دسترس است |
| `EMAIL` | خالی | ایمیل برای Let's Encrypt |
| `SKIP_TLS` | `0` | با `1` دریافت گواهی انجام نمی‌شود |
| `SEED_CATALOG` | `0` | با `1` کاتالوگ نمونه در نصب موجود دوباره بررسی/تکمیل می‌شود |
| `SOURCE_DIR` | — | نصب از مسیر کد محلی به‌جای clone از GitHub |
| `NODE_MAJOR` | `22` | نسخه Node.js |
| `REPO_BRANCH` | `main` | شاخه دریافت کد |

## ۳. نصب‌کننده چه می‌کند؟

1. بررسی سیستم‌عامل، حافظه، دیسک و معماری؛ توقف با پیام روشن در صورت کمبود.
2. نصب `postgresql`، `nginx`، `git`، `curl`، `certbot`، `ufw`، `jq` و Node.js 22 (در صورت نیاز).
3. ساخت کاربر سیستمی بدون شل `pishkan` و مسیرهای:
   - `/opt/pishkan/releases/<timestamp>` — نسخه‌ها
   - `/opt/pishkan/current` — لینک نمادین نسخه فعال
   - `/var/lib/pishkan/uploads` — مدارک مشتریان (۰۷۵۰)
   - `/var/backups/pishkan` — نسخه‌های پشتیبان
   - `/etc/pishkan/pishkan.env` — تنظیمات و کلیدها (۰۶۴۰ root:pishkan)
4. ساخت نقش و پایگاه داده PostgreSQL با رمز تصادفی (`CREATE ... IF NOT EXISTS`؛ داده موجود حذف نمی‌شود).
5. تولید `APP_ENCRYPTION_KEY` تصادفی (برای رمزنگاری اعتبارنامه ملی پیامک و درگاه در پایگاه داده).
6. `npm ci`، ساخت API و ساخت وب (SPA)؛ سپس فعال‌سازی اتمیک نسخه با لینک نمادین.
7. اجرای مهاجرت‌های نسخه‌بندی‌شده و ساخت حساب مدیر کل (فقط اگر هیچ مدیری وجود نداشته باشد).
8. نصب `pishkan-api.service`، راه‌اندازی Nginx و بررسی سلامت API (`/api/health`).
9. نصب `pishkan` در `/usr/local/bin` و فعال‌سازی تایمر پشتیبان‌گیری شبانه (۰۲:۳۰).

در پایان، رمز اولیه مدیر کل **یک بار** روی ترمینال چاپ می‌شود. آن را ذخیره کنید و پس از اولین ورود تغییر دهید.

## ۴. پس از نصب

1. `sudo pishkan status` — باید سرویس فعال و API سالم باشد.
2. با مرورگر به نشانی سامانه بروید و وارد شوید:
   - نام کاربری: `admin`
   - رمز: همان رمزی که نصب‌کننده چاپ کرد
3. از مسیر **تنظیمات سامانه → عمومی** نام دفتر، تلفن، نشانی و ساعات کاری را وارد کنید.
4. از **تنظیمات → پیامک و ملی پیامک** اعتبارنامه پیامک را وارد و «بررسی اتصال» را اجرا کنید
   (بدون این مرحله، ورود با کد پیامکی کار نمی‌کند).
5. از **خدمات و دسته‌ها** تعرفه واقعی هر خدمت را تأیید کنید و پرچم «هزینه/شرایط نمونه است» را خاموش کنید.
6. از **کارکنان و نقش‌ها** کارکنان دفتر را بسازید و نقش/تخصص/ظرفیت هر نفر را تعیین کنید.

## ۵. دسترسی‌ها و امنیت

- API فقط روی `127.0.0.1:3000` گوش می‌دهد؛ تنها Nginx روی پورت ۸۰/۴۴۳ در دسترس است.
- فایل تنظیمات شامل رمز پایگاه داده است؛ آن را در گیت، پیام یا ایمیل قرار ندهید.
- برای دیدن کلید رمزنگاری و رمز پایگاه داده: `sudo cat /etc/pishkan/pishkan.env`.
- فایروال: اگر `ufw` فعال باشد، پورت‌های `Nginx Full` باز می‌شوند. پورت ۳۰۰۰ هرگز عمومی نکنید.

## ۶. نصب دستی (بدون اسکریپت)

اگر نصب خودکار ممکن نیست، مراحل معادل:

```bash
sudo apt update
sudo apt install -y postgresql nginx git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

sudo useradd --system --home /opt/pishkan --shell /usr/sbin/nologin pishkan
sudo git clone https://github.com/khajavy8056/Pishkan.git /opt/pishkan/app
cd /opt/pishkan/app
sudo -u pishkan npm ci
sudo -u pishkan npm run build

sudo -u postgres psql -f deploy/postgres/setup.sql   # ابتدا رمز را داخل فایل عوض کنید
sudo cp .env.example /etc/pishkan/pishkan.env && sudo chmod 640 /etc/pishkan/pishkan.env
sudo editor /etc/pishkan/pishkan.env                 # DATABASE_URL، APP_ENCRYPTION_KEY، APP_URL …

sudo cp deploy/systemd/pishkan-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pishkan-api
sudo cp deploy/nginx/pishkan.conf /etc/nginx/sites-available/pishkan.conf
# __SERVER_NAME__، __API_PORT__ و __WEB_ROOT__ را جایگزین کنید
sudo ln -s /etc/nginx/sites-available/pishkan.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo pishkan migrate
sudo BOOTSTRAP_ADMIN_PASSWORD='رمز-قوی' pishkan reset-admin
```

## ۷. عیب‌یابی

| نشانه | بررسی |
| --- | --- |
| سرویس بالا نمی‌آید | `sudo journalctl -u pishkan-api -n 100 --no-pager` |
| خطای اتصال به پایگاه داده | `sudo -u postgres psql -c '\l'` و مقدار `DATABASE_URL` در فایل تنظیمات |
| صفحه سفید در مرورگر | وجود `apps/web/dist/index.html` در نسخه فعال و مسیر `__WEB_ROOT__` در Nginx |
| خطای ۵۰۲ | `sudo systemctl status pishkan-api` و `curl -s localhost:3000/api/health` |
| خطای ۴۱۳ در آپلود | `client_max_body_size` در Nginx و `files.max_size_mb` در تنظیمات |
| HTTPS برقرار نشد | رکورد A/DNS، باز بودن پورت ۸۰، سپس `sudo certbot --nginx -d دامنه` |
| کد پیامکی نمی‌رسد | `docs/MELIPAYAMAK.md` — اعتبارنامه، الگوی تأییدشده و لاگ پیامک |

با `sudo pishkan doctor` می‌توانید همه این موارد را یک‌جا بررسی کنید.
