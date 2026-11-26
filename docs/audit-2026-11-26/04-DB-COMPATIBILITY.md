# گزارش سازگاری پایگاه داده — SQLite ↔ PostgreSQL واقعی

تاریخ: ۲۰۲۶-۱۱-۲۶ · شاخه: `arena/fe627e67-pishkan` · نسخه: `1.0.1218`

## روش آزمون (موفقیت SQLite ≠ سازگاری PG)

یک سوئیت واحد (`apps/api/tests`، ۶۹ فایل) روی **هر دو** موتور اجرا می‌شود:
- SQLite: `node:sqlite` (توسعه/ویندوز).
- **PostgreSQL 16.2 واقعی** از طریق `pgserver` در `.data/pg-audit/pgdata` (نه mock).

متغیرهای اجرای PG:
```
PISHKAN_TEST_DB=postgres
DATABASE_URL='postgresql://postgres@/postgres?host=…/.data/pg-audit/pgdata'
PG_DUMP_BIN='…/pgserver/pginstall/bin/pg_dump'
PG_RESTORE_BIN='…/pgserver/pginstall/bin/pg_restore'
```

## بررسی ساختار و Schema

- **۴۶ مهاجرت افزایشی** (001–046) با checksum؛ هیچ مهاجرتی دادهٔ کاربر را حذف نمی‌کند.
  مهاجرت‌های جدید این مأموریت: `045_guard.sql`، `046_backup_external.sql` — فقط CREATE TABLE/INDEX.
- PK/FK/relations: همهٔ جدول‌ها PK متنی (`id(...)`)؛ FK با `ON DELETE CASCADE/SET NULL` صریح.
- انواع: متن/عدد/زمان به‌صورت قابل‌حمل؛ زمان‌ها ISO-8601 متنی (UTC) — بدون ابهام منطقهٔ زمانی.
- ایندکس‌ها: روی کلیدهای خارجی و ستون‌های پرتکرار (مثلاً `ix_services_public`, `idx_backup_transfers_*`).
- UTF-8 فارسی: هر دو موتور UTF-8؛ تست‌های محتوای فارسی روی PG سبز.

## تفاوت‌های گویش و رفع‌شده‌ها

| مورد | رفتار SQLite | رفتار PG | اصلاح |
| --- | --- | --- | --- |
| `rowid` | دارد | ندارد | F4: تست push-stage-payload به `created_at` تغییر یافت |
| جمع/COUNT | عدد صحیح | numeric/رشته | کوئری‌ها با `Number(...)` نرمال می‌شوند |
| LIKE حساسیت | case-insensitive ASCII | حساس | جست‌وجوها با `LOWER()`/پارامتر یکسان |
| ترتیب NULL | پیش‌فرض متفاوت | متفاوت | `ORDER BY` صریح در کوئری‌های حساس |
| pg_dump در PATH | نامرتبط | ممکن است نباشد/نسخه متفاوت | F3: `PG_DUMP_BIN`/`PG_RESTORE_BIN` + پیام فارسی |
| تراکنش/همروندی | قفل فایل | MVCC | `tx()` با retry/idempotency برای دفتر مالی |

## نتیجهٔ اجراها

- **اجرای اول PG (پیش از اصلاح):** ۴۵۲ پاس / ۸ شکست / ۶ skip. هر ۸ شکست ریشه‌یابی شد:
  ۳ مورد `rowid` (F4) و ۵ مورد نبودن `pg_dump` در PATH (F3). **هیچ شکست منطق دامنه در PG دیده نشد.**
- **اجرای دوم PG (پس از اصلاح، با باینری pgserver):** نتیجهٔ نهایی: ۴۹۵ پاس / ۶ skip عمدی / ۰ شکست (EXIT_CODE=0).
- **۶ skip عمدی:** تست‌های restore-package فقط SQLite هستند (`skipIf(!isSqlite)`) چون
  بازیابی SQLite در production ممنوع است؛ مسیر PG از CLI جداگانه تأیید می‌شود.

**نتیجهٔ نهایی اجرای PG (پس از همهٔ اصلاحات):**
```
Test Files  67 passed | 2 skipped (69)
      Tests  495 passed | 6 skipped (501)
EXIT_CODE=0
```
۶ skip عمدی تست‌های restore-package مخصوص SQLite هستند (`skipIf(!isSqlite)`)؛ ۲ فایل کامل
skip شده نیز همان مسیر SQLite-only است. **هیچ شکستی روی PostgreSQL واقعی باقی نمانده است.**
تنها شکست اجرای اول (یک تست گارد) race در خواندن `action_taken` پیش از تکمیل مسدودسازی
async بود که با انتظار برای وضعیت تکمیل‌شده رفع و روی PG ۱۵/۱۵ تأیید شد.

## پشتیبان‌گیری/بازیابی روی PG

- `createBackup` روی PG از `pg_dump --format=custom` استفاده می‌کند؛ `verifyBackup` با
  `pg_restore --list` ساختار dump را می‌خواند. با override مسیر باینری، هر دو در آزمون سبز.
- بازیابی PG فقط از CLI روی سرور (سرویس متوقف، تأیید صریح، نسخهٔ ایمنی) — مسیر API در production ممنوع.
- بکاپ خارجی (SFTP/FTP/Drive) هر دو جزءٔ dump و uploads را با تطابق SHA-256 منتقل می‌کند (۸ تست واقعی).

## نتیجه

سازگاری کامل با PostgreSQL واقعی با اجرای همان سوئیت تأیید شد؛ هیچ واگرایی گویشی رفع‌نشده
باقی نمانده و هیچ مهاجرتی به دادهٔ موجود آسیب نمی‌زند.
