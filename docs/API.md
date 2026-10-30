# مرجع API

پیشوند همه مسیرها: `/api`. قالب داده: JSON با UTF-8. نسخه فعلی: `1.0.0`.

## قراردادها

### احراز هویت

نشست با کوکی `HttpOnly` (`pishkan_session`) نگه داشته می‌شود؛ در مرورگر و اپ اندروید (Capacitor)
همان کوکی استفاده می‌شود. برای درخواست‌های هم‌مبدأ هیچ هدر اضافه‌ای لازم نیست.

```bash
curl -c cookies.txt -X POST https://دامنه/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"…"}'
curl -b cookies.txt https://دامنه/api/auth/me
```

### پاسخ‌ها

| وضعیت | معنا |
| --- | --- |
| `200/201` | موفق؛ بدنه شامل داده یا `{ ok: true }` |
| `400` | ورودی نامعتبر یا نقض قاعده دامنه (پیام فارسی در `message`) |
| `401` | نشست ندارد یا منقضی شده |
| `403` | مجوز کافی ندارد |
| `404` | یافت نشد |
| `409` | تضاد (نام کاربری تکراری، وضعیت نامعتبر، …) |
| `423` | حساب قفل شده |
| `429` | محدودیت نرخ؛ هدر `Retry-After` |
| `500` | خطای سرور (بدون افشای جزئیات داخلی) |

قالب خطا:

```json
{ "ok": false, "message": "پیام فارسی قابل نمایش", "code": "optional_code" }
```

### صفحه‌بندی و فیلتر

فهرست‌ها `page` (از ۱) و `pageSize` (پیش‌فرض ۲۰، حداکثر ۱۰۰) می‌پذیرند و
`{ items: [...], total, page, pageSize }` برمی‌گردانند. تاریخ‌ها ISO (`YYYY-MM-DD`).

### مجوز

هر مسیر در ستون «مجوز» مشخص شده است. نقش `super_admin` همه مجوزها را دارد.
عدم مجوز = `403`، مستقل از اینکه دکمه در رابط کاربری دیده شود یا نه.

---

## سلامت و عمومی (بدون احراز هویت)

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/api/health` | زنده بودن API + نسخه + وضعیت پایگاه داده |
| GET | `/api/health/ready` | آمادگی (اتصالات و مهاجرت‌ها) |
| GET | `/api/health/live` | فقط زنده بودن فرایند |
| GET | `/api/public/bootstrap` | تنظیمات عمومی، دسته‌ها، خدمات فعال، روش‌های ورود |
| GET | `/api/public/settings` | فقط کلیدهای `public` تنظیمات |
| GET | `/api/public/categories` | دسته‌های نمایش‌پذیر |
| GET | `/api/public/services` | خدمات نمایش‌پذیر؛ پارامترهای `q`, `category`, `page` |
| GET | `/api/public/services/:slug` | جزئیات خدمت + فرم + مدارک + مراحل |
| GET | `/api/public/search?q=` | جست‌وجوی فارسی خدمات (نرمال‌سازی، غلط‌یابی، مترادف) |
| GET | `/api/public/status` | وضعیت سرویس، حالت تعمیر، روش‌های ورود |

نمونه:

```json
{
  "categories": [{ "id": "cat_x", "title": "خدمات هویتی", "slug": "identity", "serviceCount": 9 }],
  "services": [{ "id": "svc_y", "title": "تعویض شناسنامه", "slug": "shenasname-replace",
                 "finalFee": 250000, "estimatedDays": 3, "acceptingRequests": true,
                 "needsReview": true }]
}
```

## احراز هویت — `/api/auth`

| متد | مسیر | توضیح |
| --- | --- | --- |
| POST | `/otp/request` | `{mobile}` → ارسال کد؛ در محیط توسعه `debugCode` |
| POST | `/otp/verify` | `{mobile, code}` → نشست |
| POST | `/login` | `{username, password}` (کارکنان/مشتری دارای رمز) |
| POST | `/mfa/verify` | `{challengeId, code}` مرحله دوم |
| POST | `/register` | ثبت‌نام مشتری (اگر باز باشد) |
| POST | `/password/reset` | بازنشانی رمز مشتری با کد پیامکی |
| GET | `/me` | کاربر، نقش، مجوزها، تنظیمات عمومی، `mustChangePassword` |
| POST | `/logout` / `/logout-all` | خروج یک/همه نشست‌ها |
| GET | `/sessions` ، DELETE `/sessions/:id` | مدیریت نشست‌های خود |
| PATCH | `/profile` | نام، ایمیل، موبایل |
| POST | `/password/change` | `{currentPassword, newPassword}` |
| GET/POST | `/mfa/status` , `/mfa/setup` , `/mfa/enable` , `/mfa/disable` | مدیریت ورود دومرحله‌ای |
| GET | `/login-info` | روش‌های ورود فعال (برای صفحه ورود) |

محدودیت نرخ: `/api/auth/*` حداکثر ۲۰ درخواست در دقیقه به ازای IP؛ درخواست کد ۶۰ ثانیه فاصله.

## کاتالوگ — `/api/catalog`

| متد | مسیر | مجوز | توضیح |
| --- | --- | --- | --- |
| GET | `/admin/categories` | `categories.view` | همه دسته‌ها (شامل مخفی) |
| GET | `/admin/services` | `services.view` | فهرست مدیریتی خدمات |
| GET | `/admin/services/:id` | `services.view` | جزئیات کامل خدمت |
| POST | `/categories` / PATCH `/categories/:id` | `categories.create` / `categories.edit` | — |
| POST | `/services` | `services.create` | ساخت خدمت |
| PATCH | `/services/:id` | `services.edit` | ویرایش خدمت/فرم/مدارک/مراحل |
| DELETE | `/services/:id` | `services.delete` | فقط بدون پرونده |
| GET/POST | `/custom-services` | `services.view` / `services.create` | خدمات اختصاصی مشتری |
| GET | `/offers` | مشتری | پیش‌نهادهای من |
| POST | `/offers/:id/accept` / `/decline` | مشتری | پذیرش/رد پیش‌نهاد |
| GET | `/mine` | مشتری | خدمات اختصاصی من |
| GET | `/services/:id/quote` | مشتری | محاسبه هزینه قبل از ثبت |

## درخواست‌ها — `/api/requests`

| متد | مسیر | مجوز | توضیح |
| --- | --- | --- | --- |
| GET | `/meta/statuses` | کاربر واردشده | وضعیت‌های مجاز و برچسب فارسی |
| GET | `/` | مشتری/کارمند | مشتری فقط درخواست‌های خود (فیلتر اجباری سمت سرور) |
| GET | `/stats` | `requests.view` | شمارش بر اساس وضعیت |
| GET | `/pending-documents` | `documents.view` | مدارک منتظر بررسی |
| GET | `/:id` | مالک یا `requests.view` | جزئیات کامل |
| POST | `/` | مشتری یا `requests.create` | ثبت درخواست با پاسخ فرم؛ هدر اختیاری `Idempotency-Key` (۸ تا ۱۲۸ نویسه ASCII) برای ایمن‌کردن retry |
| PATCH | `/:id/status` | `requests.edit` | `{status, note?}` با قواعد گردش کار |
| PATCH | `/:id/assign` | `requests.edit` | `{assignedTo}` |
| POST | `/:id/auto-assign` | `requests.edit` | ارجاع خودکار تخصص/شیفت/ظرفیت |
| GET | `/:id/candidates` | `requests.edit` | کارمندان پیشنهادی با امتیاز |
| POST | `/:id/notes` | `requests.edit` | یادداشت داخلی |
| POST | `/:id/documents` | مالک/`documents.view` | افزودن مدرک |
| POST | `/:id/documents/:docId/review` | `documents.approve` | `{status, note?}` |
| POST | `/:id/cancel` | مالک پیش از شروع | لغو |
| GET | `/:id/timeline` | مالک یا `requests.view` | تاریخچه رویدادها |

نمونه ثبت درخواست (مبالغ فقط سمت سرور محاسبه می‌شوند):

```http
POST /api/requests HTTP/1.1
Content-Type: application/json
Idempotency-Key: 9f9141f7-4356-4ff6-a9f5-726238c9fa39
Cookie: pishkan_session=…

{"serviceId":"svc_y","formData":{"nationalId":"0012345678","reason":"مفقودی"},"paymentMethod":"online","priority":"normal","documentIds":[{"fileId":"file_1","title":"مدرک هویتی"}]}
```

`Idempotency-Key` اختیاری است تا مشتریان قدیمی قرارداد را حفظ کنند. اگر همان مشتری کلید و payload یکسان را دوباره بفرستد، پاسخ پرونده و فاکتور قبلی برمی‌گردد؛ استفاده از همان کلید با داده متفاوت `409` می‌دهد. اگر کلید ارسال نشود، رفتار قبلی ایجاد درخواست جدید حفظ می‌شود.

## مشتریان — `/api/customers`

| متد | مسیر | مجوز | توضیح |
| --- | --- | --- | --- |
| GET | `/me/notifications` | مشتری | اعلان‌ها |
| POST | `/me/notifications/read` | مشتری | خوانده‌شدن |
| GET/PUT | `/me/records` | مشتری | اطلاعات پرتکرار (نشانی، کد پستی …) |
| GET | `/me/overview` | مشتری | خلاصه داشبورد |
| GET | `/` | `customers.view` | فهرست/جست‌وجو |
| POST | `/` | `customers.create` | ساخت مشتری |
| GET | `/:id` / PATCH `/:id` | `customers.view` / `customers.edit` | — |
| POST | `/:id/reset-password` | `customers.edit` | بازنشانی رمز |
| DELETE | `/:id` | `customers.delete` | غیرفعال‌سازی (نه حذف فیزیکی) |

## کارکنان و نقش‌ها — `/api/staff`

| متد | مسیر | مجوز |
| --- | --- | --- |
| GET | `/` | `staff.view` |
| GET | `/me/workload` | کارمند |
| POST | `/` | `staff.create` |
| PATCH | `/:id` | `staff.edit` |
| POST | `/:id/toggle-availability` | `staff.edit` |
| GET | `/:id/performance` | `staff.view` |
| GET | `/meta/roles`, `/meta/permissions` | `staff.view` |
| POST/PATCH/DELETE | `/meta/roles[/:id]` | `roles.create` / `roles.edit` / `roles.delete` |
| GET/PUT | `/meta/service-assignments/:serviceId` | `services.edit` |
| GET | `/meta/policies` | `settings.view` |

## شیفت و حضور — `/api/shifts`

| متد | مسیر | مجوز |
| --- | --- | --- |
| GET/POST/DELETE | `/templates[/:id]` | `shifts.view` / `shifts.create` / `shifts.delete` |
| GET | `/` , `/calendar` | `shifts.view` |
| POST | `/` | `shifts.create` |
| PATCH/DELETE | `/:id` | `shifts.edit` / `shifts.delete` |
| GET | `/attendance/list` | `attendance.view` |
| POST | `/attendance/check-in` , `/attendance/check-out` | کارمند |
| GET/POST | `/change-requests` | کارمند |
| PATCH | `/change-requests/:id` | `shifts.approve` |
| GET | `/reports/attendance` | `attendance.view` |

## حسابداری — `/api/accounting`

| متد | مسیر | مجوز | توضیح |
| --- | --- | --- | --- |
| GET | `/my/invoices` , `/my/payments` | مشتری | صورتحساب من |
| POST | `/my/invoices/:id/pay` | مشتری | شروع پرداخت آنلاین |
| POST | `/payments/callback/:gateway` | عمومی (امضاشده) | تأیید درگاه؛ تنها راه موفق‌شدن پرداخت آنلاین |
| GET | `/invoices` , `/invoices/:id` | `invoices.view` | — |
| POST | `/invoices` | `invoices.create` | فاکتور عمومی/اختصاصی |
| POST | `/invoices/:id/void` | `invoices.cancel` | ابطال با دلیل |
| GET | `/payments` | `payments.view` | فهرست پرداخت‌ها |
| POST | `/payments` | `payments.create` | پرداخت حضوری با مرجع الزامی |
| POST | `/payments/:id/confirm` | `payments.approve` | تأیید پرداخت نقدی |
| POST | `/payments/:id/refund` | `payments.cancel` | بازپرداخت با دلیل |
| GET/POST | `/expenses`, `/expenses/categories` | `expenses.view` / `expenses.create` | — |
| GET | `/reports/summary` | `reports.view` | درآمد/هزینه/سود/مطالبات |
| GET | `/reports/reconciliation` | `reports.view` | تطبیق پرداخت‌ها |
| GET | `/reports/transactions` | `reports.view` | دفتر تراکنش با فیلتر خدمت/کارمند/تاریخ |
| GET | `/reports/export` | `reports.view` | CSV (UTF-8 BOM برای Excel فارسی) |
| GET | `/meta/settings` | `invoices.view` | تنظیمات مالی مؤثر |

## پیام‌رسانی — `/api/messages`

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/threads` | رشته‌های عمومی/پرونده |
| POST | `/threads` | ساخت رشته (عمومی دفتر یا مرتبط با پرونده) |
| GET | `/threads/:id` | پیام‌ها (فقط اعضای مجاز) |
| POST | `/threads/:id/messages` | ارسال پیام/پیوست |
| PATCH | `/threads/:id` | بستن/بازگشایی |
| GET | `/unread-count` | شمارنده زنگوله |

## فایل‌ها — `/api/files`

| متد | مسیر | توضیح |
| --- | --- | --- |
| POST | `/upload` | آپلود (نوع/حجم بر اساس تنظیمات) |
| GET | `/:id` | دانلود با بررسی مالکیت/مجوز |
| GET | `/` | فایل‌های من / مدیریتی |
| DELETE | `/:id` | حذف (فقط مالک یا مدیر، با ثبت لاگ) |
| GET | `/meta/config` | `{maxSizeMb, allowedTypes}` |

## تنظیمات — `/api/settings`

| متد | مسیر | مجوز |
| --- | --- | --- |
| GET | `/admin` | `settings.view` |
| PUT | `/admin` | `settings.edit` (+ `confirmCritical` برای کلیدهای حساس) |
| POST | `/admin/reset` | `settings.edit` |
| POST | `/sms/test-connection` | `settings.edit` |
| POST | `/sms/test-send` | `settings.edit` — شماره مقصد الزامی |
| GET | `/sms/logs` | `settings.view` |
| GET | `/sms/credentials` | `settings.view` — فقط مقدار ماسک‌شده |
| GET | `/domain-check` | `settings.view` |
| GET | `/system-health` | `system.view` |
| GET | `/export` , POST `/import` | `settings.edit` (JSON نسخه‌دار) |
| GET | `/legal` | عمومی — شرایط و حریم خصوصی |
| POST | `/maintenance-mode` | `system.edit` |

## دستیار — `/api/assistant`

| متد | مسیر | توضیح |
| --- | --- | --- |
| POST | `/chat` | `{message, sessionId?}` → پاسخ مبتنی بر کاتالوگ با منابع |
| GET | `/info` | نام، وضعیت فعال بودن، سلب مسئولیت |

## داشبورد — `/api/dashboard`

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/summary` | KPI بر اساس نقش (مشتری/کارمند/مدیر) |

## سیستم — `/api/system`

| متد | مسیر | مجوز |
| --- | --- | --- |
| GET | `/status` | `system.view` |
| GET | `/audit` , POST `/audit/prune` | `audit.view` / `audit.delete` |
| GET | `/sessions` , DELETE `/sessions/:id` | `security.view` / `security.edit` |
| GET/POST | `/backups` | `backup.view` / `backup.create` |
| POST | `/backups/:id/verify` , `/backups/restore` | `backup.restore` |
| DELETE | `/backups/:id` | `backup.delete` |
| GET | `/logs` | `system.view` |
| POST | `/cache/clear` | `system.edit` |
| GET | `/version` , `/maintenance` | `system.view` |

## محدودیت‌ها و نکات

- حداکثر حجم بدنه JSON: ۱MB؛ آپلود فایل بر اساس `files.max_size_mb` (پیش‌فرض ۱۰MB).
- محدودیت نرخ عمومی: ۳۰۰ درخواست در دقیقه به ازای IP؛ عمومی‌ها (کاتالوگ/جست‌وجو) سقف بالاتر.
- هیچ مسیری رمز، کلید API یا کلید رمزنگاری را برنمی‌گرداند.
- برای دانلود فایل‌های حساس، لینک موقت امضاشده استفاده نمی‌شود؛ دانلود با بررسی مجوز در سرور انجام می‌شود.
- تغییرات مهم در `audit_logs` ثبت می‌شوند (کاربر، IP، قبل/بعد).


## مسیرهای افزوده‌شده در ۲۰۲۶-۱۰-۲۷

تمام namespaceها با پیشوند `/api/v1` نیز در دسترس‌اند؛ مسیرهای قبلی حفظ شده‌اند.

- `GET /api/public/cities`، `POST /api/catalog/cities` با مجوز services.edit.
- `GET /api/auth/me`: `profileState` شامل complete/missing/profile برای مشتری.
- `PATCH /api/auth/profile`: firstName,lastName,cityId,nationalId.
- `POST /api/auth/mobile/verify/request {confirm:true}` و `/confirm {code}` با نشست معتبر.
- OTP request/verify می‌تواند `kind: customer|staff` داشته باشد؛ پیامک کارکنان تنظیم مستقل دارد.
- سیاست خدمت: coverage(nationwide|cities),cityIds,urgentEnabled,urgentPercent,urgentDays,urgentCapacity.
- `POST /api/requests/quote {serviceId,priority}`: فقط مشتری با پروفایل کامل؛ مبالغ IRR سمت سرور.
- `GET /api/requests/queue/eligible` و `POST /api/requests/:id/claim`.
- `GET /api/payroll/me`؛ مسیرهای مدیریتی `/staff`, `/staff/:id`, `POST /contracts`, `/accrue {month:YYYY-MM}`, `/settlements {userId,amount,idempotencyKey,note}`.
- callback عمومی `GET /api/accounting/gateway/zarinpal?paymentId=...&Authority=...&Status=OK`؛ مبلغ هرگز از query پذیرفته نمی‌شود.
- `DELETE /api/system/backups/:id` نیازمند body با `confirmation: DELETE` است.

جزییات سیاست‌ها و محدودیت‌ها در [گزارش اصلاحات](CORRECTIONS-2026-10-27.md).


## گردش پرونده و کارتابل ارجاع (migrations 008)

کارمند مسئول می‌تواند پس از ورود/داشتن `requests.edit` خروجی خصوصی را با `POST /api/requests/:id/deliver {files:[{fileId,title}],summary}` بفرستد. همه فایل‌ها باید قبلاً با نشست خود کارمند آپلود شده باشند. پرونده به `under_review` می‌رود و ارجاع مدیریت اتمیک ساخته می‌شود. مشتری تا تصویب مدیریت نه فایل، نه متادیتای آن و نه رویداد داخلی تحویل را می‌بیند/دانلود می‌کند.

`POST /api/requests/:id/handoffs {department:management|accounting,reason}`؛ `GET /api/requests/:id/handoffs` (با کنترل همان دسترسی پرونده)؛ `GET /api/automation/inbox` بر مبنای مجوز واحد؛ `POST /api/automation/:id/decision {decision:approved|returned,note}`. مسیرهای `/api/v1` نیز موجودند. تأیید تکراری 409؛ تصمیم به واحد دیگر 403. وضعیت `ready/completed` تا پاسخ همه ارجاع‌های باز و تأیید فایل خروجی 409 است. تأیید حسابدار فقط گام بازبینی مالی این ارجاع است، نه ایجاد پرداخت؛ پرداخت واقعی فقط از مسیر accounting انجام می‌شود.
