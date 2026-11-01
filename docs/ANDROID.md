# اپلیکیشن اندروید و PWA

سامانه دو مسیر برای استفاده روی موبایل و تبلت دارد:

1. **PWA (نصب از مرورگر)** — بدون نیاز به فروشگاه؛ کاربر آیکن را روی صفحه اصلی می‌گذارد.
2. **اپ اندروید با Capacitor** — همان SPA در پوسته Native با آیکن، اسپلش و نام مستقل.

> **وضعیت واقعی:** پیکربندی Capacitor (`apps/web/capacitor.config.ts`) و سرویس‌ورکر PWA در این پروژه
> آماده است و **ساخت PWA در بیلد تأیید شده** (`sw.js` و `workbox-*.js` در `apps/web/dist` تولید می‌شوند).
> اما **پوشه `android/` تولید نشده و APK ساخته نشده است**، چون این محیط به Android SDK و JDK نیاز دارد.
> مراحل زیر را روی ماشین خودتان یا GitHub Actions اجرا کنید.

## ۱. PWA

### فعال‌سازی روی سرور

PWA فقط روی **HTTPS** نصب می‌شود. پس از اتصال دامنه (`docs/DOMAIN-CLOUDFLARE.md`):

1. صفحه سامانه را در Chrome اندروید باز کنید.
2. منوی سه‌نقطه → **Add to Home screen / نصب اپلیکیشن**.
3. آیکن، نام («دفتر پیشخوان»)، رنگ تم (`#0b1f3a`) و حالت standalone از `manifest` گرفته می‌شوند.

چیزهایی که باید در Nginx درست باشد:

- سرو شدن `sw.js` با `Cache-Control: no-cache` (فایل `deploy/nginx/pishkan.conf` این را دارد).
- دسترس‌پذیری `/manifest.webmanifest` و آیکن‌ها.
- عدم کش شدن `index.html` تا به‌روزرسانی فوری دیده شود.

### آزمون PWA

```bash
npm run build --workspace apps/web
ls apps/web/dist/sw.js apps/web/dist/manifest.webmanifest
```

در Chrome DevTools → Application → Manifest/Service Workers باید بدون خطا باشد.

## ۲. ساخت اپ اندروید (Capacitor)

### پیش‌نیازها

- Node.js 22 و JDK 21
- Android Studio (شامل Android SDK موردنیاز Capacitor 8؛ معمولاً API 36) یا `sdkmanager` + `gradle`
- متغیر محیطی `ANDROID_HOME` و `JAVA_HOME`

### گام‌ها

```bash
npm ci  # از ریشه مخزن؛ نسخه‌های Capacitor در lockfile ثبت شده‌اند
cd apps/web

# ۱. پکیج‌ها با دستور بالا نصب شده‌اند

# ۲. تولید پوشه Native اندروید (یک‌بار)
npx cap add android

# ۳. ساخت وب و همگام‌سازی
PISHKAN_SERVER_URL=https://pishkan.example.ir npm run android:sync

# ۴. ساخت APK دیباگ
PISHKAN_SERVER_URL=https://pishkan.example.ir npm run android:build
# خروجی: apps/web/android/app/build/outputs/apk/debug/app-debug.apk

# ۵. نسخه انتشار (نیازمند امضای keystore)
cd android && ./gradlew assembleRelease
```

`npm run android:open` پروژه را در Android Studio باز می‌کند.

### تنظیمات مهم

| مورد | مقدار | توضیح |
| --- | --- | --- |
| `appId` | `ir.pishkan.daftar` | قابل تغییر پیش از `cap add` |
| `appName` | `دفتر پیشخوان` | نام نمایشی |
| `server.url` | `PISHKAN_SERVER_URL` | اپ به سرور واقعی وصل می‌شود؛ بدون آن، فایل‌های بسته‌بندی‌شده نمایش داده می‌شوند ولی داده‌ای ندارند |
| `androidScheme` | `https` | لازم برای کوکی امن و CORS صحیح |
| `allowMixedContent` | `false` | جلوگیری از بارگذاری HTTP در HTTPS |
| `cleartext` | `false` | ارتباط فقط رمزنگاری‌شده |
| `webContentsDebuggingEnabled` | `false` | در نسخه انتشار |

### نکات مهم درباره کوکی و دامنه

- اپ در `https://localhost` (WebView) اجرا می‌شود و درخواست‌ها به دامنه اصلی می‌روند؛ بنابراین
  `CORS_ORIGINS` در `.env` باید دامنه عمومی را داشته باشد (نصب‌کننده به‌طور پیش‌فرض همان `APP_URL` را می‌گذارد).
- کوکی نشست با `SameSite=Lax` روی درخواست‌های cross-origin از WebView ارسال نمی‌شود.
  **راه‌حل توصیه‌شده:** `server.url` را روی دامنه واقعی بگذارید (حالت پیش‌فرض بالا) تا اپ هم‌مبدأ باشد
  و کوکی عادی کار کند. روش جایگزین (توکن Bearer) در کد پیاده‌سازی نشده است؛ اگر آن را لازم دارید،
  پیش از انتشار باید اضافه و آزمون شود.
- گواهی HTTPS باید معتبر باشد؛ اپ در صورت خطای گواهی متوقف می‌شود (این رفتار عمدی است).

## ۳. انتشار در کافه‌بازار / مایکت / گوگل‌پلی

1. `versionCode` و `versionName` را در `apps/web/android/app/build.gradle` تنظیم کنید.
2. آیکن‌ها را در `android/app/src/main/res/mipmap-*` و اسپلش را با Android Studio Asset Studio بسازید.
3. `AUTH` keystore بسازید و **آن را امن نگه دارید** (بدون آن نمی‌توانید نسخه بعدی را منتشر کنید):
   ```bash
   keytool -genkey -v -keystore pishkan-release.keystore -alias pishkan \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
4. `signingConfigs` را در `build.gradle` اضافه کنید و رمزها را از متغیر محیطی بخوانید (در گیت نگذارید).
5. برای گوگل‌پلی از **AAB** استفاده کنید: `./gradlew bundleRelease`.

## ۴. عیب‌یابی

| مشکل | علت | راه‌حل |
| --- | --- | --- |
| صفحه سفید در اپ | `server.url` خالی یا دسترسی شبکه قطع است | `PISHKAN_SERVER_URL` را تنظیم و `cap sync` را دوباره اجرا کنید |
| خطای شبکه ولی مرورگر درست است | CORS یا کوکی cross-origin | `server.url` را هم‌مبدأ کنید و دامنه را به `CORS_ORIGINS` اضافه کنید |
| «گواهی نامعتبر» | دامنه گواهی معتبر ندارد | گواهی واقعی نصب کنید؛ هرگز `allowMixedContent` را روشن نکنید |
| نصب PWA پیشنهاد نمی‌شود | HTTP یا manifest ناقص | HTTPS و آیکن‌های ۱۹۲/۵۱۲ پیکسل را بررسی کنید |
| `cap: command not found` | Capacitor نصب نیست | `npm i -D @capacitor/cli` در `apps/web` |
| Gradle از SDK شکایت می‌کند | SDK 34 نصب نیست | Android Studio → SDK Manager |

## ۵. به‌روزرسانی اپ

- تغییرات وب **بدون انتشار نسخه جدید اپ** اعمال می‌شوند (اپ همان سایت را نمایش می‌دهد).
- فقط تغییرات Native (آیکن، مجوزها، نسخه اندروید) نیازمند انتشار جدید در فروشگاه است.
- PWA با سرویس‌ورکر نسخه جدید را در بازدید بعدی می‌گیرد؛ در صورت گیرکردن، کاربر می‌تواند
  اپ را حذف و دوباره نصب کند (داده‌ها سمت سرور هستند، چیزی از دست نمی‌رود).
